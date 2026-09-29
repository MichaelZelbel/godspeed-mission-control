# Godspeed Mission Control in Docker

The same Mission Control as `server/install.sh`, inside one container. Pick this when you
want your assistant on a server but not in charge of it: it runs as its own non-root
account, it may use at most one processor core and 2 GB of memory unless you give it
more, and it cannot see or touch anything else on the machine.

Pick `server/install.sh` instead when you want the opposite: an assistant that runs
the whole server, installs software and looks after it.

## Install

On the server, as root:

```
curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control/main/docker/install.sh | bash
```

It installs Docker if it is missing, starts the container and runs setup inside it.
Setup asks three things: your Telegram bot's token (BotFather gives you one in two
minutes), whether you already keep a mission control on GitHub, and whether you want
the morning brief. Two codes appear along the way, one for ChatGPT and one for GitHub;
type each on any device.

By hand, with Docker already installed:

```
mkdir godspeed-mission-control && cd godspeed-mission-control
curl -fsSLO https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control/main/docker/compose.yaml
docker compose up -d
docker compose exec godspeed godspeed-setup
```

## Everyday

- Run setup again, to add Telegram later or fix a step: `docker compose exec godspeed godspeed-setup`
- Update: `docker compose pull && docker compose up -d`. The new image brings your
  folder's tools up to date by itself on its first start (log:
  `docker compose exec godspeed cat /opt/data/logs/godspeed-upgrade.log`).
- Logs: `docker compose logs -f`
- A shell inside, as your assistant's account: `docker compose exec -u hermes godspeed bash`
- Back up: everything is in the volume `godspeed-data`. Your folder is also on GitHub.

## What the container can and cannot do

It cannot reach the rest of your server: no other files, no other programs, no Docker
socket, no ports open to the internet. Telegram works by the container asking Telegram
for new messages, so nothing ever connects in.

It can use every account you connect to it. If you connect your Gmail, it can read your
Gmail. The container protects your server, not your accounts, so connect only what you
want your assistant to act on.

## The limits

Set in `compose.yaml`, or in a `.env` file beside it:

- `GODSPEED_CPUS` (default 1): processor cores the container may use in total
- `GODSPEED_MEMORY` (default 2g): memory
- `GODSPEED_PATROL` (default on): inside the container, every ten minutes, a patrol
  stops any command your assistant started that has kept a processor core busy for over
  an hour, and tells you on Telegram. Idle commands are left alone. Turning it off
  leaves the CPU and memory limits in place.

## How it is built

`docker/Dockerfile` starts from the official Hermes image (pinned by digest), which
brings the supervisor that restarts the gateway, and adds only what the installer
needs. Setup is `server/install.sh` in container mode, from the same commit, so the
container and a plain server run the same steps. What is only in the image lives in
`docker/rootfs/`: the setup command, the patrol, a small scheduler for the installer's
own daily jobs, and the one-time update on a new image.
