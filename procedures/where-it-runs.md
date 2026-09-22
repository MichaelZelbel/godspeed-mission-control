# Where It Runs (Chapters 21 and 22)

The one mechanical fact that decides what every procedure in this book
can do. Read it once, and the rest of Part V stops being confusing.

## The rule

**A job fires only while Hermes is running on that computer. Close it and
nothing runs. Open it again and anything overdue runs once, late, and then
goes back to its schedule.**

The clock lives inside Hermes itself. On your own computer that is the
Hermes app: with the window open, your jobs fire; quit it, and nothing
fires until you open it again. On a server it is the gateway, the part of
Hermes that runs in the background as a service. There is no cloud kind
and no "remote routine": your jobs run where Hermes runs, and read
whatever folder that machine holds.

## A missed slot runs once, late

Measured on a laptop (2026-09-04, Hermes 0.20.6 on Windows 11): a
two-minute job fired on time while the app was open, about ten seconds
after each slot. With the app quit for ten minutes, five slots passed and
nothing ran. On reopening it ran once, straight away, then went back to
its two minutes. A daily job whose hour passed while the app was shut ran
four minutes after the app came back, then set itself for the same time
tomorrow. Once, not once per missed slot: skip a week and you come back
to one brief, not seven.

## One warning about `hermes cron status`

Hermes has a second part called the gateway, which connects it to
Telegram and the other messengers (Chapter 32), and `hermes cron status`
reports on the gateway. On a laptop it answers, in capitals, that cron
jobs will NOT fire. It is telling the truth about the gateway and nothing
about the app in front of you: it printed that sentence at the same
minute the app fired two jobs on time. On a server where the gateway runs
as a system service, it is the line to read. On a laptop, believe the job
card.

## Living with that

- **A desk machine that stays on, with Hermes open.** Then every morning
  is a morning.
- **A laptop you close at night.** The promise is "written at seven on
  the mornings Hermes is open at seven, and when I open the lid on the
  others", not "it runs while I sleep".
- **The grown-up answer.** A small server of your own that never sleeps,
  with Hermes' gateway as a system service and its own copy of your
  folder. That is Chapter 32, and every job you build on your laptop moves
  there unchanged.

## The desktop screen

Hermes Desktop shows the clock as a screen called **Scheduled jobs**, with
a **New cron** button and a form (Name, Prompt, Frequency, Deliver to,
Model), a job card with **Trigger now**, **Pause** and **Resume**, and a
**Manage** menu holding **Edit cron** and **Delete**. Chapter 22 walks
that screen, driven for the book on 2026-09-04. A job made there runs in
the folder Hermes was pointed at, but arrives with no house rules unless
the prompt says so, so every prompt starts with "Read AGENTS.md at the
top of this folder and follow it."

## The four parts of a cron line (the typed twin, for a machine with no screen)

```
hermes cron create "0 7 * * *" "Follow skills/morning-brief/SKILL.md and write today's brief as a dated file in brief/." --name morning-brief --workdir /path/to/your/godspeed
```

- **Schedule.** Five fields, minute then hour: `0 7 * * *` is seven every
  morning. Phrases work too; Hermes' own examples are `30m`, `every 2h`
  and `0 9 * * *`. There is no once-an-hour floor: a two-minute job fired
  every two minutes.
- **Prompt.** One line that names the recipe. A scheduled run is a
  stranger to your session; say the name and the recipe runs.
- **Name.** What you will recognise in `hermes cron list`.
- **Workdir.** Your mission control, full path. It is the folder the job runs in AND
  the thing that hands the job your `AGENTS.md`: Hermes' own help says it
  "injects AGENTS.md" from there. Never leave it out.

## A hand run proves the recipe, not the clock

**Trigger now** on the card, or `hermes cron run <name>` in a terminal,
fires a job immediately. Its run record says `source=direct`; a run the
clock fired says `source=builtin`. Testing with a hand run and closing
the lid proves the recipe and nothing about the schedule.

## Jobs never ask

Shipped defaults: a scheduled job that reaches for a command Hermes would
normally ask about is refused, not paused (`approvals.cron_mode: deny`).
A brief that only reads the folder and writes into `brief/` never reaches
for one. If a job genuinely needs a dangerous command, grant it on
purpose in Hermes' approvals; do not discover it at 07:00.

## What does not count as a procedure

Asking an open session to "check again in ten minutes" is not a
procedure: nothing is written down, and it is gone when the conversation
ends. It never gets a block in `procedures.md`, because a register entry
for something that quietly died last Tuesday is worse than no entry at
all.
