#!/usr/bin/env bash
# Main's shared installer, followed by the integrated notebook connection.
set -euo pipefail
export GODSPEED_PRODUCT_REF=c2ce006ed366281c1aa1a7650dd23ee746710946
export GODSPEED_STARTER_REF=c2ce006ed366281c1aa1a7650dd23ee746710946
# The shared installer adds Hermes here; keep it visible to the notebook hook.
export PATH="$HOME/.local/bin:$PATH"
ENGINE=https://raw.githubusercontent.com/MichaelZelbel/kit-bootstrap/68f6103809e5b61b0c163b7797e7f4f65664aef3/setup-godspeed.sh
STARTER=https://github.com/MichaelZelbel/godspeed-mission-control.git
KB_BRANCH=68f6103809e5b61b0c163b7797e7f4f65664aef3
export KB_BRANCH
root=${GODSPEED_V2_INSTALL_DIR:-$HOME/godspeed-v2}
args=("$@")
for ((i=0;i<$#;i++)); do
  if [ "${args[i]}" = --beside ]; then export GODSPEED_INTEGRATED_BESIDE=1; fi
  if [ "${args[i]}" = --godspeed ]; then root=${args[i+1]:?Name the Godspeed folder}; fi
done
SCRIPT=$(curl -fsSL "$ENGINE")
bash -c "$SCRIPT" setup-godspeed --starter-repo "$STARTER" --godspeed "$root" "$@"
hook=$(curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control/c2ce006ed366281c1aa1a7650dd23ee746710946/notebook/scripts/install-native-notebook.sh)
bash -c "$hook" install-native-notebook "$root"
