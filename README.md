# Godspeed Mission Control

Godspeed with the integrated notebook, for readers of [Teach It Once: Make AI your mission control for life and work](https://leanpub.com/teachitonce). It includes Menerio's notebook functionality: notes, collections, people, world knowledge, timeline, media, comments and memory review, alongside Godspeed's goals, chat, routines and recovery controls.

Version 2 is the current edition, here on `main`. Its installers set up a new, separate folder. They do not move an existing version 1 Godspeed folder or your Menerio account.

## New in this release (12 October 2026, second update)

- Trackers you talk to. Say "track belly 92 cm" and your mission control asks once whether to start a tracker called Belly, then keeps the number; after that, "track belly 91" is enough. Your trackers are in Collections, under Trackers. One you have not used for 30 days rests there, with everything kept, until your next "track".
- A cycle tracker for the period: "track period", "track period over", or a symptom such as "track cramps". After two complete cycles it says when the next period is likely to start, and if you ask, it gives a heads-up in your morning brief. It is not for contraception, for trying to conceive or for a diagnosis, and it says so.
- A food tracker: "track breakfast, two eggs and a slice of rye bread" works out calories and protein from the German food table BLS 4.0 of the Max Rubner-Institut, which your mission control downloads once and then uses offline (Settings, About names it and its licence). Packaged food can be looked up by barcode or brand on Open Food Facts. A daily target is optional.
- Headaches and habits answer to "track" too. A coaching talk can be told what it may look at and what it must never do: "The health talk may also look at my sleep tracker", "The health talk must never suggest buying anything".
- A habit day you mark "skip" no longer counts against the habit.

## New earlier on 12 October 2026

- Every new conversation is saved. What you type to the AI apps on your computer (Hermes, your mission control's own assistant, Claude Code, Codex and OpenCode) and what they answer goes into the conversation archive in `prompts/archive/`, from the day you install or update. The one-click server saves its Telegram chat every hour.
- The "Your conversations" boxes and `--sources` decide one thing only: whether chats from before the install are brought in as well. Unticked, only new chats are saved.
- When your assistant cannot recall an earlier conversation, it runs `mc-prompt-archive search` before saying it does not know. That search now works on Windows without a Python of your own, from cmd and PowerShell, and from any folder.
- Trackers: say "track" and a number or a thing, and your mission control keeps the count.

## New on 10 October 2026

- Programming goes to a coding helper. When you ask your mission control to write or change code in one of your projects, it hands the work to a helper that works only in that project's folder, tests and saves it there, and reports back, so your conversation keeps its context. Claude Code does this by itself; the manual tells Codex and Hermes to do the same.
- On Linux, a routine that ran in the same instant the notebook first looked at it is no longer overlooked.

## New on 9 October 2026, for the book's second edition

- Your first goal starts three routines by itself: a daily round that picks the day's work and does it, deadline reminders, and a weekly check-in about the goal on Sundays.
- The notebook keeps the people, facts and events you tell it about, one page per person. Each kind of fact has one fixed name, and a newer value ends the older one.
- The note graph is back, worked out from your notes when you open it.
- A computer can connect its own GitHub copy from Settings, and mail works on a computer too.
- A second computer or a server joins the mission control you already have, and the server runs the routines.
- A weekly review and a research watch come with every new mission control.
- On Windows, the mission control's own commands work inside the assistant's chat.
- The assistant asks its questions in the chat and waits for your answer, keeps what you tell it in the notebook instead of a memory of its own, and reads the notebook directly, so the morning brief knows you. The daily round tells you what it decided, or that it could not finish.
- Smaller fixes: deadlines are always read from the mission control you are working in, a deadline file that cannot be read is shown as needing a look, Settings shows when the weekly check-in really runs, and the chat no longer shows the assistant's waiting lines.

## Windows

[Download GodspeedSetup.exe](https://github.com/MichaelZelbel/godspeed-mission-control/releases/download/godspeed-v2-integrated-2026-10-12-2/GodspeedSetup.exe), then run it.

This uses Godspeed's original setup wizard and shared installer, then connects the integrated notebook. On a PC that already has Godspeed, the wizard selects a separate installation by default. The notebook opens at [http://127.0.0.1:47831/dashboard](http://127.0.0.1:47831/dashboard). Connect your own model account in Settings to use the assistant. The installer is unsigned.

The executable is also [committed in this repository](installers/GodspeedSetup.exe). The [download page](https://github.com/MichaelZelbel/godspeed-mission-control/releases/tag/godspeed-v2-integrated-2026-10-12-2) lists the same file and its checksums.

## Linux or Mac

This uses Godspeed's shared native installer for Git, Node.js, Hermes and the Godspeed folders, then adds the notebook. Docker is not required for this route. Mac installation remains unverified.

Download this release's installer, check that it is the published file, and run it:

```bash
curl -fsSLO https://github.com/MichaelZelbel/godspeed-mission-control/releases/download/godspeed-v2-integrated-2026-10-12-2/install-godspeed.sh
echo "6641bdd6c47cbbdaeff34b9666fd1a5a8c860dbc3c0ac90320180e8185c9b517  install-godspeed.sh" | sha256sum -c - && bash install-godspeed.sh
```

On a Mac, write `shasum -a 256 -c -` where it says `sha256sum -c -`. The check refuses any other file, and the installer names one exact version of the notebook, so every reader of this release gets the same notebook.

On a computer that already has Godspeed, download and check it the same way, then use the original installer's separate-folder option:

```bash
bash install-godspeed.sh --beside --godspeed "$HOME/godspeed-v2"
```

The notebook opens locally at `http://127.0.0.1:47831/dashboard`. On Linux it starts through systemd. Use the Hostinger installation below for a deployment with HTTPS.

The default folder is `~/godspeed-v2`. The original installer also accepts `--godspeed` and `--repo`.

`install-godspeed.sh` at the top of this repository is the release's installer, so `curl -fsSL https://godspeedmissioncontrol.com/install | bash` installs the same version, without the check. For development only: `install-godspeed-dev.sh` installs the development branch's newest commit, so it can differ from one day to the next. It is not for readers.

On a server, the installer also gives the notebook a web address with HTTPS. A server is a Linux computer without a desktop whose public address has a name in public DNS; another name can be given with `GODSPEED_HOST=notebook.example.com`. The address is `https://` plus that name, or that name with `:48443` when the server's own Caddy already serves it. At the end the installer prints a private link that makes your account (username, password, and a recovery code to keep); after that you sign in there. Ports 80 and 443 must be free or held by Caddy, and the installer needs sudo once. The assistant and the routines on the server keep using `http://127.0.0.1:47831`, which asks no sign-in and answers only on the server itself.

## One-click Hostinger installation

[Install Godspeed Mission Control v2 on Hostinger](https://srv1069233.hstgr.cloud/godspeed-install). This prepares a private deployment configuration for Hostinger's Deploy button, then gives you your new server's setup link. Hostinger charges for the server; complete its checkout yourself. The image it installs is pinned to one exact build.

## Status

Version 2 is new. Windows and Linux core flows have been checked. Mac installation and actual two-week user outcomes remain unverified. Some historical memory reviews lack enough information for Undo and report that limitation. The wider release and recipe checks remain incomplete. See [the trial handoff](docs/full-version/trial-handoff.md) for the remaining limits.

Godspeed's code is MIT licensed. Included Menerio-derived notebook components retain their stated AGPL license. Source and notices are included in the packages.
