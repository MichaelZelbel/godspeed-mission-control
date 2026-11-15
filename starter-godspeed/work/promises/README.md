# work/promises - what your mission control promised you on a clock, and whether it kept its word

**One file per promise.** Not your own deadlines (those are `mc-due`), not your goals (`goals/`):
the things your mission control said it would do for you, at a time, again and again. Your morning
brief. A weekly summary. A check every first of the month.

## Why this folder exists

An assistant that says "I'll send you this every Sunday" in a chat has made a promise that nothing
records, nothing runs and nothing checks. The first Sunday passes in silence and nobody notices,
because a quiet job and a job that never ran look the same from outside.

So a promise that is not a file here is not a promise. Two checks keep it that way:

- **At the end of a turn.** When the assistant's last message promises you something on a clock and
  no file here was written or touched, it is asked once to write it
  (`.claude/hooks/promise-needs-a-file.js`).
- **Every morning.** Each file here is read, its last due time worked out, and its proof looked
  for. A missed promise is said at the top of your morning brief and of `mc-due today`, in plain
  words, until a later one is kept. It is never moved forward quietly, and it never stops the brief.

When setup makes a routine for you (the morning brief, the daily round, the nightly research), it
writes that routine's promise here itself, as `routine-<name>.md`, and never over a file that is
already here. You rarely write one by hand.

## A promise, the file

```
# A weekly summary of my training

PROMISE: weekly-training-summary
PROMISED ON: 2026-11-08
YOUR WORDS: "Can you send me a summary of my training every Sunday?"
WHAT YOU GET: a short summary of the week's training, every Sunday evening
CADENCE: weekly
DUE: sunday 19:00 Europe/Berlin
GRACE: 12
STARTED: 2026-11-15
RUNS IT: the routine "Weekly training summary" in Settings > Routines
PROOF: files notes/weekly/*.md

## Log
- 2026-11-08 written when you asked for it
```

The fields, the first of each one counting:

- `PROMISE` a short name. `WHAT YOU GET` one plain sentence, the thing you receive.
- `CADENCE` is `daily`, `weekly` or `monthly`, and `DUE` says when, in a time zone such as
  `Europe/Berlin` or `UTC`: `daily 07:00 <zone>`, `<weekday> 19:00 <zone>` (`sunday`, `monday`, ...),
  or `<day of the month, 1 to 28> 09:00 <zone>`.
- `GRACE` the hours after the due time before it counts as missed (12 when left out).
- `STARTED` the first day it is live: nothing before it is judged.
- `RUNS IT` what does the work. `ROUTINE` the routine's name, on the promises setup writes.
- `PROOF` is the field that matters. It is something the work leaves behind when it is done, so
  work that was done has the proof and work that was not cannot fake it:
  - `files <pattern>` a file whose name, or one of whose folders, carries the date (`YYYY-MM-DD`).
    `*` matches within a folder, `**` across folders. The pattern is inside your mission control.
  - `dates-in <file>` the newest `YYYY-MM-DD` anywhere in that file. The routines setup makes leave
    their date in `routines/ran/<name>.txt` after every run that ended well.
- `PROMISED ON` and `YOUR WORDS` are for you: when you asked, and what you said.

## The states

- **kept** the proof is on or after the last due day.
- **due now** it is inside its grace hours, and the time before was kept.
- **missed** a due day passed its grace hours with no proof. It shows the last time it was kept.
- **never run** the same, and there is no proof it ever happened.
- **not yet due** its first due day has not come yet.

A file that cannot be read (a field missing, a time zone nobody knows) is said every morning too,
never skipped.

## Ending a promise

Delete its file. A routine you paused keeps being reported as missed until you do, because a
promise nobody ended is still a promise.

## What this is not

Not a place for goals or plans. A promise here has a clock and a proof. "Get fitter" is a goal and
lives in `goals/`; "a weekly training summary every Sunday" is a promise and lives here.
