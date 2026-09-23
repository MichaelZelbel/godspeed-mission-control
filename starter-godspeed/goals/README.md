# goals - what you want, one card each, and who gets attention today

**This room starts empty, and an empty one costs you nothing.** It fills the first time you tell
your mission control what something is actually for.

## Why this is not a to-do list

A to-do list holds things to do. It cannot tell you which of them is worth doing this morning,
because it does not know what any of it is for. Two things go wrong without this folder, and
they go wrong quietly.

**A means gets carried as if it were an end.** "Post every day" sits in your system looking like
a goal. It is not one. It is a way of getting something, and the something is written down
nowhere, so the day posting stops working nobody notices, because there is nothing to notice it
against.

**The loudest queue wins every morning.** Deadlines shout. Health does not. Your friendships have
no notifications. If the only thing your mission control reads at 6am is what has a date on it, then what has
a date on it is your whole life as far as your mission control is concerned.

## Four kinds, and keeping them apart is most of the value

    outcome     a state of the world you want. "Healthy and strong in my 90s."
    strategy    a way meant to produce an outcome. "Train three times a week."
    project     bounded work under a strategy or an outcome. "Get the knee looked at."
    commitment  a protected obligation with its own slot: a client, a weekly call.

`SERVES` links a card to the one above it. That link is what lets your mission control answer "why am I doing
this", and what makes a change to a goal reach the plans underneath it instead of leaving
yesterday's plan quietly running.

## A card

One file per goal, named however you like:

```
goals/age-healthy.md

ID: age-healthy
KIND: outcome
STATUS: adopted
AREA: health
TITLE: Stay healthy and strong into my 90s
OWN WORDS: I train because I want to be strong at 90
MEASURE: what would show it is moving, and where that is read from
DEADLINE: 2027-09-13          a date, or the word unresolved
SERVES:                        the id of the outcome a strategy or project serves
PROTECTED: no
OWNER: person
IMPORTANCE: core               core, high or normal. Your word, never a number.
ENERGY: medium                 what it asks of you on a day it is active
SOURCE: said it on 2026-09-06  required: a goal nobody can trace back to you is not your goal

## Log
- 2026-09-13 FILED adopted outcome, source: said it on 2026-09-06
- 2026-09-20 PROGRESS three runs this week, from health/daily.csv
- 2026-09-21 ATTENTION active today: nothing had looked at it for 8 days
- 2026-10-01 CHANGED DEADLINE "2027-09-13" -> "2027-12-31" because I moved the checkpoint
- 2026-10-03 ANSWER "not now, ask me in December"
```

Plain text. Read it, edit it, delete it. The program writes the same shape you would.

## Five states, and the first one is the important one

**provisional, adopted, paused, achieved, retired.**

**A goal is filed when you say so, and it is filed adopted.** "Make this a goal" or "work on this
for me", in a conversation, is enough: your assistant files the card with `--status adopted` and
your words as the source, and Mission Control starts working on it at the next decision. Nothing you
merely mentioned wanting lands here on its own.

**Provisional is the parking place.** Say "park this idea" and the card is filed provisional:
your mission control never works on it, it may ask you **one** clarifying question about it in seven days,
and never a second one while the first is unanswered. This is what lets you think out loud in
front of your assistant without waking up to a project you never asked for. A parked idea becomes
a goal when you say so: `mc-goals adopt <id> --why "..."`. Silence is never a yes. (The program's
own default, when no status is given, is provisional, so a card filed by hand without `--status`
is parked rather than started.)

## A change keeps its reason

    mc-goals change <id> --set "DEADLINE=2027-12-31" --why "I moved the checkpoint"

The old value stays in the log with the reason. Every card that serves this one gets a REVIEW
line. The work underneath it is marked stale, or cancelled if you paused, retired or achieved the
goal. Open forecasts that depend on it are flagged.

Nothing under a changed goal carries on as if nothing had happened. That one sentence is the
difference between a goal register and a list of intentions.

## Attention: explicit, and with no score in it

    mc-goals attention

It says which goals get attention today **and why, on every row**. There is no number anywhere.
In order:

1. a protected commitment keeps its slot
2. a deadline inside seven days
3. a diagnosis that was refuted, so it has to be worked out again before acting
4. nothing has looked at it for seven days
5. a deadline inside thirty days
6. your own word for how important it is
7. then whatever has gone longest without attention

**At most three outcomes are active in a day.** The rest are quiet, each with the reason written
down, which is what makes "quiet" different from "forgotten".

Point 4 is the one that earns this folder. Neglect is counted from the last time a goal was
*looked at*, not from whether anything about it could be measured. Without that, the thing with a
number attached wins every morning, for ever.

A deadline that has passed is a flag to re-set it or retire it. It is not urgency. A question you
never answered means "reassess whether this is still wanted", never "go ahead".

## What limits a goal: the diagnosis

    mc-goals diagnose <id>

writes `goals/diagnoses/<id>-<date>.md` with the sections a diagnosis needs to stay honest: the
situation and its history, **at least two competing explanations** and what would separate them,
what is verified kept apart from what is inferred, the open questions, the one constraint you are
claiming, and - required whenever you claim one - **the observation that would show you are
wrong**. Then the method and the next test.

`mc-goals check` refuses a diagnosis that claims a constraint without saying what would disprove
it, because that is not a diagnosis, it is a preference with a heading on it.

## The commands

```
mc-goals file --kind outcome|strategy|project|commitment --title "..." --source "..."
mc-goals adopt|pause|retire|achieve <id> --why "..."
mc-goals change <id> --set "FIELD=value" --why "..."
mc-goals progress <id> --evidence "..."       what exists now that did not before
mc-goals question <id> --text "..."           one in seven days, never two at once
mc-goals answer <id> --text "<your words>"
mc-goals diagnose <id>                        what is limiting it, on evidence
mc-goals attention                            who gets attention today, and why
mc-goals list | show <id> | tree | check
```

Chapter 6 of the book is the idea behind this folder; the chapter on the daily decision is where
`mc-decide` puts it to work. The two rooms next door are `forecasts/` (what your mission control expects to
happen) and `work/` (what it is doing about it).
