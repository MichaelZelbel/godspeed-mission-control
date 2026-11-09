#!/usr/bin/env bash
# Select the standalone scenario jobs a pull request must prove.
set -eu

changed=${1:?usage: pick-scenarios.sh <changed-files> [catalog]}
here=$(cd "$(dirname "$0")" && pwd)
catalog=${2:-$here/scenario-catalog.tsv}

# These files define every pooled scenario's setup, result, or selection contract.  The PR route
# has one standalone job per script, so changes here prove every script-backed scenario together.
for shared in \
  .github/workflows/scenarios.yml \
  .github/workflow-drafts/scenarios.yml \
  scenarios/capture-scenario-result.sh \
  scenarios/pick-scenarios.sh \
  scenarios/run-installed-scenarios.sh \
  scenarios/scenario-catalog.tsv \
  scenarios/scenario-lib.sh \
  scenarios/scenario-verdict.mjs \
  scenarios/server-lib.sh; do
  if grep -Fqx "$shared" "$changed"; then
    awk -F '\t' 'NR > 1 && $2 ~ /\.sh$/ { printf ",%s", $1 } END { print "," }' "$catalog"
    exit 0
  fi
done

jobs=$(awk -F '\t' 'NR > 1 && $2 ~ /\.sh$/ { sub(/\.sh$/, "", $2); print $2 }' "$catalog")
picked=,
for job in $jobs; do
  if grep -qE "^scenarios/$job(\\.sh|-[^/]*)$" "$changed"; then picked="$picked$job,"; fi
done
printf '%s\n' "$picked"
