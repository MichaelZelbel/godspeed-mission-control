---
name: video-captions
description: Burn timed captions into a supplied video using one maintained style, retain the original and transcript, and inspect the actual rendered result.
---

# Burned-in captions

One fixed style lives in `scripts/captions.py`, not a list of templates. Use this for captions and an explicitly requested vertical version, not to change the cut or choose a new composition. Read the current user's media and voice requirements before editing.

## Installed entry point

Run from this skill folder, with the user's actual video path:

```text
python scripts/burn.py clip.mp4
python scripts/burn.py clip.mp4 --ass-only
python scripts/burn.py clip.mp4 --words clip.words.json
```

The tool extracts audio, uses faster-whisper word timing, groups and wraps words, saves ASS subtitles and burns them using real FFmpeg. It retains the original and the word transcript. Reuse that transcript for another render rather than paying for or repeating transcription. `--ass-only` is an intermediate subtitle result, not a finished captioned video.

Dependencies are listed in `requirements.txt`. Pillow measures the actual font. imageio-ffmpeg supplies a real encoder; a real FFmpeg on PATH is the fallback. Faster-whisper is needed only for a new transcript; GPU libraries are optional and CPU transcription is supported. Do not call missing Python packages an account requirement.

## Style and font

The original fixed style uses Arial Black, size 80, amber active words, black outline 9 and shadow 4, vertical centre 1530, width 900 within a 1080 by 1920 frame, vertical lift 106 percent and a 190 ms ramp with acceleration 0.65. Preserve these values across a batch. A shot whose chest is elsewhere needs a deliberate position change in the maintained style and a rendered check.

Arial Black is used only when the user already has that licensed font installed. Never copy proprietary system fonts into the product. On another machine provide an explicitly selected licensed file with `--font-file` and, when necessary, its actual installed family with `--font-name`. The tool records the font override and style beside the video. Say when the font changes the appearance; never claim a substitute matches the original glyphs. The separately packaged mc-video caption style uses Archivo Black. State which method was used and never mix the two within one batch.

## Three layout rules

1. Each line is one string; libass controls word spacing. Per-word positioning from Pillow widths does not reproduce libass spacing.
2. Active emphasis changes colour and vertical scale only. Horizontal scale changes the advance width and makes neighbouring words jump sideways.
3. Inspect over actual video, including bright and skin-coloured regions. A black strip hides the black outline and cannot prove contrast.

## Verify the deliverable

Open the actual captioned video, listen to its original audio and inspect representative frames during phrase starts, active-word transitions, wraps and the ending. Check spelling and timing against what was said. Ensure a phrase's hold never overlaps the next phrase. At 1080 width captions and outline must stay within x 90 through 990; check rendered pixels and the platform button rail, not just font measurements. Do not measure every bright background pixel as caption text; compare equivalent uncaptioned frames or isolate the actual caption region.

The generated caption-style receipt records configuration, not visual acceptance. Retain the transcript, ASS, receipt and original, and save the frame/audio checks with the finished result. Output may not replace the input. Existing generated output requires explicit `--overwrite`; an uncertain render should be inspected before re-running.

Known limits: grouping uses punctuation, pauses longer than 350 ms, seven-word phrases and width rather than meaning; long clauses can split awkwardly. The fixed position does not fit every shot. Highlighting follows whole-word timings, not sub-word karaoke. Fix real observed defects without pretending an intermediate file is the final deliverable. Publishing requires separate authorization.
