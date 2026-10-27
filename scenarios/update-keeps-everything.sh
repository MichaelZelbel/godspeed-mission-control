#!/usr/bin/env bash
# PROVING SCENARIO 4: an update from the current public version keeps everything.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.8-faster-chat/plan.md, scenario 4): a
# machine that installed the current public version through today's public line, and then ran the
# line against the stage twice, ends on the stage's own commits with everything of the owner's still
# there: every notebook record, the setting they made in the assistant's own settings file, their
# chat history - and the night chat tidy-up exactly once, not a second one beside it.
#
# Twice, because an update that is run again is what a person does when they are not sure the first
# one finished, and because "exactly once" is only worth checking after the second run.
#
#   bash scenarios/update-keeps-everything.sh candidate/2.0.0-beta.8
#   bash scenarios/update-keeps-everything.sh --check <folder>
#
# What it keeps for its checking part:
#   version-before / version-after    the runtime commit before the update and after it
#   stage.json / kept-stage.json      the stage's own file, and the one the machine kept
#   trace-1.log / trace-2.log         what the two runs of the line did
#   records-before.txt / -after.txt   one line per notebook record, from the notebook's own export
#   owner-setting-before.txt / -after.txt  the value the owner set in the assistant's settings
#   chat-before.txt / -after.txt      the chat history's own rows
#   routines-after.txt                the names of the assistant's routines after the update
#   health.txt                        what the notebook answered on its own address
SCENARIO=update-keeps-everything
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"

ROUTINE='Night chat tidy-up'
CHAT=scenario-chat-1
OWNER_VALUE=150000

# One line per notebook record, so "every record is still there" is a comparison and not a count.
# The same key the linux-update job of .github/workflows/scenarios.yml compares them by.
RECORD_KEYS='
const fs=require("fs");
const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const list=x=>Array.isArray(x)?x:(x.records||x.items||Object.values(x).find(Array.isArray)||[]);
const key=r=>JSON.stringify([r.type||r.kind||"",r.id||r.slug||r.path||JSON.stringify(r)]);
process.stdout.write(list(data).map(key).sort().join("\n")+"\n");
'

# These three are asked by wait_for, which takes the command to try as its arguments.
# shellcheck disable=SC2329
notebook_answers() { curl -fsS "http://127.0.0.1:$NOTEBOOK_PORT/health" >/dev/null 2>&1; }
# shellcheck disable=SC2329
routine_is_there() { grep -qF "$ROUTINE" "$HERMES/cron/jobs.json" 2>/dev/null; }
# shellcheck disable=SC2329
chat_store_is_ready() { chat_store count --session "$CHAT" >/dev/null 2>&1; }
routine_names() { # <file>
  "$NODE" -e '
const fs=require("fs");
let data;try{data=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));}catch{data=[];}
const jobs=Array.isArray(data)?data:(data.jobs||[]);
process.stdout.write(jobs.map(j=>String(j&&j.name||"")).join("\n")+"\n");
' "$HERMES/cron/jobs.json" >"$1"
}

act() {
  fresh_evidence
  install_paths
  install_the_public_line
  need_node
  assistant_home
  wait_for 120 "the notebook to answer after the public install" notebook_answers ||
    fail "the notebook of the current public version does not answer, so there was nothing to update from"
  cp "$RUNTIME/version" "$EVIDENCE/version-before" ||
    fail "the public install left no version file, so what it was cannot be said"
  say "The machine starts on $(cat "$EVIDENCE/version-before")"

  say "Something of the owner's: a notebook record, a setting of their own, and a chat history"
  printf '%s\n' '{"title":"Scenario four","content":"A note the owner wrote before the update"}' >"$EVIDENCE/note.json"
  notebook_cli record save notes "$EVIDENCE/note.json" >&2 ||
    fail "the owner's own note could not be saved in the notebook before the update"
  notebook_cli export "$EVIDENCE/export-before.json" >&2 ||
    fail "the notebook could not be exported before the update"
  "$NODE" -e "$RECORD_KEYS" "$EVIDENCE/export-before.json" >"$EVIDENCE/records-before.txt" ||
    fail "the notebook's export before the update could not be read"
  owner_sets_threshold "$HERMES/config.yaml" "$OWNER_VALUE"
  config_value "$HERMES/config.yaml" compression.threshold_tokens >"$EVIDENCE/owner-setting-before.txt"
  wait_for 300 "the assistant's own chat store" chat_store_is_ready || {
    show_assistant_home
    fail "the public install left the assistant no chat store, so no chat history could be written"
  }
  chat_store seed --session "$CHAT" --tokens 174000 --quiet-minutes 60 --messages 12 >&2 ||
    fail "a chat history could not be written into the assistant's chat store"
  chat_store dump --session "$CHAT" >"$EVIDENCE/chat-before.txt"

  install_the_stage_line "$EVIDENCE/trace-1.log"
  assistant_home
  # The night chat tidy-up came with 2.0.0-beta.8, so the public version has none to keep: it is the
  # updated notebook that makes it, on its own tick, because the chat seeded above is routed to the
  # owner's chat app. It is waited for here, before the second run, so that "exactly once" below is
  # a second run finding the routine there and making no other one beside it.
  wait_for 480 "the updated notebook to make the routine \"$ROUTINE\"" routine_is_there || {
    show_assistant_home
    fail "the update never made the routine \"$ROUTINE\", although the assistant has a chat app"
  }
  # A person who is not sure the first run finished runs the line again, and nothing of theirs may
  # be doubled or lost by it.
  say "The same line again, so nothing is doubled by a second update"
  install_the_stage_line "$EVIDENCE/trace-2.log"
  assistant_home
  wait_for 120 "the notebook to answer after the second run" notebook_answers ||
    fail "the notebook does not answer after the line ran a second time"
  # The notebook looks for the routine on its own tick, at most once a minute (native-scheduler.mjs),
  # so a second one would be there after two of them.
  say "Two of the notebook's own ticks, in which a second night routine would be made"
  sleep 150

  cp "$RUNTIME/version" "$EVIDENCE/version-after" || fail "the update left no version file behind"
  cp "$STATE/stage.json" "$EVIDENCE/kept-stage.json" ||
    fail "the update kept no stage file on the machine, so what it installed cannot be said"
  curl -fsSL "$RAW/$STAGE_REF/stage.json" -o "$EVIDENCE/stage.json" ||
    fail "the stage's own file at $STAGE_REF could not be read, so there is nothing to compare with"
  notebook_cli export "$EVIDENCE/export-after.json" >&2 ||
    fail "the notebook could not be exported after the update"
  "$NODE" -e "$RECORD_KEYS" "$EVIDENCE/export-after.json" >"$EVIDENCE/records-after.txt" ||
    fail "the notebook's export after the update could not be read"
  config_value "$HERMES/config.yaml" compression.threshold_tokens >"$EVIDENCE/owner-setting-after.txt" ||
    printf 'gone\n' >"$EVIDENCE/owner-setting-after.txt"
  chat_store dump --session "$CHAT" >"$EVIDENCE/chat-after.txt"
  routine_names "$EVIDENCE/routines-after.txt"
  curl -sS -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:$NOTEBOOK_PORT/health" \
    >"$EVIDENCE/health.txt" 2>/dev/null || printf '000\n' >"$EVIDENCE/health.txt"
}

check() { # <evidence folder>
  local folder=$1
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of an update"
  need_node
  for file in version-before version-after stage.json kept-stage.json trace-1.log trace-2.log \
    records-before.txt records-after.txt export-after.json owner-setting-before.txt \
    owner-setting-after.txt chat-before.txt chat-after.txt routines-after.txt health.txt; do
    kept "$folder" "$file" "what the machine looked like before the update and after it"
  done

  local product engine before after
  product=$(json_value "$folder/stage.json" productCommit) ||
    fail "the stage's own file names no productCommit, so it is no stage file"
  engine=$(json_value "$folder/stage.json" kitBootstrap.unixEngineCommit) ||
    fail "the stage's own file names no kit-bootstrap commit, so it is no stage file"
  before=$(tr -d ' \n\r' <"$folder/version-before")
  after=$(tr -d ' \n\r' <"$folder/version-after")

  # On the stage's own commits: its product, its kit-bootstrap, its starter, its stage file.
  [ "$after" = "$product" ] ||
    fail "the machine runs $after after the update, and the stage names $product"
  grep -qF "kit-bootstrap/$engine/setup-godspeed.sh" "$folder/trace-2.log" ||
    fail "the update did not run kit-bootstrap $engine, the stage's"
  grep -qF "KB_BRANCH=$engine" "$folder/trace-2.log" ||
    fail "the update did not run kit-bootstrap $engine, the stage's"
  grep -qF "GODSPEED_STARTER_REF=$product" "$folder/trace-2.log" ||
    fail "the update did not make the mission control from starter $product, the stage's"
  cmp -s "$folder/stage.json" "$folder/kept-stage.json" ||
    fail "the stage file the machine kept is not the stage's own"

  # Everything of the owner's.
  local lost
  lost=$(comm -23 <(sort "$folder/records-before.txt") <(sort "$folder/records-after.txt") | grep -c . || true)
  [ "$lost" = 0 ] || fail "$lost notebook records of the owner's are gone after the update"
  grep -qF "A note the owner wrote before the update" "$folder/export-after.json" ||
    fail "the owner's own note is not in the notebook's export after the update"
  local owner_before owner_after
  owner_before=$(tr -d ' \n\r' <"$folder/owner-setting-before.txt")
  owner_after=$(tr -d ' \n\r' <"$folder/owner-setting-after.txt")
  [ "$owner_before" = "$OWNER_VALUE" ] ||
    fail "the owner's own setting was $owner_before before the update, not $OWNER_VALUE, so the scenario had nothing to keep"
  [ "$owner_after" = "$owner_before" ] ||
    fail "the owner's own setting is $owner_after after the update and was $owner_before"
  cmp -s "$folder/chat-before.txt" "$folder/chat-after.txt" ||
    fail "the chat history is not the same after the update"

  # The notebook answers, and the night routine is there exactly once.
  [ "$(tr -d ' \n\r' <"$folder/health.txt")" = 200 ] ||
    fail "the notebook answered $(tr -d ' \n\r' <"$folder/health.txt") on its own address after the update, not 200"
  local routines
  routines=$(grep -c -x -F "$ROUTINE" "$folder/routines-after.txt" || true)
  [ "$routines" = 1 ] ||
    fail "the assistant has the routine \"$ROUTINE\" $routines times after the update, not once"

  pass "$before became $after, the stage's own commit, with its kit-bootstrap $engine and its stage file; every notebook record, the owner's own $owner_after and the chat history came through two runs of the line, the notebook answers, and \"$ROUTINE\" is there exactly once"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
