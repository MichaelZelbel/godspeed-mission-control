#!/usr/bin/env bash
# =============================================================================
# Teach It Once - the always-on server, in one line.
#
# Chapters 32 and 33 of the book. This puts your folder on a machine that never
# sleeps, runs Hermes there as a service that starts with the machine, connects
# your Telegram bot to it, and puts the morning brief on Hermes' own clock.
#
# On the server you just rented, logged in as root, paste this:
#
#   curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/teach-it-once-kit/main/server/install.sh | bash
#
# It is safe to run twice. Nothing here deletes anything.
#
# What it does on its own, first as root and then as your assistant's account:
#   - installs what the machine is missing (git, curl, xz, jq, the GitHub tool)
#   - makes a separate account for your assistant, so it is never root
#   - installs Hermes for that account, tells it where your folder will be,
#     connects a Telegram bot of yours to it (one token pasted, one "hi" from
#     your phone; the id is read from the bot's own message log), and installs
#     its gateway as a system service (root's one job, done once)
#   - signs Hermes in to your ChatGPT account with a code you type on any device
#   - fetches your folder from GitHub, or starts a fresh one and creates its
#     private GitHub repository (a code again in either case)
#   - wires the folder exactly the way the laptop installer does, proves Hermes
#     can read it, and, if you say yes, puts the morning brief on Hermes' clock
#   - puts a watchdog on the machine's own clock (server/install-watchdog.sh):
#     a plain check that restarts a dead gateway, a second Hermes on the same
#     sign-in that reads the logs four times a day and reports to Telegram,
#     and a half-hourly proof that the second Hermes can still answer
#
# What it asks you: a Telegram bot token (Enter skips); whether a repository
# already holds your folder, and for a fresh hub what its new private repository
# should be called; whether to connect Menerio (optional); whether to put the
# morning brief on the clock (opt-in). Plus two codes. What only you can do
# afterwards: paste server/open-the-door.sh, then point the Hermes app on your
# computer at the server (Chapter 33).
#
# The by-hand version of all of this is in server/setup.md, for when something
# breaks and you want to know what it did.
# =============================================================================

# Not `set -e`: the shared primitives report a failure and return, and a
# half-wired server that says WHICH half beats one that quit on the first snag.
set -uo pipefail

KB_TAG="setup"
export KB_TAG

# This script's own address. reexec_as_user re-downloads it to hand it to the
# assistant's account, because a script arriving through a pipe has no file on
# disk to re-run. Overridable so a test can hand it a local copy.
KB_SELF_URL="${KB_SELF_URL:-https://raw.githubusercontent.com/MichaelZelbel/teach-it-once-kit/main/server/install.sh}"
export KB_SELF_URL

# The pin is an immutable TAG, never the moving v2 branch, so this installer runs
# exactly the code that passed its end-to-end runs until this line is edited.
KB_PIN="v2.4.1"
LIB_URL="https://raw.githubusercontent.com/MichaelZelbel/kit-bootstrap/$KB_PIN/lib.sh"
KIT_REPO="https://github.com/MichaelZelbel/teach-it-once-kit.git"
AI_USER="${AI_USER:-ai}"
HUB="${HUB:-}"            # settled below: the assistant's home + /hub unless told otherwise
HUB_REPO="${HUB_REPO:-}"  # a hub you already keep on GitHub; empty means ask, or start fresh

# --- The shared groundwork ---------------------------------------------------
# Every one of our installers needs the same first hundred lines. They live in
# one repository now, so a fix reaches all of them. See kit-bootstrap/README.md.
if ! LIB="$(curl -fsSL "$LIB_URL")" || [ -z "$LIB" ]; then
  echo "Could not download the installer's shared parts from:" >&2
  echo "  $LIB_URL" >&2
  echo "Check the machine has internet, then run this again." >&2
  exit 1
fi
eval "$LIB"
unset LIB

# --- Telegram, from one token --------------------------------------------------
# Hermes switches Telegram on by itself when TELEGRAM_BOT_TOKEN is in its env file
# (gateway/config_env.py, the credential-gated enable), reads who may talk to it
# from TELEGRAM_ALLOWED_USERS, and gives `hermes send -t telegram`, the morning
# brief and the watchdog their address from TELEGRAM_HOME_CHANNEL, the line that
# /sethome would otherwise write. So three lines in ~/.hermes/.env are the whole
# connection, and the reader's id comes from the bot's own message log after one
# "hi" from their phone, the way the other kits do it. No web page, no /sethome.
# Until 2026-09-06 this installer left Telegram to Chapter 33's web page, and the
# reader ended Chapter 32 with a running Hermes they could not talk to.
# The token is never printed and never logged; it only ever travels in the URL of
# a curl call whose errors are discarded.
telegram_api() { curl -fsS -m 15 "https://api.telegram.org/bot$1/$2" 2>/dev/null; }

telegram_write() {   # $1 env file  $2 owner  $3 token  $4 user id  $5 chat id
  local env_file="$1" owner="$2"
  touch "$env_file"
  sed -i '/^TELEGRAM_BOT_TOKEN=/d;/^TELEGRAM_ALLOWED_USERS=/d;/^TELEGRAM_HOME_CHANNEL=/d' "$env_file"
  {
    printf 'TELEGRAM_BOT_TOKEN=%s\n' "$3"
    printf 'TELEGRAM_ALLOWED_USERS=%s\n' "$4"
    printf 'TELEGRAM_HOME_CHANNEL=%s\n' "$5"
  } >> "$env_file"
  chown "$owner":"$owner" "$env_file"
  chmod 600 "$env_file"
}

# Waits for the reader's first message to the bot and writes the three lines.
# Returns 0 when connected, 1 when no message came.
telegram_hello() {   # $1 env file  $2 owner  $3 token  $4 bot username
  local env_file="$1" owner="$2" token="$3" bot="$4" upd="" last="" uid="" cid="" who="" i
  cat <<HOW
   Now open @$bot in Telegram and send it any message; "hi" will do. A bot can
   only see a chat somebody has written to, and that first message is how the
   server learns your own Telegram number, so that only you may talk to it.
HOW
  ask "Press Enter once you have sent it" "" >/dev/null
  for i in $(seq 1 20); do
    upd="$(telegram_api "$token" 'getUpdates?timeout=0')" || upd=""
    last="$(printf '%s' "$upd" | jq -c '[.result[]? | select(.message.chat.type=="private") | .message] | last // empty' 2>/dev/null)"
    [ -n "$last" ] && break
    [ "$i" -eq 1 ] && log "Waiting for your message to @$bot..."
    sleep 3
  done
  if [ -z "$last" ]; then
    warn "no message has reached @$bot yet, so the server does not know your number and nobody can talk to it. The token is kept. Write to the bot, then run this one line again; it picks up here."
    telegram_write "$env_file" "$owner" "$token" "" ""
    return 1
  fi
  uid="$(printf '%s' "$last" | jq -r '.from.id')"
  cid="$(printf '%s' "$last" | jq -r '.chat.id')"
  who="$(printf '%s' "$last" | jq -r '.from.first_name // .from.username // "you"')"
  telegram_write "$env_file" "$owner" "$token" "$uid" "$cid"
  ok "Telegram: @$bot answers $who (id $uid) and nobody else; a stranger gets a pairing code and waits for you"
  ok "the morning brief and the watchdog's alerts land in that same chat"
  return 0
}

# The stop itself. Returns 0 when Telegram is connected at the end of it.
connect_telegram() {   # $1 env file  $2 owner
  local env_file="$1" owner="$2" token="" me="" bot="" tries=0
  # A token from an earlier run that never got its hello: finish that first.
  token="$(sed -n 's/^TELEGRAM_BOT_TOKEN=//p' "$env_file" 2>/dev/null | head -1)"
  if [ -n "$token" ]; then
    if me="$(telegram_api "$token" getMe)" && printf '%s' "$me" | grep -q '"ok":true'; then
      bot="$(printf '%s' "$me" | jq -r '.result.username // empty')"
      ok "a bot token is already here: @$bot. What is missing is your first message to it."
      telegram_hello "$env_file" "$owner" "$token" "$bot"
      return $?
    fi
    warn "the bot token kept here from an earlier run is no longer accepted by Telegram; asking for a fresh one"
    sed -i "/^TELEGRAM_BOT_TOKEN=/d;/^TELEGRAM_ALLOWED_USERS=/d;/^TELEGRAM_HOME_CHANNEL=/d" "$env_file"
  fi
  cat <<'WHY'
   Your assistant needs an ear. On a server there is no screen, so the ear is a
   Telegram bot of your own: you write to it from your phone, your assistant
   answers from your folder, and the morning brief and the watchdog's alerts
   land in the same chat. Making the bot takes two minutes, on your phone:

     1. In Telegram, open the account called BotFather and send it /newbot.
     2. It asks for a display name (anything) and a username, which must end
        in "bot" and must be free. It answers with a long line of letters and
        numbers in the shape 123456789:ABCdef... That is the token, and the
        token is the bot: keep it to yourself.
     3. Paste the token here. Press Enter with nothing to skip Telegram for
        now; running this one line again asks again.
WHY
  while :; do
    if [ -n "${KB_TELEGRAM_TOKEN:-}" ]; then
      token="$KB_TELEGRAM_TOKEN"; KB_TELEGRAM_TOKEN=""   # from the environment, once
    else
      token="$(ask "Paste the bot token, or press Enter to skip" "")"
    fi
    if [ -z "$token" ]; then
      warn "Telegram skipped. Your assistant has no ear yet; run this one line again when you have a bot token, and it asks for it first."
      return 1
    fi
    case "$token" in
      *:*) ;;
      *) warn "that does not look like a bot token: BotFather's has a colon in it, 123456789:ABCdef... Paste the whole line (Enter skips)."; continue ;;
    esac
    case "$token" in
      *[!A-Za-z0-9:_-]*) warn "that does not look like a bot token: it has characters a token never has. Paste the whole line from BotFather (Enter skips)."; continue ;;
    esac
    if me="$(telegram_api "$token" getMe)" && printf '%s' "$me" | grep -q '"ok":true'; then
      bot="$(printf '%s' "$me" | jq -r '.result.username // empty')"
      ok "the token is good: your bot is @$bot"
      break
    fi
    tries=$((tries+1))
    if [ "$tries" -ge 3 ]; then
      warn "Telegram did not accept that token three times. Skipping Telegram for now; check the token against BotFather's message and run this one line again."
      return 1
    fi
    warn "Telegram did not accept that token. Check it against BotFather's message and paste it again (Enter skips)."
  done
  telegram_hello "$env_file" "$owner" "$token" "$bot"
}

# =============================================================================
# PHASE 1 - as root: the things only an administrator may do
# =============================================================================
if kb_is_root; then
  say "Setting up the machine"

  need_tools git curl xz jq
  ok "git, curl, xz and jq are here"

  # Hermes' own installer builds one small native part (its terminal helper,
  # node-pty) and needs a C++ compiler for it. A fresh Ubuntu server has none,
  # and the assistant's account may not install one, so root does it here.
  # Found on the 2026-09-05 run: without it the Hermes installer stopped,
  # printed "sudo apt install build-essential", and this script died a line later.
  if ! command -v g++ >/dev/null 2>&1; then
    log "Installing the compiler Hermes' installer needs (build-essential)..."
    if [ "${KB_APT_UPDATED:-0}" -eq 0 ]; then
      apt-get update -y >/dev/null 2>&1 || warn "Could not refresh the software list; trying the install anyway."
      KB_APT_UPDATED=1
    fi
    DEBIAN_FRONTEND=noninteractive apt-get install -y build-essential >/dev/null 2>&1 \
      || die "Could not install build-essential, which Hermes' installer needs. Run
   'sudo apt install build-essential' by hand, read what it says, then run this again."
  fi
  ok "a C++ compiler is here, for the one part of Hermes that is built on the machine"

  # Installed now, as root, because the assistant's account will not be allowed
  # to install software - and that is the point of that account, not a problem
  # with it.
  ensure_gh

  say "Making an account for your assistant"
  cat <<'WHY'
   The login you were given with this machine can destroy it. Your assistant
   does not need that, and on a server there is nobody awake at 3am to ask
   "are you sure?". So it gets its own account with its own home folder, and
   the safety comes from how little that account can reach.
WHY
  if ! id -u "$AI_USER" >/dev/null 2>&1; then
    adduser --disabled-password --gecos "" "$AI_USER" >/dev/null \
      || die "Could not create the account '$AI_USER'."
    ok "made the account '$AI_USER'"
  else
    ok "the account '$AI_USER' is already here"
  fi
  AI_HOME="$(getent passwd "$AI_USER" | cut -d: -f6)"
  [ -n "$AI_HOME" ] && [ -d "$AI_HOME" ] || die "The account '$AI_USER' has no home folder."
  HUB="${HUB:-$AI_HOME/hub}"

  # Hermes is installed FOR the assistant's account, by root, before the account
  # takes over. Root has to be the one to install the gateway as a system service
  # a few lines down, and the service needs the binary to exist first.
  say "Installing Hermes for that account"
  HERMES_BIN="$AI_HOME/.local/bin/hermes"
  if [ -x "$HERMES_BIN" ]; then
    ok "already installed: $(su - "$AI_USER" -c "'$HERMES_BIN' --version" 2>/dev/null | head -1)"
  else
    # Its output is kept, not thrown away: when it stops, the reason is in the log
    # and the reader is told where, instead of being sent to run it again blind.
    HERMES_LOG="$AI_HOME/hermes-install.log"
    su - "$AI_USER" -c 'curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash' > "$HERMES_LOG" 2>&1 \
      || die "the Hermes installer did not finish for '$AI_USER'. Its output is in
   $HERMES_LOG; the last lines say why. Fix that, then run this one line again."
    chown "$AI_USER":"$AI_USER" "$HERMES_LOG" 2>/dev/null || true
    [ -x "$HERMES_BIN" ] || die "the Hermes installer ran but left no program at $HERMES_BIN.
   Its output is in $HERMES_LOG; the last lines say what it still needed."
    ok "installed: $(su - "$AI_USER" -c "'$HERMES_BIN' --version" 2>/dev/null | head -1)"
  fi

  # THE ORDER HERE IS LOAD-BEARING. The gateway copies terminal.cwd into its own
  # environment once, when it starts (agent/runtime_cwd.py: "bridged once ... at
  # gateway/cron startup"). A gateway started before the folder is set works in
  # the wrong place until somebody restarts it, and a Telegram message would land
  # in the assistant's home rather than the hub. So the folder's path is written
  # first, the service second, even though the folder itself arrives later.
  say "Telling Hermes where your folder will be"
  if su - "$AI_USER" -c "'$HERMES_BIN' config set terminal.cwd '$HUB'" >/dev/null 2>&1; then
    ok "hub: Hermes will work in $HUB"
  else
    warn "hub: could not set terminal.cwd for '$AI_USER'. The next phase tries again."
  fi

  # THE ORDER HERE IS LOAD-BEARING TOO. Telegram goes into Hermes' env file
  # BEFORE the gateway service is installed, so on a first run the gateway
  # starts with its ear already attached and nothing needs restarting. On a
  # second run the service is already up: it is stopped while the bot's message
  # log is read (a running gateway holds that log; Telegram hands it to one
  # reader at a time) and started again when the lines are written.
  say "Connecting your Telegram bot"
  AI_ENV="$AI_HOME/.hermes/.env"
  mkdir -p "$AI_HOME/.hermes" && chown "$AI_USER":"$AI_USER" "$AI_HOME/.hermes"
  if grep -q '^TELEGRAM_BOT_TOKEN=.' "$AI_ENV" 2>/dev/null && grep -q '^TELEGRAM_ALLOWED_USERS=[0-9]' "$AI_ENV" 2>/dev/null; then
    ok "Telegram is already connected on this server; not asking again"
  elif [ "${KB_TELEGRAM_SKIP:-}" = "1" ]; then
    warn "Telegram skipped, as asked (KB_TELEGRAM_SKIP=1)"
  else
    GATEWAY_WAS_UP=""
    if systemctl is-active --quiet hermes-gateway 2>/dev/null; then
      systemctl stop hermes-gateway >/dev/null 2>&1 && GATEWAY_WAS_UP=1
    fi
    connect_telegram "$AI_ENV" "$AI_USER" || true
    if [ -n "$GATEWAY_WAS_UP" ]; then
      if systemctl start hermes-gateway >/dev/null 2>&1; then
        ok "the gateway is running again, with Telegram in its settings"
      else
        warn "the gateway did not start again: systemctl status hermes-gateway"
      fi
    fi
  fi

  say "Installing the gateway as a system service"
  cat <<'WHY'
   The clock that fires the morning brief lives inside this service, and the
   messenger answers from it. As a system service it starts when the machine
   does, with nobody logged in, and comes back after a reboot on its own.
   This is the one thing on this page that has to be done as root.
WHY
  KB_HERMES_BIN="$HERMES_BIN"
  export KB_HERMES_BIN
  kb_install_gateway "$AI_USER" || true

  # --- The watchdog ------------------------------------------------------------
  # Root's half lives in its own script, so a server built by hand can add it
  # alone, and so the test rig can run it alone. It is fetched from beside this
  # installer's own address, which is the same GitHub folder for a reader and a
  # local file for the rig. Its self-check runs once more at the end of phase 2,
  # after the sign-in, as the assistant's account.
  say "Putting a watchdog on the machine"
  cat <<'WHY'
   One day something stops: the gateway dies at three in the morning, or the
   sign-in runs out and every job with it. So the machine gets a patrol of its
   own, on the machine's clock rather than Hermes' clock, which stops when
   Hermes does. A plain check with no AI in it restarts a dead gateway. A
   second Hermes, sharing your ChatGPT sign-in and on a short leash, reads the
   logs four times a day and tells your Telegram only when something broke or
   was repaired. And every half hour a one-word question proves that second
   Hermes can still answer at all.
WHY
  WATCHDOG_INSTALL_URL="${WATCHDOG_INSTALL_URL:-${KB_SELF_URL%/*}/install-watchdog.sh}"
  if WD_SCRIPT="$(curl -fsSL "$WATCHDOG_INSTALL_URL")" && [ -n "$WD_SCRIPT" ]; then
    AI_USER="$AI_USER" bash -c "$WD_SCRIPT" \
      || warn "the watchdog reported a problem above. Everything else still runs; add it later with:
   curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/teach-it-once-kit/main/server/install-watchdog.sh | bash"
  else
    warn "could not download the watchdog's installer from $WATCHDOG_INSTALL_URL. Everything else still runs; add it later with:
   curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/teach-it-once-kit/main/server/install-watchdog.sh | bash"
  fi

  # `su -` starts the next phase with a clean environment, so the choices made
  # here travel in a small file the next phase reads once and deletes.
  CARRY="$AI_HOME/.kit-bootstrap-env"
  {
    printf 'HUB=%q\n' "$HUB"
    printf 'HUB_REPO=%q\n' "$HUB_REPO"
    printf 'AI_USER=%q\n' "$AI_USER"
    printf 'KB_SKIP_HUB_PROOF=%q\n' "${KB_SKIP_HUB_PROOF:-}"
    printf 'KB_SYNC_SOURCES=%q\n' "${KB_SYNC_SOURCES:-hermes}"
    printf 'KB_MORNING_BRIEF=%q\n' "${KB_MORNING_BRIEF:-}"
  } > "$CARRY"
  chown "$AI_USER":"$AI_USER" "$CARRY"
  chmod 0600 "$CARRY"

  # Hands the rest of this script to that account and does not come back.
  reexec_as_user "$AI_USER"
fi

# =============================================================================
# PHASE 2 - as the assistant's account: everything else
# =============================================================================
if [ -f "$HOME/.kit-bootstrap-env" ]; then
  # shellcheck disable=SC1090
  . "$HOME/.kit-bootstrap-env"
  rm -f "$HOME/.kit-bootstrap-env"
fi
HUB="${HUB:-$HOME/hub}"
KIT_DIR="$HOME/teach-it-once-kit"
BOOTSTRAP_DIR="$HOME/.kit-bootstrap"
export PATH="$HOME/.local/bin:$PATH"
KB_HERMES_BIN="${KB_HERMES_BIN:-$HOME/.local/bin/hermes}"
export KB_HERMES_BIN

# If someone ran this as an ordinary user on a machine that is missing the
# basics, say the useful thing rather than failing on a permission error.
MISSING=""
for t in git curl xz jq; do
  command -v "$t" >/dev/null 2>&1 || MISSING="$MISSING $t"
done
if [ -n "$MISSING" ]; then
  PACKAGES="$(printf '%s' "$MISSING" | sed 's/\bxz\b/xz-utils/')"
  die "This machine is missing:$MISSING

   Your account is not allowed to install software, which is correct. Log out,
   log back in as the administrator account you were given with the machine,
   and run this same one-line command there. It will install these, make your
   assistant's account, and carry on by itself."
fi

say "Installing your assistant"
kb_install_hermes || die "Hermes is not on this machine and could not be installed. Read what it printed above."

# The sign-in. A device code: open the address on any device, type the code.
# This path uses ChatGPT's included Codex allowance, not an API bill.
# `hermes login` is deprecated and is never used here. A code that runs out is
# safe to repeat, and this whole script is safe to run again.
say "Signing your assistant in"
cat <<'PLAN'
   This route uses your ChatGPT account, not an API key and not a separate
   Codex subscription. A ChatGPT plan with Codex access is enough to try it.
   For a hub that works every day, Plus or higher is the practical choice so
   a small allowance does not stop scheduled work. Current plan details:
   https://learn.chatgpt.com/docs/pricing
PLAN
kb_hermes_signin openai-codex \
  || warn "Hermes is not signed in yet. Everything below still gets set up, and
   the folder check will say it could not check yet. When you are ready:
   $(kb_hermes_bin) auth add openai-codex --type oauth --no-browser
   then run this one line again."

# --- The kit, and the shared install code ------------------------------------
say "Getting the book's files"

fetch_repo() {
  local url="$1" dir="$2" branch="${3:-}" name="$4"
  if [ -d "$dir/.git" ]; then
    # When a pin is named, an existing clone is MOVED to it, or a server built
    # last month keeps running last month's code while this file says otherwise.
    # `git pull` cannot do that from a detached tag checkout, so fetch the ref
    # and check it out directly. Works for a tag and a branch alike.
    if [ -n "$branch" ]; then
      { git -C "$dir" fetch -q --depth 1 origin "$branch" \
          && git -C "$dir" checkout -q FETCH_HEAD; } >/dev/null 2>&1 \
        || warn "Could not update $name to $branch; using the copy already here."
    else
      git -C "$dir" pull --ff-only >/dev/null 2>&1 || warn "Could not update $name; using the copy already here."
    fi
    ok "$name updated"
  else
    if [ -n "$branch" ]; then
      git clone --depth 1 --branch "$branch" "$url" "$dir" >/dev/null 2>&1 || die "Could not download $name from $url"
    else
      git clone --depth 1 "$url" "$dir" >/dev/null 2>&1 || die "Could not download $name from $url"
    fi
    ok "$name downloaded"
  fi
}

fetch_repo "$KIT_REPO" "$KIT_DIR" "" "the book's kit"
fetch_repo "https://github.com/MichaelZelbel/kit-bootstrap.git" "$BOOTSTRAP_DIR" "$KB_PIN" "the shared install code"

[ -f "$KIT_DIR/server/install-hermes.sh" ] || die "The kit downloaded but server/install-hermes.sh is missing from it."
[ -f "$BOOTSTRAP_DIR/setup-hub.sh" ] || die "The shared install code downloaded but setup-hub.sh is missing from it."

# --- Your folder -------------------------------------------------------------
say "Your folder"

if [ -d "$HUB/.git" ]; then
  ok "a folder is already at $HUB; it will be brought up to date, not replaced"
  if ! git -C "$HUB" remote get-url origin >/dev/null 2>&1; then
    say "This hub has no online copy yet; the installer will make a private one"
  fi
elif [ -z "$HUB_REPO" ]; then
  cat <<'ASK'
   Two ways to start, and the installer needs to know which:
     1. This server joins a hub you already have, on your laptop or elsewhere.
        Paste the address of its private GitHub copy (the one that ends in
        .git, or the https://github.com/you/name form).
     2. This server is your first machine. Press Enter, and the installer
        starts a fresh folder here from the book's starter rooms; your other
        computers can pick it up later.
ASK
  HUB_REPO="$(ask "Paste the address, or press Enter for a fresh folder" "")"
fi

if [ -n "$HUB_REPO" ] && [ ! -d "$HUB/.git" ]; then
  case "$HUB_REPO" in
    *github.com*)
      say "Connecting this machine to GitHub"
      ensure_gh_auth
      ;;
  esac
fi

# The same installer the laptop runs, from the pinned copy just fetched: the
# starter rooms (or a top-up of the folder that arrived), one visible skills room
# with the links pointing at it, terminal.cwd PROVED by a file read once a
# provider is connected, the leash, the kit's tools, and the prompt log's own
# clock. On a server the prompt log reads Hermes, because Hermes is what runs here.
say "Setting the folder up the way the laptop installer does"
SETUP_ARGS=(--hub "$HUB" --skip-prereqs --sources "${KB_SYNC_SOURCES:-hermes}")
[ -n "$HUB_REPO" ] && SETUP_ARGS+=(--repo "$HUB_REPO")
KB_BRANCH="$KB_PIN" bash "$BOOTSTRAP_DIR/setup-hub.sh" "${SETUP_ARGS[@]}" \
  || warn "the folder setup reported a problem above. Read it; everything below still runs."

# --- The keys go where the folder is not --------------------------------------
# Done BEFORE anything writes a secret. The morning job commits and pushes the
# folder, and `git add -A` means everything, so a key inside the folder travels.
say "Putting the keys where the folder is not"
umask 077
touch "$HOME/.hub-env"
chmod 600 "$HOME/.hub-env"
umask 022
if [ -d "$HUB" ]; then
  grep -qxF '.env*'    "$HUB/.gitignore" 2>/dev/null || echo '.env*'    >> "$HUB/.gitignore"
  grep -qxF '.hub-env' "$HUB/.gitignore" 2>/dev/null || echo '.hub-env' >> "$HUB/.gitignore"
fi
ok "plain keys live in $HOME/.hub-env, outside the folder, and the folder ignores any that stray in"

say "Giving your hub a checked private GitHub home"
ensure_gh_auth
bash "$KIT_DIR/server/create-private-repo.sh" "$HUB" \
  || die "the private GitHub repository was not created or checked. Read the reason above, then run this installer again."
HUB_REPO="$(git -C "$HUB" remote get-url origin 2>/dev/null || true)"

# --- The morning brief, only if asked for -------------------------------------
# Chapter 22's job is a good first job for a reader who has been through Part V,
# and noise for one whose server is the first machine in the system. So it is
# opt-in, and the default is no (Michael, 2026-09-05). KB_MORNING_BRIEF=yes|no
# set in the environment skips the question; with no terminal the answer is no.
if [ "${KB_MORNING_BRIEF:-}" != "yes" ] && [ "${KB_MORNING_BRIEF:-}" != "no" ]; then
  cat <<'ASK'
   Hermes can write you a morning brief, the book's first example job: every
   day at 06:00 it reads your profile files, writes a short brief for the day
   into brief/ in your folder, and sends it to your Telegram bot.
   Say no if you do not want it yet. You can add it later by running this one
   line again.
ASK
  if ask_yes "Put the morning brief on this server's clock" "n"; then
    KB_MORNING_BRIEF=yes
  else
    KB_MORNING_BRIEF=no
  fi
fi
export KB_MORNING_BRIEF

# --- The Hermes half: the ceiling, the folder proof, the clock ---------------
# One script, shared with readers who built the server by hand, so there is
# exactly one copy of these steps to fix. It checks the AGENTS.md ceiling, points
# Hermes at the folder and proves it with a file read, leaves the gateway to the
# system service from the root phase, and, when asked for, schedules the morning
# brief with --workdir (the one thing that hands a scheduled run its AGENTS.md)
# and Telegram delivery.
if [ "$KB_MORNING_BRIEF" = "yes" ]; then
  say "The morning brief, on Hermes' clock"
else
  say "Checking Hermes against your folder"
fi
KB_CALLED_FROM_INSTALLER=1 HUB="$HUB" bash "$KIT_DIR/server/install-hermes.sh" \
  || warn "the Hermes half reported a problem above. Read it before trusting the clock."

# --- The watchdog's self-check, once, now -------------------------------------------
# Root put the second Hermes on the clock before the sign-in existed. Now the
# sign-in is here (or was skipped), so ask that second Hermes for one word, as
# this account, and print the truth. Nothing is sent: NOTIFY points nowhere.
if [ -x /opt/hermes-watchdog/templates/selftest.sh ] && [ -d "$HOME/.hermes/profiles/watchdog" ]; then
  say "Asking the second Hermes, the watchdog, to answer one word"
  WD_STATE="$HOME/.local/state/hermes-watchdog"
  mkdir -p "$WD_STATE"
  if HERMES_BIN="$(kb_hermes_bin)" WATCHDOG_HOME="$HOME/.hermes/profiles/watchdog" LOG_FILE="$WD_STATE/selftest.log" \
     STATE_DIR="$WD_STATE" NOTIFY=/nonexistent PROBE_TIMEOUT=180 \
     bash /opt/hermes-watchdog/templates/selftest.sh >/dev/null 2>&1; then
    ok "watchdog: the second Hermes answers, on the same sign-in as your assistant"
  else
    warn "watchdog: the second Hermes could not answer yet ($(tail -1 "$WD_STATE/selftest.log" 2>/dev/null | sed 's/^[^|]*| //' | cut -c1-160)).
   It will once the sign-in is done; the self-check on the clock asks again every half hour."
  fi
fi

# --- The register --------------------------------------------------------------
# Nothing runs unlisted. One block, written once, if the folder has the file and
# not the block, and only when the job was put on the clock.
# The starter's own register carries a "## Morning brief" EXAMPLE inside a comment, so
# the test is for the server's line, not the heading.
if [ "$KB_MORNING_BRIEF" = "yes" ] && [ -f "$HUB/procedures.md" ] && ! grep -q 'Lives: Hermes cron, the server' "$HUB/procedures.md"; then
  cat >> "$HUB/procedures.md" <<REG

## Morning brief

Does: reads my profile files and writes today's brief before I start work.
Rhythm: daily, 06:00.             Lands: brief/YYYY-MM-DD.md in this folder, and my phone.
Lives: Hermes cron, the server.   Off-switch: hermes cron pause morning-brief, on the server.
Last checked: $(date +%F).
REG
  ok "register: the morning brief has its block in procedures.md"
fi
if [ -f "$HUB/procedures.md" ] && [ -x /opt/hermes-watchdog/floor/quick-check.sh ] && ! grep -q '^## Server watchdog' "$HUB/procedures.md"; then
  cat >> "$HUB/procedures.md" <<REG

## Server watchdog

Does: keeps Hermes alive on the server. Every five minutes a plain check restarts the gateway if it died; every half hour it proves the second Hermes can answer; four times a day the second Hermes reads the logs and reports.
Rhythm: 5 min, 30 min, 6 h.       Lands: my Telegram, only when something broke or was repaired.
Lives: the machine's own clock (root's crontab), the server.
Off-switch: as root on the server, crontab -e, delete the lines between the two "teach-it-once:watchdog" markers.
Last checked: $(date +%F).
REG
  ok "register: the watchdog has its block in procedures.md"
fi

# --- The first message, sent the way the brief and the alerts will be sent -----------
# `hermes send` needs no model and no running gateway for Telegram: it reads the
# token and the home channel from ~/.hermes/.env, which is exactly the path the
# morning brief's delivery and the watchdog's notify.sh take. A message on the
# reader's phone at the end of the run is the proof that path is open.
TELEGRAM_STATE="none"
if grep -q '^TELEGRAM_HOME_CHANNEL=[-0-9]' "$HOME/.hermes/.env" 2>/dev/null; then
  TELEGRAM_STATE="connected"
  say "Sending you the first message"
  BOT_TOKEN="$(sed -n 's/^TELEGRAM_BOT_TOKEN=//p' "$HOME/.hermes/.env" | head -1)"
  BOT_NAME="$(curl -fsS -m 15 "https://api.telegram.org/bot$BOT_TOKEN/getMe" 2>/dev/null | jq -r '.result.username // "your bot"')"
  unset BOT_TOKEN
  if printf '%s\n' "Your server is set up, and this is your assistant's chat. Write to me here from anywhere: try \"what is in my folder?\"" \
     | "$(kb_hermes_bin)" send -t telegram -s "Teach It Once" -q >/dev/null 2>&1; then
    ok "sent to @$BOT_NAME: look at your phone. That message went the way the morning brief and the watchdog's alerts will go"
  else
    warn "Hermes could not send to Telegram yet; the three lines are in $HOME/.hermes/.env. Read: $(kb_hermes_bin) send -t telegram test"
  fi
elif grep -q '^TELEGRAM_BOT_TOKEN=.' "$HOME/.hermes/.env" 2>/dev/null; then
  TELEGRAM_STATE="nohello"
fi

# The private copy was pushed before the register line and the Hermes half wrote
# into the folder, so send what changed since. Quiet when there is nothing new or
# no online copy; a push that fails is said, not hidden, and breaks nothing.
if git -C "$HUB" remote get-url origin >/dev/null 2>&1 \
   && [ -n "$(git -C "$HUB" status --porcelain 2>/dev/null)" ]; then
  if git -C "$HUB" add -A >/dev/null 2>&1 \
     && git -C "$HUB" commit -q -m "Set up the always-on server" >/dev/null 2>&1 \
     && git -C "$HUB" push -q origin HEAD >/dev/null 2>&1; then
    ok "pushed: the online copy has everything this run wrote into your folder"
  else
    warn "the last changes to the folder were not pushed. Ask your assistant to commit and push the folder, or run: git -C $HUB add -A && git -C $HUB commit -m 'Set up the server' && git -C $HUB push"
  fi
fi

# --- What is left, and only you can do it ------------------------------------
say "What is left, and only you can do it"
# When this block prints, the reader is back at the administrator's prompt: the
# hand-over ran the assistant's phase and returned. The book's next chapter does
# everything below from a web page, so this text sends the reader there and not
# into the terminal: one more pasted line as root, then a browser and the app.
# (Until 2026-09-06 it sent them into `su - ai`, `hermes gateway setup` and a
# systemctl restart; Michael read that as the installer not finishing its job.)
cat <<NEXT
$(case "$TELEGRAM_STATE" in
  connected) cat <<'T'

   Your assistant is running, and it has a phone number. Hermes' gateway is a
   service on this machine, working in your folder, and it comes back after a
   reboot on its own. Your bot on Telegram is its ear: write to it from
   wherever you are and it answers from your folder. Nothing more is typed
   here tonight; from now on your assistant is a chat on your phone.
T
  ;;
  nohello) cat <<'T'

   Your assistant is running, but nobody can talk to it yet: the bot token is
   here and your first message to the bot never arrived. Write to the bot on
   Telegram, then paste this one line again; it picks up at that step.
T
  ;;
  *) cat <<'T'

   Your assistant is running, but it has no ear yet: Telegram was skipped.
   When you have a bot token from BotFather, paste this one line again; it
   asks for the token first and leaves everything else as it is.
T
  ;;
esac)

   What is left is the book's next chapter, which puts this server on your
   desk. Only one more line is typed here.

   1. As the administrator, paste the book's second line. It puts this server
      on your private Tailscale network (make a free account at tailscale.com
      first), runs Hermes' own web page as a service, and prints the page's
      address, a username and a password:

        curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/teach-it-once-kit/main/server/open-the-door.sh | bash

   2. Install the Hermes app on your computer. On its first screen choose
      "Connect to existing Hermes" (or later: Settings, Gateways, Remote
      gateway), give it that address, and sign in with the username and
      password from step 1. The app then works on this server, in your folder.

   A watchdog is on this machine's clock: a plain check restarts a dead
   gateway, and a second Hermes on your sign-in reads the logs four times a
   day. You hear from it on the same bot, only when something broke or was
   repaired, or when it cannot answer at all.
$(if [ "$KB_MORNING_BRIEF" = "yes" ]; then cat <<'BRIEF'

   From the next 06:00 the morning brief arrives on your bot by itself. A
   morning the gateway was down is caught up once, late, when it is back.
BRIEF
else cat <<'BRIEF'

   Nothing is on this server's clock yet. When you want the morning brief
   there, run this one line again and answer yes to that question.
BRIEF
fi)

NEXT
