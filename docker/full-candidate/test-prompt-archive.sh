#!/usr/bin/env bash
# test-prompt-archive.sh <container>: the one-click server saves its conversations (2026-10-12).
#
# Runs against the freshly built image test.sh started, which runs the hourly harvest every few
# seconds for this test (GODSPEED_PROMPT_HARVEST_EVERY). A stand-in for the owner's GitHub (a bare
# repository in the container) and the folder's first commit, as Connect record sync makes it;
# then one Telegram exchange in Hermes' own database, the way the assistant's Telegram chat writes
# it, and one from before the server began saving. The new exchange must reach the conversation
# archive with its answer, be sent to the backup, and be found by `mc-prompt-archive search` in
# the assistant's terminal and in a second machine's copy of the backup; the old one must stay out.
set -uo pipefail
name=${1:?Supply the running container}
ws=/opt/data/full-candidate/workspace
hh=/opt/data/full-candidate/hermes
fails=0
check() { if eval "$2"; then echo "PASS  $1"; else echo "FAIL  $1"; fails=$((fails+1)); fi; }
x() { docker exec -u hermes -w "$ws" "$name" sh -c "$1"; }

echo "== the one-click server's conversation archive"
# The backup, as Settings > Connect record sync leaves it: a remote, and a first commit.
x 'git init -q --bare /tmp/backup.git
   [ -d .git ] || git init -q -b main
   git -c user.name=Test -c user.email=test@example.com commit -q --allow-empty -m "Save Godspeed Mission Control records"
   git remote add origin /tmp/backup.git && git push -q origin HEAD:main' \
  || { echo "FAIL  the stand-in backup could not be made"; exit 1; }

# The first run records when the server began saving; an exchange written before it would be
# an "older chat". So the fixture is written once that time is on record.
for _ in $(seq 1 60); do x "grep -q '^GODSPEED_PROMPT_SINCE=' $hh/.godspeed/device.env" 2>/dev/null && break; sleep 2; done
check "the first harvest recorded when the server began saving" "x \"grep -q '^GODSPEED_PROMPT_SINCE=' $hh/.godspeed/device.env\""
check "and that older chats on this server are not brought in" "x \"grep -qx 'GODSPEED_PROMPT_SOURCES=' $hh/.godspeed/device.env\""

docker exec -i -u hermes "$name" python3 - "$hh/state.db" <<'PY' || { echo "FAIL  the Telegram fixture could not be written"; exit 1; }
import sqlite3, sys, time
con = sqlite3.connect(sys.argv[1])
con.execute("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, source TEXT NOT NULL, started_at REAL NOT NULL)")
con.execute("CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT, timestamp REAL NOT NULL)")
now = time.time()
con.execute("INSERT INTO sessions (id, source, started_at) VALUES ('archive-test-new', 'telegram', ?)", (now,))
con.execute("INSERT INTO messages (session_id, role, content, timestamp) VALUES ('archive-test-new', 'user', 'Which bakery was the Larkspur invoice for again?', ?)", (now,))
con.execute("INSERT INTO messages (session_id, role, content, timestamp) VALUES ('archive-test-new', 'assistant', 'The Larkspur invoice was for the Juniper Street bakery, number 112.', ?)", (now + 1,))
old = 1577880000  # 1 January 2020, long before this server began saving
con.execute("INSERT INTO sessions (id, source, started_at) VALUES ('archive-test-old', 'telegram', ?)", (old,))
con.execute("INSERT INTO messages (session_id, role, content, timestamp) VALUES ('archive-test-old', 'user', 'An older chat about the Quillfeather order', ?)", (old,))
con.commit()
PY

for _ in $(seq 1 45); do x "grep -rqs Larkspur prompts/archive/*.jsonl" && break; sleep 2; done
check "the Telegram exchange is in the archive" "x 'grep -rqs Larkspur prompts/archive/*.jsonl'"
check "with the assistant's answer" "x 'grep -rhs Larkspur prompts/archive/*.jsonl' | grep -q '\"answer\": \"The Larkspur invoice was for the Juniper Street bakery'"
check "filed as said to the server's own assistant, through Telegram" "x 'grep -rhs Larkspur prompts/archive/*.jsonl' | grep '\"channel\": \"telegram\"' | grep -q '\"project\": \"godspeed\"'"
check "the chat from before the server began saving stays out" "! x 'grep -rqs Quillfeather prompts/archive/'"
for _ in $(seq 1 30); do x "git --git-dir=/tmp/backup.git log main --format=%s | grep -q 'Archive the prompts typed on'" && break; sleep 2; done
check "it is committed and sent to the backup" "x \"git --git-dir=/tmp/backup.git log main --format=%s | grep -q 'Archive the prompts typed on vps'\""
check "the assistant finds it in its own terminal" "x 'PATH=$hh/bin:\$PATH mc-prompt-archive search Larkspur bakery' | grep -q 'Which bakery was the Larkspur invoice for'"
x 'git clone -q -b main /tmp/backup.git /tmp/second-machine'
check "a second machine's copy finds it, by the folder it stands in" "docker exec -u hermes -w /tmp/second-machine $name env -u GODSPEED_WORKSPACE -u GODSPEED_DIR $hh/bin/mc-prompt-archive search Juniper | grep -q 'Larkspur invoice'"
check "the server's manual tells its assistant to search the archive" "x \"grep -qF 'mc-prompt-archive search <words>' AGENTS.md\""

[ "$fails" -eq 0 ] && echo "conversation archive: ALL PASS" || { echo "conversation archive: $fails failed"; docker logs "$name" 2>&1 | grep 'prompt archive' | tail -20; exit 1; }
