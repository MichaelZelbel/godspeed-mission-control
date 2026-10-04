# Godspeed Mission Control v2 handoff

4 October 2026. Complete Godspeed from main, with the integrated Menerio notebook, is installed separately for Michael to try. It remains a preview; main and the stable installer are unchanged.

## Start here

- Open this folder in VS Code or Codex: `C:/godspeed/work/trials/godspeed-v2`.
- Windows notebook: http://127.0.0.1:49175/dashboard
- Development VPS notebook: https://srv1069233.hstgr.cloud:48443/dashboard
- Windows download: https://github.com/MichaelZelbel/godspeed-mission-control/releases/download/godspeed-v2-integrated-2026-10-04-4/GodspeedSetup.exe
- Linux download: https://github.com/MichaelZelbel/godspeed-mission-control/releases/download/godspeed-v2-integrated-2026-10-04-4/install-godspeed.sh
- Source, manifests and checksums: https://github.com/MichaelZelbel/godspeed-mission-control/releases/tag/godspeed-v2-integrated-2026-10-04-4
- One-click Hostinger installation: https://srv1069233.hstgr.cloud/godspeed-install
- Separate branch: https://github.com/MichaelZelbel/godspeed-mission-control/tree/codex/godspeed-v2-completeness

The previous Windows notebook on port 49171 is retained but is superseded. The new folder contains the complete original starter layout, AGENTS.md and CLAUDE.md, original tools, and skills discoverable by Claude and Codex. Its original operating manual is preserved. The integrated memory connection is named notebook, as required by the original Keep a Note skill. VS Code terminal settings point to the separate assistant installation. The fresh Windows notebook still needs a model account connected in Settings for its own web chat; opening it in Codex uses Codex's account.

## What changed and was verified

The prior installer used a short allowlist that omitted many Godspeed starter folders and commands. It now installs every original starter file without overwriting user files. Complete-folder, preservation, assistant-connection and original-command checks passed. The native goal/work adapters continue to bridge the original Markdown files rather than replacing the operating manual.

The note editor previously saved on opening because its Markdown serialization removed a final newline. Comparison now ignores that normalization while preserving actual document changes. Opening a formatted note caused zero writes; typing saved successfully and survived reload. Toolbar formatting was reproduced failing with the first fix, corrected, and then saved successfully. Fictional test notes are confined to the isolated Windows trial.

The development runtime and newest Windows/Linux packages use product 285682a1442625ca1968d9bda9f86c9452d96671, bootstrap 0d10f08a02599c79d1c86b27f0cd03f64d72c731. The server image is ghcr.io/michaelzelbel/godspeed-mission-control@sha256:fb4298da94ea8c340a19afb03d6c5897f55d40ad245ffe14cb36f57fdc0096b3. The exact image passed fresh installation, source checks and browser checks in GitHub run 37205678679. Hostinger uses that same immutable image. Documentation and package commits after the runtime pin do not change installed application code.

The development host was verified as srv1069233, reached at 100.73.52.50. Only its owned integrated notebook and installer coordinator were updated. Existing data and media volumes, prior images, installers, configuration copies and recovery copies were retained. A fresh protected backup verified all 5,960 record files and 8,789 backup files before correction; the same protected record bytes remained intact before the subsequent image update. The local trial and all new artifacts are under C:/godspeed. No work on E or access to production was performed in this correction session.

## Limits

Mac acceptance, paid Hostinger checkout, a separate end-to-end run of the new Linux download adapter and actual two-week personal outcomes remain unverified. The underlying fresh server image and generated Compose configurations were checked. Historical review entries without complete undo evidence refuse Undo; inherited unsupported suggestion kinds report an error. Comprehensive release and recipe matrices retain incomplete entries. Optional video workflows were not expanded as a requirement for this correction. This handoff does not claim exhaustive absence of bugs or authorize production migration or retirement of live Menerio.

Earlier detailed evidence and retained failures remain in v2-progress.md and C:/godspeed/work/artifacts/2026-10-03-godspeed-v2.

## Final download verification

The final GitHub release was downloaded again into C:/godspeed/work/artifacts/2026-10-03-godspeed-v2/github-final-reader-downloads. All four payloads matched their published SHA256SUMS. The direct Windows and Linux URLs returned successful public HEAD responses. The installed Windows record file independently contains both typed text and toolbar formatting; the original notebook MCP capture also remains present exactly once. Development container health is healthy, and both development and local dashboards and the Hostinger installer page return HTTP 200. Main remains 136dcacef66a03a69560bdf5bd80ea3ea3e4c5b3 and stable latest remains v2.18.0. No main or stable/latest updates were made.

## Telegram reply correction

The development bot is @ClaudeTestOpsDoggy3Bot, verified against Telegram getMe. A real incoming message was saved but remained attempted without a reply. The background sync writer held the workspace lock during synchronous Telegram persistence; both success and error persistence could throw, and the next poll then skipped the attempted request. Focused tests reproduced this failure before correction and passed afterward.

Telegram persistence now waits for the writer. Failed conversations produce a bounded owner reply instead of silence, interrupted requests do not repeat their actions, and uncertain sends are never replayed. The exact published image passed GitHub installation/source/browser checks and was installed only on srv1069233. A separate fictional fixture exercised the deployed Telegram class with the real configured model, an injected competing writer and a real send to Michael through the existing bot. Telegram accepted the model-generated confirmation, its receipt was verified, and another poll did not send it twice. This test did not replay Michael's failed request or import his real data into its fixture. Evidence: live-telegram-reply-verification.log and deploy-telegram-replies.log under the retained artifact folder.

The Windows folder on port 49175 retains its working note-editor installation at edb7e046e856a86ac32a28d2fb3b38bcd9246b46; it was not restarted to repair the VPS bot. New installer downloads include the Telegram correction. Existing packages, images, data and configuration backups remain retained. Main and the stable/latest channel remain unchanged.

The Telegram-repaired release godspeed-v2-integrated-2026-10-04-4 was downloaded again into github-telegram-repair-downloads. All four payloads matched SHA256SUMS. The development container is healthy, its HTTPS health and Hostinger installer return 200, main remains 136dcacef66a03a69560bdf5bd80ea3ea3e4c5b3, and stable latest remains v2.18.0.
