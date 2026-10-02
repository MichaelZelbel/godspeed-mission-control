#!/bin/sh
set -eu
if [ -z "${GODSPEED_ACCESS_TOKEN:-}" ]; then echo 'Candidate access token is required.' >&2; exit 1; fi
mkdir -p "$GODSPEED_WORKSPACE" "$GODSPEED_MEDIA_ROOT" "$HERMES_HOME"
if [ "$(id -u)" = 0 ]; then
  chown -R hermes:hermes /opt/data/full-candidate
  exec /command/s6-setuidgid hermes "$0"
fi
export GODSPEED_COACH_GIT_SYNC=off GODSPEED_JOURNAL_GIT_SYNC=off
export GODSPEED_FILE_HERMES=1 GODSPEED_NODE=/usr/local/bin/node
export GODSPEED_ASSISTANT_PUBLISHER=/opt/godspeed/kit/notebook/scripts/save-assistant-state.mjs
export PYTHONPATH=/opt/godspeed/kit/notebook/assistant-files${PYTHONPATH:+:$PYTHONPATH}
node /opt/godspeed/kit/notebook/bin/godspeed.mjs init >/dev/null
node /opt/godspeed/kit/notebook/scripts/wire-assistant.mjs "$HERMES_HOME" >/dev/null
if [ ! -f "$GODSPEED_WORKSPACE/.godspeed/assistant.json" ]; then
  node -e 'const fs=require("fs"),p=require("path");fs.writeFileSync(p.join(process.env.GODSPEED_WORKSPACE,".godspeed/assistant.json"),JSON.stringify({verified:true,executable:"/opt/hermes/bin/hermes",home:process.env.HERMES_HOME}),{mode:384})'
fi
exec node /opt/godspeed/kit/docker/full-candidate/supervisor.mjs
