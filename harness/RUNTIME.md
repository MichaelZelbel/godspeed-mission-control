# How to run Godspeed Mission Control in a checkout

For every agent of the factory. The journeys to check are in `harness/END-TO-END.md`.

## The notebook (the local web app)

No `npm install` is needed: it uses Node's own modules. It needs a folder for the person, given in
`GODSPEED_WORKSPACE`, and listens on `GODSPEED_PORT` (127.0.0.1 only). Never use the default port
47831 and never a fixed port: several checkouts may run at once.

```bash
W=$(mktemp -d)                                   # a new, empty folder for the person
P=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1])')
GODSPEED_WORKSPACE="$W" GODSPEED_PORT="$P" node notebook/server/main.mjs > "$ARTIFACTS_DIR/notebook.log" 2>&1 &
NB=$!
for i in $(seq 1 30); do curl -sf "http://127.0.0.1:$P/health" && break; sleep 1; done
# ... drive it through HTTP on that port ...
kill "$NB"; wait "$NB" 2>/dev/null; rm -rf "$W"
```

`GET /health` answers `{"ok":true,"format":1,"version":"<notebook/package.json version>",...}`.
The web pages (`GET /`) answer 503 "Build the notebook frontend first" in a plain checkout; that is
expected here and not a defect.

## The proving scenarios

`bash scenarios/test-scenarios.sh` from the root. About two minutes; its last line is
`N of N pass`. Save the whole output in `$ARTIFACTS_DIR`.

## The server installer's own test

`bash docker/server/test.sh` (no argument: the parts that need no Docker, about 25 seconds). Never
run it with `e2e` here: that installs Docker and takes ports 80 and 443.

## What never to do on this machine

Never run an installer for real (`install-godspeed.sh`, `server/install.sh`, `installers/`), never
use `sudo`, and never touch anything outside the checkout and the temporary folders you made.
