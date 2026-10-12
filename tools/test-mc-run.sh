#!/usr/bin/env bash
# test-mc-run.sh - the gate for how mc-run hands a recipe to an assistant: on standard input, for
# hermes, claude and codex alike, never as one argument (2026-10-09). A Windows command line holds
# at most 32,767 characters, the next-action recipe alone is longer, and Hermes got it as one
# argument, so on Windows the daily round's morning choice could never start ("Argument list too
# long"). Stand-ins play the three assistants; no model runs here. The recipe is 40,000
# characters. On Windows a second stand-in is a real Windows program, a copy of node, so the
# limit applies to it exactly as it does to hermes.exe, and it runs with the two settings Hermes
# gives its commands (MSYS_NO_PATHCONV=1, MSYS2_ARG_CONV_EXCL=*).
#
# Runs in a throwaway folder with its own HOME, so no assistant on this computer is ever started.
# Usage: bash tools/test-mc-run.sh
set -uo pipefail
. "$(dirname "$0")/test-guard.bash"
HERE="$(cd "$(dirname "$0")" && pwd)"
NODE=""
for c in node nodejs /usr/local/bin/node /usr/bin/node; do
  "$c" -e '' >/dev/null 2>&1 && { NODE="$c"; break; }
done
[ -n "$NODE" ] || { echo "FAIL: no node on this box"; exit 1; }
NODE="$(command -v "$NODE")"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP" "$TEST_GUARD_HOME"' EXIT
G="$TMP/godspeed"; B="$TMP/bin"; L="$TMP/log"
mkdir -p "$G/rules" "$G/skills/big" "$B" "$L" "$TMP/home"
"$NODE" -e 'process.stdout.write("---\nname: big\ndescription: a long recipe\n---\n"+"Read every line of this. ".repeat(1700)+"\nTHE END OF THE RECIPE\n")' > "$G/skills/big/SKILL.md"

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
check()    { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (wanted [$3], got [$2])"; fi; }
contains() { case "$2" in *"$3"*) ok "$1";; *) bad "$1 (missing [$3] in: $(printf '%s' "$2" | head -3 | cut -c1-160))";; esac; }
missing()  { case "$2" in *"$3"*) bad "$1 (should not contain [$3])";; *) ok "$1";; esac; }

echo "mc-run gate"
size="$(wc -c < "$G/skills/big/SKILL.md" | tr -d ' ')"
[ "$size" -gt 40000 ] && ok "the recipe is longer than 40,000 characters ($size)" || bad "the recipe is only $size characters"

# THE STAND-IN. It writes down every argument, the longest one, and what came on standard input,
# then answers. As hermes it also prints Hermes' waiting line, which must not reach the answer.
# Asked for its help, it answers like a Claude Code that knows --restricted, or (STAND_HELP=sources)
# one that knows only --setting-sources, or (STAND_HELP=none) one that knows neither.
for name in hermes claude codex; do
  cat > "$B/$name" <<STAND
#!/bin/sh
if [ "\$1" = --help ]; then
  echo asked >> "$L/$name.help"
  case "\${STAND_HELP:-restricted}" in
    restricted) printf '  --restricted  Restricted mode\n  --setting-sources <sources>  Comma-separated list\n' ;;
    sources) printf '  --setting-sources <sources>  Comma-separated list\n' ;;
  esac
  exit 0
fi
for a in "\$@"; do printf '[%s]\n' "\$a"; done > "$L/$name.args"
longest=0; for a in "\$@"; do [ \${#a} -gt \$longest ] && longest=\${#a}; done; echo \$longest > "$L/$name.longest"
cat > "$L/$name.stdin"
printf 'Here is the answer.\n\nFor you today: nothing.\nRESULT: done\n'
[ "$name" = hermes ] && printf '  [tool] ( \313\230\342\214\243\313\230)\342\231\241 brainstorming...\n'
exit 0
STAND
  chmod +x "$B/$name"
done

# HOME is the throwaway one: mc-run puts ~/.local/bin first on its path, and a real assistant
# there must never be the one that answers a test.
run() { HOME="$TMP/home" PATH="$B:$PATH" GODSPEED_RUNNER="$1" bash "$HERE/mc-run" big --godspeed "$G" --prompt "THE EXTRA LINE" --out "$G/out/$1.txt" --timeout 60 --allowed-tools "Bash Read"; }

for name in hermes claude codex; do
  echo "-- $name"
  run "$name"; rc=$?
  check "  it finished" "$rc" "0"
  stdin="$(cat "$L/$name.stdin" 2>/dev/null)"
  [ "${#stdin}" -gt 40000 ] && ok "  the whole prompt came on standard input (${#stdin} characters)" || bad "  only ${#stdin} characters came on standard input"
  contains "  the recipe's last line is in it" "$stdin" "THE END OF THE RECIPE"
  contains "  the extra text is in it" "$stdin" "THE EXTRA LINE"
  contains "  the line naming the folder is in it" "$stdin" "Working directory: "
  missing "  the recipe's header is not" "$stdin" "description: a long recipe"
  longest="$(cat "$L/$name.longest" 2>/dev/null || echo 99999)"
  [ "$longest" -lt 1000 ] && ok "  no argument is long (the longest is $longest)" || bad "  an argument of $longest characters was passed"
  answer="$(cat "$G/out/$name.txt" 2>/dev/null)"
  contains "  the answer was kept" "$answer" "RESULT: done"
  missing "  Hermes' waiting line is not in it" "$answer" "brainstorming..."
done
args="$(cat "$L/hermes.args")"
contains "hermes is asked to read standard input" "$args" "[chat]
[--query-file]
[-]"
contains "  and to answer once, quietly" "$args" "[--quiet]
[--oneshot]"
contains "  and not to wait for a yes nobody can give" "$args" "[--yolo]
[--accept-hooks]"
contains "  in the mission control" "$args" "[--in]"
contains "claude still gets its tools" "$(cat "$L/claude.args")" "[--allowedTools]
[Bash]
[Read]"
contains "codex still reads standard input" "$(cat "$L/codex.args")" "[--skip-git-repo-check]
[-]"
check "the answer's last line is the assistant's, not Hermes' waiting line" "$(tail -n 1 "$G/out/hermes.txt")" "RESULT: done"

# A LIST THAT LIMITS THE SHELL BINDS CLAUDE (2026-10-13). --allowedTools only adds approvals to the
# computer's own settings, and on the server those allowed every command, so the first nightly
# research ran its own shell. A list that names Bash(...) commands now starts claude with
# --restricted (no settings files read, file tools kept in the folder), --tools (only what the list
# names) and the mission control's .mcp.json; a list that grants the whole shell, and no list, do not.
printf '{ "mcpServers": {} }\n' > "$G/.mcp.json"
GW="$G"; command -v cygpath >/dev/null 2>&1 && GW="$(cygpath -m "$G")"
LIMITED="Bash(mc-goals:*) Bash(ls:*) Read Write WebFetch mcp__notebook__search_brain"
runl() { # runner help-kind list
  rm -f "$L/$1.args" "$L/$1.help"
  HOME="$TMP/home" PATH="$B:$PATH" GODSPEED_RUNNER="$1" STAND_HELP="$2" bash "$HERE/mc-run" big --godspeed "$G" \
    --out "$G/out/l-$1.txt" --timeout 60 ${3:+--allowed-tools "$3"} 2> "$L/$1.err"
}
echo "-- a list that limits the shell"
runl claude restricted "$LIMITED"; check "  it finished" "$?" "0"
args="$(cat "$L/claude.args" 2>/dev/null)"
contains "  claude runs restricted, so the computer's settings cannot add to the list" "$args" "[--restricted]"
contains "  with only the tools the list names, and ToolSearch" "$args" "[--tools]
[Bash,Read,Write,WebFetch,ToolSearch]"
contains "  the mission control's own MCP servers are handed over" "$args" "[--mcp-config]
[$GW/.mcp.json]"
contains "  and the list follows, one word per pattern" "$args" "[--allowedTools]
[Bash(mc-goals:*)]
[Bash(ls:*)]
[Read]
[Write]
[WebFetch]
[mcp__notebook__search_brain]"
contains "  the answer was kept" "$(cat "$G/out/l-claude.txt" 2>/dev/null)" "RESULT: done"
runl claude sources "$LIMITED"
args="$(cat "$L/claude.args" 2>/dev/null)"
contains "a Claude Code without --restricted reads no settings files instead" "$args" "[--setting-sources]
[]"
missing "  and is not given --restricted" "$args" "[--restricted]"
contains "  its MCP servers are handed over too" "$args" "[--mcp-config]"
runl claude none "$LIMITED"; check "a Claude Code that knows neither still runs" "$?" "0"
args="$(cat "$L/claude.args" 2>/dev/null)"
missing "  without --restricted" "$args" "[--restricted]"
missing "  without --setting-sources" "$args" "[--setting-sources]"
contains "  and says the list is not binding" "$(cat "$L/claude.err" 2>/dev/null)" "cannot hold a run to its list of tools"
for list in "Bash Read" "Bash(*) Read WebFetch" ""; do
  runl claude restricted "$list"
  args="$(cat "$L/claude.args" 2>/dev/null)"
  what="a list that grants the whole shell ($list)"; [ -n "$list" ] || what="no list"
  missing "$what: no --restricted" "$args" "[--restricted]"
  missing "  no --tools" "$args" "[--tools]"
  missing "  no --setting-sources" "$args" "[--setting-sources]"
  missing "  no --mcp-config" "$args" "[--mcp-config]"
  check "  and claude is not even asked what it knows" "$(test -f "$L/claude.help" && echo asked || echo not)" "not"
done
missing "no list: no --allowedTools either" "$(cat "$L/claude.args")" "[--allowedTools]"
for name in hermes codex; do
  runl "$name" restricted "$LIMITED"; check "$name with a limiting list still runs" "$?" "0"
  contains "  and says the limits rest on the recipe's words" "$(cat "$L/$name.err" 2>/dev/null)" "held to its limits only by the recipe's own words"
done
runl hermes restricted "Bash Read"
check "hermes with a whole-shell list says nothing about it" "$(cat "$L/hermes.err" 2>/dev/null)" ""
rm -f "$G/.mcp.json"

# WINDOWS: a real Windows program as hermes, with the two settings Hermes gives its commands.
if command -v cygpath >/dev/null 2>&1; then
  echo "-- a Windows program as hermes (this is Windows)"
  W="$TMP/win"; mkdir -p "$W"
  cp "$NODE" "$W/hermes.exe" 2>/dev/null || cp "$NODE.exe" "$W/hermes.exe"
  cat > "$W/stand-in.cjs" <<'STUB'
// Loaded before anything else: write down what arrived, answer, and stop.
const fs = require("fs");
const args = process.argv.slice(2), at = args.indexOf("--in"), folder = at >= 0 ? args[at + 1] : "";
let input = ""; try { input = fs.readFileSync(0, "utf8"); } catch (e) {}
fs.writeFileSync(process.env.STAND_IN_LOG, JSON.stringify({ args, stdin: input.length, end: input.includes("THE END OF THE RECIPE"), folder, folderExists: !!folder && fs.existsSync(folder) }));
process.stdout.write("Here is the answer.\nRESULT: done\n  [tool] (⊙_⊙) ruminating...\n");
process.exit(0);
STUB
  WLOG="$(cygpath -m "$L/native.json")"
  NOPTS="--require \"$(cygpath -m "$W/stand-in.cjs")\""
  # First the limit itself, so this test cannot pass on a computer where it does not apply.
  big="$(cat "$G/skills/big/SKILL.md")"
  out="$(STAND_IN_LOG="$WLOG" NODE_OPTIONS="$NOPTS" "$W/hermes.exe" -z "$big" 2>&1)"; rc=$?
  [ "$rc" -ne 0 ] && ok "a Windows program given the recipe as one argument does not start (exit $rc)" || bad "the 40,000-character argument went through, so this computer has no such limit"
  contains "  and the reason is the length" "$out" "Argument list too long"
  rm -f "$L/native.json"
  HOME="$TMP/home" PATH="$W:$PATH" GODSPEED_RUNNER=hermes MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' \
    STAND_IN_LOG="$WLOG" NODE_OPTIONS="$NOPTS" bash "$HERE/mc-run" big --godspeed "$G" --cwd "$G" --out "$G/out/native.txt" --timeout 60
  rc=$?
  check "mc-run hands the same recipe to it and it answers" "$rc" "0"
  seen="$(cat "$L/native.json" 2>/dev/null)"
  contains "  the whole recipe arrived on standard input" "$seen" '"end":true'
  contains "  and the folder it was given is one Windows can open" "$seen" '"folderExists":true'
  missing "  the folder is not written /c/..." "$seen" '"folder":"/'
  check "  the waiting line is not in the answer" "$(tail -n 1 "$G/out/native.txt")" "RESULT: done"
fi

echo
echo "mc-run: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
