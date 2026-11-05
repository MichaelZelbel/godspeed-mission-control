#!/usr/bin/env bash
# PROVING SCENARIO OF 2.0.0-beta.19: a deadline on a key and one on a connection close themselves, and the
# key's value is in no log or record.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.19-looks-after-itself/tickets/05-scenarios.md,
# scenario 4), on an install whose owner is on a fixture Telegram, through the real assistant:
#   key         a deadline on the AI's key (secrets/expires.txt names it, the way mc-due picks keys up) is
#               open; the key replaced in Settings (POST /api/provider, the call of Settings' own form)
#               closes it on the next deadline run (mc-due check), and the connection deadline stays open
#   connection  Telegram refuses the key: the daily connection check opens a deadline about Telegram; the
#               key valid again, the next run of the check closes it
#   secret      the value of neither key is found in any log, record, session or evidence file
#
# THE FIRST KEY is a made-up one connected the way Settings connects it (core/routine-ai.mjs); the
# scenario's real key (GODSPEED_SCENARIO_AI_KEY) is the one Settings replaces it with, which is what makes
# it a replacement and is also the one call that needs a model. THE TELEGRAM IS A FIXTURE
# (telegram-fixture-fetch.mjs), as in connection-check.sh. Until ticket 04 is on the stage the first
# deadline stays open and this ends in its FAIL line.
#
# WHERE A KEY MAY BE KEPT is not scanned: the assistant's config.yaml, .env and auth.json and the
# notebook's provider.json are where Settings puts it. Everything else under the assistant's home, the
# install's state, the mission control and the evidence is.
#
#   bash scenarios/deadline-closes-itself.sh candidate/2.0.0-beta.19
#   bash scenarios/deadline-closes-itself.sh --check <folder>
#
# What it keeps for its checking part:
#   run.json                                every message sent and each step's outcome
#   due-before.json, due-<label>.json       the deadlines before, with both open, after the key was replaced,
#                                           and after the connection was repaired
#   key-scan.txt                            "clean", or the paths of the files that hold a key (never what they hold)
#   telegram-fixture-calls.log, telegram-fixture.json, driver.log, routines.json, config.yaml, plugins.txt
SCENARIO=deadline-closes-itself
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"

CHECK_ROUTINE='Daily connection check'
KEY_NAME=ai-key
KEY_SLUG=key-ai-key
FIRST_KEY='sk-scenario-first-key-0000000000000000'

# The first key, connected the way connect_the_ai connects the real one.
connect_the_first_key() {
  local version
  version=$(cat "$RUNTIME/version") || fail "the install left no version file behind"
  "$NODE" -e '
const [module_,home,state,url,key,model]=process.argv.slice(1);
import(require("url").pathToFileURL(module_).href).then(m=>{
 m.connectRoutineAI({home,state,config:{url,key,model}});
}).catch(error=>{console.error(error.message);process.exit(1);});
' "$RUNTIME/versions/$version/notebook/core/routine-ai.mjs" "$HERMES" "$STATE" "$AI_URL" "$FIRST_KEY" "$AI_MODEL" ||
    fail "the first AI key could not be connected to the assistant"
}

look() { # <label>: the deadlines as they are after a step
  step_of run "$1" "\"argv\":[\"$NODE\",$(quoted_json "$(product_script "$ROOT" notebook/bin/personal-command.mjs)"),\"due\",\"state\",\"--json\"],\"env\":{\"GODSPEED_WORKSPACE\":$(quoted_json "$ROOT")},\"stdout_file\":$(quoted_json "$EVIDENCE/due-$1.json")"
}

# The paths (never the contents) of the files that hold a key, outside the places keys are kept in.
scan_for_keys() { # <file for the answer> <key>...
  local out=$1 found='' key hits code
  shift
  for key in "$@"; do
    hits=$(grep -rlF --exclude-dir=integrated-runtime --exclude-dir=node_modules --exclude-dir=.git \
      --exclude=config.yaml --exclude=.env --exclude=auth.json --exclude=provider.json \
      -- "$key" "$HERMES" "$STATE" "$ROOT" "$EVIDENCE" 2>"$EVIDENCE/key-scan.err")
    code=$?
    # grep ends 1 for "no file holds it"; any other end means some file was not looked at.
    [ "$code" -le 1 ] && [ ! -s "$EVIDENCE/key-scan.err" ] ||
      fail "the scan for the keys' values could not look at every file (grep ended $code): $(head -n 1 "$EVIDENCE/key-scan.err")"
    found+=$hits$'\n'
  done
  rm -f "$EVIDENCE/key-scan.err"
  found=$(sed '/^$/d' <<<"$found" | sort -u)
  if [ -z "$found" ]; then printf 'clean\n' >"$out"; else printf '%s\n' "$found" >"$out"; fi
}

act() {
  need_the_ai_key "replacing the key in Settings"
  fresh_evidence
  install_paths
  install_the_stage_line "$EVIDENCE/.install.log"
  need_node
  wait_for 180 "the notebook to answer after the install" notebook_is_up ||
    fail "the notebook does not answer after the install"
  read_version "$ROOT"
  assistant_home
  phase 'the owner on a fixture Telegram, a first key, a key with an end date'
  owner_on_telegram_install no
  connect_the_first_key
  mkdir -p "$ROOT/secrets"
  printf '%s  %s  https://example.invalid/keys  # The key your AI thinks with.\n' \
    "$KEY_NAME" "$(date -u -d '+20 days' +%F)" >"$ROOT/secrets/expires.txt"
  due_on "$ROOT" state --json >"$EVIDENCE/due-before.json" ||
    fail "the install's deadlines could not be read before anything ran"

  local scratch
  scratch=$(mktemp -d) || fail "no scratch folder could be made for the request that replaces the key"
  printf '{"url":%s,"key":%s,"model":%s}\n' "$(quoted_json "$AI_URL")" "$(quoted_json "$GODSPEED_SCENARIO_AI_KEY")" \
    "$(quoted_json "$AI_MODEL")" >"$scratch/replace.json"
  chmod 600 "$scratch/replace.json"

  phase 'Telegram refused, the key replaced in Settings, the deadline run, Telegram valid again'
  steps_file "$EVIDENCE/steps.json" \
    "$(step_of token broken '"valid":false')" \
    "$(step_of cron broken "\"job\":\"$CHECK_ROUTINE\"")" "$(look both-open)" \
    "$(step_of run replace "\"argv\":[\"curl\",\"-fsS\",\"--max-time\",\"600\",\"-o\",\"/dev/null\",\"-X\",\"POST\",\"-H\",\"Content-Type: application/json\",\"--data-binary\",$(quoted_json "@$scratch/replace.json"),\"http://127.0.0.1:$NOTEBOOK_PORT/api/provider\"],\"timeout\":900")" \
    "$(step_of run checked "\"argv\":[\"$NODE\",$(quoted_json "$(product_script "$ROOT" notebook/bin/personal-command.mjs)"),\"due\",\"check\"],\"env\":{\"GODSPEED_WORKSPACE\":$(quoted_json "$ROOT")}")" \
    "$(look key-replaced)" \
    "$(step_of token repaired '"valid":true')" \
    "$(step_of cron repaired "\"job\":\"$CHECK_ROUTINE\"")" "$(look repaired)"
  owner_on_telegram "$EVIDENCE/steps.json" "$EVIDENCE/run.json"
  rm -rf "$scratch"
  scan_for_keys "$EVIDENCE/key-scan.txt" "$FIRST_KEY" "$GODSPEED_SCENARIO_AI_KEY"
  rm -f "$EVIDENCE"/.[a-z]*
}

# ------------------------------------------------------------------------------ what it judges
state_of() { # <due file> <slug>
  "$NODE" "$HERE/telegram-judge.mjs" state "$1" "$2"
}

check() { # <evidence folder>
  local folder=$1 label text opened title slug state
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of a night"
  need_node
  kept_all "$folder" 'what was opened, closed and sent' run.json due-before.json key-scan.txt telegram-fixture-calls.log
  for label in both-open key-replaced repaired; do kept "$folder" "due-$label.json" "the deadlines at $label"; done
  text=$(step_failure "$folder/run.json")
  [ -z "$text" ] || fail "a step of the run did not work, so the deadlines could not be tried: $text"

  # The deadline on the key, and the one on Telegram, both open.
  state=$(state_of "$folder/due-before.json" "$KEY_SLUG")
  [ "$state" = open ] || fail "the deadline on the key ($KEY_SLUG) is $state, not open, before anything ran: secrets/expires.txt names the key"
  [ "$(state_of "$folder/due-both-open.json" "$KEY_SLUG")" = open ] ||
    fail "the deadline on the key is not open when the connection check has run"
  opened=$("$NODE" "$HERE/telegram-judge.mjs" deadlines "$folder/due-both-open.json" "$folder/due-before.json" |
    awk -F'\t' '$1=="open" && tolower($2 $3) ~ /telegram/')
  [ "$(grep -c . <<<"$opened" || true)" = 1 ] ||
    fail "a refused Telegram key opened $(grep -c . <<<"$opened" || true) deadlines about Telegram, not one"
  title=$(cut -f2 <<<"$opened")
  slug=$(cut -f3 <<<"$opened")

  # The key replaced in Settings closes the key's deadline on the next deadline run, and only that one.
  state=$(state_of "$folder/due-key-replaced.json" "$KEY_SLUG")
  [ "$state" = closed ] || fail "the deadline on the key is $state, not closed, after the key was replaced in Settings and the deadline run went on"
  [ "$(state_of "$folder/due-key-replaced.json" "$slug")" = open ] ||
    fail "the deadline about Telegram (\"$title\") was closed by replacing the AI's key"

  # The connection check passing closes the connection's.
  state=$(state_of "$folder/due-repaired.json" "$slug")
  [ "$state" = closed ] || fail "the deadline about Telegram (\"$title\") is $state, not closed, after the connection check passed"

  # The keys are in no log or record.
  [ "$(head -n 1 "$folder/key-scan.txt")" = clean ] ||
    fail "a key's value is in $(grep -c . "$folder/key-scan.txt") file(s) outside where keys are kept: $(head -n 3 "$folder/key-scan.txt" | tr '\n' ' ')"
  pass "the deadline on the key closed on the deadline run after the key was replaced in Settings, with the one about Telegram (\"$title\") still open; the connection check passing closed that one; neither key's value is in any log, record or evidence file"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  need_node
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
