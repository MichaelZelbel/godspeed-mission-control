#!/usr/bin/env bash
# Main's shared installer, followed by the integrated notebook connection.
set -euo pipefail
export GODSPEED_PRODUCT_REF=e09577cd322124aade3960509fb7957b5d2ed37c
export GODSPEED_STARTER_REF=e09577cd322124aade3960509fb7957b5d2ed37c
# The shared installer adds Hermes here; keep it visible to the notebook hook.
export PATH="$HOME/.local/bin:$PATH"
ENGINE=https://raw.githubusercontent.com/MichaelZelbel/kit-bootstrap/5f42a5b38227d048fc12b0678e0159589a283697/setup-godspeed.sh
STARTER=https://github.com/MichaelZelbel/godspeed-mission-control.git
KB_BRANCH=5f42a5b38227d048fc12b0678e0159589a283697
export KB_BRANCH
root=${GODSPEED_V2_INSTALL_DIR:-$HOME/godspeed-v2}
args=("$@")
for ((i=0;i<$#;i++)); do
  if [ "${args[i]}" = --beside ]; then export GODSPEED_INTEGRATED_BESIDE=1; fi
  if [ "${args[i]}" = --godspeed ]; then root=${args[i+1]:?Name the Godspeed folder}; fi
done
SCRIPT=$(curl -fsSL "$ENGINE")
bash -c "$SCRIPT" setup-godspeed --starter-repo "$STARTER" --godspeed "$root" "$@"
hook=$(curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control/e09577cd322124aade3960509fb7957b5d2ed37c/notebook/scripts/install-native-notebook.sh)
bash -c "$hook" install-native-notebook "$root"
