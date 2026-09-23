#!/usr/bin/env bash
# =============================================================================
# Teach It Once - set up your mission control on this Mac or Linux computer, in one line.
#
#   curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/teach-it-once-kit/main/install-godspeed.sh | bash
#
# On Windows, download HubSetup.exe from the releases page and double-click it
# instead. Different front door, same promise: one thing to run, no decisions.
#
# It works out for itself what this computer needs:
#   no mission control here yet  -> makes one from starter-godspeed/ in this kit, the folder the
#                       book walks you through chapter by chapter
#   a mission control already    -> brings it up to date and re-checks the wiring
#
# It also installs what is missing underneath (Git, Node.js, Hermes) and
# gives every machine you own one shared memory.
#
# Safe to run as many times as you like. It never deletes anything you wrote.
#
# Options are passed straight through, so this also works:
#   curl -fsSL <this url> | bash -s -- --godspeed ~/my-folder
#   curl -fsSL <this url> | bash -s -- --repo https://github.com/you/your-hub.git
#
# This file is deliberately tiny. The work lives in kit-bootstrap, the small
# public repository that holds the install steps shared with the other kits, so
# the same code is not maintained in two places:
# https://github.com/MichaelZelbel/kit-bootstrap
# =============================================================================
set -uo pipefail

# The pin is an immutable TAG, never the moving v2 branch: this book's readers get
# exactly the code that passed its end-to-end runs, and the pin only moves by a
# deliberate edit here. KB_BRANCH pins the library the engine fetches for
# itself, or the entry file would be pinned while its insides floated.
ENGINE="https://raw.githubusercontent.com/MichaelZelbel/kit-bootstrap/v2.7/setup-godspeed.sh"
STARTER="https://github.com/MichaelZelbel/teach-it-once-kit.git"
KB_BRANCH="v2.7"
export KB_BRANCH

SCRIPT="$(curl -fsSL "$ENGINE")" || SCRIPT=""
if [ -z "$SCRIPT" ]; then
  echo "[stop] I could not download the setup program from:" >&2
  echo "       $ENGINE" >&2
  echo "       Check this computer can reach the internet, then run the line again." >&2
  exit 1
fi

# The word after the script is what bash reports as $0, so give it a real name:
# it turns up in messages, and "bash" would tell the reader nothing.
exec bash -c "$SCRIPT" setup-godspeed --starter-repo "$STARTER" "$@"
