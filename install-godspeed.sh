#!/usr/bin/env bash
# Main's shared installer, followed by the integrated notebook connection.
set -euo pipefail
# The shared installer adds Hermes here; keep it visible to the notebook hook.
export PATH="$HOME/.local/bin:$PATH"
ENGINE=https://raw.githubusercontent.com/MichaelZelbel/kit-bootstrap/180321af33ca98e7afbc572f993320290eb7466a/setup-godspeed.sh
STARTER=https://github.com/MichaelZelbel/godspeed-mission-control.git
KB_BRANCH=180321af33ca98e7afbc572f993320290eb7466a
export KB_BRANCH
root=${GODSPEED_V2_INSTALL_DIR:-$HOME/godspeed-v2}
args=("$@")
for ((i=0;i<$#;i++)); do
  if [ "${args[i]}" = --beside ]; then export GODSPEED_INTEGRATED_BESIDE=1; fi
  if [ "${args[i]}" = --godspeed ]; then root=${args[i+1]:?Name the Godspeed folder}; fi
done
SCRIPT=$(curl -fsSL "$ENGINE")
bash -c "$SCRIPT" setup-godspeed --starter-repo "$STARTER" --godspeed "$root" "$@"
# The development installer takes the branch's newest commit, named exactly, so the
# hook and the code it installs are the same version (the published one in installers/
# names a release instead).
GODSPEED_PRODUCT_REF=${GODSPEED_PRODUCT_REF:-$(git ls-remote https://github.com/MichaelZelbel/godspeed-mission-control.git refs/heads/codex/godspeed-v2-completeness | cut -f1)}
export GODSPEED_PRODUCT_REF
hook=$(curl -fsSL "https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control/$GODSPEED_PRODUCT_REF/notebook/scripts/install-native-notebook.sh")
bash -c "$hook" install-native-notebook "$root"
