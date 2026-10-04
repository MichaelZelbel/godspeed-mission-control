#!/usr/bin/env bash
# Main's shared installer, followed by the integrated notebook connection.
set -euo pipefail
ENGINE=https://raw.githubusercontent.com/MichaelZelbel/kit-bootstrap/e81519b362864ccc6d2614ce3fc141c6f82131f2/setup-godspeed.sh
STARTER=https://github.com/MichaelZelbel/godspeed-mission-control.git
KB_BRANCH=e81519b362864ccc6d2614ce3fc141c6f82131f2
export KB_BRANCH
root=${GODSPEED_V2_INSTALL_DIR:-$HOME/godspeed-v2}
args=("$@")
for ((i=0;i<$#;i++)); do
  if [ "${args[i]}" = --godspeed ]; then root=${args[i+1]:?Name the Godspeed folder}; fi
done
SCRIPT=$(curl -fsSL "$ENGINE")
bash -c "$SCRIPT" setup-godspeed --starter-repo "$STARTER" --godspeed "$root" "$@"
hook=$(curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control/codex/godspeed-v2-completeness/notebook/scripts/install-native-notebook.sh)
bash -c "$hook" install-native-notebook "$root"
