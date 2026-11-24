#!/usr/bin/env bash
# Which commit the night (the `schedule` run of .github/workflows/scenarios.yml) proves.
#
#   bash scenarios/night-proof.sh <github.sha> <folder>
#
# The night proves the newest first-parent commit of main, from <github.sha> back through the 50
# the run fetched, for which scenarios/stage-for-run.sh succeeds on its own rules (its own server
# image, or the ancestor rule when no image input changed). A commit merged minutes before the
# schedule has no image yet and stage-for-run.sh refuses it ("No server image ..."); the night then
# proves the next older commit instead of nothing. Nothing is loosened: stage-for-run.sh decides
# every commit alone. Any other failure (the public stage unreadable, a bad argument) stops here.
# Standard output: stage-for-run.sh's two lines (ref=, raw=), then proof=<the commit proved>.
# When it is not <github.sha>, one line says so in the run's summary ($GITHUB_STEP_SUMMARY).
# Seams: the ones of stage-for-run.sh (GODSPEED_SCENARIO_REPO, _IMAGES, _PUBLIC_RAW).
set -uo pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO=${GODSPEED_SCENARIO_REPO:-$(cd "$HERE/.." && pwd)}
[ $# -eq 2 ] || { echo "usage: bash scenarios/night-proof.sh <github.sha> <folder>" >&2; exit 2; }
head=$1 folder=$2
err=$(mktemp)
trap 'rm -f "$err"' EXIT
for c in $(git -C "$REPO" rev-list --first-parent -n 50 "$head"); do
  if out=$(bash "$HERE/stage-for-run.sh" '' "$c" "$folder" 2>"$err"); then
    cat "$err" >&2
    printf '%s\nproof=%s\n' "$out" "$c"
    if [ "$c" != "$head" ]; then
      echo "The night proves ${c:0:7}, the newest main commit whose server image exists; ${head:0:7} is proved by the next night." | tee -a "${GITHUB_STEP_SUMMARY:-/dev/null}" >&2
    fi
    exit 0
  fi
  cat "$err" >&2
  grep -q '^No server image ' "$err" || exit 1
done
echo "No commit in the newest 50 first-parent commits of $head can be proved on the Docker server." >&2
exit 1
