# Godspeed Mission Control v2

Godspeed from this repository's main branch, extended with the integrated notebook. The integrated edition for readers of [Teach It Once](https://leanpub.com/teachitonce), on this separate branch for Michael's trial. It includes Menerio's notebook functionality: notes, collections, people, world knowledge, timeline, media, comments and memory review, alongside Godspeed's goals, chat, routines and recovery controls.

The current edition stays on `main`. These installers set up version 2 separately. They do not migrate your existing Godspeed folder or your Menerio account.

## Windows

[Download GodspeedSetup.exe](https://github.com/MichaelZelbel/godspeed-mission-control/releases/download/godspeed-v2-integrated-2026-10-04-3/GodspeedSetup.exe), then run it.

This is the complete Windows installer, including the integrated notebook and its Node runtime. It sets up its own workspace and assistant profile. Its installation screens currently call this edition "Full Alpha". The notebook opens at [http://127.0.0.1:47831/dashboard](http://127.0.0.1:47831/dashboard). Connect your own model account in Settings to use the assistant. The installer is unsigned, so Windows may ask you to confirm that you want to run it.

The executable is also [committed on this branch](installers/GodspeedSetup.exe). The [download page](https://github.com/MichaelZelbel/godspeed-mission-control/releases/tag/godspeed-v2-integrated-2026-10-04-3) lists the same file and its checksums.

## Linux VPS or Mac with Docker

This edition uses Docker with Compose on Linux and Mac. Install and start Docker first. Mac acceptance is still unverified; this is not a tested native Mac installer.

[Download install-godspeed.sh](https://github.com/MichaelZelbel/godspeed-mission-control/releases/download/godspeed-v2-integrated-2026-10-04-3/install-godspeed.sh), or run:

```bash
curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control/codex/godspeed-v2-completeness/install-godspeed.sh | bash
```

For a fresh VPS, supply its hostname to enable HTTPS. Ports 80 and 443 must be free and reachable, and the hostname must point to that server:

```bash
curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control/codex/godspeed-v2-completeness/install-godspeed.sh | GODSPEED_HOST=srv123456.hstgr.cloud bash
```

The installer downloads the checked source and notebook interface, verifies their checksum, builds the integrated image, and starts its own Docker project and data volume. It prints a private setup link to create your account. Model sign-in happens in Settings. On a local computer it opens at `http://127.0.0.1:47831`; on a VPS it uses the hostname you supplied.

The default installation folder is `~/GodspeedMissionControl-v2`. Set `GODSPEED_V2_INSTALL_DIR` to use another empty folder. Re-running the same installer retains your account and data. This download is pinned to the trial version and does not silently follow `main`.

## One-click Hostinger installation

[Install Godspeed Mission Control v2 on Hostinger](https://srv1069233.hstgr.cloud/godspeed-install). This prepares a private deployment configuration for Hostinger's Deploy button, then gives you your new server's setup link. Hostinger charges for the server; complete its checkout yourself. The integrated image is pinned separately from the existing main/latest edition.

## Trial status

This is a preview for Michael's trial, not a finished stable release. Windows and Linux core flows have been checked. Mac installation and actual two-week user outcomes remain unverified. Some historical memory reviews lack enough information for Undo and report that limitation. The wider release and recipe checks remain incomplete. See [the trial handoff](docs/full-version/trial-handoff.md) for the remaining limits.

Godspeed's code is MIT licensed. Included Menerio-derived notebook components retain their stated AGPL license. Source and notices are included in the packages.
