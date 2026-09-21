# forecasts - what your hub expects to happen, written down so it can be wrong

**This room starts empty, and an empty one costs you nothing.** It fills the first time your hub
commits to a number instead of a mood.

## Why this exists

Every plan carries a prediction whether or not anybody writes one down. "This will sell." "I will
keep it up this time." "They will say yes next week." Unwritten, a prediction cannot be wrong, so
nobody ever learns anything from it.

That is a small problem when a person does it and a large one when an assistant does it, because
an assistant will produce a confident sentence about the future every single time you ask, at no
cost to itself, for ever. The only defence is to make the prediction cost something: a date, a
number, and a record.

## A card

```
forecasts/F-2026-09-13-one-line-posted.md

ID: F-2026-09-13-one-line-posted
STATUS: open                   open, resolved or void
GOAL: lead                     the goal it belongs to
QUESTION: One of the drafted lines is posted by 2026-09-26
RESOLVES WHEN: a post card carries OUTCOME posted with a link
DEADLINE: 2026-09-26
MADE ON: 2026-09-13
P: 0.25                        at most two decimals. Or LOW / HIGH / UNIT for a number.
BASELINE: 0.10                 what history alone would have said, with BASELINE SOURCE
BASELINE SOURCE: 0 of 9 shown in 14 days were posted
REFERENCE CLASS: the comparable cases, the failures included, and where they were read
FIT: how the class fits        DIFFERS: where it does not
FAILURES INCLUDED: yes
EVIDENCE QUALITY: weak         strong, moderate, weak or none
MISSING DATA: what nobody has
ASSUMPTIONS: what has to hold for this to mean anything
DEPENDS ON: W-20260913-01      the action this forecast rests on
ALTERNATIVE: the other action that was considered
STATUS QUO: what carrying on unchanged would look like
HORIZON DAYS: 13

## Log
- 2026-09-13 MADE p=0.25
- 2026-09-16 REVISED p=0.35 from 0.25 because you said you liked the second line
- 2026-09-27 RESOLVED no "no card carries OUTCOME posted; the page shows nothing new"
```

## The reference class is the part people skip

A forecast with no reference class is a story with a number stapled to it. The class is the set
of comparable cases it was read from, **including the ones that failed**, which is the half that
gets left out by everybody, including your assistant, unless something asks for it by name. That
is why `FAILURES INCLUDED` is its own line and why the program nags until it says yes.

Then two more lines that stop a class from being a comfort blanket: how it **fits** this case,
and where it **differs**.

## What the program refuses

- A probability with more than two decimals. 0.37 is a judgment; 0.3712 is a decoration.
- A probability at or past 2% or 98% with no reason given for being that certain.
- A forecast with no way to resolve it, or no reference class.
- A revision that would overwrite history. Revisions are appended; the old number stays.
- Any revision at all after the deadline. Resolve it instead.
- A resolution with no evidence.
- A track record built on a handful of questions. Under five resolved it says so; under twenty it
  tells you to read it with the interval in mind.

## Scoring

    hub-forecast score

Each resolved yes-or-no question is counted **once**, at the last probability before its
deadline, so twenty revisions of one question are still one outcome rather than twenty wins.

The number is the **Brier score**: the squared gap between the probability and what happened, on
a scale from 0 to 1. **0 is perfect. 0.25 is a coin flip called at 50%. 1 is confidently wrong.**

Beside it you get the same score for the plain historical baseline each forecast named. That
comparison is the whole point. Being right is easy when the answer was obvious, and the honest
question is whether your hub beat what history alone would have said on the same questions.

You also get a calibration table: in the bucket where it said about 30%, how often did the thing
actually happen? A forecaster who says 30% and is right 30% of the time is calibrated, even
though they are "wrong" most of the time. That is the shape you are looking for.

## Two different questions, kept apart

This folder scores **prediction** quality. How good the actions were is a different question and
it is answered next door, by the PROGRESS lines on your goals and by what actually changed in the
world. A system that scores its predictions well and achieves nothing is possible, and you would
want to know.

## The commands

```
hub-forecast file --question "..." --resolves-when "..." --deadline YYYY-MM-DD
                  (--p 0.xx | --low N --high N --unit U) --reference-class "..." --evidence "..."
hub-forecast revise <id> --p 0.xx --why "..."        appends; never after the deadline
hub-forecast resolve <id> --outcome yes|no|void --evidence "..." [--value N]
hub-forecast list | due | show <id> | score | check
```

Chapter 20 of the book is the idea behind this folder: the outside view, and a number you keep
score on. The rooms next door are `goals/` and `work/`.
