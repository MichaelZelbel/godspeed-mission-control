#!/usr/bin/env bash
# Install the Planino waker as a launchd user agent (macOS).
# Run once from this folder after writing poster.env:  bash install-waker-macos.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"

NODE="$(command -v node || true)"
: "${GODSPEED_WORKSPACE:?Choose this installation workspace}"
CONFIG="${GODSPEED_BROWSER_POST_CONFIG:-$GODSPEED_WORKSPACE/.godspeed/connectors/browser-post/poster.env}"
[ -n "$NODE" ] || { echo "[ERROR] node not found on PATH" >&2; exit 1; }
ID="$($NODE -e 'process.stdout.write(require("crypto").createHash("sha256").update(process.argv[1]).digest("hex").slice(0,12))' "$HERE")"
[ -f "$CONFIG" ] || { echo "[ERROR] write $CONFIG first (see poster.env.example)" >&2; exit 1; }
LABEL="godspeed.mission.control.browser.post.$ID"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
[ ! -e "$PLIST" ] || { echo "The selected agent already exists; review before replacing it" >&2; exit 1; }
chmod +x "$HERE"/runners/*.sh 2>/dev/null || true
mkdir -p "$(dirname "$PLIST")" "$HOME/Library/Logs"
cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>$NODE</string><string>$HERE/wake.js</string></array>
  <key>EnvironmentVariables</key><dict><key>GODSPEED_WORKSPACE</key><string>$GODSPEED_WORKSPACE</string><key>GODSPEED_BROWSER_POST_CONFIG</key><string>$CONFIG</string></dict>
  <key>WorkingDirectory</key><string>$HERE</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/godspeed-mission-control-browser-post-$ID.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/godspeed-mission-control-browser-post-$ID.log</string>
</dict>
</plist>
EOF
launchctl load "$PLIST"
echo "[install] loaded $LABEL. Log: $HOME/Library/Logs/godspeed-mission-control-browser-post-$ID.log"
