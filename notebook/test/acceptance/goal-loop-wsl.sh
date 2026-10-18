#!/usr/bin/env bash
# goal-loop-wsl.sh: the goal-loop acceptance on a fresh WSL Ubuntu 24.04, from Git Bash on Windows.
#
# It makes a distro of its own from Ubuntu's WSL root filesystem (with systemd, as a reader's computer
# has it), puts the AI key into it without printing it, runs goal-loop-inside.sh there as root (that
# script says what it checks: install, the AI connected through Settings, a goal, research, a
# decision, work verified by its check, a reading told in the notebook, settle, the next decision
# through Hermes' own routine, the Goals page), keeps the log, and removes the distro.
#
# A real terminal is not needed here: nothing in this walk waits for typing (the installer gets
# --sources "" and an empty standard input, as the release gate runs it).
#
# Usage:
#   export OPENROUTER_TESTS_API_KEY=...          (an OpenRouter key kept for tests; never printed)
#   bash notebook/test/acceptance/goal-loop-wsl.sh [--commit <40 hex, on GitHub>] [--model <model>]
#        [--floor <dollars>] [--research-minutes <n>] [--rootfs <ubuntu wsl tar.gz>] [--log-root <dir>]
#        [--distros <dir>] [--keep]
# Defaults: the commit checked out here, qwen/qwen3.7-flash, stop below $0.05 of credit, 45 minutes of
# research, logs under %LOCALAPPDATA%\godspeed-acceptance\logs. The distro's disk grows to about 6 GB;
# --distros puts it on another drive when the system drive is short (it is removed at the end).
# Ends with the inside script's "ACCEPTANCE PASSED", "ACCEPTANCE FAILED: ..." or "ACCEPTANCE STOPPED: ..."
# line and its exit code.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
COMMIT="$(git -C "$HERE" rev-parse HEAD 2>/dev/null)"; MODEL="qwen/qwen3.7-flash"; FLOOR="0.05"; MINUTES=45; KEEP=0
CACHE="${LOCALAPPDATA:-$HOME}/godspeed-acceptance"; ROOTFS="$CACHE/ubuntu-noble-wsl-amd64-24.04lts.rootfs.tar.gz"; LOG_ROOT="$CACHE/logs"; DISTROS="$CACHE/distros"
while [ $# -gt 0 ]; do
  case "$1" in
    --commit) COMMIT="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --floor) FLOOR="$2"; shift 2 ;;
    --research-minutes) MINUTES="$2"; shift 2 ;;
    --rootfs) ROOTFS="$2"; shift 2 ;;
    --log-root) LOG_ROOT="$2"; shift 2 ;;
    --distros) DISTROS="$2"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    -h|--help) sed -n '2,22p' "$0"; exit 0 ;;
    *) echo "goal-loop-wsl: I do not know $1" >&2; exit 2 ;;
  esac
done
cant() { echo "goal-loop-wsl: $*" >&2; exit 2; }
command -v wsl.exe >/dev/null 2>&1 || cant "this needs Windows with WSL 2"
[[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]] || cant "--commit must be a full commit"
[ -n "${OPENROUTER_TESTS_API_KEY:-}" ] || cant "set OPENROUTER_TESTS_API_KEY first (an OpenRouter key kept for tests)"
curl -fsI "https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control/$COMMIT/install-godspeed.sh" >/dev/null 2>&1 \
  || cant "commit $COMMIT is not on GitHub; push it first (any branch)"
mkdir -p "$CACHE" "$LOG_ROOT" || cant "could not make $CACHE"
if [ ! -s "$ROOTFS" ]; then
  echo "Downloading Ubuntu 24.04's WSL root filesystem..."
  base=https://cloud-images.ubuntu.com/wsl/releases/24.04/current
  curl -fsSL -o "$ROOTFS.part" "$base/ubuntu-noble-wsl-amd64-24.04lts.rootfs.tar.gz" || cant "the download failed"
  want="$(curl -fsSL "$base/SHA256SUMS" | sed -n 's/^\([0-9a-f]\{64\}\) \*\{0,1\}ubuntu-noble-wsl-amd64-24.04lts.rootfs.tar.gz$/\1/p')"
  [ -n "$want" ] && [ "$(sha256sum "$ROOTFS.part" | cut -d' ' -f1)" = "$want" ] || { rm -f "$ROOTFS.part"; cant "the download does not match Ubuntu's checksum"; }
  mv "$ROOTFS.part" "$ROOTFS"
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"; NAME="gs-goal-loop-$STAMP"; DIR="$DISTROS/$NAME"; LOG="$LOG_ROOT/goal-loop-$STAMP"
mkdir -p "$DIR" "$LOG"
w() { MSYS_NO_PATHCONV=1 wsl.exe -d "$NAME" -u root -e "$@"; }
cleanup() {
  if [ "$KEEP" = 1 ]; then echo "kept the distro $NAME (wsl.exe -d $NAME; remove with wsl.exe --unregister $NAME)"; return; fi
  wsl.exe --terminate "$NAME" >/dev/null 2>&1; wsl.exe --unregister "$NAME" >/dev/null 2>&1 && echo "removed the distro $NAME"
  rm -rf "$DIR"
}
trap cleanup EXIT
echo "distro $NAME, commit $COMMIT, model $MODEL, log $LOG"
wsl.exe --import "$NAME" "$(cygpath -w "$DIR")" "$(cygpath -w "$ROOTFS")" --version 2 >/dev/null || cant "wsl.exe --import failed"
# systemd, as on a reader's Ubuntu: the notebook runs as a service.
w sh -c 'printf "[boot]\nsystemd=true\n[user]\ndefault=root\n" > /etc/wsl.conf' || cant "could not write wsl.conf"
wsl.exe --terminate "$NAME" >/dev/null 2>&1
printf '%s' "$OPENROUTER_TESTS_API_KEY" | w sh -c 'umask 077; cat > /root/.openrouter-key' || cant "could not hand the key to the distro"
INSIDE="$(w wslpath -a "$(cygpath -w "$HERE/goal-loop-inside.sh")" | tr -d '\r')"
LOGW="$(w wslpath -a "$(cygpath -w "$LOG")" | tr -d '\r')"
w bash "$INSIDE" --commit "$COMMIT" --model "$MODEL" --key-file /root/.openrouter-key --log "$LOGW" --floor "$FLOOR" --research-minutes "$MINUTES"
RC=$?
echo "goal-loop-wsl: the inside run ended with exit $RC; its log is $LOG/run.log"
exit "$RC"
