#!/usr/bin/env bash
# Godspeed Mission Control v2 installer. The current edition stays on main.
set -euo pipefail
url=https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control/codex/godspeed-v2-completeness/installers/install-godspeed.sh
script=$(curl -fsSL "$url")
exec bash -c "$script" install-godspeed "$@"
