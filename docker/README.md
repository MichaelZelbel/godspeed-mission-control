# Godspeed Mission Control in Docker

The same Mission Control as `server/install.sh`, inside one container. Pick this when you
want your assistant on a server but not in charge of it: it runs as its own non-root
account, it may use at most one processor core and 2 GB of memory unless you give it
more, and it cannot see or touch anything else on the machine.

Pick `server/install.sh` instead when you want the opposite: an assistant that runs
the whole server, installs software and looks after it.

## Any Linux server, one line (the current version, with the account page)

On a server you already have, from any hosting company, logged in as root (or a user who
may use sudo):

```
curl -fsSL https://teachitonce.com/server | bash
```

(The same file is `docker/server/install.sh` on the public stage, `beta`.) It installs the current
public version, which changes only when the maintainer releases one; `GODSPEED_STAGE_REF` installs
another stage, for example a candidate before it is released to everybody
(`curl -fsSL https://teachitonce.com/server | GODSPEED_STAGE_REF=candidate/2.0.0-beta.7 bash`), and
a version that was taken back is refused. It installs Docker if the server has
none, puts the very `compose.yaml` that Hostinger's one-click deploys
(`docker/hostinger/compose.yaml`, image pinned by digest) in `/opt/godspeed-mission-control`
with its two settings in `.env` (readable by root only), starts it, waits until the page
answers over HTTPS, and prints one private link. The link opens the account page with the
setup code already filled in: choose a username and password, save the recovery code, then
Connect Telegram, the same steps as on Hostinger (`hostinger/README.md`): first the technical
part in the chat, then, whenever you like, a short chat in which your assistant gets to know you.

- **The address.** Without a domain it uses the server's public IPv4 address as
  `<a-b-c-d>.sslip.io` (for 203.0.113.7: `203-0-113-7.sslip.io`), a free name that points back
  at that address, so the certificate is a real Let's Encrypt one. With your own domain pointed
  at the server: `curl -fsSL https://teachitonce.com/server | GODSPEED_HOST=mission.example.com bash`.
- **It stops with one plain sentence** when another program already uses port 80 or 443 (it
  never touches that program), when the processor is not x86-64, when Docker is missing on a
  system other than Debian or Ubuntu, or when another Godspeed Mission Control already runs
  here (the older container below, or a hosting company's one-click). When the certificate does
  not come within five minutes, it says to open ports 80 and 443 in the hosting company's
  firewall (or forward them on a home router) and run the line again.
- **A server that was just made or reinstalled** installs its own updates for its first minutes,
  and apt lets one program at a time install. The installer waits for those updates to finish
  (up to 15 minutes; `GODSPEED_APT_WAIT=<seconds>` in front of `bash` changes that), tells apt to
  wait for its lock instead of stopping, and tries Docker's installer up to three times. When
  Docker still cannot be installed, the reason (apt's own error lines) is shown under the
  sentence, so nobody has to open the log to see it.
- **Run it again at any time.** It keeps the setup code, the address and all data, updates to
  the image `compose.yaml` pins today, and never makes a second owner: before the account
  exists it prints a fresh link (the old one stops working), after that it says to sign in.
- **What it noted** is in `/opt/godspeed-mission-control/install.log`. By hand afterwards:
  `cd /opt/godspeed-mission-control && docker compose ps` (or `logs`).
- **Trying a version before it is released.** The stage this line installs names the image it runs,
  and by default that is the public stage, `beta`. To run a whole other stage on a test server, name
  it with `GODSPEED_STAGE_REF`, as above. To run one single image, name that instead:
  `curl -fsSL https://teachitonce.com/server | GODSPEED_IMAGE=ghcr.io/michaelzelbel/godspeed-mission-control:v2-sha-<commit> bash`.
  Every commit on main that passes the "Integrated Godspeed v2" check is published under that
  tag (the full 40-character commit). The choice is kept, so running the line again stays on it;
  `GODSPEED_IMAGE=release` goes back to the released one.

Tested by `docker/server/test.sh` (the address, the busy-port and certificate messages, waiting
for a busy apt and the three tries at Docker's installer, anywhere; the apt part needs Linux)
and `sudo bash docker/server/test.sh e2e` (the whole path, Docker included, on a machine you can
throw away, with `GODSPEED_HOST=localhost` and Caddy's own certificate).

## Install (the older image, set up in the terminal)

On the server, as root:

```
curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control/beta/docker/install.sh | bash
```

It installs Docker if it is missing, starts the container and runs setup inside it.
Setup asks three things: your Telegram bot's token (BotFather gives you one in two
minutes), whether you already keep a mission control on GitHub, and whether you want
the morning brief (and, with it, the optional one line about the world from observedstate.com). Two codes appear along the way, one for ChatGPT and one for GitHub;
type each on any device.

By hand, with Docker already installed:

```
mkdir godspeed-mission-control && cd godspeed-mission-control
curl -fsSLO https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control/beta/docker/compose.yaml
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
   button; then send it any message. (On a server where you connected the bot from its web
   page instead, as below, any message is not enough: send the message that page shows, which
   starts with `/start` and carries a one-time code.)

The bot then walks you through it. First it connects an AI, the service it thinks with, paid
by you directly: ChatGPT (a code to type on ChatGPT's sign-in page), OpenRouter, Claude,
OpenAI, Google Gemini, or any other provider Hermes supports, by pasting its key (the bot
deletes that message at once). While it checks, Telegram shows it typing. It only goes on once
the assistant has answered a test question with it. Then a code to type on GitHub's page, and a
few questions as buttons (a new folder or the one you already have, the morning brief and the
city whose time zone it follows, and whether it ends with one line about the world). Then it
runs the same setup as `godspeed-setup`, hands itself over to your assistant, and ends with the
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
