# Godspeed Mission Control

Godspeed with the integrated notebook, for readers of [Teach It Once](https://leanpub.com/teachitonce). It includes Menerio's notebook functionality: notes, collections, people, world knowledge, timeline, media, comments and memory review, alongside Godspeed's goals, chat, routines and recovery controls.

Version 2 is the current edition, here on `main`. Its installers set up a new, separate folder. They do not move an existing version 1 Godspeed folder or your Menerio account.

## Windows

[Download GodspeedSetup.exe](https://github.com/MichaelZelbel/godspeed-mission-control/releases/download/godspeed-v2-integrated-2026-10-07-1/GodspeedSetup.exe), then run it.

This uses Godspeed's original setup wizard and shared installer, then connects the integrated notebook. On a PC that already has Godspeed, the wizard selects a separate installation by default. The notebook opens at [http://127.0.0.1:47831/dashboard](http://127.0.0.1:47831/dashboard). Connect your own model account in Settings to use the assistant. The installer is unsigned.

The executable is also [committed in this repository](installers/GodspeedSetup.exe). The [download page](https://github.com/MichaelZelbel/godspeed-mission-control/releases/tag/godspeed-v2-integrated-2026-10-07-1) lists the same file and its checksums.

## Linux or Mac

This uses Godspeed's shared native installer for Git, Node.js, Hermes and the Godspeed folders, then adds the notebook. Docker is not required for this route. Mac installation remains unverified.

Download this release's installer, check that it is the published file, and run it:

```bash
curl -fsSLO https://github.com/MichaelZelbel/godspeed-mission-control/releases/download/godspeed-v2-integrated-2026-10-07-1/install-godspeed.sh
echo "c7d5928baea09765f79cd997ce7e869fd10c3b63f2357a600142a0c0d9cda318  install-godspeed.sh" | sha256sum -c - && bash install-godspeed.sh
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
