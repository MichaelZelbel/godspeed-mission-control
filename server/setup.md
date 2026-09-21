# Build the always-on server by hand (Chapters 32 and 33)

**You probably do not need this page.** The normal way is one line, pasted into
the server as the login you were given:

```
curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/teach-it-once-kit/main/server/install.sh | bash
```

That does everything below, explains the ChatGPT choice, asks whether a
repository already holds your folder, and makes a checked private GitHub
repository when the answer is no. It shows you two codes to type on your phone.
`steps/build-the-server.md` is the step-by-step account of what it does.

This page is the same thing done by hand. Two reasons to read it: you want to
know what the one line actually did, or something has broken and you are trying
to find which part. Every step here was run on the book's test server, an
Ubuntu 24.04 machine, on Hermes 0.21.0.

---

## 1. Rent the machine

Any small Linux server will do. The path used for this book is Hostinger KVM 2
with Ubuntu. On 5 September 2026 its German page lists 7.99 euros a month for
the first term and 14.99 euros a month on renewal for two years, with the term
paid in advance. Read both current prices before buying. You get an address and
a way to log in.

## 2. Make a user that is not the boss

```
adduser ai
```

Everything after this happens as `ai`, except the one root step in section 5.
The account you were given can destroy the machine; your assistant does not need
that. This is the same instinct as the red lines: draw the boundary while nothing
is at stake.

It matters more here than on your laptop. On your laptop the leash is a
question: it asks, you answer. On a server at three in the morning there is
nobody to answer, so the leash cannot be a question. **It has to be the walls.**
Hermes helps: a scheduled job that reaches for a dangerous command is refused,
not left waiting for a click.

## 3. Install Hermes, as `ai`

```
curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash
```

Run this as `ai`, not with `sudo`. It installs into the home folder of whoever
runs it (`~/.local/bin/hermes`), brings its own Python and Node, and needs
`curl`, `git`, `xz` and a C++ compiler on the machine, which root installs if
they are missing (`apt install build-essential` for the compiler; it builds one
small native part, Hermes' terminal helper, and without it the installer stops
and asks for exactly that line). It will mention that `ripgrep` is absent and
that file search falls back to `grep`; that is fine.

## 4. Sign in with no browser on the machine

```
hermes auth add openai-codex --type oauth --no-browser
```

Not `hermes login`, which is deprecated and says so. The command prints exactly
this shape:

```
To continue, follow these steps:

  1. Open this URL in your browser:
     https://auth.openai.com/codex/device

  2. Enter this code:
     XXXX-XXXXX

Waiting for sign-in... (press Ctrl+C to cancel)
```

Open the address on any device, type the code, approve. No browser on the
server, no credential copied from another machine. The code lasts fifteen
minutes, measured; an expired attempt writes nothing and is safe to repeat. If
Hermes finds a Codex CLI login on the machine it offers to import it and
recommends against, in its own words: a separate login is recommended, because
two programs sharing one sign-in log each other out.

Then check, and set the model the book uses:

```
hermes auth list
hermes model
```

## 4a. Telegram, from one token (Chapter 32's first stop)

The one-line installer does this as root, after `terminal.cwd` and before the gateway service,
so the gateway starts with Telegram already in its settings. Hermes switches Telegram on by itself
when `TELEGRAM_BOT_TOKEN` is in its env file (`gateway/config_env.py`, the credential-gated
enable), reads who may talk to it from `TELEGRAM_ALLOWED_USERS`, and gives `hermes send -t
telegram`, the morning brief's delivery and the watchdog's alerts their address from
`TELEGRAM_HOME_CHANNEL`, the line `/sethome` would otherwise write. By hand, as root:

1. In Telegram, **BotFather**, `/newbot`, a display name and a username ending in `bot`; it
   answers with the token, `123456789:ABC...`. Check it: `curl -s
   https://api.telegram.org/bot<token>/getMe` answers `"ok":true` and the bot's username.
2. Send the new bot any message from your own Telegram, then read your id from the bot's own
   message log: `curl -s https://api.telegram.org/bot<token>/getUpdates` carries
   `"from":{"id":<you>` and `"chat":{"id":<the chat>` (the same number for a private chat).
   Do this while the gateway is not running: a running gateway holds that log and Telegram hands
   it to one reader at a time (`systemctl stop hermes-gateway` first, `start` after).
3. Three lines in `/home/ai/.hermes/.env` (mode 600, owned by `ai`):

```
TELEGRAM_BOT_TOKEN=<token>
TELEGRAM_ALLOWED_USERS=<your id>
TELEGRAM_HOME_CHANNEL=<the chat id>
```

The proof, as `ai`, at the end: `hermes send -t telegram "hello"` puts a message on your phone
with no model and no running gateway involved; the installer sends one the same way as its last
step. Never paste the token anywhere else; `hermes send` and the watchdog reuse it from there.

## 5. The folder's path first, then the gateway, as root

Two commands, in this order, and the order is the point. The gateway copies
`terminal.cwd` into its own environment once, when it starts, so the folder's
path is written before the service exists:

```
sudo -u ai -H /home/ai/.local/bin/hermes config set terminal.cwd /home/ai/hub
sudo /home/ai/.local/bin/hermes gateway install --system --run-as-user ai --start-on-login --force
```

Hermes writes a better unit than you would by hand (it carries `HERMES_HOME`,
`PATH`, its self-update flag, `WantedBy=multi-user.target`, and pins
`WorkingDirectory` to its own home on purpose, because a movable folder
crash-loops the unit before Python loads). It starts with the machine, no login
and no lingering needed, and came back fourteen seconds after a reboot on the
test server. One system gateway per machine: do not also install a user unit,
or `hermes gateway status` reports the wrong one.

`terminal.cwd` is the ONLY setting the agent's tools obey for their working
folder. An earlier version of this page set `workspace`, which is not a
recognised Hermes key: the command succeeded, Hermes ignored it, and the
assistant knew your house rules and still could not open the folder they
describe.

## 6. Give the server your folder

**The short way**, which is what the one-line installer does: install the
GitHub tool as root (`apt install gh`, or the instructions at cli.github.com),
then, back as `ai`:

```
gh auth login --hostname github.com --git-protocol https --web --skip-ssh-key
gh auth setup-git
gh repo clone YOUR-NAME/YOUR-REPO hub
```

`gh auth login` shows a short code and a web address. Open the address on your
phone, type the code, approve. No token to create, no key to paste anywhere.

If you have no repository yet, the one-line installer does this for you. By hand,
start from the book's starter rooms and make one:

```
git clone --depth 1 https://github.com/MichaelZelbel/teach-it-once-kit.git ~/teach-it-once-kit
cp -R ~/teach-it-once-kit/starter-hub/. ~/hub/
cd ~/hub && git init -b main && git add -A && git commit -m "My folder"
gh repo create YOUR-REPO --private --source . --push
```

**The long way**, a deploy key, if you would rather not put a GitHub login on a
rented machine at all: `ssh-keygen -t ed25519`, paste the public half under the
repository's **Settings**, **Deploy keys** with write access, and
`git clone git@github.com:YOUR-NAME/YOUR-REPO.git hub`.

## 7. Wire the folder the way the laptop is wired

```
git clone --depth 1 --branch v2.4 https://github.com/MichaelZelbel/kit-bootstrap.git ~/.kit-bootstrap
KB_BRANCH=v2.4.1 bash ~/.kit-bootstrap/setup-hub.sh --hub ~/hub --skip-prereqs --sources hermes
```

This is the same script the laptop installer runs. It tops the folder up with
any starter room it lacks, makes the visible `skills/` the one real room with
`.claude/skills` and `.agents/skills` as links to it (and counts what is
reachable rather than trusting itself), sets `terminal.cwd` and PROVES it by
having Hermes read a marker file, adds the eighteen deny rules, installs the
kit's tools, and puts the prompt log on an hourly clock. Read what it prints.

## 8. Put the keys where the folder is not

```
umask 077 && touch ~/.hub-env && chmod 600 ~/.hub-env
cd ~/hub && printf '.env*\n.hub-env\n' >> .gitignore
```

Both halves. The morning job commits and pushes, and `git add -A` means
everything. Hermes' own secrets (its sign-in, the Telegram token) live in its own
home, never in the folder. See `three-traps.md` for what happens if you skip this.

## 9. The morning brief, on Hermes' clock (optional)

The one-line installer asks before it does this (`Put the morning brief on this
server's clock (y/n) [n]`), because a reader whose server is the first machine
has no Chapter 22 brief to run yet. By hand, run the script when you want the
job, or with `KB_MORNING_BRIEF=no` in front of it for everything but the job:

```
HUB=~/hub bash ~/teach-it-once-kit/server/install-hermes.sh
```

That script checks the `AGENTS.md` ceiling (it refuses at 20,000 characters and
warns from 19,000), points Hermes at the folder and proves it again, leaves the
gateway to the system service from section 5, and creates the job:

```
hermes cron create "0 6 * * *" \
  "Run the recipe in skills/morning-brief/SKILL.md. It writes today's brief into brief/. When it is written, commit and push this folder, then reply with the brief's full text. If the recipe is missing or the brief cannot be written, say exactly that instead of staying quiet." \
  --name morning-brief --workdir "$HOME/hub" --deliver telegram
```

Two things about that command earn their place. `--workdir` is the one thing
that injects your `AGENTS.md` into a scheduled run; without it the job runs
with no project context at all. And the clock lives inside the gateway: a
scheduled job fires only while `hermes cron status` says the gateway is
running, and a slot it was down for runs once, late, when it is back. `hermes cron run morning-brief`
by hand proves the job works; it proves nothing about the schedule.

## 9a. The watchdog, on the machine's clock

The one-line installer does this as root, between the gateway service and the hand-over. By hand
it is one line, as root, and it is safe to run again:

```bash
curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/teach-it-once-kit/main/server/install-watchdog.sh | bash
```

What it builds, and why it is on root's crontab and not on `hermes cron`: the gateway's clock stops
when the gateway does, which is exactly when a watchdog must run. It clones
`hermes-self-devops-watchdog` at a pinned tag into `/opt/hermes-watchdog`, fetches the
hash-verified floor, creates the `watchdog` profile for `ai` (own memory and sessions, the
gateway's sign-in), sets the conservative deny list on that profile and reads it back and tests it
both ways, and writes one block between `# teach-it-once:watchdog start` and `end` markers in
root's crontab: `floor/quick-check.sh` every 5 minutes (root restarts a dead system unit once),
`templates/selftest.sh` every 30 minutes (asks the second Hermes for one word through
`OPERATOR_CMD`, alerts SELF-HEALING IS DOWN when it cannot), and
`templates/run-prompt.sh six-hour-deep-check` four times a day. Alerts go out through
`hermes send -t telegram` as `ai` (`SEND_CMD`, `SEND_HOME`), to the bot's home channel, the
`TELEGRAM_HOME_CHANNEL` line section 4a wrote. Logs: `/var/log/hermes-watchdog/`. Off-switch:
delete the block from root's crontab.

## 10. The door: a private address and Hermes' web page (Chapter 33)

The chapter's way is one more pasted line, as root:

```
curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/teach-it-once-kit/main/server/open-the-door.sh | bash
```

By hand, the same four things. Tailscale: `curl -fsSL https://tailscale.com/install.sh | sh`,
then `tailscale up` (prints a sign-in address), then `tailscale ip -4` for the private address.
The three lines Hermes' documentation names, appended to `/home/ai/.hermes/.env` (mode 600,
owned by `ai`): `HERMES_DASHBOARD_BASIC_AUTH_USERNAME`, `HERMES_DASHBOARD_BASIC_AUTH_PASSWORD`,
`HERMES_DASHBOARD_BASIC_AUTH_SECRET` (`openssl rand -base64 32`). A unit
`/etc/systemd/system/hermes-dashboard.service` with `User=ai`,
`EnvironmentFile=/home/ai/.hermes/.env` and
`ExecStart=/home/ai/.local/bin/hermes dashboard --host <private address> --port 9119 --no-open`,
and the protections a service on a network address should have (`NoNewPrivileges=true`,
`ProtectSystem=full`, `ProtectHome=read-only` with `ReadWritePaths=/home/ai`, `PrivateTmp=true`,
`ProtectKernelTunables=true`, `ProtectKernelModules=true`, `ProtectControlGroups=true`),
enabled and started. And the check: `curl -s http://<private address>:9119/api/status` must
contain `"auth_required":true`. Hermes' auth gate is on for any address that is not loopback, and
the page fails closed without a password or OAuth provider, so never bind it to a public address
with only a password; the documentation's answer for a public address is `hermes dashboard
register` (Nous OAuth).

## 11. A second person on the bot, from the web page (Chapter 33)

Telegram itself was connected in section 4a, by the installer. To let a second person write to
the bot: open `http://<private address>:9119` from a computer on the same Tailscale network, sign
in, and under **Channels** choose **Telegram**; add their numeric Telegram id (from
**userinfobot**) to the allowed users. The page's own **Restart gateway** button cannot make it
live here: this server's gateway runs as a system service, and `ai`, the account the page runs
as, was made without the right to restart one (the same reason the watchdog runs on root's
clock, section 5a). Make it live as root instead: the same second id, comma-separated, on the
`TELEGRAM_ALLOWED_USERS` line in `/home/ai/.hermes/.env`, then `systemctl restart hermes-gateway`.
A stranger who writes to the bot gets a pairing code; `hermes pairing approve telegram <code>` as
`ai` lets them in.

## 12. Register it, and check it

Add the procedure to `procedures.md` (the one-line installer appends the block
itself), with "where it runs" filled in properly at last: the server. Then the
three commands worth remembering:

```
hermes gateway status     # is my assistant awake? (never systemctl is-active: a clean stop reads "failed" there)
hermes cron status        # will the clock fire? gateway running, ticker heartbeat, next run
hermes cron list          # every job, its schedule, its last and next run
hermes cron runs          # what fired, when, and whether the clock (builtin) or a hand (direct) did it
hermes cron incidents     # anything that broke, with the stored output
```

## What a working run looks like

The brief arrives on your phone at 06:00, `hermes cron runs` shows the run with
`source=builtin`, and the folder gained one file: `brief/` holds the day's page,
committed and pushed. Just the brief. No keys.
