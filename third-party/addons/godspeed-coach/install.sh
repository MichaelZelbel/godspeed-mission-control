#!/bin/bash
# godspeed-coach's setup for a mission control folder you keep yourself. Godspeed Mission Control's
# own installers already set the coach up; this is for a folder of your own.
#
#   bash install.sh --godspeed <your mission control folder>
#       from a folder that holds this add-on (in Godspeed Mission Control: third-party/addons/godspeed-coach)
#   curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control/main/third-party/addons/godspeed-coach/install.sh | bash
#       without one: it fetches only this add-on's folder from Godspeed Mission Control on GitHub (needs git)
#
# Run it as the account your assistant runs as. Any options go to `godspeed-coach setup`.
#
# Why a script and not "npx": on a fresh server, Hermes brings its own Node, but not onto the
# command path, so npx and node are "command not found" there (found in a fresh Ubuntu container,
# 2026-09-29). This finds whichever Node the machine has and runs the setup with it.
#
# FROM THE PUBLIC PRODUCT (18 October 2026). Until then this script downloaded the add-on from its
# development repository, which is private, so for anyone but its maintainer it stopped at
# "Could not download". The add-on ships inside Godspeed Mission Control, so that is where it comes
# from now: the copy beside this script when there is one, else that folder of the public repository.
set -euo pipefail

REF="${GODSPEED_REF:-main}"
REPO="https://github.com/MichaelZelbel/godspeed-mission-control.git"
ADDON="third-party/addons/godspeed-coach"

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

# The copy this script sits in, when it is a file on disk (not read from a pipe).
PKG=""
HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
[ -n "$HERE" ] && [ -f "$HERE/bin/godspeed-coach.mjs" ] && PKG="$HERE"

if [ -z "$PKG" ]; then
  if ! command -v git >/dev/null 2>&1; then
    say "godspeed-coach comes from Godspeed Mission Control on GitHub, and fetching it needs git, which this computer does not have."
    say "Install git, then run this line again."
    exit 1
  fi
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  # Only this add-on's folder is fetched, not the whole product.
  if ! { git clone -q --depth 1 --branch "$REF" --filter=blob:none --sparse "$REPO" "$TMP/gmc" >/dev/null 2>&1 \
         && git -C "$TMP/gmc" sparse-checkout set "$ADDON" >/dev/null 2>&1; } || [ ! -f "$TMP/gmc/$ADDON/bin/godspeed-coach.mjs" ]; then
    say "Could not download godspeed-coach from Godspeed Mission Control on GitHub. Check the internet connection and run this line again."
    exit 1
  fi
  PKG="$TMP/gmc/$ADDON"
fi

say "godspeed-coach: using Node $("$NODE" --version) at $NODE"
# The setup asks for your time zone. Under "curl | bash" the keyboard is not standard input, so the
# questions read from the terminal itself when there is one.
if [ -r /dev/tty ] && [ -w /dev/tty ] && ( : < /dev/tty ) 2>/dev/null; then
  "$NODE" "$PKG/bin/godspeed-coach.mjs" setup "$@" < /dev/tty
else
  "$NODE" "$PKG/bin/godspeed-coach.mjs" setup "$@"
fi
