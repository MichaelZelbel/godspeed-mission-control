# Morning Brief Setup (Chapter 21)

A briefing about your own week, built from your own files, waiting for
you before you start work. Two halves: write the recipe, then hang a
clock on it.

## Half one: the recipe (do this first, always)

In a session in Hermes, paste this:

```
Build me a morning brief. Write it as a skill, in
skills/morning-brief/SKILL.md. When it runs, it should read my
profile files, work out what today actually needs from my projects,
deadlines and people, and write the brief as a new file in brief/,
named with today's date. Under 200 words, plain words, no pep talk, no
invented facts. Where you do not know something, say so plainly.
When the brief tells me to do something, the step is one I can do
from my phone in a minute, and the full text I would copy is right
there in the brief; never send me to a file path. Before you write
the file, run mc-check-brief on it and fix whatever it refuses.
Then run it once so I can see today's brief.
```

The two new middle sentences are the delivery contract, and the check is
its enforcement: `mc-check-brief` (installed with this kit) refuses a
brief that sends you to a file instead of handing you the thing. A rule
in the recipe can be forgotten by a session; the check cannot. If the
command is missing, run this kit's installer again and it appears.

You get two things: `skills/morning-brief/SKILL.md` (the recipe) and
`brief/YYYY-MM-DD.md` (today's brief, for real).

Run it two or three more times in the same sitting: read what came out,
edit the skill file, run it again. The facts differ every morning anyway;
the shape is what you are training, and the loop works best while the
last run is still fresh in your head. Chapter 20's rule: no clock for a
recipe you have not watched run.

## One line worth stealing

Tony Stubblebine, the CEO of Medium, ends his own AI morning briefing
with every file he touched in the past 24 hours. The morning starts
with yesterday's thread back in your hand. Steal it: add one line to
`skills/morning-brief/SKILL.md`:

```
End with one short line naming which files in this folder changed in
the last day. If none did, say nothing.
```

Run the brief again and check the new closing line.

## Half two: the clock

One line, in a terminal, with your mission control's full path at the end:

```
hermes cron create "0 7 * * *" "Follow skills/morning-brief/SKILL.md and write today's brief as a dated file in brief/." --name morning-brief --workdir /path/to/your/godspeed
```

Hermes answers with the job's card: the id, the name, the schedule, the
workdir and the next run. Read `where-it-runs.md` for what each of the
four parts decides. The one people leave out is `--workdir`: it is the
folder the job runs in, and the only thing that hands the job your
`AGENTS.md`.

Then read the job's card. Its **Next** line is the machine repeating your
instruction back. On a laptop the job fires while Hermes is open; a 07:00
the app was shut for is written once, late, when you next open it (see
`where-it-runs.md`). For seven every day without thinking about it,
Chapter 28's server.

## Prove the clock, not just the recipe

Set a throwaway job three minutes ahead and watch it fire (verified
2026-09-02 on Hermes 0.21.0: created 00:56 for `59 00 * * *`, recorded at
00:59:38 with `source=builtin`, and a second dated brief in `brief/`):

```
hermes cron create "59 00 * * *" "Follow skills/morning-brief/SKILL.md and write today's brief as a dated file in brief/." --name clock-test --workdir /path/to/your/godspeed
hermes cron runs
hermes cron remove clock-test
```

`hermes cron run <name>` fires a job by hand; that proves the recipe and
nothing about the clock (`source=direct`).

## The off-switch

```
hermes cron list
hermes cron pause morning-brief
hermes cron resume morning-brief
hermes cron remove morning-brief
```

Pause takes it off the clock and says `Paused job: morning-brief`; resume
puts it back. Do it once today, so stopping is a reflex. `hermes cron
runs` lists every run with its source and time; `hermes cron incidents`
groups failures (first seen, last seen, the error, the output file), so
you read one entry rather than a log.

## Then the register

Tell your assistant the job is live ("the morning brief is now scheduled,
daily at seven, as a Hermes cron job on this computer; update the
register") and let it fill in the block in `procedures.md`: the rhythm,
where it lives, and the off-switch. Your house rules already say so, and
it has often done this already. One glance to confirm.

## Honesty notes

- No new subscription. A run costs what a conversation costs.
- Any frequency you like; no once-an-hour floor. A job fires within a
  minute or so of its slot.
- A missed slot runs once, late, when Hermes is back. A week away comes
  back to one brief, not seven.
- A scheduled job never asks. A dangerous command is refused, not paused
  for approval. A brief that only writes into `brief/` never needs one.
- The recipe is a file in your folder; the schedule lives in Hermes on the
  machine that runs it. That is why the register exists.
- The brief is written by an AI. Chapter 24's habit applies to it like
  everything else.
