#!/usr/bin/env bash
# Main's shared installer, followed by the integrated notebook connection.
#
# This file names no version of its own. It reads the version it installs from a stage file -
# stage.json at the top of this repository, which says the product commit, the kit-bootstrap
# commit and everything else one published version is made of - so a release writes that one file
# and never this one, and a merge that edits this file reaches nobody until a stage names it.
#
#   GODSPEED_STAGE_REF   the branch or tag of this repository whose stage file to install from;
#                        beta, the public stage, when nothing names another
#   GODSPEED_STAGE_RAW   where that ref's files are read from; raw.githubusercontent.com by
#                        default, a file:// folder in a test
#
# stage/stage.sh of the same ref is the reader: the same reader the rest of the kit uses, never a
# second parser of its own. Nothing is downloaded and nothing on this computer is changed until
# the stage file has been read, checked, and found not to name the version as taken back.
set -euo pipefail
# A Mac gets Git and Node.js from Homebrew, so Homebrew is checked first, before anything is
# downloaded. Until 18 October 2026 nothing checked, and a Mac without it ended with a broken
# install. One Homebrew just installed is often not on this window's PATH yet: it is used anyway.
# GODSPEED_BREW_PLACES names other places to look, for a test.
if [ "$(uname -s)" = Darwin ]; then
  for brew in ${GODSPEED_BREW_PLACES:-/opt/homebrew/bin/brew /usr/local/bin/brew}; do
    if ! command -v brew >/dev/null 2>&1 && [ -x "$brew" ]; then eval "$("$brew" shellenv)"; fi
  done
  if ! command -v brew >/dev/null 2>&1 && { ! command -v node >/dev/null 2>&1 || ! xcode-select -p >/dev/null 2>&1; }; then
    cat >&2 <<'BREW'

This Mac needs Homebrew first. Homebrew is the free program that installs the tools Godspeed
uses, Git and Node.js. Nothing was changed.

1. Open https://brew.sh and copy the line under "Install Homebrew".
2. Paste it into this Terminal window and press Return. It asks for your Mac password.
3. When it has finished, paste the Godspeed line again.

BREW
    exit 1
  fi
fi
stop() { printf '\n%s\n\n' "$1" >&2; exit 1; }

# ------------------------------------------------------------------------------ which stage
STAGE_REF=${GODSPEED_STAGE_REF:-beta}
PUBLIC_STAGE_REF=beta
STAGE_RAW=${GODSPEED_STAGE_RAW:-https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control}
STAGE_RAW=${STAGE_RAW%/}
# The name of a branch or tag and nothing else. These are git's own rules for a ref name, written
# out here because git is not on the computer yet when this runs: every part between the slashes
# holds something, starts with no dot and ends in no ".lock", and the whole name holds no "..", no
# slash at either end, no two slashes in a row and no dot at the end. The characters are narrowed
# further to letters, digits, dot, underscore, hyphen and slash, which leaves out the space, the
# control characters and everything a shell or a web address would read as something of its own.
# installers/install-godspeed.sh holds this same rule, because it has to judge a ref before it may
# fetch anything from that ref.
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

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

unreadable() { # <address> <the reader's own reason, or nothing>
  if [ -n "$2" ]; then
    stop "Nothing was installed and nothing on this computer was changed, because the version list of Godspeed Mission Control at $1 could not be read: ${2%.}."
  fi
  stop "Nothing was installed and nothing on this computer was changed, because the version list of Godspeed Mission Control at $1 could not be read."
}

# These three reads say nothing of their own: curl's "(22) ... 404" before a sentence of ours would
# only make a reader look for a fault of their own, so its talking is turned off and what went
# wrong is said in the one sentence below it.
READER=$work/stage.sh
reader_url=$STAGE_RAW/$STAGE_REF/stage/stage.sh
curl -fsL "$reader_url" -o "$READER" 2>/dev/null \
  || stop "Nothing was installed and nothing on this computer was changed, because the reader of the version list of Godspeed Mission Control could not be read from $reader_url."

stage_url=$STAGE_RAW/$STAGE_REF/stage.json
curl -fsL "$stage_url" -o "$work/stage.json" 2>/dev/null || unreadable "$stage_url" ''
public_url=$STAGE_RAW/$PUBLIC_STAGE_REF/stage.json
if [ "$STAGE_REF" = "$PUBLIC_STAGE_REF" ]; then
  # The stage asked for is the public one: one read is enough.
  cp "$work/stage.json" "$work/public.json"
else
  curl -fsL "$public_url" -o "$work/public.json" 2>/dev/null || unreadable "$public_url" ''
fi

# Checked before it is believed, and the reader's own sentence is folded into one sentence of
# ours with the name of the folder this run downloaded into taken back out of it.
check_stage() { # <file> <address>
  local why
  if ! why=$(sh "$READER" "$1" check 2>&1); then
    unreadable "$2" "${why//$work\//}"
  fi
}
check_stage "$work/stage.json" "$stage_url"
[ "$STAGE_REF" = "$PUBLIC_STAGE_REF" ] || check_stage "$work/public.json" "$public_url"

version=$(sh "$READER" "$work/stage.json" get version) || unreadable "$stage_url" ''

# A version taken back is never installed, whichever of the two stage files says so, and the
# answer has to be exactly "no": every other answer, and every failure, stops here.
answer=$(sh "$READER" withdrawn "$work/stage.json" "$work/public.json") || unreadable "$stage_url" ''
[ "$answer" = no ] || stop "Nothing was installed and nothing on this computer was changed, because Godspeed Mission Control $version was taken back; running the line without GODSPEED_STAGE_REF installs the version that is current now."

# ------------------------------------------------------------------- what the stage file says
product=$(sh "$READER" "$work/stage.json" get productCommit) || unreadable "$stage_url" ''
engine_commit=$(sh "$READER" "$work/stage.json" get kitBootstrap.unixEngineCommit) || unreadable "$stage_url" ''

export GODSPEED_PRODUCT_REF=$product
export GODSPEED_STARTER_REF=$product
# The shared installer adds Hermes here; keep it visible to the notebook hook.
export PATH="$HOME/.local/bin:$PATH"
ENGINE=https://raw.githubusercontent.com/MichaelZelbel/kit-bootstrap/$engine_commit/setup-godspeed.sh
STARTER=https://github.com/MichaelZelbel/godspeed-mission-control.git
KB_BRANCH=$engine_commit
export KB_BRANCH
root=${GODSPEED_V2_INSTALL_DIR:-$HOME/godspeed-v2}
args=("$@")
for ((i=0;i<$#;i++)); do
  if [ "${args[i]}" = --beside ]; then export GODSPEED_INTEGRATED_BESIDE=1; fi
  if [ "${args[i]}" = --godspeed ]; then root=${args[i+1]:?Name the Godspeed folder}; fi
done
SCRIPT=$(curl -fsSL "$ENGINE")
bash -c "$SCRIPT" setup-godspeed --starter-repo "$STARTER" --godspeed "$root" "$@"
hook=$(curl -fsSL "https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control/$product/notebook/scripts/install-native-notebook.sh")
bash -c "$hook" install-native-notebook "$root"
# What this computer got: the stage file it was installed from, as it was read, and the ref it
# was read from, beside the notebook's own record of the commit it runs. Nothing reads these two
# yet; they are here so a person, a support answer and the proving scenarios can see which
# version, kit-bootstrap commit and starter commit this computer was installed with.
mkdir -p "$root/.godspeed"
cp "$work/stage.json" "$root/.godspeed/stage.json"
printf '%s\n' "$STAGE_REF" > "$root/.godspeed/stage-ref"
