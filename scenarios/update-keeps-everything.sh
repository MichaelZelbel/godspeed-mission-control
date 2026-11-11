#!/usr/bin/env bash
# PROVING SCENARIO 4: an update from the current public version keeps everything.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.8-faster-chat/plan.md, scenario 4, and
# #456): a machine that installed the current public version through today's public line, updated
# with the stage's own godspeed-update command (notebook/core/update.mjs), ran the line against the
# stage once more, and then pressed Update now in Settings, ends on the stage's own commits with
# everything of the owner's still there: every notebook record, the setting they made in the
# assistant's own settings file, their chat history - and one night chat tidy-up, restored by this
# release after it had left on 27 October 2026 although the notebook of main made it for a while. The owner gives the installed
# notebook its first goal first: that is when it makes its starting routines, including a tidy-up
# once a chat app is connected.
#
# The line after the command, because an update that is run again is what a person does when they
# are not sure the first one finished, and because nothing of theirs may be doubled or lost by it.
#
# The command and the button read GitHub's releases from a stand-in on this machine
# (update-keeps-everything-release.sh), whose Latest release is the stage: its source archive is
# made from this checkout and vouched for by its own SHA256SUMS. The button then gets a second
# Latest release, "stand-in", whose stage names the same commits under a newer version, so the
# notebook's own service takes a version over (scripts/native-start-script.mjs) with nothing of the
# administrator's: its systemd unit is told where both stand-ins are, and nothing else changes.
#
# The owner's chat history is a conversation they had with the assistant, which is also what makes
# the assistant's chat store at all (scenario-lib.sh, assistant_keeps_a_conversation), so the job
# hands this scenario an AI as well: GODSPEED_SCENARIO_AI_KEY (without it: FAIL), and
# GODSPEED_SCENARIO_AI_URL and GODSPEED_SCENARIO_AI_MODEL, as night-tidy.sh takes them.
#
#   bash scenarios/update-keeps-everything.sh candidate/2.0.0-beta.8
#   bash scenarios/update-keeps-everything.sh --check <folder>
#
# What it keeps for its checking part:
#   version-before / version-after    the runtime commit before the update and after it
#   stage.json / kept-stage.json      the stage's own file, and the one the machine kept
#   update-said.txt                   what godspeed-update said while it updated to the stage
#   trace-2.log                       what the run of the line after it did
#   button-said.json / button-status.json   Update now's answer, and how the update it started ended
#   button-kept-stage.json            the stage file the machine kept after Update now
#   records-before.txt / -after.txt   one line per notebook record, from the notebook's own export
#   owner-setting-before.txt / -after.txt  the value the owner set in the assistant's settings
#   chat-before.txt / -after.txt      the chat history's own rows
#   setup.json                        the notebook's configured answer to the owner's first goal
#   routines-after.txt                the names of the assistant's routines after the update
#   health.txt                        what the notebook answered on its own address
SCENARIO=update-keeps-everything
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
# shellcheck source=scenarios/update-keeps-everything-release.sh
. "$HERE/update-keeps-everything-release.sh"
scenario_arguments "$@"

ROUTINE='Night chat tidy-up'
CHAT=scenario-chat-1
OWNER_VALUE=150000
FIRST_GOAL='Keep the scenario ready'
BUTTON_TAG=stand-in
UNIT=godspeed-integrated-notebook.service

# One line per notebook record, so "every record is still there" is a comparison and not a count.
# The same key the linux-update job of .github/workflows/scenarios.yml compares them by.
RECORD_KEYS='
const fs=require("fs");
const data=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const list=x=>Array.isArray(x)?x:(x.records||x.items||Object.values(x).find(Array.isArray)||[]);
const key=r=>JSON.stringify([r.type||r.kind||"",r.id||r.slug||r.path||JSON.stringify(r)]);
process.stdout.write(list(data).map(key).sort().join("\n")+"\n");
'

# Asked by wait_for, which takes the command to try as its arguments.
# shellcheck disable=SC2329
notebook_answers() { curl -fsS "http://127.0.0.1:$NOTEBOOK_PORT/health" >/dev/null 2>&1; }
chat_store_is_ready() { chat_store count --session "$CHAT" >/dev/null 2>&1; }
# THE STAGE'S OWN COMMAND, from this checkout, run as godspeed-update runs on the installation:
# with its node, for its folder, against the stand-in releases.
update_with_the_command() { # <file for what it said>
  say "godspeed-update, the stage's own, against the stand-in releases"
  GODSPEED_WORKSPACE="$ROOT" GODSPEED_SCENARIO_RELEASES_URL="$RELEASES_URL" GODSPEED_STAGE_RAW="$RAW" \
    "$NODE" "$HERE/../notebook/bin/godspeed.mjs" update 2>&1 | tee "$1" >&2
  [ "${PIPESTATUS[0]}" = 0 ] ||
    fail "godspeed-update stopped before the machine was on the stage: $(tail -n 3 "$1" | tr '\n' ' ' | cut -c1-300)"
}

# The stand-in stage for Update now: the stage's own file under a newer version, its reader, and
# the public stage, as the installers read them from GODSPEED_STAGE_RAW.
stand_in_stage() { # <folder>
  mkdir -p "$1/$BUTTON_TAG/stage" "$1/beta" || fail "the stand-in stage folder $1 could not be made"
  curl -fsSL "$RAW/$STAGE_REF/stage.json" -o "$1/.stage.json" &&
    curl -fsSL "$RAW/$STAGE_REF/stage/stage.sh" -o "$1/$BUTTON_TAG/stage/stage.sh" &&
    curl -fsSL "$RAW/beta/stage.json" -o "$1/beta/stage.json" ||
    fail "the stage's own files at $STAGE_REF could not be read for the stand-in stage"
  "$NODE" -e '
const fs=require("fs"),[from,to]=process.argv.slice(1),stage=JSON.parse(fs.readFileSync(from,"utf8"));
stage.version+=".handover";
fs.writeFileSync(to,JSON.stringify(stage,null,2)+"\n");
' "$1/.stage.json" "$1/$BUTTON_TAG/stage.json" || fail "the stand-in stage file could not be written"
}

# The notebook's own service, told where the stand-in releases and the stand-in stage are, and
# started again so its notebook reads them. The unit itself stays as the installer wrote it.
service_reads_the_stand_ins() { # <stage folder>
  local text dropin
  text=$(printf '[Service]\nEnvironment="GODSPEED_SCENARIO_RELEASES_URL=%s"\nEnvironment="GODSPEED_STAGE_RAW=file://%s"\n' "$RELEASES_URL" "$1")
  if systemctl --user cat "$UNIT" >/dev/null 2>&1; then
    dropin=$HOME/.config/systemd/user/$UNIT.d
    mkdir -p "$dropin" && printf '%s\n' "$text" >"$dropin/scenario-releases.conf" &&
      systemctl --user daemon-reload && systemctl --user restart "$UNIT" ||
      fail "the notebook's service could not be told where the stand-in releases are"
  elif systemctl cat "$UNIT" >/dev/null 2>&1; then
    dropin=/etc/systemd/system/$UNIT.d
    sudo mkdir -p "$dropin" && printf '%s\n' "$text" | sudo tee "$dropin/scenario-releases.conf" >/dev/null &&
      sudo systemctl daemon-reload && sudo systemctl restart "$UNIT" ||
      fail "the notebook's service could not be told where the stand-in releases are"
  else
    fail "the notebook runs under no service of its own, so Update now has nothing to restart"
  fi
}

# shellcheck disable=SC2329  # asked by wait_for
update_ended() {
  case $(json_value "$STATE/update/status.json" state 2>/dev/null) in updated | failed) return 0 ;; esac
  return 1
}

# UPDATE NOW, as Settings, About presses it, and how the update it started ended.
press_update_now() {
  local code
  code=$(curl -sS -o "$EVIDENCE/button-said.json" -w '%{http_code}' --max-time 300 -X POST \
    "http://127.0.0.1:$NOTEBOOK_PORT/api/update") || fail "the notebook could not be reached to press Update now"
  [ "$code" = 202 ] ||
    fail "Update now did not start an update (HTTP $code): $(tr -d '\n' <"$EVIDENCE/button-said.json" | cut -c1-300)"
  wait_for 1500 "the update Update now started to end" update_ended ||
    fail "Update now did not finish within 1500 s; it said: $(tail -n 5 "$STATE/update/update.log" 2>/dev/null | tr '\n' ' ' | cut -c1-300)"
  cp "$STATE/update/status.json" "$EVIDENCE/button-status.json"
  wait_for 120 "the notebook to answer after Update now" notebook_answers ||
    fail "the notebook does not answer after Update now"
  cp "$STATE/stage.json" "$EVIDENCE/button-kept-stage.json" ||
    fail "the machine kept no stage file after Update now"
}

routine_names() { # <file>
  "$NODE" -e '
const fs=require("fs");
let data;try{data=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));}catch{data=[];}
const jobs=Array.isArray(data)?data:(data.jobs||[]);
process.stdout.write(jobs.map(j=>String(j&&j.name||"")).join("\n")+"\n");
' "$HERMES/cron/jobs.json" >"$1"
}

act() {
  need_the_ai_key "the owner's chat with the assistant"
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

  say "The owner's first goal, so the notebook starts this install's routines"
  printf '{"goal":"%s","timezone":"Etc/UTC","delivery":"notebook"}\n' "$FIRST_GOAL" >"$EVIDENCE/.setup.json"
  local setup_status
  setup_status=$(curl -sS -o "$EVIDENCE/setup.json" -w '%{http_code}' --max-time 300 -X POST \
    -H 'Content-Type: application/json' --data-binary @"$EVIDENCE/.setup.json" \
    "http://127.0.0.1:$NOTEBOOK_PORT/api/setup") ||
    fail "the notebook could not be reached to give the owner their first goal"
  [ "$setup_status" = 200 ] ||
    fail "the notebook refused the owner's first goal with HTTP $setup_status: $(tr -d '\n' <"$EVIDENCE/setup.json" | cut -c1-200)"
  [ "$(json_value "$EVIDENCE/setup.json" configured)" = true ] ||
    fail "the notebook accepted the owner's first-goal request but did not say the install is configured"

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
  connect_the_ai
  assistant_keeps_a_conversation "$EVIDENCE/first-conversation.txt"
  chat_store_is_ready ||
    fail "the assistant's own chat store holds no conversations and messages to write a chat history beside ($HERMES/state.db)"
  chat_store seed --session "$CHAT" --tokens 174000 --quiet-minutes 60 --messages 12 >&2 ||
    fail "a chat history could not be written into the assistant's chat store"
  chat_store dump --session "$CHAT" >"$EVIDENCE/chat-before.txt"

  rm -rf "$EVIDENCE.releases" "$EVIDENCE.stage"
  stand_in_release "$EVIDENCE.releases" "$STAGE_REF"
  serve_stand_in_releases "$EVIDENCE.releases"
  update_with_the_command "$EVIDENCE/update-said.txt"
  assistant_home
  wait_for 120 "the notebook to answer after godspeed-update" notebook_answers ||
    fail "the notebook does not answer after godspeed-update brought it to the stage"
  # A person who is not sure the update finished runs the line as well, and nothing of theirs may
  # be doubled or lost by it.
  say "The line after the command, so nothing is doubled by a second update"
  install_the_stage_line "$EVIDENCE/trace-2.log"
  assistant_home
  wait_for 120 "the notebook to answer after the second run" notebook_answers ||
    fail "the notebook does not answer after the line ran a second time"
  cp "$STATE/stage.json" "$EVIDENCE/kept-stage.json" ||
    fail "the update kept no stage file on the machine, so what it installed cannot be said"

  say "Update now, in Settings, About, for a newer stand-in release of the same commits"
  stand_in_stage "$EVIDENCE.stage"
  stand_in_release "$EVIDENCE.releases" "$BUTTON_TAG"
  service_reads_the_stand_ins "$EVIDENCE.stage"
  wait_for 180 "the notebook to answer with the stand-in releases" notebook_answers ||
    fail "the notebook does not answer after its service was told where the stand-in releases are"
  press_update_now
  assistant_home
  # The notebook makes its routines on its own tick, at most once a minute (native-scheduler.mjs),
  # so two ticks prove the connected chat app gets one routine without doubling it.
  say "Two of the notebook's own ticks, in which one night routine is made"
  sleep 150

  cp "$RUNTIME/version" "$EVIDENCE/version-after" || fail "the update left no version file behind"
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
  for file in version-before version-after stage.json kept-stage.json update-said.txt trace-2.log \
    button-said.json button-status.json button-kept-stage.json \
    records-before.txt records-after.txt export-after.json owner-setting-before.txt \
    owner-setting-after.txt chat-before.txt chat-after.txt setup.json \
    routines-after.txt health.txt; do
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

  # The stage's own command did the update, from a download it checked.
  local version
  version=$(json_value "$folder/stage.json" version) ||
    fail "the stage's own file names no version, so it is no stage file"
  grep -qF "The download of $version matched the checksum its release publishes." "$folder/update-said.txt" ||
    fail "godspeed-update did not say the download of $version matched its release's checksum, so the command did not verify the download"
  grep -qF "Godspeed Mission Control is now $version." "$folder/update-said.txt" ||
    fail "godspeed-update did not say it brought the machine to $version, the stage's version"

  # Update now: the notebook's own service took the newer version over and settled it.
  local button
  button=$(json_value "$folder/button-status.json" state) || button=none
  [ "$button" = updated ] ||
    fail "Update now did not finish: the update it started ended $button ($(json_value "$folder/button-status.json" message 2>/dev/null))"
  [ "$(json_value "$folder/button-kept-stage.json" version)" = "$version.handover" ] ||
    fail "after Update now the machine keeps the stage file of $(json_value "$folder/button-kept-stage.json" version), not the newer release's $version.handover"

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
  [ "$(json_value "$folder/setup.json" configured)" = true ] ||
    fail "the notebook did not say the install was configured after the owner's first goal"

  # The notebook answers, and the connected chat app has one night routine.
  [ "$(tr -d ' \n\r' <"$folder/health.txt")" = 200 ] ||
    fail "the notebook answered $(tr -d ' \n\r' <"$folder/health.txt") on its own address after the update, not 200"
  local routines
  routines=$(grep -c -x -F "$ROUTINE" "$folder/routines-after.txt" || true)
  [ "$routines" = 1 ] ||
    fail "the assistant has the routine \"$ROUTINE\" $routines times after the update, not the one this release makes"

  pass "$before became $after, the stage's own commit, through godspeed-update from a checked download, with its kit-bootstrap $engine and its stage file; Update now took $version.handover over; every notebook record, the owner's own $owner_after and the chat history came through the command, the line and the button, the notebook answers, and there is one \"$ROUTINE\""
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
