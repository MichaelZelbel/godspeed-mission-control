# tools

Eighteen small programs. The installer puts them on your computer. **They are not
part of your hub folder, and that is deliberate.**

Chapter 3 says your hub is a folder of text files and that nothing in it needs a
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
  Chapters 20 and 31.

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
  covers a job you have a week for and one you have a year for. Chapter 27.

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
hub-check-built-on                      every fact that changed
hub-check-built-on --claim me/city      one fact
```

Run it in your hub folder. The idea is from Rich Schefren's open-source Atlas, which
does this with a graph database; here it is a search over text files, which is what a
hub is made of.

- **`check-brief.js`** is the bouncer for the morning brief (Chapter 22). Before a
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
  only comparison that means anything. Chapter 20.
- **`work.js`** (`hub-work`) tracks what your hub is doing, and keeps three states
  apart that a to-do list treats as one: dispatched, attempted, and verified. Only
  verified closes an item, and "the runner said it did it" is not verified. A
  duplicate trigger files nothing twice; anything that reaches somebody else waits
  for your own words. Chapter 24.

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
  recipe writes one record for the day and files at most one thing for you. The
  recipe is in every hub from day one, at `skills/next-action/SKILL.md`, because
  the starter hub ships it; add one line to your schedule:

```
10 4 * * *  $HOME/.local/bin/hub-decide >> $HOME/.hub/decide.log 2>&1
```

Run `hub-decide --dry-run` any time to see the plan without deciding anything.

- **`hub-work-run`** carries out what `hub-decide` filed for the hub itself, one item
  per assistant run, twice a day. It takes the next runnable item under a lease,
  hands the assistant the item, the goal, how that goal is won (the playbook) and
  the newest diagnosis, records what the assistant says as ATTEMPTED, and runs the
  item's own CHECK: only that check makes it VERIFIED. A finished piece becomes a
  page and one card, through the ledger's own door. Its recipe ships in the starter
  hub too, at `skills/work-item/SKILL.md`; add two lines:

```
45 7  * * *  $HOME/.local/bin/hub-work-run >> $HOME/.hub/work.log 2>&1
10 13 * * *  $HOME/.local/bin/hub-work-run >> $HOME/.hub/work.log 2>&1
```

- **`hub-check-written`** is the check a written piece gets: the file is there, long
  enough, has every section it was asked for, no placeholder left, none of the words
  your `rules/machine-words.txt` bans. It is what lets "we found out X" close a work
  item without a person reading it first.

The last four belong to Chapter 28, "Give Your Hub a Notebook". **None of them does
anything unless you connect Menerio**, and a reader who never connects it can ignore all four.

- **`menerio-connect.js`** (`hub-menerio-connect`) connects your notebook **once**, for every
  assistant on this computer: Claude Code (`.mcp.json` in your hub), Hermes (its own settings)
  and Codex (its `config.toml`). It reads the key from your hub's locked store. It never asks
  for the key and never prints it. Every file it writes only names the key, as
  `${MENERIO_API_KEY}`. The one exception is a single line in Hermes' own `.env`, because the
  Hermes desktop app is not started from a terminal. It keeps everything else in those files,
  leaves a `.bak` copy, and leaves a connection you made by hand alone. The installer runs it
  for you when you connect Menerio. Its report has one line per assistant. One you do not
  have reads `not installed`, and that is fine. The last line reads
  `The notebook  answered. Your key works.` A connection gives you the notebook and "make a
  note". It does not copy your hub. That is a separate question, see `notebook-sync.py` below.

```
hub-menerio-connect            connect every assistant here, then test the connection
hub-menerio-connect --check    change nothing, only say how things are
```

  To switch everything off at once: in Menerio, open Settings, then API Keys, and revoke the
  key.

- **`search.js`** (`hub-search`) finds things in your hub. When your hub is copied to Menerio,
  it asks Menerio first, which searches by meaning and by words together. When there is no
  key, no network, or no good answer within eight seconds, it searches the files in your hub
  folder and says so on its last line. When your hub is not copied, it searches the files,
  and the last line says
  `source: local files (your hub is not copied to Menerio, so there was nothing to ask it)`.
  It always names files in your hub, never notes, and never `AGENTS.md`, which your assistant
  has read already. `starter-hub/AGENTS.md` tells your assistant to run it before it says
  that something is not in your hub.

```
hub-search the dentist         ask the notebook when your hub is copied there, else the files
hub-search --local the dentist search the files only
hub-search --limit 3 --json invoice reminder
```

- **`hub-mail.js`** (`hub-mail`) is the one mail tool your assistants share, with its three
  helpers `hub-mail-gmail.js`, `hub-mail-guide.js` and `hub-mail-wire.js`. Email is optional: the
  installer tells every assistant about the tool and connects nothing, and with nothing connected
  it only says `not connected`. `hub-mail connect agentmail` gives your hub its own address
  (Chapter 29). Gmail (Chapter 30) is connected by a step of the hub installer, with no command
  to type: `hub-mail-guide.js` opens Google's pages one at a time and says what to click on each,
  and you register your own small Google app, which belongs to you and nobody else. Then any
  assistant can search, read messages and attachments, and save draft replies in Gmail without
  asking again. An attachment is saved outside your hub folder, so it never enters your hub's
  history. Your hub sends nothing: you press Send in Gmail. Every message is handed over marked
  as untrusted text. What it cannot do: stop an assistant that has full control of your computer
  from misusing the connection (`../mail/README.md`).

```
hub-mail status                 which mailboxes answer, and what each may do
hub-mail connect agentmail      give the hub its own address
hub-mail connect gmail --guided the guided Gmail step, which the hub installer runs for you
hub-mail search [--gmail] words newest received mail, or mail matching the words
hub-mail attachment <id> [n]    fetch one Gmail attachment to a place outside the hub folder
hub-mail disconnect gmail       stop at once, and withdraw the permission at Google
hub-mail pending, approve <code>  an extra for people who would rather approve a send at a
                                terminal than press Send in Gmail; the book does not use it
hub-mail setup                  tell every assistant on this computer about the tool
```

- **`notebook-sync.py`** is the mirror, and it runs only when you said yes. The installer asks
  `Copy your hub's files to Menerio for search?` and the default answer is no. The answer is
  kept per computer, as one line in `~/.hub/device.env`: `HUB_NOTEBOOK_MIRROR=1` for yes,
  `HUB_NOTEBOOK_MIRROR=0` for no. No line means no. To change it, run the Menerio step of the
  installer again. On a yes, it sends a copy of every Markdown file git tracks in your hub up
  to your notebook, into one folder called `hub`. Each decision in `decisions.md`
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

`hub-notebook-sync` runs them by itself: whenever you save a change, and once an hour. It
runs the mirror and the pull only when `HUB_NOTEBOOK_MIRROR=1`. It also hands a
replaced key to Hermes. You can run them by hand to look:

```
python3 ~/.local/bin/notebook-sync.py              # dry run, shows what it would send
python3 ~/.local/bin/notebook-sync.py --apply

python3 ~/.local/bin/world-pull.py                 # dry run, shows what it would write
python3 ~/.local/bin/world-pull.py --apply
```

`notebook-sync.py --apply` reads your answer too. With the hub copy switched off it sends
nothing and says so. Without `--apply` it only shows a plan.

`--apply` needs the key in your terminal. The installer teaches every new terminal the key.
In a terminal that was open before, load it by hand:

```
eval "$(hub-notebook-env)"
```

`hub-notebook.js` is not a command. It is the part `hub-search` and `hub-menerio-connect`
share: where your hub is, how the key is read, whether the mirror is on, and which files it
covers.

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
your own computer, which means a terminal tool: Chapters 32 and 36. Claude Desktop,
the desk from Chapter 2, keeps no such store. If that is your only tool, this finds
nothing, `prompts/archive/` stays empty, and nothing is broken. Use
`prompts/library/` next door and save the prompts you care about as you go.

## Why they are in this repository and not in `starter-hub/`

Because a reader who never opens a terminal should never have a Node program and a
Python program sitting in the folder they were told is theirs to read. The kit's
`starter-hub/` is what your hub is *made of*. This folder is what the installer
*puts on the machine*. Two different things, kept apart on purpose.
