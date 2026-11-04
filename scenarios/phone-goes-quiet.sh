#!/usr/bin/env bash
# PROVING SCENARIO OF 2.0.0-beta.18: a phone that stops sending is noticed once, and noticed no more
# when it sends again.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.18-numbers-come-in, ticket 06 and the
# phone-goes-quiet ticket, 03), on the Docker server install: with the clock moved 37 hours past the
# last upload, the connection check sends one message and files one deadline; a second run sends
# nothing more; an upload closes the deadline.
#
# THE MESSAGE is the record the check puts in the notebook's bell about the phone (the Telegram
# delivery is the owner's own account and has no stand-in inside a container), and the deadline is a
# row of the notebook's deadlines new since before the check, whose title speaks of the phone. Both
# are matched by what they say and by being new, not by a slug the ticket chose.
#
# No AI is connected: nothing in this scenario talks to a model.
#
#   bash scenarios/phone-goes-quiet.sh candidate/2.0.0-beta.18
#   bash scenarios/phone-goes-quiet.sh --check <folder>
#
# What it keeps for its checking part:
#   upload-code.txt                the code the first upload got, and the code of the one after the check
#   deadlines-before.json, deadlines-<label>.json   the deadlines before and after: first, second, upload
#   bell-before.json, bell-<label>.json              the bell before and after: first, second
#   last-upload.txt, now-moved.txt  the moment of the last upload and the moment the clock was moved to
SCENARIO=phone-goes-quiet
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
# shellcheck source=scenarios/numbers-lib.sh
. "$HERE/numbers-lib.sh"
scenario_arguments "$@"

ROUTINE='Daily connection check'
ABOUT_THE_PHONE='phone|upload|health auto export'

run_the_check() { # <label>
  local jobs=$EVIDENCE/.jobs.json id
  server_table jobs "$jobs"
  id=$("$NODE" -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const j=(Array.isArray(d)?d:d.data||[]).find(j=>j&&(j.name===process.argv[2]||j.title===process.argv[2]));process.stdout.write(j?String(j.id):"")' "$jobs" "$ROUTINE")
  [ -n "$id" ] || fail "the server has no routine called \"$ROUTINE\" (issue #200 made it)"
  printf '{"id":%s}' "$(quoted_json "$id")" >"$EVIDENCE/.run.json"
  [ "$(server_post /api/jobs/run "$EVIDENCE/.run.json" "$EVIDENCE/.run.answer")" = 200 ] ||
    fail "the server would not run \"$ROUTINE\" ($1): $(tr -d '\n' <"$EVIDENCE/.run.answer" | cut -c1-200)"
  wait_for 120 "the check to finish ($1)" check_finished "$id" || fail "\"$ROUTINE\" did not finish its run ($1) within 120 s"
  looked "$1"
}
# shellcheck disable=SC2317,SC2329  # asked by wait_for
check_finished() {
  server_table jobs "$EVIDENCE/.jobs.json" 2>/dev/null &&
    "$NODE" -e "$BRIEF_JOB_RUN" "$EVIDENCE/.jobs.json" "$1" | grep -q .
}
looked() { # <label>: the deadlines and the bell as they are now
  server_table deadlines "$EVIDENCE/deadlines-$1.json"
  server_table notifications "$EVIDENCE/bell-$1.json"
}

act() {
  fresh_evidence
  install_paths
  need_node
  server_install
  local token
  token=$(ingest_token)
  upload_body "$(metric step_count count "$(pt "$(date -u +'%Y-%m-%d %H:%M:%S') +0000" 800)")" '' >"$EVIDENCE/.upload.json"
  printf 'first %s\n' "$(upload "$token" "$EVIDENCE/.upload.json")" >"$EVIDENCE/upload-code.txt"
  date -u +%Y-%m-%dT%H:%M:%SZ >"$EVIDENCE/last-upload.txt"
  looked before
  date -u -d '37 hours' +%Y-%m-%dT%H:%M:%SZ >"$EVIDENCE/now-moved.txt"
  server_clock_at "$(cat "$EVIDENCE/now-moved.txt")"
  phase 'the check, twice, 37 hours after the last upload'
  run_the_check first
  run_the_check second
  phase 'an upload'
  upload_body "$(metric step_count count "$(pt "$(date -u -d '37 hours' +'%Y-%m-%d %H:%M:%S') +0000" 300)")" '' >"$EVIDENCE/.upload.json"
  printf 'after %s\n' "$(upload "$token" "$EVIDENCE/.upload.json")" >>"$EVIDENCE/upload-code.txt"
  server_table deadlines "$EVIDENCE/deadlines-upload.json"
  rm -f "$EVIDENCE"/.[a-z]*
}

# What is new in <after> since <before>, about the phone: one title or text per line.
NEW_ABOUT_THE_PHONE='
const fs=require("fs");
const rows=f=>{const d=JSON.parse(fs.readFileSync(f,"utf8"));return Array.isArray(d)?d:(d.data||[]);};
const key=r=>r&&(r.slug??r.id);const known=new Set(rows(process.argv[2]).map(key));
const about=new RegExp(process.argv[3],"i");
for(const r of rows(process.argv[1])){
 if(known.has(key(r)))continue;
 const text=String(r.title??r.body??r.text??r.message??"");
 if(about.test(JSON.stringify(r)))process.stdout.write(JSON.stringify([key(r),r.status??r.state??"",text])+"\n");
}
'
new_about_the_phone() { # <after> <before>
  "$NODE" -e "$NEW_ABOUT_THE_PHONE" "$1" "$2" "$ABOUT_THE_PHONE"
}

check() { # <evidence folder>
  local folder=$1 count slug closed
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of a quiet phone"
  need_node
  kept_all "$folder" 'what the connection check did' upload-code.txt last-upload.txt now-moved.txt deadlines-before.json bell-before.json \
    deadlines-first.json bell-first.json deadlines-second.json bell-second.json deadlines-upload.json
  grep -q '^first 200$' "$folder/upload-code.txt" && grep -q '^after 200$' "$folder/upload-code.txt" ||
    fail "an upload was not taken: $(tr '\n' ' ' <"$folder/upload-code.txt")"
  # 37 hours is what the clock was moved by.
  [ "$(( $(date -u -d "$(cat "$folder/now-moved.txt")" +%s) - $(date -u -d "$(cat "$folder/last-upload.txt")" +%s) ))" -ge $((37 * 3600 - 120)) ] ||
    fail "the clock was moved less than 37 hours past the last upload"

  count=$(new_about_the_phone "$folder/bell-first.json" "$folder/bell-before.json" | grep -c . || true)
  [ "$count" = 1 ] || fail "37 hours after the last upload the connection check put $count messages about the phone in the bell, not one"
  count=$(new_about_the_phone "$folder/deadlines-first.json" "$folder/deadlines-before.json" | grep -c . || true)
  [ "$count" = 1 ] || fail "37 hours after the last upload the connection check filed $count deadlines about the phone, not one"
  slug=$(new_about_the_phone "$folder/deadlines-first.json" "$folder/deadlines-before.json" | "$NODE" -e 'process.stdout.write(String(JSON.parse(require("fs").readFileSync(0,"utf8").split("\n")[0])[0]))')
  count=$(new_about_the_phone "$folder/bell-second.json" "$folder/bell-first.json" | grep -c . || true)
  [ "$count" = 0 ] || fail "a second run of the connection check put $count more messages about the phone in the bell"
  count=$(new_about_the_phone "$folder/deadlines-second.json" "$folder/deadlines-first.json" | grep -c . || true)
  [ "$count" = 0 ] || fail "a second run of the connection check filed $count more deadlines about the phone"
  closed=$("$NODE" -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const r=(Array.isArray(d)?d:d.data||[]).find(r=>(r.slug??r.id)===process.argv[2]);process.stdout.write(r?String(r.status??r.state):"absent")' "$folder/deadlines-upload.json" "$slug")
  [ "$closed" = closed ] || fail "after an upload the deadline about the phone is $closed, not closed"
  pass "37 hours after the last upload the connection check sent one message and filed one deadline about the phone; a second run sent nothing; an upload closed the deadline"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  need_node
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
