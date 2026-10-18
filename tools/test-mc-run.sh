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
# Asked for its help, it answers like a Claude Code that knows --restricted and dontAsk, or
# (STAND_HELP=nodontask) one without dontAsk, or (STAND_HELP=sources) one that knows only
# --setting-sources, or (STAND_HELP=none) one that knows neither. The MCP file it is handed is
# copied, since mc-run removes it when the run ends. STAND_SLEEP makes it hang that long.
for name in hermes claude codex; do
  cat > "$B/$name" <<STAND
#!/bin/sh
if [ "\$1" = --help ]; then
  echo asked >> "$L/$name.help"
  case "\${STAND_HELP:-restricted}" in
    restricted) printf '  --restricted  Restricted mode\n  --setting-sources <sources>  Comma-separated list\n  --strict-mcp-config  Only use MCP servers from --mcp-config\n  --permission-mode <mode>  ("acceptEdits", "dontAsk", "plan")\n' ;;
    nodontask) printf '  --restricted  Restricted mode\n  --setting-sources <sources>  Comma-separated list\n  --strict-mcp-config  Only use MCP servers\n' ;;
    sources) printf '  --setting-sources <sources>  Comma-separated list\n' ;;
  esac
  exit 0
fi
for a in "\$@"; do printf '[%s]\n' "\$a"; done > "$L/$name.args"
prev=""; for a in "\$@"; do [ "\$prev" = --mcp-config ] && cp "\$a" "$L/$name.mcp"; prev="\$a"; done
[ -n "\${STAND_SLEEP:-}" ] && sleep "\$STAND_SLEEP"
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
printf '{ "mcpServers": { "notebook": { "command": "nb", "env": { "KEY": "${NB_KEY}" } }, "planino": { "command": "pl" } } }\n' > "$G/.mcp.json"
GW="$G"; command -v cygpath >/dev/null 2>&1 && GW="$(cygpath -m "$G")"
LIMITED="Bash(mc-goals:*) Bash(ls:*) Read Edit(/goals/research/**) WebFetch mcp__notebook__search_brain"
# The mission control's folder as Claude Code matches a path (C:/x is /c/x on Windows).
GC="$(cd "$G" && pwd)"; command -v cygpath >/dev/null 2>&1 && GC="$(cygpath -m "$GC" | sed -E 's#^([A-Za-z]):#/\L\1#')"
runl() { # runner help-kind list
  rm -f "$L/$1.args" "$L/$1.help" "$L/$1.mcp"
  HOME="$TMP/home" PATH="$B:$PATH" GODSPEED_RUNNER="$1" STAND_HELP="$2" bash "$HERE/mc-run" big --godspeed "$G" \
    --out "$G/out/l-$1.txt" --timeout 60 ${3:+--allowed-tools "$3"} 2> "$L/$1.err"
}
echo "-- a list that limits the shell"
runl claude restricted "$LIMITED"; check "  it finished" "$?" "0"
args="$(cat "$L/claude.args" 2>/dev/null)"
contains "  claude runs restricted, so the computer's settings cannot add to the list" "$args" "[--restricted]"
contains "  with only the tools the list names, and ToolSearch" "$args" "[--tools]
[Bash,Read,Edit,Write,WebFetch,ToolSearch]"
contains "  in dontAsk mode, so it writes only where the list says" "$args" "[--permission-mode]
[dontAsk]"
missing "  never acceptEdits, which approves every edit in the mission control" "$args" "acceptEdits"
contains "  only the MCP servers it is handed start" "$args" "[--strict-mcp-config]"
contains "  and it is handed some" "$args" "[--mcp-config]"
mcp="$(cat "$L/claude.mcp" 2>/dev/null)"
contains "  the server the list names is in that file" "$mcp" '"notebook"'
contains "  with its key still named, never filled in" "$mcp" '${NB_KEY}'
missing "  a server the list does not name is not" "$mcp" "planino"
check "  and the file is gone when the run ends" "$(ls "${TMPDIR:-/tmp}"/mc-run-mcp.* 2>/dev/null | wc -l | tr -d ' ')" "0"
contains "  and the list follows, one word per pattern, its file rule anchored at the mission control" "$args" "[--allowedTools]
[Bash(mc-goals:*)]
[Bash(ls:*)]
[Read]
[Edit(/$GC/goals/research/**)]"
contains "  the rest of the list as given" "$args" "[WebFetch]
[mcp__notebook__search_brain]"
runl claude restricted "Bash(ls:*) Read WebFetch"
args="$(cat "$L/claude.args" 2>/dev/null)"
contains "a list that names no MCP server: still only the servers handed over, which are none" "$args" "[--strict-mcp-config]"
missing "  and no MCP file at all" "$args" "[--mcp-config]"
runl claude nodontask "$LIMITED"; check "a Claude Code without dontAsk still runs" "$?" "0"
args="$(cat "$L/claude.args" 2>/dev/null)"
contains "  restricted" "$args" "[--restricted]"
missing "  in its default mode, never acceptEdits" "$args" "[--permission-mode]"
contains "  and says so" "$(cat "$L/claude.err" 2>/dev/null)" "no dontAsk mode"
contains "  the answer was kept" "$(cat "$G/out/l-claude.txt" 2>/dev/null)" "RESULT: done"
runl claude sources "$LIMITED"
args="$(cat "$L/claude.args" 2>/dev/null)"
contains "a Claude Code without --restricted reads no settings files instead" "$args" "[--setting-sources]
[]"
missing "  and is not given --restricted" "$args" "[--restricted]"
contains "  its MCP servers are handed over too" "$args" "[--mcp-config]"
missing "  and it is not given --strict-mcp-config, which it does not know" "$args" "[--strict-mcp-config]"
runl claude none "$LIMITED"; check "a Claude Code that knows neither still runs" "$?" "0"
args="$(cat "$L/claude.args" 2>/dev/null)"
missing "  without --restricted" "$args" "[--restricted]"
missing "  without --setting-sources" "$args" "[--setting-sources]"
contains "  and says the list is not binding" "$(cat "$L/claude.err" 2>/dev/null)" "not held to its list of tools"
contains "  where mc-research reads it, beside the answer" "$(cat "$G/out/l-claude.txt.stderr" 2>/dev/null)" "not held to its list of tools"
for list in "Bash Read" "Bash(*) Read WebFetch" ""; do
  runl claude restricted "$list"
  args="$(cat "$L/claude.args" 2>/dev/null)"
  what="a list that grants the whole shell ($list)"; [ -n "$list" ] || what="no list"
  missing "$what: no --restricted" "$args" "[--restricted]"
  missing "  no --tools" "$args" "[--tools]"
  missing "  no --setting-sources" "$args" "[--setting-sources]"
  missing "  no --mcp-config" "$args" "[--mcp-config]"
  missing "  no dontAsk" "$args" "dontAsk"
  check "  and claude is not even asked what it knows" "$(test -f "$L/claude.help" && echo asked || echo not)" "not"
done
missing "no list: no --allowedTools either" "$(cat "$L/claude.args")" "[--allowedTools]"
for name in hermes codex; do
  runl "$name" restricted "$LIMITED"; check "$name with a limiting list still runs" "$?" "0"
  contains "  and says the limits rest on the recipe's words" "$(cat "$L/$name.err" 2>/dev/null)" "held to its limits only by the recipe's own words"
done
runl hermes restricted "Bash Read"
check "hermes with a whole-shell list says nothing about it" "$(cat "$L/hermes.err" 2>/dev/null)" ""
contains "a whole-shell list keeps acceptEdits" "$(runl claude restricted "Bash Read"; cat "$L/claude.args")" "[acceptEdits]"
rm -f "$G/.mcp.json"

# A FILE RULE MEANS THE RUN'S FOLDER, WHEREVER THE ASSISTANT HAS cd'd TO (2026-10-15). Claude Code
# reads a plain path in an Edit rule against its current folder, and its shell keeps a cd: a night
# that began with `cd goals/research/<goal>` had every save refused. So mc-run writes a plain path
# and a /path as the run's folder's absolute path (//...), escapes what gitignore reads as a
# pattern, writes C:/x as /c/x on Windows, and names a folder reached through a symlink twice. The
# expected rules are spelled out by hand here, never worked out the way mc-run does it.
echo "-- a file rule is anchored at the run's folder"
TP="$(cd "$TMP" && pwd -P)"
G4="$TMP/mission [control] one"; mkdir -p "$G4/rules" "$G4/skills"; cp -r "$G/skills/big" "$G4/skills/"
ANCHOR_LIST="Bash(ls:*) Read Edit(goals/research/**) Edit(./ideas/**) Edit(/notes/**) Edit(*.tmp) Read(docs/**) Edit(//etc/keep/**) Edit(~/keep/**) Edit(!x) Edit(../up/**) WebFetch"
runa() { # folder
  rm -f "$L/claude.args"
  HOME="$TMP/home" PATH="$B:$PATH" GODSPEED_RUNNER=claude STAND_HELP=restricted bash "$HERE/mc-run" big --godspeed "$1" \
    --out "$TMP/anchor.txt" --timeout 60 --allowed-tools "$ANCHOR_LIST" 2> "$L/claude.err"
  cat "$L/claude.args" 2>/dev/null
}
if command -v cygpath >/dev/null 2>&1; then
  # Windows: C:/Users/me/... is matched as /c/Users/me/...; cygpath -u is not that (it writes the
  # Temp folder as /tmp), so the drive is spelled out from the C:/ form.
  W4="$(cygpath -m "$G4" | sed -E 's#^([A-Za-z]):#/\L\1#; s#\[#\\[#g; s#\]#\\]#g')"
  args="$(runa "$G4")"
  contains "a plain path is the folder's, as Windows paths are matched (/c/...)" "$args" "[Edit(/$W4/goals/research/**)]"
  missing "  never the /tmp of cygpath -u" "$args" "[Edit(//tmp/"
else
  # The run starts in the mission control through a symlink: both spellings are named.
  ln -s "$G4" "$TMP/mc-link"
  W4="$TMP/mc-link"; P4="$TP/mission \\[control\\] one"
  args="$(runa "$TMP/mc-link")"
  contains "a plain path is anchored at the folder the run starts in, as given" "$args" "[Edit(/$W4/goals/research/**)]"
  contains "  and where that folder really is, its [ ] escaped" "$args" "[Edit(/$P4/goals/research/**)]"
  contains "  a /path the same" "$args" "[Edit(/$W4/notes/**)]
[Edit(/$P4/notes/**)]"
  W4="$P4"
fi
contains "  ./path the same" "$args" "[Edit(/$W4/ideas/**)]"
contains "  a name with no / still matches at any depth" "$args" "[Edit(/$W4/**/*.tmp)]"
contains "  Read rules too" "$args" "[Read(/$W4/docs/**)]"
contains "  an absolute rule stays as written" "$args" "[Edit(//etc/keep/**)]"
contains "  a home rule stays as written" "$args" "[Edit(~/keep/**)]"
contains "  a carve-out stays as written" "$args" "[Edit(!x)]"
contains "  a rule above the folder stays as written" "$args" "[Edit(../up/**)]"
missing "  no plain path is left" "$args" "[Edit(goals/research/**)]"
check "  the run still finishes" "$(cat "$TMP/anchor.txt" | tail -n 1)" "RESULT: done"
args="$(rm -f "$L/claude.args"; HOME="$TMP/home" PATH="$B:$PATH" GODSPEED_RUNNER=claude bash "$HERE/mc-run" big --godspeed "$G4" --out "$TMP/anchor.txt" --timeout 60 --allowed-tools "Bash Read Edit(goals/research/**)" 2>/dev/null; cat "$L/claude.args")"
contains "a whole-shell list is passed as given" "$args" "[Edit(goals/research/**)]"

# ALREADY IN A CAGE (2026-10-13). On the server a cron job runs in agent-cage as a whole, and
# agent-cage called again inside a cage keeps the first clock and puts no limit of its own on the
# command. So mc-run, inside a cage, keeps its --timeout with timeout. The stand-in cage below does
# what the real one does: inside a cage it just runs the command.
echo "-- inside a cage"
CG="$TMP/cage"; mkdir -p "$CG"
cat > "$CG/agent-cage" <<CAGE
#!/bin/sh
echo used >> "$L/cage.used"
while [ \$# -gt 0 ]; do case "\$1" in --max) shift 2 ;; --) shift; break ;; *) break ;; esac; done
case "\$(cat "\${MC_RUN_CGROUP_FILE:-/proc/self/cgroup}" 2>/dev/null)" in *"/agent.slice/"*) exec "\$@" ;; esac
exec timeout 3 "\$@"
CAGE
chmod +x "$CG/agent-cage"
printf '0::/agent.slice/agent-1-2-3.scope\n' > "$TMP/cgroup-caged"
printf '0::/user.slice/user-0.slice/session-1.scope\n' > "$TMP/cgroup-free"
rm -f "$L/cage.used"
t0=$(date +%s)
HOME="$TMP/home" PATH="$CG:$B:$PATH" GODSPEED_RUNNER=claude STAND_SLEEP=40 MC_RUN_CGROUP_FILE="$TMP/cgroup-caged" \
  bash "$HERE/mc-run" big --godspeed "$G" --out "$G/out/caged.txt" --timeout 2 --allowed-tools "Bash Read"; rc=$?
took=$(( $(date +%s) - t0 ))
[ "$took" -lt 20 ] && ok "a hung run inside a cage still ends at its own --timeout (${took}s)" || bad "a hung run inside a cage ran ${took}s past its 2 s limit"
check "  and the exit says it was ended for time" "$rc" "124"
check "  the cage was not asked again" "$(test -f "$L/cage.used" && echo used || echo not)" "not"
rm -f "$L/cage.used"
HOME="$TMP/home" PATH="$CG:$B:$PATH" GODSPEED_RUNNER=claude MC_RUN_CGROUP_FILE="$TMP/cgroup-free" \
  bash "$HERE/mc-run" big --godspeed "$G" --out "$G/out/free.txt" --timeout 60 --allowed-tools "Bash Read"; rc=$?
check "outside a cage the run goes through the cage" "$(test -f "$L/cage.used" && echo used || echo not)" "used"
check "  and finishes" "$rc" "0"

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
