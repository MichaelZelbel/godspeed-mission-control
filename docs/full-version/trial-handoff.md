# Godspeed Mission Control v2 handoff

4 October 2026. Complete Godspeed from main, with the integrated Menerio notebook, is installed separately for Michael to try. It remains a preview; main and the stable installer are unchanged.

## Start here

- Open this folder in VS Code or Codex: `C:/godspeed/work/trials/godspeed-v2`.
- Windows notebook: http://127.0.0.1:49175/dashboard
- Development VPS notebook: https://srv1069233.hstgr.cloud:48443/dashboard
- Windows download: https://github.com/MichaelZelbel/godspeed-mission-control/releases/download/godspeed-v2-integrated-2026-10-10-1/GodspeedSetup.exe
- Linux download: https://github.com/MichaelZelbel/godspeed-mission-control/releases/download/godspeed-v2-integrated-2026-10-10-1/install-godspeed.sh
- Source, manifests and checksums: https://github.com/MichaelZelbel/godspeed-mission-control/releases/tag/godspeed-v2-integrated-2026-10-10-1
- One-click Hostinger installation: https://srv1069233.hstgr.cloud/godspeed-install
- Separate branch: https://github.com/MichaelZelbel/godspeed-mission-control/tree/codex/godspeed-v2-completeness

## 10 October 2026 release: programming goes to a coding helper

`godspeed-v2-integrated-2026-10-10-1` installs product 1180348988a8df07923f16693dfd0a42cf99965a, main after the second edition's release. The Windows installer is built from the same kit-bootstrap c91da3a4aa2a1c71f123548ca1aaef08366dcf90, and the Linux and Mac installer takes its shared installer from that commit too.

What is new for a reader, since `godspeed-v2-integrated-2026-10-09-1`:

- The starter carries `.claude/agents/coder.md`, and its manual says programming goes to a coding helper (Claude Code: `coder`; Codex: `spawn_agent`; Hermes: `delegate_task`). The conversation keeps the mission control's context; the helper works, tests and commits only in the project under `dev/`, pushes only when the manual allows uploads, stops before anything outward, and reports back. Claude Code delegates to it by itself. An existing install gets the file when it runs this release's installer (the notebook's setup adds missing starter files); its own `AGENTS.md` is never replaced, so the manual's new line reaches it only through `setup/match-edition.md`.
- On Linux, a routine run written in the same instant as the notebook's first look is no longer skipped (the file clock can trail the system clock by a few milliseconds; the first look now allows two seconds). The one-click image of 9 October already had this fix.

## 9 October 2026 release: the book's second edition

`godspeed-v2-integrated-2026-10-09-1` installs product 92bd50ee5e5c7c2740be75945baa955ab4a0bed6, the head of `release/second-edition`, the version *Teach It Once* (second edition) describes. The Windows installer is built from kit-bootstrap c91da3a4aa2a1c71f123548ca1aaef08366dcf90 (branch `fix/second-edition-installer`, two commits on e62f38b): the notebook's own Hermes on Windows gets the mail tool, and the setup's Ready page says it installs Hermes. The Linux and Mac installer names the same product commit and takes the shared installer from that same kit-bootstrap commit; until this release it still took 180321a of 4 October, and the new one also installs GitHub's `gh` on Mac and Linux for Connect record sync.

What is new for a reader, since `godspeed-v2-integrated-2026-10-07-2`:

- The first goal starts the routines the book promises: "Daily round: choose today's work" at 05:30, "Daily round: do the work" at 10:00 and 16:00, "Deadline reminders" at 08:00, a "Weekly check-in" about the goal on Sundays at 18:00 and "Coach reminders and habit check". Settings > Routines says what each does and when it really runs.
- The notebook keeps people, facts and events, one page per person; every fact has one fixed name per kind, a newer value ends the older one, an undated fact gives way to a later dated one, and links between people and Mission Control's world claims are read.
- A computer signs in to GitHub from Connect record sync and checks its private repository; the mail add-on works on a computer and keeps its key there.
- A second device joins cleanly, the one-click setup's chat can join a mission control already on GitHub, and the server runs the routines.
- The weekly review and the research watch come with every new mission control; the assistant follows the notebook (collections, titled notes, only saved links), and the brief and the review read it.
- On Windows every kit command works inside the assistant's terminal (Hermes starts Git Bash without its path translation), and the daily round's recipe goes to Hermes on standard input, because it is longer than a Windows command line.
- The daily round runs on Linux, a Mac and the one-click server too: `mc-decide` and `mc-work-run` find `mc-run` in the notebook's own copy of the kit, where git leaves it without the executable bit (before this fix they stopped with "mc-run is not installed" unless an older `mc-run` sat in `~/.local/bin`, and on the one-click server none does).
- Hermes is set up for the notebook on every starter-born install (`wire-assistant`): `clarify` and `memory` are in `agent.disabled_toolsets` (in a one-shot notebook chat the clarify answer told the model to pick its own answer), Hermes' memory and user profile are off, `tools.tool_search.enabled` is `off` so the notebook's tools are called directly (about 6,000 tokens a request), and `cron.provider` is the `godspeed_notebook` plugin, Hermes' built-in ticker under another name, so its cronjob tool no longer warns that a routine will not fire until a gateway starts. The daily round's line for the reader is the round's "For you today", never a Hermes trailer; a round that did not finish, timed out or left a failed or unfinished work item delivers one line, once a day. The starter's manual names the research-watch recipe (it attaches itself to its routine, dates its results from the clock and keeps a record to compare with), `mc-watch` and `mc-subs` are installed with the original assistant, switching on the brief attaches the morning-brief recipe, the email skill reads the person's notebook page, a note's home is never the inbox, "Run now" answers at once, and the tools' tests drop the device's variables so they can never reach a real mission control.
- Smaller: `mc-due` reads and writes the mission control it is working in, a deadline file that cannot be read needs a look instead of counting as done, `mc-due help` and `mc-check-brief --help` print how to use them, Hermes' waiting lines are kept out of the notebook chat, earlier copies of packaged recipes are kept outside the recipes folder, the note graph is worked out from the notes again (the Lexicon is retired), and the bundled add-ons name the second edition's chapters.

The Hostinger one-click image is `v2-sha-c83b399` (digest `sha256:13232a9097a2c36024106ea0a5b99a4147bc7ded16f371faa9845053ef7cd061`, Integrated Godspeed v2 run 37994328875): this release plus two fixes made on main the same evening, the image builds pulling Docker Hub images through Google's mirror (Docker Hub refused GitHub's runners with 429) and a routine run written right after the first look no longer lost to the file clock. It is pinned in `docker/hostinger/compose.yaml` and `docker/hostinger/installer/compose.mjs` (commit 38791af), and the installer page on srv1069233 serves it.

## 7 October 2026, evening release: version 2 is main

`godspeed-v2-integrated-2026-10-07-2` installs product 3ab5037e1754e9e11d3ff69933b49edbc92532ad, the commit that made version 2 `main` (Michael, 7 October: "we do not need the v1 version of godspeed anymore"). It adds both review waves of 6 and 7 October (`docs/full-version/review-2026-10-06.md`), the Linux installer's HTTPS address on a server, and a notebook that no longer re-reads every note every 20 seconds to learn what changed. It is the repository's latest release, so the releases page and `releases/latest` give version 2. The Windows installer is built from kit-bootstrap e62f38b, whose update stops the notebook by checking what still runs (an update on Michael's laptop was cancelled that evening with the notebook already stopped). `install-godspeed.sh` at the top of the repository is now the release's installer, which `godspeedmissioncontrol.com/install` hands on; the development installer is `install-godspeed-dev.sh`. Version 1's nightly Windows build is retired (`retired/windows-installer-v1.yml`). The Hostinger image is still `v2-sha-b327fe0` from the morning release.

## 7 October 2026 release

`godspeed-v2-integrated-2026-10-07-1` installs product b327fe0963de2bfb333c8b514836271b523406cf: the review and fix wave of 6 to 7 October (`docs/full-version/review-2026-10-06.md`), plus a prompt scrubber that removes Telegram bot tokens and other common token shapes. The Windows installer is built from kit-bootstrap 39d91427605953d08f5f1486140ee17fa719c19a (branch `codex/godspeed-v2-native-integration`, the first-install fix). The Linux installer names that same product commit. The server and Hostinger image is ghcr.io/michaelzelbel/godspeed-mission-control@sha256:c3706e1c1e69d796a666c3682a4b5bb629749e5ab679d2c63e1683cf5f46344e (`v2-sha-b327fe0`), which passed the Linux install, upgrade and recovery test and the image tests in GitHub run 37556717097.

The previous Windows notebook on port 49171 is retained but is superseded. The new folder contains the complete original starter layout, AGENTS.md and CLAUDE.md, original tools, and skills discoverable by Claude and Codex. Its original operating manual is preserved. The integrated memory connection is named notebook, as required by the original Keep a Note skill. VS Code terminal settings point to the separate assistant installation. The fresh Windows notebook still needs a model account connected in Settings for its own web chat; opening it in Codex uses Codex's account.

## Original runtime restored

Godspeed conversations now use the original Hermes agent loop, tools, named sessions and conversation storage. Telegram runs through the original Hermes gateway, replacing the notebook's custom poller. Native conversation storage also removes the write collision reproduced in the earlier replacement storage; prior history files remain retained.

The notebook reads and controls Hermes cron directly. Goals, work and forecasts use the original commands and their original Markdown files. The replacement notebook planner and scheduler do not run in the shipped installation. Menerio's notes, collections, people, knowledge, timeline, media and review remain connected through the notebook and its MCP tools.

The Windows executable uses the original setup wizard and shared setup script, followed by the notebook connection. Linux uses the original shared native installer followed by the notebook service, with a separate assistant profile for a beside installation. Hostinger remains a separate one-click deployment using the checked integrated image.

The live original agent captured a fictional Menerio note, independently verified exactly once on disk. The installed notebook transport then found that note through the original agent's notebook search tool. Actual Hermes cron creation and pause succeeded in a separate retained fixture; it remains paused. On Windows, opening a formatted note still caused no save, and an authored edit survived reload. Both old installation payloads and configuration backups remain retained.

## What changed and was verified

The prior installer used a short allowlist that omitted many Godspeed starter folders and commands. It now installs every original starter file without overwriting user files. Complete-folder, preservation, assistant-connection and original-command checks passed. The native goal/work adapters continue to bridge the original Markdown files rather than replacing the operating manual.

The note editor previously saved on opening because its Markdown serialization removed a final newline. Comparison now ignores that normalization while preserving actual document changes. Opening a formatted note caused zero writes; typing saved successfully and survived reload. Toolbar formatting was reproduced failing with the first fix, corrected, and then saved successfully. Fictional test notes are confined to the isolated Windows trial.

The development and Windows runtime use product a2d4ca92d4223626f65de0897b4464e1fd224e02, bootstrap 180321af33ca98e7afbc572f993320290eb7466a. The native Linux notebook installer hook is pinned to 14736aa38648896707a9a30b146f530e3494e577. The server image is ghcr.io/michaelzelbel/godspeed-mission-control@sha256:f6435b3b93277c988de6e0b9a47abd12540f5db963f8bb7cac5297312e59e7a2. The exact image passed fresh installation, source checks and browser checks in GitHub run 37208120565. Hostinger uses that same immutable image. Documentation and package commits after the runtime pin do not change installed application code.

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
