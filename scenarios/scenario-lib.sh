#!/usr/bin/env bash
# The part the four proving scenarios share (scenarios/README.md says what they are).
#
# A scenario script sets SCENARIO to its own name and sources this file. Everything here is about
# the two things every one of them does the same way: installing the way a stranger does, and
# ending with exactly one line that says what it saw.
#
# THE ONE LINE. A scenario says nothing on its own output but its verdict:
#   PASS <name>: <what it saw>     exit 0
#   FAIL <name>: <one-line symptom>  exit 1
# Everything else - what it is doing, what a program it ran said - goes to the error stream, which
# is the step's log. The verdict is also appended to GITHUB_STEP_SUMMARY when there is one, as the
# jobs already in .github/workflows/scenarios.yml do, so the run's summary holds one line per
# scenario. A scenario that cannot run - a download that failed, a secret that is not set, a
# routine the notebook never made - fails with that as its symptom and never skips, because the
# release step reads a run that did not fail as "the candidate is proved".
#
# TWO PARTS. Called with the stage ref a scenario does the whole thing on a fresh machine: it
# installs, acts, writes what it saw as plain files into an evidence folder, and then judges that
# folder. Called `--check <folder>` it only judges a folder, which is what its tests do, with one
# prepared folder that should pass and one per failure it names (as stage/check-public-lines.sh
# takes a folder so its own test can show it failing). The acting part needs a throwaway machine;
# the checking part is where the scenario's judgement lives, and it needs nothing but files.
set -u
LC_ALL=C
export LC_ALL

: "${SCENARIO:?A scenario script sets SCENARIO before it sources scenario-lib.sh}"

RAW=${GODSPEED_SCENARIO_RAW:-https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control}
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# ------------------------------------------------------------------- what it says, and to whom
say() { printf '%s\n' "$*" >&2; }
verdict() {
  printf '%s\n' "$1"
  [ -z "${GITHUB_STEP_SUMMARY:-}" ] || printf '%s\n' "$1" >>"$GITHUB_STEP_SUMMARY"
}
pass() { verdict "PASS $SCENARIO: $*"; exit 0; }
fail() { verdict "FAIL $SCENARIO: $*"; exit 1; }
usage() {
  {
    printf 'usage: bash scenarios/%s.sh <stage ref>       the whole scenario, on a throwaway machine\n' "$SCENARIO"
    printf '       bash scenarios/%s.sh --check <folder>  only the checking part, against a folder\n' "$SCENARIO"
    printf 'The stage ref is a branch or tag holding stage.json: beta, main, candidate/2.0.0-beta.8.\n'
  } >&2
  exit "${1:-2}"
}

# The command line. Fills STAGE_REF, CHECK_ONLY and EVIDENCE.
# shellcheck disable=SC2034  # the scenario that sourced this file is what reads them
scenario_arguments() {
  STAGE_REF=''
  CHECK_ONLY=no
  case ${1:-} in
    '') usage 2 ;;
    -h | --help) usage 0 ;;
    --check)
      [ $# -eq 2 ] && [ -n "$2" ] || usage 2
      CHECK_ONLY=yes
      EVIDENCE=$2
      ;;
    -*) usage 2 ;;
    *)
      [ $# -eq 1 ] || usage 2
      STAGE_REF=$1
      EVIDENCE=${GODSPEED_SCENARIO_WORK:-${RUNNER_TEMP:-/tmp}}/$SCENARIO
      ;;
  esac
}

# The folder the acting part writes what it saw into, emptied first so a second run on the same
# machine cannot be judged on what the first one left.
fresh_evidence() {
  rm -rf "$EVIDENCE"
  mkdir -p "$EVIDENCE" || fail "the evidence folder $EVIDENCE could not be made"
}

# ------------------------------------------------------------------------------- the install
# THE INSTALL LINE. Character for character the one the linux-install job of
# .github/workflows/scenarios.yml runs, because "it installs the way a stranger does" is only worth
# anything while it is the same line: the stage's own copy of the installer, told which stage to
# install, traced so the checking part can see which kit-bootstrap and which starter it used.
install_the_stage_line() { # <trace file>
  say "The line, from the stage's own address: $STAGE_REF"
  curl -fsSL "$RAW/$STAGE_REF/install-godspeed.sh" | GODSPEED_STAGE_REF="$STAGE_REF" bash -x 2> >(tee "$1" >&2) ||
    fail "the install line for $STAGE_REF failed before this scenario could do anything (its trace is in the step log)"
}
# Today's public line, the one a reader copies, which installs the current public version.
install_the_public_line() {
  say "Today's public line, which installs the current public version"
  curl -fsSL https://godspeedmissioncontrol.com/install | bash ||
    fail "today's public install line failed, so there was nothing to update from"
}

# Where an install puts things (notebook/scripts/install-native-notebook.sh).
# shellcheck disable=SC2034  # the scenario that sourced this file is what reads them
install_paths() {
  ROOT=${GODSPEED_SCENARIO_ROOT:-$HOME/godspeed-v2}
  STATE=$ROOT/.godspeed
  RUNTIME=$STATE/integrated-runtime
  NOTEBOOK_PORT=${GODSPEED_PORT:-47831}
}

# THE ASSISTANT'S OWN HOME, as the install recorded it. The installer keeps the assistant where the
# shared installer put it, ~/.hermes on a stranger's machine, and makes one of its own in
# .godspeed/integrated-runtime/hermes only when it was told to sit beside an assistant already
# there (--beside, which is how the maintainer's own server was installed). Either way it writes
# the home it wired into .godspeed/assistant.json, which is where the notebook itself looks for it.
# Until 27 October 2026 the scenarios named the second folder by hand, so on a fresh machine they
# looked for the settings and the chat store where no install of a stranger's puts them, and all
# four failed on the candidate before they had seen anything. Read after every run of a line,
# because an update is the one thing that could move it.
assistant_home() {
  local home
  home=$(json_value "$STATE/assistant.json" home) ||
    fail "the install recorded no home for its assistant ($STATE/assistant.json names none), so its settings and its chat store cannot be found"
  [ -n "$home" ] && [ -d "$home" ] ||
    fail "the install recorded '$home' as its assistant's home, and there is no such folder"
  HERMES=$home
  say "The assistant's home, as the install recorded it: $HERMES"
}
# What the assistant's home holds, for the step log, when something that should be in it is not.
show_assistant_home() {
  say "  the assistant's home ($HERMES) holds: $(find "$HERMES" -mindepth 1 -maxdepth 1 -printf '%f ' 2>/dev/null)"
}

# ------------------------------------------------------------- the AI, and the assistant's chat
# The two scenarios that need the assistant's chat store need an AI as well, named by the job:
#   GODSPEED_SCENARIO_AI_KEY    the key (the release step names the repository secret; without it: FAIL)
#   GODSPEED_SCENARIO_AI_URL    the service's address, OpenRouter by default
#   GODSPEED_SCENARIO_AI_MODEL  the model
AI_URL=${GODSPEED_SCENARIO_AI_URL:-https://openrouter.ai/api/v1}
AI_MODEL=${GODSPEED_SCENARIO_AI_MODEL:-anthropic/claude-sonnet-4.5}
need_the_ai_key() { # <what it is needed for>
  [ -n "${GODSPEED_SCENARIO_AI_KEY:-}" ] ||
    fail "GODSPEED_SCENARIO_AI_KEY is not in this job's environment, and $1 needs an AI model, so this scenario cannot run"
}
# The AI connected the way Settings connects it (core/routine-ai.mjs writes it into the assistant's
# own config.yaml and .env, which is where the assistant reads it), with the installed version's own
# code.
connect_the_ai() {
  local version
  version=$(cat "$RUNTIME/version") || fail "the install left no version file behind"
  "$NODE" -e '
const [module_,home,state,url,key,model]=process.argv.slice(1);
import(require("url").pathToFileURL(module_).href).then(m=>{
 m.connectRoutineAI({home,state,config:{url,key,model}});
}).catch(error=>{console.error(error.message);process.exit(1);});
' "$RUNTIME/versions/$version/notebook/core/routine-ai.mjs" "$HERMES" "$STATE" \
    "$AI_URL" "$GODSPEED_SCENARIO_AI_KEY" "$AI_MODEL" ||
    fail "the AI could not be connected to the assistant (model $AI_MODEL at $AI_URL)"
  say "The assistant thinks with $AI_MODEL at $AI_URL"
}

# THE ASSISTANT'S OWN CHAT STORE, made by the assistant. A fresh install has none: the assistant
# makes state.db the first time it keeps a conversation (the first message of a chat app, a chat
# in its terminal), and a stranger's machine has had none yet; the candidate's run on 27 October
# 2026 found its home without one after five minutes. The scenarios never make the store or its
# tables themselves (night-tidy-chat.mjs says why), so the assistant keeps one conversation of its
# own first, through its own command, with the AI connect_the_ai gave it: that is what makes the
# store, its tables and one row of each the way the assistant itself writes them, which the chat
# seeded afterwards takes as its template.
assistant_keeps_a_conversation() { # <file for what it said>
  local executable
  executable=$(json_value "$STATE/assistant.json" executable) ||
    fail "the install recorded no command for its assistant ($STATE/assistant.json names none), so it could keep no conversation"
  say "The assistant keeps one conversation of its own, through its own command ($executable chat)"
  (cd "$ROOT" && HERMES_HOME="$HERMES" timeout 600 "$executable" chat -q 'Reply with the single word Hello.' -Q </dev/null) \
    >"$1" 2>&1
  local code=$?
  sed 's/^/  | /' "$1" >&2
  [ "$code" -eq 0 ] ||
    fail "the assistant could not keep a conversation with the AI connected to it (it ended $code; its words are in the step log), so it made no chat store"
  [ -f "$HERMES/state.db" ] || {
    show_assistant_home
    fail "the assistant kept a conversation and made no chat store ($HERMES/state.db is not there), so no chat could be seeded"
  }
}

# Node: the one the install carries (22.19, which has node:sqlite) before any other, so the
# scenario reads the assistant's chat store with the runtime the product itself runs on.
node_bin() {
  local found=''
  if [ -n "${GODSPEED_SCENARIO_NODE:-}" ]; then
    printf '%s\n' "$GODSPEED_SCENARIO_NODE"
    return 0
  fi
  if [ -n "${RUNTIME:-}" ] && [ -d "$RUNTIME/runtime" ]; then
    found=$(find "$RUNTIME/runtime" -maxdepth 3 -path '*/node-v*/bin/node' 2>/dev/null | sort | tail -n 1)
  fi
  [ -n "$found" ] || found=$(command -v node 2>/dev/null || true)
  [ -n "$found" ] || return 1
  printf '%s\n' "$found"
}
# Set once by the checking part, so a missing node is one symptom and not four.
need_node() {
  NODE=$(node_bin) || fail "node is not on this machine and the install carries none, so nothing the scenario kept can be read"
}

# ------------------------------------------------------------------- reading what was kept
# ONE KEY OF A SETTINGS FILE, read by a reader of this script's own. The assistant's config.yaml is
# the block layout the notebook and the assistant both write (two spaces a level, one key a line),
# which is the layout notebook/core/hermes-config.mjs relies on as well; reading it here rather
# than importing the product's own reader is on purpose, so the scenario is not the change checking
# itself. Exit 0 and the value (empty for a section), 1 when the key is not there, 3 when the file
# cannot be read.
# shellcheck disable=SC2016  # a JavaScript program, which this shell must not expand
CONFIG_READER='
const fs=require("fs");
const want=process.argv[2].split(".");
let text;try{text=fs.readFileSync(process.argv[1],"utf8").replace(/^﻿/,"").replace(/\r\n/g,"\n");}catch{process.exit(3);}
const stack=[];
for(const raw of text.split("\n")){
 if(!raw.trim()||/^\s*#/.test(raw))continue;
 const m=/^(\s*)([A-Za-z0-9_.-]+)\s*:(.*)$/.exec(raw);
 if(!m)continue;
 const level=Math.floor(m[1].length/2);
 if(level>stack.length)continue;
 stack.length=level;stack.push(m[2]);
 if(stack.length!==want.length||stack.some((k,i)=>k!==want[i]))continue;
 let value=m[3].trim();
 if(/^["]/.test(value)||/^[\x27]/.test(value))value=value.replace(/^(["\x27])([\s\S]*)\1$/,"$2");
 else value=value.replace(/\s+#.*$/,"");
 process.stdout.write(value);process.exit(0);
}
process.exit(1);
'
config_value() { # <file> <dotted key>
  "$NODE" -e "$CONFIG_READER" "$1" "$2"
}
# One value of a JSON file, by a dotted path. Same exit codes.
# shellcheck disable=SC2016  # a JavaScript program, which this shell must not expand
JSON_READER='
const fs=require("fs");
let at;try{at=JSON.parse(fs.readFileSync(process.argv[1],"utf8").replace(/^﻿/,""));}catch{process.exit(3);}
for(const key of process.argv[2].split(".")){
 if(at===null||typeof at!=="object"||!(key in at))process.exit(1);
 at=at[key];
}
process.stdout.write(at===null?"null":typeof at==="object"?JSON.stringify(at):String(at));
'
json_value() { # <file> <dotted path>
  "$NODE" -e "$JSON_READER" "$1" "$2"
}

# The file the evidence folder has to hold, or one plain sentence about what is missing.
kept() { # <folder> <file> <what it should have been>
  [ -s "$1/$2" ] || fail "$2 is not in what the scenario kept: $3"
}
# One key of a settings file, with the value it has to hold.
want_config() { # <file> <dotted key> <value> <what the file is>
  local got code
  got=$(config_value "$1" "$2")
  code=$?
  [ "$code" -ne 3 ] || fail "$4 could not be read at all"
  [ "$code" -ne 1 ] || fail "$2 is not in $4, so it was never written"
  [ "$got" = "$3" ] || fail "$2 is $got in $4, not $3"
}
# One key a settings file must not hold at all.
want_no_config() { # <file> <dotted key> <what the file is> <why it must be gone>
  local code
  config_value "$1" "$2" >/dev/null
  code=$?
  [ "$code" -ne 3 ] || fail "$3 could not be read at all"
  [ "$code" -eq 1 ] || fail "$2 is still in $3, and $4"
}
# One value of a JSON file, with the value it has to hold.
want_json() { # <file> <dotted path> <value> <what the file is>
  local got code
  got=$(json_value "$1" "$2")
  code=$?
  [ "$code" -ne 3 ] || fail "$4 is not readable JSON"
  [ "$code" -ne 1 ] || fail "$2 is not in $4"
  [ "$got" = "$3" ] || fail "$2 is '$got' in $4, not '$3'"
}
# How often a sentence is in a file. "Once" is a count, not a look.
times_in() { # <file> <text>
  grep -o -F -- "$2" "$1" 2>/dev/null | grep -c . || true
}

# Something that only becomes true after a while (the notebook's own tick makes the routines).
wait_for() { # <seconds> <what to say> <command...>
  local waited=0 every=5
  say "Waiting up to $1 s: $2"
  while [ "$waited" -lt "$1" ]; do
    if "${@:3}"; then
      say "  it is there after $waited s"
      return 0
    fi
    sleep "$every"
    waited=$((waited + every))
  done
  return 1
}

# The notebook the install put on this machine, run as its own command line does.
notebook_cli() { # <arguments...>
  local version
  version=$(cat "$RUNTIME/version") || fail "the install left no version file, so its notebook cannot be run"
  GODSPEED_WORKSPACE="$ROOT" GODSPEED_MEDIA_ROOT="$RUNTIME/media" \
    "$NODE" "$RUNTIME/versions/$version/notebook/bin/godspeed.mjs" "$@"
}

# The assistant's own chat store, read and seeded by scenarios/night-tidy-chat.mjs.
chat_store() { # <command> <arguments...>
  "$NODE" "$HERE/night-tidy-chat.mjs" --home "$HERMES" "$@"
}

# THE OWNER'S OWN VALUE, written the way they would write it in the assistant's settings file:
# compression.threshold_tokens, the one setting of ticket 1's five where a number of the owner's
# own is a real choice (a true/false key only ever holds Godspeed's value or the assistant's). It
# is changed in place where it is there, added under compression: where the section is, and the
# section made where it is not.
owner_sets_threshold() { # <config file> <value>
  local file=$1 value=$2
  if config_value "$file" compression.threshold_tokens >/dev/null; then
    sed -i "s/^\([[:space:]]*\)threshold_tokens:.*$/\1threshold_tokens: $value/" "$file"
  elif grep -q '^compression:' "$file"; then
    sed -i "/^compression:/a\  threshold_tokens: $value" "$file"
  else
    printf 'compression:\n  threshold_tokens: %s\n' "$value" >>"$file"
  fi
  [ "$(config_value "$file" compression.threshold_tokens)" = "$value" ] ||
    fail "the owner's own compression.threshold_tokens: $value could not be written into $file, so there was nothing to keep"
}
