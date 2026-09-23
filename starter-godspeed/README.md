# Starter godspeed

This folder is your personal AI system. The book's installer (Chapter 3)
lays everything inside `starter-godspeed` into your `godspeed` folder for you;
Appendix D is the by-hand road, a copy into an empty `godspeed` folder.
Point your assistant at the result. Chapter 4 of the book walks through
the layout; Parts II and III fill it up.

**The folder names answer one question: when does your assistant read this?**
That is the only thing that separates them, and it is the thing that decides
everything. Some of it has to be in front of your assistant every single time,
because it cannot look up a rule it does not know exists. The rest can wait
until its subject comes up, which is what keeps the first part small.

    profile/       what it knows because you told it ...... every session
    rules/         how it should behave .................... compiled into AGENTS.md
    observations/  what it worked out on its own ........... when the subject comes up
    prompts/       what you typed to an AI ................. never, unless you ask

What is here. Thirteen names, and they are the whole system:

- `AGENTS.md`: your AI's operating manual. How to work in this folder, and the
  short list of your rules. Hermes reads it by name at the start of every
  conversation, so nothing needs installing. Chapter 17 is where you write
  your own rules into it. (The one-line `CLAUDE.md` beside it is a signpost
  for a developer tool; Chapter 5 explains it, and Hermes never reads it.)
- `profile/`: who you are, your people, your projects, your voice. The
  Part II files. You write these.
- `rules/`: one file per rule, holding the whole story of why you gave it.
  Eight are pre-loaded, and they are your red lines. The one-line version of
  each is written into `AGENTS.md` by `mc-compile-rules`, which is the
  only rules text your assistant reads every session. You edit the files; you
  never edit that block. Chapter 17.
- `skills/`: one folder per recipe, each with a `SKILL.md` inside. Two are
  here from day one, `next-action` and `work-item`: the first decides what your
  godspeed does about your goals each day, the second carries out one piece of that
  work. Chapter 7 shows them working; you never have to read them. The
  installer has already told Hermes where this room is, so a recipe you put
  here is found without you naming it. Chapters 12 to 14 fill it further, and
  the five starter recipes are in the kit download beside this folder, ready
  to copy in when you want them. The hidden `.claude/skills/` is a link the
  installer points at this room, never a second home.
- `procedures.md`: the register. Everything that runs without you.
- `decisions.md`: append-only log of real decisions.
- `inbox/`: where loose captures land between weekly reviews.
- `observations/`: what your assistant works out about you and writes down
  itself, one file per fact, with a page called `MEMORY.md` that it
  reads at the start of a session and that tells it where everything goes.
  You write `profile/`, it writes this. It starts empty and fills up on its
  own. Chapter 9.
- `prompts/`: what you typed to an AI. **Your assistant never reads this
  folder on its own**, it only searches it when you ask, and that rule is
  what makes it safe to keep. Two drawers, each with its own README:
  `prompts/library/` holds the prompts you keep and paste into other
  tools, and `prompts/archive/` is the log of everything you have typed.
  Chapters 13 and 31.
- `goals/`: what you want, one card each, and who gets attention today. An
  outcome, a strategy or project meant to produce one, or a protected
  commitment. A new idea is filed **provisional** and is never worked on until
  you adopt it. Starts empty.
- `forecasts/`: what your mission control expects to happen, with a date and a number, so
  its judgment can be scored instead of trusted. Starts empty.
- `work/`: what your mission control is doing, from planned to verified, where "the runner
  says it did it" and "somebody checked" are two different states. Starts empty.
- `world/`: your assistant's record of people, events and facts you tell it.
  It saves and searches these files without Menerio. An optional Menerio
  connection can add imported records. `world/README.md` explains the formats.

Nothing here needs a terminal. It is a folder of text files, and that is
the point.
