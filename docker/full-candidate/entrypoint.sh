#!/bin/sh
set -eu
if [ -z "${GODSPEED_ACCESS_TOKEN:-}" ]; then echo 'Candidate access token is required.' >&2; exit 1; fi
mkdir -p "$GODSPEED_WORKSPACE" "$GODSPEED_MEDIA_ROOT" "$HERMES_HOME"
if [ "$(id -u)" = 0 ]; then
  chown -R hermes:hermes /opt/data/full-candidate
  exec /command/s6-setuidgid hermes "$0"
fi
export GODSPEED_COACH_GIT_SYNC=off GODSPEED_JOURNAL_GIT_SYNC=off
node /opt/godspeed/kit/notebook/bin/godspeed.mjs init >/dev/null
exec node /opt/godspeed/kit/notebook/server/main.mjs
