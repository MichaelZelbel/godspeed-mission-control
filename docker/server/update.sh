#!/bin/bash
# =============================================================================
# godspeed-update on a server installed with the one line (docker/server/install.sh), which puts
# this file in /opt/godspeed-mission-control/.godspeed/update.sh and the command in /usr/local/bin:
#
#   sudo godspeed-update            brings the server to the newest stable release
#   sudo godspeed-update --check    says which version runs and which is the newest, changing nothing
#
# The newest stable release is the one GitHub marks Latest. Its stage file at the release's tag
# names the version and the server image; a version taken back is refused. The release's source
# archive is downloaded and kept only when its SHA256 is the one the release's SHA256SUMS lists, and
# the installer that runs is the docker/server/install.sh inside it, with the stage at that tag.
# Everything is decided here on the server: nothing the notebook in the container says is used, and
# the container never starts this (docker/README.md, "What the container can and cannot do").
# docker/server/test.sh tests it.
# =============================================================================

REPOSITORY=MichaelZelbel/godspeed-mission-control
DIR="${GODSPEED_DIR:-/opt/godspeed-mission-control}"
GODSPEED_STAGE_RAW="${GODSPEED_STAGE_RAW:-https://raw.githubusercontent.com/$REPOSITORY}"
GODSPEED_STAGE_RAW="${GODSPEED_STAGE_RAW%/}"
ARCHIVE=Godspeed-v2-integrated-source.tar.gz
API="https://api.github.com/repos/$REPOSITORY"
DOWNLOAD="https://github.com/$REPOSITORY/releases/download"
# A proving scenario stands a release in on this machine; no other address replaces GitHub's
# (the same rule as notebook/core/update.mjs).
if [[ "${GODSPEED_SCENARIO_RELEASES_URL:-}" =~ ^http://127\.0\.0\.1:[0-9]+/?$ ]]; then
  API="${GODSPEED_SCENARIO_RELEASES_URL%/}"
  DOWNLOAD="$API/download"
fi

say()  { printf '%s\n' "$*"; }
stop() { printf '\n%s\n\n' "$*" >&2; exit 1; }

# True when version $1 comes after version $2, in semantic versioning's order: the numbers first, a
# release after its own prereleases, within a prerelease numbers by value and below words, and a
# longer one after the one it starts with. A word that is not a version is never newer.
version_newer() {
  local re='^([0-9]+)\.([0-9]+)\.([0-9]+)(-([0-9A-Za-z.-]+))?$' a b i x y
  [[ "$1" =~ $re ]] || return 1; a=("${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}" "${BASH_REMATCH[5]}")
  [[ "$2" =~ $re ]] || return 1; b=("${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}" "${BASH_REMATCH[5]}")
  for i in 0 1 2; do
    [ "${a[i]}" -gt "${b[i]}" ] && return 0
    [ "${a[i]}" -lt "${b[i]}" ] && return 1
  done
  [ "${a[3]}" = "${b[3]}" ] && return 1
  [ -z "${a[3]}" ] && return 0
  [ -z "${b[3]}" ] && return 1
  local -a p q
  IFS=. read -ra p <<<"${a[3]}"; IFS=. read -ra q <<<"${b[3]}"
  for ((i = 0; i < ${#p[@]} && i < ${#q[@]}; i++)); do
    x=${p[i]} y=${q[i]}
    [ "$x" = "$y" ] && continue
    if [[ "$x" =~ ^[0-9]+$ ]] && [[ "$y" =~ ^[0-9]+$ ]]; then [ "$x" -gt "$y" ]; return; fi
    [[ "$x" =~ ^[0-9]+$ ]] && return 1
    [[ "$y" =~ ^[0-9]+$ ]] && return 0
    [[ "$x" > "$y" ]]; return
  done
  [ "${#p[@]}" -gt "${#q[@]}" ]
}

sha256_of() { sha256sum "$1" | cut -d' ' -f1; }

# The tag of the release GitHub marks Latest.
latest_tag() {
  curl -fsSL -H 'Accept: application/vnd.github+json' "$API/releases/latest" 2>/dev/null \
    | grep -o '"tag_name": *"[^"]*"' | head -1 | sed 's/.*"\([^"]*\)"$/\1/'
}

# Into the folder $2: the stage file at the tag $1, its reader, and the public stage, read and
# checked the way install.sh reads them. Sets VERSION and IMAGE.
VERSION=""
IMAGE=""
read_release_stage() {
  local tag=$1 work=$2 answer
  curl -fsSL "$GODSPEED_STAGE_RAW/$tag/stage.json" -o "$work/stage.json" 2>/dev/null \
    && curl -fsSL "$GODSPEED_STAGE_RAW/$tag/stage/stage.sh" -o "$work/stage.sh" 2>/dev/null \
    && curl -fsSL "$GODSPEED_STAGE_RAW/beta/stage.json" -o "$work/public.json" 2>/dev/null \
    && sh "$work/stage.sh" "$work/stage.json" check >/dev/null 2>&1 \
    || stop "The version list of the release $tag could not be read, so nothing was changed."
  VERSION="$(sh "$work/stage.sh" "$work/stage.json" get version)"
  IMAGE="$(sh "$work/stage.sh" "$work/stage.json" get serverEditions.server.image)" \
    || stop "The release $tag names no server version, so nothing was changed."
  case "$tag" in candidate/*) [ "${tag#candidate/}" = "$VERSION" ] || stop "The release $tag says it is $VERSION, so nothing was changed." ;; esac
  answer="$(sh "$work/stage.sh" withdrawn "$work/stage.json" "$work/public.json" "$VERSION" 2>&1)"
  [ "$answer" = no ] || stop "Godspeed Mission Control $VERSION was taken back, so nothing was changed."
}

# The release's file $2 at the tag $1, into the folder $3, kept only when it matches SHA256SUMS.
download_verified() {
  local tag=$1 name=$2 folder=$3 want
  curl -fsSL "$DOWNLOAD/$tag/SHA256SUMS" -o "$folder/SHA256SUMS" 2>/dev/null || want=""
  want="$(awk -v file="$name" '$2 == file || $2 == "*" file { print $1 }' "$folder/SHA256SUMS" 2>/dev/null | head -1)"
  curl -fsSL "$DOWNLOAD/$tag/$name" -o "$folder/$name" 2>/dev/null \
    || { rm -f "$folder/$name"; stop "The download of $VERSION did not finish, so nothing was installed. The version you have keeps running."; }
  if [ -z "$want" ] || [ "$(sha256_of "$folder/$name")" != "$want" ]; then
    rm -f "$folder/$name"
    stop "The download of $VERSION does not match the checksum its release publishes, so nothing was installed. The version you have keeps running."
  fi
}

main() {
  set -uo pipefail
  local check=no tag installed running try work
  case "${1:-}" in
    '') ;;
    --check) check=yes ;;
    *) stop "Use godspeed-update, or godspeed-update --check to see whether a newer version exists." ;;
  esac
  [ "$(id -u)" -eq 0 ] || stop "This needs the server's administrator rights: sudo godspeed-update"
  [ -f "$DIR/.env" ] || stop "Godspeed Mission Control is not installed in $DIR on this server, so there is nothing to update."

  tag="$(latest_tag)"
  [ -n "$tag" ] || stop "GitHub could not be reached to see whether a newer version exists."
  work="$(mktemp -d)" || stop "Could not make a temporary folder, so nothing was changed."
  trap 'rm -rf "$work"' EXIT
  read_release_stage "$tag" "$work"

  installed="$(cat "$DIR/version" 2>/dev/null)"
  running="$(sed -n 's/^GODSPEED_SERVER_IMAGE=//p' "$DIR/.env" | tail -1)"
  try="$(sed -n 's/^GODSPEED_IMAGE=//p' "$DIR/.env" | tail -1)"
  local newer=yes
  if [ -z "$try" ] && { [ "$running" = "$IMAGE" ] || { [ -n "$installed" ] && ! version_newer "$VERSION" "$installed"; }; }; then newer=no; fi

  if [ "$check" = yes ]; then
    say "Installed: ${installed:-an earlier version}${try:+ (a version to try: $try)}"
    say "Newest stable: $VERSION"
    say "What changed: https://github.com/$REPOSITORY/releases/tag/$tag"
    if [ "$newer" = yes ]; then say "A newer version is ready. To install it, run: sudo godspeed-update"; else say "You have the newest version."; fi
    return 0
  fi
  if [ "$newer" = no ]; then say "You have the newest version, ${installed:-$VERSION}. Nothing was changed."; return 0; fi

  say "Updating Godspeed Mission Control to $VERSION."
  download_verified "$tag" "$ARCHIVE" "$work"
  say "The download of $VERSION matched the checksum its release publishes."
  tar -xzf "$work/$ARCHIVE" -C "$work" godspeed-mission-control/docker/server/install.sh 2>/dev/null \
    || stop "The installer could not be taken out of the download of $VERSION, so nothing was installed. The version you have keeps running."
  GODSPEED_DIR="$DIR" GODSPEED_STAGE_REF="$tag" GODSPEED_STAGE_RAW="$GODSPEED_STAGE_RAW" GODSPEED_IMAGE=release \
    bash "$work/godspeed-mission-control/docker/server/install.sh"
}

[ "${GODSPEED_UPDATE_LIB:-}" = 1 ] || main "$@"
