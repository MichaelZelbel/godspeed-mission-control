#!/usr/bin/env bash
# Usage: free-first.sh <the scenario command and its arguments>
# On a pull request the chat AI costs real money 880 times a month, so the scenario first runs with
# the free model GODSPEED_SCENARIO_AI_FREE_MODEL (the workflow sets it on pull requests only, and
# never on a night or a candidate's stage). A PASS on the free model stands. Anything else, for any
# reason (a rate limit, a tool-call error, wrong behaviour), runs the same scenario once more with
# the paid model GODSPEED_SCENARIO_AI_MODEL, and that run's verdict is the verdict. So the free
# model can never fail a pull request; only the paid model can.
set -u
[ $# -gt 0 ] || { echo "usage: free-first.sh <command...>" >&2; exit 2; }
free=${GODSPEED_SCENARIO_AI_FREE_MODEL:-}
if [ -z "$free" ] || [ -z "${GODSPEED_SCENARIO_AI_KEY:-}" ]; then
  exec "$@"
fi
tmp=$(mktemp -d)
echo "free-first: trying with the free model $free (the paid model $GODSPEED_SCENARIO_AI_MODEL runs only if it fails)" >&2
rc=0
GODSPEED_SCENARIO_AI_MODEL=$free GITHUB_STEP_SUMMARY=$tmp/summary \
  GODSPEED_SCENARIO_RESULTS=$tmp/results "$@" >"$tmp/out" || rc=$?
if [ "$rc" -eq 0 ] && grep -q '^PASS ' "$tmp/out"; then
  cat "$tmp/out"
  [ -z "${GITHUB_STEP_SUMMARY:-}" ] || [ ! -f "$tmp/summary" ] || cat "$tmp/summary" >>"$GITHUB_STEP_SUMMARY"
  if [ -n "${GODSPEED_SCENARIO_RESULTS:-}" ] && [ -d "$tmp/results" ]; then
    mkdir -p "$GODSPEED_SCENARIO_RESULTS" && cp -f "$tmp/results"/* "$GODSPEED_SCENARIO_RESULTS"/ 2>/dev/null
  fi
  echo "free-first: PASSED on the free model $free; the paid model was not used" >&2
  rm -rf "$tmp"
  exit 0
fi
# what the free try said stays in the log, but never as a line that reads like a verdict
sed 's/^/free-model attempt: /' "$tmp/out" >&2
echo "free-first: the free model $free did not pass (exit $rc); rerunning once with the paid model $GODSPEED_SCENARIO_AI_MODEL, whose verdict is the verdict" >&2
rm -rf "$tmp"
"$@"
