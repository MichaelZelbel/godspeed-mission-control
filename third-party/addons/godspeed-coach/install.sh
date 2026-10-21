#!/bin/bash
# godspeed-coach, installed with one line:
#   curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/godspeed-coach/main/install.sh | bash
# Run it as the account your assistant runs as, from inside your mission control folder.
#
# Why a script and not "npx": on a fresh Teach It Once server, Hermes brings its own Node, but not
# onto the command path, so npx and node are "command not found" there (found in a fresh Ubuntu
# container, 2026-09-29). This finds whichever Node the machine has and runs the setup with it.
set -euo pipefail

REF="${GODSPEED_COACH_REF:-main}"
URL="https://codeload.github.com/MichaelZelbel/godspeed-coach/tar.gz/refs/heads/$REF"

say() { printf '%s\n' "$*"; }

version_ok() { "$1" -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 22 ? 0 : 1)' 2>/dev/null; }

NODE=""
for c in "$(command -v node 2>/dev/null || true)" $(ls -d "$HOME"/.hermes/tools/node-*/bin/node 2>/dev/null | sort -V -r) /usr/local/bin/node /usr/bin/node; do
  [ -n "$c" ] && [ -x "$c" ] && version_ok "$c" && { NODE="$c"; break; }
done
if [ -z "$NODE" ]; then
  say "godspeed-coach needs Node.js 22 or newer, and none was found on this computer."
  say "Install Hermes first (it brings its own), or Node.js from https://nodejs.org, then run this line again."
  exit 1
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
if ! curl -fsSL "$URL" | tar -xz -C "$TMP"; then
  say "Could not download godspeed-coach from GitHub. Check the internet connection and run this line again."
  exit 1
fi
PKG="$(ls -d "$TMP"/godspeed-coach-*)"

say "godspeed-coach: using Node $("$NODE" --version) at $NODE"
# The setup asks for your time zone. Under "curl | bash" the keyboard is not standard input, so the
# questions read from the terminal itself when there is one.
if [ -r /dev/tty ] && [ -w /dev/tty ] && ( : < /dev/tty ) 2>/dev/null; then
  "$NODE" "$PKG/bin/godspeed-coach.mjs" setup "$@" < /dev/tty
else
  "$NODE" "$PKG/bin/godspeed-coach.mjs" setup "$@"
fi
