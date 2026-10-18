#!/usr/bin/env bash
# Main's shared installer, followed by the integrated notebook connection.
set -euo pipefail
# A Mac gets Git and Node.js from Homebrew, so Homebrew is checked first, before anything is
# downloaded. Until 18 October 2026 nothing checked, and a Mac without it ended with a broken
# install. One Homebrew just installed is often not on this window's PATH yet: it is used anyway.
# GODSPEED_BREW_PLACES names other places to look, for a test.
if [ "$(uname -s)" = Darwin ]; then
  for brew in ${GODSPEED_BREW_PLACES:-/opt/homebrew/bin/brew /usr/local/bin/brew}; do
    if ! command -v brew >/dev/null 2>&1 && [ -x "$brew" ]; then eval "$("$brew" shellenv)"; fi
  done
  if ! command -v brew >/dev/null 2>&1 && { ! command -v node >/dev/null 2>&1 || ! xcode-select -p >/dev/null 2>&1; }; then
    cat >&2 <<'BREW'

This Mac needs Homebrew first. Homebrew is the free program that installs the tools Godspeed
uses, Git and Node.js. Nothing was changed.

1. Open https://brew.sh and copy the line under "Install Homebrew".
2. Paste it into this Terminal window and press Return. It asks for your Mac password.
3. When it has finished, paste the Godspeed line again.

BREW
    exit 1
  fi
fi
export GODSPEED_PRODUCT_REF=bc3b63d10097ed46faab8d6e4be5672201b3ad68
export GODSPEED_STARTER_REF=bc3b63d10097ed46faab8d6e4be5672201b3ad68
# The shared installer adds Hermes here; keep it visible to the notebook hook.
export PATH="$HOME/.local/bin:$PATH"
ENGINE=https://raw.githubusercontent.com/MichaelZelbel/kit-bootstrap/86da1dd27fea804ab131a8494b79a2ccf868e847/setup-godspeed.sh
STARTER=https://github.com/MichaelZelbel/godspeed-mission-control.git
KB_BRANCH=86da1dd27fea804ab131a8494b79a2ccf868e847
export KB_BRANCH
root=${GODSPEED_V2_INSTALL_DIR:-$HOME/godspeed-v2}
args=("$@")
for ((i=0;i<$#;i++)); do
  if [ "${args[i]}" = --beside ]; then export GODSPEED_INTEGRATED_BESIDE=1; fi
  if [ "${args[i]}" = --godspeed ]; then root=${args[i+1]:?Name the Godspeed folder}; fi
done
SCRIPT=$(curl -fsSL "$ENGINE")
bash -c "$SCRIPT" setup-godspeed --starter-repo "$STARTER" --godspeed "$root" "$@"
hook=$(curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control/bc3b63d10097ed46faab8d6e4be5672201b3ad68/notebook/scripts/install-native-notebook.sh)
bash -c "$hook" install-native-notebook "$root"
