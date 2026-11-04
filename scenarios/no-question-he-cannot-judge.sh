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
# THE TELEGRAM IS A FIXTURE (owner-on-telegram.py): the plugins, the routine runner, the agent and the
# delivery are the install's own; only Telegram's servers are stood in for. THE ASKER'S FLAGS for ticket
# 04 (quiet, subject, optional) are provisional: they live in one table in scenario-asker.py.
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
#   telegram-fixture.json, driver.log, ai.txt, routines.json, config.yaml, plugins.txt
SCENARIO=no-question-he-cannot-judge
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"

LABELS='s1 s3-ask s3 s2 s4 s5'

act() {
  need_the_ai_key "the owner's plain \"approve\" answered in the chat"
  fresh_evidence
  install_paths
  install_the_stage_line "$EVIDENCE/.install.log"
  need_node
  wait_for 180 "the notebook to answer after the install" notebook_is_up ||
    fail "the notebook does not answer after the install"
  read_version "$ROOT"
  assistant_home
  connect_the_ai
  echo "the connected AI ($AI_MODEL)" >"$EVIDENCE/ai.txt"
  phase 'the owner on a fixture Telegram, and the fixture asker'
  owner_on_telegram_install yes

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
  steps_file "$EVIDENCE/steps.json" \
    "$(asker_steps s1 "$EVIDENCE/asks-s1.json")" "$(snapshot_step s1 approvals)" \
    "$(asker_steps s3-ask "$EVIDENCE/asks-s3-ask.json")" "$(snapshot_step s3-ask approvals)" \
    "$(step_of say s3 '"text":"approve","session":"scenario-owner-1"')" "$(snapshot_step s3 approvals)" \
    "$(asker_steps s2 "$EVIDENCE/asks-s2.json")" "$(snapshot_step s2 approvals)" \
    "$(step_of run s4 "\"argv\":[\"$NODE\",\"-e\",$(quoted_json "$next_ask"),$(quoted_json "$EVIDENCE/approvals-s3.json"),$(quoted_json "$ROOT/.scenario-asks.json")]")" \
    "$(step_of cron s4 '"job":"Scenario asker"')" "$(snapshot_step s4 approvals)" \
    "$(step_of cron s5 '"job":"Journal check-ins","optional":true')" \
    "$(step_of cron s5 '"job":"Deadline reminders","optional":true')" "$(snapshot_step s5 approvals)"
  owner_on_telegram "$EVIDENCE/steps.json" "$EVIDENCE/run.json"
  rm -f "$EVIDENCE"/.[a-z]*
}

# ------------------------------------------------------------------------------ what it judges
messages_of() { outbox_between "$FOLDER/run.json" "$@"; }
check() { # <evidence folder>
  local folder=$1 label text count
  FOLDER=$folder
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of what the owner was asked"
  need_node
  kept_all "$folder" 'what was sent to the owner and what waited' run.json telegram-fixture.json
  for label in $LABELS; do
    kept "$folder" "approvals-$label.json" "the waiting steps after situation $label"
  done

  # 0. The asker could ask. On a version with no godspeed-step this is where it ends.
  text=$(step_failure "$folder/run.json")
  [ -z "$text" ] || fail "a step of the run did not work, so the situations could not be replayed: $text"

  # 1, 2, 4. Nothing is sent, accepted or refused, and nothing waits.
  for label in s1 s2 s4; do
    text=$(messages_of "$label" | head -n 1)
    [ -z "$text" ] || fail "situation $label sent the owner a message although there was nothing he could judge: $text"
    [ "$("$NODE" "$HERE/telegram-judge.mjs" waiting "$folder/approvals-$label.json")" = 0 ] ||
      fail "situation $label left a step waiting for the owner's yes, which he was never asked and cannot give"
  done
  text=$(messages_of s5 | grep -i 'lock' | head -n 1)
  [ -z "$text" ] || fail "a reminder routine spoke of the optional extra (situation 5): $text"

  # 3. One question that carries what the step is about, and one reply to "approve" that only confirms.
  count=$(messages_of s3-ask | grep -c . || true)
  [ "$count" = 1 ] || fail "the real yes was asked in $count messages, not one"
  messages_of s3-ask | grep -qi 'seven' && messages_of s3-ask | grep -qi 'programs' ||
    fail "the question for the real yes does not say what it is about (the seven old programs): $(messages_of s3-ask | head -n 1)"
  [ "$("$NODE" "$HERE/telegram-judge.mjs" waiting "$folder/approvals-s3-ask.json")" = 1 ] ||
    fail "after the question for the real yes, not exactly one step waited"
  count=$(messages_of s3 accepted | grep -c . || true)
  [ "$count" = 1 ] || fail "the owner's \"approve\" was answered with $count messages, not one"
  text=$(messages_of s3 accepted)
  if grep -q '?' <<<"$text"; then fail "the answer to \"approve\" asks the owner something again: $text"; fi
  if grep -qiE 'restart|gateway|lock' <<<"$text"; then fail "the answer to \"approve\" speaks of another situation: $text"; fi
  "$NODE" "$HERE/telegram-judge.mjs" status "$folder/approvals-s3.json" 'seven old programs' | grep -qx approved ||
    fail "the owner's \"approve\" did not approve the step about the seven old programs"

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
