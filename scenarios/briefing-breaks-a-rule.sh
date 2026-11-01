#!/usr/bin/env bash
# PROVING SCENARIO 4 OF 2.0.0-beta.14: a briefing that breaks a rule still arrives.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.14-charm-proven-briefing-kept/plan.md,
# scenario 4, issue #117): on a fresh install whose voice rules ban a word that a line the morning
# brief must carry word for word contains, the morning briefing is still saved and delivered, without
# that line, and the problem is reported as a repair item. Before, every draft failed (copied, the
# voice check refused the line; changed, the word-for-word check refused the draft) and the brief
# was not saved that morning.
#
# The line used is the Charm Challenge's: the owner starts the challenge through the notebook's own
# operation and the line the brief is given reads "Charm Challenge: day 1 of 21, ...". The owner's
# voice rules (profile/voice.md, the file a person keeps their voice in) ban the word "Challenge".
# The brief then runs the way Settings runs it (POST /api/jobs/add, POST /api/jobs/run) with the
# model Settings connects (POST /api/provider), and what the notebook holds afterwards is read back
# through its own address: the note, whether it was delivered (its notification is "ready") and the
# open repair items.
#
#   GODSPEED_SCENARIO_AI_KEY    the model that writes the brief (without it: FAIL), with
#                               GODSPEED_SCENARIO_AI_URL and GODSPEED_SCENARIO_AI_MODEL.
#
#   bash scenarios/briefing-breaks-a-rule.sh candidate/2.0.0-beta.14
#   bash scenarios/briefing-breaks-a-rule.sh --check <folder>
#
# What it keeps for its checking part:
#   banned-word.txt   the word the voice rules ban
#   voice.md          the voice file as the owner wrote it
#   brief-line.txt    the line the morning brief is given about the Charm Challenge
#   brief-run.json    what the notebook said when it ran its routines
#   brief-job.txt     the morning brief routine afterwards
#   brief-note.txt    the newest note the morning brief saved, which is what the owner reads
#   delivery.txt      the state of that note's notification ("ready" when it is delivered)
#   repairs.txt       one line per open repair item: id, state, what was left out, why
SCENARIO=briefing-breaks-a-rule
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"

BANNED=Challenge

# shellcheck disable=SC2317,SC2329  # asked by wait_for, which takes the command to try as its arguments
notebook_answers() { curl -fsS "http://127.0.0.1:$NOTEBOOK_PORT/health" >/dev/null 2>&1; }
json_string() { "$NODE" -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"; }

# The brief's routine and its newest note, then the notification of that note and the repair items.
# Arguments: jobs, notes, notifications and work_items as the notebook's own query answers them,
# and the four files to write.
READER='
const fs=require("fs");
const rows=f=>{const d=JSON.parse(fs.readFileSync(f,"utf8"));return Array.isArray(d)?d:(d.data||[]);};
const [jobsF,notesF,notificationsF,workF,jobOut,noteOut,deliveryOut,repairOut]=process.argv.slice(1);
const job=rows(jobsF).find(j=>j&&j.id==="morning-brief")||{};
fs.writeFileSync(jobOut,["state="+(job.state||""),"paused="+(job.paused===true)].join("\n")+"\n");
const notes=rows(notesF).filter(n=>n&&n.source_app==="morning-brief"&&!n.is_trashed)
 .sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));
const note=notes.at(-1);
fs.writeFileSync(noteOut,note?String(note.content||""):"");
const sent=note?rows(notificationsF).filter(n=>n&&n.record_id===note.id).map(n=>n.status):[];
fs.writeFileSync(deliveryOut,note?(sent.join(",")||"none")+"\n":"no note\n");
const one=v=>String(v==null?"":v).replace(/\s+/g," ").trim();
fs.writeFileSync(repairOut,rows(workF).filter(w=>w&&w.kind==="repair"&&w.state!=="verified")
 .map(w=>[w.id,w.state,one(w.line_name||w.title),one(w.error)].join("\t")).join("\n")+"\n");
'

# Settings' own way of connecting a model (server/main.mjs POST /api/provider), the routines ticked
# as the form ticks them on a fresh install.
settings_connects_the_model() {
  local body=$EVIDENCE/.provider.json code request=$EVIDENCE/.provider-ask.json
  printf '{"url":%s,"key":%s,"model":%s,"routines":true}\n' \
    "$(json_string "$AI_URL")" "$(json_string "$GODSPEED_SCENARIO_AI_KEY")" "$(json_string "$AI_MODEL")" >"$request"
  code=$(curl -sS -o "$body" -w '%{http_code}' --max-time 300 -X POST \
    -H 'Content-Type: application/json' --data-binary @"$request" \
    "http://127.0.0.1:$NOTEBOOK_PORT/api/provider") ||
    fail "Settings could not be reached to connect a model, so the morning brief has nobody to write it"
  if [ "$code" != 200 ]; then
    print_kept_diagnosis "$STATE" "${HERMES:-}"
    fail "Settings refused the model $AI_MODEL at $AI_URL with HTTP $code: $(tr -d '\n' <"$body" | cut -c1-200)"
  fi
  say "The routines think with $AI_MODEL at $AI_URL"
}

notebook_answer() { # <function> <body> <file> <what it is for>
  local code
  code=$(curl -sS -o "$3" -w '%{http_code}' --max-time 600 -X POST \
    -H 'Content-Type: application/json' -d "$2" \
    "http://127.0.0.1:$NOTEBOOK_PORT/api/functions/$1") ||
    fail "the notebook could not be reached on its own address, so $4 could not be read"
  [ "$code" = 200 ] ||
    fail "the notebook answered HTTP $code when asked for $4: $(tr -d '\n' <"$3" | cut -c1-200)"
}
one_table() { # <table> <file>
  curl -fsS --max-time 300 -X POST -H 'Content-Type: application/json' -d "{\"table\":\"$1\"}" \
    "http://127.0.0.1:$NOTEBOOK_PORT/api/query" -o "$2" ||
    fail "the notebook's own $1 could not be read"
}

act() {
  local body=$EVIDENCE/.job-answer.json code
  need_the_ai_key "the morning brief"
  fresh_evidence
  install_paths
  install_the_stage_line "$EVIDENCE/.install.log"
  need_node
  wait_for 180 "the notebook to answer after the install" notebook_answers ||
    fail "the notebook does not answer after the install, so there is no morning brief to run"
  read_version "$ROOT"
  settings_connects_the_model

  phase 'the voice rules, and a line the brief must carry'
  # The workspace's profile/voice.md is where a person keeps their voice (core/voice-check.mjs).
  mkdir -p "$ROOT/profile"
  # shellcheck disable=SC2016  # the backticks are the voice file's own fence, not a command
  printf '# My voice\n\nShort and plain.\n\n```voice-rules\nBANNED-WORD: %s\n```\n' "$BANNED" >"$ROOT/profile/voice.md"
  cp "$ROOT/profile/voice.md" "$EVIDENCE/voice.md"
  printf '%s\n' "$BANNED" >"$EVIDENCE/banned-word.txt"
  notebook_answer personal-operation '{"type":"charm","action":"start"}' "$EVIDENCE/.start.json" \
    'the start of the Charm Challenge'
  notebook_answer personal-operation '{"type":"charm","action":"brief"}' "$EVIDENCE/.brief.json" \
    'the one line the morning brief is given about the Charm Challenge'
  json_value "$EVIDENCE/.brief.json" data.line >"$EVIDENCE/brief-line.txt" ||
    fail "the notebook's own answer for the morning brief holds no line about the Charm Challenge: $(tr -d '\n' <"$EVIDENCE/.brief.json" | cut -c1-200)"
  printf '\n' >>"$EVIDENCE/brief-line.txt"
  sed 's/^/  | /' "$EVIDENCE/brief-line.txt" >&2

  phase 'the morning brief, turned on and run the way Settings runs it'
  code=$(curl -sS -o "$body" -w '%{http_code}' --max-time 300 -X POST \
    -H 'Content-Type: application/json' -d '{"kind":"morning-brief","interval_ms":60000}' \
    "http://127.0.0.1:$NOTEBOOK_PORT/api/jobs/add") ||
    fail "the notebook could not be reached to turn its morning brief on"
  [ "$code" = 200 ] ||
    fail "the notebook would not turn its morning brief on (HTTP $code): $(tr -d '\n' <"$body" | cut -c1-200)"
  curl -sS --max-time 2400 -X POST -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$NOTEBOOK_PORT/api/jobs/run" -o "$EVIDENCE/brief-run.json" ||
    fail "the notebook's own run of its routines could not be asked for, so the morning brief never ran"
  sed 's/^/  | /' "$EVIDENCE/brief-run.json" >&2
  one_table jobs "$EVIDENCE/.jobs.json"
  one_table notes "$EVIDENCE/.notes.json"
  one_table notifications "$EVIDENCE/.notifications.json"
  one_table work_items "$EVIDENCE/.work.json"
  "$NODE" -e "$READER" "$EVIDENCE/.jobs.json" "$EVIDENCE/.notes.json" "$EVIDENCE/.notifications.json" \
    "$EVIDENCE/.work.json" "$EVIDENCE/brief-job.txt" "$EVIDENCE/brief-note.txt" "$EVIDENCE/delivery.txt" \
    "$EVIDENCE/repairs.txt" ||
    fail "what the notebook holds of its morning brief could not be read"
  for file in brief-job.txt brief-note.txt delivery.txt repairs.txt; do sed "s/^/  $file | /" "$EVIDENCE/$file" >&2; done
  curl -sS -o /dev/null --max-time 300 -X POST -H 'Content-Type: application/json' \
    -d '{"id":"morning-brief","paused":true}' "http://127.0.0.1:$NOTEBOOK_PORT/api/jobs/update" ||
    say '  (the morning brief could not be paused again; it will write another note each minute)'
  rm -f "$EVIDENCE"/.[a-z]*
}

# ------------------------------------------------------------------------------ what it judges
check() { # <evidence folder>
  local folder=$1 banned line
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of a morning briefing"
  kept_all "$folder" 'what the voice rules, the brief and the notebook held' \
    banned-word.txt voice.md brief-line.txt brief-run.json brief-job.txt delivery.txt
  [ -f "$folder/brief-note.txt" ] || fail "brief-note.txt is not in what the scenario kept: the note the morning brief wrote"
  [ -f "$folder/repairs.txt" ] || fail "repairs.txt is not in what the scenario kept: the repair items the notebook holds"
  banned=$(head -n 1 "$folder/banned-word.txt")
  line=$(head -n 1 "$folder/brief-line.txt")

  # 1. The scenario set up what it says it set up: a line the brief must carry that holds the banned word.
  grep -qiw -- "$banned" "$folder/voice.md" ||
    fail "the voice file the scenario wrote does not name \"$banned\", so nothing was banned"
  grep -qiw -- "$banned" <<<"$line" ||
    fail "the line the morning brief is given (\"$line\") does not contain the banned word \"$banned\", so this run proves nothing about a required line that breaks a rule"

  # 2. The briefing was saved, and it is a real one.
  [ -s "$folder/brief-note.txt" ] ||
    fail "the morning brief saved no note (its routine is \"$(sed -n 's/^state=//p' "$folder/brief-job.txt")\" and the notebook said $(tr -d '\n' <"$folder/brief-run.json" | cut -c1-240)), so the line that breaks a rule cost the owner the whole briefing"
  if grep -qi 'could not be written' "$folder/brief-note.txt"; then
    fail "the morning brief that went out is the short fallback, not a briefing: $(tr '\n' ' ' <"$folder/brief-note.txt" | cut -c1-200)"
  fi

  # 3. Without that line, and without the banned word.
  if grep -qxF -- "$line" <(sed 's/^[[:space:]]*//;s/[[:space:]]*$//' "$folder/brief-note.txt"); then
    fail "the morning brief carries \"$line\", the line that breaks the owner's rules"
  fi
  if grep -qiw -- "$banned" "$folder/brief-note.txt"; then
    fail "the morning brief still contains the banned word \"$banned\": $(tr '\n' ' ' <"$folder/brief-note.txt" | cut -c1-200)"
  fi

  # 4. Delivered: the note's notification is ready.
  grep -qw ready "$folder/delivery.txt" ||
    fail "the morning brief was saved but not delivered: its notification says \"$(tr -d '\n' <"$folder/delivery.txt")\", not ready"

  # 5. The problem is reported: an open repair item for the line, with the rule that refused it.
  grep -q . "$folder/repairs.txt" ||
    fail "the notebook holds no open repair item, so the owner is never told the Charm Challenge line was left out"
  grep -i 'charm' "$folder/repairs.txt" | grep -qi -- "$banned" ||
    fail "no open repair item names the Charm Challenge line and the banned word \"$banned\": $(tr '\n' '|' <"$folder/repairs.txt" | cut -c1-240)"

  pass "with \"$banned\" banned in the owner's voice rules and the Charm Challenge line (\"$line\") containing it, the morning brief was still saved and delivered, without that line and without the word, and an open repair item reports the line that was left out"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  need_node
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
