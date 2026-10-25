# godspeed-headache: a headache diary you talk to

**Say it the way you would say it to a friend, typed or as a voice message, and your mission control keeps the log.** An add-on for [Godspeed Mission Control](https://github.com/MichaelZelbel/godspeed-mission-control) from [*Teach It Once*](https://leanpub.com/teachitonce).

> Headache since half past six, right side, pounding, about a 3. Took two Thomapyrin.

> Headache's gone.

> Track headache: took another Thomapyrin at eight.

Starting with "track" is optional, and it is the word to use when you dictate: speech recognition
hears "track" reliably and often turns "log" into "look". In a mission control with the Godspeed
notebook's trackers, the tracker recipe takes every message that starts with "track" and hands a
headache to this one.

That is the whole diary. No app to open, no menus, no form. Months later, ask what the pattern
is, and the answer comes from what you said.

## Why it exists

Headache apps want you to tap through a dozen screens while your head hurts, and most of them
keep what you logged to themselves. A diary only works if logging costs nothing, and a pattern
only shows up if the data sits next to the rest of your life: sleep, food, runs. So this one is
a sentence to your assistant, and every entry is a small text file in your own mission control.

## What it is

- **One command**, `godspeed-headache`: `start`, `log` (a finished headache), `set` (more detail),
  `med`, `end`, `cancel`, `open`, `list`, `patterns`, `daily`, `config`, `migrate`.
- **One recipe**, `headache-tracker`, copied into your mission control's skills folder. It tells
  your assistant how to turn a sentence into a command, and to confirm in one line and say
  nothing else: no advice, no sympathy paragraph.
- **A Hermes plugin** that shows your assistant the headache that is still going before it
  reads your message, so "it's over" lands on the right one. A **Claude Code hook** does the
  same at the desk.
- **In the notebook, one row per headache.** In a mission control with the Godspeed notebook
  (a `notebook/` folder and its `.godspeed/` state), the diary is the notebook's **Headaches
  tracker**: a collection with one row per headache (started, ended, minutes, strongest and first
  pain, where, what it felt like, symptoms, possible trigger, every pill with its time when you
  said one, your own words) and one row per pill taken with no headache going on. You can sort and edit it in the
  notebook like any table, and the next command reads your edit. The command writes the rows as
  the notebook writes its records, under the notebook's own writer lock.
- **Without the notebook, entries, never edits.** Every sentence becomes one file under
  `routines/headache/entries/`. A headache is computed from the files that name it: its start, a
  pain level added later, the pills, its end. Two devices never write the same file, so git never
  has a conflict.
- **Moving the entries into the notebook**: `godspeed-headache migrate` (try `--dry-run` first).
  It writes every headache as a row, reads the rows back and compares every headache field by
  field and every day of the whole history (headaches, minutes, strongest pain, painkiller doses)
  with the entry files. Any difference takes the rows away again and the entry files stay the
  diary. Only when everything is the same do the entry files move to `archives/`; a small file
  named `entries` in their place stops an older `godspeed-headache` from starting a second diary.

## What it records

Start and end time, pain from 0 to 10 (only when you give a number), side (left, right, both,
front, back, neck, temples, eye), what it feels like (pounding, stabbing, pressing, dull,
burning), other symptoms (nausea, light sensitivity, aura), triggers you name, and every
medicine with its dose and time. German words are understood (links, rechts, pochend, stechend).

## What it finds

`godspeed-headache patterns` over any number of days: how many headaches and on how many days,
typical length, strongest pain, time of day, weekday, side, kind, triggers, which medicines, how
long from the first pill to the end (for pills whose time you said), and your **painkiller days in any 30**, against the limit
where frequent painkillers start causing headaches themselves (10 days a month for combination
painkillers, 15 for plain ones). With a daily health table (`daily_table` in the settings), it
compares headache days with free days, column by column, once each side has five days.
`godspeed-headache daily --csv` gives one row per day for your own table.

## Install

Godspeed Mission Control brings this add-on with it: its installers put the `godspeed-headache`
command next to its other commands, copy the recipe into your skills folder and wire the Hermes
plugin. There is nothing more to install.

To add it to a mission control folder of your own by hand, run its setup from a copy of Godspeed
Mission Control:

```
git clone --depth 1 https://github.com/MichaelZelbel/godspeed-mission-control.git
node godspeed-mission-control/third-party/addons/godspeed-headache/bin/godspeed-headache.mjs setup --godspeed <your mission control folder>
```

> Assistant: run that setup line with `--godspeed <this mission control folder>` and pass its
> questions to the person.

It finds your mission control, copies the recipe, writes the settings (time zone, language),
puts the command next to the kit's other commands, wires the Hermes plugin and the Claude Code
hook when they are there, and runs `godspeed-headache check`. Run it again any time; it keeps
your settings and touches nothing else. You need Node.js 22 or newer.

On Windows it also writes a PowerShell launcher next to the command, so a call from PowerShell
hands your words over exactly as given, line breaks, quotes and umlauts included. cmd.exe cannot
carry a line break (it stops reading at the first one and drops the rest), so a command that
reaches the diary cut short through it is refused, never half saved. Where PowerShell is set
to run no scripts at all, setup says so and leaves that launcher out; words that run over
several lines then go in with `--words-file`.

## Use

Talk to your assistant:

> Kopfschmerzen seit 6:30, rechts, stechend, so eine 4

> took 2 Thomapyrin 20 minutes ago

> headache over

> I had a headache yesterday from 22:00 to 1:15, both sides, a 2

> how many painkiller days did I have this month?

Or type the command yourself:

```
godspeed-headache start --at 06:30 --pain 4 --side right --quality stabbing
godspeed-headache med "Thomapyrin Intensiv" --dose "2 tablets" --taken -20m
godspeed-headache end
godspeed-headache log --from "yesterday 22:00" --to 01:15 --pain 2 --side both
godspeed-headache list --days 30
godspeed-headache patterns --days 90
godspeed-headache daily --csv

# words that run over several lines, from any shell: put them in a file first
godspeed-headache start --at 06:30 --words-file words.txt
```

Times are what you would say: `06:30`, `yesterday 22:00`, `2026-09-26 22:00`, `-30m`, `2 h ago`.
A time later than now means yesterday; an end before its start means the next day.

## Settings

`routines/headache/settings.json`, shown by `godspeed-headache config show`:

- `timezone`, `language` (en or de)
- `overuse_days`: painkiller days in 30 at which the recipe mentions it, default 10
- `daily_table`, `daily_columns`: a CSV with a `date` column in your mission control, and the
  numeric columns to compare on headache and free days
- `git_sync`: auto (commit and push each entry), commit, or off. It works per mission control
  folder in effect: one push sends every local commit, so commit-only entries go out with the next
  push of an add-on set to auto. An entry that cannot be committed or pushed straight away waits in
  git's own folder and goes out with the next save.

## What it is not

A doctor. It keeps what you said and counts it. It never tells you what to take.
