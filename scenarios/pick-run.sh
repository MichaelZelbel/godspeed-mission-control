#!/usr/bin/env bash
# Which scenario jobs a run that is not a pull request runs: the one place that decides it.
#
# The workflow's job `stage` calls this and writes what it prints ("picked=...") to its output; the
# tests call it too. Which jobs hold up a release is data, scenarios/scenario-gate.tsv:
# `release` for what people do first and most, `weekly` for the rest.
#
# Inputs, all environment: EVENT (github.event_name), STAGE_INPUT (the stage input), ONLY (the jobs
# named by hand), ALL ('true' runs every job), MAC ('true' adds the Mac install), GATE (default:
# the file beside this script), GITHUB_STEP_SUMMARY (optional).
#
#   by hand with `only`                      exactly those jobs (names checked here)
#   `all` true                               every job (the weekly run)
#   the night (schedule), or a stage given   the release gate: the `release` rows, leaving
#                                            out the candidate-only ones, which come back when the run
#                                            is theirs (Mac with MAC=true, Windows on a candidate/ stage)
#   any other hand-started run               every job, as before
# A stage with no scenario-gate.tsv (an old one) picks every job rather than none.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
gate=${GATE:-$here/scenario-gate.tsv}
summary=${GITHUB_STEP_SUMMARY:-/dev/null}
event=${EVENT:-${GITHUB_EVENT_NAME:-}}
stage=${STAGE_INPUT:-}
only=$(printf '%s' "${ONLY:-}" | tr -d ' \t\r\n')

say() { printf '%s\n' "$1" | tee -a "$summary" >&2; }

if [ "$event" = workflow_dispatch ] && [ -n "$only" ]; then
  [[ "$only" =~ ^[a-z0-9,-]*[a-z0-9-][a-z0-9,-]*$ ]] || { say "only must be job names separated by commas, not: $only"; exit 1; }
  picked=$(printf ',%s,' "$only" | tr -s ',')
  say "Only these jobs run:$picked"
  echo "picked=$picked"
  exit 0
fi

if [ "${ALL:-}" = true ] && [ "$event" = workflow_dispatch ]; then
  say "Every job runs (all was asked for)."
  echo "picked=all"
  exit 0
fi

if [ "$event" = schedule ] || { [ "$event" = workflow_dispatch ] && [ -n "$stage" ]; }; then
  if [ ! -f "$gate" ]; then
    say "There is no scenario-gate.tsv in this stage, so every job runs."
    echo "picked=all"
    exit 0
  fi
  # The Mac and Windows jobs are the release gate's candidate-only members: Mac when asked for (MAC),
  # Windows on a candidate's tag; a night never has either.
  picked=$(awk -F '\t' -v mac="${MAC:-}" -v stage="$stage" '
    /^#/ || NF < 2 { next }
    $2 != "release" { next }
    $1 == "mac-install" && mac != "true" { next }
    $1 == "windows-old-names-move" && stage !~ /^candidate\// { next }
    { printf ",%s", $1 }
    END { print "," }' "$gate")
  say "The release gate runs (the everyday tests that can hold up a release):$picked"
  echo "picked=$picked"
  exit 0
fi

echo "picked=all"
