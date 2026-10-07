# Godspeed chat

Reading this as: a personal notebook chat for Michael, in Operate mode, used on a Windows notebook and a private server. Vibe: familiar, calm, readable.

Brief: Michael asked for a normal Hermes, ChatGPT, or Claude style composer, with attachments, model and effort, dictation, playback, send and stop. The current node replaces repository and branch information. Preserve the existing notebook screens and their expand, collapse and separate-window behavior.

Plan v1: extend the existing notebook theme and components. Keep the conversation in the main area, with a bounded line length and a persistent composer below. The same component serves a full chat page and the expandable floating chat. Use the existing dark canvas, card and border tokens, blue accent and existing font. A flat layout suits an operating interface.

Calibration: avoid a grid of cards or decorative gradients. The supplied screenshot is the composition reference. The composer is the primary visual object, not a marketing headline. Keep the capability text limited to verified notebook context and attachments.

Desktop: header, scrollable transcript, current-note context strip, multiline field and controls. At narrow widths, the toolbar wraps into two rows; icon controls have 44px targets. The user can keep typing while a reply runs. Enter sends, Shift+Enter inserts a line, and composition input is respected.

Review changed: actual provider cancellation, accurate browser voice support, real attachment previews and errors, preservation of manual scrolling, and removal of unavailable web-reading claims.

Current limits: ten files and 20 MB per turn; readable PDF text up to 100 pages and 60,000 characters; image files and text documents. Scanned PDFs must be provided as page images. Dictation and read-aloud depend on the browser's speech APIs. Model choices come from the configured Hermes profile. Context retrieval is bounded keyword matching, not an attached vector database. The current node is included explicitly.

Validation: live Windows and server greeting responses; uploaded text-document answer; live stop behavior and a cancellation persistence test; source tests for 1,300-record retrieval and hidden-record filtering. Screenshots inspected in the desktop app. Physical phone and microphone hardware remain unverified.

Final checks on 2026-10-03: the full notebook test suite passed. Background synchronization waits for an assistant file save instead of crashing the Windows service. A reading question cannot apply unsolicited model-proposed edits to the current note. The isolated full-account migration preview also started with its complete note index.


## Note workspace layout

Reading this change as: an existing notebook workspace in Operate mode. Michael requested a collapsed main menu, collapsible note tree, Godspeed conversation in the middle, and the active note canvas on the right. Comments are hidden without deleting stored comments.

Plan v1: preserve the existing dark notebook theme and editor controls. Reuse the existing chat with saved history, actual cancellation, attachments, model choices and pop-out. Move its default note mode into the page flex layout, with one note title in the chat header and no repeated composer context. Remove role avatars from conversation turns. Opening chat collapses the main navigation; below 1,200px it also collapses the tree. Manual tree and menu toggles remain available.

Review: the supplied screenshots define the desired panel order. Avoid overlays because the note must remain available for reference. At phone widths, use chat above the document within the same viewport, with independent scroll areas and a smaller composer. Explicit pop-out remains available. Plan v2 follows that arrangement.

Review and installed verification: the independent review identified an overly wide chat at 1,280px and an unusable short-phone height allocation. The default note chat now starts at the smaller width; short screens retain 360px minimum chat and canvas heights with workspace scrolling. Message counts and shortcut text are omitted in the embedded header to leave space for the title. Touch header actions have larger hit areas. Existing editor controls remain available rather than moving them into a new menu.

Checked in the installed notebook: opening AI chat collapses navigation, the tree collapses and expands manually, switching notes restores that note's title and conversation, and pop-out opens the same note context before another message is sent. On narrow screens, returning to Notes reveals the tree again. Comments are omitted from the route while stored comments remain intact. Backend record/domain checks and the production UI build passed. The notification query now reads its supported record domain instead of returning an error.

The screenshot checker was adapted locally to clip line boxes to scrolling ancestors: offscreen transcript and editor text had been incorrectly reported as overlapping their headers. Physical-phone testing remains unverified.

Screen check completion: the final desktop confirmation reports no failures. Both phone layouts passed after the minimum-height repair, and reduced motion remained complete. The earlier count-contrast finding was repaired and verified in the desktop confirmation. Existing editor tap-size, app heading and private-page metadata warnings remain outside this layout change.

## Composer controls and dictation

Keep attachments, model, effort, microphone, playback and send on a single row. Model and effort selectors shrink within their column; action buttons retain 44px targets. Automatic effort is labeled Auto to preserve room. The speaker shows its enabled icon while reading and its muted icon when stopped.

Dictation records up to one minute with MediaRecorder, then inserts the transcript into the existing draft without sending it. A visible listening/transcribing status and permission errors explain what is happening. Hermes's installed local faster-whisper backend handles speech; no paid audio provider or browser SpeechRecognition service is used. Temporary recordings are deleted after transcription. Audio requests use the existing authenticated, same-origin API, with an 8MB limit and one transcription at a time.

Both installed HTTP services correctly transcribed the same synthesized spoken sentence. A separate Chrome check uses a synthetic microphone recording to exercise actual MediaRecorder upload and preserve the typed draft. Physical microphone and speaker hardware are not verified. The independent screenshot reviewer found no new toolbar usability defects.

Deployment: the server's optional faster-whisper 1.2.1 dependencies live in the persistent installation volume at /opt/data/full-candidate/stt-deps, installed with uv pip --target. The model cache lives inside the isolated Hermes home under stt-cache. Windows uses its existing Hermes dependency. The deployed helper and route are mounted alongside the other installation repairs.
