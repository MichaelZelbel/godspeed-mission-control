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
  curl -fsSL "$RAW/$1/install-godspeed.sh" |
    GODSPEED_STAGE_REF="$1" GODSPEED_PORT="$3" bash -xs -- --godspeed "$2" 2> >(tee "$4" >&2) ||
    fail "the install line for $1 into $2 failed before this scenario could do anything (its trace is in the step log)"
}
install_the_stage_line_into() { # <root> <port> <trace file>
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
  VERSION=$(cat "$(runtime_of "$1")/version" 2>/dev/null) && [ -n "$VERSION" ] ||
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
# Prints the address.
stand_in_github_over_ssh() { # <folder>
  local folder=$1 owner=godspeed-scenario-stand-in name
  name=stand-in-$(od -An -N4 -tx1 /dev/urandom | tr -d ' \n')
  mkdir -p "$folder" || fail "the folder for the stand-in repository ($folder) could not be made"
  git init -q --bare --initial-branch=main "$folder/$name.git" >&2 ||
    fail "the bare repository standing in for the private GitHub repository could not be made"
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
  # In this machine's Git settings, the way the rewriting above is set, so that it holds however
  # this was called and for every program the scenario starts, the product's own sync among them;
  # and in this shell's environment as well, where GIT_SSH_COMMAND is what git reads first.
  git config --global core.sshCommand "$stand_in/ssh" ||
    fail "git could not be told how to reach github.com on this machine"
  GIT_SSH_COMMAND=$stand_in/ssh
  export GIT_SSH_COMMAND
  say "The private GitHub repository is stood in for by $folder/$name.git, reached as GitHub's own SSH address"
  printf 'git@github.com:%s/%s.git\n' "$owner" "$name"
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
# which is where a difference the SYNC could not settle waits. One line per item still waiting:
# <suggestion type><TAB><status><TAB><title><TAB><what it says>. Waiting is what the notebook calls
# waiting (core/records/store.mjs: pending, pending_review or auto_applied_unreviewed, and neither
# answered nor removed), read here with a reader of this script's own.
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
queued_reviews_of() { # <root> <file>
  "$NODE" -e "$QUEUED_REVIEWS" "$1/notebook/_system/review_queue" >"$2" ||
    fail "the notebook's review queue in $1 could not be read"
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

# THE NAMES, the plan's own list of twenty-five: the HyperFrames family the product had vendored
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
gsap-core
gsap-timeline
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
