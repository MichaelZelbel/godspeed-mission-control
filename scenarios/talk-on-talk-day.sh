#!/usr/bin/env bash
# PROVING SCENARIO OF 2.0.0-beta.18: a talk asked for on a talk day opens that day's prepared talk.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.18-numbers-come-in, ticket 06 and issue
# #216, ticket 05; found by talk-prep-honest on 4 November 2026): a fixture person with a weekly
# health area. Last week's talk was opened and never answered. This week's preparation is sealed and
# ready. "Let us have my health talk now" in the notebook's chat
#   (1) opens this week's talk from its preparation (the preparation's opening, word for word),
#   (2) names last week's talk in one sentence, and
#   (3) leaves last week's talk closed as not held (its record kept).
#
# DETERMINISTIC, AS talk-prep-honest IS: the preparation, the writer's and the reviewer's run records
# are fixtures, the real `godspeed-coach prep-receipts` and `prep-seal` seal them, and only the
# opening the model writes in the chat is the model's. Last week's talk is not closed by the
# scenario: closing it is what is being proved. The second talk day is reached with the notebook's
# own frozen clock (GODSPEED_NOW), as talk-prep-honest and charm-challenge do.
#
#   GODSPEED_SCENARIO_AI_KEY    the model that opens the talk (without it: FAIL), with
#                               GODSPEED_SCENARIO_AI_URL and GODSPEED_SCENARIO_AI_MODEL.
#
#   bash scenarios/talk-on-talk-day.sh candidate/2.0.0-beta.18
#   bash scenarios/talk-on-talk-day.sh --check <folder>
#
# What it keeps for its checking part:
#   days.txt          last week's talk day (old) and this week's (new)
#   prep-new.md       this week's preparation, check-new.txt what the installed gate said of it
#   opening-old.txt   the reply to the request last week
#   opening-new.txt   the reply to the request this week
#   talk-old.md       last week's talk record as it was before this week's request
#   talk-old-after.md last week's talk record afterwards
#   talk-new.md       this week's talk record
SCENARIO=talk-on-talk-day
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
# shellcheck source=scenarios/numbers-lib.sh
. "$HERE/numbers-lib.sh"
scenario_arguments "$@"

ASK='Let us have my health talk now.'
URL_1=https://example.org/trials/statin-alternatives
URL_2=https://example.org/reviews/sleep-extension
OPENING='Good evening. Tonight: your LDL result, the half hour of sleep, and the one thing I would try this week.'

# shellcheck disable=SC2317,SC2329  # asked by wait_for
notebook_answers() { curl -fsS "http://127.0.0.1:$NOTEBOOK_PORT/health" >/dev/null 2>&1; }
settings_connects_the_model() {
  local body=$EVIDENCE/.provider.json
  printf '{"url":%s,"key":%s,"model":%s,"routines":true}\n' \
    "$(quoted_json "$AI_URL")" "$(quoted_json "$GODSPEED_SCENARIO_AI_KEY")" "$(quoted_json "$AI_MODEL")" >"$EVIDENCE/.provider-ask.json"
  [ "$(curl -sS -o "$body" -w '%{http_code}' --max-time 300 -X POST -H 'Content-Type: application/json' \
    --data-binary @"$EVIDENCE/.provider-ask.json" "http://127.0.0.1:$NOTEBOOK_PORT/api/provider")" = 200 ] ||
    { print_kept_diagnosis "${STATE:-}" "${HERMES:-}"; fail "Settings refused the model $AI_MODEL at $AI_URL: $(tr -d '\n' <"$body" | cut -c1-200)"; }
}

# ---------------------------------------------------------------------------------- the fixtures
# The same run record, preparation and review answer as talk-prep-honest's, with every goal covered.
TRANSCRIPT_WRITER='
const fs=require("fs"),path=require("path");
const [file,session,marker,startIso,...urls]=process.argv.slice(1);
const t0=Date.parse(startIso),at=s=>new Date(t0+s*1000).toISOString();
const lines=[{type:"user",sessionId:session,timestamp:at(0),message:{role:"user",content:"Run for the health talk.\nRUN MARKER: "+marker}}];
urls.forEach((u,i)=>{const id="toolu_"+session+"_"+i;
 lines.push({type:"assistant",sessionId:session,timestamp:at(20+i*30),message:{role:"assistant",content:[{type:"tool_use",id,name:"WebFetch",input:{url:u}}]}});
 lines.push({type:"user",sessionId:session,timestamp:at(30+i*30),toolUseResult:{code:200,url:u},message:{role:"user",content:[{type:"tool_result",tool_use_id:id,content:"The text of "+u+": a fixture page with the findings the preparation cites.",is_error:false}]}});});
lines.push({type:"assistant",sessionId:session,timestamp:at(60+urls.length*30),message:{role:"assistant",content:[{type:"text",text:"Done."}]}});
fs.mkdirSync(path.dirname(file),{recursive:true});
fs.writeFileSync(file,lines.map(l=>JSON.stringify(l)).join("\n")+"\n");
'
ago() { date -u -d "$1 minutes ago" +%Y-%m-%dT%H:%M:%SZ; }
random_marker() { printf '%s-%s' "$1" "$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')"; }

write_area() { # <weekday, lower case>
  mkdir -p "$ROOT/coach/health" "$ROOT/goals"
  printf 'GOAL: lower-ldl\nTITLE: Lower my LDL cholesterol\nSTATUS: adopted\n' >"$ROOT/goals/lower-ldl.md"
  printf 'GOAL: sleep-better\nTITLE: Sleep seven hours most nights\nSTATUS: adopted\n' >"$ROOT/goals/sleep-better.md"
  {
    printf 'AREA: health\nTITLE: Health\nRHYTHM: weekly %s\nTIME: 19:00\nSTARTS: %s\nSTATUS: on\nSTYLE: compass\nTONE: gentle\n' "$1" "$(day_in -9)"
    printf 'SERVES: lower-ldl, sleep-better\n'
    printf 'LIMIT: never diagnose and never tell them to buy or book anything\n'
    printf 'RESEARCH DOMAIN: blood-lipids | LDL and the routes that lower it\n'
    printf 'RESEARCH DOMAIN: sleep | How much sleep helps, and what only feels like it\n'
    printf '\n## Preparation\n\nRead the goals, the health data and the last talk, then prepare the talk.\n'
  } >"$ROOT/coach/health/area.md"
}
write_prep() { # <file> <talk day> <prepared at>
  local file=$1 day=$2 n goal url
  mkdir -p "$(dirname "$file")"
  {
    printf 'AREA: health\nTALK: %s 19:00\nPREPARED: %s\nSTATE: ready\n\n## The opening\n\n%s\n\n' "$day" "$3" "$OPENING"
    printf '## Talk card\n\n- Open with the LDL result.\n- Sleep: the extra half hour.\n\n## Where they stand\n\nLDL is above target; sleep is five and a half hours on workdays.\n\n'
    printf '## What changed since the last talk\n\nThey ate the planned breakfast four days out of seven.\n\n## The world this week\n\nA recent review compares routes for lowering LDL.\n\n## Opportunities\n\nOne route per goal.\n\n## Routes\n\n'
    for n in 1 2; do
      goal=$(printf 'lower-ldl sleep-better' | cut -d' ' -f"$n")
      eval "url=\$URL_$n"
      printf '### Route %s: the best route for %s\n- Goal: %s\n- Source: %s\n- Published: 2025-09-1%s\n- Read: %s\n- Studied: 412 adults, 12 weeks\n' "$n" "$goal" "$goal" "$url" "$n" "$day"
      printf -- '- Effect: about 8 percent against the control group\n- Limits: short trial\n- Contrary evidence: one larger trial found a smaller effect\n- Fit to this person: matches their evenings\n- Cost or burden: about 20 minutes a day\n- Experiment: try it for two weeks\n\n'
    done
    printf '## Rejected routes\n\n- A trending supplement: one small trial, so not suggested.\n\n## What I think\n\nStart with the route for LDL.\n\n## Gaps\n\nNo recent blood test.\n\n## Cut, and why\n\nA long section on supplements: unsupported.\n\n## Research coverage\n\nblood-lipids and sleep are covered by the routes above.\n'
  } >"$file"
}
write_review_answer() { # <file>
  cat >"$1" <<JSON
{"verdict":"pass","coverage":[
{"id":"blood-lipids","verdict":"pass","reason":"The route is supported by the trial it reads.","sources":["$URL_1"]},
{"id":"sleep","verdict":"pass","reason":"The sleep route cites the review.","sources":["$URL_2"]},
{"id":"lower-ldl","verdict":"pass","reason":"A route, its effect and an experiment for LDL.","sources":["$URL_1"]},
{"id":"sleep-better","verdict":"pass","reason":"A route, its effect and an experiment for sleep.","sources":["$URL_2"]}],
"issues":[]}
JSON
}
coach() { # <arguments...>: the installed coach, at the notebook's own clock when it has been moved
  env ${NOW:+GODSPEED_NOW="$NOW"} CLAUDE_CONFIG_DIR="$CLAUDE_CONFIG_DIR" "$NODE" "$COACH" "$@" --godspeed "$ROOT"
}
# One sealed preparation, as the real commands make it. <label> <talk day>
prepare_and_review() {
  local label=$1 day=$2 prep out w_start w_end r_start r_end w_marker r_marker answer
  prep=$ROOT/coach/health/prep/$day.md
  w_start=$(ago 30); w_end=$(ago 20); r_start=$(ago 15); r_end=$(ago 10)
  w_marker=$(random_marker gs-prep); r_marker=$(random_marker gs-review)
  write_prep "$prep" "$day" "$(ago 25)"
  "$NODE" -e "$TRANSCRIPT_WRITER" "$CLAUDE_CONFIG_DIR/projects/scenario/writer-$label.jsonl" "writer-$label" "$w_marker" "$w_start" "$URL_1" "$URL_2"
  "$NODE" -e "$TRANSCRIPT_WRITER" "$CLAUDE_CONFIG_DIR/projects/scenario/reviewer-$label.jsonl" "reviewer-$label" "$r_marker" "$r_start"
  out=$ROOT/coach/health/prep/$day
  coach prep-receipts health --date "$day" --marker "$w_marker" --started "$w_start" --finished "$w_end" --out "$out.evidence.json" \
    >"$EVIDENCE/.receipts-$label.txt" 2>&1 ||
    fail "the coach's own prep-receipts could not write the evidence of the $label preparation: $(tr '\n' ' ' <"$EVIDENCE/.receipts-$label.txt" | cut -c1-200)"
  answer=$EVIDENCE/.answer-$label.json
  write_review_answer "$answer"
  coach prep-seal health --date "$day" --evidence "$out.evidence.json" --answer "$answer" --marker "$r_marker" \
    --started "$r_start" --finished "$r_end" --out "$out.review.json" >"$EVIDENCE/.seal-$label.txt" 2>&1 ||
    fail "the coach's own seal refused the passing review of the $label preparation: $(tr '\n' ' ' <"$EVIDENCE/.seal-$label.txt" | cut -c1-200)"
  coach prep-check health --date "$day" >"$EVIDENCE/check-$label.txt" 2>&1 || true
  cp "$prep" "$EVIDENCE/prep-$label.md"
}

act() {
  need_the_ai_key "the talk the owner asks for"
  fresh_evidence
  install_paths
  install_the_stage_line "$EVIDENCE/.install.log"
  need_node
  wait_for 180 "the notebook to answer after the install" notebook_answers || fail "the notebook does not answer after the install"
  read_version "$ROOT"
  settings_connects_the_model
  assistant_home
  COACH=$(product_script "$ROOT" third-party/addons/godspeed-coach/bin/godspeed-coach.mjs)
  [ -f "$COACH" ] || fail "the installed version has no coach program at $COACH"
  CLAUDE_CONFIG_DIR=$EVIDENCE/claude-home
  NOW=''
  OLD=$(day_in +0)
  NEW=$(day_in +7)
  printf 'old=%s\nnew=%s\n' "$OLD" "$NEW" >"$EVIDENCE/days.txt"

  phase 'a fixture person: one weekly health area'
  write_area "$(date -u -d "$OLD" +%A | tr 'A-Z' 'a-z')"

  phase 'last week: a talk is asked for and never answered'
  prepare_and_review old "$OLD"
  chat_panel_new_conversation "$EVIDENCE/.panel-new-old.json"
  chat_panel_says "$ASK" "$EVIDENCE/opening-old.txt"
  cat "$ROOT/coach/health/talks/$OLD.md" >"$EVIDENCE/talk-old.md" 2>/dev/null || : >"$EVIDENCE/talk-old.md"

  phase 'this week: the talk day, its preparation sealed, last week'"'"'s talk still open'
  notebook_clock_at "$NEW"
  NOW=${NEW}T12:00:00Z
  prepare_and_review new "$NEW"
  chat_panel_new_conversation "$EVIDENCE/.panel-new-new.json"
  chat_panel_says "$ASK" "$EVIDENCE/opening-new.txt"
  cat "$ROOT/coach/health/talks/$NEW.md" >"$EVIDENCE/talk-new.md" 2>/dev/null || : >"$EVIDENCE/talk-new.md"
  cat "$ROOT/coach/health/talks/$OLD.md" >"$EVIDENCE/talk-old-after.md" 2>/dev/null || : >"$EVIDENCE/talk-old-after.md"
  rm -f "$EVIDENCE"/.[a-z]*
}

folded() { tr -s '[:space:]' ' ' <"$1"; }
section_of() { awk -v h="## $2" '$0==h{f=1;next} /^## /{f=0} f' "$1"; }

check() { # <evidence folder>
  local folder=$1 old new weekday opening sentences named
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of a talk on a talk day"
  kept_all "$folder" 'what the two requests opened' days.txt prep-new.md check-new.txt opening-old.txt opening-new.txt talk-old.md
  [ -f "$folder/talk-new.md" ] && [ -f "$folder/talk-old-after.md" ] || fail "talk-new.md or talk-old-after.md is not in what the scenario kept"
  old=$(sed -n 's/^old=//p' "$folder/days.txt")
  new=$(sed -n 's/^new=//p' "$folder/days.txt")
  [ -n "$old" ] && [ -n "$new" ] || fail "days.txt does not say which two talk days this scenario worked on"

  # The setting: last week's talk is open and unanswered, and this week's preparation is ready.
  [ -s "$folder/talk-old.md" ] || fail "no talk of $old was opened when the owner asked for it last week, so there is no open talk to meet this week"
  grep -q '^ready' "$folder/check-new.txt" ||
    fail "the installed gate does not call this week's sealed preparation ready: $(tr '\n' ' ' <"$folder/check-new.txt" | cut -c1-200)"

  # (1) This week's request opened this week's talk from its preparation.
  [ -s "$folder/talk-new.md" ] ||
    fail "the request on the talk day $new opened no talk of $new (it continued last week's): $(folded "$folder/opening-new.txt" | cut -c1-200)"
  opening=$(section_of "$folder/prep-new.md" 'The opening' | tr -s '[:space:]' ' ' | sed 's/^ //;s/ $//')
  folded "$folder/opening-new.txt" | grep -qF -- "$opening" ||
    fail "the talk of $new did not open with the preparation's opening (\"$opening\"): $(folded "$folder/opening-new.txt" | cut -c1-240)"
  section_of "$folder/talk-new.md" 'The opening' | tr -s '[:space:]' ' ' | grep -qF -- "$opening" ||
    fail "the talk record of $new does not hold the preparation's opening"

  # (2) Last week's talk is named, once, in one sentence that says it is still open or was not held.
  # A bare weekday is not a name: the talk day falls on the same weekday, so "Today is Tuesday" would pass.
  weekday=$(date -u -d "$old" +%A)
  sentences=$(folded "$folder/opening-new.txt" | sed 's/\([.!?]\) /\1\n/g')
  named=$(printf '%s\n' "$sentences" | grep -Ei "($old|last $weekday|last week)" || true)
  [ -n "$named" ] ||
    fail "the opening never names last week's talk ($old, or \"last $weekday\"): $(folded "$folder/opening-new.txt" | cut -c1-240)"
  [ "$(printf '%s\n' "$named" | grep -c .)" = 1 ] ||
    fail "the opening names last week's talk more than once: $(folded "$folder/opening-new.txt" | cut -c1-240)"
  printf '%s\n' "$named" | grep -Eiq 'still open|not held|never held|was not held|still waiting' ||
    fail "the opening names last week's talk without saying it is still open or was not held: $(folded "$folder/opening-new.txt" | cut -c1-240)"

  # (3) Last week's talk is closed as not held, and its record is kept.
  [ -s "$folder/talk-old-after.md" ] || fail "last week's talk record ($old) is gone"
  grep -Eq '^STATE: opened$' "$folder/talk-old.md" ||
    fail "last week's talk ($old) was not open and unanswered before this week's request: $(grep -E '^STATE:' "$folder/talk-old.md" | head -1)"
  talk_answered "$folder/talk-old.md" &&
    fail "last week's talk ($old) was answered before this week's request, so it was not an open talk"
  grep -Eq '^STATE: not-held\r?$' "$folder/talk-old-after.md" ||
    fail "last week's talk ($old) was not closed as not held by this week's request"
  pass "on the talk day $new, with the talk of $old still open and unanswered, \"$ASK\" opened this week's talk from its sealed preparation, named last week's once, and left it closed as not held with its record kept"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  need_node
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
