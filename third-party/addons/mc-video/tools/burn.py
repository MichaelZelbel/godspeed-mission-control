# -*- coding: utf-8 -*-
"""Captions and a vertical cut, one command each. Started by `mc-video`, which passes
the ffmpeg to use and your mission control's style file in the environment.

    burn.py captions clip.mp4             -> clip.captioned.mp4
    burn.py captions clip.mp4 --ass-only  -> clip.ass, nothing rendered
    burn.py captions clip.mp4 --words w.json   reuse a transcript, skip listening again
    burn.py vertical clip.mp4             -> clip.vertical.mp4 (centre crop to 9:16)
    burn.py vertical clip.mp4 --captions  -> clip.vertical.captioned.mp4

The source file is never changed. Every output lands next to it with a new name.
"""
import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import captions  # noqa: E402


def ffmpeg():
    exe = os.environ.get("GODSPEED_VIDEO_FFMPEG") or shutil.which("ffmpeg")
    if not exe:
        sys.exit("error: no ffmpeg found. Run `mc-video setup` again; it says how to get one.")
    return exe


def run(cmd, what, cwd=None):
    p = subprocess.run(cmd, capture_output=True, text=True, cwd=cwd,
                       encoding="utf-8", errors="replace")
    if p.returncode != 0:
        sys.exit(f"error: {what} failed:\n{p.stderr[-1500:]}")
    return p


def probe(ff, src):
    """Width, height and duration as the picture is SHOWN (phone clips carry a rotation)."""
    p = subprocess.run([ff, "-hide_banner", "-i", src], capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    err = p.stderr
    m = re.search(r"Video:.*?(\d{2,5})x(\d{2,5})", err)
    if not m:
        sys.exit(f"error: {src} has no video stream ffmpeg can read.")
    w, h = int(m.group(1)), int(m.group(2))
    rot = re.search(r"rotation of (-?\d+(?:\.\d+)?)", err) or re.search(r"rotate\s*:\s*(-?\d+)", err)
    if rot and abs(round(float(rot.group(1)))) % 180 == 90:
        w, h = h, w
    d = re.search(r"Duration: (\d+):(\d+):(\d+\.\d+)", err)
    dur = int(d.group(1)) * 3600 + int(d.group(2)) * 60 + float(d.group(3)) if d else 0.0
    has_audio = re.search(r"Stream #.*Audio:", err) is not None
    return w, h, dur, has_audio


def _enable_cuda_dlls():
    """faster-whisper on Windows cannot see pip-installed CUDA libraries without this."""
    if os.name != "nt":
        return
    import glob
    import site
    roots = []
    for sp in site.getsitepackages() + [site.getusersitepackages()]:
        roots += glob.glob(os.path.join(sp, "nvidia", "*", "bin"))
    for r in sorted(set(roots)):
        if os.path.isdir(r):
            try:
                os.add_dll_directory(r)
            except OSError:
                pass
            os.environ["PATH"] = r + os.pathsep + os.environ.get("PATH", "")


def transcribe(wav, model, language):
    _enable_cuda_dlls()
    from faster_whisper import WhisperModel

    def go(dev, ct):
        m = WhisperModel(model, device=dev, compute_type=ct)
        segs, info = m.transcribe(wav, word_timestamps=True, vad_filter=True, language=language)
        words = []
        for s in segs:
            for w in (s.words or []):
                words.append({"w": w.word, "s": round(w.start, 3), "e": round(w.end, 3)})
        return words, info, dev

    t0 = time.time()
    try:
        words, info, dev = go("cuda", "float16")
    except Exception:
        words, info, dev = go("cpu", "int8")
    print(f"ok: heard {len(words)} words, language {info.language}, on the {'graphics card' if dev == 'cuda' else 'processor'}, {time.time() - t0:.0f}s")
    return words


def safe_zone_check(ff, video, st, phrases, outdir):
    """Grab a frame inside several captions and measure where the bright text actually is."""
    from PIL import Image, ImageChops
    os.makedirs(outdir, exist_ok=True)
    picks = phrases[:: max(1, len(phrases) // 5)][:5]
    margin = 90 / 1080 * st["play_w"] if st["shape"] == "vertical" else 0.05 * st["play_w"]
    lo, hi = margin, st["play_w"] - margin
    band = int(st["size"] * st["line_h"] * 1.3)
    good, frames = 0, []
    for n, p in enumerate(picks):
        t = (p[0][1] + p[-1][2]) / 2
        frame = os.path.join(outdir, f"frame-{n + 1}.png")
        run([ff, "-v", "error", "-y", "-ss", f"{t:.2f}", "-i", video, "-frames:v", "1", frame], "frame grab")
        frames.append(frame)
        im = Image.open(frame).convert("RGB")
        top = max(0, int(st["y"] - band))
        box = im.crop((0, top, im.width, min(im.height, int(st["y"] + band))))
        # Caption text is white or the highlight colour: some channel near full brightness.
        r, g, b = box.split()
        brightest = ImageChops.lighter(ImageChops.lighter(r, g), b)
        bbox = brightest.point(lambda v: 255 if v > 225 else 0).getbbox()
        if bbox and bbox[0] >= lo and bbox[2] <= hi:
            good += 1
    return good, len(picks), frames


def cmd_captions(a, src=None):
    ff = ffmpeg()
    src = src or a.video
    w, h, dur, has_audio = probe(ff, src)
    if not has_audio and not a.words:
        sys.exit(f"error: {src} has no sound, so there is nothing to caption.")
    st = captions.load_style(os.environ.get("GODSPEED_VIDEO_STYLE") or None, w, h)
    stem = os.path.splitext(src)[0]
    words_file = stem + ".words.json"
    if a.words:
        words = json.load(open(a.words, encoding="utf-8"))
        print(f"ok: reusing {len(words)} words from {a.words}")
    elif os.path.exists(words_file) and not a.listen_again:
        words = json.load(open(words_file, encoding="utf-8"))
        print(f"ok: reusing {len(words)} words from {words_file} (--listen-again to hear the clip afresh)")
    else:
        with tempfile.TemporaryDirectory() as tmp:
            wav = os.path.join(tmp, "audio.wav")
            run([ff, "-v", "error", "-y", "-i", src, "-map", "0:a:0", "-ac", "1", "-ar", "16000",
                 "-c:a", "pcm_s16le", wav], "reading the sound")
            print("listening to the clip (the very first time, this also downloads the speech model, 460 MB)...")
            words = transcribe(wav, a.model, a.language)
        with open(words_file, "w", encoding="utf-8") as f:
            json.dump(words, f, ensure_ascii=False, indent=1)
        print(f"ok: the words and their timings are in {words_file}; correct a word there and run again")
    if not words:
        sys.exit("error: no speech was heard in this clip.")

    phrases = captions.phrases_from_words(words, st)
    ass = stem + ".ass"
    with open(ass, "w", encoding="utf-8") as f:
        f.write(captions.build(phrases, st))
    print(f"ok: {len(phrases)} captions written to {ass} ({st['shape']}, {w}x{h}, font {st['font']})")
    if a.ass_only:
        return

    out = a.out or (stem + ".captioned.mp4")
    print("burning the captions into the picture...")
    with tempfile.TemporaryDirectory() as tmp:
        # A relative subtitle path, run from a folder without spaces or drive letters, keeps
        # ffmpeg's filter syntax away from Windows paths entirely.
        shutil.copy(ass, os.path.join(tmp, "captions.ass"))
        os.makedirs(os.path.join(tmp, "fonts"))
        shutil.copy(st["font_file"], os.path.join(tmp, "fonts", os.path.basename(st["font_file"])))
        run([ff, "-v", "error", "-y", "-i", os.path.abspath(src),
             "-vf", "subtitles=captions.ass:fontsdir=fonts", "-c:v", "libx264", "-preset", "slow",
             "-crf", a.crf, "-pix_fmt", "yuv420p", "-c:a", "copy", os.path.abspath(out)],
            "burning the captions", cwd=tmp)
    _, _, out_dur, _ = probe(ff, out)
    print(f"ok: {out} ({os.path.getsize(out) / 1e6:.1f} MB, {out_dur:.1f}s; the source was {dur:.1f}s)")
    good, n, frames = safe_zone_check(ff, out, st, phrases, stem + ".check")
    if good == n:
        print(f"ok: captions inside the safe zone in {good} of {n} sample frames ({os.path.dirname(frames[0])})")
    else:
        print(f"look: {n - good} of {n} sample frames did not measure clean. Bright picture near the captions "
              f"can cause that. Open the frames in {os.path.dirname(frames[0])} and look before you post.")


def cmd_vertical(a):
    ff = ffmpeg()
    w, h, dur, _ = probe(ff, a.video)
    stem = os.path.splitext(a.video)[0]
    out = stem + ".vertical.mp4"
    if w * 16 == h * 9:
        print(f"ok: {a.video} is already 9:16; nothing to crop")
        shutil.copy(a.video, out)
    else:
        # The middle strip of the picture at full height. A talking head framed in the
        # centre survives; anything at the left or right edge of the frame is cut off.
        vf = "crop='min(iw,ih*9/16)':'min(ih,iw*16/9)',scale=1080:1920:flags=lanczos,setsar=1"
        run([ff, "-v", "error", "-y", "-i", os.path.abspath(a.video), "-vf", vf, "-c:v", "libx264",
             "-preset", "slow", "-crf", a.crf, "-pix_fmt", "yuv420p", "-c:a", "copy", os.path.abspath(out)],
            "the vertical crop")
        print(f"ok: {out} (1080x1920, the centre of the {w}x{h} picture; check that nothing important was at the edges)")
    if a.captions:
        cmd_captions(a, src=out)


def main():
    ap = argparse.ArgumentParser(prog="mc-video")
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("captions", "vertical"):
        p = sub.add_parser(name)
        p.add_argument("video")
        p.add_argument("-o", "--out")
        p.add_argument("--words", help="use this words.json instead of listening to the clip")
        p.add_argument("--listen-again", action="store_true", help="ignore a saved words.json")
        p.add_argument("--model", default="small", help="speech model: tiny, base, small, medium")
        p.add_argument("--language", default=None, help="language code such as en or de; default: detect")
        p.add_argument("--ass-only", action="store_true")
        p.add_argument("--crf", default="17")
        if name == "vertical":
            p.add_argument("--captions", action="store_true", help="burn captions onto the vertical cut too")
    a = ap.parse_args()
    if not os.path.exists(a.video):
        sys.exit(f"error: there is no file {a.video}")
    if a.cmd == "captions":
        cmd_captions(a)
    else:
        a.out = None
        cmd_vertical(a)


if __name__ == "__main__":
    main()
