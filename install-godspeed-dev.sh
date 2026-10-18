#!/usr/bin/env bash
# Main's shared installer, followed by the integrated notebook connection.
#
# THIS IS THE DEVELOPMENT INSTALLER: it installs the newest commit of the v2 branch,
# so two runs a day apart can install different code. Readers use the published one,
# installers/install-godspeed.sh attached to the release with its checksum, which names
# one exact commit (README.md, "Linux or Mac"); install-godspeed.sh beside this file is that one too.
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
# main's newest commit (version 2 is developed on main since 9 October 2026), named exactly and resolved before anything is installed,
# so the hook and the code it installs are the same version.
GODSPEED_PRODUCT_REF=${GODSPEED_PRODUCT_REF:-$(git ls-remote https://github.com/MichaelZelbel/godspeed-mission-control.git refs/heads/main | cut -f1)}
[[ "$GODSPEED_PRODUCT_REF" =~ ^[0-9a-f]{40}$ ]] || { echo 'The development version could not be found on GitHub.' >&2; exit 1; }
export GODSPEED_PRODUCT_REF
echo "Development installer: version 2 at commit $GODSPEED_PRODUCT_REF (readers use the release installer)." >&2
SCRIPT=$(curl -fsSL "$ENGINE")
bash -c "$SCRIPT" setup-godspeed --starter-repo "$STARTER" --godspeed "$root" "$@"
hook=$(curl -fsSL "https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control/$GODSPEED_PRODUCT_REF/notebook/scripts/install-native-notebook.sh")
bash -c "$hook" install-native-notebook "$root"
