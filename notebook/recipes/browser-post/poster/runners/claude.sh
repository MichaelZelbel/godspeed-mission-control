#!/usr/bin/env bash
# Runner: headless Claude Code, once, for one Planino browser posting job.
#
# Called by wake.js with the job id as $1 and these in the environment:
#   JOB_ID, JOB_PLATFORM, PLANINO_POSTER_URL, PLANINO_POSTER_TOKEN, BRIDGE_URL
# Everything the AI needs ships in this kit: the posting rules in poster/skill/SKILL.md, the
# playbooks in poster/playbooks/, and the bridge's MCP server in mcp/ (run `npm install` there
# once). Planino is reached through the poster API with the poster token, so no other account,
# repository or MCP token is needed.
#
# Knobs (poster.env): CLAUDE_BIN, CLAUDE_MAX_TURNS, and AI_WORKDIR: a folder to run Claude in
# instead of the kit, so that folder's own CLAUDE.md, hooks and MCP servers apply as well
# (Mission Control runs it in its own folder that way). GODSPEED_DIR is the old name for it.
#
# After the run, the cost Claude reports is written onto the job through the
# poster API, so every row says what it cost even though the AI cannot know
# its own bill while it is still running.
set -uo pipefail

JOB_ID="${1:-${JOB_ID:-}}"
CLAUDE_BIN="${CLAUDE_BIN:-claude}"
MAX_TURNS="${CLAUDE_MAX_TURNS:-40}"
[[ "$MAX_TURNS" =~ ^[0-9]+$ ]] && [ "$MAX_TURNS" -ge 1 ] && [ "$MAX_TURNS" -le 40 ] || { echo "Choose one to forty tool turns" >&2; exit 2; }
POSTER_DIR="$(cd "$(dirname "$0")/.." && pwd)"
KIT_DIR="$(cd "$POSTER_DIR/.." && pwd)"
SKILL="$POSTER_DIR/skill/SKILL.md"
WORKDIR="${GODSPEED_WORKSPACE:?Choose this installation workspace}"
export POSTER_DIR BRIDGE_URL PLANINO_POSTER_URL PLANINO_POSTER_TOKEN
[ -n "${BRIDGE_TOKEN:-}" ] && export BRIDGE_TOKEN
[ -n "${SUBSTACK_PUBLICATION:-}" ] && export SUBSTACK_PUBLICATION

[ -f "$SKILL" ] || { echo "runner: $SKILL is missing; the kit is incomplete" >&2; exit 2; }

MCP_CONFIG=""
MCP_ARGS=()
cd "$WORKDIR" || exit 2
# This selected workspace supplies its actual MCP connections and authorization.

PROMPT="A browser posting job is queued in Planino${JOB_ID:+ (job id $JOB_ID)}${JOB_PLATFORM:+, platform $JOB_PLATFORM}. Read $SKILL and follow it: claim that one job, post it through the Chrome Agent Bridge at $BRIDGE_URL following the playbook in $POSTER_DIR/playbooks/, verify the live result, and report it. The poster API is at \$PLANINO_POSTER_URL with the bearer token in \$PLANINO_POSTER_TOKEN. One job only, then stop."

OUT="$(mktemp)"
"$CLAUDE_BIN" -p "$PROMPT" \
  "${MCP_ARGS[@]}" \
  --output-format json \
  --max-turns "$MAX_TURNS" \
  --allowedTools "Read,Grep,Glob,Edit,Bash,mcp__planino__*,mcp__chrome-bridge__*" \
  > "$OUT" 2>"$OUT.err"
CODE=$?

# Put the cost on the job. The JSON carries total_cost_usd, num_turns and
# duration_ms; a job that was never claimed (no id) has nowhere to put it.
if [ -n "$JOB_ID" ] && command -v python3 >/dev/null 2>&1; then
  python3 - "$OUT" "$JOB_ID" <<'PY' 2>/dev/null
import json, os, sys, urllib.request
try:
    d = json.load(open(sys.argv[1], encoding="utf-8"))
except Exception:
    sys.exit(0)
m = {}
if isinstance(d.get("total_cost_usd"), (int, float)): m["cost_usd"] = d["total_cost_usd"]
if isinstance(d.get("num_turns"), int): m["tool_calls"] = d["num_turns"]
if isinstance(d.get("duration_ms"), (int, float)): m["seconds"] = round(d["duration_ms"] / 1000)
m["harness"] = "claude-code"
body = json.dumps({"job_id": sys.argv[2], "metrics": m}).encode()
req = urllib.request.Request(os.environ["PLANINO_POSTER_URL"].rstrip("/") + "/metrics", data=body, method="POST",
    headers={"Authorization": "Bearer " + os.environ["PLANINO_POSTER_TOKEN"], "Content-Type": "application/json"})
try:
    urllib.request.urlopen(req, timeout=20).read()
except Exception as e:
    print("metrics not written: %s" % e, file=sys.stderr)
PY
fi

# The AI's last line, for the waker's log.
python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(str(d.get("result",""))[:400])' "$OUT" 2>/dev/null || tail -c 400 "$OUT"
rm -f "$OUT" "$OUT.err"
exit $CODE
