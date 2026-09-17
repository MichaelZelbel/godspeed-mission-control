# What the one line does, step by step

You are reading the checklist behind `server/install.sh`. Until 2026-09-02 this
file was a script for an AI wizard that drove the second half of the install in
a conversation. There is no wizard any more: the whole install is deterministic
shell, built on the shared primitives in `kit-bootstrap`. It explains the
ChatGPT choice, asks whether a repository already holds your folder, asks for
a name when it has to make a new private one, and shows two codes. This page is
for a human reading along, or for finding which step broke.

## Phase 1, as root: the things only an administrator may do

1. **Tools.** `git`, `curl`, `xz`, `jq`, a C++ compiler (`build-essential`), and
   the GitHub tool `gh`. Installed by root because the assistant's account will
   not be allowed to install software, which is the point of that account. The
   compiler is for Hermes' own installer, which builds one small native part
   (its terminal helper) on the machine and, as `ai`, cannot install a compiler
   itself: on a fresh Ubuntu server without this step it stopped and printed
   `sudo apt install build-essential` (found 2026-09-05).
2. **The account.** `adduser ai`. Everything after root's phase runs as `ai`,
   which can reach almost nothing. On a server the leash cannot be a question,
   so it has to be the walls.
3. **Hermes, for that account.** Root runs Hermes' own installer as `ai`
   (`curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash`). It
   brings its own Python and Node; `ripgrep` is optional and it says so. Its
   output is kept in `/home/ai/hermes-install.log`, and when it stops the
   installer names that file instead of sending you to run it again blind.
4. **The folder's path, before the service.** `hermes config set terminal.cwd
   /home/ai/hub`, as `ai`. The gateway copies this setting into its own
   environment once, when it starts, so it is written first. `terminal.cwd` is
   the only setting the agent's tools obey for their working folder; the old
   `workspace` key was a silent no-op.
5a. **Telegram, from one token.** Before the gateway service, so it starts with
   its ear attached. The reader makes a bot with BotFather and pastes the token
   (Enter skips; `KB_TELEGRAM_TOKEN` in the environment answers once,
   `KB_TELEGRAM_SKIP=1` skips without asking). `getMe` checks the token and names
   the bot. Then the reader sends the bot any message and presses Enter; the
   installer reads the bot's message log (`getUpdates`, up to a minute) for the
   last private message and writes three lines into `/home/ai/.hermes/.env`:
   `TELEGRAM_BOT_TOKEN`, `TELEGRAM_ALLOWED_USERS` (the sender's id) and
   `TELEGRAM_HOME_CHANNEL` (the chat's id, what `/sethome` would write). Hermes
   enables Telegram from the token's presence alone (`gateway/config_env.py`).
   On a second run with the token and the allowlist already there it says so and
   asks nothing; with a token but no hello it finishes the hello; a running
   gateway is stopped while the log is read and started again after, because
   Telegram hands the log to one reader at a time. The token is never printed.

5. **The gateway as a system service.** `hermes gateway install --system
   --run-as-user ai --start-on-login --force`, through `kb_install_gateway`,
   which then asks Hermes whether the service is RUNNING rather than trusting the
   install command's exit status. It starts with the machine, no login needed,
   and came back fourteen seconds after a reboot on the test server. There is
   one system gateway per machine, named `hermes-gateway.service`.
5a. **The watchdog, on root's clock** (`server/install-watchdog.sh`, added
   2026-09-06). Clones `hermes-self-devops-watchdog` at a pinned tag into
   `/opt/hermes-watchdog`, fetches its hash-verified floor, makes the `watchdog`
   profile for `ai` (own memory and sessions, the gateway's credential store),
   sets the conservative deny list on that profile and reads it back and tests
   it both ways, and writes one marked block into root's crontab: the floor
   every 5 minutes (root restarts a dead system unit once, no AI), the
   self-check every 30 minutes (one word from the second Hermes, through
   `sudo -n -u ai`), the deep check four times a day. Alerts go out as `ai`
   through `hermes send -t telegram`, so the reader's one bot, connected in
   step 5a, serves both Hermes. Then the floor runs once.
   Four times a day and not hourly: every run spends the reader's ChatGPT
   allowance, the same one the assistant works from.
6. **Hand over.** Root writes the choices it made into a small file in `ai`'s
   home, re-downloads this installer for `ai`, and switches accounts for good.

## Phase 2, as `ai`: everything else

7. **Hermes present.** `kb_install_hermes`: already there from step 3.
8. **The plan and sign-in.** The installer says that this route uses a ChatGPT
   account and its included Codex allowance, not an API key or a separate Codex
   subscription. Plus or higher is the practical choice for daily scheduled work.
   Then `kb_hermes_signin openai-codex` runs `hermes auth add
   openai-codex --type oauth --no-browser`. A code and an address appear; open
   the address on any device, type the code. The window is fifteen minutes and
   an expired attempt is safe to repeat. If Hermes finds a Codex CLI login on the
   machine it offers to import it and recommends against: OAuth refresh tokens
   are single-use, so two programs sharing one chain log each other out.
9. **The kit and the shared install code**, fetched to `~/teach-it-once-kit` and
   `~/.kit-bootstrap`, the latter pinned to the tag named in `install.sh`.
10. **Your folder.** If `~/hub` is already a git folder it is topped up, not
    replaced. Otherwise you are asked once for the repository's address; a
    GitHub address triggers `gh auth login` with a code (`ensure_gh_auth`), and
    Enter means a fresh folder from the book's starter rooms.
11. **The laptop installer, on the server.** `setup-hub.sh --hub ~/hub
    [--repo ...] --skip-prereqs --sources hermes`: starter rooms or top-up, one
    visible `skills/` room with `.claude/skills` and `.agents/skills` as links
    to it (and a count of reachable recipes that refuses to print success on
    zero), `terminal.cwd` set and PROVED by having Hermes read a marker file
    (or "could not check yet" before the sign-in), the eighteen deny rules,
    the kit's tools, and the prompt log's hourly job.
12. **Keys outside the folder.** `~/.hub-env` (mode 600) for the kit's plain
    keys, and `.env*` plus `.hub-env` in the folder's `.gitignore`, before
    anything writes a secret.
13. **The private GitHub home.** Every path runs `create-private-repo.sh`. An
    existing repository is pushed and checked. A fresh folder, or an existing
    local folder with no `origin`, gets a name prompt with `hub` as the default,
    a first commit, and a new private repository. The helper then checks that the
    branch arrived and asks GitHub to confirm the repository is private. A
    failure stops before any scheduled work is added.
14. **The morning brief, only if asked for.** `Put the morning brief on this
    server's clock (y/n) [n]`. Opt-in since 2026-09-05 (Michael's call): Chapter
    21's job is a good first job for a reader who has been through Part V and
    noise for one whose server is the first machine. No terminal means no.
    `KB_MORNING_BRIEF=yes` or `no` in the environment skips the question.
15. **The Hermes half**, `server/install-hermes.sh`: the `AGENTS.md` ceiling
    check (refuses at 20,000 characters, warns from 19,000), the folder proof
    again, and, when step 14 said yes, the morning brief: `kb_cron_job` creates
    `morning-brief` at `0 6 * * *` with `--workdir ~/hub` (the one thing that
    injects `AGENTS.md` into a scheduled run) and `--deliver telegram`. It does
    NOT fire the job to prove the schedule; `hermes cron run` works with no
    gateway at all and would prove nothing. It checks the gateway instead and says
    a slot the gateway was down for runs once, late. Because the root phase
    installed a system service, this script does not add a user service beside it.
    When step 14 said no, it prints one line saying so and schedules nothing.
15a. **The watchdog's self-check, once.** Root put the second Hermes on the
    clock before the sign-in existed, so now, as `ai`, `selftest.sh` asks it for
    one word with `NOTIFY` pointing nowhere and prints the truth: "the second
    Hermes answers" or the honest warning with the reason (measured 2026-09-06
    on the rig with the sign-in cancelled: "No inference provider"), and the
    note that the clock asks again every half hour.
16. **The register.** One `## Server watchdog` block appended to `procedures.md`
    whenever the watchdog is on the machine, and, only when the brief was
    scheduled, one `## Morning brief` block: rhythm, where it lands, where it
    lives, the off-switch. Then whatever this run wrote into the folder is
    committed and pushed, so the online copy is complete.
16a. **The first message.** When the three Telegram lines are in `~/.hermes/.env`,
    `hermes send -t telegram` as `ai` puts one message on the reader's phone: no
    model, no running gateway, exactly the path the morning brief's delivery and
    the watchdog's `notify.sh` take. The line says which bot it went to.
17. **What is left.** Printed, not done. The reader is back at root's prompt when
    this prints, and their assistant is a chat on their phone (or, when Telegram
    was skipped or the hello never came, the text says so and how the next run
    picks it up). Then the door line as root (`open-the-door.sh`) and the Hermes
    app on the reader's own computer ("Connect to existing Hermes" on its first
    screen). Until 2026-09-06 (evening) Telegram was left to Chapter 29's web page
    and the reader ended Chapter 28 with a running Hermes they could not talk to;
    before that, the closing text sent them into `su - ai` and `hermes gateway
    setup`, which Michael read as the installer not finishing its job.

## The second line, `open-the-server.sh`'s sibling: `open-the-door.sh` (Chapter 29)

Run as root after the install. It installs Tailscale if it is missing and runs
`tailscale up` (prints a sign-in address and waits), reads the private address
with `tailscale ip -4`, asks for a username (default `ai`), generates a password
unless `DOOR_PASSWORD` is set, replaces the three `HERMES_DASHBOARD_BASIC_AUTH_*`
lines in `/home/ai/.hermes/.env`, writes `/etc/systemd/system/hermes-dashboard.service`
(`User=ai`, `EnvironmentFile`, `hermes dashboard --host <address> --port 9119 --no-open`, and
since 2026-09-17 the same sandbox lines the author's own unit carries: no new privileges,
the system read-only, `/home/ai` the only writable home, a private `/tmp`),
enables and starts it, waits up to three minutes for `/api/status` (the first
start builds the web page), refuses to continue unless the answer carries
`"auth_required":true`, and prints the address, username and password with the
two next steps: the web page (where **Channels** shows the bot the first line
connected and takes a second person), and the app's **Settings > Gateways >
Remote gateway**. `DOOR_HOST=<address>` skips Tailscale;
the 2026-09-05 check used the box's own address that way.

## What a working run looks like

The brief arrives on your phone at 06:00, and `hermes cron runs` shows a
completed run with `source=builtin`, which is the clock, not a hand. A morning
that fails is a listed line in `hermes cron incidents`, and the job's own
prompt tells it to say so out loud rather than staying quiet.
