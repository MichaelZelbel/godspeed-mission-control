#!/usr/bin/env bash
# Install the Planino waker as a systemd user service (Linux).
# Run once from this folder after writing poster.env:  bash install-waker-linux.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

NODE="$(command -v node || true)"
: "${GODSPEED_WORKSPACE:?Choose this installation workspace}"
CONFIG="${GODSPEED_BROWSER_POST_CONFIG:-$GODSPEED_WORKSPACE/.godspeed/connectors/browser-post/poster.env}"
[ -n "$NODE" ] || { echo "[ERROR] node not found on PATH" >&2; exit 1; }
ID="$($NODE -e 'process.stdout.write(require("crypto").createHash("sha256").update(process.argv[1]).digest("hex").slice(0,12))' "$HERE")"
[ -f "$CONFIG" ] || { echo "[ERROR] write $CONFIG first (see poster.env.example)" >&2; exit 1; }
UNIT="$HOME/.config/systemd/user/godspeed-mission-control-browser-post-$ID.service"
[ ! -e "$UNIT" ] || { echo "The selected service already exists; review before replacing it" >&2; exit 1; }
chmod +x "$HERE"/runners/*.sh 2>/dev/null || true
mkdir -p "$(dirname "$UNIT")"
cat > "$UNIT" <<EOF
[Unit]
Description=Planino waker (starts your AI when a browser post is due)
After=network-online.target
Wants=network-online.target

[Service]
Type=exec
WorkingDirectory=$HERE
Environment="GODSPEED_WORKSPACE=$GODSPEED_WORKSPACE"
Environment="GODSPEED_BROWSER_POST_CONFIG=$CONFIG"
ExecStart="$NODE" "$HERE/wake.js"
Restart=always
RestartSec=30s
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=default.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now godspeed-mission-control-browser-post-$ID.service
sleep 2
if systemctl --user is-active godspeed-mission-control-browser-post-$ID.service | grep -q '^active$'; then
  echo "[install] godspeed-mission-control-browser-post-$ID.service is active. Logs: journalctl --user -u planino-waker -f"
else
  echo "[install] the service did not start; see: journalctl --user -u planino-waker -n 50" >&2
  exit 1
fi
if ! loginctl show-user "$(id -un)" 2>/dev/null | grep -q '^Linger=yes'; then
  echo "[install] to keep it running after logout: sudo loginctl enable-linger $(id -un)"
fi
