# Workouts: your Hevy workouts in your Godspeed notebook

**Log a workout in Hevy as you always do. Within the hour it is a row in your Godspeed notebook,
with every set.** An add-on for [Godspeed Mission Control](https://github.com/MichaelZelbel/godspeed-mission-control).

No export, no login, nothing to tap. Your assistant and your coaching talks can then see what you
trained next to everything else they know: your sleep, your headaches, your goals.

## What a row looks like

The notebook gets a tracker called **Workouts**, one row per workout:

| Started | Workout | Ended | Minutes | Exercises and sets | Sets | Volume | Notes | Your comment |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 2026-10-23 18:05 | Upper body | 2026-10-23 18:55 | 50 | Bench press: 8 x 60 kg<br>Row: 10 x 50 kg | 2 | 980 kg | | |

- Times are your wall clock, in your notebook's time zone.
- Every exercise in Hevy's order, every set as reps x weight. A warm-up says "warm-up", a drop set
  "(drop set)", a set to failure "(to failure)", an RPE you gave "(RPE 8)". Timed and distance sets
  read "5 km in 25:00 min" or "1:00 min". Supersets are numbered, an exercise's notes follow it.
- Volume is reps x weight over every set except warm-ups.
- Weights and distances in the units your Hevy account uses (kg or lb, km or mi).
- "Your comment" is yours. Nothing ever writes it.

## Install

Newer versions of Godspeed Mission Control carry this add-on themselves: paste your Hevy key in
Godspeed's Settings, and everything below is done for you. The install line is for people whose
Godspeed does not carry it, or who want it by hand.

You need Godspeed Mission Control, Hevy Pro (Hevy's connection for other apps is part of Pro) and
Node.js 22 or newer, which Godspeed brings.

1. Make an API key in Hevy: https://hevy.com/settings?developer
2. On the computer or server where your Godspeed notebook runs:

```bash
curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/godspeed-workouts/main/install.sh | bash
```

On Windows, in PowerShell:

```powershell
irm https://raw.githubusercontent.com/MichaelZelbel/godspeed-workouts/main/install.ps1 | iex
```

It asks for the key (it is not shown as you type, and it is checked with Hevy before it is kept),
makes the Workouts tracker, brings in every workout you ever logged, and sets up the hourly run.
On a server, run it as root. Your assistant can do all of it for you: give it
[INSTALL-FOR-ASSISTANTS.md](INSTALL-FOR-ASSISTANTS.md).

To let a coaching talk read it, tell your assistant: "The health talk may also look at my
Workouts tracker".

## Update

Run the install line again. Your key, your settings and your rows stay as they are.

## What happens when

- **Hourly**, at a minute picked at random when it was installed (Hevy asks that nobody calls at
  the full hour), it asks Hevy what changed since the last time.
- **You change a workout in Hevy**: its row follows within the hour.
- **You delete a workout in Hevy**: its row goes. If the row holds something of yours (your
  comment, a cell you changed, a column you added), it stays instead, and its Workout cell says
  "(deleted in Hevy)", so nothing you wrote is lost.
- **You change a cell in the notebook**: it stays as you wrote it. From then on Hevy no longer
  changes that cell of that row; the other cells keep following Hevy. Set it back to exactly what
  Hevy says, and it follows Hevy again.
- **You add a column**: it is yours; nothing writes it.
- **You delete a row in the notebook**: it is not made again.
- **Once a day** it compares how many workouts Hevy has with the rows it keeps, and reads
  everything again when they differ.

## When it tells you something

Only when you can do something about it, and once per problem, on your assistant's Telegram bot
(on a desktop: a notification):

- Hevy no longer accepts the key (a key you deleted, or Hevy Pro ended): make a new key and give it
  to your assistant.
- Hevy changed how its connection answers (Hevy says it may): your workouts wait in Hevy until
  godspeed-workouts is updated. Nothing is lost.
- The notebook refused a workout, or the add-on stopped with an error of its own.

Hevy or the notebook not answering for a while is never a message: nothing is lost, and the next
hour catches up. `godspeed-workouts status` shows all of it.

## Commands

```
godspeed-workouts status      what it did last, the tracker, the hourly run, any problem
godspeed-workouts run         bring the notebook level with Hevy now (--full: read everything again)
godspeed-workouts connect     a new Hevy key (HEVY_API_KEY, piped in, or typed), then a run
godspeed-workouts settings    show, or set <name> <value>
godspeed-workouts uninstall   remove the hourly run; the tracker and its rows stay
```

Settings: `tracker` and `names` (the tracker's name and other names, when it is made), `talks`
(coaching talks that read it, when it is made), `minute` (1 to 58), `timezone` (null: the
notebook's), `tell` (telegram, desktop, or both), `telegram_env`, `workspace`, and every message's
words as `texts.<name>`.

## Your key and your data

The key lives in one file in the add-on's private state folder (`/var/lib/godspeed/workouts` on a
server, `~/.godspeed/workouts` elsewhere), readable by you only. It is never printed, logged, sent
or written into the notebook. Your workouts go from Hevy to your own notebook and nowhere else.
