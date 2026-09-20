#!/usr/bin/env bash
# The gate for hub-menerio-connect: connect the notebook once, for every assistant.
#
# WHY THIS FILE IS HERE. This program edits settings files that belong to other programs
# (Hermes' config.yaml and .env, Codex's config.toml) and one that belongs to the reader
# (.mcp.json). That is the most dangerous thing anything in this kit does, so the promises
# it is held to are about what it must NOT do:
#
#   1. It never prints the key, and never writes it anywhere but the one line in Hermes' .env.
#   2. It keeps every line it did not add. A connection somebody made by hand keeps working.
#   3. Run twice, the second run changes nothing, byte for byte.
#   4. --check changes nothing at all, and --refresh never says a word.
#
# NOTHING HERE TOUCHES THE REAL SETTINGS OF THE COMPUTER RUNNING IT. Home is a throwaway
# folder (HOME for Mac and Linux, USERPROFILE and LOCALAPPDATA for Windows), HERMES_HOME
# and CODEX_HOME point into it, and PATH is cut down to node and the basic commands so that
# a real `hermes` or `codex` on this computer is not even seen. The notebook is a stand-in on
# 127.0.0.1. The one check that uses a real `hermes` command says so, and is skipped unless
# that command first proves it is looking at the throwaway folder.
#
# Usage: bash tools/test-menerio-connect.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
NODE=""
for c in node nodejs /usr/local/bin/node /usr/bin/node; do
  "$c" -e '' >/dev/null 2>&1 && { NODE="$(command -v "$c")"; break; }
done
[ -n "$NODE" ] || { echo "FAIL: no node on this box"; exit 1; }
PASS=0; FAIL=0
ok()  { echo "  ok   $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL $1"; FAIL=$((FAIL+1)); [ -n "${2:-}" ] && echo "       $2"; }
contains() { case "$2" in *"$3"*) ok "$1";; *) bad "$1" "missing [$3] in: $2";; esac; }
lacks()    { case "$2" in *"$3"*) bad "$1" "should not contain [$3]";; *) ok "$1";; esac; }

W="$HERE/.tmp-connect-test.$$"; rm -rf "$W"; mkdir -p "$W"
STUB_PID=""
trap '[ -n "$STUB_PID" ] && kill "$STUB_PID" 2>/dev/null; rm -rf "$W"' EXIT

FULL_PATH="$PATH"
SAFE_PATH="$(dirname "$NODE"):/usr/bin:/bin"
KEY1="mnr_test_key_ONE_1111"
KEY2="mnr_test_key_TWO_2222"

# One throwaway computer per case: a home, a hub, and (when asked) a Hermes and a Codex.
newbox() {
  B="$W/$1"; rm -rf "$B"; mkdir -p "$B/home/.hub" "$B/hub" "$B/appdata"
  printf '# Manual\n' > "$B/hub/AGENTS.md"
  HH="$B/home/hermes-home"; CH="$B/home/codex-home"
}
run() {   # run <key> [args...]   everything the program can see points into the box
  local key="$1"; shift
  HOME="$B/home" USERPROFILE="$B/home" LOCALAPPDATA="$B/appdata" APPDATA="$B/appdata" \
  HERMES_HOME="$HH" CODEX_HOME="$CH" HUB_DIR="" HUB_AGE_KEY="$B/home/.hub/none" \
  PATH="${RUN_PATH:-$SAFE_PATH}" MENERIO_API_KEY="$key" MENERIO_MCP_URL="${MCP:-http://127.0.0.1:1}" \
  HUB_CONNECT_NO_HERMES_CLI="${NO_CLI:-}" \
    "$NODE" "$HERE/menerio-connect.js" --hub "$B/hub" "$@" 2>&1
}
sums() { ( cd "$B" && find . -type f | LC_ALL=C sort | while read -r f; do printf '%s %s\n' "$(cksum < "$f")" "$f"; done ); }

echo "== hub-menerio-connect: once, for every assistant, and nothing else touched =="

# 1. The launcher is the two lines every other launcher here is.
if [ "$(sed -n 2p "$HERE/hub-menerio-connect")" = 'exec node "$(dirname "$0")/menerio-connect.js" "$@"' ] && sh -n "$HERE/hub-menerio-connect"; then
  ok "the launcher starts menerio-connect.js from the folder it sits in"
else
  bad "the hub-menerio-connect launcher is not the usual two lines"
fi

# ---- the stand-in notebook -----------------------------------------------------------------
cat > "$W/stub.js" <<'STUBEOF'
const http = require("http"), fs = require("fs");
const srv = http.createServer((req, res) => {
  const chunks = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const auth = req.headers.authorization || "";
    if (!/^Bearer mnr_test_key_(ONE_1111|TWO_2222)$/.test(auth)) {
      res.writeHead(401, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ error: "This key is not known here" }));
    }
    let msg = {}; try { msg = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch (e) {}
    if (msg.method === "initialize") {          // answered the event-stream way
      res.writeHead(200, { "Content-Type": "text/event-stream", "Mcp-Session-Id": "s-1" });
      return res.end("event: message\ndata: " + JSON.stringify({ jsonrpc: "2.0", id: msg.id,
        result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "stub", version: "1" } } }) + "\n\n");
    }
    if (msg.method === "tools/list") {          // answered the plain way
      if (req.headers["mcp-session-id"] !== "s-1") { res.writeHead(400); return res.end("{}"); }
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [
        { name: "search_notes" }, { name: "capture_note" }, { name: "list_note_folders" }] } }));
    }
    res.writeHead(202); res.end();
  });
});
srv.listen(0, "127.0.0.1", () => fs.writeFileSync(process.argv[2], String(srv.address().port)));
STUBEOF
"$NODE" "$W/stub.js" "$W/stub.port" & STUB_PID=$!
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do [ -s "$W/stub.port" ] && break; sleep 0.25; done
[ -s "$W/stub.port" ] || { bad "the stand-in notebook did not start"; echo; echo "  $PASS passed, $FAIL failed"; exit 1; }
MCP="http://127.0.0.1:$(cat "$W/stub.port")"

# ---- no key: most readers ------------------------------------------------------------------
newbox nokey; mkdir -p "$HH" "$CH"
printf '{\n  "mcpServers": {}\n}\n' > "$B/hub/.mcp.json"
before="$(sums)"
out="$(run "")"; rc=$?
[ "$rc" = "1" ] && contains "no key: it says so kindly, and where a free account is made" "$out" "https://menerio.com/auth?tab=signup" || bad "no key was not handled (exit $rc)" "$out"
contains "  and says your hub works without one" "$out" "Your hub works without one"
[ "$(sums)" = "$before" ] && ok "  and nothing was written anywhere" || bad "no key, and files changed anyway"
out="$(run "" --check)"; [ "$?" = "0" ] && ok "  and --check without a key is not a failure" || bad "--check without a key failed" "$out"
out="$(run "" --refresh)"; [ "$?" = "0" ] && [ -z "$out" ] && ok "  and --refresh without a key says nothing" || bad "--refresh without a key spoke" "$out"

# ---- the first run on a fresh starter hub --------------------------------------------------
newbox fresh; mkdir -p "$HH" "$CH"
cat > "$B/hub/.mcp.json" <<'EOF'
{
  "mcpServers": {
    "calendar": { "command": "npx", "args": ["-y", "some-calendar"] }
  },
  "somethingElse": { "keep": true }
}
EOF
cat > "$HH/config.yaml" <<'EOF'
# my hermes settings
model: some-model
terminal:
  backend: local
EOF
printf 'OPENROUTER_API_KEY=sk-keep-me\nTELEGRAM_TOKEN=keep-me-too\n' > "$HH/.env"
cat > "$CH/config.toml" <<'EOF'
# my codex settings
model = "gpt-5.5"

[mcp_servers.other]
command = "npx"
args = ["-y", "thing"]
EOF

# --check first: it must describe a fresh computer and touch nothing.
before="$(sums)"
out="$(run "$KEY1" --check)"
[ "$(sums)" = "$before" ] && ok "--check changes nothing, not one byte" || bad "--check changed a file"
[ "$(echo "$out" | grep -c "^  \(Claude Code\|Hermes\|Codex\) *not connected yet\.")" = "3" ] && ok "  and says all three are not connected yet" || bad "--check did not describe a fresh computer" "$out"
contains "  and still tests the notebook itself" "$out" "offers 3 tools"

out="$(run "$KEY1")"; rc=$?
[ "$rc" = "0" ] && ok "the first run succeeds" || bad "the first run failed (exit $rc)" "$out"
lacks "the key is never printed" "$out" "$KEY1"
[ "$(echo "$out" | grep -c "^  \(Claude Code\|Hermes\|Codex\) *connected\.")" = "3" ] \
  && ok "one line per assistant, and all three say connected" || bad "the report is not three connected lines" "$out"
contains "the notebook was really asked, and answered" "$out" "The notebook  answered with your key, and offers 3 tools."
contains "the report says how to switch everything off" "$out" "open Settings, then API Keys"

# .mcp.json: the block is there, in the shape Claude Code reads, and everything else stayed.
if "$NODE" -e '
  const d = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")), n = d.mcpServers.notebook;
  const good = n.type === "http" && n.url === "https://mcp.menerio.com" &&
    n.headers.Authorization === "Bearer ${MENERIO_API_KEY}" &&
    d.mcpServers.calendar.command === "npx" && d.somethingElse.keep === true;
  process.exit(good ? 0 : 1);' "$B/hub/.mcp.json"; then
  ok ".mcp.json: notebook added as http with the key NAMED, every other server and key kept"
else
  bad ".mcp.json is not right" "$(cat "$B/hub/.mcp.json")"
fi
lacks ".mcp.json does not hold the key" "$(cat "$B/hub/.mcp.json")" "$KEY1"

# Hermes: a block at the end, the rest of the file as it was, a copy of the old file, the key
# in .env and nowhere else.
cfg="$(cat "$HH/config.yaml")"
contains "Hermes config.yaml: gains mcp_servers with a notebook that NAMES the key" "$cfg" 'mcp_servers:
  notebook:
    url: https://mcp.menerio.com
    headers:
      Authorization: Bearer ${MENERIO_API_KEY}'
contains "  and keeps what was there, comment included" "$cfg" '# my hermes settings
model: some-model
terminal:
  backend: local'
lacks "  and does not hold the key" "$cfg" "$KEY1"
[ "$(cat "$HH/config.yaml.bak")" = '# my hermes settings
model: some-model
terminal:
  backend: local' ] && ok "  and config.yaml.bak is the file as it was" || bad "no usable config.yaml.bak"
[ "$(cat "$HH/.env")" = "OPENROUTER_API_KEY=sk-keep-me
TELEGRAM_TOKEN=keep-me-too
MENERIO_API_KEY=$KEY1" ] && ok "Hermes .env: the key line added, the other lines untouched" || bad "Hermes .env is not right"
case "$(uname -s)" in
  MINGW*|MSYS*|CYGWIN*) ok "  (file mode 600 is not a thing on Windows, skipped)" ;;
  *) mode="$(stat -c '%a' "$HH/.env" 2>/dev/null || stat -f '%Lp' "$HH/.env")"
     [ "$mode" = "600" ] && ok "  and only you can read it (mode 600)" || bad "Hermes .env has mode $mode, not 600" ;;
esac

# Codex: the three lines `codex mcp add --url --bearer-token-env-var` writes (codex-cli 0.144.1).
toml="$(cat "$CH/config.toml")"
contains "Codex config.toml: gains the notebook, with the key NAMED" "$toml" '[mcp_servers.notebook]
url = "https://mcp.menerio.com"
bearer_token_env_var = "MENERIO_API_KEY"'
contains "  and keeps what was there" "$toml" '# my codex settings
model = "gpt-5.5"

[mcp_servers.other]
command = "npx"
args = ["-y", "thing"]'
[ -f "$CH/config.toml.bak" ] && ! grep -q notebook "$CH/config.toml.bak" && ok "  and config.toml.bak is the file as it was" || bad "no usable config.toml.bak"

# ---- the second run ------------------------------------------------------------------------
before="$(sums)"
out="$(run "$KEY1")"; rc=$?
[ "$rc" = "0" ] && [ "$(sums)" = "$before" ] && ok "run twice: the second run changes nothing, byte for byte" || bad "the second run changed a file (exit $rc)" "$out"
[ "$(echo "$out" | grep -c "^  \(Claude Code\|Hermes\|Codex\) *already connected\.")" = "3" ] \
  && ok "  and all three say already connected" || bad "the second report is wrong" "$out"
out="$(run "$KEY1" --check)"
[ "$(echo "$out" | grep -c "already connected")" = "3" ] && [ "$(sums)" = "$before" ] && ok "  and --check agrees" || bad "--check disagrees after connecting" "$out"

# ---- a key you replaced reaches Hermes -----------------------------------------------------
out="$(run "$KEY2" --refresh)"; rc=$?
[ "$rc" = "0" ] && [ -z "$out" ] && ok "--refresh is silent" || bad "--refresh spoke or failed (exit $rc)" "$out"
[ "$(cat "$HH/.env")" = "OPENROUTER_API_KEY=sk-keep-me
TELEGRAM_TOKEN=keep-me-too
MENERIO_API_KEY=$KEY2" ] && ok "  and replaced that one line with the new key, and only that line" || bad "--refresh did not render the new key" "$(sed "s/=.*/=.../" "$HH/.env")"
before="$(sums)"
run "$KEY2" --refresh >/dev/null
[ "$(sums)" = "$before" ] && ok "  and a --refresh with nothing new writes nothing" || bad "an idle --refresh rewrote a file"

# ---- Hermes already has other servers: one entry goes in, the rest stays -------------------
newbox hermes-has-servers; mkdir -p "$HH"
cat > "$HH/config.yaml" <<'EOF'
model: some-model
mcp_servers:
    chrome-bridge:
        command: python3
        args:
            - server.py
        enabled: true
# a comment that belongs to what comes next
security:
  protected_instruction_files: true
EOF
orig="$(cat "$HH/config.yaml")"
out="$(run "$KEY1")"
cfg="$(cat "$HH/config.yaml")"
contains "Hermes with servers already: the notebook goes in, in the file's own indentation" "$cfg" 'mcp_servers:
    notebook:
        url: https://mcp.menerio.com
        headers:
            Authorization: Bearer ${MENERIO_API_KEY}
    chrome-bridge:
        command: python3'
contains "  and everything after it is where it was" "$cfg" '        enabled: true
# a comment that belongs to what comes next
security:
  protected_instruction_files: true'
[ "$(cat "$HH/config.yaml.bak")" = "$orig" ] && ok "  and the copy is the file as it was" || bad "config.yaml.bak is not the original"
contains "  and Codex, which is not on this box, is called not installed" "$out" "Codex         not installed"
newbox hermes-empty-map; mkdir -p "$HH"; printf 'model: m\nmcp_servers: {}\nweb:\n  backend: x\n' > "$HH/config.yaml"
run "$KEY1" >/dev/null
contains "Hermes with an empty 'mcp_servers: {}': the block replaces the empty braces" "$(cat "$HH/config.yaml")" 'model: m
mcp_servers:
  notebook:
    url: https://mcp.menerio.com
    headers:
      Authorization: Bearer ${MENERIO_API_KEY}
web:
  backend: x'

# ---- what somebody made by hand is left working --------------------------------------------
newbox by-hand; mkdir -p "$HH" "$CH"
cat > "$HH/config.yaml" <<'EOF'
mcp_servers:
  notebook:
    url: https://mcp.menerio.com
    headers:
      Authorization: Bearer ${MCP_NOTEBOOK_API_KEY}
EOF
printf 'MCP_NOTEBOOK_API_KEY=mnr_the_old_hand_made_one\n' > "$HH/.env"
printf '[mcp_servers.memory]\nurl = "https://mcp.menerio.com/"\nbearer_token_env_var = "MY_OWN_NAME"\n' > "$CH/config.toml"
printf '{"mcpServers": {"memory": {"type": "http", "url": "https://mcp.menerio.com", "headers": {"Authorization": "Bearer ${MENERIO_API_KEY}"}}}}\n' > "$B/hub/.mcp.json"
before="$(sums)"
out="$(run "$KEY1")"; rc=$?
[ "$rc" = "0" ] && [ "$(sums)" = "$before" ] && ok "connections made by hand, under any name: not one file is touched" || bad "a hand-made connection was edited (exit $rc)" "$out"
contains "  and the older Hermes entry with its own key is reported as what it is" "$out" "MCP_NOTEBOOK_API_KEY"
contains "  and the other names are reported" "$out" 'under the name `memory`'
[ "$(echo "$out" | grep -c "already connected")" = "3" ] && ok "  and all three count as already connected" || bad "hand-made connections were not recognised" "$out"
run "$KEY2" --refresh >/dev/null
[ "$(sums)" = "$before" ] && ok "  and --refresh does not put a key into a Hermes it did not connect" || bad "--refresh wrote into a hand-made Hermes"

# ---- files it cannot read are left alone, and that is a failure it admits -------------------
newbox broken
printf '{ this is not json' > "$B/hub/.mcp.json"
out="$(run "$KEY1")"; rc=$?
[ "$rc" = "1" ] && [ "$(cat "$B/hub/.mcp.json")" = '{ this is not json' ] && ok "a .mcp.json that is not JSON is left exactly as it is, and the run says failed" || bad "a broken .mcp.json was not handled (exit $rc)" "$out"
contains "  with the reason on the line" "$out" "Claude Code   failed: .mcp.json in your hub folder is not valid JSON"
contains "an assistant that is not on the computer is called not installed" "$out" "Hermes        not installed"
newbox name-taken; mkdir -p "$CH"
printf '[mcp_servers.notebook]\nurl = "https://example.com/mcp"\n' > "$CH/config.toml"
before="$(cat "$CH/config.toml")"
out="$(run "$KEY1")"
if [ "$(cat "$CH/config.toml")" = "$before" ]; then
  contains "a 'notebook' that points somewhere else is never overwritten, and the line says so" "$out" "Codex         failed: Codex already has a \`notebook\` that points somewhere else"
else
  bad "a 'notebook' that pointed somewhere else was overwritten" "$(cat "$CH/config.toml")"
fi

# ---- no hub file yet ------------------------------------------------------------------------
newbox no-mcp-json
out="$(run "$KEY1")"
"$NODE" -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));process.exit(d.mcpServers.notebook.url==="https://mcp.menerio.com"?0:1)' "$B/hub/.mcp.json" \
  && ok "a hub with no .mcp.json gets one" || bad "no .mcp.json was written" "$out"

# ---- the notebook says no -------------------------------------------------------------------
newbox refused
out="$(run "mnr_a_key_menerio_does_not_know")"; rc=$?
[ "$rc" = "1" ] && contains "a key Menerio refuses: the real answer is reported, and the run fails" "$out" "The notebook  failed: Menerio refused the key (401): This key is not known here." || bad "a refused key was not reported (exit $rc)" "$out"
lacks "  and even then the key is not printed" "$out" "mnr_a_key_menerio_does_not_know"
out="$(MCP="http://127.0.0.1:1" run "$KEY1")"
contains "no network: said plainly" "$out" "The notebook  failed: this computer could not reach 127.0.0.1:1."

# ---- the hourly runner hands a replaced key to Hermes ----------------------------------------
# The runner is copied somewhere with no notebook-sync.py beside it, so it stops right after
# the refresh and never gets as far as calling a notebook, real or not.
newbox runner; mkdir -p "$HH" "$B/bin"
cp "$HERE/hub-notebook-sync" "$HERE/hub-menerio-connect" "$HERE/menerio-connect.js" "$HERE/hub-notebook.js" "$B/bin/"
printf 'mcp_servers:\n  notebook:\n    url: https://mcp.menerio.com\n    headers:\n      Authorization: Bearer ${MENERIO_API_KEY}\n' > "$HH/config.yaml"
printf 'MENERIO_API_KEY=%s\n' "$KEY1" > "$HH/.env"
printf 'HUB_DIR=%s\n' "$B/hub" > "$B/home/.hub/device.env"
out="$(HOME="$B/home" USERPROFILE="$B/home" LOCALAPPDATA="$B/appdata" HERMES_HOME="$HH" CODEX_HOME="$CH" \
       PATH="$SAFE_PATH" MENERIO_API_KEY="$KEY2" MENERIO_BASE_URL="http://127.0.0.1:1" sh "$B/bin/hub-notebook-sync" --hub "$B/hub" 2>&1)"; rc=$?
if [ "$rc" = "0" ] && [ -z "$out" ] && [ "$(cat "$HH/.env")" = "MENERIO_API_KEY=$KEY2" ]; then
  ok "hub-notebook-sync runs --refresh once it has the key: Hermes holds the new key, and the run stays silent"
else
  bad "the runner did not refresh Hermes (exit $rc)" "$out"
fi
lacks "  and the runner's log does not hold the key" "$(cat "$B/home/.hub/notebook-sync.log" 2>/dev/null)" "$KEY2"

# ---- the real Hermes command, when this computer has one --------------------------------------
# Everything above used the careful hand edit. With a real `hermes` on PATH the program asks
# Hermes to make the edit, and that path deserves one run. HERMES_HOME points it at the
# throwaway folder, and the check is skipped unless Hermes itself confirms that first.
REAL_HERMES="$(PATH="$FULL_PATH" command -v hermes 2>/dev/null || true)"
if [ -n "$REAL_HERMES" ]; then
  newbox real-hermes; mkdir -p "$HH" "$CH"
  printf 'model: some-model\n' > "$HH/config.yaml"
  HHW="$HH"; command -v cygpath >/dev/null 2>&1 && HHW="$(cygpath -w "$HH")"
  seen="$(HERMES_HOME="$HHW" PATH="$FULL_PATH" hermes config path 2>/dev/null | tr -d '\r' | tail -1)"
  case "$seen" in
    *real-hermes*)
      out="$(HH="$HHW" RUN_PATH="$FULL_PATH" NO_CLI="" run "$KEY1")"
      if grep -q "notebook:" "$HH/config.yaml" && grep -q 'Authorization: Bearer ${MENERIO_API_KEY}' "$HH/config.yaml" \
         && grep -q "some-model" "$HH/config.yaml" && grep -q "^MENERIO_API_KEY=$KEY1$" "$HH/.env"; then
        ok "with a real hermes command ($("$REAL_HERMES" --version 2>/dev/null | head -1 | tr -d '\r')): same result"
      else
        bad "the real hermes command did not produce the notebook entry" "$out $(cat "$HH/config.yaml")"
      fi
      before="$(sums)"
      HH="$HHW" RUN_PATH="$FULL_PATH" NO_CLI="" run "$KEY1" >/dev/null
      [ "$(sums)" = "$before" ] && ok "  and a second run changes nothing there either" || bad "the second run with a real hermes changed a file"
      ;;
    *) ok "a real hermes is here but did not confirm the throwaway folder, so it was not used (skipped)" ;;
  esac
else
  ok "no real hermes command on this computer, so only the hand edit was tested (skipped)"
fi

echo
echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
