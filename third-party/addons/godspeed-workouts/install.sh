#!/usr/bin/env bash
# Workouts, an add-on for Godspeed Mission Control: the installer for Linux and macOS.
#
#   curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/godspeed-workouts/main/install.sh | bash
#
# With options for the setup, put them after "bash -s --", for example:
#
#   curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/godspeed-workouts/main/install.sh | bash -s -- --godspeed ~/godspeed
#
# Run it as the account your Godspeed notebook runs as; on a server, as root. HEVY_API_KEY in the
# environment gives the key without a question.
#
# What it does:
#   1. Finds Node.js 22 or newer: on the PATH, the Node Godspeed's installer put in your Godspeed
#      folder, the Node Hermes brings, nvm's, Homebrew's, /usr/local, /usr/bin. It installs none.
#   2. Downloads the newest release (main, when there is none) into a temporary folder, or clones it
#      with git when the download is refused. GODSPEED_WORKOUTS_REF picks another tag or branch.
#   3. Runs the setup: the Hevy key (asked, not shown, checked with Hevy before it is kept), the
#      Workouts tracker in your notebook, every workout so far, and the hourly run (a systemd timer;
#      on macOS a LaunchAgent). The program goes to /usr/local/lib/godspeed-workouts as root, else
#      ~/.godspeed/addons/godspeed-workouts; the command to /usr/local/bin or ~/.godspeed/bin.
#   4. Deletes the temporary folder.
#
# Safe to run again: it is also the update. The key, the settings and the rows stay.
# To take it out: godspeed-workouts uninstall

main() {
  set -euo pipefail
  local repo="MichaelZelbel/godspeed-workouts"
  say() { printf '%s\n' "$*"; }
  major() { "$1" --version 2>/dev/null | sed -n 's/^v\([0-9][0-9]*\)\..*/\1/p' | head -n 1; }

  local gs="" d node="" c m
  if [ -f "$HOME/.godspeed/device.env" ]; then gs="$(sed -n 's/^[[:space:]]*GODSPEED_DIR=//p' "$HOME/.godspeed/device.env" | head -n 1 | tr -d \"\')"; fi
  for c in "$(command -v node 2>/dev/null || true)" \
           $(ls -d /usr/local/lib/nodejs/node-v*/bin/node 2>/dev/null | sort -r) \
           $(for d in "$gs" "$HOME/godspeed" "$HOME/godspeed-v2"; do [ -n "$d" ] && ls -d "$d"/.godspeed/integrated-runtime/runtime/node-v*/bin/node 2>/dev/null; done | sort -r) \
           $(ls -d "$HOME"/.hermes/tools/node-*/bin/node 2>/dev/null | sort -r) \
           $(ls -d "$HOME"/.nvm/versions/node/*/bin/node 2>/dev/null | sort -r) \
           /opt/homebrew/bin/node /usr/local/bin/node /usr/bin/node; do
    [ -n "$c" ] && [ -x "$c" ] || continue
    m="$(major "$c")"
    if [ -n "$m" ] && [ "$m" -ge 22 ]; then node="$c"; break; fi
  done
  if [ -z "$node" ]; then
    say "Workouts needs Node.js 22 or newer, and none was found. Install Godspeed Mission Control first"
    say "(it brings its own Node), or Node.js LTS from https://nodejs.org, then run this line again."
    exit 1
  fi

  local ref="${GODSPEED_WORKOUTS_REF:-}"
  if [ -z "$ref" ]; then
    ref="$(curl -fsSL -H 'User-Agent: godspeed-workouts-installer' "https://api.github.com/repos/$repo/releases/latest" 2>/dev/null \
      | grep -o '"tag_name"[[:space:]]*:[[:space:]]*"[^"]*"' | head -n 1 | sed 's/.*"\([^"]*\)"$/\1/' || true)"
    [ -n "$ref" ] || ref="main"
  fi
  WORKOUTS_TMP="$(mktemp -d "${TMPDIR:-/tmp}/godspeed-workouts-XXXXXX")"
  trap 'rm -rf "${WORKOUTS_TMP:-}"' EXIT
  local pkg=""
  if curl -fsSL "https://codeload.github.com/$repo/tar.gz/$ref" 2>/dev/null | tar -xz -C "$WORKOUTS_TMP" 2>/dev/null; then
    pkg="$(ls -d "$WORKOUTS_TMP"/godspeed-workouts-* 2>/dev/null | head -n 1)"
  elif command -v git >/dev/null 2>&1 && git clone -q --depth 1 --branch "$ref" "https://github.com/$repo.git" "$WORKOUTS_TMP/godspeed-workouts" 2>/dev/null; then
    pkg="$WORKOUTS_TMP/godspeed-workouts"
  fi
  if [ -z "$pkg" ] || [ ! -f "$pkg/bin/godspeed-workouts.mjs" ]; then
    say "Could not download Workouts ($ref) from GitHub. Check the internet connection and run this line again."
    exit 1
  fi
  say "Workouts ($ref), with Node $("$node" --version) at $node"

  # Under "curl | bash" the keyboard is not standard input (the script is): the key question reads
  # the terminal itself when there is one.
  local code=0
  if [ -r /dev/tty ] && [ -w /dev/tty ] && ( : < /dev/tty ) 2>/dev/null; then
    "$node" "$pkg/bin/godspeed-workouts.mjs" setup "$@" < /dev/tty || code=$?
  else
    "$node" "$pkg/bin/godspeed-workouts.mjs" setup "$@" < /dev/null || code=$?
  fi
  if [ "$code" -ne 0 ]; then
    say "The setup stopped (exit $code). What it printed above says why; run this line again once that is fixed."
    exit "$code"
  fi
}

main "$@"
