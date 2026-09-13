# tools

Fifteen small programs. The installer puts them on your computer. **They are not
part of your hub folder, and that is deliberate.**

Chapter 4 says your hub is a folder of text files and that nothing in it needs a
terminal. That stays true. These are software, like your assistant is software, so
they live where software lives on your computer and they write into the folder from
the outside.

## What they are

- **`prompt-harvest.js`** starts the job. It works out where your hub is, finds a
  working Python, runs the collector, saves the result into your hub and pushes it.
  Every run also leaves a receipt at `prompts/archive/status/<your machine>.json`
  saying whether it worked, which hub it found and what went wrong if anything did.
  That file is the only way to tell "there was nothing new to save today" apart from
  "this has not run in a week", which otherwise look identical from anywhere else.
- **`hub-prompt-archive`** is the collector, and the interesting one. It reads the
  conversation logs your AI tools keep on this computer, takes the turns a human
  typed and the reply the AI showed for each of them, removes anything that looks
  like a password or a private name, and writes what is left into
  `prompts/archive/` in your hub. It never keeps the AI's internal machinery, only
  text you actually saw, so you can later ask "what was that answer again" as well
  as "what did I type".

Together they are the program Chapter 4 and Chapter 31 mean when they say
*"a program fills it"*.

The third one is the only one here you type yourself.

- **`compile-rules.js`** takes the one-line version of each rule in `rules/` and
  writes them all into `AGENTS.md`, between two markers, so your assistant reads
  your whole rulebook at the start of every session without reading a page per
  rule. You edit the files; you never edit the block. It refuses to write past
  4,000 characters, which is fifteen to twenty rules, and tells you which of your
  lines are longest instead. That refusal is the point of it. Chapter 17.

The installer gives it a launcher, so the command is:

```
hub-compile-rules            rewrite the block in AGENTS.md
hub-compile-rules --check    say whether it is out of date, change nothing
```

Run that in your hub folder. It was a Python program called `compile-rules.py`
until 2026-08-21, and the book printed it as `python3 tools/compile-rules.py`,
a path nobody has, for a language this installer never installs.

The fourth one you also type yourself, and it answers a question nothing else asks.

- **`check-keys.js`** looks at the keys your hub folder is carrying and asks whether
  they are really **on this computer**, which is a different question from whether
  they are in the folder. It also reads `secrets/expires.txt` and tells you if one
  of them is about to run out. It never prints a key: names, dates and counts only.
  Chapters 24 and 27.

The installer gives it a launcher, so the command is:

```
hub-check-keys               check this computer
hub-check-keys --hub PATH    check a hub somewhere else
```

It answers four questions and the third is the useful one: *would a program you
start right now actually get them?* On Windows it reads the list every new program
inherits, and it compares what is there against what is in your folder, so a key
that was replaced and never copied over shows up as the old one rather than as
fine. On a Mac or Linux it starts a fresh terminal and looks at what that terminal
ends up holding.

The fifth is the one you will type most often.

- **`due.js`** holds everything in your life that has a last day: a tax return, a
  timesheet, a contract you have to cancel by March, a key that dies in a year.
  Each one stores the first day you can do it and the last day you still can, and
  how loud your hub gets follows how much of that window is left, so one rule
  covers a job you have a week for and one you have a year for. Chapter 33.

The installer gives it a launcher, so the command is:

```
hub-due                     everything, loudest first
hub-due today               at most three, which is what your morning brief reads
hub-due add <name> ...      make one
hub-due done <name>         you did it
hub-due check               close whatever can prove itself done
```

Two things about it are worth knowing before you use it. It **refuses anything
without both dates**, in those words, which is the only thing between
this and a to-do app you abandon. And it reads `secrets/expires.txt` as one of
its sources, so the key dates from Chapter 27 are in the same list as everything
else and there is one thing nagging you rather than two that disagree.

It needs no Google account and no calendar, and nothing in the program can reach
one.

The sixth you type when a fact changes, or your assistant types it for you.

- **`check-built-on.js`** answers a question the notebook cannot: when a fact in
  `world/` stopped being true, what did you write while it still held? It reads every
  claim that carries an end date and searches `profile/`, `rules/`, `procedures.md` and
  `AGENTS.md` for the old value, whole word, any case, and names each line. A file can
  also say what it depends on, with a `rests_on: [subject/attribute]` line at the top,
  and is then found even when the old value is paraphrased. A line that carries the date
  the fact ended is history and is never reported. It changes nothing: you decide whether
  a line is stale or is history. The same chapter as the pull below.

The installer gives it a launcher, so the command is:

```
hub-check-built-on                      every fact that changed
hub-check-built-on --claim me/city      one fact
```

Run it in your hub folder. The idea is from Rich Schefren's open-source Atlas, which
does this with a graph database; here it is a search over text files, which is what a
hub is made of.

- **`check-brief.js`** is the bouncer for the morning brief (Chapter 21). Before a
  brief is written or sent, it reads the text and refuses two shapes: a file path
  where the thing itself should be ("open skills/x.md and paste it" is a dead errand
  on a phone), and "read it" with nothing to read. A line that starts with
  "Sources:" may still name its file; provenance is allowed, errands are not. The
  recipe in `procedures/morning-brief-setup.md` runs it before every brief, because
  a promise written in a recipe can be forgotten by a session and a check cannot.

```
hub-check-brief brief/2026-09-06.md       refuse or pass one brief
```

The next five are one job between them: **the day's decision.** They are the
difference between a hub that answers when you ask and a hub that works out what
to do before you wake up. Each is useful on its own, and each says so plainly when
one of the others is not installed.

- **`goals.js`** (`hub-goals`) holds what you want, one card per goal: an outcome,
  a strategy or project meant to produce one, or a commitment that is protected
  whatever else is going on. A new idea is filed **provisional**, which means your
  hub never works on it and may ask you one clarifying question about it in seven
  days. Your silence is never a yes. Every change keeps its reason, and reaches
  the plans underneath it. `hub-goals attention` says which goals get attention
  today and **why on every row**, with no score anywhere in it. Chapter 6.
- **`forecast.js`** (`hub-forecast`) holds what your hub expects to happen, with a
  date and a number, so its judgment can be scored rather than trusted. It refuses
  invented precision, a forecast with no reference class, and a revision that
  would overwrite history. `hub-forecast score` counts each question once and puts
  the score beside the plain historical baseline the forecast named, which is the
  only comparison that means anything. Chapter 19.
- **`work.js`** (`hub-work`) tracks what your hub is doing, and keeps three states
  apart that a to-do list treats as one: dispatched, attempted, and verified. Only
  verified closes an item, and "the runner said it did it" is not verified. A
  duplicate trigger files nothing twice; anything that reaches somebody else waits
  for your own words. Chapter 23.

```
hub-goals attention          who gets attention today, and why
hub-forecast score           how good your hub's predictions have been
hub-work tick                dead leases, due retries, stale plans
```

- **`hub-run`** carries out one recipe from your hub with nobody sitting at the
  computer, through whichever assistant this machine has: Hermes, Claude Code or
  Codex. The recipe stays a recipe. The program that runs it is one line of
  configuration, so changing assistant does not turn every scheduled job into
  rubble.
- **`hub-decide`** is the one that ties them together, once a day. It moves time
  on the work tracker, works out the attention plan, lists the forecasts that have
  come due, then runs your `next-action` recipe with all of it in front of it. The
  recipe writes one record for the day and files at most one thing for you. Copy
  `skills/next-action.md` from this kit into `skills/next-action/SKILL.md` in your
  hub first, then add one line to your schedule:

```
10 4 * * *  $HOME/.local/bin/hub-decide >> $HOME/.hub/decide.log 2>&1
```

Run `hub-decide --dry-run` any time to see the plan without deciding anything.

The last two are the two arrows in Chapter 25's diagram. **Neither runs unless you
connect a notebook**, and a reader who never connects one can ignore both.

- **`notebook-sync.py`** sends copies of your hub files up to your notebook so you
  can search them by meaning instead of by exact word (Chapter 26). It sends
  `observations/`, `skills/` and each decision in `decisions.md` separately. It does not
  send `profile/` or `AGENTS.md`, because your assistant reads those at the start of
  every session anyway, and a search result that repeats what it is already reading
  is noise. Your files are never changed; the copies are.
- **`world-pull.py`** brings the other direction down: the people, dated things and
  facts your notebook knows, written into `world/` as small files so they survive
  without the notebook. It rewrites only the files marked `origin: menerio` and
  never touches one you wrote.

```
python3 ~/.local/bin/notebook-sync.py              # dry run, shows what it would send
python3 ~/.local/bin/notebook-sync.py --apply

python3 ~/.local/bin/world-pull.py                 # dry run, shows what it would write
python3 ~/.local/bin/world-pull.py --apply
```

Both need one thing in your environment first, the key you made in Chapter 26:

```
export MENERIO_API_KEY=your-key-here
```

## What you do with them

For the two prompt programs, nothing. The installer schedules them and they run on
their own. Everything you ever do with the result is to ask your assistant, in words:

```
Search my prompt log for the one about the invoice reminder.
```

If you want to prove they work rather than wait a day, run `hub-prompt-harvest`
once from a terminal and read what it says.

## You choose which tools are read

The installer shows you which AI tools it found on your computer and lets you
untick any of them. Your choice is kept on that machine, in `~/.hub/device.env`
on a line like `HUB_PROMPT_SOURCES=claude,codex`. A tool not on the list is not
read at all. To change your mind later, edit that line or run the installer
again. An empty value (or `-`) means nothing is read on that machine.

## The honest limit

They can only harvest from an AI tool that keeps your conversations as files on
your own computer, which means a terminal tool: Chapters 28 and 30. Claude Desktop,
the desk from Chapter 3, keeps no such store. If that is your only tool, this finds
nothing, `prompts/archive/` stays empty, and nothing is broken. Use
`prompts/library/` next door and save the prompts you care about as you go.

## Why they are in this repository and not in `starter-hub/`

Because a reader who never opens a terminal should never have a Node program and a
Python program sitting in the folder they were told is theirs to read. The kit's
`starter-hub/` is what your hub is *made of*. This folder is what the installer
*puts on the machine*. Two different things, kept apart on purpose.
