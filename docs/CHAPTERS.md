# Chapter map

One row per chapter that uses the kit. Status: **ready** = verified and final for the current draft; **building** = the chapter is in production and the asset lands with it.

> **Renumbering (2026-07-26).** The book was restructured files-first. Every row below carries the
> new chapter numbers, and the old numbering is gone from this file.

> **Part III flip (2026-07-30).** Part III now runs app-first: Chapter 10 has the reader build a
> Skill with the app's own form and take it apart; Chapter 11 moves the master copy into the
> reader's folder (interview, naming, packaging, upload); the old Chapter 14 is gone, absorbed
> into Chapters 10 and 11. Chapters 12 to 14 are the old 11 to 13, one number up. The two
> "building" rows wait on the real runs marked [REAL RUN NEEDED] in the manuscript.

> **Renumbering (2026-08-19, Batch AA).** The developer detour became Chapter 5, and every later
> chapter moved one up. The rows below carry the new numbers, the Part VI rows were also one
> behind since Batch W's insert and are now correct, and the two installer chapters (3 and 26)
> gained the rows this file always owed them. The dated notes above keep the numbering of their
> own day.

> **Renumbering (2026-08-20, Batch AB).** A new Chapter 11 ("Be Nice to the Database", the
> psychology chapter) closes Part II, and every chapter from the old 11 up moved one up. It has
> no kit file. In the same sweep, every kit file OUTSIDE this map had its chapter references
> resolved by content: most still carried pre-AA numbers, some pre-W, because earlier sweeps
> only kept this map current. The dated notes above keep the numbering of their own day.

> **New chapter (2026-08-27, Batch AF).** A new Chapter 32, "Keep an Eye on This for Me", closes
> Part VI before the tour, so the tour is now Chapter 33 and exactly one number moved. This map
> still carried the tour as 32 until 2026-08-28, which is the row a later batch fixed while it
> was here for something else.

> **Renamed (2026-08-25, Batch AE).** Chapter 11 is now "The 21-Day Charm Challenge" (it was
> "Be Nice to the Database"), and the counter inside it runs twenty-one days, matching Will
> Bowen's original challenge. Still no kit file, so the table below still has no row 11.

> **The switch to Claude Code (2026-08-30, Batch AJ).** The book now puts the reader on the
> desktop app's **Code** side from Chapter 3 to the end, not Cowork. The app shows two buttons at
> the top left, **Chat and Cowork** and **Code**, and only the second reads the reader's folder:
> Cowork sources its skills, plugins and connectors from the claude.ai account. Measured the same
> day, in three folders differing in one way only: a recipe as a loose file in `skills/` did
> nothing, and the same recipe as `.claude/skills/<name>/SKILL.md` answered in the reader's own
> shape without being named. So `starter-hub/skills/` became `starter-hub/.claude/skills/`, the
> starter gained `CLAUDE.md`, and rows 12, 13, 17 and 20 to 23 change with it. Row 3 goes back to
> **building** until the trust dialog is captured on a cold machine. Plan of record:
> `hub/projects/teach-it-once-claude-code-switch-2026-08-30.md`.

> **Part V moves to Routines (2026-08-30, Batch AJ parts 8 to 14).** The clock lives in the Code
> side's sidebar now: **More**, **Routines**, **New routine**, then **New local routine** or
> **New remote routine**. Every label the book prints was read out of the installed build's own
> string table (`ion-dist/i18n/en-US.json`, `Claude_1.40609.0.0`) before it went on the page, and
> two of those readings contradicted the plan. **A local routine cannot be saved without a working
> folder**, which retired Chapter 23's "attach no folder" instruction and gave the watchdog a file
> to write into. **The editor refuses a sub-hourly schedule for local routines as well as cloud
> ones**, so Chapter 21's once-an-hour footnote did not split; it now names both places the app
> enforces it. Chapter 26 gained a third door, `.mcp.json` in the folder, verified live from a
> Code session with no connector panel touched. Rows 9, 21 and 23 go to **building** until their
> real runs are done. Evidence:
> `ownward-studio/company-memory/book/chapter-verification/ch09-20-33-routines-from-the-app-string-table-2026-08-30.md`.

## Parts I to V (restructured, final)

> **The day's decision (2026-09-13, D-208).** The three registers behind a morning choice
> (`goals/`, `forecasts/`, `work/`) and the programs that read them now ship here, with the
> `next-action` recipe and the two programs that run it. The hub they came from installs them from
> this kit rather than keeping a second copy. Harness parity evidence: `docs/harness-parity.md`.

> **The numbers below are older than the manuscript, and the manuscript is the authority
> (noticed 2026-09-13).** The book was retitled and restructured after this map was last swept, so
> most rows here carry a chapter number and a title from before that. They are not off by a
> constant, so they cannot be fixed by adding one. The rows added on 2026-09-13 carry the
> manuscript's CURRENT numbers and titles, which is why they do not line up with their neighbours.
> Sweeping the rest is its own job and is not done here.

| Chapter | Kit asset | Status |
|---|---|---|
| 1. What Your AI Already Knows About You | `profile/bring-your-context-with-you.md` (the export prompt), `profile/about-you-template.md` (fallback only) | ready |
| 3. Give It Hands and a Folder | `HubSetup.exe` on the Releases page, and the `kit-bootstrap` one-line installer; both lay down `starter-hub/`, now including `starter-hub/CLAUDE.md` (the `@AGENTS.md` signpost), the visible `starter-hub/skills/` room and `starter-hub/.mcp.json` | building |
| 4. The Folder Is the System | `starter-hub/` (the rooms, including the visible `starter-hub/skills/`, `starter-hub/observations/` and `starter-hub/prompts/library/` + `starter-hub/prompts/archive/`); the ceiling note at the foot of `starter-hub/AGENTS.md` | ready |
| 5. The Workshop Inside Your Hub | `starter-hub/dev/README.md`, `starter-hub/.gitignore`, `starter-hub/CLAUDE.md` (the one-line signpost the chapter explains; the installer's `.claude/skills` link is the chapter's "one room, two doors") | ready |
| 6. The People Who Matter | `profile/people-interview.md` | ready |
| 7. Projects and Priorities | `profile/projects-interview.md` | ready |
| 8. Your Voice | `profile/voice-extraction-prompt.md` | ready |
| 9. Capture as You Live | `profile/capture-checklist.md`, `starter-hub/observations/MEMORY.md` (the notebook the assistant keeps) | building |
| 10. Keeping It True | `profile/mirror-test.md`, `profile/spring-clean-checklist.md` | ready |
| 12. One File, and It Steps Forward | `skills/practice-texts.md`; the reader builds `skills/summarize-for-me/SKILL.md` by hand in the visible room | ready |
| 13. Own the Recipe | `skills/skill-interview.md`, `skills/practice-texts.md` (`skills/package-a-skill.md` removed 2026-08-30: there is no upload to package for) | ready |
| 14. Your First Five Skills | `skills/first-five-skills.md` plus the five recipes beside it in `skills/` (NOT in `starter-hub/`: the reader's visible `skills/` room ships empty on purpose). `answer-email-my-way.md` gained the file-reading sentence in rule 1 and the `[CHECK]` allowance in rule 5 on 2026-09-02, after a real run showed why | ready |
| 15. Skills for Your Craft | `skills/craft-skill-interview.md`, `skills/strip-ai-tells.md` (a finished craft skill to read and steal from, not produced by the chapter) | ready |
| 16. Test Like a Pro | `skills/skill-test-checklist.md` | ready |
| 17. The Red Lines | `procedures/red-lines-template.md`, `procedures/red-lines-interview.md`, `tools/compile-rules.js` (installed as the command `hub-compile-rules`, never into the hub) | ready |
| 18. The Safety Net | `procedures/safety-net-setup.md` | ready |
| 19. Private Things Stay Private | `living/privacy-audit-checklist.md` (rewritten 2026-09-02 for Hermes: the transcript and the distillation are on the reader's disk, `hermes sessions stats`, `hermes memory status`, `hermes mcp list`) | ready |
| 20. The Clock Changes Everything | `procedures/procedure-register.md`, `starter-hub/procedures.md` | ready |
| 21. The Morning Brief | `procedures/morning-brief-setup.md`, `procedures/where-it-runs.md` (both rewritten to `hermes cron` 2026-09-02, on a job the builtin ticker fired on the test server) | ready |
| 21. The Morning Brief, second half: "Decide the morning, not just describe it" (manuscript numbering) | `starter-hub/goals/README.md`, `starter-hub/forecasts/README.md`, `starter-hub/work/README.md`, `skills/next-action.md`, `tools/goals.js` + `tools/forecast.js` + `tools/work.js` (installed as `hub-goals`, `hub-forecast`, `hub-work`), `tools/hub-run`, `tools/hub-decide`, `tools/hub-cards.js`, `docs/harness-parity.md`. Gates: `tools/test-goals.sh`, `tools/test-forecast.sh`, `tools/test-work.sh`. Run live through all three assistants on a fresh reader hub before the section was written | ready |
| 22. The Weekly Review That Runs Itself | `procedures/weekly-review-setup.md` (the clock is `hermes cron`, 2026-09-02), `procedures/outside-ai-check.md` (the monthly branch), `procedures/ai-subscription-review.md` (the second monthly branch, read from `hermes insights` since 2026-09-02) | ready |
| 23. Watchdogs | `procedures/watchdog-setup.md` (a `hermes cron` job with `--workdir`, writes into `watch/product-watchdog.md`; the worked example ran for real 2026-09-02) | ready |
| 24. Trust, but Verify | `living/two-questions-card.md`, `living/the-alternatives-card.md`, `procedures/keys-that-expire.md` (the "prove a check by breaking it" section at the end of the card) | ready |

## Part VI (restructured, final)

All optional. The book works without every row below.

> **Chapter 23 rewritten (2026-08-13).** Menerio is taught as the notebook notes are born in,
> never as a copy of the profile folder. `menerio/folder-to-memory.md` (the import prompt, the
> "change it in the folder first" rule and the quarterly re-import) is removed, replaced by
> `menerio/the-notebook.md`. Chapter 24's stranger test now runs on captured notes.

> **`menerio/ai-memory-transport.md` and `menerio/interview-transfer.md` have no chapter row on
> purpose.** They are the Menerio-specific versions of the same move. The general one, which works
> with no extra product at all, is Chapter 1's `profile/bring-your-context-with-you.md`. Restored
> 2026-08-09: the 2026-07-26 files-first renumbering left Chapter 1 holding only the FALLBACK
> template, so the kit taught the reader to fill a folder by hand while the prompt that empties
> their old AI into it sat in a folder nothing pointed at.

| Chapter | Kit asset | Status |
|---|---|---|
| 25. When the Folder Outgrows Itself | `menerio/the-notebook.md` | ready |
| 26. One Memory, Every Tool | `menerio/mcp-connection.md` (door one is `hermes mcp add` since 2026-09-02, verified against the live server; `.mcp.json` is Claude Code's door, and Hermes does not read it), `tools/notebook-sync.py` (sends the visible `skills/`, and an older hub's `.claude/skills/`) | ready |
| 27. Install Your Hub on Every Machine | `HubSetup.exe` on the Releases page, the printed `setup-hub.sh` line, `procedures/keys-that-expire.md`, `tools/check-keys.js` (installed as the command `hub-check-keys`), `starter-hub/secrets/expires.txt` | ready |
| 28. The Always-On Server | `server/install.sh` (the one pasted line: root installs Hermes for the `ai` account, sets `terminal.cwd` before the system gateway, hands over; the account signs in by device code, fetches an existing hub or starts a fresh one, then creates or checks its private GitHub home before any scheduled work), `server/create-private-repo.sh` (first commit, private create, push, remote-branch check, GitHub privacy check, safe retry after an incomplete first push), `server/test-create-private-repo.sh` (real local commits, remote and push; GitHub create/privacy replaced locally), `server/install-hermes.sh`, `server/steps/build-the-server.md`, `server/setup.md`, `server/three-traps.md`. `server/brief.sh` deleted 2026-09-02: the morning brief is a Hermes cron job. The base server path ran end to end twice on 2026-09-02. The private-repository addition shipped on 2026-09-05 with two defects its local test could not see, both found and fixed the same evening on a fresh Ubuntu 24.04 (WSL, systemd on, Windows paths off): the privacy check asked GitHub from the account's home instead of the hub and stopped every install, and Hermes' own installer needs a C++ compiler that the `ai` account cannot install, so root now installs `build-essential` first. Also that evening: the Hermes install log is kept, a fresh hub is pushed as `main`, the register line is pushed too, and the closing text names the account for each command (`su - ai`, `cd hub`, `hermes`; `hermes gateway setup`; `systemctl restart hermes-gateway` as root, because `ai` has no sudo). Fresh-hub path run end to end with the fixes on 2026-09-05 (private repository created, first commit pushed, GitHub confirms private, morning brief scheduled). Later the same evening, on Michael's call, the morning brief became opt-in: the installer asks `Put the morning brief on this server's clock (y/n) [n]` before the Hermes half, schedules and registers only on yes, and says so in its closing text; `KB_MORNING_BRIEF=yes|no` skips the question. From his read of the chapter: the repository question now offers the two cases in plain words (join a hub you have, or start the first machine), the notebook question says Menerio (kit-bootstrap v2.4.1, the server pins moved from v2.4), and no installer text names a chapter number. | ready |
| 29. Your Assistant on Telegram, with Hermes | `server/open-the-door.sh` (the chapter's second pasted line, as root: Tailscale, the three basic-auth lines, `hermes dashboard` as a system service on the private address, the `/api/status` check; run on 2026-09-05 with `DOOR_HOST` in place of Tailscale, the page asked for its password), `server/install.sh`, `server/install-hermes.sh`. Telegram is connected on the web page's **Channels** form (Hermes' dashboard docs: "full parity with `hermes setup gateway`"), the Hermes app through **Settings > Gateways > Remote gateway**; `hermes gateway setup` stays as the terminal road (the wizard was opened and read on 2026-09-05, the Telegram end not driven). Michael, 2026-09-05: no editors and no config files in this chapter. | building |
| 30. The Swap Test | `swap/opencode.json`, `swap/three-questions.md`, `swap/openrouter-notes.md` | ready |
| 31. Your Saved Prompts, Anywhere | `living/saved-prompt-card.md`, `starter-hub/prompts/README.md`, `starter-hub/prompts/library/README.md`, `starter-hub/prompts/archive/README.md` | ready |
| 32. Keep an Eye on This for Me | none (prose; the two reader prompts are public at querino.ai) | ready |
| 33. The Thing With a Last Day | `procedures/what-runs-out-and-when.md`, `tools/due.js` (installed as the command `hub-due`), `starter-hub/due/README.md` | ready |
| 34. A Tour of My Hub, and the Road On | none (prose) | ready |

## Back matter

| Chapter | Kit asset | Status |
|---|---|---|
| Appendix C. What You Get, In Order | `living/build-order-card.md` | ready |
| Appendix D. The Hub Folder Layout | `starter-hub/` itself; the `goals/`, `forecasts/` and `work/` rows were added 2026-09-13 | ready |

New 2026-09-02 (batch AK, the Hermes switch): `starter-hub/skills/` is back as the visible
skills room. It vanished on 2026-08-30 when its `.gitkeep` moved into `.claude/skills/`, which
pointed every non-Claude assistant at an empty folder; the starter no longer ships a real
`.claude/skills/` at all, because the installer creates that path as a link to the visible room
and two real folders is the master-and-copy problem this batch exists to kill.
`starter-hub/AGENTS.md` teaches the visible room and gained the 20,000-character ceiling note.
`install-hub.sh` and `server/install.sh` consume the immutable `kit-bootstrap` tag `v2.0`.
`server/brief.sh` is deleted: the morning brief is a Hermes cron job created by
`server/install-hermes.sh` with `--workdir` (the one thing that injects `AGENTS.md` into a
scheduled run) and `--deliver telegram`, and that script stopped setting `workspace`, a key
Hermes never read, in favour of `terminal.cwd`, which it does. Rows 28 and 29 go to building
until their chapters are rewritten against the new shape.

Batch 5 of the same switch (2026-09-02): Chapters 4 and 5 rewritten. The starter README stops
saying that "different tools look for house rules under different names" (Hermes reads
`AGENTS.md` by name; the signpost is Chapter 5's business) and stops claiming five recipes are
pre-loaded in `skills/` (that room ships empty; the five live beside it in the kit's own
`skills/`). The ceiling note in `starter-hub/AGENTS.md` was rechecked against Hermes 0.20.6's
source: 20,000 characters is a floor that scales with the model, and a truncation now leaves a
marker in the gap and a warning, so "no error and no log line anywhere" came out. Rows 4 and 5
carry the new assets and Chapter 5's real title. Evidence:
`ownward-studio/company-memory/book/chapter-verification/ch04-05-hermes-and-the-developer-door-2026-09-02.md`.

Batches 6 and 7 of the same switch (2026-09-02): Chapters 12 to 16 teach skills from the visible
`skills/` room, and every Part III kit file says `skills/<name>/SKILL.md` where it used to say
`.claude/skills/`. The three-folder experiment (no recipe, a loose recipe, a recipe as
`skills/<name>/SKILL.md`) was re-run through Hermes 0.20.6 on a fresh profile and came out as
the chapters teach it, so rows 12 and 13 go to ready. `answer-email-my-way.md` changed after a
real run: Hermes followed it to the letter, read only the file the recipe named, and marked its
guesses; the recipe now names `people.md` and `projects.md` in rule 1, and rule 5 allows the
`[CHECK]` marks it had been forbidding. The README's install line names Hermes, not Claude Code.
Evidence:
`ownward-studio/company-memory/book/chapter-verification/ch12-16-skills-from-the-visible-room-2026-09-02.md`.

Batch 8 (2026-09-02): Chapter 17. `procedures/red-lines-template.md` stops saying the `CLAUDE.md`
pointer is what puts the rules in the room: Hermes reads `AGENTS.md` by name, the signpost is
for Claude Code, and the developer note points at Chapter 5 instead of describing `CLAUDE.md`
precedence. The grenade instructions now say to run the PELICAN test first. Evidence:
`ownward-studio/company-memory/book/chapter-verification/ch17-red-lines-on-hermes-2026-09-02.md`.

Batch 9 (2026-09-02): Chapters 19 and 26. `living/privacy-audit-checklist.md` rewritten: the
transcript is one SQLite store per profile and the distillation two text files, both on the
reader's disk, so drawers two and three are commands and files rather than Settings screens, and
drawer four is the model provider plus `hermes mcp list`. `menerio/mcp-connection.md`: door one
is `hermes mcp add memory --url https://mcp.menerio.com` (verified live on 0.20.6: `Connected`,
58 tools), door two stays Claude Code's line, door three's `.mcp.json` is named as Claude Code's
door because Hermes never reads it. `tools/notebook-sync.py` sends the visible `skills/` and
falls back to an older hub's `.claude/skills/`, test-first (16 passed). Evidence:
`ownward-studio/company-memory/book/chapter-verification/ch19-26-drawers-and-doors-on-hermes-2026-09-02.md`.

Batch 10 (2026-09-02): Chapters 20 and 21. `procedures/where-it-runs.md` and
`procedures/morning-brief-setup.md` rewritten for `hermes cron`: the clock lives inside the
gateway, `hermes cron status` says in one line whether jobs will fire, nothing is ever caught up,
`--workdir` is what hands a job its `AGENTS.md`, a hand run proves the recipe and not the clock,
and jobs never ask. The Routines form, the once-an-hour floor, the seven-day catch-up and the
Keep-computer-awake setting are gone with the Claude app. Row 21 goes to ready on a job the
builtin ticker fired on the test server (`source=builtin`). Evidence:
`ownward-studio/company-memory/book/chapter-verification/ch20-21-the-clock-on-hermes-2026-09-02.md`.

Batch 11 (2026-09-02): Chapters 22, 23, 32, 33. `procedures/weekly-review-setup.md`,
`procedures/watchdog-setup.md` and `procedures/ai-subscription-review.md` rewritten: the weekly
clock is a `hermes cron` line with a weekday; the receipts are `hermes insights --days 30` (the
author's own cost section printed, fifty cents metered, seventeen sessions on the subscription); the
watchdog is a `hermes cron` job whose worked example ran for real and found, among seven dated
items, that Hermes 0.21.0 approval-gates writes to `AGENTS.md` and skills. Rows 22 and 23 to ready.
Evidence:
`ownward-studio/company-memory/book/chapter-verification/ch22-23-32-33-receipts-and-watchdogs-on-hermes-2026-09-02.md`.

Batch 13 (2026-09-02): Chapters 27 and 28. `server/install.sh` rewritten on the shared Hermes
primitives (kit-bootstrap v2.3): root installs the tools, the `ai` account and Hermes for it,
writes `terminal.cwd` BEFORE installing the gateway as a system service (the gateway bridges
that setting once, at startup), and hands over; the account signs in by device code, answers
one question (which repository) with GitHub by code, runs the same `setup-hub.sh` as the
laptop with `--sources hermes`, puts plain keys in `~/.hub-env`, runs `install-hermes.sh`
(ceiling, folder proof, morning brief on `hermes cron` with `--workdir` and `--deliver
telegram`, no user gateway beside a system one), appends the register block, and prints
what only the reader can do (`hermes gateway setup`, one system restart). Run end to end twice on
the test server; the second run is what Chapter 28 quotes. Two defects the first run found,
fixed test-first: the library read its deny list back with `grep -q` on a pipeline under
`pipefail`, which races (exit 141 when grep quits early) and printed a false "the leash is
NOT on" over eighteen stored, enforced rules (`kb_hermes_list_has`, v2.3); and the register
check matched the starter's own `## Morning brief` example inside a comment. Also fixed: the
by-hand script's closing block printed a second time under the installer. The prompt log
(`tools/hub-prompt-archive`) now reads a Windows Hermes: `HERMES_HOME`, the default profile's
`state.db` at the root of it, desktop and cli sessions as the person's; entries say
`tool=hermes` with a `channel`. On the author's machine that turned 69 invisible prompts into
archived ones. One deviation, on purpose: the kit's two quiet jobs (prompt archive, notebook
sync) stay on the machine's own scheduler, not on `hermes cron`, because they must run
whether or not a gateway is up. `server/setup.md`, `server/README.md`, `steps/build-the-
server.md` and `three-traps.md` rewritten for the Hermes build.

Batches 14 and 15 (2026-09-02): Chapters 30, 31 and 24. `swap/opencode.json` names the notebook
server `notebook`, the name Hermes knows it by (Chapter 26); `swap/three-questions.md` carries the
three answers from the 2026-09-02 run (OpenCode 1.18.3, Kimi K3 through OpenRouter, Sam's folder,
the recipe read from the visible `skills/` room); `swap/openrouter-notes.md` prices re-read live
(K3 unchanged, the sibling a little lower); `swap/README.md` says OpenCode and Hermes both read
`AGENTS.md` by name and Claude Code needs the `CLAUDE.md` signpost. Chapter 24's two cards under
`living/` carry no tool-specific wording and are unchanged; the chapter's dialogue was re-run on
Hermes (ChatGPT plan prices, then "Now check it").

Batches 16 and 17 (2026-09-02): the DevOps pair and the book's frame. Two new repositories carry
Hermes watching Hermes: `hermes-self-devops-watchdog` (public; the operator is a second Hermes
profile, the shell floor is fetched from its one upstream at a pinned commit and hash-verified, a
self-check probes the healer every five minutes, alerts go through `hermes send`) and
`hermes-self-devops-kit` (private; the premium kit forked with the operator swapped). Run 10 on the
test VPS found and fixed: the floor restarted a gateway that had no messaging platform yet (fixed
upstream on branch `floor/no-platform-guard`, pinned), Windows checkouts shipping CRLF shell (both
repositories force LF and the build strips CR), and file modes. The book's front matter names one
ChatGPT subscription and the tested platforms; Appendices C and D follow the Hermes chapters;
Chapter 30 gained the swap inside Hermes and the fallback ladder. Chapter 34 waits for Michael's
yes on his live hub. Nothing in this kit changed for these batches beyond this note.

Michael's answers (2026-09-02, morning): no screenshots from him, ever; the live hub configured
for Hermes with every agent in the book still working (`windows/setup-hub.ps1` from kit-bootstrap
run on `C:\hub`: Hermes reads `C:\hub\.claude\skills`, works in `C:\hub`, eighteen deny rules;
the production hub profile's `skills.external_dirs` points at its clone's `.claude/skills`); a
fresh Menerio account for the book's fixtures made by the session itself, seeded with Chapter 25's
four notes, so Chapters 25, 26 and 30 agree; the Leanpub upload is the session's job, through the
Leanpub API, after the book is green. Pins move to kit-bootstrap **v2.4**: the hidden skills doors
(`.claude/skills`, `.agents/skills`) are ignored and untracked by git when they are links, found
while configuring the live hub (a Windows junction looks like a folder to git, and a committed
hub would carry two copies of every recipe).

New 2026-08-29 (batch AH, "the thing with a last day"): `procedures/what-runs-out-and-when.md`
(the window instead of a due date, the four questions, the self check, the cap of three a day),
`tools/due.js` plus its `tools/hub-due` launcher, and `starter-hub/due/README.md` so a brand new
hub carries the room from day one. It reads `starter-hub/secrets/expires.txt` as one of its
sources, so a reader's key dates are in the same list as everything else and only one thing nags
them. Row 33 is new and the tour moved from 33 to 34; nothing else was renumbered. The card says
in its second paragraph that no Google account is needed for any of it, because a reader who
thinks they need one stops reading there.

New 2026-08-28 (batch AG, "a key has a life, not just a home"): `procedures/keys-that-expire.md`
(the expiry record, the delivery check, the nagging ladder and the break-it-to-prove-it drill),
`tools/check-keys.js` plus its `tools/hub-check-keys` launcher, and
`starter-hub/secrets/expires.txt` so a brand new hub carries the record from day one rather
than after an upgrade. The installer (`kit-bootstrap`) writes the same file into an existing
hub the moment it gains a locked store, so the two roads arrive at the same folder. Rows 24
and 27 above gained the card; no chapter was renumbered.

Removed 2026-07-26 (R8): `living/one-month-plan.md`. Founder decision D-047 cut the one-month plan
from the book: nothing in the reader's text states a total duration for building the system. The
replacement card carries the same build order measured in sittings and in what the reader has at
the end of each one, with no days, weeks or months anywhere on it.

Removed 2026-07-26: `people-brief-template.md` (then in `context/`, now `profile/`), superseded by
`profile/people-interview.md`.
Removed 2026-07-26 (R4b): `skills/skill-library-template.md`. The folder is the library now, so a
separate master-copy document has nothing left to do. What survived of it (naming rules, the
master-copy habit) moved into Chapters 10 and 14.

Rewritten 2026-07-26 (R5): `procedures/red-lines-template.md` (now eight rules, and the install
step that was missing), `living/privacy-audit-checklist.md` (folder drawer added, Claude's real
screens), `starter-hub/AGENTS.md` (honesty rules 6 to 8). New: `procedures/safety-net-setup.md`.

Rewritten 2026-07-26 (R6): `procedures/procedure-register.md` (the register is now `procedures.md`
in the reader's own folder, not a document kept somewhere), `procedures/morning-brief-setup.md`
(recipe first, then Claude's Scheduled tasks, against the folder), `procedures/weekly-review-setup.md`,
`procedures/watchdog-setup.md` (cloud watchdog, plus the connectors-are-hands boundary),
`starter-hub/procedures.md` (the empty template row moved inside a comment, so it can never be
mistaken for a real procedure), `living/two-questions-card.md` (the half-right trap).
New: `procedures/where-it-runs.md`, the local-versus-cloud rule that decides what any procedure can
touch.

New and rewritten 2026-08-09 (batch T, "the folder that does not start empty"):
`starter-hub/prompts/library/README.md` and `starter-hub/prompts/archive/README.md` (the two
drawers, seeded and self-explaining; the library is not `skills/`, and the archive carries the
honest limit that Claude Desktop keeps no local conversation store to harvest),
`starter-hub/AGENTS.md` (the never-load-`prompts/` rule),
`profile/bring-your-context-with-you.md` (the four wording fixes: ask for a file, say what to do
when it runs long, ask for prompts by job rather than by count, and ban keys outright; plus filing
into `prompts/library/` rather than `skills/`), `procedures/outside-ai-check.md` (new, the monthly
question carried inside Chapter 20's weekly review), `starter-hub/observations/MEMORY.md` (the example
row moved inside a comment after a cold run left it sitting in the list like a real memory, the
same defect R6 fixed in `procedures.md`).

Rewritten 2026-07-26 (R7): `menerio/README.md` and `menerio/mcp-connection.md` (the connector
panel moved to **Customize**, and the app's dialog has no header field, so the token goes in the
URL), `server/README.md`, `swap/README.md`, `swap/openrouter-notes.md` (prices re-read live; the
unit is tokens, not words, and the budget sibling is about a quarter of the price, not a third).
New: `menerio/folder-to-memory.md` (the folder is the import source, not the chat history),
`server/setup.md`, `server/brief.sh`, `server/three-traps.md`, `swap/opencode.json`,
`swap/three-questions.md`.
Removed: `swap/opencode-config.example.jsonc`, replaced by a real `swap/opencode.json` that can be
copied straight into a folder.

Published 2026-09-02 (Hermes edition): manuscript at ownward-studio `73825d7`, Leanpub `teachitonce`
published 07:05 UTC, A4 239 pages. Chapter 9 now prints a real pocket capture (Telegram from a desk,
and the gateway's API door) landing in `inbox/` on the test server; the kit is unchanged by it. The
installers pinned kit-bootstrap v2.4 then; since installer v2.3.1 (2026-09-04) they pin **v2.7** (a second hub can sit beside the first with --beside; -Hub finally works on Windows; and the Windows .exe pins a tag now, so both platforms fetch exactly the code their installer was built from).
