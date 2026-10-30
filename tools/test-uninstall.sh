#!/usr/bin/env bash
# The gate for mc-uninstall: every program the installer puts in ~/.local/bin is on its lists, and
# a run removes the notebook's service, its scheduled jobs, its programs and ~/.godspeed, while the
# mission control folder, the person's own programs, their own schedule lines and the key that
# opens the folder's passwords stay. systemd, launchd, crontab and sudo are stand-ins writing down
# what they were asked; /etc is a folder of the test's own.
# Usage: bash tools/test-uninstall.sh
set -uo pipefail
. "$(dirname "$0")/test-guard.bash"
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP" "$TEST_GUARD_HOME"' EXIT

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (want [$3], got [$2])"; fi; }

echo "mc-uninstall"

# 1. The lists. What kb_install_godspeed_tools (kit-bootstrap lib.sh) copies: every file in tools/
# but *.md and the tests, then the launchers it writes, and godspeed-browser (kb_wire_computer).
listed=" $(sed -n '/^HELPERS="/,/"$/p; /^PROGRAMS="/,/"$/p' "$HERE/mc-uninstall" | sed 's/^[A-Z]*="//; s/"$//' | tr '\n' ' ') "
missing=""
for f in "$HERE"/*; do
  # Files only: the installer copies files, so a folder here is never a program on those lists.
  # __pycache__ is one, left beside a tools/ program by whichever test loaded it as a module, and
  # it made this check fail for anyone who ran that test first (30 October 2026).
  [ -f "$f" ] || continue
  base="$(basename "$f")"
  case "$base" in *.md|test-*|*-test|*-test.*|*_test|*_test.*|*.test.*) continue ;; esac
  case "$listed" in *" $base "*) ;; *) missing="$missing $base" ;; esac
done
for base in mc-prompt-harvest mc-compile-rules mc-check-keys mc-due mc-goals mc-forecast mc-work mc-check-written \
            mc-check-moves mc-menerio-connect mc-search godspeed-browser; do
  case "$listed" in *" $base "*) ;; *) missing="$missing $base" ;; esac
done
check "every program the installer puts in ~/.local/bin is on mc-uninstall's lists" "${missing# }" ""

# A computer as the installer leaves it.
mkdir -p "$TMP/bin"
cat > "$TMP/bin/fakecron" <<'EOF'
#!/bin/sh
case "$1" in
  -l) [ -s "$FAKE_TAB" ] && cat "$FAKE_TAB" || exit 1 ;;
  -r) rm -f "$FAKE_TAB" ;;
  -)  cat > "$FAKE_TAB" ;;
esac
EOF
printf '#!/bin/sh\necho "$*" >> "$FAKE_CALLS"\n' > "$TMP/bin/fakesystemctl"
# launchd's stand-in holds nothing: print answers "no such service", as after a bootout.
printf '#!/bin/sh\necho "launchctl $*" >> "$FAKE_CALLS"\n[ "$1" != print ] || exit 113\n' > "$TMP/bin/fakelaunchctl"
printf '#!/bin/sh\necho "sudo $*" >> "$FAKE_CALLS"\n[ -n "$FAKE_NO_SUDO" ] && exit 1\nexec "$@"\n' > "$TMP/bin/fakesudo"
chmod +x "$TMP/bin/"*

setup() {
  H="$TMP/$1/home"; G="$H/godspeed-v2"; E="$TMP/$1/etc"
  mkdir -p "$H/.local/bin" "$H/.godspeed/mail/imap/bin" "$G/.godspeed/integrated-runtime/media" "$G/rules" "$E/systemd/system" "$E/caddy" "$H/.config/systemd/user/default.target.wants"
  for name in $listed; do printf 'x\n' > "$H/.local/bin/$name"; done
  printf 'mine\n' > "$H/.local/bin/my-own-tool"
  printf '#!/bin/sh\n' > "$G/agents-godspeed"; ln -s "$G/agents-godspeed" "$H/.local/bin/godspeed"
  ln -s /usr/bin/env "$H/.local/bin/my-env-link"
  printf 'hermes\n' > "$H/.local/bin/hermes"
  printf 'GODSPEED_DIR=%s\nGODSPEED_INSTALL_COUNT=0\n' "$G" > "$H/.godspeed/device.env"
  printf 'AGE-SECRET-KEY-1TEST\n' > "$H/.godspeed/age-key.txt"
  printf 'locked\n' > "$H/.godspeed/mail/imap/password.age"
  printf '# My notes\n' > "$G/AGENTS.md"; printf 'photo\n' > "$G/.godspeed/integrated-runtime/media/cat.jpg"
  printf 'console.log(1)\n' > "$G/.godspeed/integrated-runtime/start.mjs"
  printf '[Unit]\n' > "$E/systemd/system/godspeed-integrated-notebook.service"
  printf '[Unit]\n' > "$E/systemd/system/godspeed-https.service"
  printf 'example.org {\n}\n\n# The Godspeed Mission Control notebook'"'"'s web address (its installer keeps this line).\nimport %s/caddy/godspeed-notebook.caddy\n' "$E" > "$E/caddy/Caddyfile"
  printf 'site\n' > "$E/caddy/godspeed-notebook.caddy"
  printf '[Unit]\n' > "$H/.config/systemd/user/godspeed-integrated-notebook.service"
  printf '0 5 * * * my-backup\n# Keep the mission control'"'"'s record of what you type to an AI on this computer, and its answers, up to date.\n17 * * * * "%s/.local/bin/mc-prompt-harvest" --once-a-day\n# The mission control job, for whatever changed while this computer was asleep (Teach It Once).\n37 * * * * "%s/.local/bin/mc-notebook-sync"\n# Tell .* once that the first morning brief arrived; removes itself after (mc-install-count)\n17 7 * * * mc-install-count first-brief\n' "$H" "$H" > "$TMP/$1/tab"
  printf 'export PATH="$HOME/.local/bin:$PATH"\n[ -f "$HOME/.local/bin/mc-notebook-env" ] && eval "$(sh "$HOME/.local/bin/mc-notebook-env")"   # Teach It Once: your notebook credential\nalias ll="ls -l"\n' > "$H/.bashrc"
  cp "$H/.bashrc" "$H/.zshrc"
  ( cd "$G" && find . -type f | sort | xargs cat | cksum ) > "$TMP/$1/folder.before"
}
run() {  # run <case> [os] [args...]
  local c="$1" os="$2"; shift 2
  HOME="$H" XDG_CONFIG_HOME="$H/.config" XDG_DATA_HOME="$H/.local/share" PATH="$TMP/bin:$PATH" KB_CRONTAB=fakecron FAKE_TAB="$TMP/$c/tab" FAKE_CALLS="$TMP/$c/calls" \
    MC_UNINSTALL_SYSTEMCTL=fakesystemctl MC_UNINSTALL_LAUNCHCTL=fakelaunchctl MC_UNINSTALL_SUDO=fakesudo \
    MC_UNINSTALL_ETC="$E" MC_UNINSTALL_OS="$os" MC_UNINSTALL_LAUNCH_AGENTS="$H/Library/LaunchAgents" \
    sh "$HERE/mc-uninstall" "$@" > "$TMP/$c/out" 2>&1 < /dev/null
}
folder_same() { ( cd "$G" && find . -type f | sort | xargs cat | cksum ) | cmp -s - "$TMP/$1/folder.before" && echo same || echo changed; }

# 2. Linux.
setup linux
run linux Linux --yes; rc=$?
check "a Linux run ends well" "$rc" "0"
check "every program on its lists is gone from ~/.local/bin" "$(cd "$H/.local/bin" && ls | sort | tr '\n' ' ')" "hermes my-env-link my-own-tool "
check "the systemd service and the web address are stopped and removed, then systemd reloads" \
  "$(grep -c -e '^disable --now godspeed-integrated-notebook.service' -e '^disable --now godspeed-https.service' -e '^daemon-reload' "$TMP/linux/calls"):$(ls "$E/systemd/system" | wc -l | tr -d ' ')" "3:0"
check "the account's own service is stopped and removed" \
  "$(grep -c -- '--user disable --now godspeed-integrated-notebook.service' "$TMP/linux/calls"):$(ls "$H/.config/systemd/user" | tr '\n' ' ')" "1:default.target.wants "
check "the server's Caddy loses the notebook's site and only its lines" \
  "$([ -e "$E/caddy/godspeed-notebook.caddy" ] && echo there || echo gone):$(tr '\n' '|' < "$E/caddy/Caddyfile")" "gone:example.org {|}||"
check "its scheduled jobs go, the person's own line stays" "$(cat "$TMP/linux/tab")" "0 5 * * * my-backup"
check "~/.godspeed goes, except the key that opens the folder's passwords" "$(ls -A "$H/.godspeed")" "age-key.txt"
check "the shell settings lose the notebook line and keep the rest" \
  "$(tr '\n' '|' < "$H/.bashrc"):$(grep -c mc-notebook-env "$H/.zshrc")" 'export PATH="$HOME/.local/bin:$PATH"|alias ll="ls -l"|:0'
check "the mission control folder is exactly as it was" "$(folder_same linux)" "same"
check "the last words name the folder that stays" "$(grep -c "Your mission control folder is still here, with your notebook, photos, files and backups: $G" "$TMP/linux/out")" "1"

# 3. Linux without the administrator's rights: the rest is done, and the commands left are named.
# (Root never asks sudo, so this case is for an ordinary account.)
if [ "$(id -u)" = 0 ]; then
  ok "without sudo: skipped, this test runs as root"
else
  setup nosudo
  FAKE_NO_SUDO=1 run nosudo Linux --yes; rc=$?
  check "without sudo it ends with an error and names what is left" "$rc:$(grep -c 'sudo systemctl disable --now godspeed-integrated-notebook.service' "$TMP/nosudo/out")" "1:1"
  check "and still removes everything that is its own to remove" "$(cd "$H/.local/bin" && ls | sort | tr '\n' ' '):$(cat "$TMP/nosudo/tab")" "hermes my-env-link my-own-tool :0 5 * * * my-backup"
fi

# 4. A Mac.
setup mac
mkdir -p "$H/Library/LaunchAgents" "$H/Library/Logs/Godspeed Mission Control"
printf '<plist/>\n' > "$H/Library/LaunchAgents/com.godspeedmissioncontrol.notebook.plist"
printf '<plist/>\n' > "$H/Library/LaunchAgents/com.example.other.plist"
printf 'log\n' > "$H/Library/Logs/Godspeed Mission Control/notebook.log"
rm -rf "$E"
run mac Darwin --yes; rc=$?
uid="$(id -u)"
check "a Mac run ends well" "$rc" "0"
check "the LaunchAgent is unloaded from both places it can be" \
  "$(grep -c -e "launchctl bootout gui/$uid/com.godspeedmissioncontrol.notebook" -e "launchctl bootout user/$uid/com.godspeedmissioncontrol.notebook" "$TMP/mac/calls")" "2"
check "its file and its log go, another agent stays" \
  "$(ls "$H/Library/LaunchAgents"):$([ -d "$H/Library/Logs/Godspeed Mission Control" ] && echo log || echo nolog)" "com.example.other.plist:nolog"
check "no systemd and no sudo on a Mac" "$(grep -c -e '^sudo' -e 'systemctl' "$TMP/mac/calls" || true)" "0"
check "the mission control folder is exactly as it was" "$(folder_same mac)" "same"

# 5. It asks first: without --yes and nobody at a keyboard, nothing is removed. setsid takes the
# terminal away when this test itself runs in one.
setup ask
NO_TTY=""; command -v setsid >/dev/null 2>&1 && NO_TTY="setsid -w"
if [ -z "$NO_TTY" ] && ( : < /dev/tty ) 2>/dev/null; then
  ok "nobody-at-the-keyboard case skipped: this test runs in a terminal and there is no setsid"
else
  HOME="$H" XDG_CONFIG_HOME="$H/.config" XDG_DATA_HOME="$H/.local/share" PATH="$TMP/bin:$PATH" KB_CRONTAB=fakecron FAKE_TAB="$TMP/ask/tab" FAKE_CALLS="$TMP/ask/calls" MC_UNINSTALL_OS=Linux \
    MC_UNINSTALL_ETC="$E" $NO_TTY sh "$HERE/mc-uninstall" > "$TMP/ask/out" 2>&1 < /dev/null; rc=$?
  check "without --yes and without a keyboard it removes nothing" "$rc:$(ls "$H/.local/bin" | wc -l | tr -d ' ')" "1:$(( $(printf '%s\n' $listed | grep -c .) + 4 ))"
fi

# 6. Windows and the server's container are told where their own uninstall is.
setup win
run win MINGW64_NT-10.0 --yes; rc=$?
check "on Windows it points to the Start menu and removes nothing" "$rc:$(grep -c 'Start menu' "$TMP/win/out"):$([ -f "$H/.local/bin/mc-goals" ] && echo kept)" "1:1:kept"

# 7. A mission control folder that is the home folder: ~/.godspeed holds its notebook, and stays.
setup homefolder
printf 'GODSPEED_DIR=%s\n' "$H" > "$H/.godspeed/device.env"
mkdir -p "$H/.godspeed/integrated-runtime"; printf 'notes\n' > "$H/.godspeed/integrated-runtime/records"
run homefolder Linux --yes
check "a folder that is the home folder keeps ~/.godspeed whole" "$(cat "$H/.godspeed/integrated-runtime/records" 2>/dev/null)" "notes"

echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
