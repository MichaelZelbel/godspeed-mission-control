#!/usr/bin/env bash
# PROVING SCENARIO OF 2.0.0-beta.17: background work asks the owner nothing he cannot judge, and never
# for a code.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.17-a-plain-yes/plan.md, "Proving
# scenarios" 2, and issue #191): on an install whose owner is on Telegram, five situations are replayed
# by a fixture asker that uses the one way the product gives a job to ask (godspeed-step, scenario-asker.py):
#   1  a restart that is safe to do quietly         nothing is sent to the owner, and nothing waits
#   2  several questions bundled in one run         nothing is sent, nothing waits (the restart is
#                                                   quiet, the other was decided before)
#   3  a real yes that is needed                    one question in words the owner can judge; his
#                                                   plain "approve" is answered with one reply that only
#                                                   confirms, and the step is approved
#   4  an optional extra after an instruction       nothing is sent, nothing waits
#   5  the reminder routines run afterwards         nothing about the optional extra
# and in every message the install sent: no "approve <id>" or "reject <id>", no hex id of six or more.
#
# The advertised Docker Telegram route supplies the installed gateway, routine runner, agent and
# delivery; only its local Bot API is a fixture. THE ASKER'S FLAGS for ticket 04 (quiet, subject,
# optional) are provisional: they live in one table in scenario-asker.py.
#
#   GODSPEED_SCENARIO_AI_KEY    the model that answers "approve" (without it: FAIL), with
#                               GODSPEED_SCENARIO_AI_URL and GODSPEED_SCENARIO_AI_MODEL.
#
#   bash scenarios/no-question-he-cannot-judge.sh candidate/2.0.0-beta.17
#   bash scenarios/no-question-he-cannot-judge.sh --check <folder>
#
# What it keeps for its checking part:
#   run.json                 every message sent (accepted or refused, with its step's label), and each step's outcome
#   approvals-<label>.json   the waiting steps after each situation: s1, s3-ask, s3, s2, s4, s5
#   telegram-requests.json, runner.json, routines.json
SCENARIO=no-question-he-cannot-judge
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
. "$HERE/server-lib.sh"
scenario_arguments "$@"

LABELS='s1 s3-ask s3 s2 s4 s5'

act() {
  need_the_ai_key "the owner's plain \"approve\" answered in the chat"
  fresh_evidence
  install_paths
  need_node
  server_install
  server_connects_the_model
  phase 'the owner on the installed Docker Telegram gateway, and the fixture asker'
  server_telegram_setup
  printf '{"goal":"Sleep eight hours a night","timezone":"Etc/UTC","delivery":"telegram"}\n' >"$EVIDENCE/.setup.json"
  [ "$(server_post /api/setup "$EVIDENCE/.setup.json" "$EVIDENCE/setup.json")" = 200 ] || fail 'the installed notebook would not make routines for the fixture goal'
  server_pause_all_jobs
  server_install_asker
  server_table jobs "$EVIDENCE/routines.json"

  phase 'the five situations'
  cat >"$EVIDENCE/asks-s1.json" <<'JSON'
[{"about":"Your bot's gateway still uses an older setting","question":"Restart your bot's gateway so it picks up its current settings?","yes":"The gateway restarts and uses the current settings","no":"Nothing changes","quiet":"restart"}]
JSON
  cat >"$EVIDENCE/asks-s3-ask.json" <<'JSON'
[{"about":"Seven old programs from two paused projects can still post into your bot chats","question":"Should I turn off the seven old programs that can still post into your bot chats?","yes":"They are turned off","no":"They stay as they are","subject":"old-bot-programs"}]
JSON
  cat >"$EVIDENCE/asks-s2.json" <<'JSON'
[{"about":"Your bot's gateway still uses an older setting","question":"Restart your bot's gateway so it picks up its current settings?","yes":"The gateway restarts and uses the current settings","no":"Nothing changes","quiet":"restart"},
 {"about":"Seven old programs from two paused projects can still post into your bot chats","question":"Turn off the seven leftover programs that can post into a bot chat?","yes":"They are turned off","no":"They stay as they are","subject":"old-bot-programs"}]
JSON
  # The optional extra names the step it follows, which only the install knows: read from the snapshot after "approve".
  local next_ask
  next_ask='const fs=require("fs");const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));const rows=Array.isArray(d)?d:d.data||[];'
  next_ask+='const row=rows.find(r=>JSON.stringify(r).includes("seven old programs")||JSON.stringify(r).includes("Seven old programs"));'
  next_ask+='fs.writeFileSync(process.argv[2],JSON.stringify([{about:"The seven old programs are stopped; they could also be locked down",question:"Lock the seven stopped programs down too?",yes:"They are locked down",no:"They stay stopped",optional_after:row?String(row.id):""}]));'
  server_set_asks "$EVIDENCE/asks-s1.json"; server_run_asker s1; server_snapshot_table s1 approvals
  server_set_asks "$EVIDENCE/asks-s3-ask.json"; server_run_asker s3-ask; server_snapshot_table s3-ask approvals
  server_telegram_say s3 approve; server_snapshot_table s3 approvals
  server_set_asks "$EVIDENCE/asks-s2.json"; server_run_asker s2; server_snapshot_table s2 approvals
  "$NODE" -e "$next_ask" "$EVIDENCE/approvals-s3.json" "$EVIDENCE/asks-s4.json"
  server_set_asks "$EVIDENCE/asks-s4.json"; server_run_asker s4; server_snapshot_table s4 approvals
  server_run_job s5-journal 'Journal check-ins' 300; server_telegram_mark s5 cron
  server_run_job s5-deadlines 'Deadline reminders' 300; server_telegram_mark s5 cron; server_snapshot_table s5 approvals
  server_telegram_snapshot
  server_manifest
  rm -f "$EVIDENCE"/.[a-z]*
}

# ------------------------------------------------------------------------------ what it judges
messages_of() { outbox_between "$FOLDER/run.json" "$@"; }
check() { # <evidence folder>
  local folder=$1 label text count
  FOLDER=$folder
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of what the owner was asked"
  need_node
  kept_all "$folder" 'what was sent to the owner and what waited' run.json telegram-requests.json runner.json manifest.json
  for label in $LABELS; do
    kept "$folder" "approvals-$label.json" "the waiting steps after situation $label"
  done

  # 0. The asker could ask. On a version with no godspeed-step this is where it ends.
  text=$(step_failure "$folder/run.json")
  [ -z "$text" ] || fail "a step of the run did not work, so the situations could not be replayed: $text"

  # 1, 2, 4. Nothing is sent, accepted or refused, and nothing waits.
  for label in s1 s2 s4; do
    interaction_begin "$label"
    text=$(messages_of "$label" | head -n 1)
    [ -z "$text" ] || fail "situation $label sent the owner a message although there was nothing he could judge: $text"
    [ "$("$NODE" "$HERE/telegram-judge.mjs" waiting "$folder/approvals-$label.json")" = 0 ] ||
      fail "situation $label left a step waiting for the owner's yes, which he was never asked and cannot give"
    interaction_passed "$label"
  done
  interaction_begin s5
  text=$(messages_of s5 | head -n 1)
  [ -z "$text" ] || fail "a reminder routine sent the owner a message about something he never needs to answer (situation 5): $text"
  interaction_passed s5

  # 3. One question that carries what the step is about, and one reply to "approve" that only confirms.
  interaction_begin s3-ask
  count=$(messages_of s3-ask | grep -c . || true)
  [ "$count" = 1 ] || fail "the real yes was asked in $count messages, not one"
  messages_of s3-ask | grep -qi 'seven' && messages_of s3-ask | grep -qi 'programs' ||
    fail "the question for the real yes does not say what it is about (the seven old programs): $(messages_of s3-ask | head -n 1)"
  [ "$("$NODE" "$HERE/telegram-judge.mjs" waiting "$folder/approvals-s3-ask.json")" = 1 ] ||
    fail "after the question for the real yes, not exactly one step waited"
  interaction_passed s3-ask
  interaction_begin s3
  count=$(messages_of s3 accepted | grep -c . || true)
  [ "$count" = 1 ] || fail "the owner's \"approve\" was answered with $count messages, not one"
  text=$(messages_of s3 accepted)
  if grep -q '?' <<<"$text"; then fail "the answer to \"approve\" asks the owner something again: $text"; fi
  if grep -qiE 'restart|gateway|lock' <<<"$text"; then fail "the answer to \"approve\" speaks of another situation: $text"; fi
  "$NODE" "$HERE/telegram-judge.mjs" status "$folder/approvals-s3.json" 'seven old programs' | grep -qx approved ||
    fail "the owner's \"approve\" did not approve the step about the seven old programs"
  interaction_passed s3

  # Every message of the run: nothing to type.
  no_code_in "$folder/run.json" "$folder"/approvals-*.json
  count=$("$NODE" -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).outbox.length)' "$folder/run.json")
  pass "the restart that is safe to do quietly, the questions bundled in one run, and the optional extra after an instruction sent the owner nothing and left nothing waiting; the reminders did not mention the extra; the real yes about the seven old programs was one question in words and his \"approve\" was approved with one reply that only confirms; $count messages checked, none holds a code"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  need_node
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
