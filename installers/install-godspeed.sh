#!/usr/bin/env bash
# The published address of the Mac and Linux installer. Godspeed servers already running send
# their readers here (docker/rootfs/usr/local/bin/godspeed-telegram-setup), so this address keeps
# working; it is no longer a second copy of the installer. It runs the install-godspeed.sh of the
# stage it is given, with the arguments it was given, and names no version of its own.
#
#   GODSPEED_STAGE_REF   the branch or tag whose installer and stage file to use; beta, the
#                        public stage, when nothing names another
#   GODSPEED_STAGE_RAW   where that ref's files are read from; raw.githubusercontent.com by
#                        default, a file:// folder in a test
set -euo pipefail
stop() { printf '\n%s\n\n' "$1" >&2; exit 1; }

STAGE_REF=${GODSPEED_STAGE_REF:-beta}
STAGE_RAW=${GODSPEED_STAGE_RAW:-https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control}
STAGE_RAW=${STAGE_RAW%/}
# The same rule install-godspeed.sh holds a ref to, word for word: git's own rules for the name of
# a branch or tag, written out because git is not on the computer yet, and the characters narrowed
# to the ones a shell and a web address keep plain. It stands here as well as there because a ref
# has to be judged before anything may be fetched from it.
ref_is_a_name() { # <ref>: true when it could be the name of a branch or tag
  case $1 in '' | -* | /* | */ | *//* | *..* | *. | *[!A-Za-z0-9._/-]*) return 1 ;; esac
  _rest=$1
  while :; do
    case $_rest in
      */*) _part=${_rest%%/*}; _rest=${_rest#*/} ;;
      *)   _part=$_rest;       _rest='' ;;
    esac
    case $_part in '' | .* | *.lock) return 1 ;; esac
    [ -n "$_rest" ] || return 0
  done
}
ref_is_a_name "$STAGE_REF" \
  || stop "Nothing was installed and nothing on this computer was changed, because GODSPEED_STAGE_REF=$STAGE_REF is not the name of a branch or tag of Godspeed Mission Control."
# Passed on, so the installer reads the stage this one was asked for.
export GODSPEED_STAGE_REF=$STAGE_REF
export GODSPEED_STAGE_RAW=$STAGE_RAW

# curl says nothing of its own here: its "(22) ... 404" before the sentence below would only make a
# reader look for a fault of their own.
url=$STAGE_RAW/$STAGE_REF/install-godspeed.sh
INSTALLER=$(curl -fsL "$url" 2>/dev/null) || stop "Nothing was installed and nothing on this computer was changed, because the installer of Godspeed Mission Control could not be read from $url."
bash -c "$INSTALLER" install-godspeed "$@"
