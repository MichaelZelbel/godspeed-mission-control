#!/usr/bin/env bash
# A STAND-IN FOR GITHUB'S RELEASES, on this machine, for the scenarios that update with
# godspeed-update (notebook/core/update.mjs, docker/server/update.sh): both read releases from
# GODSPEED_SCENARIO_RELEASES_URL when it is http://127.0.0.1:<port>, and from GitHub otherwise.
# Sourced after scenario-lib.sh by update-keeps-everything.sh and server-update-keeps-everything.sh.
#
# A release here is what GitHub has for one: releases/latest naming its tag, and under
# download/<tag>/ the source archive a release publishes, made from this checkout, with the
# SHA256SUMS line that vouches for it. What the release installs is the stage file at its tag.

STAND_IN_ARCHIVE=Godspeed-v2-integrated-source.tar.gz
RELEASES_URL=''
RELEASES_PID=''

# The release <tag> in <folder>, made Latest.
stand_in_release() { # <folder> <tag>
  local folder=$1 tag=$2 at=$1/download/$2
  mkdir -p "$at" "$folder/releases" || fail "the stand-in release folder $folder could not be made"
  git -C "$HERE/.." archive --format=tar.gz --prefix=godspeed-mission-control/ HEAD >"$at/$STAND_IN_ARCHIVE" ||
    fail "the stand-in release's source archive could not be made from this checkout"
  (cd "$at" && sha256sum "$STAND_IN_ARCHIVE" >SHA256SUMS) ||
    fail "the stand-in release's SHA256SUMS could not be written"
  printf '{"tag_name":%s,"draft":false,"prerelease":false}\n' "$(quoted_json "$tag")" >"$folder/releases/latest" ||
    fail "the stand-in release could not be made Latest"
}

# Serves <folder> on a free loopback port until the scenario ends. Sets RELEASES_URL.
# shellcheck disable=SC2329  # asked by wait_for
releases_answer() { curl -fsS "$RELEASES_URL/releases/latest" >/dev/null 2>&1; }
serve_stand_in_releases() { # <folder>
  local port
  port=$(python3 -c 'import socket; s = socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1])') ||
    fail "no free port could be found for the stand-in releases"
  python3 -m http.server --bind 127.0.0.1 --directory "$1" "$port" >"$1.log" 2>&1 &
  RELEASES_PID=$!
  trap 'kill "$RELEASES_PID" 2>/dev/null || true' EXIT
  RELEASES_URL=http://127.0.0.1:$port
  wait_for 30 "the stand-in releases to answer" releases_answer ||
    fail "the stand-in releases at $RELEASES_URL did not answer"
  say "GitHub's releases stand in at $RELEASES_URL"
}
