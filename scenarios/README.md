# scenarios

Not for you: nothing here is a program you type, and no installer puts any of it on your computer.

These are the **proving scenarios** a candidate runs before the maintainer is asked for "go"
(godspeed-dev, `releases/godspeed-2.0.0-beta.8-faster-chat/plan.md`, "Proving scenarios"). Each one
is one job of `.github/workflows/scenarios.yml` on a fresh `ubuntu-24.04` machine, and each is one
script here, so that what a scenario does can be read, run by hand and held to its own tests —
which a step written inside a workflow file cannot be. They live in a folder of their own for the
same reason `stage/` does: everything in `tools/` is copied onto every user's computer as a program,
and these are not programs for users.

| script | what it proves |
| --- | --- |
| `settings-on-install.sh` | a fresh install carries the faster-chat settings, and a value the owner set stays theirs |
| `night-tidy.sh` | the night chat tidy-up summarises the owner's chat and touches nothing else |
| `voice.sh` | a voice note is understood and answered, with the ElevenLabs permission and without it |
| `update-keeps-everything.sh` | an update from the current public version keeps records, settings and the chat |

## How one is run

```
bash scenarios/night-tidy.sh candidate/2.0.0-beta.8   the whole scenario, on a throwaway machine
bash scenarios/night-tidy.sh --check <folder>         only the checking part, against a folder
```

The one argument is the stage ref: a branch or tag of this repository holding `stage.json`, which
is what the scenarios workflow is started with (`beta`, `main`, `candidate/2.0.0-beta.8`). Each
scenario installs the way a stranger does, through the one line the `linux-install` job runs
(`scenario-lib.sh` keeps it, character for character), and ends with exactly one line on its own
output:

```
PASS night-tidy: the routed chat went from 320 messages ... to 20 ...
FAIL night-tidy: the notebook never made the routine "Night chat tidy-up" on this install ...
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
| `night-tidy` | `GODSPEED_SCENARIO_AI_KEY` | summarising a chat needs an AI model; `GODSPEED_SCENARIO_AI_URL` and `GODSPEED_SCENARIO_AI_MODEL` say which |
| `update-keeps-everything` | `GODSPEED_SCENARIO_AI_KEY` | the owner's chat with the assistant needs one too; the same two say which |
| `voice` | `ELEVENLABS_TEST_KEY_STT` | a test key ElevenLabs lets transcribe |
| `voice` | `ELEVENLABS_TEST_KEY_NO_STT` | a test key it refuses that permission |

`voice.sh` also takes `ELEVENLABS_TEST_VOICE_ID` (a public ElevenLabs voice by default) and sends
`voice-note.wav`, the short recording kept beside it. No chat account of any kind is needed: the
voice note goes through the two halves of the assistant that a voice note in a chat goes through.

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
  own paths, and the readers the checking parts use.
- `night-tidy-chat.mjs` — the assistant's own chat store, seeded, re-timed and read back. It writes
  the schema it finds (the newest row of a table is the template for a new one), and never invents
  the two tables the assistant owns.
- `stand-in-channel.py` — a stand-in for the assistant's control channel, for the one case a real
  assistant cannot show: a resume that answers with a different conversation.
- `voice-through-hermes.py` — a voice note through the installed assistant's own transcription, run
  with the assistant's own Python.
- `test-scenarios.sh` — their gate: `bash scenarios/test-scenarios.sh` from the root of a checkout.
