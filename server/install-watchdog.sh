#!/usr/bin/env bash
# =============================================================================
# Teach It Once - the watchdog on the always-on server. Root's half.
#
# Chapter 32. The one-line installer runs this as root, after Hermes and its
# gateway service are in place and before it hands over to the assistant's
# account. It also runs alone, as root, to add the watchdog to a server built
# by hand, or to bring one up to date:
#
#   curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/teach-it-once-kit/main/server/install-watchdog.sh | bash
#
# It is safe to run twice. Nothing here deletes anything.
#
# Why the watchdog is on the MACHINE's clock and not on Hermes' clock: the
# gateway's own clock stops when the gateway does, which is exactly when a
# watchdog has to run. So root's crontab carries three lines:
#   - every 5 minutes: the floor, plain shell with no AI in it. Is the gateway
#     alive? Restart it once if not.
#   - every 30 minutes: the self-check. Can the second Hermes answer one word?
#     If not, the alert says SELF-HEALING IS DOWN, the one failure a Hermes
#     that shares its sign-in with the gateway cannot otherwise see.
#   - four times a day: the second Hermes reads the logs, explains every
#     restart the floor made, and reports to Telegram only when something
#     broke or was repaired. It shares the gateway's ChatGPT sign-in (no second
#     subscription), keeps its own memory, and wears a leash that refuses
#     everything dangerous rather than asking, because nobody is there to
#     answer. Four times a day and not hourly, because every run spends the
#     reader's ChatGPT allowance, the same one the assistant works from.
# The scripts come from the open-source Hermes Self DevOps Watchdog at an
# immutable tag; the floor inside it is fetched from ITS one upstream and
# verified by hash. Nothing here is a second copy of anything.
# =============================================================================
set -uo pipefail

AI_USER="${AI_USER:-ai}"
WATCHDOG_REPO="${WATCHDOG_REPO:-https://github.com/MichaelZelbel/hermes-self-devops-watchdog.git}"
WATCHDOG_PIN="${WATCHDOG_PIN:-v1.0.11}"
WATCHDOG_DIR="${WATCHDOG_DIR:-/opt/hermes-watchdog}"
LOG_DIR="${WATCHDOG_LOG_DIR:-/var/log/hermes-watchdog}"
STATE_DIR="${WATCHDOG_STATE_DIR:-/var/lib/hermes-watchdog}"
SELFTEST_EVERY="${SELFTEST_EVERY:-*/30 * * * *}"
DEEP_CHECK_AT="${DEEP_CHECK_AT:-23 */6 * * *}"

say()  { printf '\n== %s\n' "$1"; }
ok()   { printf '   ok: %s\n' "$1"; }
warn() { printf '   ATTENTION: %s\n' "$1"; }
die()  { printf '\n   STOPPED: %s\n\n' "$1" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "Run this as root, the login you were given with the machine. The watchdog
   lives on root's clock, because only root may restart the gateway service."

AI_HOME="$(getent passwd "$AI_USER" 2>/dev/null | cut -d: -f6)"
[ -n "$AI_HOME" ] && [ -d "$AI_HOME" ] || die "There is no account called '$AI_USER' here. Run the one-line installer first."
HERMES_BIN="$AI_HOME/.local/bin/hermes"
[ -x "$HERMES_BIN" ] || die "Hermes is not installed for '$AI_USER' ($HERMES_BIN is missing). Run the one-line installer first."
HERMES_HOME="$AI_HOME/.hermes"
WATCHDOG_HOME="$HERMES_HOME/profiles/watchdog"
[ -f /etc/systemd/system/hermes-gateway.service ] \
  || warn "there is no hermes-gateway.service on this machine yet. The floor will report the
   gateway as down until the one-line installer has installed it."

as_ai() { su - "$AI_USER" -c "$1"; }

# --- What root's clock needs ---------------------------------------------------
say "Checking what the machine has"
MISSING=""
command -v crontab >/dev/null 2>&1 || MISSING="$MISSING cron"
command -v sudo    >/dev/null 2>&1 || MISSING="$MISSING sudo"
command -v git     >/dev/null 2>&1 || MISSING="$MISSING git"
command -v jq      >/dev/null 2>&1 || MISSING="$MISSING jq"
if [ -n "$MISSING" ]; then
  command -v apt-get >/dev/null 2>&1 || die "this machine is missing:$MISSING, and it is not Ubuntu or Debian, so install them by hand and run this again."
  apt-get update -y >/dev/null 2>&1 || true
  # shellcheck disable=SC2086
  DEBIAN_FRONTEND=noninteractive apt-get install -y $MISSING >/dev/null 2>&1 || die "could not install:$MISSING. Run 'apt install$MISSING' by hand, read what it says, then run this again."
fi
systemctl enable --now cron >/dev/null 2>&1 || true
systemctl is-active --quiet cron || die "the machine's clock (the cron service) is not running, and 'systemctl enable --now cron' did not start it. Read: systemctl status cron"
ok "cron, sudo, git and jq are here, and the clock is running"

# --- 1. The watchdog, at its tag --------------------------------------------------
say "Getting the watchdog"
if [ -d "$WATCHDOG_DIR/.git" ]; then
  if git -C "$WATCHDOG_DIR" fetch -q --depth 1 origin "refs/tags/$WATCHDOG_PIN:refs/tags/$WATCHDOG_PIN" >/dev/null 2>&1 \
     && git -C "$WATCHDOG_DIR" checkout -q "$WATCHDOG_PIN" >/dev/null 2>&1; then
    ok "watchdog at $WATCHDOG_PIN in $WATCHDOG_DIR"
  else
    warn "could not move $WATCHDOG_DIR to $WATCHDOG_PIN; using the copy already here"
  fi
else
  git clone -q --depth 1 --branch "$WATCHDOG_PIN" "$WATCHDOG_REPO" "$WATCHDOG_DIR" >/dev/null 2>&1 \
    || die "Could not download the watchdog from $WATCHDOG_REPO at $WATCHDOG_PIN. Check the machine has internet, then run this again."
  ok "watchdog $WATCHDOG_PIN downloaded to $WATCHDOG_DIR"
fi
chmod +x "$WATCHDOG_DIR"/templates/*.sh "$WATCHDOG_DIR"/floor/fetch-floor.sh 2>/dev/null || true
for f in templates/selftest.sh templates/notify.sh templates/run-prompt.sh floor/fetch-floor.sh prompts/six-hour-deep-check.md templates/hermes-approvals.conservative.example.yaml; do
  [ -f "$WATCHDOG_DIR/$f" ] || die "the watchdog downloaded but $f is missing from it."
done

# --- 2. The floor, verified ---------------------------------------------------------
say "Fetching the floor, the check with no AI in it"
bash "$WATCHDOG_DIR/floor/fetch-floor.sh" >/dev/null 2>&1 \
  || die "The floor could not be fetched and verified against its pinned hash. Nothing was put on the clock."
[ -x "$WATCHDOG_DIR/floor/quick-check.sh" ] || die "the floor was fetched but $WATCHDOG_DIR/floor/quick-check.sh is not there."
ok "floor verified by hash: $WATCHDOG_DIR/floor/quick-check.sh"

# --- 3. The second Hermes ------------------------------------------------------------
say "Making the second Hermes, the one that watches"
if [ -d "$WATCHDOG_HOME" ]; then
  ok "the watchdog profile is already here: $WATCHDOG_HOME"
else
  as_ai "'$HERMES_BIN' profile create watchdog --no-skills --no-alias" >/dev/null 2>&1 \
    || die "hermes profile create watchdog failed for '$AI_USER'. Run it by hand as that account and read what it says."
  [ -d "$WATCHDOG_HOME" ] || die "the watchdog profile did not appear at $WATCHDOG_HOME"
  ok "profile 'watchdog' made for $AI_USER: its own memory and sessions, the gateway's sign-in"
fi

# --- 4. The leash ---------------------------------------------------------------------
# The conservative list: the second Hermes looks, reports and asks; the floor
# does the one repair. Read back and tested both ways, because both bit for
# real (docs/approvals.md in the watchdog).
say "Putting the leash on it"
TEMPLATE="$WATCHDOG_DIR/templates/hermes-approvals.conservative.example.yaml"
DENY_JSON="$(sed -n 's/^[[:space:]]*- "\(.*\)"[[:space:]]*$/\1/p' "$TEMPLATE" | jq -R . | jq -sc .)"
WANT="$(printf '%s' "$DENY_JSON" | jq 'length')"
[ "${WANT:-0}" -gt 10 ] || die "the leash template at $TEMPLATE has only ${WANT:-0} entries; something is wrong with the download."
as_ai "HERMES_HOME='$WATCHDOG_HOME' '$HERMES_BIN' config set approvals.deny '$DENY_JSON'" >/dev/null 2>&1 \
  || die "hermes config set approvals.deny failed on the watchdog profile."
GOT="$(as_ai "HERMES_HOME='$WATCHDOG_HOME' '$HERMES_BIN' config get approvals.deny" 2>/dev/null | grep -c '^[[:space:]]*- ')"
[ "${GOT:-0}" -ge "$WANT" ] || die "the leash is NOT on: $WANT entries were set and ${GOT:-0} read back. Update Hermes and run this again."
as_ai "HERMES_HOME='$WATCHDOG_HOME' '$HERMES_BIN' approvals test -- ufw --force reset" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 3 ] || die "the leash did not refuse 'ufw --force reset' (exit $rc, wanted 3)."
as_ai "HERMES_HOME='$WATCHDOG_HOME' '$HERMES_BIN' approvals test -- git status" >/dev/null 2>&1; rc=$?
[ "$rc" -eq 0 ] || die "the leash refused 'git status' (exit $rc); it went too far."
ok "leash on: $GOT refusals, checked both ways (a firewall reset is refused, ordinary work is not)"

# --- 5. Root's clock -----------------------------------------------------------------------
# One block between two markers, replaced whole on every run, so a second run
# never doubles a line and switching the watchdog off is deleting the block.
# The variables are the ones docs/root-and-service-user.md in the watchdog
# names for this layout: the floor runs as root (it restarts a system unit),
# the self-check and the operator hop to the assistant's account and its
# watchdog profile, and alerts go out as that account too, from the Hermes
# home that holds the Telegram token.
say "Putting the watchdog on the machine's clock"
mkdir -p "$LOG_DIR" "$STATE_DIR"
START="# teach-it-once:watchdog start"
END="# teach-it-once:watchdog end"
BLOCK="$(cat <<EOF
$START (Hermes watching Hermes; to switch it off, delete everything from here to the end line)
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
HERMES_USER=$AI_USER
HERMES_HOME=$HERMES_HOME
HERMES_BIN=$HERMES_BIN
WATCHDOG_HOME=$WATCHDOG_HOME
OPERATOR_CMD=sudo -n -u $AI_USER -H env HERMES_HOME=$WATCHDOG_HOME
SEND_CMD=sudo -n -u $AI_USER -H
SEND_HOME=$HERMES_HOME
REPO=$WATCHDOG_DIR
STATE_DIR=$STATE_DIR
LOG_DIR=$LOG_DIR
FLOOR_LOG=$LOG_DIR/quick.log
FLOOR_STATE=""
*/5 * * * * $WATCHDOG_DIR/floor/quick-check.sh
$SELFTEST_EVERY $WATCHDOG_DIR/templates/selftest.sh
$DEEP_CHECK_AT $WATCHDOG_DIR/templates/run-prompt.sh six-hour-deep-check
$END
EOF
)"
EXISTING="$(crontab -l 2>/dev/null || true)"
CLEANED="$(printf '%s\n' "$EXISTING" | sed "/^$START/,/^$END/d")"
if [ -n "$(printf '%s' "$CLEANED" | tr -d '[:space:]')" ]; then
  printf '%s\n\n%s\n' "$CLEANED" "$BLOCK" | crontab - || die "could not write root's crontab."
else
  printf '%s\n' "$BLOCK" | crontab - || die "could not write root's crontab."
fi
N="$(crontab -l 2>/dev/null | grep -c '^# teach-it-once:watchdog')"
[ "$N" -eq 2 ] || die "root's crontab does not carry exactly one watchdog block ($N markers)."
ok "three lines on root's clock: the floor every 5 minutes, the self-check every 30, the second Hermes four times a day"

# --- 6. The floor, once, now ------------------------------------------------------------------
# So the first line in its log is a fact and not a hope. Exit 0 is healthy,
# 10 means the gateway was not running and the floor restarted it.
say "Running the floor once"
HERMES_USER="$AI_USER" HERMES_HOME="$HERMES_HOME" HERMES_BIN="$HERMES_BIN" STATE_DIR="$STATE_DIR" LOG_FILE="$LOG_DIR/quick.log" \
  bash "$WATCHDOG_DIR/floor/quick-check.sh" >/dev/null 2>&1; rc=$?
LAST="$(tail -1 "$LOG_DIR/quick.log" 2>/dev/null | cut -c1-140)"
case "$rc" in
  0)  ok "floor: ${LAST:-healthy}" ;;
  10) warn "floor: the gateway was not running, so the floor restarted it: ${LAST:-}" ;;
  *)  warn "floor: exit $rc; its log is $LOG_DIR/quick.log" ;;
esac

cat <<DONE

   The watchdog is on this machine's clock. Its alerts go to the Telegram bot
   your assistant answers on, once that is connected, and only when something
   broke, was repaired, or when the second Hermes cannot answer at all. The
   one-line installer checks that second Hermes once, after the sign-in.

DONE
