#!/usr/bin/env bash
# install-hub.sh - the name this installer had until 23 September 2026.
#
# The reader's folder is `godspeed` now and the reader's commands carry `mc-`, so the
# entry file is install-godspeed.sh. This one stays because raw.githubusercontent.com
# does not redirect a moved file: a bookmark, a printed line, or a short link that still
# says install-hub.sh would simply 404. It runs the real installer and nothing else.
set -euo pipefail
NEW="https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control/main/install-godspeed.sh"
SCRIPT="$(curl -fsSL "$NEW")" || {
  echo "could not download the installer from:" >&2
  echo "       $NEW" >&2
  exit 1
}
exec bash -c "$SCRIPT" install-godspeed.sh "$@"
