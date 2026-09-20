# Teach It Once: Companion Kit

**Astronauts have mission control. This is how you build yours out of AI.**

A personal support system that lives in a folder you own. It runs on a clock and keeps watch over the parts of your life and work you hand it. It solves what it can while you sleep and messages you only when something matters. You stay the captain. Mine once sent me a podcast episode and the minute to start at, for a health problem I had mentioned months earlier. [Two and a half minutes on YouTube](https://www.youtube.com/watch?v=KiyhltKi2H8).

Not a dashboard. A dashboard shows screens and waits. This one acts, and it is the only AI you use that calls first.

This kit is the hub itself, plus every template from the book **Teach It Once** by Michael Zelbel. The subtitle says what the hub is: *Set up a personal AI that knows you and works on its own*. It runs on your laptop with Hermes; developers can use Claude Code or OpenCode instead (`swap/`). An optional always-on server lives in `server/`. Everything the book asks you to copy, paste, fill in, or print is here, so you never have to type a template from a page.

## Let it set itself up

Whichever computer you use, one thing to run and no decisions to make. It works out for itself whether this machine needs a first setup or an update.

**On Windows:** **[download HubSetup.exe](https://github.com/MichaelZelbel/teach-it-once-kit/releases/latest/download/HubSetup.exe)** and double-click it. Nothing to type, no terminal.

**On a Mac or Linux:** open a terminal and paste this one line. (A terminal is the normal way to install things on those systems, which is why they get a line and Windows gets a file.)

```
curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/teach-it-once-kit/main/install-hub.sh | bash
```

Either one sets up your hub with the `starter-hub/` folder below already in place. It installs the few things it needs underneath: Git, Node.js, and on Linux Hermes itself (on Windows it checks that Hermes Desktop is there). It also makes one memory that every machine you own shares. If that computer already has a hub, it updates that one instead. Run it as often as you like; it never deletes anything you have written.

**Windows will warn you the first time.** You will see a blue box saying "Windows protected your PC", and at first the only button is *Don't run*. Click **More info**, then **Run anyway**. Windows shows this for any program whose publisher it has not seen enough copies of yet. It is not a virus warning and says nothing about whether the program is safe.

## How to get it by hand

No terminal needed: click the green **Code** button on GitHub and choose **Download ZIP**, then unpack it anywhere.

Later in the book, once your assistant is looking after the folder for you, it can keep this up to date with git instead:

```
git clone https://github.com/MichaelZelbel/teach-it-once-kit.git
```

## What is where

- `starter-hub/`: the folder that becomes your own system. Copy this whole folder and it is your hub. Everything else here fills it up. Three of its rooms are the ones that turn a folder of notes into something that decides: `goals/` (what you want, and who gets attention today), `forecasts/` (what your hub expects to happen, dated and scored) and `work/` (what it is doing, where "it says it did it" and "somebody checked" are two different states). Each starts empty with a README explaining the format.
- `tools/`: the small programs the installer puts on your machine, outside your hub. Among them `hub-search`, which finds things in your hub (through your notebook when one is connected, in the files when not), `hub-goals`, `hub-forecast` and `hub-work` for the three rooms above, `hub-decide`, which runs the day's decision once a day through whichever assistant you use, and `hub-work-run`, which carries out the work that decision filed, one item per assistant run, verified by each item's own check (`hub-check-written` for anything written). `tools/README.md` says what each one is for.
- `profile/`: Part II assets. The about-you template, the people and projects interviews, the voice extraction prompt, the capture and spring-clean checklists.
- `skills/`: Part III assets. The skill interview, the five starter recipes, the craft-skill interview, the test checklist, practice texts, and one big finished craft skill (`strip-ai-tells.md`) to see what a real one looks like. These are the book's teaching copies; in your own hub a recipe lives at `skills/<name>/SKILL.md`. The two recipes the hub runs by itself are not here: `next-action` and `work-item` ship inside `starter-hub/skills/`, so every hub has them from day one. So does `keep-a-note`, the recipe behind "make a note" (Chapter 28). `hub-decide` carries out the first once a day, and `hub-work-run` carries out one filed item at a time with the second.
- `procedures/`: Part V and VI assets. Morning brief, weekly review, watchdog, the procedure register, the red lines, the card for keys that run out, and the card for everything else that runs out (`what-runs-out-and-when.md`).
- `living/`: the two-questions card, the privacy audit checklist, the saved-prompt card, the printable build-order card.
- `menerio/`: Part VI, optional. Chapter 28, "Give Your Hub a Notebook". You connect Menerio once, through the installer or with `hub-menerio-connect`, and Hermes, Claude Code and Codex all have it. Your whole hub except `dev/` is then mirrored into the notebook, where the copies rank below your own notes and are never mined for facts or exported as files. `hub-search` asks Menerio first and falls back to the files in your hub. A free account is enough: https://menerio.com/auth?tab=signup
- `server/`: Part VI, optional. Scripts and guides for giving your system an always-on home.
- `swap/`: Part VI. Config examples for running the same system on a different company's tool and model.

Appendix A of the book lists which files each chapter uses.

## Add-ons

Some things the book shows are deliberately not in this kit, because they need accounts, an identity check or a server that most readers will never want. Each lives in its own repository with its own one-line installer, and installs into the hub you already have.

- **hub-phone** (Chapter 32): let your hub make a phone call for you. A voice agent calls as the AI assistant of you, over your own mobile number, and your assistant reads the transcript back with one of four verdicts. Needs the Chapter 31 server, an ElevenLabs account and a Twilio account. https://github.com/MichaelZelbel/hub-phone
- **hub-video** (Chapter 33): let your hub finish your videos. You record and cut; your assistant burns in captions in one look, makes a vertical version, and builds animated title cards, slides and graphics with HyperFrames. Runs on the computer where your videos are, with no paid accounts; needs Node.js 22 and about 1.5 GB of disk. https://github.com/MichaelZelbel/hub-video

## What this is not

- **Not a chatbot.** You talk to it, but its job is the work it does when you are not there.
- **Not a cloud service.** A folder on your machine, and if you want one, a server you rent yourself.
- **Not a memory database on its own.** Menerio is the optional notebook in Part VI; the hub works without it.
- **Not finished.** See the status below.

## Status

The book is in production. Folders fill up as their chapters are verified and written, and nothing lands here before it has been run live.

## License

MIT. Use it, change it, share it. See `LICENSE`.
