#!/usr/bin/env bash
# Run one standalone scenario and retain its exact verdict for the final collector.
set -u

id=${1:?usage: capture-scenario-result.sh <scenario> <stage ref>}
stage=${2:?usage: capture-scenario-result.sh <scenario> <stage ref>}
here=$(cd "$(dirname "$0")" && pwd)
results=${GODSPEED_SCENARIO_RESULTS:-${RUNNER_TEMP:-/tmp}/scenario-results}
verdict=${RUNNER_TEMP:-/tmp}/verdict
mkdir -p "$results"

set +e
GODSPEED_SCENARIO_RESULTS="$results" bash "$here/$id.sh" "$stage" | tee "$verdict"
status=${PIPESTATUS[0]}
set -e

if [ ! -s "$results/$id.txt" ]; then
  grep -E "^(PASS|FAIL) $id: .+" "$verdict" | tail -1 >"$results/$id.txt" ||
    printf 'FAIL %s: it stopped before its own verdict (its step log says how)\n' "$id" >"$results/$id.txt"
fi
exit "$status"
