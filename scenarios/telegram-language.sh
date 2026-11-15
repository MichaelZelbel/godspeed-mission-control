#!/usr/bin/env bash
# PROVING SCENARIO: Telegram answers in the language of the message it answers.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.15-nightly-proof-six-repairs/plan.md,
# proving scenario 4; product issue #140): on an install whose assistant was wired by the product,
# a reply the model wrote in the other language than the message it answers is sent in the message's
# language. Three English journal messages of 2 November (the first begins "Track Journal:") with
# a German draft are sent in English, including the done-definition question; English, German, English
# in one chat each follow the message they answer; a scheduled (cron) delivery is untouched.
#
# THROUGH THE INSTALLED HERMES. The plugins the install wired are loaded by Hermes' own plugin
# manager, the incoming message is written into Hermes' own session store, the draft goes through
# Hermes' own transform_llm_output hook (the first replacement wins, as in its turn finalizer), and the
# result goes through Hermes' own Telegram adapter's send into a stand-in bot. Only the Telegram
# account and the model's draft are stood in for (telegram-through-hermes.py says how).
#
#   bash scenarios/telegram-language.sh candidate/2.0.0-beta.15   on a throwaway machine, the install line
#   GODSPEED_SCENARIO_PRODUCT=<a checkout> bash scenarios/telegram-language.sh local
#       the builder's copy: this checkout is installed and its assistant wired by its own
#       wire-assistant.mjs, into folders of its own. Needs a Hermes it can run (GODSPEED_SCENARIO_HERMES
#       names its launcher; or GODSPEED_SCENARIO_HERMES_PYTHON and GODSPEED_SCENARIO_HERMES_SOURCE).
#   bash scenarios/telegram-language.sh --check <folder>
#
# THE AI that translates is the one connected in Settings. On a candidate that is the job's:
#   GODSPEED_SCENARIO_AI_KEY (and _URL, _MODEL), without which it FAILS. In the builder's copy without
#   that key, a stand-in on 127.0.0.1 translates the seven texts of telegram-language-cases.json, and the
#   verdict says "stand-in AI".
#
# What it keeps for its checking part:
#   turns.json   per case: the message, the draft, the text the hook made, whether it was delivered, the
#                text that reached the bot; "_plugins" is what Hermes loaded
#   config.yaml  the assistant's settings          godspeed-reply.log  the plugin's own log
#   ai.txt       which AI translated
SCENARIO=telegram-language
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"

CASES=$HERE/telegram-language-cases.json
STAND_IN_PORT=${GODSPEED_SCENARIO_STAND_IN_PORT:-47981}

# The assistant's own Python and source folder, as the product itself finds them (an installed one).
assistant_python() {
  local version executable source_root
  version=$(cat "$RUNTIME/version") || fail "the install left no version file behind"
  executable=$(json_value "$STATE/assistant.json" executable) ||
    fail "this install's notebook has no assistant of its own, so a reply has nothing to go through"
  source_root=$(json_value "$STATE/assistant.json" sourceRoot) || source_root=''
  "$NODE" -e '
const [module_,executable,sourceRoot,home]=process.argv.slice(1);
import(require("url").pathToFileURL(module_).href).then(m=>{
 const {python,source}=m.hermesPython({executable,sourceRoot:sourceRoot||undefined,home});
 process.stdout.write(JSON.stringify({python:python||"",source:source||sourceRoot||""}));
}).catch(error=>{console.error(error.message);process.exit(1);});
' "$RUNTIME/versions/$version/notebook/core/runtime.mjs" "$executable" "$source_root" "$HERMES"
}

# The builder's copy: the Python and source of a Hermes found by its launcher, which is a script that
# execs the real one, which execs the Python (-I -c ...) with the source folder two levels above it.
local_hermes() { # sets PYTHON and SOURCE
  PYTHON=${GODSPEED_SCENARIO_HERMES_PYTHON:-}
  SOURCE=${GODSPEED_SCENARIO_HERMES_SOURCE:-}
  if [ -z "$PYTHON" ] || [ -z "$SOURCE" ]; then
    local launcher=${GODSPEED_SCENARIO_HERMES:-$(command -v hermes 2>/dev/null || true)} inner
    [ -n "$launcher" ] && [ -f "$launcher" ] ||
      fail "no Hermes to run in this copy: set GODSPEED_SCENARIO_HERMES to its launcher, so this scenario cannot run here"
    inner=$(sed -n 's/^exec \(\/[^ ]*\) "\$@".*/\1/p' "$launcher" | head -n 1)
    [ -n "$inner" ] || inner=$launcher
    PYTHON=$(sed -n 's/^exec \(\/[^ ]*\) .*/\1/p' "$inner" | head -n 1)
    SOURCE=$(cd "$(dirname "$inner")/../.." 2>/dev/null && pwd)
  fi
  [ -x "$PYTHON" ] || fail "the Hermes launcher leads to no Python I can run ($PYTHON)"
  [ -f "$SOURCE/hermes_state.py" ] || fail "the Hermes launcher leads to no Hermes source folder ($SOURCE)"
}

# The AI the person connected, for the builder's copy: a stand-in endpoint when there is no key.
# The notebook's own record of it (.godspeed/provider.json) is what godspeed-model reads where no
# Hermes descriptor was installed.
connect_the_local_ai() {
  local url key model
  if [ -n "${GODSPEED_SCENARIO_AI_KEY:-}" ]; then
    check_the_ai_settings
    url="${AI_URL%/}/chat/completions" key=$GODSPEED_SCENARIO_AI_KEY model=$AI_MODEL
    echo "the connected AI ($AI_MODEL)" >"$EVIDENCE/ai.txt"
  else
    "$NODE" -e '
const fs=require("fs");const table={};
for(const c of JSON.parse(fs.readFileSync(process.argv[1],"utf8")))table[c.draft]=c.translation;
fs.writeFileSync(process.argv[2],JSON.stringify(table));' "$CASES" "$EVIDENCE/stand-in-table.json" ||
      fail "the stand-in AI's table could not be made"
    python3 "$HERE/telegram-through-hermes.py" serve --port "$STAND_IN_PORT" --table "$EVIDENCE/stand-in-table.json" \
      2>"$EVIDENCE/stand-in.log" &
    STAND_IN_PID=$!
    # shellcheck disable=SC2064
    trap "kill $STAND_IN_PID 2>/dev/null" EXIT
    url="http://127.0.0.1:$STAND_IN_PORT/v1/chat/completions" key=stand-in model=stand-in
    echo "stand-in AI" >"$EVIDENCE/ai.txt"
    sleep 1
  fi
  "$NODE" -e 'require("fs").writeFileSync(process.argv[1],JSON.stringify({url:process.argv[2],key:process.argv[3],model:process.argv[4]}),{mode:0o600})' \
    "$STATE/provider.json" "$url" "$key" "$model" || fail "the AI could not be connected in the builder's copy"
}

act() {
  fresh_evidence
  local python source
  if [ -n "${GODSPEED_SCENARIO_PRODUCT:-}" ]; then
    local work=${GODSPEED_SCENARIO_WORK:-${RUNNER_TEMP:-/tmp}}
    GODSPEED_SCENARIO_ROOT=$work/telegram-language-mission-control
    install_paths
    rm -rf "$ROOT" "$work/telegram-language-assistant"
    local_install_into "$ROOT" "$NOTEBOOK_PORT" "$EVIDENCE/install-trace.log"
    need_node
    HERMES=$work/telegram-language-assistant
    mkdir -p "$HERMES"
    say "The assistant wired by the product's own wire-assistant.mjs into $HERMES"
    GODSPEED_WORKSPACE="$ROOT" GODSPEED_PORT="$NOTEBOOK_PORT" GODSPEED_DEVICE=local \
      "$NODE" "$GODSPEED_SCENARIO_PRODUCT/notebook/scripts/wire-assistant.mjs" "$HERMES" >"$EVIDENCE/wire.log" 2>&1 ||
      fail "the product could not wire an assistant (wire.log in the evidence folder)"
    sed 's/^/  | /' "$EVIDENCE/wire.log" >&2
    local_hermes
    python=$PYTHON source=$SOURCE
    connect_the_local_ai
  else
    install_paths
    install_the_stage_line "$EVIDENCE/install-trace.log"
    need_node
    assistant_home
    need_the_ai_key "the translation of a reply"
    connect_the_ai
    echo "the connected AI ($AI_MODEL)" >"$EVIDENCE/ai.txt"
    local found
    found=$(assistant_python) || fail "the assistant's own Python could not be found on this install"
    python=$(printf '%s' "$found" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).python))')
    source=$(printf '%s' "$found" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).source))')
    [ -n "$python" ] && [ -f "$python" ] || fail "the assistant's own Python is not on this machine"
  fi
  cp "$HERMES/config.yaml" "$EVIDENCE/config.yaml" || fail "the assistant has no settings file ($HERMES/config.yaml)"
  say "Replies through the installed Hermes: $python (source ${source:-none})"
  "$python" "$HERE/telegram-through-hermes.py" drive --home "$HERMES" --source "$source" \
    --cases "$CASES" --out "$EVIDENCE/turns.json" 2>"$EVIDENCE/drive.log" ||
    { sed 's/^/  | /' "$EVIDENCE/drive.log" >&2; fail "the replies did not go through the installed Hermes (its words are in the step log): $(tail -n 1 "$EVIDENCE/drive.log")"; }
  cp "$HERMES/logs/godspeed-reply.log" "$EVIDENCE/godspeed-reply.log" 2>/dev/null ||
    fail "the reply plugin wrote no log ($HERMES/logs/godspeed-reply.log), so it never saw a reply"
}

# Whether a text is plainly English or plainly German, by words only the one language has.
is_english() { grep -qiwE 'the|you|what|how|it|are|and|that|will|does|done' <<<"$1" && ! grep -qiwE 'du|dass|woran|ist|und|nicht|ich|die|der|das' <<<"$1"; }
is_german() { grep -qiwE 'du|dass|woran|ist|und|nicht|ich|die|der|das' <<<"$1" && ! grep -qiwE 'the|you|what|how|are|that|will|does|done' <<<"$1"; }

# What the plugin's own log says about the replies it did not correct: its result and, for a failed
# translation, why each try failed (godspeed-model's own error words). With a case's name, only the
# lines that sent what reached the bot in that case. Empty when the log has nothing to add; it never changes the verdict.
plugin_said() { # <evidence folder> [case]
  "$NODE" -e '
const fs=require("fs");const [folder,name]=process.argv.slice(1);
let sent=null;
if(name){try{sent=(JSON.parse(fs.readFileSync(folder+"/turns.json","utf8"))[name]||{}).sent??null;}catch{}}
const said=new Set();
for(const line of fs.readFileSync(folder+"/godspeed-reply.log","utf8").split("\n")){
 let e;try{e=JSON.parse(line);}catch{continue;}
 if(!e||e.result==="corrected"||e.result==="scheduled")continue;
 if(sent!==null&&e.sent!==sent)continue;
 said.add(String(e.result)+(Array.isArray(e.failed_tries)&&e.failed_tries.length?" (tries: "+e.failed_tries.join(" | ")+")":""));
}
if(said.size)process.stdout.write("; the plugin logged: "+[...said].join("; "));
' "$1" "${2:-}" 2>/dev/null || true
}

check() { # <evidence folder>
  local folder=$1 name sent draft
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of a reply"
  need_node
  for file in turns.json config.yaml godspeed-reply.log ai.txt; do
    kept "$folder" "$file" "what the replies went through and what reached the bot"
  done
  grep -q 'godspeed-reply' "$folder/config.yaml" ||
    fail "godspeed-reply is not in the assistant's settings, so the install never enabled the plugin"
  json_value "$folder/turns.json" _plugins | grep -q 'godspeed-reply' ||
    fail "Hermes did not load godspeed-reply (it loaded: $(json_value "$folder/turns.json" _plugins)), so nothing checked the language"

  for name in j1 j2 j3 chat-en-1 chat-de chat-en-2 cron; do
    want_json "$folder/turns.json" "$name.delivered" true "what reached the bot in case $name"
  done
  # Three English journal messages with a German draft: English, and not the German question.
  for name in j1 j2 j3; do
    sent=$(json_value "$folder/turns.json" "$name.sent")
    is_english "$sent" || fail "the English journal message $name was answered in something other than English: $sent$(plugin_said "$folder" "$name")"
    case $sent in *"Woran merkst"*) fail "the English journal message $name still got the German question: $sent$(plugin_said "$folder" "$name")" ;; esac
  done
  # English, German, English in one chat, each following its message.
  sent=$(json_value "$folder/turns.json" chat-en-1.sent)
  is_english "$sent" || fail "the first English message in the chat was not answered in English: $sent$(plugin_said "$folder" chat-en-1)"
  sent=$(json_value "$folder/turns.json" chat-de.sent)
  is_german "$sent" || fail "the German message in the chat was not answered in German: $sent$(plugin_said "$folder" chat-de)"
  sent=$(json_value "$folder/turns.json" chat-en-2.sent)
  is_english "$sent" || fail "the English message after the German one was not answered in English: $sent$(plugin_said "$folder" chat-en-2)"
  # A scheduled delivery is exactly what was drafted.
  sent=$(json_value "$folder/turns.json" cron.sent)
  draft=$(json_value "$folder/turns.json" cron.draft)
  [ "$sent" = "$draft" ] || fail "a scheduled delivery was changed: it was drafted as '$draft' and sent as '$sent'"
  # The plugin's own log: six corrections, one scheduled, one line per reply.
  local corrected scheduled lines
  corrected=$(times_in "$folder/godspeed-reply.log" '"result": "corrected"')
  scheduled=$(times_in "$folder/godspeed-reply.log" '"result": "scheduled"')
  lines=$(grep -c . "$folder/godspeed-reply.log")
  [ "$corrected" = 6 ] || fail "the plugin's log records $corrected corrections, not 6 (three journal turns and three turns of the chat)$(plugin_said "$folder")"
  [ "$scheduled" = 1 ] || fail "the plugin's log records $scheduled scheduled deliveries left alone, not 1"
  [ "$lines" = 7 ] || fail "the plugin's log has $lines lines for 7 replies"

  pass "through the installed Hermes hook and its Telegram send path (AI: $(cat "$folder/ai.txt")), three English journal messages with a German draft were sent in English, English, German, English in one chat each followed its message, and a cron delivery was sent as drafted; the plugin logged 6 corrections, 1 scheduled and 7 lines for 7 replies"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
