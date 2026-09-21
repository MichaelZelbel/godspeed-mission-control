#!/usr/bin/env bash
# =============================================================================
# Teach It Once - open a private door to the server, in one line.
#
# Chapter 33. After the one-line installer has built the server and connected
# its Telegram bot, this puts a private address on it (Tailscale), gives the
# door a username and a password, runs Hermes' web page as a service on that
# address, and checks that the page asks for the password. From then on the web
# page (settings, jobs, sessions, channels) and the Hermes app on your own
# computer both reach the server through it.
#
# On the server, logged in as root, paste this:
#
#   curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/teach-it-once-kit/main/server/open-the-door.sh | bash
#
# It is safe to run twice. Nothing here deletes anything.
#
# What it asks you: a username for the door (Enter keeps the default). What it
# shows you: one web address from Tailscale to sign in on any device, and at the
# end the server's private address and the password it made.
#
# Knobs, all optional, for a reader who knows what they want:
#   DOOR_HOST=<address>   use this address and do not touch Tailscale
#   DOOR_USER=<name>      the door's username, without asking
#   DOOR_PASSWORD=<pw>    the door's password, instead of a generated one
#   AI_USER=<account>     the assistant's account (default: ai)
# =============================================================================

set -uo pipefail

KB_TAG="door"
export KB_TAG
KB_PIN="v2.4.1"
LIB_URL="https://raw.githubusercontent.com/MichaelZelbel/kit-bootstrap/$KB_PIN/lib.sh"
AI_USER="${AI_USER:-ai}"
PORT=9119

if ! LIB="$(curl -fsSL "$LIB_URL")" || [ -z "$LIB" ]; then
  echo "Could not download the installer's shared parts from:" >&2
  echo "  $LIB_URL" >&2
  echo "Check the machine has internet, then run this again." >&2
  exit 1
fi
eval "$LIB"
unset LIB

kb_is_root || die "Run this as root, the login you were given with the machine. The one-line
   installer made the '$AI_USER' account on purpose without the right to open doors."

AI_HOME="$(getent passwd "$AI_USER" 2>/dev/null | cut -d: -f6)"
[ -n "$AI_HOME" ] && [ -d "$AI_HOME" ] || die "There is no account called '$AI_USER' here. Run the one-line installer first."
HERMES_BIN="$AI_HOME/.local/bin/hermes"
[ -x "$HERMES_BIN" ] || die "Hermes is not installed for '$AI_USER' ($HERMES_BIN is missing). Run the one-line installer first."
ENV_FILE="$AI_HOME/.hermes/.env"

# --- A private address ---------------------------------------------------------
say "A private address for this server"
if [ -n "${DOOR_HOST:-}" ]; then
  ok "using the address you gave: $DOOR_HOST"
else
  cat <<'WHY'
   Your computer and this server need to reach each other without the rest of
   the internet listening in. Tailscale does that: a free service that gives
   each of your machines a private address only your other machines can reach.
   It needs a free account at tailscale.com, made before this step.
WHY
  if ! command -v tailscale >/dev/null 2>&1; then
    log "Installing Tailscale..."
    curl -fsSL https://tailscale.com/install.sh | sh >/dev/null 2>&1 \
      || die "Tailscale did not install. Read https://tailscale.com/kb/1031/install-linux and run this again."
    ok "Tailscale is installed"
  else
    ok "Tailscale is already here"
  fi
  if ! tailscale ip -4 >/dev/null 2>&1; then
    cat <<'HOW'

   Tailscale is about to print a web address. Open it on any device, sign in
   with your Tailscale account, and this server joins your private network.
   This line waits until you have done that.

HOW
    tailscale up || die "Tailscale did not connect. Run 'tailscale up' by hand and read what it prints."
  fi
  DOOR_HOST="$(tailscale ip -4 2>/dev/null | head -1)"
  [ -n "$DOOR_HOST" ] || die "Tailscale is connected but gave no address. Run 'tailscale ip -4' by hand and read what it says."
  ok "this server's private address is $DOOR_HOST"
fi

# --- A username and a password -------------------------------------------------
say "A username and a password for the door"
if [ -z "${DOOR_USER:-}" ]; then
  DOOR_USER="$(ask "Username for the door" "$AI_USER")"
fi
case "$DOOR_USER" in
  *[!A-Za-z0-9._@-]*|'') die "the username may contain letters, numbers, dots, dashes, underscores and @." ;;
esac
GENERATED=""
if [ -z "${DOOR_PASSWORD:-}" ]; then
  DOOR_PASSWORD="$(openssl rand -base64 24 | tr -d '/+=' | cut -c1-18)"
  GENERATED=1
fi
SECRET="$(openssl rand -base64 32)"

# The three lines Hermes' documentation names, written once. Existing values of
# the same three names are replaced, everything else in the file is kept.
touch "$ENV_FILE"
sed -i '/^HERMES_DASHBOARD_BASIC_AUTH_\(USERNAME\|PASSWORD\|SECRET\)=/d' "$ENV_FILE"
{
  printf 'HERMES_DASHBOARD_BASIC_AUTH_USERNAME=%s\n' "$DOOR_USER"
  printf 'HERMES_DASHBOARD_BASIC_AUTH_PASSWORD=%s\n' "$DOOR_PASSWORD"
  printf 'HERMES_DASHBOARD_BASIC_AUTH_SECRET=%s\n' "$SECRET"
} >> "$ENV_FILE"
chown "$AI_USER":"$AI_USER" "$ENV_FILE"
chmod 600 "$ENV_FILE"
ok "the door has a username and a password, kept in $ENV_FILE"

# --- The web page, as a service -----------------------------------------------
# `hermes dashboard` is the web page AND the backend the Hermes app connects to,
# on one port. Bound to the private address, Hermes' own auth gate is on and
# asks for the username and password above. Shaped like the author's own unit.
say "Running Hermes' web page as a service on the private address"
cat > /etc/systemd/system/hermes-dashboard.service <<UNIT
[Unit]
Description=Hermes web page and app backend, on a private address
After=network-online.target tailscaled.service
Wants=network-online.target

[Service]
Type=simple
User=$AI_USER
Group=$AI_USER
WorkingDirectory=$AI_HOME
Environment=HOME=$AI_HOME
Environment=PATH=$AI_HOME/.local/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
EnvironmentFile=$ENV_FILE
ExecStart=$HERMES_BIN dashboard --host $DOOR_HOST --port $PORT --no-open
Restart=on-failure
RestartSec=10
TimeoutStopSec=30

# The same protections the author's own copy of this unit has always had. Until
# 2026-09-17 this one shipped with none, although its comment said "shaped like
# the author's own unit". This service answers on a network address, so it may
# never gain more rights than it starts with, may write nowhere in the system
# except the assistant's own home (where Hermes builds the web page on its first
# start) and a /tmp of its own, and may not touch kernel settings. The '$AI_USER'
# account was made without the right to become root, so there is nothing here
# for NoNewPrivileges to get in the way of.
NoNewPrivileges=true
ProtectSystem=full
ProtectHome=read-only
ReadWritePaths=$AI_HOME
PrivateTmp=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now hermes-dashboard.service >/dev/null 2>&1 \
  || die "the service did not start. Read: journalctl -u hermes-dashboard -n 30"
systemctl restart hermes-dashboard.service
ok "service installed and started; it comes back after a reboot"

# --- The check Hermes' documentation names --------------------------------------
say "Checking that the door asks for the password"
echo "   (the first start can take a minute or two while Hermes builds its web page)"
STATUS=""
for _ in $(seq 1 90); do
  sleep 2
  STATUS="$(curl -s -m 3 "http://$DOOR_HOST:$PORT/api/status" 2>/dev/null || true)"
  [ -n "$STATUS" ] && break
done
[ -n "$STATUS" ] || die "the web page did not answer within three minutes at http://$DOOR_HOST:$PORT.
   Read: journalctl -u hermes-dashboard -n 30"
case "$STATUS" in
  *'"auth_required":true'*) ok "the page is up at http://$DOOR_HOST:$PORT and asks for the password" ;;
  *) die "the page is up but does NOT ask for a password (auth_required is not true). Do not use it like this.
   Check the three HERMES_DASHBOARD_BASIC_AUTH lines in $ENV_FILE, then: systemctl restart hermes-dashboard" ;;
esac

# --- What is left, and only you can do it ------------------------------------
say "What is left, and only you can do it"
cat <<NEXT

   The door is open, on an address only your own devices can reach.

        Address:   http://$DOOR_HOST:$PORT
        Username:  $DOOR_USER
        Password:  $DOOR_PASSWORD
$( [ -n "$GENERATED" ] && printf '\n      That password was made for you just now. Write it down or put it in your\n      password manager; it also lives in %s on this server.\n' "$ENV_FILE" )

   On your own computer, install Tailscale from tailscale.com/download and sign
   in with the same account, so your computer is on the same private network.

   In a browser: open the address above and sign in. That is Hermes' own web
   page for this server: its settings, its sessions, its scheduled jobs, and
   under Channels the Telegram bot the first line connected, where a second
   person can be added with a form. The page's own Restart gateway button
   cannot make that live on this server: the gateway runs as a system
   service, and this account was made without the right to restart one.
   Making it live still needs one line typed on the server, as root:
   systemctl restart hermes-gateway.

   In the Hermes app on your computer: Settings, then Gateways, then Remote
   gateway. Enter the address above as the Remote URL, press Sign in, give the
   username and password, then Save and reconnect.

NEXT
