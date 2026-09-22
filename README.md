# Teach It Once: Companion Kit

**Astronauts have mission control. This is how you build yours out of AI.**

**It is called Godspeed Mission Control. It answers to Godspeed, Mission Control and Speedy.**

A personal support system that lives in a folder you own. It runs on a clock and keeps watch over the parts of your life and work you hand it. It solves what it can while you sleep and messages you only when something matters. You stay the captain. Mine once sent me a podcast episode and the minute to start at, for a health problem I had mentioned months earlier. [Two and a half minutes on YouTube](https://www.youtube.com/watch?v=KiyhltKi2H8).

Not a dashboard. A dashboard shows screens and waits. This one acts, and it is the only AI you use that calls first.

This kit is Godspeed Mission Control itself, plus every template from the book **Teach It Once** by Michael Zelbel. The subtitle says what it is: *Set up a personal AI that knows you and works on its own*. It runs on your laptop with Hermes; developers can use Claude Code or OpenCode instead (`swap/`). An optional always-on server lives in `server/`. Everything the book asks you to copy, paste, fill in, or print is here, so you never have to type a template from a page.

## Let it set itself up

Whichever computer you use, one thing to run and no decisions to make. It works out for itself whether this machine needs a first setup or an update.

**On Windows:** **[download GodspeedSetup.exe](https://github.com/MichaelZelbel/teach-it-once-kit/releases/latest/download/GodspeedSetup.exe)** and double-click it. Nothing to type, no terminal.

**On a Mac or Linux:** open a terminal and paste this one line. (A terminal is the normal way to install things on those systems, which is why they get a line and Windows gets a file.)

```
curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/teach-it-once-kit/main/install-godspeed.sh | bash
```

Either one sets up your mission control with the `starter-godspeed/` folder below already in place. It installs the few things it needs underneath: Git, Node.js, and on Linux Hermes itself (on Windows it checks that Hermes Desktop is there). It also makes one memory that every machine you own shares. If that computer already has a mission control, it updates that one instead. Run it as often as you like; it never deletes anything you have written.

**Windows will warn you the first time.** You will see a blue box saying "Windows protected your PC", and at first the only button is *Don't run*. Click **More info**, then **Run anyway**. Windows shows this for any program whose publisher it has not seen enough copies of yet. It is not a virus warning and says nothing about whether the program is safe.

## How to get it by hand

No terminal needed: click the green **Code** button on GitHub and choose **Download ZIP**, then unpack it anywhere.

Later in the book, once your assistant is looking after the folder for you, it can keep this up to date with git instead:

```
git clone https://github.com/MichaelZelbel/teach-it-once-kit.git
```

## One AGENTS.md, read by Hermes, Claude Code, Codex and OpenCode

Your assistant's operating manual is one plain file, `starter-godspeed/AGENTS.md`. Hermes, Codex and OpenCode read it by name when they open the folder. For Claude Code the kit ships `starter-godspeed/CLAUDE.md`, and this is the whole file:

```
@AGENTS.md
```

Since version 2.1.277 (18 September 2026) Claude Code reads `AGENTS.md` on its own when a project has no `CLAUDE.md` ([changelog](https://code.claude.com/docs/en/changelog)). Older versions do not: checked on 2.1.270, which answered from `AGENTS.md` only with the one-line file in place. So the kit keeps that file. It works on every version, and it is the place for anything only Claude Code should read.

## What is where

- `starter-godspeed/`: the folder that becomes your own system. Copy this whole folder and it is your mission control. Everything else here fills it up. Three of its rooms are the ones that turn a folder of notes into something that decides: `goals/` (what you want, and who gets attention today), `forecasts/` (what your mission control expects to happen, dated and scored) and `work/` (what it is doing, where "it says it did it" and "somebody checked" are two different states). Each starts empty with a README explaining the format.
- `tools/`: the small programs the installer puts on your machine, outside your mission control. Among them `mc-search`, which finds things in your mission control (through your notebook when it is copied there, in the files when not), `mc-goals`, `mc-forecast` and `mc-work` for the three rooms above, `mc-decide`, which runs the day's decision once a day through whichever assistant you use, and `mc-work-run`, which carries out the work that decision filed, one item per assistant run, verified by each item's own check (`mc-check-written` for anything written). `tools/README.md` says what each one is for.
- `profile/`: Part II assets. The about-you template, the people and projects interviews, the voice extraction prompt, the capture and spring-clean checklists.
- `skills/`: Part III assets. The skill interview, the five starter recipes, the craft-skill interview, the test checklist, practice texts, and one big finished craft skill (`strip-ai-tells.md`) to see what a real one looks like. These are the book's teaching copies; in your own mission control a recipe lives at `skills/<name>/SKILL.md`. The two recipes the mission control runs by itself are not here: `next-action` and `work-item` ship inside `starter-godspeed/skills/`, so every mission control has them from day one. So does `keep-a-note`, the recipe behind "make a note" (Chapter 28). `mc-decide` carries out the first once a day, and `mc-work-run` carries out one filed item at a time with the second.
- `procedures/`: Part V and VI assets. Morning brief, weekly review, watchdog, the procedure register, the red lines, the card for keys that run out, and the card for everything else that runs out (`what-runs-out-and-when.md`).
- `living/`: the two-questions card, the privacy audit checklist, the saved-prompt card, the printable build-order card.
- `menerio/`: Part VI, optional. Chapter 28, "Give Your Mission Control a Notebook". You connect Menerio once, through the installer or with `mc-menerio-connect`, and Hermes, Claude Code and Codex all have it. That gives you the notebook, and "make a note" is filed there. Copying your mission control into it for search is a separate choice: the installer asks, and the default is no. On a yes, your whole mission control except `dev/` is mirrored into the notebook, where the copies rank below your own notes and are never mined for facts or exported as files, and `mc-search` asks Menerio first. On a no, nothing from your mission control is sent, and `mc-search` searches the files on your computer. A free account is enough: https://menerio.com/auth?tab=signup
- `mail/`: Part VI, optional. Chapters 29 and 30. Email for your mission control in three levels: paste, forward to its own address, or connect your Gmail once for every assistant (reading and drafts; nothing is sent until you approve the exact message). `mail/README.md` also says plainly what the approval does not protect against.
- `server/`: Part VI, optional. Scripts and guides for giving your system an always-on home.
- `swap/`: Part VI. Config examples for running the same system on a different company's tool and model.

Appendix A of the book lists which files each chapter uses.

## Add-ons

Some things the book shows are deliberately not in this kit, because they need accounts, an identity check or a server that most readers will never want. Each lives in its own repository with its own one-line installer, and installs into the mission control you already have.

- **mc-phone** (Chapter 34): let your mission control make a phone call for you. A voice agent calls as the AI assistant of you, over your own mobile number, and your assistant reads the transcript back with one of four verdicts. Needs the Chapter 32 server, an ElevenLabs account and a Twilio account. https://github.com/MichaelZelbel/mc-phone
- **mc-video** (Chapter 35): let your mission control finish your videos. You record and cut; your assistant burns in captions in one look, makes a vertical version, and builds animated title cards, slides and graphics with HyperFrames. Runs on the computer where your videos are, with no paid accounts; needs Node.js 22 and about 1.5 GB of disk. https://github.com/MichaelZelbel/mc-video

## What this is not

- **Not a chatbot.** You talk to it, but its job is the work it does when you are not there.
- **Not a cloud service.** A folder on your machine, and if you want one, a server you rent yourself.
- **Not a memory database on its own.** Menerio is the optional notebook in Part VI; your mission control works without it.
- **Not finished.** See the status below.

## Status

The book is in production. Folders fill up as their chapters are verified and written, and nothing lands here before it has been run live.

## License

MIT. Use it, change it, share it. See `LICENSE`.
