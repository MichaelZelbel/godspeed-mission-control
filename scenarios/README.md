# scenarios

Not for you: nothing here is a program you type, and no installer puts any of it on your computer.

These are the **proving scenarios** a candidate runs before the maintainer is asked for "go"
(godspeed-dev, `releases/godspeed-2.0.0-beta.8-faster-chat/plan.md`,
`releases/godspeed-2.0.0-beta.12-reminders-in-the-notebook/plan.md` and
`releases/godspeed-2.0.0-beta.13-charm-video-notebook/plan.md`, "Proving scenarios"). Each one
is one job of `.github/workflows/scenarios.yml` on a fresh `ubuntu-24.04` machine, and each is one
script here, so that what a scenario does can be read, run by hand and held to its own tests —
which a step written inside a workflow file cannot be. They live in a folder of their own for the
same reason `stage/` does: everything in `tools/` is copied onto every user's computer as a program,
and these are not programs for users.

| script | what it proves |
| --- | --- |
| `settings-on-install.sh` | a fresh install carries the faster-chat settings, and a value the owner set stays theirs |
| `night-tidy.sh` | the night chat tidy-up summarises the owner's chat and touches nothing else (not run on a candidate since 27 October 2026, when the tidy-up left 2.0.0-beta.8: no install gets it, so there is nothing to prove until the release that brings it back) |
| `voice.sh` | a voice note is understood and answered, with the ElevenLabs permission and without it |
| `update-keeps-everything.sh` | an update from the current public version keeps records, settings and the chat |
| `reminder-closed-elsewhere.sh` | a reminder closed on one computer is closed on the other, both ways of syncing, with no Git run by anyone |
| `reminders-move-keeps-everything.sh` | the move of the reminders into the notebook keeps every one of them and loses none of the old files (an update from the last version before that move, `BEFORE_THE_MOVE`, because the public version has it already) |
| `two-machines-move-at-once.sh` | two computers that move the same reminders before either syncs end with every reminder and every closing exactly once |
| `late-reminder-file.sh` | a reminder or a closing written the old way after the move is still taken in, once, and one changed on both sides waits as one review item |
| `closed-offline-on-both.sh` | one reminder closed on two computers while they were apart is closed on both, with two closing moments and no conflict |
| `reminder-from-settings.sh` | a reminder saved in Settings on a fresh install is a page in the notebook, is said at 08:00 and is in the brief's input |
| `charm-challenge.sh` | the Charm Challenge start to finish: started with the right end date, the one line the morning brief is given and the note the brief then wrote with it, a vent answered with the one question, "no" changing nothing, "yes" and "charm slip" starting over, and the card on the Trackers shelf saying the same numbers as the chat |
| `no-video-skills-by-default.sh` | a fresh install lists none of the video skills, the video add-on's own setup brings all of them, and `video-finishing` captions the add-on's sample clip |
| `update-removes-only-unchanged-skills.sh` | an update from the current public version removes a video skill only where Godspeed put it there unchanged: the one the reader changed stays, and an install with the video add-on keeps them all |
| `briefing-breaks-a-rule.sh` | a fresh install whose voice rules ban a word that a line the morning brief must carry contains still gets its morning briefing saved and delivered, without that line, and the problem reported as a repair item |

## How one is run

```
bash scenarios/voice.sh candidate/2.0.0-beta.8   the whole scenario, on a throwaway machine
bash scenarios/voice.sh --check <folder>         only the checking part, against a folder
```

The one argument is the stage ref: a branch or tag of this repository holding `stage.json`, which
is what the scenarios workflow is started with (`beta`, `main`, `candidate/2.0.0-beta.8`). Each
scenario installs the way a stranger does, through the one line the `linux-install` job runs
(`scenario-lib.sh` keeps it, character for character), and ends with exactly one line on its own
output:

```
PASS voice: a key that may transcribe had the voice note understood by ElevenLabs Scribe ...
FAIL voice: ELEVENLABS_TEST_KEY_STT is not in this job's environment, so ...
```

Exit 0 or 1, and the line is appended to the run's summary as well. Everything else it says goes to
the error stream, which is the step's log. **A scenario that cannot run fails**: a download that
failed, a secret that is not set, a routine that was never made. It never skips, because a run that
did not fail is read as "the candidate is proved".

## The two parts, and why

A scenario does the thing (install, act) and then judges what it found. The doing needs a throwaway
machine; the judging needs nothing but files. So the acting part writes what it saw into an
**evidence folder** as plain files — a settings file as it was, the routine's own log, the rows of a
conversation, what Settings answered — and the checking part reads only that folder. `--check` is
that second part on its own, which is how `scenarios/test-scenarios.sh` holds every scenario to one
prepared folder that should pass and one per failure it names, with no machine and no network. The
header of each script lists the files it keeps.

Settings files are read by a small reader of these scripts' own (`config_value` in
`scenario-lib.sh`), not by importing the product's own reader, so a scenario is never the change
checking itself.

## The keys three of them need

Named by the job, never in a file here:

| scenario | environment | what it is |
| --- | --- | --- |
| `update-keeps-everything` | `GODSPEED_SCENARIO_AI_KEY` | the owner's chat with the assistant needs an AI model; `GODSPEED_SCENARIO_AI_URL` and `GODSPEED_SCENARIO_AI_MODEL` say which |
| `night-tidy` | `GODSPEED_SCENARIO_AI_KEY` | summarising a chat needs one too; the same two say which |
| `voice` | `ELEVENLABS_TEST_KEY_STT` | a test key ElevenLabs lets transcribe |
| `voice` | `ELEVENLABS_TEST_KEY_NO_STT` | a test key it refuses that permission |
| `charm-challenge` | `GODSPEED_SCENARIO_AI_KEY` | the owner's own chat has to be answered by a model, because that is where a vent is noticed; the same two say which |

The six reminder scenarios need no key at all: everything they do is this machine's own. "Two
computers" are two installations on the one machine, each with its own mission control folder, its
own port (`GODSPEED_PORT`) and its own device identity, joined through one bare Git repository on
that machine standing in for the private GitHub repository, which Git is told to use for that
address. The product still checks the address is a private GitHub one, so the one thing they ask of
the network beyond the install itself is that api.github.com answers 404 for an owner nobody has.

`voice.sh` also takes `ELEVENLABS_TEST_VOICE_ID` (a public ElevenLabs voice by default) and sends
`voice-note.wav`, the short recording kept beside it. No chat account of any kind is needed: the
voice note goes through the two halves of the assistant that a voice note in a chat goes through.

The two video scenarios need no key either, and they ask one thing of the network beyond the
install: the video add-on's own setup fetches HyperFrames' pinned release, ffmpeg and the speech
model, because that is what a reader's setup does. They run it from the install's own carried copy
of the add-on (`mc_video_on`), so what runs is the commit the stage pins.

`charm-challenge.sh` is the one scenario that moves a clock. A twenty-one day count cannot be
watched starting over on one machine in one job while every day is today, so it sets `GODSPEED_NOW`
on the notebook's own service and starts it again, which is the product's own frozen clock for a
rehearsal (`notebook/core/tracker-operations.mjs`). It counts the days in UTC and says so if the
machine it runs on is not. It also reads each thing where the notebook itself holds it: the owner's
chat over the notebook's own chat, the line the morning brief is given through the same call
`core/briefing.mjs` makes, the morning brief itself run as Settings runs it (the routine turned on
and the notebook's own run of what is due) and the note it wrote, and the Trackers shelf's own list
and the card's own numbers. The day it runs the brief is the day the clock has moved to, so the
routine is due whether the install had made it already or not.

## Where they find the assistant, and its chat store

The assistant's settings and its chat store are in its own home, which is the one the install
recorded in `.godspeed/assistant.json`: `~/.hermes` on a stranger's machine, and
`.godspeed/integrated-runtime/hermes` only on one installed beside another assistant (`--beside`).
The scenarios read it from there after every run of a line (`assistant_home` in `scenario-lib.sh`)
and never name a folder by hand.

A fresh install has no chat store yet: the assistant makes `state.db` the first time it keeps a
conversation. So the two scenarios that seed a chat have the assistant keep one conversation of its
own first, through its own command and with the AI the scenario connected, and seed the chat beside
it (`assistant_keeps_a_conversation`).

## The other files here

- `scenario-lib.sh` — the part they share: the one verdict line, the install lines, the install's
  own paths, and the readers the checking parts use. For the reminder scenarios it also holds the
  per-computer forms of all of that (`due_on`, `sync_on`, `notebook_on`, `install_the_stage_line_into`,
  and `install_the_line_of_into` for one named version, the last one before the reminders moved into
  the notebook among them: `BEFORE_THE_MOVE`), the two stand-ins for the private GitHub repository -
  `stand_in_github`, which tells Git that the GitHub address leads to a bare repository here, and
  `stand_in_github_over_ssh` (an empty repository; the mission control carries the ignore lines itself) for a mission control that is its own repository, where the product
  reads the address back out of that repository and so has to be given a GitHub one - the `git` that
  writes down every call with the step it was made in (`git_calls_shim`), the readers of the
  notebook's reminder pages and closing moments, of the review queue a sync difference waits in
  (`reviews_of`, `conflicts/`) and of the notebook's own review queue a suggestion waits in
  (`queued_reviews_of`, `notebook/_system/review_queue/`), and the set of reminders the old version
  wrote (`seed_the_old_set`), which three of them start from. For the two video scenarios it holds the
  names of the video skills the release plan takes out of the default set (`VIDEO_SKILLS`, and
  `VIDEO_SKILLS_KEEP` for the ones about web pages and pictures, which stay), the reader's skills
  folder as a list of names (`skills_of`, `skills_present`, `skills_missing`) and the video add-on's
  own program as the install carries it (`mc_video_on`).
- `night-tidy-chat.mjs` — the assistant's own chat store, seeded, re-timed and read back. It writes
  the schema it finds (the newest row of a table is the template for a new one), and never invents
  the two tables the assistant owns.
- `stand-in-channel.py` — a stand-in for the assistant's control channel, for the one case a real
  assistant cannot show: a resume that answers with a different conversation.
- `voice-through-hermes.py` — a voice note through the installed assistant's own transcription, run
  with the assistant's own Python.
- `test-scenarios.sh` — their gate: `bash scenarios/test-scenarios.sh` from the root of a checkout.
