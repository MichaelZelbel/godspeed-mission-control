# tools

Eighteen small programs. The installer puts them on your computer. **They are not
part of your mission control folder, and that is deliberate.**

Chapter 3 says your mission control is a folder of text files and that nothing in it needs a
terminal. That stays true. These are software, like your assistant is software, so
they live where software lives on your computer and they write into the folder from
the outside.

## What they are

- **`prompt-harvest.js`** starts the job. It works out where your mission control is, finds a
  working Python, runs the collector, saves the result into your mission control and pushes it.
  Every run also leaves a receipt at `prompts/archive/status/<your machine>.json`
  saying whether it worked, which mission control it found and what went wrong if anything did.
  That file is the only way to tell "there was nothing new to save today" apart from
  "this has not run in a week", which otherwise look identical from anywhere else.
- **`mc-prompt-archive`** is the collector, and the interesting one. It reads the
  conversation logs your AI tools keep on this computer, takes the turns a human
  typed and the reply the AI showed for each of them, removes anything that looks
  like a password or a private name, and writes what is left into
  `prompts/archive/` in your mission control. It never keeps the AI's internal machinery, only
  text you actually saw, so you can later ask "what was that answer again" as well
  as "what did I type".

Together they are the program Chapter 3 and Chapter 37 mean when they say
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
mc-compile-rules            rewrite the block in AGENTS.md
mc-compile-rules --check    say whether it is out of date, change nothing
```

Run that in your mission control folder. It was a Python program called `compile-rules.py`
until 2026-08-21, and the book printed it as `python3 tools/compile-rules.py`,
a path nobody has, for a language this installer never installs.

The fourth one you also type yourself, and it answers a question nothing else asks.

- **`check-keys.js`** looks at the keys your mission control folder is carrying and asks whether
  they are really **on this computer**, which is a different question from whether
  they are in the folder. It also reads `secrets/expires.txt` and tells you if one
  of them is about to run out. It never prints a key: names, dates and counts only.
  Chapters 20 and 31.

The installer gives it a launcher, so the command is:

```
mc-check-keys               check this computer
mc-check-keys --godspeed PATH    check a mission control somewhere else
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
  how loud your mission control gets follows how much of that window is left, so one rule
  covers a job you have a week for and one you have a year for. Chapter 27.

The installer gives it a launcher, so the command is:

```
mc-due                     everything, loudest first
mc-due today               at most three, which is what your morning brief reads
mc-due add <name> ...      make one
mc-due done <name>         you did it
mc-due check               close whatever can prove itself done
```

Two things about it are worth knowing before you use it. It **refuses anything
without both dates**, in those words, which is the only thing between
this and a to-do app you abandon. And it reads `secrets/expires.txt` as one of
its sources, so the key dates from Chapter 31 are in the same list as everything
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
mc-check-built-on                      every fact that changed
mc-check-built-on --claim me/city      one fact
```

Run it in your mission control folder. The idea is from Rich Schefren's open-source Atlas, which
does this with a graph database; here it is a search over text files, which is what a
mission control is made of.

- **`check-brief.js`** is the bouncer for the morning brief (Chapter 22). Before a
  brief is written or sent, it reads the text and refuses two shapes: a file path
  where the thing itself should be ("open skills/x.md and paste it" is a dead errand
  on a phone), and "read it" with nothing to read. A line that starts with
  "Sources:" may still name its file; provenance is allowed, errands are not. The
  recipe in `procedures/morning-brief-setup.md` runs it before every brief, because
  a promise written in a recipe can be forgotten by a session and a check cannot.

```
mc-check-brief brief/2026-09-06.md       refuse or pass one brief
```

The next five are one job between them: **the day's decision.** They are the
difference between a mission control that answers when you ask and a mission control that works out what
to do before you wake up. Each is useful on its own, and each says so plainly when
one of the others is not installed.

- **`goals.js`** (`mc-goals`) holds what you want, one card per goal: an outcome,
  a strategy or project meant to produce one, or a commitment that is protected
  whatever else is going on. A new idea is filed **provisional**, which means your
  mission control never works on it and may ask you one clarifying question about it in seven
  days. Your silence is never a yes. Every change keeps its reason, and reaches
  the plans underneath it. `mc-goals attention` says which goals get attention
  today and **why on every row**, with no score anywhere in it. Chapter 6.
- **`forecast.js`** (`mc-forecast`) holds what your mission control expects to happen, with a
  date and a number, so its judgment can be scored rather than trusted. It refuses
  invented precision, a forecast with no reference class, and a revision that
  would overwrite history. `mc-forecast score` counts each question once and puts
  the score beside the plain historical baseline the forecast named, which is the
  only comparison that means anything. Chapter 20.
- **`work.js`** (`mc-work`) tracks what your mission control is doing, and keeps three states
  apart that a to-do list treats as one: dispatched, attempted, and verified. Only
  verified closes an item, and "the runner said it did it" is not verified. A
  duplicate trigger files nothing twice; anything that reaches somebody else waits
  for your own words. Chapter 24.

```
mc-goals attention          who gets attention today, and why
mc-forecast score           how good your mission control's predictions have been
mc-work tick                dead leases, due retries, stale plans
```

- **`mc-run`** carries out one recipe from your mission control with nobody sitting at the
  computer, through whichever assistant this machine has: Hermes, Claude Code or
  Codex. The recipe stays a recipe. The program that runs it is one line of
  configuration, so changing assistant does not turn every scheduled job into
  rubble.
- **`mc-decide`** is the one that ties them together, once a day. It moves time
  on the work tracker, works out the attention plan, lists the forecasts that have
  come due, then runs your `next-action` recipe with all of it in front of it. The
  recipe writes one record for the day and files at most one thing for you. The
  recipe is in every mission control from day one, at `skills/next-action/SKILL.md`, because
  the starter mission control ships it; add one line to your schedule:

```
10 4 * * *  $HOME/.local/bin/mc-decide >> $HOME/.godspeed/decide.log 2>&1
```

Run `mc-decide --dry-run` any time to see the plan without deciding anything.

- **`mc-work-run`** carries out what `mc-decide` filed for the mission control itself, one item
  per assistant run, twice a day. It takes the next runnable item under a lease,
  hands the assistant the item, the goal, how that goal is won (the playbook) and
  the newest diagnosis, records what the assistant says as ATTEMPTED, and runs the
  item's own CHECK: only that check makes it VERIFIED. A finished piece becomes a
  page and one card, through the ledger's own door. Its recipe ships in the starter
  mission control too, at `skills/work-item/SKILL.md`; add two lines:

```
45 7  * * *  $HOME/.local/bin/mc-work-run >> $HOME/.godspeed/work.log 2>&1
10 13 * * *  $HOME/.local/bin/mc-work-run >> $HOME/.godspeed/work.log 2>&1
```

- **`mc-check-written`** is the check a written piece gets: the file is there, long
  enough, has every section it was asked for, no placeholder left, none of the words
  your `rules/machine-words.txt` bans. It is what lets "we found out X" close a work
  item without a person reading it first.

The last four belong to Chapter 28, "Give Your Godspeed a Notebook". **None of them does
anything unless you connect Menerio**, and a reader who never connects it can ignore all four.

- **`menerio-connect.js`** (`mc-menerio-connect`) connects your notebook **once**, for every
  assistant on this computer: Claude Code (`.mcp.json` in your mission control), Hermes (its own settings)
  and Codex (its `config.toml`). It reads the key from your mission control's locked store. It never asks
  for the key and never prints it. Every file it writes only names the key, as
  `${MENERIO_API_KEY}`. The one exception is a single line in Hermes' own `.env`, because the
  Hermes desktop app is not started from a terminal. It keeps everything else in those files,
  leaves a `.bak` copy, and leaves a connection you made by hand alone. The installer runs it
  for you when you connect Menerio. Its report has one line per assistant. One you do not
  have reads `not installed`, and that is fine. The last line reads
  `The notebook  answered. Your key works.` A connection gives you the notebook and "make a
  note". It does not copy your mission control. That is a separate question, see `notebook-sync.py` below.

```
mc-menerio-connect            connect every assistant here, then test the connection
mc-menerio-connect --check    change nothing, only say how things are
```

  To switch everything off at once: in Menerio, open Settings, then API Keys, and revoke the
  key.

- **`search.js`** (`mc-search`) finds things in your mission control. When your mission control is copied to Menerio,
  it asks Menerio first, which searches by meaning and by words together. When there is no
  key, no network, or no good answer within eight seconds, it searches the files in your mission control
  folder and says so on its last line. When your mission control is not copied, it searches the files,
  and the last line says
  `source: local files (your mission control is not copied to Menerio, so there was nothing to ask it)`.
  It always names files in your mission control, never notes, and never `AGENTS.md`, which your assistant
  has read already. `starter-godspeed/AGENTS.md` tells your assistant to run it before it says
  that something is not in your mission control.

```
mc-search the dentist         ask the notebook when your mission control is copied there, else the files
mc-search --local the dentist search the files only
mc-search --limit 3 --json invoice reminder
```

- **`mc-mail.js`** (`mc-mail`) is the one mail tool your assistants share, with its helpers
  `mc-mail-imap.js` (Gmail through Himalaya), `mc-mail-gmail.js` (the locked store, and Gmail
  connections made the older way) and `mc-mail-wire.js` (telling each assistant about the tool).
  Email is optional: the installer tells every assistant about the tool and connects nothing,
  and with nothing connected it only says `not connected`. `mc-mail connect agentmail` gives
  your mission control its own address (Chapter 29). Gmail (Chapter 30) is connected when you ask your
  assistant *Connect Gmail for me*: the mission control fetches Himalaya 2.1.0 (pinned by its SHA-256 in
  `mc-mail-himalaya.json`), and you type a Google app password in a window of your own
  computer, never in a chat. Then any assistant on that computer can search, read a message and
  save a new draft in Gmail without asking again. Your mission control sends nothing: you press Send in
  Gmail. Every message is handed over marked as untrusted text. What it cannot do: stop an
  assistant that has full control of your computer from misusing the app password
  (`../mail/README.md`).

```
mc-mail status [--check]       which mailboxes answer, through what, and what each may do
mc-mail connect gmail-imap     connect Gmail on this computer (the app password is typed in a window)
mc-mail connect agentmail      give the mission control its own address
mc-mail search [--godspeed] words   newest Gmail (or, with --godspeed, the mission control's own address)
mc-mail disconnect gmail       stop using Gmail on this computer
mc-mail setup [--check]        tell every assistant on this computer about the tool (--check: start each one)
```

- **`notebook-sync.py`** is the mirror, and it runs only when you said yes. The installer asks
  `Copy your mission control's files to Menerio for search?` and the default answer is no. The answer is
  kept per computer, as one line in `~/.godspeed/device.env`: `GODSPEED_NOTEBOOK_MIRROR=1` for yes,
  `GODSPEED_NOTEBOOK_MIRROR=0` for no. No line means no. To change it, run the Menerio step of the
  installer again. On a yes, it sends a copy of every Markdown file git tracks in your mission control up
  to your notebook, into one folder called `godspeed`. Each decision in `decisions.md`
  goes as its own note. It leaves out `dev/`, anything your `.gitignore` keeps out, records in
  `world/` that came down from Menerio, a few generated index pages, and any file over 300 KB
  (it names those). Each copy says in its first line which file it is a copy of. Menerio ranks
  the copies below your own notes, never mines them for facts, and never exports them as
  files. Your files are never changed; the copies are. It sends a file again only when the
  file changed.
- **`world-pull.py`** brings the other direction down: the people, dated things and
  facts your notebook knows, written into `world/` as small files so they survive
  without the notebook. It rewrites only the files marked `origin: menerio` and
  never touches one you wrote. It follows the same answer as the mirror: with a no, it
  does not run.

`mc-notebook-sync` runs them by itself: whenever you save a change, and once an hour. It
runs the mirror and the pull only when `GODSPEED_NOTEBOOK_MIRROR=1`. It also hands a
replaced key to Hermes. You can run them by hand to look:

```
python3 ~/.local/bin/notebook-sync.py              # dry run, shows what it would send
python3 ~/.local/bin/notebook-sync.py --apply

python3 ~/.local/bin/world-pull.py                 # dry run, shows what it would write
python3 ~/.local/bin/world-pull.py --apply
```

`notebook-sync.py --apply` reads your answer too. With the mission control copy switched off it sends
nothing and says so. Without `--apply` it only shows a plan.

`--apply` needs the key in your terminal. The installer teaches every new terminal the key.
In a terminal that was open before, load it by hand:

```
eval "$(mc-notebook-env)"
```

`mc-notebook.js` is not a command. It is the part `mc-search` and `mc-menerio-connect`
share: where your mission control is, how the key is read, whether the mirror is on, and which files it
covers.

## What you do with them

For the two prompt programs, nothing. The installer schedules them and they run on
their own. Everything you ever do with the result is to ask your assistant, in words:

```
Search my prompt log for the one about the invoice reminder.
```

If you want to prove they work rather than wait a day, run `mc-prompt-harvest`
once from a terminal and read what it says.

## You choose which tools are read

Four tools can be read: Claude Code, Codex, Hermes and OpenCode. The installer
shows a tick box for each one it finds on your computer, and on a computer that
never had a mission control every box starts unticked. Your choice is kept on that machine,
in `~/.godspeed/device.env` on a line like `GODSPEED_PROMPT_SOURCES=claude,codex`. A tool
not on the list is not read at all. To change your mind later, edit that line or
run the installer again. An empty value (or `-`) means nothing is read on that
machine.

## The honest limit

They can only harvest from an AI tool that keeps your conversations as files on
your own computer, which means a terminal tool: Chapters 32 and 36. Claude Desktop,
the desk from Chapter 2, keeps no such store. If that is your only tool, this finds
nothing, `prompts/archive/` stays empty, and nothing is broken. Use
`prompts/library/` next door and save the prompts you care about as you go.

## Why they are in this repository and not in `starter-godspeed/`

Because a reader who never opens a terminal should never have a Node program and a
Python program sitting in the folder they were told is theirs to read. The kit's
`starter-godspeed/` is what your mission control is *made of*. This folder is what the installer
*puts on the machine*. Two different things, kept apart on purpose.
