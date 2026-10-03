# -*- coding: utf-8 -*-
"""Burn captions into a video, in one command.

    python burn.py clip.mp4                    -> clip.captioned.mp4
    python burn.py clip.mp4 --ass-only         -> clip.ass, nothing rendered
    python burn.py clip.mp4 --words w.json     -> reuse an existing transcript

The style comes from captions.STYLE and is identical on every run.
"""
import argparse, json, os, subprocess, sys, time, math, tempfile, shutil
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import captions


def ffmpeg():
    """Prefer a real build. The Windows Store stub on PATH has no encoders."""
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        pass
    from shutil import which
    exe = which("ffmpeg")
    if not exe:
        sys.exit("No ffmpeg found. pip install imageio-ffmpeg")
    return exe


def run(cmd, what, cwd=None):
    p = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd)
    if p.returncode != 0:
        sys.exit(f"{what} failed:\n{p.stderr[-1200:]}")
    return p


def extract_audio(ff, src, wav):
    run([ff, "-v", "error", "-y", "-i", src, "-map", "0:a:0",
         "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wav], "audio extraction")
    return wav


def _enable_cuda_dlls():
    """faster-whisper on Windows cannot see pip-installed cuBLAS/cuDNN without this."""
    import glob, site
    roots = []
    for sp in site.getsitepackages() + [site.getusersitepackages()]:
        roots += glob.glob(os.path.join(sp, "nvidia", "*", "bin"))
    for r in sorted(set(roots)):
        if os.path.isdir(r):
            try:
                os.add_dll_directory(r)
            except (OSError, AttributeError):
                pass
            os.environ["PATH"] = r + os.pathsep + os.environ.get("PATH", "")


def transcribe(wav, model="small"):
    _enable_cuda_dlls()
    from faster_whisper import WhisperModel

    def go(dev, ct):
        m = WhisperModel(model, device=dev, compute_type=ct)
        segs, info = m.transcribe(wav, word_timestamps=True, vad_filter=True)
        words = []
        for s in segs:
            for w in (s.words or []):
                words.append({"w": w.word, "s": round(w.start, 3), "e": round(w.end, 3)})
        return words, info, dev

    t0 = time.time()
    try:
        words, info, dev = go("cuda", "float16")
    except Exception as e:
        print(f"  cuda unavailable ({str(e).splitlines()[-1][:70]}), using cpu")
        words, info, dev = go("cpu", "int8")
    print(f"  {len(words)} words, lang={info.language}, {dev}, {time.time()-t0:.1f}s")
    return words


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("-o", "--out")
    ap.add_argument("--words", help="reuse a words.json instead of transcribing")
    ap.add_argument("--model", default="small")
    ap.add_argument("--ass-only", action="store_true")
    ap.add_argument("--crf", default="17")
    ap.add_argument("--font-file", help="Explicit licensed font file when Arial Black is not installed")
    ap.add_argument("--font-name", help="The installed font family used by libass; defaults to the font's family")
    ap.add_argument("--overwrite", action="store_true", help="Replace an existing generated video, never the input")
    a = ap.parse_args()

    if not os.path.isfile(a.video):
        ap.error("Choose an existing video")
    style = dict(captions.STYLE)
    if a.font_file:
        style["font_file"] = os.path.abspath(a.font_file)
        try:
            style["font"] = a.font_name or captions._font(style).getname()[0]
        except OSError:
            ap.error("The selected font file cannot be read")
    elif not os.path.isfile(style["font_file"]):
        ap.error("Arial Black is not installed; supply --font-file for a licensed font and inspect the changed appearance")
    elif a.font_name:
        style["font"] = a.font_name

    ff = ffmpeg()
    stem = os.path.splitext(a.video)[0]
    ass = stem + ".ass"

    if a.words:
        words = json.load(open(a.words, encoding="utf-8"))
        print(f"reusing {len(words)} words from {a.words}")
    else:
        wav = stem + ".caption.wav"
        print("extracting audio...")
        extract_audio(ff, a.video, wav)
        print("transcribing...")
        words = transcribe(wav, a.model)
        json.dump(words, open(stem + ".words.json", "w", encoding="utf-8"),
                  ensure_ascii=False, indent=1)
        os.remove(wav)

    if not isinstance(words, list) or not words:
        ap.error("The transcript contains no timed words")
    for word in words:
        if not isinstance(word, dict) or not isinstance(word.get("w"), str) or not word["w"].strip() or any(isinstance(word.get(k), bool) or not isinstance(word.get(k), (int, float)) or not math.isfinite(word[k]) for k in ("s", "e")) or not 0 <= word["s"] < word["e"]:
            ap.error("Each transcript word needs text and finite start/end times with 0 <= start < end")
    if any(words[i]["s"] < words[i-1]["s"] for i in range(1, len(words))):
        ap.error("Transcript word starts must be in time order")
    captions.write_ass(words, ass, style)
    with open(stem + ".caption-style.json", "w", encoding="utf8") as receipt:
        json.dump({"style": style, "font_override": bool(a.font_file), "word_count": len(words), "safe_zone": [90, 990]}, receipt, indent=2)
    n = sum(1 for l in open(ass, encoding="utf-8") if l.startswith("Dialogue"))
    print(f"wrote {ass}  ({n} events)")
    if a.ass_only:
        return

    out = a.out or (stem + ".captioned.mp4")
    if os.path.normcase(os.path.realpath(out)) == os.path.normcase(os.path.realpath(a.video)):
        ap.error("Caption output must preserve the original video")
    print("burning...")
    # Fixed relative names keep user filenames out of FFmpeg's filter grammar.
    # Explicit fonts are available to libass, even when not installed system-wide.
    with tempfile.TemporaryDirectory(prefix="godspeed-captions-", dir=os.path.dirname(os.path.abspath(ass))) as temporary:
        shutil.copy2(ass, os.path.join(temporary, "captions.ass"))
        os.mkdir(os.path.join(temporary, "fonts"))
        shutil.copy2(style["font_file"], os.path.join(temporary, "fonts", "caption-font" + os.path.splitext(style["font_file"])[1]))
        run([ff, "-v", "error", "-y" if a.overwrite else "-n", "-i", os.path.abspath(a.video),
             "-vf", "subtitles=captions.ass:fontsdir=fonts", "-c:v", "libx264", "-preset", "slow",
             "-crf", a.crf, "-pix_fmt", "yuv420p", "-c:a", "copy", os.path.abspath(out)],
            "burn", cwd=temporary)
    print(f"done -> {out}  ({os.path.getsize(out):,} bytes)")


if __name__ == "__main__":
    main()
