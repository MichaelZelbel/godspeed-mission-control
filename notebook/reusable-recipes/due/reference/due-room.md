# Deadlines - the things with a day

**You start with none of these, and none of them costs you anything.** Your mission control keeps
its first one the moment you tell it about something with a day attached: a day you would like it
done by, or a last day before it costs you. If you never do, there is nothing to keep and you have
lost nothing.

## Why this is not a reminder

A calendar reminder fires on a date and knows nothing else. It cannot tell whether you already did
the thing, so it goes off afterwards, and after that happens a few times you stop reading
reminders. Then one of them stops on its last occurrence whether or not the job got done, and that
is the one that mattered.

Everything below is built to fix both halves of that.

## Three dates, and you usually need only one

Every one of these can carry up to three dates:

- **The day you can start.** Optional. If you leave it out, it is the day you add the thing.
- **The day you would like it done.** A target, soft, like a date in a calendar. Missing it costs
  you nothing.
- **The day it starts costing you.** A deadline, hard: after it there is a fee, a fine, a lost
  chance.

It needs at least a target or a deadline. Many people only ever need the target.

| What it has | What your mission control does |
|---|---|
| **A deadline only** | The window below: quiet at first, louder as the last day comes. After the last day your brief mentions it twice more, three days apart, then waits for your word; it stays open until you close it or drop it. |
| **A target only** | Nothing until that day. One mention on the day. Once it has passed it never gets louder: the next morning it asks you once, "A new date, or as soon as you can?" A new date becomes the new target. "As soon as you can", or no answer at all, keeps it open with a gentle line in your brief about once a week, until you finish it or drop it. |
| **Both** (a tax return: aim for the end of January, must by the end of February) | The deadline's window, plus one mention on the target day. After the target it says you are past it and names the deadline. It does not ask for a new date, because the deadline decides. |
| **Repeating** | A new window each time. The target sits at the same place inside every window. |

In your morning's three places, a target you have passed comes after every deadline, and it never
gets louder than that one line. It is a wish you gave yourself, not a bill.

## The window, for a deadline

A deadline holds **the first day you can do the thing, and the last day you still can.** Not a due
date. A window.

How loud your mission control gets follows how much of the window is left, as a fraction:

| Left of the window | Your mission control |
|---|---|
| more than half | says it once when the window opens, then at most monthly |
| half to a quarter | a line in your brief about every fortnight |
| a quarter to a tenth | its own line, near the top, about weekly |
| the loud days at the end: a tenth of the window, never fewer than three days and never more than fourteen | every morning |

**One rule, whether the window is a week or a year.** That is the whole reason you can have a
hundred of these. There is nothing to tune per item, and if a thing feels like it needs its own
setting, the window is wrong rather than the rule. A target adds no setting either: every target
behaves the same way.

## Where one lives, and what it looks like

**Each one is a page in your notebook**, under `Deadlines/`, named after its own title:

```
Deadlines/Car service before the warranty runs out.md

---
title: Car service before the warranty runs out
done_when: The car has been serviced at a garage the warranty accepts.
cost_if_missed: The warranty ends. A gearbox after that is mine to pay for.
self_check: none
repeats: yearly
link: https://example.com/book-a-service
source: me, 2026-08-29
windows:
  - start: 2026-09-01
    deadline: 2027-02-28
---
- 2026-08-29 created, window 2026-09-01 to 2027-02-28
```

The page carries a few more lines your notebook keeps for every page of every kind: when it was
made, when it last changed, and the name by which all your computers know it is this same page.

A target is one more line in the window, and a window may carry `target`, `moved` and an
`extra` list as well, each left empty when it has nothing to say. A present to buy before a
birthday, with no deadline at all, has `start: 2026-04-20`, `target: 2026-05-10` and an empty
`deadline:`: from the 20th of April, aiming for the 10th of May, and no last day. With both, the
window carries a start, a deadline and a target together. When you give a new day after missing
one, it is written beside the old one as `moved: 2027-02-10`.

Plain Markdown. Read it, edit it in Obsidian or any editor, and the next command reads what you
wrote. Your notebook carries it to your other computers the way it carries every note, so one you
add on one computer is there on the next, with nobody running Git.

**A repeating thing is ONE page that grows a new window each time**, never one page per occurrence.
That is what keeps a hundred of these at a hundred pages instead of thousands.

## The four questions, asked once

When you add one, answer four things and never be asked again:

1. What is true when this is finished?
2. Is there a day after which this costs you something, or is it a day you would like to have it
   done by? (Or both. And if you cannot start yet, from when.)
3. What does it cost you if it slips? Only asked when there is a deadline: a target costs nothing.
4. **How could your mission control tell you did it, without asking you?**

The fourth is the one that matters and the one everybody skips. Some things can answer it. A key is
replaced when the date in `secrets/expires.txt` moves. A backup happened if the file is newer than
the window. Those close themselves and never nag you again after you act, which is exactly the
failure that kills every reminder app.

Most things cannot answer it, and **that is a fine answer**. Nobody can tell your mission control that you
submitted a timesheet into somebody else's website. Those say so and wait for you to say the word.
Ask the question anyway, every time, because knowing which kind a thing is changes what you build
around it.

## No date, not eligible

`mc-due add` refuses anything that has neither a target nor a deadline, in those words. That
refusal is the only thing between these and a to-do app you stop maintaining. "Someday" is
not a target; "by the 10th of May" is.

## Three states, and only three

**open, done, dropped.** Done can happen by itself when there is a self check. **Dropped only ever
comes from you**, which is why the command makes you type `--yes`.

**Done is never written on the page.** The page is the plan. When a thing is finished, that is
something that happened, so it goes where the things that happened go: a moment on your notebook's
timeline, `Timeline/<the day> Done: <its title>`, which names the reminder and carries, on an
`evidence:` line, what shows it (your words, a receipt, a commit). A drop is the same moment with
"Dropped". Everything that asks "is this still open" works it out from those moments, so there is
only one place the answer can live and nothing can disagree with it. Why: in the mission control
this kit comes from, a post was approved and published in a working session, the memory wrote that
down the same day, and the plan kept saying open, so the morning brief told its owner for five
mornings that the finished work was waiting. `mc-due done` and `mc-due drop` write the moment for
you, and when your assistant finishes one of these with you in a session it closes it before the
session ends.

A closing is a moment like any other, so it travels with your notebook. Close one on the computer
in your kitchen and the computer in your office knows it the next time the two talk, with nothing
to save by hand and nothing for you to settle if you closed the same one on both.

Something whose window closed without being done **stays open**. Nothing tidies it away, because
for a deadline "nobody got to it" is the failure, not a quiet success. It does stop shouting:
your brief mentions it twice more, three days apart, and then waits for your word, because the
likeliest reason is that you did it and forgot to say so. The full list keeps showing it.

## Your keys are already among them

If you have `secrets/expires.txt`, the list of when each key runs out, `mc-due` reads it and treats each key as one of
these. You never write a date in two places, and there is one thing nagging you rather than two
that disagree. Moving the date in that file is still the off switch, and it is now also the proof:
moving it forward is what replacing a key looks like from outside, so the reminder closes itself.

## You do not need a calendar

Not for any of this. If you do have one, your assistant can add **one entry per thing**, and one is
the whole rule. For a deadline it goes on the day your mission control starts being loud, not on the day the thing dies, and
the death date goes in the title so the single entry says both. For a target it goes on the target
day, and a thing with both gets the target-day entry with the deadline in its title. Never two
entries about one date: the day they disagree with each other you stop believing either.

It comes out again when you finish, as long as the day has not passed yet. That is the part that
makes one entry safe, because otherwise an entry you already acted on sits there being wrong. A day
that has already gone by is left alone: it is a record of what happened.

You can also go the other way and add one from your phone, by writing an event that says
`mission control: from 1 Feb`. **The calendar never decides when you get nagged and never knows whether you
acted.**

## The commands

```
mc-due                     everything, loudest first
mc-due today               at most three, which is what your morning brief reads
mc-due add <name> ...      make one: --target, --to (the deadline), or both
mc-due target <name> D     a new day you would like it done (or: asap, as soon as you can)
mc-due done <name>         you did it (a moment on your notebook's timeline says so)
mc-due drop <name> --yes   call it off; nothing is deleted
mc-due check               run the self checks, close what is provably done
mc-due state               which are open, and what closed the others
```

The card is `procedures/what-runs-out-and-when.md` in the kit. The guide: https://godspeedmissioncontrol.com/guide/deadlines
