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
the morning brief (and, with it, the optional one line about the world from observedstate.com). Two codes appear along the way, one for ChatGPT and one for GitHub;
type each on any device.

By hand, with Docker already installed:

```
mkdir godspeed-mission-control && cd godspeed-mission-control
curl -fsSLO https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control/main/docker/compose.yaml
docker compose up -d
docker compose exec godspeed godspeed-setup
```

## Set it up from Telegram, with nothing typed on the server

For a server you never want to open a terminal on, for example one a hosting company
starts for you from `compose.yaml`. The whole setup then happens in a chat with your own
Telegram bot.

1. Make the bot: in Telegram, open BotFather, send `/newbot`, pick a name and a username
   ending in "bot". BotFather answers with a token in the shape `123456789:ABCdef...`.
2. Give the server that token as `GODSPEED_TELEGRAM_TOKEN`: in the hosting company's field
   for environment variables if its form has one, or in a file called `.env` beside
   `compose.yaml` holding the line `GODSPEED_TELEGRAM_TOKEN=123456789:ABCdef...`, then
   `docker compose up -d`.
3. Open your bot in Telegram and press Start. A bot you have written to before shows no Start
   button; then send it any message.

The bot then walks you through it. First your assistant's brain, the AI company it thinks
with, paid by you directly: ChatGPT (a code to type on ChatGPT's sign-in page), OpenRouter,
Claude, OpenAI, Google Gemini, or any other provider Hermes supports, by pasting its key (the
bot deletes that message at once). It only goes on once the assistant has answered a test
question with it. Then a code to type on GitHub's page, and a few questions as buttons (a new
folder or the one you already have, the morning brief with which city's clock it
follows, and whether it ends with one line about the world). Then it runs
the same setup as `godspeed-setup`, hands itself over to your assistant, and ends with the
line that puts the same mission control on your Windows PC or Mac.

**Write to your bot first.** The first person to write to it owns it, the same rule the
terminal setup uses, and nobody knows a bot's name until you share it. To be strict about
it, also set `GODSPEED_TELEGRAM_OWNER` to your Telegram @username. If somebody else ever
took it first, start over with a fresh volume: `docker compose down -v`, then up again.

Nothing here is needed on a server set up by terminal: without the token the chat setup
does nothing, and it never touches a bot the terminal setup already connected. Its log:
`docker compose exec godspeed cat /opt/data/logs/godspeed-telegram-setup.log`.

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

## Browsing

Your assistant can open and read public web pages with its own browser, a Chrome without
a window that runs inside the container. Ask it to look something up on a site or read an
article, and it reads the page the way a visitor would. There is nothing to set up.

Two kinds of page do not work yet. Some sites turn away visitors that come from a server,
and show the assistant a block page or a puzzle instead. Anything behind a login, like your
bank or a shop account, is not supported yet.

Planned next: your own Windows PC or Mac lends the assistant its browser, with the sign-ins
you already have there, for the pages a server cannot open.

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
own daily jobs, the one-time update on a new image, and the setup from Telegram
(`godspeed-telegram-setup`, which collects the answers in the chat and then runs the same
setup command with them). `docker/test/test-telegram-setup.py` tests that chat against a
stand-in Telegram on any computer; `docker/test.sh` runs it again inside the image.
The browser is the Chrome the Hermes image already carries, driven by `agent-browser` at a
pinned version. On every test run, `docker/test/probe-browser.py` has the assistant's own
browser tools read two pages, as the assistant's account.
