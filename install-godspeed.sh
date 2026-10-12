#!/usr/bin/env bash
# Main's shared installer, followed by the integrated notebook connection.
set -euo pipefail
export GODSPEED_PRODUCT_REF=e861fcca3da77f971f7362ed21af49d51e241473
# The shared installer adds Hermes here; keep it visible to the notebook hook.
export PATH="$HOME/.local/bin:$PATH"
ENGINE=https://raw.githubusercontent.com/MichaelZelbel/kit-bootstrap/0eafb061d28a077b2d7c0cc83d0bd002fcb44444/setup-godspeed.sh
STARTER=https://github.com/MichaelZelbel/godspeed-mission-control.git
KB_BRANCH=0eafb061d28a077b2d7c0cc83d0bd002fcb44444
export KB_BRANCH
root=${GODSPEED_V2_INSTALL_DIR:-$HOME/godspeed-v2}
args=("$@")
for ((i=0;i<$#;i++)); do
  if [ "${args[i]}" = --beside ]; then export GODSPEED_INTEGRATED_BESIDE=1; fi
  if [ "${args[i]}" = --godspeed ]; then root=${args[i+1]:?Name the Godspeed folder}; fi
done
SCRIPT=$(curl -fsSL "$ENGINE")
bash -c "$SCRIPT" setup-godspeed --starter-repo "$STARTER" --godspeed "$root" "$@"
hook=$(curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control/e861fcca3da77f971f7362ed21af49d51e241473/notebook/scripts/install-native-notebook.sh)
bash -c "$hook" install-native-notebook "$root"
