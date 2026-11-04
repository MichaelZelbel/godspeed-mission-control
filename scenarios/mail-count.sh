#!/usr/bin/env bash
# PROVING SCENARIO OF 2.0.0-beta.18: a tracker counts a kind of mail from its headers.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.18-numbers-come-in, ticket 06 and issue
# #215, ticket 04): a mailbox with order mails, other mails from the same sender, application replies
# from two domains and unrelated mails, every body carrying a marker. "Count the mails from <the
# sender> that say new order", said to the real assistant in the notebook's chat, sets up the rule
# (the recipe shows the number it would count for the last 30 days and saves on a yes); the daily
# routine then counts exactly the orders; a second run adds nothing; the marker appears nowhere in
# the notebook, the assistant's home or the logs; no call fetched a body; and an install with no
# rule made no mail call at all.
#
# THE MAILBOX is the mail tool's own IMAP stand-in (tools/test-mc-mail-imap-fixture.js) on loopback,
# connected to the installed mail tool as a person connects Gmail (scenarios/mail-fixture.cjs). The
# stand-in lists every command it answered, which is what "no body" and "no call" are judged on.
# A fixture limit: it models IMAP search coarsely, so what it proves is the tool's calls and the
# notebook's counting, not Gmail's own search.
#
#   GODSPEED_SCENARIO_AI_KEY    the model of the chat (without it: FAIL), with GODSPEED_SCENARIO_AI_URL
#                               and GODSPEED_SCENARIO_AI_MODEL.
#
#   bash scenarios/mail-count.sh candidate/2.0.0-beta.18
#   bash scenarios/mail-count.sh --check <folder>
#
# What it keeps for its checking part:
#   marker.txt                    the marker every body carries
#   commands-connected.json, commands-norule.json, commands-final.json   what the mailbox answered
#   reply-1.txt, reply-2.txt      the chat's answers to the request and to "yes"
#   items-1.json, items-2.json    the notebook's tracker entries after the first and the second run
#   marker-hits.txt               files outside this folder that hold the marker (none)
#   routine.txt                   the routine's name
SCENARIO=mail-count
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"

SENDER=shop@orders.example.invalid
ASK="Count the mails from $SENDER that say new order."
ORDERS='scenario-1@example.invalid scenario-2@example.invalid scenario-3@example.invalid'
OTHERS='scenario-4@example.invalid scenario-5@example.invalid scenario-6@example.invalid scenario-7@example.invalid scenario-8@example.invalid scenario-9@example.invalid'

api_table() { # <table> <file>
  curl -fsS --max-time 120 -X POST -H 'Content-Type: application/json' -d "{\"table\":\"$1\"}" \
    "http://127.0.0.1:$NOTEBOOK_PORT/api/query" -o "$2" || fail "the notebook would not answer a query of $1"
}
settings_connects_the_model() {
  local body=$EVIDENCE/.provider.json
  printf '{"url":%s,"key":%s,"model":%s,"routines":true}\n' \
    "$(quoted_json "$AI_URL")" "$(quoted_json "$GODSPEED_SCENARIO_AI_KEY")" "$(quoted_json "$AI_MODEL")" >"$EVIDENCE/.provider-ask.json"
  [ "$(curl -sS -o "$body" -w '%{http_code}' --max-time 300 -X POST -H 'Content-Type: application/json' \
    --data-binary @"$EVIDENCE/.provider-ask.json" "http://127.0.0.1:$NOTEBOOK_PORT/api/provider")" = 200 ] ||
    { print_kept_diagnosis "${STATE:-}" "${HERMES:-}"; fail "Settings refused the model $AI_MODEL at $AI_URL: $(tr -d '\n' <"$body" | cut -c1-200)"; }
}

# The mail routine: the one routine whose name speaks of mail. Prints its id.
ROUTINE_FINDER='
const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
const j=(Array.isArray(d)?d:d.data||[]).find(j=>j&&/mail/i.test(String(j.name||j.title||"")));
if(!j)process.exit(1);process.stdout.write(String(j.id)+"\t"+String(j.name||j.title));
'
run_the_routine() { # <id>: runs it and waits until it has a finished run it did not have before
  local id=$1 before after waited=0
  api_table jobs "$EVIDENCE/.jobs.json"
  before=$("$NODE" -e "$BRIEF_JOB_RUN" "$EVIDENCE/.jobs.json" "$id")
  curl -fsS --max-time 300 -X POST -H 'Content-Type: application/json' -d "{\"id\":$(quoted_json "$id")}" \
    "http://127.0.0.1:$NOTEBOOK_PORT/api/jobs/run" -o /dev/null || fail "the notebook would not run the mail routine"
  while [ "$waited" -lt 300 ]; do
    sleep 5
    waited=$((waited + 5))
    api_table jobs "$EVIDENCE/.jobs.json"
    after=$("$NODE" -e "$BRIEF_JOB_RUN" "$EVIDENCE/.jobs.json" "$id")
    [ -z "$after" ] || [ "$after" = "$before" ] || { the_run_did_not_fail "$after" "the mail routine"; return 0; }
  done
  fail "the mail routine ended no run within 300 s of being run"
}

act() {
  need_the_ai_key "the chat that sets the rule up"
  fresh_evidence
  install_paths
  install_the_stage_line "$EVIDENCE/.install.log"
  need_node
  wait_for 180 "the notebook to answer after the install" notebook_is_up || fail "the notebook does not answer after the install"
  read_version "$ROOT"
  assistant_home
  settings_connects_the_model

  phase 'the mailbox, connected like Gmail'
  od -An -N8 -tx1 /dev/urandom | tr -d ' \n' | sed 's/^/MAILCOUNT-MARKER-/' >"$EVIDENCE/marker.txt"
  local tools
  tools=$(product_script "$ROOT" tools)
  [ -f "$tools/test-mc-mail-imap-fixture.js" ] || tools=$HERE/../tools
  "$NODE" "$HERE/mail-fixture.cjs" "$tools" "$ROOT" "$EVIDENCE" >"$EVIDENCE/.fixture.out" 2>"$EVIDENCE/.fixture.err" &
  FIXTURE=$!
  trap 'kill "$FIXTURE" 2>/dev/null' EXIT
  # shellcheck disable=SC2317,SC2329
  fixture_ready() { grep -q '^ready$' "$EVIDENCE/.fixture.out"; }
  wait_for 300 "the mailbox to be connected" fixture_ready ||
    { sed 's/^/  | /' "$EVIDENCE/.fixture.err" >&2; fail "the mail tool could not be connected to the mailbox stand-in: $(tail -n 1 "$EVIDENCE/.fixture.err")"; }
  sleep 2
  cp "$EVIDENCE/commands.json" "$EVIDENCE/commands-connected.json"

  phase 'a day with no rule: the routine makes no mail call'
  local found id
  api_table jobs "$EVIDENCE/.jobs.json"
  found=$("$NODE" -e "$ROUTINE_FINDER" "$EVIDENCE/.jobs.json") ||
    fail "the install has no routine that counts mail (issue #215 adds it)"
  id=${found%%$'\t'*}
  printf '%s\n' "${found#*$'\t'}" >"$EVIDENCE/routine.txt"
  run_the_routine "$id"
  sleep 2
  cp "$EVIDENCE/commands.json" "$EVIDENCE/commands-norule.json"

  phase 'the rule, set up in the chat'
  chat_panel_new_conversation "$EVIDENCE/.panel-new.json"
  chat_panel_says "$ASK" "$EVIDENCE/reply-1.txt"
  chat_panel_says 'yes' "$EVIDENCE/reply-2.txt"

  phase 'the routine, twice'
  run_the_routine "$id"
  api_table collection_items "$EVIDENCE/items-1.json"
  run_the_routine "$id"
  api_table collection_items "$EVIDENCE/items-2.json"
  sleep 2
  cp "$EVIDENCE/commands.json" "$EVIDENCE/commands-final.json"
  grep -rl --exclude-dir=node_modules --exclude-dir=versions -F -- "$(cat "$EVIDENCE/marker.txt")" "$ROOT" "$HERMES" 2>/dev/null |
    grep -v "^$EVIDENCE" >"$EVIDENCE/marker-hits.txt" || :
  rm -f "$EVIDENCE"/.[a-z]* "$EVIDENCE/commands.json"
}

count_of() { # <items file> <message ids...>: how many entries name any of these mails
  local file=$1
  shift
  "$NODE" -e 'const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const ids=process.argv.slice(2);
   process.stdout.write(String((Array.isArray(d)?d:d.data||[]).filter(r=>r&&!r.is_trashed&&ids.some(i=>JSON.stringify(r).includes(i))).length))' "$file" "$@"
}

check() { # <evidence folder>
  local folder=$1 id count
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of a counted mail"
  need_node
  kept_all "$folder" 'what the mailbox, the chat and the routine did' marker.txt routine.txt commands-connected.json commands-norule.json commands-final.json reply-1.txt reply-2.txt items-1.json items-2.json
  [ -f "$folder/marker-hits.txt" ] || fail "marker-hits.txt is not in what the scenario kept"

  # No rule, no mail call.
  cmp -s "$folder/commands-connected.json" "$folder/commands-norule.json" ||
    fail "the routine made a mail call on an install where no tracker has a mail rule"
  # The chat showed the 30-day number before saving.
  grep -qw 3 "$folder/reply-1.txt" ||
    fail "the assistant's answer to the request does not say the 3 mails it would count: $(tr '\n' ' ' <"$folder/reply-1.txt" | cut -c1-240)"
  # Exactly the orders, once each.
  # shellcheck disable=SC2086  # the message ids are separate words
  count=$(count_of "$folder/items-1.json" $ORDERS)
  [ "$count" = 3 ] || fail "the routine added $count entries naming the three order mails, not three"
  for id in $ORDERS; do
    [ "$(count_of "$folder/items-1.json" "$id")" = 1 ] || fail "the order mail $id was counted $(count_of "$folder/items-1.json" "$id") times, not once"
  done
  # shellcheck disable=SC2086
  [ "$(count_of "$folder/items-1.json" $OTHERS)" = 0 ] ||
    fail "the routine counted a mail that is not an order from $SENDER"
  [ "$(count_of "$folder/items-2.json" $ORDERS $OTHERS)" = 3 ] ||
    fail "a second run of the routine changed the count to $(count_of "$folder/items-2.json" $ORDERS $OTHERS)"
  # Headers only, and the marker nowhere.
  if "$NODE" -e 'const c=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));
    const body=c.filter(x=>/FETCH/.test(x)&&(/RFC822(?!\.SIZE)/.test(x)||/BODY(\.PEEK)?\[(\]|TEXT|[0-9])/.test(x)));
    if(body.length){console.log(body[0].slice(0,160));process.exit(1)}' "$folder/commands-final.json" >"$folder/.body" 2>&1; then :; else
    fail "the routine asked the mailbox for a mail's body: $(cat "$folder/.body")"
  fi
  rm -f "$folder/.body"
  [ ! -s "$folder/marker-hits.txt" ] ||
    fail "the marker that every mail body carries is in $(grep -c . "$folder/marker-hits.txt") file(s) of the install, e.g. $(head -n 1 "$folder/marker-hits.txt")"
  pass "\"$(cut -c1-60 <<<"$ASK")\" set up a rule in the chat showing 3 mails; the routine counted exactly the 3 orders once each, a second run added nothing, no body was fetched, the marker is nowhere in the install, and an install with no rule made no mail call"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  need_node
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
