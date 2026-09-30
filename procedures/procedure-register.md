# The Register (Chapter 21)

The automation rule: **never run a procedure you cannot see and stop.**

The register is not a document you keep somewhere. It is one file in your
folder, `procedures.md`, and it ships with the starter mission control. This card is
how to fill it.

## Why a file in your folder, and not the app's own list

Your AI app knows what runs *inside the app*. It does not know about your
email auto-reply, your phone's bedtime routine, or the recurring payment
order at your bank, which is the oldest procedure in your life. Your AI joined an
existing staff. The register is the staff list.

It also travels. Change AI provider and the app's list goes with the app.
`procedures.md` stays in your folder, like everything else in this book.

## The shape

One block per procedure, seven lines, in `procedures.md`:

```
## (Name of the procedure)

Does: (what it does and which skill it uses, in your own words).
Rhythm: (schedule, time zone and next run, or "not scheduled").
Lands: (where the result and the run history appear).
Lives: (which tool runs it, on which computer, in which working folder).
May: (what it may read, change or send).
Off-switch: (the exact pause or removal control).
Last checked: (date, and what remains untested).
```

The *Does* line is the one no app can give you. It is the answer to the
question you will ask yourself some Tuesday months from now, when your
phone buzzes and you cannot remember why: what is this and why did I
build it?

## Ask for it in plain words

In a session with your folder attached:

```
Inspect the schedules you can actually reach. Update procedures.md with one block per automatic job. For each block record:

- what it does and which skill it uses;
- the computer and working folder;
- the schedule, time zone and next run;
- where the result and run history appear;
- what it may read, change or send;
- the exact pause or removal control;
- when its behavior was last checked and what remains untested.

Mark planned jobs as not scheduled. Do not invent a job or a successful test from a conversation about one. Report any schedule you could not inspect.
```

*[Copy prompt](https://querino.ai/prompts/procedure-register)*

Half-empty blocks are fine and honest. A "Rhythm: not scheduled"
line is a true statement about the world. Fill it in when you attach the
clock.

## Before a skill gets a clock

Check that the skill can find everything you normally hand it in a
conversation. Ask this before you schedule it:

```
Read the skill I want to schedule. Could it run without another message from me, using only the files and tools it can already reach?

Mark it ready or not ready. For each missing input, name exactly what is needed and where the skill currently expects to get it. Also check its output destination, limits and stopping condition.

Do not change files or create schedules.
```

*[Copy prompt](https://querino.ai/prompts/automation-entry-exam)*

Put each missing input where the job can find it before you give it a time.

## The cards in here that make a procedure

Every one of these leaves something running, so every one of them owes
`procedures.md` a block, or a line in the block of the job it rides inside.
This is the list to walk when you are checking whether the register is
complete.

| Card | What it leaves running | Chapter |
|---|---|---|
| `morning-brief-setup.md` | a brief that arrives every morning | 22 |
| `weekly-review-setup.md` | a review that keeps its own appointment | 24 |
| `watchdog-setup.md` | a patrol on something you used to check by hand | 25 |
| `research-watch-setup.md` | one daily job for every research question you keep open | 26 |
| `outside-ai-check.md` | the monthly question about AIs you use elsewhere | 24 |
| `ai-subscription-review.md` | the monthly money line | 24 |
| `keys-that-expire.md` | the record of when each key dies | 20, 31 |
| `what-runs-out-and-when.md` | one daily check over everything with a day | 27 |
| `safety-net-setup.md` | version history and an off-machine copy | 18 |

The daily check over everything with a day is the one most likely to be
missing, because it has no block of its own: it runs inside the morning
brief. It gets one line in the morning brief's block saying the brief now
runs `mc-due`.

## The quarterly audit

Do it in the same sitting as the spring-clean from Chapter 10. Walk the
register in both directions:

1. **Downwards:** everything `hermes cron list` shows must have a
   block in `procedures.md`. Anything unexplained gets one question,
   "what are you and why do you run?", and either earns a block on the
   spot or is deleted on the spot.
2. **Upwards:** every block must still earn its slot. The firing rule:
   **if you ignored a procedure's last three deliveries, pause it.** If a
   month passes and you never miss it, delete it and strike the block.
   No guilt. An ex-procedure that taught you what you do not need was
   worth building.
3. Update every *Last checked* date. That quietly turns the register into
   a record of your own diligence.

## Practice the off-switch once

In Hermes' **Scheduled jobs** screen, press **Pause** on a job's card and
look for **Paused**. The card can still show a next-run time; **Paused**
takes priority. Press **Resume** to put it back.

Thirty seconds, today, while nothing is wrong. Stopping should be a
reflex, not a research project.
