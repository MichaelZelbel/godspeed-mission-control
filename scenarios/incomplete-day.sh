#!/usr/bin/env bash
# PROVING SCENARIO OF 2.0.0-beta.18: a day the phone has not finished is said to be unfinished.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.18-numbers-come-in, ticket 06 and the
# incomplete-day ticket, 02), on the Docker server install: a day whose last point is 19:55 (made-up
# numbers, never real health data). The morning briefing
#   (1) says the data stopped at 19:55,
#   (2) has no short-day wording for that day, and
#   (3) shows that day unknown in the weekly count of protein days.
# After a protein number is given by hand for that day, the next briefing counts it.
#
# THE WORDS. A briefing is written by a model, so the scenario judges what it can name: the time
# 19:55; a list of short-day phrases that must be absent; "unknown" wording on a line about protein
# for (3); and, once the number is given, that those lines no longer say unknown and name the number.
# A fixture limit: a model that words the unknown count in none of the phrases below fails (3) as a
# visible failure.
#
#   GODSPEED_SCENARIO_AI_KEY    the model that writes the briefing (without it: FAIL), with
#                               GODSPEED_SCENARIO_AI_URL and GODSPEED_SCENARIO_AI_MODEL.
#
#   bash scenarios/incomplete-day.sh candidate/2.0.0-beta.18
#   bash scenarios/incomplete-day.sh --check <folder>
#
# What it keeps for its checking part:
#   upload.json     the made-up upload (the day's last point is 19:55)
#   upload-code.txt what the receiver answered
#   brief-1.txt     the briefing written with the day unfinished
#   brief-2.txt     the briefing written after the protein number was given
#   given.txt       the number given by hand and the answer to it
SCENARIO=incomplete-day
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
# shellcheck source=scenarios/numbers-lib.sh
. "$HERE/numbers-lib.sh"
scenario_arguments "$@"

DAY=2026-11-03
NEXT=2026-11-04
PROTEIN=118
SHORT_DAY='short day|fell short|came up short|too little|ate (very )?little|under-?ate|under-?eating|low (intake|protein day)|missed (your )?(protein )?target'
UNKNOWN='unknown|not known|no data|unclear|cannot tell|can.t tell|could not tell|couldn.t tell|not (yet )?(measured|recorded|counted)|\?'

act() {
  need_the_ai_key "the briefing"
  fresh_evidence
  install_paths
  need_node
  server_install
  server_connects_the_model
  local token
  token=$(ingest_token)
  upload_body "$(metric step_count count "$(pt "$DAY 08:00:00 +0100" 1500),$(pt "$DAY 12:00:00 +0100" 3000),$(pt "$DAY 19:55:00 +0100" 500)"),$(metric active_energy kcal "$(pt "$DAY 12:00:00 +0100" 250),$(pt "$DAY 19:55:00 +0100" 90)")" '' >"$EVIDENCE/upload.json"
  printf '%s\n' "$(upload "$token" "$EVIDENCE/upload.json")" >"$EVIDENCE/upload-code.txt"
  server_clock_at "${NEXT}T07:00:00Z"
  phase 'the briefing, with the day unfinished'
  server_brief "$EVIDENCE/brief-1.txt" 600
  sed 's/^/  | /' "$EVIDENCE/brief-1.txt" >&2
  phase 'a protein number given by hand for that day'
  printf '{"type":"health-add","metric":"protein_g","value":%s,"unit":"g","observed_at":"%sT12:00:00Z"}' "$PROTEIN" "$DAY" >"$EVIDENCE/.give.json"
  { server_post /api/functions/personal-operation "$EVIDENCE/.give.json" "$EVIDENCE/.give.answer"; echo; cat "$EVIDENCE/.give.answer"; } >"$EVIDENCE/given.txt"
  phase 'the next briefing'
  server_brief "$EVIDENCE/brief-2.txt" 600
  sed 's/^/  | /' "$EVIDENCE/brief-2.txt" >&2
  rm -f "$EVIDENCE"/.[a-z]*
}

folded() { tr -s '[:space:]' ' ' <"$1"; }
# the weekly protein count: the briefing line that speaks of protein and of the week and gives an "N of N" count
protein_lines() { grep -i 'protein' "$1" | grep -i 'week' | grep -Ei '[0-9]+ of [0-9]+' || true; }

check() { # <evidence folder>
  local folder=$1
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of an unfinished day"
  kept_all "$folder" 'what the briefings said' upload.json upload-code.txt brief-1.txt brief-2.txt given.txt
  [ "$(tr -d '[:space:]' <"$folder/upload-code.txt")" = 200 ] ||
    fail "the receiver did not take the day's upload (it answered $(tr -d '[:space:]' <"$folder/upload-code.txt"))"
  grep -q '19:55' "$folder/upload.json" || fail "the upload this scenario made does not end at 19:55"

  folded "$folder/brief-1.txt" | grep -qF '19:55' ||
    fail "the briefing for a day whose last point is 19:55 never says the data stopped at 19:55: $(folded "$folder/brief-1.txt" | cut -c1-240)"
  if folded "$folder/brief-1.txt" | grep -Eiq "$SHORT_DAY"; then
    fail "the briefing called the unfinished day short: \"$(folded "$folder/brief-1.txt" | grep -Eio ".{0,50}($SHORT_DAY).{0,50}" | head -n 1)\""
  fi
  protein_lines "$folder/brief-1.txt" | grep -Eiq "$UNKNOWN" ||
    fail "the weekly protein count in the briefing does not show the unfinished day as unknown: $(protein_lines "$folder/brief-1.txt" | head -n 2 | cut -c1-240)"

  [ "$(head -n 1 "$folder/given.txt" | tr -d '[:space:]')" = 200 ] && ! grep -qi 'error' "$folder/given.txt" ||
    fail "the protein number given by hand was refused: $(tr -d '\n' <"$folder/given.txt" | cut -c1-200)"
  protein_lines "$folder/brief-2.txt" | grep -q . ||
    fail "the briefing after the protein number was given gives no weekly protein count"
  if protein_lines "$folder/brief-2.txt" | grep -Eiq "$UNKNOWN"; then
    fail "the briefing after the protein number was given still shows the day as unknown: $(protein_lines "$folder/brief-2.txt" | grep -Ei "$UNKNOWN" | head -n 1 | cut -c1-240)"
  fi
  folded "$folder/brief-2.txt" | grep -qF "$PROTEIN" ||
    fail "the briefing after the protein number was given never names the $PROTEIN g that was given: $(folded "$folder/brief-2.txt" | cut -c1-240)"
  pass "a day whose last point is 19:55 was briefed as stopping at 19:55, with no short-day wording and the protein count unknown; after $PROTEIN g was given by hand the next briefing counted it"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  need_node
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
