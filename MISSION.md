# Mission

<!--
  Owner: humans only. This file is on the protected list; the factory cannot edit it.
  Written 2026-11-10 for the first trial of the factory on this repository. The out-of-scope
  list below is a proposal by Mission Control for the owner to strike or keep.
-->

**Derived from:** `README.md` (the product as readers install it) and the user guide at
https://godspeedmissioncontrol.com/guide
**Last reconciled with it:** 2026-11-10

## What Godspeed Mission Control is

A personal AI that runs on the person's own computer or server and works from one folder of plain
files they own: their goals, notes, people, deadlines and the routines it runs for them, including a
briefing every morning. It thinks with the person's own AI (their ChatGPT plan, or an API key from
Claude or another AI company) and keeps what it learns in that folder. It comes with a notebook (a
local web app), a chat on Telegram through an assistant program (Hermes), add-ons, and installers for
Windows, Mac, Linux and a Linux server in Docker.

Built in: one person per install, the person's own machine, the person's own AI account, and a
folder of plain files as the only truth. Free and open source, no account with the maker.

## Who it is for

- One person who wants an AI that knows their life and work, runs routines for them every day, and
  keeps everything in files they can read, correct and take with them. Many are readers of the book
  *Teach It Once*.

Godspeed is not a hosted chatbot, not a team tool and not an AI model.

## Core capabilities (in scope)

The factory may accept issues in these areas.

**The folder and its tools**
- goals, deadlines, forecasts, work items, decisions, rules and the tools in `tools/` that read and
  write them
- the morning briefing and its checks

**The notebook**
- notes, collections, people, world knowledge, timeline, media, trackers, settings, routines
  (`notebook/`)

**Chat and add-ons**
- the Telegram chat through Hermes, voice replies, the carried add-ons (`third-party/`), skills and
  recipes

**Install, update and recover**
- the installers (`install-godspeed.sh`, `installers/`, `docker/`, `server/`), updates that keep
  everything, recovery, the stage file and the proving scenarios (`scenarios/`)

## Out of scope: the factory must never build this

**Where it runs and who owns it**
- A hosted service with accounts on the maker's servers, or a login with the maker of any kind.
- Its own AI model, or AI access sold or resold through Godspeed. The person always brings their own.
- Telemetry, analytics or tracking that sends anything about the person or their use to the maker
  or to any party they did not connect themselves.

**What it may do on its own**
- Sending, posting, buying, booking, subscribing, paying, cancelling or any other outward or
  irreversible step without the person's explicit yes at that moment.

**What it is**
- A shared or team workspace: several people in one install, roles, sharing between users.
- Ads, upsells, paid tiers or anything that asks the person for money inside the product.
- Keeping the person's truth in a database or format they cannot read and take away. Plain files in
  their folder stay the source; any index or cache is rebuilt from them.

## Hard invariants: not tunable by any issue

1. **The person's folder is theirs.** Nothing deletes, overwrites or moves what they wrote without
   their yes; an update keeps everything, and old data is archived, not deleted.
2. **Their own AI, their own machine.** Godspeed works with the AI account the person connected and
   runs where they installed it.
3. **Nothing reaches readers before a release.** `main` reaches no reader (only developers who install it on purpose); only the release step,
   on the owner's go, moves a version to `beta`. The factory never touches `beta` or release tags.
4. **The factory cannot modify governance files.** `MISSION.md`, `FACTORY_RULES.md`,
   `engineering.md`, `AGENTS.md`, `CLAUDE.md` and `.archon/sdlc/policy/` are the constitution. A pull
   request touching any of them is an automatic reject.
5. **The factory cannot modify its own judge.** `harness/`, `.factory/` and `.github/` define what
   "working" means here. Adding an assertion is always welcome; removing or loosening one is a human
   decision, always.

## Allowed evolutions

- Bug fixes anywhere in the capability areas above, with a test that would have caught the bug.
- Tests, checks and the proving scenarios may be tightened freely.

## Definition of done

Every change the factory ships clears all three gates.

**Gate 1: static checks and tests pass.** `python harness/ci.py` (the scenario corpus), and on the
pull request the GitHub check `required`, which runs the product's whole suite.

**Gate 2: the user guide still tells the truth.** `node .github/guide-check.mjs` names the guide
pages a change affects; the newest commit says `Guide-Reviewed: none-needed (<why>)` when nothing a
reader sees changed. When a reader would see the change, the pull request says which page and the
owner updates the guide (the factory cannot reach the website repository).

**Gate 3: the end-to-end path passes as a real user.** See `harness/END-TO-END.md`.

1. Start the notebook on a fresh, empty folder.
2. Ask it whether it is healthy.
3. It answers healthy, with the version in `notebook/package.json`.

## Decision authority

Within this mission and its hard invariants, the factory manager decides ordinary product wording,
setup, scope and usability choices. It records its rationale in the issue or pull request and
continues delivery; an ordinary decision is not a reason to hold the merge for a human.

A human decision is required only for:

- an irreversible or outward action
- who may act as the person, including sign-in, credentials, keys, tokens and access to connected
  services such as the Telegram bot
- migrating, renaming or deleting data in the person's folder
- a release
- changes to the website user guide or the book
- a genuine personal preference that product evidence cannot resolve

Routine message, briefing and reply wording, and ordinary product usability, are factory decisions,
not permanently human decisions.

## Decisions

- 2026-11-14 **Who decides ordinary product choices?** Michael instructed the factory to decide
  ordinary product wording, setup and scope choices itself, record its rationale and continue
  delivery. Human gates remain only for irreversible or outward actions, credential or access
  decisions, data migration, rename or deletion, releases, guide or book changes, and genuine
  personal preferences.
- 2026-11-10 **Which models run the factory?** Claude only (Sonnet for small and medium steps, Opus
  for large ones), every step including review and the merge decision.
