#!/usr/bin/env bash
# Select the standalone scenario jobs a pull request must prove.
set -eu

changed=${1:?usage: pick-scenarios.sh <changed-files> [catalog]}
here=$(cd "$(dirname "$0")" && pwd)
catalog=${2:-$here/scenario-catalog.tsv}

# The workflow controls the complete standalone-job set.
for shared in .github/workflows/scenarios.yml .github/workflow-drafts/scenarios.yml; do
  if grep -Fqx "$shared" "$changed"; then
    awk -F '\t' 'NR > 1 && $2 ~ /\.sh$/ { printf ",%s", $1 } END { print "," }' "$catalog"
    exit 0
  fi
done

jobs=$(awk -F '\t' 'NR > 1 && $2 ~ /\.sh$/ { sub(/\.sh$/, "", $2); print $2 }' "$catalog")

all_scripts() {
  awk -F '\t' 'NR > 1 && $2 ~ /\.sh$/ { printf ",%s", $1 } END { print "," }' "$catalog"
}

# A scenario script and its name-prefixed companion belong only to that scenario.  Every other
# file in scenarios/ is shared support code: its callers are not encoded in the catalog, so prove
# all standalone scenarios rather than silently omitting a helper's dependents.
while IFS= read -r path; do
  case $path in
    scenarios/*)
      owned=false
      for job in $jobs; do
        if [[ $path =~ ^scenarios/$job(\.sh|-[^/]*)$ ]]; then
          owned=true
          break
        fi
      done
      if [ "$owned" = false ]; then
        all_scripts
        exit 0
      fi
      ;;
  esac
done < "$changed"

picked=,
for job in $jobs; do
  if grep -qE "^scenarios/$job(\\.sh|-[^/]*)$" "$changed"; then picked="$picked$job,"; fi
done
printf '%s\n' "$picked"
