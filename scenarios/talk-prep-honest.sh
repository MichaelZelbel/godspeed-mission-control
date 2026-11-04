#!/usr/bin/env bash
# PROVING SCENARIO OF 2.0.0-beta.16: a talk that is not fully prepared says so, and never claims
# research it cannot show; a talk that is, opens from its preparation.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.16-prepared-talks/plan.md, "Proving
# scenarios" 4, tickets 04 and 05 of that release, product issue #135): a fixture person with one
# health area that serves three goals and names research domains (RESEARCH DOMAIN: lines).
#   (a) A preparation whose review leaves one goal uncovered. The installed coach does not open the
#       talk from it: its brief carries the one sentence naming what is missing, the owner asks for
#       the talk in the notebook's chat, and the opening says that sentence word for word and no
#       line of it claims a research duration (nor uses the refused preparation's words).
#   (b) A preparation that covers all three goals, with every route recorded in full, and a
#       passing review sealed by the real seal. The installed gate says ready and the talk the
#       owner asks for opens from the preparation's opening.
#
# DETERMINISTIC ON PURPOSE. The ticket allows seeding a sealed review made by the real seal from a
# fixture record. So nothing here asks an AI whether a goal is covered: the preparation, the
# writer's run record and the reviewer's run record and answer are fixtures (a Claude Code
# transcript each, under a folder of this scenario's own named by CLAUDE_CONFIG_DIR), and the real
# `godspeed-coach prep-receipts` writes the evidence from the writer's record and the real
# `godspeed-coach prep-seal` seals the reviewer's answer (the commands ticket 04 adds). What is
# real: those two commands, the installed gate (`prep-check`), the installed brief, and the talk's
# opening, which is what the model writes in the notebook's chat after the coach's brief. The coach
# keeps an unanswered talk open for three days and continues an open talk of the same area, so (b)
# closes (a)'s talk first (`talk not-held`), as the coach does itself once a later talk exists; the
# opening of (b) is then proved from (b)'s own preparation. In (a) the
# failed review is sealed beside the preparation, so the coach's own reason is the second check.
# The second talk day is reached with the notebook's own frozen clock (GODSPEED_NOW), as
# charm-challenge does.
#
#   GODSPEED_SCENARIO_AI_KEY    the model that opens the talk (without it: FAIL), with
#                               GODSPEED_SCENARIO_AI_URL and GODSPEED_SCENARIO_AI_MODEL.
#
#   bash scenarios/talk-prep-honest.sh candidate/2.0.0-beta.16
#   bash scenarios/talk-prep-honest.sh --check <folder>
#
# What it keeps for its checking part:
#   days.txt             the two talk days (a, b) and the machine's own clock offset
#   area.md              the health area as the coach read it (three goals, three research domains)
#   prep-a.md / prep-b.md  the two preparations
#   review-a.json / review-b.json / evidence-b.json   the sidecars the real commands wrote
#   seal-a.txt / seal-a.code / seal-b.txt / seal-b.code   what the seal said, and its exit code
#   check-a.txt / check-b.txt   what the installed gate said of each preparation
#   brief-a.txt          the coach's brief for the talk of (a)
#   close-a.txt          what the coach printed when (a)'s talk was closed before day B
#   block-b.txt          the coach's scheduled block on day B, before the owner asked for the talk
#   opening-a.txt / opening-b.txt   the reply the owner got when they asked for the talk
#   talk-a.md / talk-b.md           the talk records the coach holds afterwards
# shellcheck disable=SC2034  # read by scenario-lib.sh, which this file sources
SCENARIO=talk-prep-honest
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"

ASK='Let us have my health talk now.'
GOALS='lower-ldl sleep-better visible-abs'
URL_1=https://example.org/trials/statin-alternatives
URL_2=https://example.org/reviews/sleep-extension
URL_3=https://example.org/guidance/body-composition

# shellcheck disable=SC2317,SC2329  # asked by wait_for, which takes the command to try as its arguments
notebook_answers() { curl -fsS "http://127.0.0.1:$NOTEBOOK_PORT/health" >/dev/null 2>&1; }

settings_connects_the_model() {
  local body=$EVIDENCE/.provider.json code request=$EVIDENCE/.provider-ask.json
  printf '{"url":%s,"key":%s,"model":%s,"routines":true}\n' \
    "$(quoted_json "$AI_URL")" "$(quoted_json "$GODSPEED_SCENARIO_AI_KEY")" "$(quoted_json "$AI_MODEL")" >"$request"
  code=$(curl -sS -o "$body" -w '%{http_code}' --max-time 300 -X POST \
    -H 'Content-Type: application/json' --data-binary @"$request" \
    "http://127.0.0.1:$NOTEBOOK_PORT/api/provider") ||
    fail "Settings could not be reached to connect a model, so there is nobody to open the talk"
  if [ "$code" != 200 ]; then
    print_kept_diagnosis "${STATE:-}" "${HERMES:-}"
    fail "Settings refused the model $AI_MODEL at $AI_URL with HTTP $code: $(tr -d '\n' <"$body" | cut -c1-200)"
  fi
  say "The chat thinks with $AI_MODEL at $AI_URL"
}

# ---------------------------------------------------------------------------------- the fixtures
# A run record the way Claude Code keeps one: a JSON line per message, the prompt naming the run's
# marker, and for each page a WebFetch call and its successful result, all inside the run's time.
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

write_area() {
  mkdir -p "$ROOT/coach/health" "$ROOT/goals"
  printf 'GOAL: lower-ldl\nTITLE: Lower my LDL cholesterol\nSTATUS: adopted\n' >"$ROOT/goals/lower-ldl.md"
  printf 'GOAL: sleep-better\nTITLE: Sleep seven hours most nights\nSTATUS: adopted\n' >"$ROOT/goals/sleep-better.md"
  printf 'GOAL: visible-abs\nTITLE: Visible abs by the summer\nSTATUS: adopted\n' >"$ROOT/goals/visible-abs.md"
  {
    printf 'AREA: health\nTITLE: Health\nRHYTHM: daily\nTIME: 19:00\nSTARTS: %s\nSTATUS: on\nSTYLE: compass\nTONE: gentle\n' "$(day_in -2)"
    printf 'SERVES: lower-ldl, sleep-better, visible-abs\n'
    printf 'LIMIT: never diagnose and never tell them to buy or book anything\n'
    printf 'RESEARCH DOMAIN: blood-lipids | LDL and the routes that lower it: food, movement, supplements, medicines they could ask about\n'
    printf 'RESEARCH DOMAIN: sleep | How much sleep helps, what extends it, and what only feels like it\n'
    printf 'RESEARCH DOMAIN: body-composition | Fat loss and muscle, including what makes abs visible\n'
    printf '\n## Preparation\n\nRead the goals, the health data and the last talk, then prepare the talk.\n'
  } >"$ROOT/coach/health/area.md"
}

# A preparation of the coach's shape. <file> <talk day> <prepared at> <routes: 2 or 3> <opening text>
write_prep() {
  local file=$1 day=$2 prepared=$3 routes=$4 opening=$5 n goal url
  mkdir -p "$(dirname "$file")"
  {
    printf 'AREA: health\nTALK: %s 19:00\nPREPARED: %s\nSTATE: ready\n\n' "$day" "$prepared"
    printf '## The opening\n\n%s\n\n' "$opening"
    printf '## Talk card\n\n- Open with the LDL result and one thing to try this week.\n- Sleep: the extra half hour.\n- Abs: what the next twelve weeks need.\n\n'
    printf '## Where they stand\n\nLDL is above target, sleep is five and a half hours on workdays, and body fat has not moved in a month.\n\n'
    printf '## What changed since the last talk\n\nThey ate the planned breakfast four days out of seven and slept better on two nights.\n\n'
    printf '## The world this week\n\nA recent review compares routes for lowering LDL; guidance on sleep extension was updated.\n\n'
    printf '## Opportunities\n\nOne route per goal, each with a small experiment.\n\n'
    printf '## Routes\n\n'
    for n in $(seq 1 "$routes"); do
      goal=$(printf '%s' "$GOALS" | cut -d' ' -f"$n")
      eval "url=\$URL_$n"
      printf '### Route %s: the best route for %s\n' "$n" "$goal"
      printf -- '- Goal: %s\n- Source: %s\n- Published: 2025-09-1%s\n- Read: %s\n- Studied: 412 adults, 12 weeks\n' "$goal" "$url" "$n" "$day"
      printf -- '- Effect: a measured change of about 8 percent against the control group\n- Limits: short trial, mostly men under 55\n'
      printf -- '- Contrary evidence: one larger trial found a smaller effect\n- Fit to this person: matches their data and their evenings\n'
      printf -- '- Cost or burden: about 20 minutes a day, no cost\n- Experiment: try it for two weeks and compare the numbers\n\n'
    done
    printf '## Rejected routes\n\n- A trending supplement: one small trial, no replication, so not suggested.\n\n'
    printf '## What I think\n\nStart with the route for LDL, keep the sleep change, and leave the rest.\n\n'
    printf '## Gaps\n\nNo recent blood test beyond the last one.\n\n'
    printf '## Cut, and why\n\nA long section on supplements: unsupported.\n\n'
    printf '## Research coverage\n\nblood-lipids, sleep and body-composition are each covered by the routes above.\n'
  } >"$file"
}

# The reviewer's answer. <file> <pass|fail> : in a failing one the goal visible-abs is not covered.
write_review_answer() {
  local file=$1 verdict=$2
  if [ "$verdict" = pass ]; then
    cat >"$file" <<JSON
{"verdict":"pass","coverage":[
{"id":"blood-lipids","verdict":"pass","reason":"The route is supported by the trial it reads and the contrary result is weighed.","sources":["$URL_1"]},
{"id":"sleep","verdict":"pass","reason":"The sleep route cites the review and its limits.","sources":["$URL_2"]},
{"id":"body-composition","verdict":"pass","reason":"The body composition route cites the guidance.","sources":["$URL_3"]},
{"id":"lower-ldl","verdict":"pass","reason":"A route, its effect and an experiment for LDL.","sources":["$URL_1"]},
{"id":"sleep-better","verdict":"pass","reason":"A route, its effect and an experiment for sleep.","sources":["$URL_2"]},
{"id":"visible-abs","verdict":"pass","reason":"A route, its effect and an experiment for visible abs, with adjacent evidence weighed.","sources":["$URL_3"]}],
"issues":[]}
JSON
  else
    cat >"$file" <<JSON
{"verdict":"fail","coverage":[
{"id":"blood-lipids","verdict":"pass","reason":"The route is supported by the trial it reads.","sources":["$URL_1"]},
{"id":"sleep","verdict":"pass","reason":"The sleep route cites the review.","sources":["$URL_2"]},
{"id":"body-composition","verdict":"fail","reason":"No route weighs what makes abs visible.","sources":[]},
{"id":"lower-ldl","verdict":"pass","reason":"A route and an experiment for LDL.","sources":["$URL_1"]},
{"id":"sleep-better","verdict":"pass","reason":"A route and an experiment for sleep.","sources":["$URL_2"]},
{"id":"visible-abs","verdict":"fail","reason":"The preparation has no route for this goal at all.","sources":[]}],
"issues":["visible-abs: no route is weighed for this goal; resolve it with evidence, not new wording"]}
JSON
  fi
}

# One preparation, receipts and review, as the real commands make them. <label a|b> <talk day>
# <routes> <opening> <pass|fail> <urls...>   Leaves SEAL_CODE and the output of the seal in seal-<label>.txt.
prepare_and_review() {
  local label=$1 day=$2 routes=$3 opening=$4 verdict=$5 prep out w_start w_end r_start r_end w_marker r_marker answer
  shift 5
  prep=$ROOT/coach/health/prep/$day.md
  w_start=$(ago 30)
  w_end=$(ago 20)
  r_start=$(ago 15)
  r_end=$(ago 10)
  w_marker=$(random_marker gs-prep)
  r_marker=$(random_marker gs-review)
  write_prep "$prep" "$day" "$(ago 25)" "$routes" "$opening"
  "$NODE" -e "$TRANSCRIPT_WRITER" "$CLAUDE_CONFIG_DIR/projects/scenario/writer-$label.jsonl" "writer-$label" "$w_marker" "$w_start" "$@"
  "$NODE" -e "$TRANSCRIPT_WRITER" "$CLAUDE_CONFIG_DIR/projects/scenario/reviewer-$label.jsonl" "reviewer-$label" "$r_marker" "$r_start"
  out=$ROOT/coach/health/prep/$day
  coach prep-receipts health --date "$day" --marker "$w_marker" --started "$w_start" --finished "$w_end" --out "$out.evidence.json" \
    >"$EVIDENCE/.receipts-$label.txt" 2>&1 ||
    { sed 's/^/  | /' "$EVIDENCE/.receipts-$label.txt" >&2; fail "the coach's own prep-receipts could not write the evidence of the $label preparation from the writer's run record: $(tr '\n' ' ' <"$EVIDENCE/.receipts-$label.txt" | cut -c1-200)"; }
  answer=$EVIDENCE/.answer-$label.json
  write_review_answer "$answer" "$verdict"
  SEAL_CODE=0
  coach prep-seal health --date "$day" --evidence "$out.evidence.json" --answer "$answer" --marker "$r_marker" \
    --started "$r_start" --finished "$r_end" --out "$out.review.json" >"$EVIDENCE/seal-$label.txt" 2>&1 || SEAL_CODE=$?
  printf '%s\n' "$SEAL_CODE" >"$EVIDENCE/seal-$label.code"
  sed "s/^/  seal-$label | /" "$EVIDENCE/seal-$label.txt" >&2
  coach prep-check health --date "$day" >"$EVIDENCE/check-$label.txt" 2>&1 || true
  sed "s/^/  check-$label | /" "$EVIDENCE/check-$label.txt" >&2
  cp "$prep" "$EVIDENCE/prep-$label.md"
  cp "$out.review.json" "$EVIDENCE/review-$label.json" 2>/dev/null || true
  cp "$out.evidence.json" "$EVIDENCE/evidence-$label.json" 2>/dev/null || true
}

# The installed coach, at the notebook's own clock when it has been moved.
coach() { # <arguments...>
  env ${NOW:+GODSPEED_NOW="$NOW"} CLAUDE_CONFIG_DIR="$CLAUDE_CONFIG_DIR" "$NODE" "$COACH" "$@" --godspeed "$ROOT"
}

act() {
  need_the_ai_key "the talk the owner asks for"
  fresh_evidence
  install_paths
  install_the_stage_line "$EVIDENCE/.install.log"
  need_node
  wait_for 180 "the notebook to answer after the install" notebook_answers ||
    fail "the notebook does not answer after the install, so there is no chat to ask for a talk in"
  read_version "$ROOT"
  settings_connects_the_model
  assistant_home
  COACH=$(product_script "$ROOT" third-party/addons/godspeed-coach/bin/godspeed-coach.mjs)
  [ -f "$COACH" ] || fail "the installed version has no coach program at $COACH"
  CLAUDE_CONFIG_DIR=$EVIDENCE/claude-home
  NOW=''
  DAY_A=$(day_in +0)
  DAY_B=$(day_in +1)
  { printf 'a=%s\nb=%s\noffset=%s\n' "$DAY_A" "$DAY_B" "$(date +%z)"; } >"$EVIDENCE/days.txt"

  phase 'a fixture person: one health area, three goals, three research domains'
  write_area
  cp "$ROOT/coach/health/area.md" "$EVIDENCE/area.md"

  phase 'a: a preparation whose review leaves one goal uncovered'
  prepare_and_review a "$DAY_A" 2 'Good evening. Tonight: your LDL result, the half hour of sleep, and one thing to try.' fail "$URL_1" "$URL_2"
  coach brief health --date "$DAY_A" >"$EVIDENCE/brief-a.txt" 2>&1 || true
  chat_panel_new_conversation "$EVIDENCE/.panel-new-a.json"
  chat_panel_says "$ASK" "$EVIDENCE/opening-a.txt"
  cat "$ROOT"/coach/health/talks/"$DAY_A".md >"$EVIDENCE/talk-a.md" 2>/dev/null || : >"$EVIDENCE/talk-a.md"

  coach talk not-held health --date "$DAY_A" >"$EVIDENCE/close-a.txt" 2>&1 || true

  phase 'b: a preparation that covers all three goals, with a passing sealed review'
  notebook_clock_at "$DAY_B"
  NOW=${DAY_B}T12:00:00Z
  prepare_and_review b "$DAY_B" 3 'Good evening. Tonight: three routes, one for each of your goals, and the experiment I would start with.' pass "$URL_1" "$URL_2" "$URL_3"
  # An exit-0, empty block-b.txt is taken as a clean context.
  coach context --scheduled >"$EVIDENCE/block-b.txt" 2>&1 ||
    fail "the coach could not give day B's scheduled context, so a carried-over Health talk was not ruled out: $(tr '\n' ' ' <"$EVIDENCE/block-b.txt" | cut -c1-200)"
  chat_panel_new_conversation "$EVIDENCE/.panel-new-b.json"
  chat_panel_says "$ASK" "$EVIDENCE/opening-b.txt"
  cat "$ROOT"/coach/health/talks/"$DAY_B".md >"$EVIDENCE/talk-b.md" 2>/dev/null || : >"$EVIDENCE/talk-b.md"
  rm -f "$EVIDENCE"/.[a-z]*
}

# ------------------------------------------------------------------------------ what it judges
folded() { tr -s '[:space:]' ' ' <"$1"; }
# The text of a section of a Markdown file, from its heading to the next one.
section_of() { # <file> <heading>
  awk -v h="## $2" '$0==h{f=1;next} /^## /{f=0} f' "$1"
}
# The words that claim a duration or a depth of research. A line saying any of them is a claim; the
# coach's own sentence ("the second check did not pass") says none.
CLAIM='all week|all day|through the week|throughout the week|for (days|weeks|hours|months)|over the (past|last) (few )?(days|weeks?|months?)|[0-9]+ (hours?|days?|weeks?|months?) (of|on|spent) (research|reading|digging|studying)|researched for|hours of research|days of research|weeks of research|spent [a-z ]{0,30}(researching|reading|studying)|looked into this for|read (dozens|hundreds|many|a lot)'
claims_research_time() { # <file>: prints the first line that does, and leaves 0; nothing and 1 when none does
  grep -Eiv '^$' "$1" | grep -Ei -- "$CLAIM" | head -n 1 | grep .
}
check() { # <evidence folder>
  local folder=$1 sentence a b opening_b goal route_count label field reply
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of a talk's preparation"
  kept_all "$folder" 'what the preparations, the real seal, the gate and the talks held' \
    days.txt area.md prep-a.md prep-b.md review-a.json review-b.json evidence-b.json seal-a.txt seal-a.code \
    seal-b.txt seal-b.code check-a.txt check-b.txt brief-a.txt close-a.txt opening-a.txt opening-b.txt talk-a.md talk-b.md
  [ -f "$folder/block-b.txt" ] || fail "block-b.txt is not in what the scenario kept"
  a=$(sed -n 's/^a=//p' "$folder/days.txt")
  b=$(sed -n 's/^b=//p' "$folder/days.txt")
  if [ -z "$a" ] || [ -z "$b" ]; then fail "days.txt does not say which two talk days this scenario worked on"; fi

  # 0. The person is what the scenario says: one area, three goals, research domains.
  [ "$(sed -n 's/^SERVES:[[:space:]]*//p' "$folder/area.md" | tr ',' '\n' | grep -c .)" = 3 ] ||
    fail "the health area does not serve exactly three goals, so a goal left uncovered proves nothing about three"
  [ "$(grep -c '^RESEARCH DOMAIN:' "$folder/area.md")" -ge 1 ] ||
    fail "the health area names no RESEARCH DOMAIN, so its talks do not need a reviewed preparation"

  # (a) 1. The real seal refused the review that leaves a goal uncovered, and the installed gate refuses the preparation.
  [ "$(tr -d '[:space:]' <"$folder/seal-a.code")" != 0 ] ||
    fail "the coach's own seal sealed a review that leaves a goal uncovered (visible-abs): $(tr '\n' ' ' <"$folder/seal-a.txt" | cut -c1-200)"
  grep -qi 'not sealed' "$folder/seal-a.txt" ||
    fail "the coach's own seal refused the review of (a) without saying it was not sealed: $(tr '\n' ' ' <"$folder/seal-a.txt" | cut -c1-200)"
  # The refusal is for the reason (a) is about, and not for some other one: the review the seal made
  # says fail and leaves exactly visible-abs uncovered, the other two goals covered, and the
  # preparation records no route for visible-abs. The seal and the gate name the review.
  [ "$(json_value "$folder/review-a.json" verdict)" = fail ] ||
    fail "the review beside the preparation of (a) does not say fail, so it is not a review that leaves a goal uncovered"
  for goal in lower-ldl sleep-better; do
    "$NODE" -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const row=(r.coverage||[]).find(x=>x.id===process.argv[2]);process.exit(row&&row.verdict==="pass"?0:1)' "$folder/review-a.json" "$goal" ||
      fail "the review of (a) does not cover the goal $goal, so more than the one goal visible-abs is uncovered"
  done
  "$NODE" -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const row=(r.coverage||[]).find(x=>x.id==="visible-abs");process.exit(row&&row.verdict!=="pass"?0:1)' "$folder/review-a.json" ||
    fail "the review of (a) does not leave the goal visible-abs uncovered (it has no failing row for it)"
  if grep -q '^- Goal: visible-abs$' "$folder/prep-a.md"; then
    fail "the preparation of (a) records a route for visible-abs, so the goal is not missing from it"
  fi
  grep -qi 'review did not pass' "$folder/seal-a.txt" ||
    fail "the seal refused (a) for another reason than the review not passing: $(tr '\n' ' ' <"$folder/seal-a.txt" | cut -c1-200)"
  grep -q '^not ready' "$folder/check-a.txt" ||
    fail "the installed gate does not refuse the preparation whose review leaves a goal uncovered: $(tr '\n' ' ' <"$folder/check-a.txt" | cut -c1-200)"
  grep -qi 'review did not pass' "$folder/check-a.txt" ||
    fail "the installed gate refused the preparation of (a) for another reason than the review not passing: $(tr '\n' ' ' <"$folder/check-a.txt" | cut -c1-200)"

  # (a) 2. The brief carries the one sentence, and the talk opened with it, word for word.
  grep -q '^## Not prepared' "$folder/brief-a.txt" ||
    fail "the coach's brief for a talk without a usable preparation has no section \"Not prepared\", so nothing tells the model to say so: $(tr '\n' ' ' <"$folder/brief-a.txt" | cut -c1-200)"
  sentence=$(sed -n 's/.*word for word: "\(The preparation for this talk is not ready: [^"]*\)" Then.*/\1/p' "$folder/brief-a.txt" | head -n 1)
  case $sentence in
    *'second check'*) ;;
    *) fail "the brief's sentence (\"$sentence\") does not name the second check, which is what left the goal uncovered" ;;
  esac
  [ -n "$sentence" ] ||
    fail "the coach's brief has a section \"Not prepared\" but no sentence \"The preparation for this talk is not ready: ...\" in it"
  folded "$folder/opening-a.txt" | grep -qF -- "$sentence" ||
    fail "the talk of (a) did not open with the one sentence naming what is missing (\"$sentence\"): $(tr '\n' ' ' <"$folder/opening-a.txt" | cut -c1-240)"
  section_of "$folder/talk-a.md" 'The opening' | tr -s '[:space:]' ' ' | grep -qF -- "$sentence" ||
    fail "the talk record of (a) does not hold the sentence \"$sentence\" in its opening"
  # (a) 3. No line claims a research duration, in what was sent and in what was kept; and the refused
  # preparation's own opening was not used.
  if claims_research_time "$folder/opening-a.txt" >"$folder/.claim" ||
    section_of "$folder/talk-a.md" 'The opening' | claims_research_time /dev/stdin >"$folder/.claim"; then
    fail "the unprepared talk claims research it cannot show: \"$(cut -c1-160 "$folder/.claim")\""
  fi
  rm -f "$folder/.claim"
  if folded "$folder/opening-a.txt" | grep -qF -- "$(section_of "$folder/prep-a.md" 'The opening' | tr -s '[:space:]' ' ' | sed 's/^ //;s/ $//')"; then
    fail "the talk of (a) opened with the words of the preparation the coach refused"
  fi

  # (a)'s talk is closed, and day B's block does not carry it over.
  grep -qF -- "Recorded: the Health talk of $a is not-held." "$folder/close-a.txt" ||
    fail "the talk of (a) was not closed before day B: $(tr '\n' ' ' <"$folder/close-a.txt" | cut -c1-200)"
  if grep -Eq '^- (Open|Waiting) talk: Health' "$folder/block-b.txt"; then
    fail "on day B the coach still lists a Health talk as open or waiting: $(grep -E '^- (Open|Waiting) talk: Health' "$folder/block-b.txt" | head -n 1 | cut -c1-200)"
  fi

  # (b) 1. Every goal is covered, with its route recorded in full.
  route_count=$(grep -c '^### Route ' "$folder/prep-b.md" || true)
  [ "$route_count" -ge 3 ] ||
    fail "the preparation of (b) records $route_count routes, and it has to record one for each of the three goals"
  for goal in lower-ldl sleep-better visible-abs; do
    grep -q "^- Goal: $goal\$" "$folder/prep-b.md" ||
      fail "the preparation of (b) records no route for the goal $goal"
  done
  for field in Source Published Read Studied Effect Limits 'Contrary evidence' 'Fit to this person' 'Cost or burden' Experiment; do
    [ "$(grep -c "^- $field:" "$folder/prep-b.md")" -ge 3 ] ||
      fail "the preparation of (b) does not record \"$field\" for each of its routes"
  done
  grep -q '^## Rejected routes' "$folder/prep-b.md" ||
    fail "the preparation of (b) has no section \"Rejected routes\""
  # (b) 2. The real seal sealed a passing review that judges all three goals, and the gate says ready.
  [ "$(tr -d '[:space:]' <"$folder/seal-b.code")" = 0 ] ||
    fail "the coach's own seal refused the passing review of (b): $(tr '\n' ' ' <"$folder/seal-b.txt" | cut -c1-240)"
  [ "$(json_value "$folder/review-b.json" verdict)" = pass ] ||
    fail "the review beside the preparation of (b) does not say pass"
  for goal in lower-ldl sleep-better visible-abs; do
    "$NODE" -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const row=(r.coverage||[]).find(x=>x.id===process.argv[2]);process.exit(row&&row.verdict==="pass"?0:1)' "$folder/review-b.json" "$goal" ||
      fail "the sealed review of (b) does not judge the goal $goal as covered"
  done
  grep -q '^ready' "$folder/check-b.txt" ||
    fail "the installed gate does not call the covered, sealed preparation ready: $(tr '\n' ' ' <"$folder/check-b.txt" | cut -c1-200)"
  # (b) 3. The talk opened from the preparation's opening, with no sentence added.
  reply=$(folded "$folder/opening-b.txt")
  opening_b=$(section_of "$folder/prep-b.md" 'The opening' | tr -s '[:space:]' ' ' | sed 's/^ //;s/ $//')
  [ -n "$opening_b" ] || fail "the preparation of (b) has no opening"
  grep -qF -- "$opening_b" <<<"$reply" ||
    fail "the talk of (b) did not open with the preparation's opening (\"$opening_b\"): $(cut -c1-240 <<<"$reply")"
  if grep -qi 'is not ready' <<<"$reply"; then
    fail "the talk of (b), whose preparation passed, still opened by saying the preparation is not ready: $(cut -c1-240 <<<"$reply")"
  fi
  section_of "$folder/talk-b.md" 'The opening' | tr -s '[:space:]' ' ' | grep -qF -- "$opening_b" ||
    fail "the talk record of (b) does not hold the preparation's opening"

  pass "a preparation whose review left the goal visible-abs uncovered was refused by the real seal and the installed gate, and the talk the owner asked for opened with \"$sentence\" and no line claimed a research duration; a preparation covering all three goals with $route_count routes recorded in full and a passing review sealed by the real seal was called ready by the gate, and the talk opened from the preparation's own opening"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  need_node
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
