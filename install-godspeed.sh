#!/usr/bin/env bash
# Main's shared installer, followed by the integrated notebook connection.
set -euo pipefail
export GODSPEED_PRODUCT_REF=ae92c399c293e8cd4f34cf6dc1b025b317961f63
export GODSPEED_STARTER_REF=ae92c399c293e8cd4f34cf6dc1b025b317961f63
# The shared installer adds Hermes here; keep it visible to the notebook hook.
export PATH="$HOME/.local/bin:$PATH"
ENGINE=https://raw.githubusercontent.com/MichaelZelbel/kit-bootstrap/b9ebf68db7032e36edd83f5e745194e1ebf6472c/setup-godspeed.sh
STARTER=https://github.com/MichaelZelbel/godspeed-mission-control.git
KB_BRANCH=b9ebf68db7032e36edd83f5e745194e1ebf6472c
export KB_BRANCH
root=${GODSPEED_V2_INSTALL_DIR:-$HOME/godspeed-v2}
args=("$@")
for ((i=0;i<$#;i++)); do
  if [ "${args[i]}" = --beside ]; then export GODSPEED_INTEGRATED_BESIDE=1; fi
  if [ "${args[i]}" = --godspeed ]; then root=${args[i+1]:?Name the Godspeed folder}; fi
done
SCRIPT=$(curl -fsSL "$ENGINE")
bash -c "$SCRIPT" setup-godspeed --starter-repo "$STARTER" --godspeed "$root" "$@"
hook=$(curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control/ae92c399c293e8cd4f34cf6dc1b025b317961f63/notebook/scripts/install-native-notebook.sh)
bash -c "$hook" install-native-notebook "$root"
