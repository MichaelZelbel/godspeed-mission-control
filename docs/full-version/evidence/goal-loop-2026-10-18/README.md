# Goal loop on a fresh install with a real AI, 18 October 2026

What: `notebook/test/acceptance/goal-loop-wsl.sh` on a Windows PC, which makes a fresh WSL Ubuntu 24.04
(systemd on) and runs `goal-loop-inside.sh` in it. Product commit
`2a003323840e364249b2f7efa17256fde2dc88ca` (branch `release/beta-2026-10-18`), installed by that commit's
own `install-godspeed.sh` with its pins pointed at that commit, kit-bootstrap `11daa48`. The AI:
OpenRouter, model `qwen/qwen3.7-flash`, connected through Settings > Your AI (`POST /api/provider`), run by
Hermes in every step. No Claude Code on the machine. Fictional goal: "Write the first draft of my short
story The Lighthouse Keeper", weekly number "words in drafts/lighthouse-keeper.md | total | wc -w ...".

Run it again (from Git Bash on Windows with WSL 2, the commit pushed to GitHub):

```bash
export OPENROUTER_TESTS_API_KEY=...        # an OpenRouter key kept for tests
bash notebook/test/acceptance/goal-loop-wsl.sh --commit <full commit> --model qwen/qwen3.7-flash
```

## What it showed (second run; the first never got past Settings, see below)

| step | result | where |
|---|---|---|
| install of the commit | finished in 5 minutes; the notebook answered on its own port and was checked to be this install's | run.log |
| installer's last words | named Hermes "already signed in" although a fresh Hermes only has its example model under provider "auto"; fixed after this run (the ending now reads Hermes as Settings does) | install-tail.txt |
| Settings > Your AI | Hermes' config got `provider: "openrouter"`, `default: "qwen/qwen3.7-flash"`, the key in its .env; the check through Hermes answered "Connected" | run.log |
| first goal, from the notebook | 7 routines started (paused for the test); weekly number named and the first day's reading (0) told through the notebook | run.log, observed.md |
| research, dated 2026-10-10 | ran 4 minutes with Hermes' web tools (15 searches, 5 pages read) but wrote no people, cases or claims, so the founding check failed and a gap file says so | run.log, observed.md |
| decision, dated 2026-10-10 | real decision (11 minutes), 3 steps with bets on the weekly number: one the person's (a freewrite), two the mission control's own | run.log, observed.md |
| work | the mission control's two steps were done in the decision run with real tool use (files in made-by-the-work/) and VERIFIED by their own checks on 2026-10-10. The run's own line says FAIL because the harness followed the first bet, the person's step; the harness now follows the first step the mission control does itself | observed.md |
| reading told in the notebook today | READ 0 on 2026-10-18, as the Goals page sends it | observed.md |
| settle, today | mc-goals wrote: the person's step never-live, the two own steps flat (0 -> 0) | observed.md |
| next decision, through Hermes' own daily-round routine | decision for 2026-10-18 written; settle.txt carried the three verdicts; its scoreboard reads them back ("template created but contributed zero words") and it turns to the person's first freewrite as a cheap experiment | observed.md |
| Goals page from the install | not read: the run ended before it (below) | |

How the second run ended: the harness file was edited while it was running, and bash, which reads a
script as it goes, stopped with a syntax error during the last step, at 14:53 UTC; the distro was
removed with it. The harness is now one function read whole before it starts. What the last step had
written by then was read from the distro before that and is in observed.md.

The first run (14:01 UTC) found that WSL 2 distros share one network: 127.0.0.1:47831 in the fresh distro
was another distro's notebook, which answered the install's health check and took the Settings request
(the test key with it). The harness now gives its notebook a free port and checks it is its own before
sending anything.

## Cost

OpenRouter test key: $0.556 before, $0.075 after the second run. Research about $0.07, the first decision
about $0.21, the next decision about $0.21 (Hermes sends the long next-action recipe and every tool
result again with each turn). A complete run with this model needs about $0.55 of credit.

## Later runs the same day, with a free model (release preparation)

The test key was empty, so these ran on an OpenRouter key of the maintainer's with the free model
`nvidia/nemotron-3-super-120b-a12b:free`, from Git Bash with the distro's disk on another drive (the
PC's system drive was full). Each run's log is in `free-model-runs/`; run 6 also keeps the goal card,
its research, the work cards and both days' decisions. Every product fault a run found was fixed on
`release/beta-2026-10-18` before the next run.

| run | product commit | how far it got | what it found, and what changed |
|---|---|---|---|
| 1 | 77e2303 | research, then stopped by hand during the decision (the PC's disk had filled up) | the research found 29 people, 5 cases, 10 claims and 8 openings and wrote each as one bullet line (`- [Name](link) - WHY: ...`), so the files counted 0 and the night failed: the research recipe and each file now show the one-field-a-line form, `mc-goals research <id> --tidy` puts other shapes into it (mc-research runs it after each run), and `mc-check-research` names records it cannot read. The decision also filed a check `grep -c ... >= 5`: `mc-work file` now refuses that, and checks the shell cannot read or that test nothing (`test -ge 900`) |
| 2 | f35819e | connecting the AI in Settings | one `HTTP 502: Provider returned error` failed the connection: a passing 429, 502, 503 or 504 is now tried twice more |
| 3 | 298ae89 | the whole way round, every check ok, exit 0 | the research wrote its records in form (34 people, 5 cases, 11 claims, passed with `--fetch`); the decision's own step was done by `mc-work-run` and verified by its check; settle wrote `worked: 0 -> 500`; the next decision through Hermes' routine named the verdict; the Goals page showed it. Two harness faults: the commands on the PATH (mc-research, mc-decide, work.js, ...) were the last release's, because kit-bootstrap installs them from the product's default branch, and the verdict line was lost (exit 0, no `ACCEPTANCE PASSED`) |
| 4 | 0a12688 | the install | the new check of the commands read the copy of the product as root and git refused it: corrected |
| 5 | 11d2354 | every step; FAILED at the work | the work wrote the notes its item asked for under "### Economy of Language" and the item's check grepped `'Economy of language'`, so it stayed attempted: the work run is now told to run its item's CHECK before answering and to finish the work (never the check) until it passes |
| 6 | f184859 | every step; FAILED at the work | the decision put all three of its own steps on the ship list (NEEDS authorization), so nothing ran: the harness now has the person answer "ship all", which reaches the register as the next-action recipe says (`mc-work unblock --approved-by`) |
| 7 | 8c596e8 | research passed (30 people, 5 cases, 10 claims); the decision could not start | OpenRouter's free-model daily limit for the account was used up (`HTTP 429 ... free-models-per-day`), until 00:00 UTC |
| 8 | 8c596e8 | stopped by hand during the research | the one paid run allowed, `qwen/qwen3.7-flash`: with the new recipe its research worked properly (39 people, 16 claims in form after 10 minutes) but cost $0.26 in those 10 minutes, so a whole run would have passed its $0.75 cap |

Across runs 3, 5 and 6 every step of the loop passed on a fresh install, with the commit's own
commands from run 5 on, but not yet all in one run of the final harness: that run is still to come.

## Cost of the later runs

The free model's own calls cost nothing. The key's usage still rose by about $0.09 over runs 1 to 7
(the key also runs other jobs, and Hermes calls something besides the model; not identified), and by
$0.26 in the paid run 8: about $0.35 in all.

## Still to run with a real AI

One complete run of the final harness on the final commit, ending with `ACCEPTANCE PASSED`. With the
free model it fits in the account's free daily limit once that has reset (a run makes a few hundred
requests); with qwen/qwen3.7-flash, now that its research really works, budget about $1.50.
