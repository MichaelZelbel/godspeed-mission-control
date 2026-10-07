# godspeed-coach: a coach that opens the conversation

**Pick an area of your life, a day and a time. Your mission control opens the talk on your
messenger, remembers the last one, and helps you decide one thing. Habits you track in one
spoken line.** An add-on for [the kit](https://github.com/MichaelZelbel/teach-it-once-kit) from
[*Teach It Once*](https://leanpub.com/teachitonce).

> Sunday, 19:00. "From your coach, your weekly health talk: on Monday you said washing up often
> leaves you tired. When it happens: how often, how long, and does it come with any dizziness?"

> Track head lifts.

> 21:00. "From your coach: Face-down head lifts today? You planned this habit for every day, and
> nothing is tracked for today yet. Reply "yes" if you did it, "no" if you didn't, or "skip" if
> today shouldn't count, for example because you were ill. No reply is fine: the day stays blank
> and I won't ask about it again." Only when you have not said it yet.

## Why it exists

A weekly conversation about your health, your work or the people in your life does more than
any dashboard, but only if it happens. So the coach starts it, at the time you picked, and keeps
it short: one thing it noticed, one question. The rest is a conversation. What you decide is
written down, so next week starts where this one ended.

Habits are the other half. A talk decides on a small habit; you say "track head lifts" when you
did it; the evening check asks only about what you have not mentioned, and on a good day you hear
nothing. After six weeks of mostly done, the talk offers to graduate the habit. Two weeks under
half, it asks whether to make it smaller or drop it.

## What it is

- **One folder per area** under `coach/` in your mission control: `area.md` (rhythm, time,
  style, tone, limits, how to prepare), `questions.md`, `talks/` (one record per talk) and
  `habits/` (one file per habit). Plain text you can read and edit.
- **One command**, `godspeed-coach`, that the recipe and the schedule use.
- **One recipe**, `coach`, copied into your skills folder: how to open, continue and close a talk,
  how to track a habit, and what never to do (a wall of text, praise, a habit you did not agree to).
- **Two scheduled jobs in Hermes**, however many areas you have. `coach-talks` checks every 15
  minutes whether a talk is due and starts the model only then. `coach-tick` sends the evening
  habit check and one follow-up for an unanswered talk, and never uses a model.
- **A Hermes plugin and a Claude Code hook** that show the open talk and tonight's habit question
  before every turn, so your answer lands in the right place wherever you type it.

## Install

As the account your assistant runs as, from inside your mission control folder:

```
curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/godspeed-coach/main/install.sh | bash
```

It uses whichever Node.js 22 or newer the computer has, including the one Hermes brings along.

Then ask your assistant for your first area: "I want a weekly health talk on Sundays at seven."

## Use

```
godspeed-coach areas                          # the areas and when each next talks
godspeed-coach brief health                   # what the next health talk would start from
godspeed-coach habit add health head-lifts --title "Face-down head lifts" --done-means "a few 10-second holds" --days daily
godspeed-coach habit track "did head lifts"   # --answer no|skip, --date yesterday
godspeed-coach habit answer yes no            # tonight's check, in the order it asked
godspeed-coach habit list                     # --all for paused and graduated ones too
godspeed-coach habits week                    # the last seven days of each habit
godspeed-coach talk state health              # the last five health talks and how they went
godspeed-coach config show                    # time zone, language, habit check time, cap
```

## Honest limits

- The talks need your assistant on a messenger; without one, the habits still work at the desk.
- The coach never diagnoses, never tells you to see a doctor, never buys, books, pays or contacts
  anyone for you. Each area can add its own limits.
- Five active habits at most, by design. More than that is a list, not a habit.
