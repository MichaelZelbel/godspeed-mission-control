# Caption portability task report

Status: source fixes and real audio transcription/burn-in verified on this Windows host. Installed full embedded output and Linux execution remain unverified and belong to root acceptance.

## Behavior

- Video captions now has an explicit `--device cpu` choice. It retains a `.caption-render.log` showing actual FFmpeg/libass font selection. Original auto GPU/CPU behavior remains the default.
- Both recipe copies now include Archivo Black plus its OFL license. Select it explicitly with `--font-file fonts/ArchivoBlack-Regular.ttf` from the recipe folder. This changes the original Arial Black glyphs and is not an equivalent-looking replacement. No proprietary font was copied.
- Embedded captions now resolves the npm HyperFrames installation used by mc-video, built source checkouts, or an explicit HYPERFRAMES_ROOT. Shared recipe-local resolution supplies transcription, matting, rendering, sharp, Puppeteer and GSAP lookup roots. No installer or shared runtime changes.
- Embedded transcription refuses near-silent source audio before transcription or cached transcript reuse. Cached transcript reuse now rejects blank words, negative starts and reversed intervals. Spawn errors/timeouts can no longer be mistaken for successful WhisperX completion, and the underlying spawn error is reported.
- Both recipe copies are byte-equivalent for scripts. Bundled embedded fonts already use base64 WOFF2 faces, independent of installed Linux fonts; actual Linux browser font selection is not proved here.

## Actual execution evidence

Private retained evidence directory: `.superpowers/sdd/2026-10-03-godspeed-v2-completeness/caption-evidence/`.
`commands.ps1` records the exact synthetic speech generation, FFmpeg fixture construction, real recipe command, stream probe and frame extraction. It uses Windows SAPI to SPEAK fictional text into a WAV, then transcribes that AUDIO with faster-whisper. No transcript was supplied to burn.py. `dependencies.log` records isolated installation of recipe requirements in `caption-evidence/venv`.

The first real invocation used `--model tiny --font-file third-party/addons/mc-video/fonts/ArchivoBlack-Regular.ttf`; `burn.log` records 23 words, CUDA, 12.7 seconds, and a 347073 byte captioned MP4. The second invoked the new `--device cpu` flag against the same spoken fixture with a distinct output; `burn-cpu.log` records 23 words, CPU, 1.3 seconds, and a 349667 byte captioned MP4. Both files, original MP4, spoken WAV, ASS, transcript and receipt remain present. FFmpeg render receipt confirms `fontselect: (Archivo Black, 400, 0) -> ArchivoBlack-Regular, 0, ArchivoBlack-Regular`.

`stream-probe.json` records rendered video 9.083333 seconds, audio 9.102993 seconds; `source-stream-probe.json` records original durations for comparison. `verification.json` records all 23 spoken words matching transcription case-insensitively, valid timings 0 through 8.36 seconds and visible caption bounds x 281..802 at 3.5 seconds. The actual inspected `visible-3.5.png` shows A LITTLE RED / ROCKET FLIES with ROCKET amber and visible black outline/shadow. This checks a representative phrase transition against real computed audio word timings; it does not certify every audio alignment within 80 ms.

The initial verification assertion failed because tiny CPU lowercased the first spoken word. That probe is retained in `verify-initial-failure.txt`; comparison now ignores capitalization while preserving exact words/punctuation. The initial system Python probe found imageio_ffmpeg absent; isolated dependencies resolved it, with no account required. The unauthenticated Hugging Face download warning did not prevent transcription.

## Focused checks and self-review

`node --test notebook/test/caption-portability.test.mjs`: three passing checks for npm/source resolver priority, both bundled script copies and refusal of real generated silent audio even with a cached transcript. Test fixtures remain in OS temporary directories; no files were deleted. `node --check` passes for runtime/transcription scripts. `git diff --check` passes after correcting an EOF blank line. Tests and output are retained in `tests.log` and `diff-check.log`.

Review found source checkout-only runtime paths incompatible with the actual npm installer layout. The new resolver returns the installation root separately from its CLI path so browser/image dependencies keep resolving beside the package. The shell render entry exports that same root. Explicit roots have priority, source CLI paths have priority within a root. No root briefing changes were staged.

## Remaining acceptance and concerns

- Root must execute the installed full recipe entry points in its isolated installed workspace; this task changed the source recipe only. Root owns browsers, installed environments and packaging.
- Root must run actual Linux font/render acceptance. The bundled licensed font plus explicit selection removes dependence on Windows Arial Black; this host only proved Windows libass used the selected actual bundled font.
- Root must execute full embedded preparation, compile, strict timing/occlusion gates and browser render using fictional media with a visible face. Our flat speech fixture has no face, so it cannot legitimately pass that method's own prerequisite. Actual WhisperX forced alignment and the embedded matte/render chain were not executed here. No account/configuration requirement has been proved or asserted.
- Root should document the new CPU flag, bundled font selection and npm runtime support in owned documentation. No shared docs, server, dependency, installer or acceptance-matrix edits were made.
- The generated files are retained locally, ignored by repository policy. This report, exact commands and focused verification code are committed; root can include selected binary evidence if needed.
