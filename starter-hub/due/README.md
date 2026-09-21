# due - the things with a last day

**This room starts empty, and an empty one costs you nothing.** It fills the first time you tell
your hub about something with a deadline (Chapter 27). If you never do, you have an empty folder
and you have lost nothing.

## Why this is not a reminder

A calendar reminder fires on a date and knows nothing else. It cannot tell whether you already did
the thing, so it goes off afterwards, and after that happens a few times you stop reading
reminders. Then one of them stops on its last occurrence whether or not the job got done, and that
is the one that mattered.

Everything in here is built to fix both halves of that.

## The window

Every file in here holds **the first day you can do the thing, and the last day you still can.**
Not a due date. A window.

How loud your hub gets follows how much of the window is left, as a fraction:

| Left of the window | Your hub |
|---|---|
| more than half | says it once when the window opens, then at most monthly |
| half to a quarter | a line in your brief about every fortnight |
| a quarter to a tenth | its own line, near the top, about weekly |
| the loud days at the end: a tenth of the window, never fewer than three days and never more than fourteen | every morning |

**One rule, whether the window is a week or a year.** That is the whole reason you can have a
hundred of these. There is nothing to tune per item, and if a thing feels like it needs its own
setting, the window is wrong rather than the rule.

## What a file looks like

One file per thing, named however you like:

```
due/car-service.md

TITLE:          Car service before the warranty runs out
DONE-WHEN:      The car has been serviced at a garage the warranty accepts.
COST-IF-MISSED: The warranty ends. A gearbox after that is mine to pay for.
SELF-CHECK:     none
SELF-CHECK-ARG:
REPEATS:        yearly
LINK:           https://example.com/book-a-service
SOURCE:         me, 2026-08-29

## Windows
STRIP: 2026-09-01 2027-02-28 open

## Log
- 2026-08-29 created, window 2026-09-01 to 2027-02-28
```

Plain text. Read it, edit it, delete it. The program writes the same shape you would.

**A repeating thing is ONE file that grows a new window each time**, never one file per occurrence.
That is what keeps a hundred of these at a hundred files instead of thousands.

## The four questions, asked once

When you add one, answer four things and never be asked again:

1. What is true when this is finished?
2. From when to when can you do it?
3. What does it cost you if it slips?
4. **How could your hub tell you did it, without asking you?**

The fourth is the one that matters and the one everybody skips. Some things can answer it. A key is
replaced when the date in `secrets/expires.txt` moves. A backup happened if the file is newer than
the window. Those close themselves and never nag you again after you act, which is exactly the
failure that kills every reminder app.

Most things cannot answer it, and **that is a fine answer**. Nobody can tell your hub that you
submitted a timesheet into somebody else's website. Those say so and wait for you to say the word.
Ask the question anyway, every time, because knowing which kind a thing is changes what you build
around it.

## No date, not eligible

`hub-due add` refuses anything without both dates, in those words. That refusal is the only thing
between this folder and a to-do app you stop maintaining.

## Three states, and only three

**open, done, dropped.** Done can happen by itself when there is a self check. **Dropped only ever
comes from you**, and it deletes the file and everything it remembers, which is why the command
makes you type `--yes`.

Something whose window closed without being done **stays open**. Nothing tidies it away, because
for a deadline "nobody got to it" is the failure, not a quiet success.

## Your keys are already in here

If you have `secrets/expires.txt` from Chapter 31, `hub-due` reads it and treats each key as one of
these. You never write a date in two places, and there is one thing nagging you rather than two
that disagree. Moving the date in that file is still the off switch, and it is now also the proof:
moving it forward is what replacing a key looks like from outside, so the reminder closes itself.

## You do not need a calendar

Not for any of this. If you do have one, your assistant can add **one entry per thing**, and one is
the whole rule. It goes on the day your hub starts being loud, not on the day the thing dies, and
the death date goes in the title so the single entry says both. Never two entries about one date:
the day they disagree with each other you stop believing either.

It comes out again when you finish, as long as the day has not passed yet. That is the part that
makes one entry safe, because otherwise an entry you already acted on sits there being wrong. A day
that has already gone by is left alone: it is a record of what happened.

You can also go the other way and add one from your phone, by writing an event that says
`hub: from 1 Feb`. **The calendar never decides when you get nagged and never knows whether you
acted.**

## The commands

```
hub-due                     everything, loudest first
hub-due today               at most three, which is what your morning brief reads
hub-due add <name> ...      make one
hub-due done <name>         you did it
hub-due drop <name> --yes   delete it
hub-due check               run the self checks, close what is provably done
```

The card is `procedures/what-runs-out-and-when.md` in the kit. Chapter 27.
