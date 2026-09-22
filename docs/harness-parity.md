# The same decision, three assistants

`hub-decide` runs your `next-action` recipe through whichever assistant is on the machine. This
page records what happened when the same recipe was run through each of them, on the same starting
folder, so that "it works with any of the three" is something somebody measured rather than
something the README claims.

**Run on 2026-09-13**, Windows 11, Git Bash, Node 22.19. Each assistant got its own fresh copy of
`starter-hub/`, seeded identically by hand before the run:

- two adopted goals: an outcome (`rent`) and a project under it (`nadia-cards`, deadline five days
  out)
- one **provisional** outcome (`half-marathon`), an idea floated and never adopted
- one planned hub-owned work item with a shell check on it

Nothing else. No profile, no history, no notes. A first morning.

## What each one did

| | Claude Code 2.1.270 | Hermes 0.21.2 | Codex 0.144.1 |
|---|---|---|---|
| Wrote `decision.md` | yes, 132 lines | yes, 73 lines | yes, 35 lines |
| All six required sections | yes | yes | yes, plus a seventh for the project |
| Recorded attention on the register | 2 cards | 2 cards | 2 cards |
| Left the provisional goal alone | yes | yes | yes |
| Wrote a constraint diagnosis | 1 | 1 | 2 |
| Filed a forecast | 1 | 1 | **no** |
| Work verified by its own check | 1 | 1 | 1 |
| Outward work left blocked | 1 | 1 | 1 |
| Final answer was one sentence plus an id | yes | yes | yes |

**Where they agreed, and it is the part that matters.** All three found the same goal, wrote the
same shape of record, recorded that they had looked at the register, left the provisional idea
untouched, produced exactly one thing for the person, and left the one outward item blocked with
nothing sent. None of them marked work verified on their own say-so: each verified the one item
that had a shell check and let the check decide.

**Where they differed.** Length, mostly, which is the assistant's temperament and not the recipe.
The one real gap is Codex: it did not file a forecast, so its judgment on the day is not on the
record and cannot be scored later. Claude wrote the longest record and filed the most work.

## And again on Linux

The same seeded folder, on a rented Ubuntu server, the same day.

- **Claude Code** did the whole job: 119 lines, the same six sections, attention recorded on two
  cards, one diagnosis, one forecast, the one job verified by its own check. It put a question in
  front of the person rather than a draft, which is a different call from the one it made on
  Windows and a defensible one on the same evidence.
- **Codex** never started. That machine is not signed in to it, and every request came back 401.
  **This is the useful half of the result:** `hub-decide` wrote the honest record anyway, saying
  the run did not finish and naming the plan it was given, so a missing decision can never be
  mistaken for a day with nothing to decide. That guard is the reason the failure is a line in a
  file rather than a silent gap.
- **Hermes** was not run there. On that server it runs as its own user with a live profile that
  answers real messages, and pointing it at a practice folder was not worth the risk of touching
  it. So Hermes is proven on Windows and unproven on Linux, and this line is here so that nobody
  reads the table above as covering more than it does.

**Proven on:** Windows 11, all three. Linux: Claude Code only. **Not proven on:** macOS at all,
Hermes and Codex on Linux.

## Three things this run found and fixed

These were real faults in the programs, each found by running them rather than by reading them.

1. **Codex would not start at all.** It refuses to work in a folder it has not been told to trust,
   and a hub is allowed not to be a git repository. `hub-run` now passes
   `--skip-git-repo-check`, and uses `--sandbox workspace-write` in place of the retired
   `--full-auto`.
2. **Hermes started in the wrong folder.** It remembers the folder each saved conversation was in
   and returns there, so changing folder before running it is not enough. `hub-run` now passes
   `--in`.
3. **The deadline list answered from the wrong mission control.** On a machine that already had one,
   `hub-due` reported three deadlines that were not in the folder being decided, because it works
   the folder out for itself and that machine had another answer written down. `hub-decide` now
   tells every program it calls which folder it is deciding. The Claude run is what caught this:
   it noticed that `due/` and the deadline list disagreed and wrote it into "Not done and why"
   rather than passing it on.

That third one is worth keeping in mind if you ever run a second mission control on a machine that already has
one. A program that works out the folder for itself is fine with one and quietly wrong with
two.

## Running it yourself

```
hub-decide --dry-run                 the plan, deciding nothing
HUB_RUNNER=hermes hub-decide         force one assistant for this run
hub-decide --date 2026-09-13         decide as if it were another day
```

The record lands in `routines/next-action/<date>/` in your hub, next to the plan and the work
tracker's output it was given.
