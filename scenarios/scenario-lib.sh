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
# TWO PARTS. Called directly with the stage ref a scenario installs, acts, writes what it saw as
# plain files into an evidence folder, and then judges that folder. Candidate and nightly runners
# may instead provide one already-installed system and restore its mutable state before each
# scenario; update and move scenarios keep their own installation. Called `--check <folder>` it
# only judges a folder, which is what its tests do, with one prepared folder that should pass and
# one per failure it names. The checking part is where the scenario's judgement lives, and it
# needs nothing but files.
set -u
LC_ALL=C
export LC_ALL

: "${SCENARIO:?A scenario script sets SCENARIO before it sources scenario-lib.sh}"

GH_RAW=https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control
# Where the stage's files are read from: GitHub, or (a night on main, scenarios/stage-for-run.sh)
# a folder holding the commit's own stage as file://. Only the stage's own ref lives there.
RAW=${GODSPEED_SCENARIO_RAW:-$GH_RAW}
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)

# ------------------------------------------------------------------- what it says, and to whom
say() { printf '%s\n' "$*" >&2; }
verdict() {
  printf '%s\n' "$1"
  [ -z "${GITHUB_STEP_SUMMARY:-}" ] || printf '%s\n' "$1" >>"$GITHUB_STEP_SUMMARY"
  if [ -n "${EVIDENCE:-}" ] && [ -d "$EVIDENCE" ]; then
    printf '%s\n' "$1" >"$EVIDENCE/.result.tmp" && mv -f "$EVIDENCE/.result.tmp" "$EVIDENCE/result.txt" || return 1
  fi
  if [ -n "${GODSPEED_SCENARIO_RESULTS:-}" ]; then
    mkdir -p "$GODSPEED_SCENARIO_RESULTS" || return 1
    local result tmp
    result=$GODSPEED_SCENARIO_RESULTS/$SCENARIO.txt
    tmp=$(mktemp "$GODSPEED_SCENARIO_RESULTS/.${SCENARIO}.XXXXXX") || return 1
    printf '%s\n' "$1" >"$tmp" && mv -f "$tmp" "$result"
  fi
}
pass() { verdict "PASS $SCENARIO: $*"; exit 0; }
fail() {
  if [ -n "${SCENARIO_INTERACTION:-}" ] && [ -n "${EVIDENCE:-}" ]; then
    printf 'FAIL %s: %s: %s\n' "$SCENARIO" "$SCENARIO_INTERACTION" "$*" | tee -a "$EVIDENCE/steps.tsv" >&2
  fi
  verdict "FAIL $SCENARIO: $*"
  exit 1
}
interaction_begin() { SCENARIO_INTERACTION=$1; }
interaction_passed() {
  printf 'PASS %s: %s\n' "$SCENARIO" "$1" | tee -a "$EVIDENCE/steps.tsv" >&2
  SCENARIO_INTERACTION=''
}
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
      if [ $# -ne 2 ] || [ -z "$2" ]; then usage 2; fi
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
  if [ "${GODSPEED_SCENARIO_REUSE_INSTALL:-}" = 1 ]; then
    install_paths
    [ -s "$RUNTIME/version" ] || fail "the pooled native install has no runtime version"
    curl -fsS "http://127.0.0.1:$NOTEBOOK_PORT/health" >/dev/null 2>&1 ||
      fail "the pooled native install does not answer on $NOTEBOOK_PORT"
    printf 'reused candidate runtime %s\n' "$(cat "$RUNTIME/version")" >"$1" ||
      fail "the pooled native install trace could not be kept"
    return
  fi
  say "The line, from the stage's own address: $STAGE_REF"
  curl -fsSL "$RAW/$STAGE_REF/install-godspeed.sh" | GODSPEED_STAGE_REF="$STAGE_REF" GODSPEED_STAGE_RAW="$RAW" bash -x 2> >(tee "$1" >&2) ||
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
assistant_home() { # [failure context]
  local home context=${1:+$1: }
  home=$(json_value "$STATE/assistant.json" home) ||
    fail "${context}the install recorded no home for its assistant ($STATE/assistant.json names none), so its settings and its chat store cannot be found"
  if [ -z "$home" ] || [ ! -d "$home" ]; then
    fail "${context}the install recorded '$home' as its assistant's home, and there is no such folder"
  fi
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
#   GODSPEED_SCENARIO_AI_URL    the service's address (a repository variable; no default)
#   GODSPEED_SCENARIO_AI_MODEL  the model (a repository variable; no default)
# There is no default for either on purpose: a default once sent the checks to a paid model on the
# owner's OpenRouter account. The checks use https://api.anthropic.com/v1 and claude-haiku-4-5, and
# they refuse openrouter.ai altogether.
AI_URL=${GODSPEED_SCENARIO_AI_URL:-}
AI_MODEL=${GODSPEED_SCENARIO_AI_MODEL:-}
check_the_ai_settings() {
  [ -n "$AI_URL" ] || fail "GODSPEED_SCENARIO_AI_URL is not set in this job's environment (a repository variable), so the checks do not know which AI service to use"
  [ -n "$AI_MODEL" ] || fail "GODSPEED_SCENARIO_AI_MODEL is not set in this job's environment (a repository variable), so the checks do not know which AI model to use"
  case "$(printf '%s' "$AI_URL" | tr 'A-Z' 'a-z')" in
    https://*) ;;
    *) fail "GODSPEED_SCENARIO_AI_URL must be an https address, because the AI key is sent to it; use https://api.anthropic.com/v1" ;;
  esac
  case "$(printf '%s' "$AI_URL" | tr 'A-Z' 'a-z')" in
    *openrouter.ai*) fail "GODSPEED_SCENARIO_AI_URL points at openrouter.ai, and the checks must never spend the owner's OpenRouter money; use https://api.anthropic.com/v1" ;;
  esac
}
need_the_ai_key() { # <what it is needed for>
  check_the_ai_settings
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

# ------------------------------------------------- the diagnosis of a failed AI request (issue #127)
# The notebook tells the reader only that the AI request failed, and keeps the diagnosis, with the
# keys taken out, in .godspeed/ai-failures.log (notebook/core/ai-failures.mjs); the assistant keeps
# its own in logs/errors.log of its home. On a throwaway machine both are gone with it, and on 31
# October 2026 the Charm Challenge failed twice with nothing to read. A scenario that meets a failed
# AI request calls this before it says FAIL, and the job log then holds what the machine knew.
# Whatever it prints passes through a second taking-out of keys here, with the scenario's own key
# removed literally, so a diagnosis that carried the key would still not reach the log.
KEPT_DIAGNOSIS_READER='
const fs=require("fs");
const secrets=[process.env.GODSPEED_SCENARIO_AI_KEY].filter(k=>k&&k.length>=6);
const scrub=line=>{
 for(const s of secrets)line=line.split(s).join("***");
 return line
  .replace(/[\w.-]*(?:authorization|api[_-]?key|token|secret|password|passwd)[\w.-]*["'"'"']?\s*[:=]\s*["'"'"']?(?:(?:Bearer|Basic|Token)\s+)?[^\s"'"'"',;&}]+/gi,"credential: ***")
  .replace(/\b(?:Bearer|Basic)\s+\S+/gi,"***")
  .replace(/\b(?:sk|or|key|tok)[-_][A-Za-z0-9_-]{8,}/gi,"***");
};
const [file,most]=[process.argv[1],Number(process.argv[2])||40];
let text;try{text=fs.readFileSync(file,"utf8");}catch{process.exit(3);}
const lines=text.split(/\r?\n/).filter(Boolean).slice(-most);
if(!lines.length)process.exit(3);
for(const line of lines){
 let shown=line;
 try{const e=JSON.parse(line);shown=[e.at||"",e.said||"","exit "+e.exit_code,"model "+e.model,"conversation "+e.conversation].join(" | ")+"\n"+String(e.diagnosis||"");}catch{}
 process.stdout.write(shown.split("\n").map(l=>"  "+scrub(l)).join("\n")+"\n");
}
'
print_kept_diagnosis() { # [state folder] [assistant home]
  local state=${1:-${STATE:-}} home=${2:-${HERMES:-}} node=${NODE:-} shown=no
  [ -n "$node" ] || node=$(command -v node 2>/dev/null || true)
  if [ -z "$node" ]; then
    say "No diagnosis printed: node is not on this machine, and a diagnosis is not printed without taking the keys out"
    return 0
  fi
  if [ -z "$home" ] && [ -n "$state" ] && [ -f "$state/assistant.json" ]; then
    home=$("$node" -e "$JSON_READER" "$state/assistant.json" home 2>/dev/null || true)
  fi
  if [ -n "$state" ] && [ -s "$state/ai-failures.log" ]; then
    say "THE NOTEBOOK'S KEPT DIAGNOSIS OF ITS FAILED AI REQUESTS ($state/ai-failures.log, newest last, keys taken out):"
    "$node" -e "$KEPT_DIAGNOSIS_READER" "$state/ai-failures.log" 5 >&2 && shown=yes
  fi
  if [ -n "$home" ] && [ -s "$home/logs/errors.log" ]; then
    say "THE ASSISTANT'S OWN ERROR LOG ($home/logs/errors.log, its last 40 lines, keys taken out):"
    tail -n 40 "$home/logs/errors.log" | "$node" -e '
const fs=require("fs");const secrets=[process.env.GODSPEED_SCENARIO_AI_KEY].filter(k=>k&&k.length>=6);
for(let line of fs.readFileSync(0,"utf8").split(/\r?\n/)){
 if(!line)continue;
 for(const s of secrets)line=line.split(s).join("***");
 line=line.replace(/[\w.-]*(?:authorization|api[_-]?key|token|secret|password|passwd)[\w.-]*["'"'"']?\s*[:=]\s*["'"'"']?(?:(?:Bearer|Basic|Token)\s+)?[^\s"'"'"',;&}]+/gi,"credential: ***").replace(/\b(?:Bearer|Basic)\s+\S+/gi,"***").replace(/\b(?:sk|or|key|tok)[-_][A-Za-z0-9_-]{8,}/gi,"***");
 process.stdout.write("  "+line.slice(0,600)+"\n");
}' >&2 && shown=yes
  fi
  [ "$shown" = yes ] || say "No kept diagnosis was found (neither $state/ai-failures.log nor the assistant's logs/errors.log has anything)"
  return 0
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

# The notebook remembers the id of a routine it made; Hermes keeps the jobs themselves. Read both
# of those records through this one boundary, since Hermes has used both a bare array and {jobs:[]}
# for its job file. With no remembered job, this follows the scheduler's name-and-script fallback,
# which leaves an owner's same-named routine alone.
installed_routine_script() { # <jobs json> <notebook routines json> <notebook key|-> <name or pattern> <product script|->
  "$NODE" -e '
const fs=require("fs");
const read=file=>{try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch{return null;}};
const rows=data=>Array.isArray(data)?data:(data&&Array.isArray(data.jobs)?data.jobs:[]);
const [jobsFile,routinesFile,key,name,productScript]=process.argv.slice(1);
const jobs=rows(read(jobsFile)).filter(job=>job&&typeof job==="object"&&typeof job.script==="string"&&job.script);
const routines=rows(read(routinesFile)).filter(job=>job&&typeof job==="object");
const remembered=key==="-"?null:routines.find(job=>job.key===key&&typeof job.id==="string"&&job.id);
const owned=remembered&&jobs.find(job=>job.id===remembered.id);
let fallback;
if(productScript==="-")try{const pattern=new RegExp(name,"i");fallback=jobs.find(job=>pattern.test(String(job.name||"")));}catch{}
else fallback=jobs.find(job=>job.name===name&&job.script===productScript);
const job=owned||fallback;
if(job)process.stdout.write(job.script);
' "$1" "$2" "$3" "$4" "$5"
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

# THE MORNING BRIEF, TURNED ON AND RUN THE WAY SETTINGS RUNS IT: the routine added (POST
# /api/jobs/add, which answers the routine it made, under Hermes' id) and that routine run now (POST
# /api/jobs/run with its id, Settings' "Run now"). Since 9 October 2026 the run answers
# {"started":true} at once and goes on in the background (core/native-scheduler.mjs, startRun), so
# this waits until the brief has saved a note it had not saved before (core/briefing.mjs: source_app
# "morning-brief"). The routine is added to run once a day, so no run on its own schedule can come
# in the minutes this waits and be taken for the one asked for. It FAILS when the run could not be
# asked for, when the routine reports a finished run and no new note is there, and when <seconds>
# pass without one: a run that saved nothing is never judged on a note from before. Writes <run
# answer> and sets BRIEF_ID to the routine's id (never call it inside $(...): a fail there would end
# only that subshell); the caller reads what the notebook holds afterwards and pauses the routine.
BRIEF_NOTES_COUNTER='
const fs=require("fs");const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const rows=Array.isArray(d)?d:(d.data||[]);
process.stdout.write(String(rows.filter(n=>n&&n.source_app==="morning-brief"&&!n.is_trashed).length));
'
# The routine's own word on its last run: "last_run_at<TAB>last_status<TAB>last_error", or nothing.
BRIEF_JOB_RUN='
const fs=require("fs");const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
const rows=Array.isArray(d)?d:(d.data||[]);const job=rows.find(j=>j&&j.id===process.argv[2])||{};
const one=v=>String(v==null?"":v).replace(/\s+/g," ").trim();
process.stdout.write(job.last_run_at?[one(job.last_run_at),one(job.last_status),one(job.last_error).slice(0,300)].join("\t"):"");
'
# Fails the scenario unless the routine's record (BRIEF_JOB_RUN) says its run ended "ok" (the only
# success status in notebook/ui/src/local/routine-row.mjs): a run that did not succeed leaves the
# state as it was, and a state that did not change must never read as success.
the_run_did_not_fail() { # <record> <what the routine is>
  local status error
  status=$(printf '%s' "$1" | cut -f2)
  error=$(printf '%s' "$1" | cut -f3)
  [ "$status" = ok ] || fail "$2 ended its run as \"$status\"${error:+: $error}"
}
run_the_morning_brief() { # <run answer file> <seconds>
  local added=$EVIDENCE/.brief-added.json tables=$EVIDENCE/.brief-tables.json code id before ran
  code=$(curl -sS -o "$added" -w '%{http_code}' --max-time 300 -X POST \
    -H 'Content-Type: application/json' -d '{"kind":"morning-brief","interval_ms":86400000}' \
    "http://127.0.0.1:$NOTEBOOK_PORT/api/jobs/add") ||
    fail "the notebook could not be reached to turn its morning brief on"
  [ "$code" = 200 ] ||
    fail "the notebook would not turn its morning brief on (HTTP $code): $(tr -d '\n' <"$added" | cut -c1-200)"
  id=$(json_value "$added" data.id) && [ -n "$id" ] ||
    fail "the notebook turned its morning brief on but named no routine: $(tr -d '\n' <"$added" | cut -c1-200)"
  curl -fsS --max-time 300 -X POST -H 'Content-Type: application/json' -d '{"table":"notes"}' \
    "http://127.0.0.1:$NOTEBOOK_PORT/api/query" -o "$tables" ||
    fail "the notebook's own notes could not be read before the morning brief ran"
  before=$("$NODE" -e "$BRIEF_NOTES_COUNTER" "$tables") ||
    fail "the notebook's own notes could not be counted before the morning brief ran"
  code=$(curl -sS -o "$1" -w '%{http_code}' --max-time 600 -X POST -H 'Content-Type: application/json' \
    -d "{\"id\":$("$NODE" -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$id")}" \
    "http://127.0.0.1:$NOTEBOOK_PORT/api/jobs/run") ||
    fail "the notebook could not be reached to run its morning brief, so the morning brief never ran"
  sed 's/^/  | /' "$1" >&2
  { [ "$code" = 200 ] || [ "$code" = 202 ]; } && grep -qE '"started": *true|"results"' "$1" ||
    fail "the notebook did not run its morning brief (HTTP $code): $(tr -d '\n' <"$1" | cut -c1-200)"
  # Done when a new note is there; or when the routine says its run finished and there is none.
  brief_done() {
    curl -fsS --max-time 60 -X POST -H 'Content-Type: application/json' -d '{"table":"notes"}' \
      "http://127.0.0.1:$NOTEBOOK_PORT/api/query" -o "$tables" 2>/dev/null &&
      [ "$("$NODE" -e "$BRIEF_NOTES_COUNTER" "$tables" 2>/dev/null || echo 0)" -gt "$before" ] && return 0
    curl -fsS --max-time 60 -X POST -H 'Content-Type: application/json' -d '{"table":"jobs"}' \
      "http://127.0.0.1:$NOTEBOOK_PORT/api/query" -o "$tables" 2>/dev/null &&
      ran=$("$NODE" -e "$BRIEF_JOB_RUN" "$tables" "$id" 2>/dev/null) && [ -n "$ran" ]
  }
  ran=''
  wait_for "$2" "the morning brief (routine $id) to save its note" brief_done ||
    fail "the morning brief saved no note within $2 s of being run (its routine $id has not finished a run)"
  curl -fsS --max-time 300 -X POST -H 'Content-Type: application/json' -d '{"table":"notes"}' \
    "http://127.0.0.1:$NOTEBOOK_PORT/api/query" -o "$tables" ||
    fail "the notebook's own notes could not be read after the morning brief ran"
  if [ "$("$NODE" -e "$BRIEF_NOTES_COUNTER" "$tables" || echo 0)" -le "$before" ]; then
    # Where Hermes runs the routines (GODSPEED_ORIGINAL_RUNTIME=on, every install line), the
    # "Morning brief" routine is the assistant's morning-brief recipe (core/notebook-routines.mjs),
    # which writes brief/<day>.md; the notebook's own briefing (core/briefing.mjs, the note judged
    # here) runs only in the notebook's own runtime. Say which one ran, so the failure names it.
    local written
    written=$(find "$ROOT/brief" -maxdepth 1 -name '*.md' -newer "$1" 2>/dev/null | head -n 1)
    [ -z "$written" ] ||
      fail "the morning brief ran as the assistant's morning-brief recipe and wrote brief/$(basename "$written"), not the notebook's own briefing (core/briefing.mjs), which saved no note; on an install where Hermes runs the routines that briefing never runs, so this scenario cannot judge what the owner gets"
    fail "the morning brief ran and saved no note (its routine says: $(printf '%s' "$ran" | tr '\t' ' ' | cut -c1-300))"
  fi
  rm -f "$added" "$tables"
  # shellcheck disable=SC2034  # read by the scenario that sourced this file
  BRIEF_ID=$id
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

# ======================================================= TWO COMPUTERS, AND THE REMINDERS ON THEM
# The six scenarios of 2.0.0-beta.12 (reminders and their closings live in the notebook) need what
# the four before them did not: a second computer, a reminder's own commands, and the notebook's
# sync run the way Settings runs it. Everything below is that, and nothing below reaches into the
# product's code: a scenario runs the installed programs and reads plain files.

# A SECOND COMPUTER ON ONE MACHINE. The install line, with the two things a second installation on
# one machine needs and nothing else: its own folder (--godspeed, which install-godspeed.sh and
# kit-bootstrap both take) and its own port (GODSPEED_PORT, which install-native-notebook.sh names
# itself when another notebook already answers on 47831). Its mission control folder is its own, so
# it names itself in .godspeed/device.json (core/device-id.mjs) and the two are two computers. The
# first computer always runs the unchanged line above.
install_the_line_of_into() { # <ref> <root> <port> <trace file>
  say "The line, from that version's own address, into $2 on port $3: $1"
  local from=$GH_RAW
  [ "$1" != "$STAGE_REF" ] || from=$RAW # any other version (the one before a move) is GitHub's
  curl -fsSL "$from/$1/install-godspeed.sh" |
    GODSPEED_STAGE_REF="$1" GODSPEED_STAGE_RAW="$from" GODSPEED_PORT="$3" bash -xs -- --godspeed "$2" 2> >(tee "$4" >&2) ||
    fail "the install line for $1 into $2 failed before this scenario could do anything (its trace is in the step log)"
}
install_the_stage_line_into() { # <root> <port> <trace file>
  local root=$1 port=$2 trace=$3 shared
  if [ "${GODSPEED_SCENARIO_REUSE_INSTALL:-}" = 1 ]; then
    install_paths
    shared=$RUNTIME
    [ -s "$shared/version" ] || fail "the pooled native install has no runtime for $root"
    if [ "$root" = "$ROOT" ]; then
      install_the_stage_line "$trace"
      return
    fi
    rm -rf "$root"
    mkdir -p "$root/.godspeed" || fail "the logical workspace $root could not be made"
    cp -a "$ROOT/." "$root/" || fail "the pooled workspace could not seed logical workspace $root"
    rm -rf "$root/.godspeed/integrated-runtime"
    ln -s "$shared" "$root/.godspeed/integrated-runtime" || fail "logical workspace $root could not use the pooled runtime"
    printf 'reused candidate runtime %s on logical port %s\n' "$(cat "$shared/version")" "$port" >"$trace" ||
      fail "the logical workspace trace could not be kept"
    return
  fi
  if [ -n "${GODSPEED_SCENARIO_PRODUCT:-}" ]; then
    local_install_into "$1" "$2" "$3"
    return
  fi
  install_the_line_of_into "$STAGE_REF" "$@"
}
install_the_public_line_into() { # <root> <port>
  say "Today's public line, into $1 on port $2"
  curl -fsSL https://godspeedmissioncontrol.com/install | GODSPEED_PORT="$2" bash -s -- --godspeed "$1" ||
    fail "today's public install line into $1 failed, so there was nothing to update from"
}

# THE LAST VERSION BEFORE THE REMINDERS MOVED INTO THE NOTEBOOK, by its own tag. The scenario about
# that move (reminders-move-keeps-everything) is "an update from 2.0.0-beta.11" in the release plan
# it comes from, and said so by installing "today's public version", which was 2.0.0-beta.11 while
# that plan was being built. Since 31 October 2026 the public version is 2.0.0-beta.12, which keeps
# reminders in the notebook already: `due add` on it writes a page under Deadlines/ and no file in
# due/ at all, so from today's public line that scenario would have nothing to move. It installs the
# version before the move instead, which is what the plan asks of it and what it stays for every
# candidate after this one.
# shellcheck disable=SC2034  # the scenario that sourced this file is what reads it
BEFORE_THE_MOVE=${GODSPEED_SCENARIO_BEFORE_THE_MOVE:-candidate/2.0.0-beta.11}

# An installation's own paths and its own programs, by its folder, so one machine can run two.
runtime_of() { printf '%s/.godspeed/integrated-runtime\n' "$1"; }
# The version an installation runs. Never read inside a command substitution that would swallow a
# verdict: it fills VERSION and says so itself.
# shellcheck disable=SC2034  # the scenario that sourced this file is what reads it
read_version() { # <root>
  VERSION=$(cat "$(runtime_of "$1")/version" 2>/dev/null) || VERSION=
  [ -n "$VERSION" ] ||
    fail "the installation in $1 left no version file behind, so its own programs cannot be run"
  say "The installation in $1 runs $VERSION"
}
product_script() { # <root> <path inside the version>
  printf '%s/versions/%s/%s\n' "$(runtime_of "$1")" "$(cat "$(runtime_of "$1")/version" 2>/dev/null)" "$2"
}
# A REMINDER'S OWN COMMANDS, the one line an owner's assistant runs: add, done, target, drop, check,
# state, list, today. notebook/bin/personal-command.mjs hands them to the notebook's obligation
# command under the workspace lock (core/personal-operations.mjs, core/native-due.mjs), which is
# also how Settings and the 08:00 reminders reach them, and it is in the public version as well, so
# the same line seeds on the old version and reads on the stage.
due_on() { # <root> <arguments...>
  local root=$1
  shift
  GODSPEED_WORKSPACE="$root" "$NODE" "$(product_script "$root" notebook/bin/personal-command.mjs)" due "$@"
}
notebook_on() { # <root> <arguments...>
  local root=$1
  shift
  GODSPEED_WORKSPACE="$root" GODSPEED_MEDIA_ROOT="$(runtime_of "$root")/media" \
    "$NODE" "$(product_script "$root" notebook/bin/godspeed.mjs)" "$@"
}
# ONE SYNC ROUND, AND SETTINGS' OWN WAY OF CONNECTING A REPOSITORY. scripts/sync-worker.mjs is what
# Settings runs (core/sync/runner.mjs, server/main.mjs /api/sync/configure and /api/sync/run) and
# what the notebook's own timer runs: `<root> configure <url>` connects one, `<root>` alone is one
# round. So a scenario never carries anything with Git of its own.
sync_on() { # <root> [configure <url>]
  local root=$1
  shift
  "$NODE" "$(product_script "$root" notebook/scripts/sync-worker.mjs)" "$root" "$@"
}

# Puts a .gitignore listing NOTEBOOK.md and assistant-state/ into a bare repository as its first commit.
stand_in_ignore_file() { # <bare repository>
  local bare=$1 work
  work=$(mktemp -d) || return 1
  { git clone -q "$bare" "$work/c" 2>/dev/null &&
    printf 'NOTEBOOK.md
assistant-state/
' >"$work/c/.gitignore" &&
    git -C "$work/c" add .gitignore &&
    git -C "$work/c" -c user.name="Godspeed Scenario" -c user.email="scenario@localhost" commit -q -m "ignore file" &&
    git -C "$work/c" push -q origin HEAD:main; } >&2
  local rc=$?
  rm -rf "$work"
  return $rc
}

# ONE SYNC ROUND THAT HAS TO END SYNCED, and whose every answer is kept. The first round of a mission
# control that is its own repository sends it to a private copy that may be empty; on 2.0.0-beta.14
# that round answered "pending" and sent nothing, the answer went to a file the run did not keep, and
# the scenario went on to clone an empty repository (issue #125). So every answer is appended to
# $EVIDENCE/<mode>-rounds.txt and shown in the step log, a round that does not say "synced" is asked
# again every GODSPEED_SCENARIO_ROUND_STEP seconds (5), and one still not synced when
# GODSPEED_SCENARIO_ROUND_DEADLINE seconds (180) have passed fails the scenario with that answer.
sync_round() { # <root> <mode> <what the round does, for the symptom>
  local root=$1 mode=$2 what=$3 deadline=${GODSPEED_SCENARIO_ROUND_DEADLINE:-180} step=${GODSPEED_SCENARIO_ROUND_STEP:-5} waited=0 answer
  while :; do
    answer=$(sync_on "$root") || fail "the sync round that $what failed on $root (it could not be run at all)"
    printf '%s\n' "$answer" >>"$EVIDENCE/$mode-rounds.txt"
    say "  the sync round on $root answered: $answer"
    case $answer in *'"state":"synced"'*) return 0 ;; esac
    [ "$waited" -lt "$deadline" ] ||
      fail "the sync round that $what answered something other than synced and was still doing so at its deadline of ${deadline}s: $(printf '%s' "$answer" | tr -d '\n' | cut -c1-300)"
    sleep "$step"
    waited=$((waited + step))
  done
}

# THE BUILDER'S COPY. The install line downloads kit-bootstrap, Hermes and Node and installs
# services, so it cannot run where there is no network. With GODSPEED_SCENARIO_PRODUCT=<a checkout of
# this repository> an installation is made from that checkout instead, doing what the install does
# to the folder and nothing else: a new mission control is the starter copied into an empty folder
# with `git init -b main` and `godspeed.mjs init` (the first commit); a folder that is not empty and
# is not a mission control is refused as kit-bootstrap's kb_new_godspeed refuses it; a folder that
# has an origin is joined with `godspeed sync folder`, as install-native-notebook.sh does. The checks
# of a private GitHub address ask api.github.com, which a stand-in cannot reach, so a program loaded
# by NODE_OPTIONS answers 404 for the stand-in owner, as GitHub does for a repository nobody can see.
# The workflow never sets it, and the verdict says when it was used.
local_install_into() { # <root> <port> <trace file>
  local root=$1 product=$GODSPEED_SCENARIO_PRODUCT folder
  folder=${GODSPEED_SCENARIO_WORK:-${RUNNER_TEMP:-/tmp}}/local-product
  say "The builder's copy: installing from $product into $root, not from the install line"
  [ -f "$product/notebook/bin/godspeed.mjs" ] || fail "GODSPEED_SCENARIO_PRODUCT=$product holds no notebook/bin/godspeed.mjs"
  if [ -e "$root" ] && [ -n "$(ls -A "$root" 2>/dev/null)" ] &&
    ! { [ -d "$root/.git" ] && { [ -f "$root/AGENTS.md" ] || [ -f "$root/CLAUDE.md" ] || [ -d "$root/observations" ]; }; }; then
    fail "$root already exists and has things in it, but it is not a mission control (the installer refuses such a folder, so a second computer cloned from a copy that holds nothing cannot be set up)"
  fi
  if [ ! -d "$root/.git" ]; then
    if ! { mkdir -p "$root" && cp -a "$product/starter-godspeed/." "$root/" && git -C "$root" init -q -b main >&2; }; then
      fail "the starter could not be made into a new mission control in $root"
    fi
  fi
  mkdir -p "$root/.godspeed/integrated-runtime/versions" "$folder" || fail "the runtime folder in $root could not be made"
  ln -sfn "$product" "$root/.godspeed/integrated-runtime/versions/local" || fail "the product could not be linked into $root"
  printf 'local\n' >"$root/.godspeed/integrated-runtime/version" || fail "the version file in $root could not be written"
  cat >"$folder/github-404.mjs" <<'STUB'
// Written by scenarios/scenario-lib.sh (local_install_into): api.github.com answers 404 for the
// stand-in owner's repositories, which is what it answers for a private one asked without a key.
const real = globalThis.fetch;
globalThis.fetch = (url, ...rest) =>
  String(url).startsWith('https://api.github.com/repos/godspeed-scenario-stand-in/')
    ? Promise.resolve(new Response('{"message":"Not Found"}', { status: 404 }))
    : real(url, ...rest);
STUB
  NODE_OPTIONS="--import=file://$folder/github-404.mjs"
  export NODE_OPTIONS
  RUNTIME=$(runtime_of "$root")
  need_node
  GODSPEED_WORKSPACE="$root" "$NODE" "$product/notebook/bin/godspeed.mjs" init >"$3" 2>&1 || fail "godspeed init failed in $root (see $3)"
  if [ ! -f "$root/.godspeed/sync-config.json" ] && git -C "$root" remote get-url origin >/dev/null 2>&1; then
    notebook_on "$root" sync folder >>"$3" 2>&1 || say "The notebook was not joined to the repository in $root; it works on that computer alone until it is."
  fi
}

# THE PRIVATE GITHUB REPOSITORY, STOOD IN FOR BY ONE BARE REPOSITORY ON THIS MACHINE, the way
# notebook/test/installer-join-sync.test.mjs does it: Git is told that the GitHub address leads to
# the folder, for this process and every program it starts. The product still checks the address is
# a private GitHub one (FileSync.verifyRemote asks api.github.com and wants a 404, which an owner
# nobody has gives), and then reads it with git, which the redirect sends here. Prints the address.
stand_in_github() { # <folder>
  local folder=$1 owner=godspeed-scenario-stand-in name
  name=stand-in-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')
  mkdir -p "$folder" || fail "the folder for the stand-in repository ($folder) could not be made"
  git init -q --bare --initial-branch=main "$folder/$name.git" >&2 ||
    fail "the bare repository standing in for the private GitHub repository could not be made"
  # The ignore file a reader's own repository has: `godspeed sync folder notebook` refuses one that
  # does not list NOTEBOOK.md and assistant-state/ (issue #125).
  stand_in_ignore_file "$folder/$name.git" || fail "the stand-in repository could not be given its ignore file"
  git config --global "url.file://$folder/.insteadOf" "https://github.com/$owner/" ||
    fail "git could not be told that https://github.com/$owner/ leads to $folder"
  # A stranger's computer has a Git identity of its own; a commit without one fails.
  git config --global user.name "Godspeed Scenario" || fail "this machine's Git could not be given a name"
  git config --global user.email "scenario@localhost" || fail "this machine's Git could not be given an address"
  say "The private GitHub repository is stood in for by $folder/$name.git"
  printf 'https://github.com/%s/%s.git\n' "$owner" "$name"
}

# THE SAME STAND-IN FOR A MISSION CONTROL THAT IS ITS OWN REPOSITORY, where telling Git that the
# GitHub address leads to a folder cannot work. `godspeed sync folder` reads the address back with
# `git remote get-url` (core/sync/git.mjs useFolderRepository), and that applies the rewriting above:
# the product is handed file:///... and rightly refuses it, because a notebook joins a private
# GitHub repository and not a folder on this machine. So no rewriting is set here at all. The
# address is the SSH form of the same private repository, which the product takes exactly as it
# takes a real one (verifyRemote: https://github.com/<owner>/<name> or git@github.com:<owner>/<name>,
# the owner asked of api.github.com, which answers 404 for an owner nobody has, and then read with
# git), and git reaches the bare repository on this machine because this scenario's own `ssh` runs
# the server side here. Every call of git still goes through the git the scenario wrote down
# (git_calls_shim), including the ones this ssh makes inside the product's own sync rounds.
# NEVER CALLED INSIDE A COMMAND SUBSTITUTION: it fills STAND_IN_ADDRESS, because what tells git the
# way to that ssh is this shell's environment and a subshell would throw it away.
stand_in_github_over_ssh() { # <folder>
  local folder=$1 owner=godspeed-scenario-stand-in name
  name=stand-in-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')
  mkdir -p "$folder" || fail "the folder for the stand-in repository ($folder) could not be made"
  git init -q --bare --initial-branch=main "$folder/$name.git" >&2 ||
    fail "the bare repository standing in for the private GitHub repository could not be made"
  # No ignore file in this one: the repository stays empty, as a reader's new private repository is.
  # The two ignore lines `godspeed sync folder notebook` asks the mission control's own repository
  # for are written by the product itself when they are missing (issue #125).
  # A stranger's computer has a Git identity of its own; a commit without one fails.
  git config --global user.name "Godspeed Scenario" || fail "this machine's Git could not be given a name"
  git config --global user.email "scenario@localhost" || fail "this machine's Git could not be given an address"
  # Where each stood-in repository is, by the name in its address, so a run can have more than one.
  local stand_in=${GODSPEED_SCENARIO_WORK:-${RUNNER_TEMP:-/tmp}}/github-over-ssh-$SCENARIO
  mkdir -p "$stand_in" || fail "the folder for this scenario's own ssh ($stand_in) could not be made"
  printf '%s.git\t%s\n' "$name" "$folder/$name.git" >>"$stand_in/repositories.txt" ||
    fail "where the stand-in repository is could not be written down ($stand_in/repositories.txt)"
  if [ ! -x "$stand_in/ssh" ]; then
    # A program for another shell, written as it is: git calls ssh with the options it wants, the
    # host, and then the one command to run on the server, `git-upload-pack '<owner>/<name>.git'`.
    # The repository standing in for that name is in the list beside this program, and what git
    # itself would run on the server runs here instead.
    cat >"$stand_in/ssh" <<'STAND_IN_SSH'
#!/bin/sh
# Written by scenarios/scenario-lib.sh (stand_in_github_over_ssh): the server side of
# git@github.com, on this machine.
for argument in "$@"; do asked=$argument; done
program=${asked%% *}
repository=$(basename "$(printf '%s' "${asked#* }" | tr -d "'\"")")
here=$(awk -F'\t' -v name="$repository" '$1==name{print $2;exit}' "$(dirname "$0")/repositories.txt")
[ -n "$here" ] || { echo "no repository on this machine stands in for $repository" >&2; exit 1; }
case $program in
  git-upload-pack) exec git upload-pack "$here" ;;
  git-receive-pack) exec git receive-pack "$here" ;;
  git-upload-archive) exec git upload-archive "$here" ;;
esac
echo "this stand-in for github.com was asked for [$asked], which it cannot do" >&2
exit 1
STAND_IN_SSH
    chmod +x "$stand_in/ssh" || fail "this scenario's own ssh could not be made runnable"
  fi
  # IN THIS SHELL'S ENVIRONMENT, AND NOWHERE ELSE. GIT_SSH_COMMAND is the first thing git reads for
  # how to reach a server, and every program the scenario starts after this inherits it, the
  # product's own sync among them. Nothing is written into this machine's Git settings: a
  # core.sshCommand left behind there would send every later git over SSH, on any repository, to a
  # program in a folder this run deletes.
  GIT_SSH_COMMAND=$stand_in/ssh
  export GIT_SSH_COMMAND
  # So it cannot be read inside a command substitution, which would throw that environment away
  # with the subshell: it fills STAND_IN_ADDRESS and says what it stood in for, as read_version does
  # with the version it read.
  # shellcheck disable=SC2034  # the scenario that sourced this file is what reads it
  STAND_IN_ADDRESS=git@github.com:$owner/$name.git
  say "The private GitHub repository is stood in for by $folder/$name.git, reached as its own SSH address $STAND_IN_ADDRESS"
}

# WHAT RAN GIT, AND IN WHICH STEP. "Nobody runs Git" is the whole point of these reminders living in
# the notebook, so it is evidence and not a claim: a `git` earlier on the path writes down every
# call with the step it was made in and then runs the real one. The product's own sync runs git
# through the same path, so what a scenario has to see is a log with calls in the sync rounds and
# none in the steps. phase <name> says which step the scenario is in.
git_calls_shim() { # <log file>
  local real
  real=$(command -v git) || fail "this machine has no git at all, so two computers cannot be joined"
  GIT_CALLS=$1
  : >"$GIT_CALLS" || fail "the log of git calls ($GIT_CALLS) could not be written"
  SHIM=${GODSPEED_SCENARIO_WORK:-${RUNNER_TEMP:-/tmp}}/git-shim-$SCENARIO
  mkdir -p "$SHIM" || fail "the folder for this scenario's own git ($SHIM) could not be made"
  {
    printf '#!/bin/sh\n'
    printf '# Written by scenarios/scenario-lib.sh: every call of git, with the step it was made in.\n'
    # shellcheck disable=SC2016  # a program for another shell, which this one must not expand
    printf 'printf "%%s\\t%%s\\n" "${GODSPEED_SCENARIO_PHASE:-none}" "$*" >> "$GODSPEED_SCENARIO_GIT_CALLS"\n'
    printf 'exec "%s" "$@"\n' "$real"
  } >"$SHIM/git"
  chmod +x "$SHIM/git" || fail "this scenario's own git could not be made runnable"
  GODSPEED_SCENARIO_GIT_CALLS=$GIT_CALLS
  PATH=$SHIM:$PATH
  export GODSPEED_SCENARIO_GIT_CALLS PATH
  say "Every git call is written to $GIT_CALLS, with the step it was made in"
}
phase() { # <name>
  GODSPEED_SCENARIO_PHASE=$1
  export GODSPEED_SCENARIO_PHASE
  say "-- $1"
}

# ----------------------------------------------- what a person sees in the notebook, read as files
# A reminder is a page under notebook/Deadlines/ and a closing is a moment under notebook/Timeline/
# (core/records/layout.mjs, core/deadline-records.mjs). Both are plain Markdown with their fields
# above the text, so these read them with a reader of their own and never import the product's, for
# the reason the README gives: a scenario is never the change checking itself. Two records whose
# name would be the same get "<name> 2.md" (layout.mjs candidateName), so counting is by the title
# inside the file and never by its name.
front_matter_value() { # <file> <field>
  sed -n '/^---$/,/^---$/p' "$1" | sed -n "s/^$2:[[:space:]]*//p" | head -n 1 | sed 's/^"\(.*\)"$/\1/'
}
# One line per reminder page: <title><TAB><file name>
pages_of() { # <root> <file>
  local folder=$1/notebook/Deadlines page title
  : >"$2"
  [ -d "$folder" ] || return 0
  for page in "$folder"/*.md; do
    [ -f "$page" ] || continue
    title=$(front_matter_value "$page" title)
    printf '%s\t%s\n' "${title:-$(basename "$page" .md)}" "$(basename "$page")" >>"$2"
  done
  sort -o "$2" "$2"
}
# One line per closing moment: <kind><TAB><title><TAB><evidence><TAB><file name>
closings_of() { # <root> <file>
  local folder=$1/notebook/Timeline page kind
  : >"$2"
  [ -d "$folder" ] || return 0
  for page in "$folder"/*.md; do
    [ -f "$page" ] || continue
    kind=$(front_matter_value "$page" obligation_kind)
    [ -n "$kind" ] || continue
    printf '%s\t%s\t%s\t%s\n' "$kind" "$(front_matter_value "$page" title)" \
      "$(front_matter_value "$page" evidence)" "$(basename "$page")" >>"$2"
  done
  sort -o "$2" "$2"
}
# THE REVIEW QUEUE, where a difference the owner has to settle waits: conflicts/<id>.json in the
# mission control (core/sync/git.mjs saveReview and pendingConflicts, /api/conflicts). One line per
# item still waiting: <id><TAB>what it says.
reviews_of() { # <root> <file>
  local folder=$1/conflicts item
  : >"$2"
  [ -d "$folder" ] || return 0
  for item in "$folder"/*.json; do
    [ -f "$item" ] || continue
    grep -q '"resolved_at"[[:space:]]*:[[:space:]]*"' "$item" && continue
    printf '%s\t%s\n' "$(basename "$item" .json)" "$(tr -d '\n' <"$item" | cut -c1-400)" >>"$2"
  done
  sort -o "$2" "$2"
}
# THE NOTEBOOK'S OWN REVIEW QUEUE, which is a different thing in a different place: a suggestion
# the owner is asked about is a review_queue record of the notebook's, and that is not one of the
# types a person reads, so it is kept as notebook/_system/review_queue/<id>.json
# (core/records/layout.mjs systemPath). The reminder that changed in two places at once waits there
# (core/due-copy.mjs saves it with suggestion_type deadline_both_changed), never in conflicts/,
# which is where a difference the SYNC could not settle waits. Mistaking the one for the other is
# what this scenario did until 31 October 2026, so the folder is named here and named again where it
# is read, the way fingerprint takes the folders it is about. One line per item still waiting:
# <suggestion type><TAB><status><TAB><title><TAB><what it says>. Waiting is what the notebook calls
# waiting (core/records/store.mjs: pending, pending_review or auto_applied_unreviewed, and neither
# answered nor removed), read here with a reader of this script's own.
# shellcheck disable=SC2034  # the scenario that sourced this file is what reads it
REVIEW_QUEUE=notebook/_system/review_queue
# shellcheck disable=SC2016  # a JavaScript program, which this shell must not expand
QUEUED_REVIEWS='
const fs=require("fs"),path=require("path");
const folder=process.argv[1];let names=[];try{names=fs.readdirSync(folder);}catch{process.exit(0);}
const lines=[];
for(const name of names.sort()){
 if(!name.endsWith(".json"))continue;
 let item;try{item=JSON.parse(fs.readFileSync(path.join(folder,name),"utf8"));}catch{lines.push(["unreadable",name,"",""].join("\t"));continue;}
 const status=item.status||"pending_review";
 if(!["pending","pending_review","auto_applied_unreviewed"].includes(status))continue;
 if(item.removed_at||item.reviewed_at)continue;
 lines.push([item.suggestion_type||"",status,String(item.title||"").replace(/\s+/g," "),String(item.description||"").replace(/\s+/g," ").slice(0,400)].join("\t"));
}
process.stdout.write(lines.sort().map(l=>l+"\n").join(""));
'
queued_reviews_of() { # <the review queue's own folder: <root>/$REVIEW_QUEUE> <file>
  "$NODE" -e "$QUEUED_REVIEWS" "$1" >"$2" ||
    fail "the notebook's review queue at $1 could not be read"
}
# The bytes of every file under one or more folders, so "untouched" and "nothing changed" are
# comparisons and not looks: <sha256><TAB><path below the root>, sorted.
fingerprint() { # <root> <file> <folder below the root...>
  local root=$1 out=$2 folder
  shift 2
  : >"$out"
  for folder in "$@"; do
    [ -d "$root/$folder" ] || continue
    (cd "$root" && find "$folder" -type f -print0 | sort -z | xargs -0 -r sha256sum) |
      sed 's/[[:space:]][[:space:]]*/\t/' >>"$out"
  done
  sort -o "$out" "$out"
}
# What a scenario kept, as one list, so a missing piece is one sentence and not a crash.
kept_all() { # <folder> <what they are> <file...>
  local folder=$1 what=$2 file
  shift 2
  for file in "$@"; do
    kept "$folder" "$file" "$what"
  done
}

# ----------------------------------------- THE SET OF REMINDERS THE OLD VERSION WROTE, AND ITS DAYS
# The set of the release plan's scenario 2, which scenarios 2, 3 and 4 all start from: a deadline
# only; a target only, past its target; one with both; one whose target was moved after it was
# missed; a repeating one grown to three windows with one of them closed; one dropped; one
# hand-written file that does not read; and a key in secrets/expires.txt. Every one of them is
# written by the installed version's OWN commands, so what is seeded is what that version writes;
# the hand-written file is the one exception, because a file nobody wrote with the commands is the
# point of it.
# shellcheck disable=SC2034  # the scenarios that source this file are what read it
OLD_SET='deadline-only target-only-passed both-dates target-moved repeating-windows dropped-one does-not-read'
# The pages the move has to make of them, by their titles. The hand-written file that does not read
# is not among them: it gets no record and stays "needs a look", as it is today.
# shellcheck disable=SC2034  # the scenarios that source this file are what read it
OLD_SET_PAGES='File the VAT return
Buy a present for Anna
Send the tax papers
Book the dentist
Pay the quarterly rates
Change the insurance'
# The two closings the set holds, as closings_of prints them: <kind><TAB><title>.
# shellcheck disable=SC2034  # the scenarios that source this file are what read it
OLD_SET_CLOSINGS='closes	Done: Pay the quarterly rates
drops	Dropped: Change the insurance'

day_in() { # <days from today, + or ->
  date -u -d "$1 days" +%Y-%m-%d 2>/dev/null || date -u -v"$1"d +%Y-%m-%d
}
seed_the_old_set() { # <root>
  local root=$1
  say "The set of the plan, written by the installed version's own commands"
  due_on "$root" add deadline-only --title 'File the VAT return' --to "$(day_in +30)" \
    --cost 'A late fee of 200 euro.' --done-when 'The return shows as filed.' >&2 ||
    fail "deadline-only could not be seeded in $root"
  due_on "$root" add target-only-passed --title 'Buy a present for Anna' --target "$(day_in -5)" \
    --done-when 'The present is bought.' >&2 || fail "target-only-passed could not be seeded in $root"
  due_on "$root" add both-dates --title 'Send the tax papers' --target "$(day_in +10)" --to "$(day_in +40)" \
    --cost 'The accountant charges for the rush.' --done-when 'The papers are with the accountant.' >&2 ||
    fail "both-dates could not be seeded in $root"
  due_on "$root" add target-moved --title 'Book the dentist' --target "$(day_in -3)" \
    --done-when 'The appointment is in the calendar.' >&2 || fail "target-moved could not be seeded in $root"
  due_on "$root" target target-moved "$(day_in +5)" >&2 || fail "the new day for target-moved could not be set in $root"
  due_on "$root" add repeating-windows --title 'Pay the quarterly rates' --from "$(day_in -60)" --to "$(day_in -35)" \
    --repeats monthly --cost 'A late fee of 40 euro.' --done-when 'The payment shows on the statement.' >&2 ||
    fail "repeating-windows could not be seeded in $root"
  # Reading it is what opens the windows between its first one and today (tools/due.js growWindows).
  due_on "$root" state >/dev/null || fail "the windows of repeating-windows could not be grown in $root"
  due_on "$root" 'done' repeating-windows --evidence 'the statement of this quarter shows it' >&2 ||
    fail "the closed window of repeating-windows could not be seeded in $root"
  due_on "$root" add dropped-one --title 'Change the insurance' --to "$(day_in +20)" \
    --cost 'Another year on the old policy.' --done-when 'The new policy is signed.' >&2 ||
    fail "dropped-one could not be seeded in $root"
  due_on "$root" drop dropped-one --yes --evidence 'I am staying with the old policy' >&2 ||
    fail "dropped-one could not be dropped in $root"
  # The one nobody wrote with the commands: lines of its own invention and no window at all.
  mkdir -p "$root/due" || fail "due/ could not be written in $root"
  printf 'TITLE: Something an assistant wrote by hand\nKIND: deadline\nWHEN: soon\n' >"$root/due/does-not-read.md" ||
    fail "the hand-written file that does not read could not be written in $root"
  # A key that runs out is a reminder like any other (tools/due.js reads this file).
  mkdir -p "$root/secrets" || fail "secrets/ could not be written in $root"
  printf '# key\texpires\nscenario-api-key\t%s\n' "$(day_in +45)" >"$root/secrets/expires.txt" ||
    fail "the key in secrets/expires.txt could not be written in $root"
}

# ====================================================== THE VIDEO SKILLS, AND THE VIDEO ADD-ON
# 2.0.0-beta.13 takes every skill whose only job is making or finishing video out of the set a new
# install hands the reader (the release plan's item 2): a fresh install no longer copies it into the
# reader's skills folder, only the video add-on's own setup puts them there, and an update removes
# from an install that has them only the copies Godspeed itself put there unchanged. Two of the
# scenarios read that, so their list and their readers are here.

# THE NAMES, the plan's list of twenty-five less gsap-core and gsap-timeline, which stay in the default set (Michael, 2026-10-31, issue #124): the HyperFrames family the product had vendored
# (hyperframes and its parts, the two GSAP ones, media-use, figma, remotion-to-hyperframes, the
# nine recipes for a kind of video) and the four of our own. One name per line, so a symptom can
# say which of them it found or missed.
# shellcheck disable=SC2034  # the scenarios that source this file are what read it
VIDEO_SKILLS='hyperframes
hyperframes-animation
hyperframes-audio
hyperframes-cli
hyperframes-core
hyperframes-creative
hyperframes-keyframes
hyperframes-registry
media-use
figma
remotion-to-hyperframes
general-video
motion-graphics
faceless-explainer
music-to-video
pr-to-video
product-launch-video
slideshow
talking-head-recut
video-captions
embedded-captions
video-finishing
video-hooks'
# The skills the plan says stay, because they are about web pages and pictures and not about video.
# A scenario asks for these as well: a folder that holds none of them was never the reader's skills
# folder, and "it lists none of the video ones" would then be true of an empty room.
# shellcheck disable=SC2034  # the scenarios that source this file are what read it
VIDEO_SKILLS_KEEP='scroll-craft
web-design
social-visuals
nano-banana-images
excalidraw-diagram
excalidraw-visuals'

# THE READER'S SKILLS FOLDER, as one name per line, sorted: every folder under skills/ that holds a
# SKILL.md. That is the folder the install copies the packaged recipes into
# (notebook/bin/godspeed.mjs: skills/<name>) and the one the video add-on's own setup writes to
# (mc-video's lib.mjs, skillsRoom), so it is what "the reader's skills folder" means for both.
skills_of() { # <root> <file>
  local folder=$1/skills skill
  : >"$2"
  [ -d "$folder" ] || return 0
  for skill in "$folder"/*; do
    [ -f "$skill/SKILL.md" ] || continue
    basename "$skill" >>"$2"
  done
  sort -o "$2" "$2"
}
# Which of a list of names a skills list holds, and which it does not, as one line of names, so a
# symptom names them instead of counting them. Both read the files a scenario kept.
skills_present() { # <skills file> <names file>
  comm -12 <(sort -u "$1") <(sort -u "$2") | tr '\n' ' ' | sed 's/[[:space:]]*$//'
}
skills_missing() { # <skills file> <names file>
  comm -13 <(sort -u "$1") <(sort -u "$2") | tr '\n' ' ' | sed 's/[[:space:]]*$//'
}
how_many() { # <one line of names>
  printf '%s\n' "$1" | tr ' ' '\n' | grep -c . || true
}

# THE VIDEO ADD-ON'S OWN PROGRAM, as the install carries it, so what runs is the commit the stage
# pins and not whatever mc-video's own main holds today (a reader runs the same program through
# `npx --yes github:MichaelZelbel/mc-video`). Its own home is kept inside the installation, so two
# installations on one machine share neither HyperFrames nor a caption look.
mc_video_on() { # <root> <arguments...>
  local root=$1
  shift
  GODSPEED_VIDEO_HOME="$root/.godspeed/mc-video" \
    "$NODE" "$(product_script "$root" third-party/addons/mc-video/bin/mc-video.mjs)" "$@"
}
# The file the add-on carries beside its program, by its path inside the installed version: its
# sample clip, which is the one a scenario captions.
addon_file() { # <root> <path below third-party/addons/mc-video/>
  product_script "$1" "third-party/addons/mc-video/$2"
}

# ------------------------------------------------------------------ 2.0.0-beta.16 (additions only)
# What the three scenarios of that release share: the notebook's own clock moved to another day, a
# NEW conversation of the notebook's chat panel and a message in it, and the assistant's command log.

# A string written the way JSON writes it, so the owner's own words go into a request whole.
quoted_json() { # <text>
  "$NODE" -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"
}
# shellcheck disable=SC2317,SC2329  # asked by wait_for, which takes the command to try as its arguments
notebook_is_up() { curl -fsS "http://127.0.0.1:$NOTEBOOK_PORT/health" >/dev/null 2>&1; }

# THE NOTEBOOK'S OWN CLOCK AT ANOTHER DAY: GODSPEED_NOW is the product's own frozen clock for a
# rehearsal (notebook/core/tracker-operations.mjs), set on the notebook's own service, which is then
# started again. The same three functions charm-challenge.sh had of its own until this release.
clock_of_this_account() { # <moment>
  local unit=${UNIT:-godspeed-integrated-notebook.service} dropin
  dropin=$HOME/.config/systemd/user/$unit.d
  mkdir -p "$dropin" || return 1
  printf '[Service]\nEnvironment="GODSPEED_NOW=%s"\n' "$1" >"$dropin/scenario-clock.conf" || return 1
  systemctl --user daemon-reload || return 1
  systemctl --user restart "$unit" || return 1
}
clock_of_the_machine() { # <moment>
  local unit=${UNIT:-godspeed-integrated-notebook.service} dropin
  dropin=/etc/systemd/system/$unit.d
  sudo mkdir -p "$dropin" || return 1
  printf '[Service]\nEnvironment="GODSPEED_NOW=%s"\n' "$1" | sudo tee "$dropin/scenario-clock.conf" >/dev/null || return 1
  sudo systemctl daemon-reload || return 1
  sudo systemctl restart "$unit" || return 1
}
notebook_clock_at() { # <day, YYYY-MM-DD>
  local day=$1 moment=$1T12:00:00Z unit=${UNIT:-godspeed-integrated-notebook.service}
  say "The notebook's own clock is set to $day"
  if systemctl --user cat "$unit" >/dev/null 2>&1; then
    clock_of_this_account "$moment" ||
      fail "the notebook's own clock could not be set to $day (its own service of this account would not take it), so the days could not pass"
  elif systemctl cat "$unit" >/dev/null 2>&1; then
    clock_of_the_machine "$moment" ||
      fail "the notebook's own clock could not be set to $day (the machine's own service would not take it), so the days could not pass"
  else
    fail "the install runs its notebook neither as this account's own service nor as the machine's ($unit is not there), so the days could not pass"
  fi
  wait_for 180 "the notebook to answer on $day" notebook_is_up ||
    fail "the notebook does not answer after its clock was set to $day"
}

# A NEW CONVERSATION OF THE NOTEBOOK'S CHAT PANEL, made the way its Clear button makes one
# (ui GlobalAIChatFAB, POST /api/chat-state with clear: true and the state it is clearing), which
# gives the conversation of the "general" context a new session; the assistant then keeps a
# conversation of its own for it (core/native-agent.mjs, --continue godspeed-notebook-<hash of the
# conversation and its session>). Sets CHAT_SESSION. Never call it inside $(...).
CHAT_PANEL_EMPTY='{"messages":[],"summary":"","summarizedUpTo":0}'
CHAT_STATE_READER='
const fs=require("fs");
const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),rows=Array.isArray(d)?d:(d.data||[]);
const row=rows.find(r=>r&&r.context_key===process.argv[2]);
process.stdout.write(JSON.stringify(row&&row.state?row.state:JSON.parse(process.argv[3])));
'
chat_panel_new_conversation() { # <file for what the notebook answered>
  local tables=$EVIDENCE/.panel-state.json state request code
  curl -fsS --max-time 120 -X POST -H 'Content-Type: application/json' -d '{"table":"note_conversations"}' \
    "http://127.0.0.1:$NOTEBOOK_PORT/api/query" -o "$tables" ||
    fail "the notebook's own chat conversations could not be read, so a new conversation could not be made"
  state=$("$NODE" -e "$CHAT_STATE_READER" "$tables" general "$CHAT_PANEL_EMPTY") ||
    fail "the chat conversation the notebook holds could not be read"
  request=$EVIDENCE/.panel-clear.json
  printf '{"context_key":"general","state":%s,"clear":true,"expected_state":%s}\n' "$CHAT_PANEL_EMPTY" "$state" >"$request"
  code=$(curl -sS -o "$1" -w '%{http_code}' --max-time 120 -X POST -H 'Content-Type: application/json' \
    --data-binary @"$request" "http://127.0.0.1:$NOTEBOOK_PORT/api/chat-state") ||
    fail "the notebook's chat panel could not be reached to start a new conversation"
  [ "$code" = 200 ] ||
    fail "the notebook's chat panel would not start a new conversation (HTTP $code): $(tr -d '\n' <"$1" | cut -c1-200)"
  CHAT_SESSION=$(json_value "$1" state.session_id) || CHAT_SESSION=''
  if [ -z "$CHAT_SESSION" ]; then
    fail "the notebook's chat panel started a conversation with no session of its own: $(tr -d '\n' <"$1" | cut -c1-200)"
  fi
  rm -f "$tables" "$request"
}
# The owner says something in the conversation chat_panel_new_conversation made; the reply is kept.
# The panel's request id is a UUID (server/main.mjs refuses any other for a chat function).
chat_panel_says() { # <what they say> <file for the reply>
  local said=$1 request=$EVIDENCE/.panel-ask.json body=$EVIDENCE/.panel-answer.json code
  say "The owner says (in the chat panel): $said"
  printf '{"message":%s,"conversation_id":"notebook:general","conversation_session":%s,"request_id":%s}\n' \
    "$(quoted_json "$said")" "$(quoted_json "$CHAT_SESSION")" \
    "$(quoted_json "$("$NODE" -e 'process.stdout.write(require("crypto").randomUUID())')")" >"$request"
  code=$(curl -sS -o "$body" -w '%{http_code}' --max-time 900 -X POST -H 'Content-Type: application/json' \
    --data-binary @"$request" "http://127.0.0.1:$NOTEBOOK_PORT/api/functions/conversation-chat") ||
    fail "the notebook's chat panel could not be reached, so the owner could not say \"$said\""
  if [ "$code" != 200 ]; then
    print_kept_diagnosis "${STATE:-}" "${HERMES:-}"
    fail "the notebook's chat panel answered HTTP $code to \"$said\": $(tr -d '\n' <"$body" | cut -c1-200)"
  fi
  json_value "$body" data.reply >"$2" ||
    fail "the notebook's chat panel answered \"$said\" with no reply of its own"
  printf '\n' >>"$2"
  sed 's/^/  | /' "$2" >&2
  rm -f "$request" "$body"
}

# THE ASSISTANT'S COMMAND LOG: every command the model ran with a tool since <epoch seconds>, as
# the model typed it, <epoch><TAB><session><TAB><command> (night-tidy-chat.mjs, commands).
assistant_commands() { # <file> <since, epoch seconds>
  "$NODE" "$HERE/night-tidy-chat.mjs" --home "${HERMES:?assistant_home first}" commands --since "${2:-0}" >"$1" ||
    fail "the assistant's command log could not be read from $HERMES/state.db"
}

# --- what the checking part asks of what was kept
# The first step of a run that did not succeed, as one sentence for FAIL, or nothing.
step_failure() { # <run.json>
  "$NODE" "$HERE/telegram-judge.mjs" failed "$1" ||
    fail "the owner-driver record cannot be read, so the run cannot prove what happened: $1"
}
# FAILs when any message sent in the run holds a code the owner would have to type or hold (what a
# code is: telegram-judge.mjs). Waiting-step snapshots add their ids to the codes to look for.
no_code_in() { # <run.json> [approvals snapshot...]
  local found
  found=$("$NODE" "$HERE/telegram-judge.mjs" codes "$@") || fail "a message to the owner holds a code he would have to type: $found"
}
# What was sent while the given steps ran, refused sends too, one JSON-quoted text per line.
outbox_between() { # <run.json> <label>[,<label>...] [accepted]
  "$NODE" "$HERE/telegram-judge.mjs" messages "$@"
}
