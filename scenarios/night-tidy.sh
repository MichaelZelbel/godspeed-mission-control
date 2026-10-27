#!/usr/bin/env bash
# PROVING SCENARIO 2: the night chat tidy-up does its job, and only its job.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.8-faster-chat/plan.md, scenario 2): on
# a fresh install whose assistant has a chat app, the notebook makes the routine "Night chat
# tidy-up" (notebook/core/notebook-routines.mjs, native-scheduler.mjs), and its script - run the way
# the routine runs it, with the assistant's own Python from the assistant's own scripts folder -
#   * summarises the one conversation the gateway routes to the owner: fewer messages, a smaller
#     estimate, the routing table unchanged;
#   * leaves a second stored conversation byte-for-byte alone;
#   * does nothing at all while the chat is in use (a message five minutes old);
#   * compresses nothing when a resume answers with a different conversation.
#
# The last one cannot be shown with a real assistant, which always resumes what it was asked for, so
# that one run answers from scenarios/stand-in-channel.py - the routine's own command, the real
# routine script, the real chat store, a stand-in only for the channel. The verdict says so.
#
# Summarising needs an AI model, so the job hands this scenario a key:
#   GODSPEED_SCENARIO_AI_KEY    (the release step names the repository secret; without it: FAIL)
#   GODSPEED_SCENARIO_AI_URL    the service's address, OpenRouter by default
#   GODSPEED_SCENARIO_AI_MODEL  the model the summary is written with
#
#   bash scenarios/night-tidy.sh candidate/2.0.0-beta.8
#   bash scenarios/night-tidy.sh --check <folder>
#
# What it keeps for its checking part:
#   summarised-log / -exit / -said   the run on the long chat: its log, its exit code, what it said
#   routing-before.txt / -after.txt  the gateway's routing table around that run
#   other-before.txt / -after.txt    the second stored conversation's own rows around it
#   chat-before.txt / -after.txt     messages=<n> tokens=<n> of the routed chat around it
#   in-use-log / -exit               the run on a chat whose last message is five minutes old
#   wrong-resume-log / -exit / -asked.json / -chat-before.txt / -chat-after.txt
SCENARIO=night-tidy
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"

ROUTINE='Night chat tidy-up'
SCRIPT=godspeed-chat-tidy.py
CHAT=scenario-chat-1
OTHER=scenario-other-2
AI_URL=${GODSPEED_SCENARIO_AI_URL:-https://openrouter.ai/api/v1}
AI_MODEL=${GODSPEED_SCENARIO_AI_MODEL:-anthropic/claude-sonnet-4.5}

# The AI the summary is written with, connected the way Settings connects it (core/routine-ai.mjs
# writes it into the assistant's own config.yaml and .env, which is where the assistant reads it).
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
    fail "the AI the summary is written with could not be connected to the assistant (model $AI_MODEL at $AI_URL)"
  say "The assistant writes its summary with $AI_MODEL at $AI_URL"
}

# These two are asked by wait_for, which takes the command to try as its arguments.
# shellcheck disable=SC2329
routine_is_there() { grep -qF "$ROUTINE" "$HERMES/cron/jobs.json" 2>/dev/null; }
# The store is ready when the tables the assistant owns are there to be read.
# shellcheck disable=SC2329
chat_store_is_ready() { chat_store count --session "$CHAT" >/dev/null 2>&1; }

# The routine, run the way the routine runs it: the small script file the notebook wrote, from the
# assistant's own scripts folder, with the assistant's own Python.
run_the_routine() { # <scripts folder> <name for the evidence> [extra environment...]
  local scripts=$1 name=$2 python code
  shift 2
  python=$(json_value "$scripts/godspeed-routines.json" hermes_python) ||
    fail "the routine's own settings name no Python for the assistant, so it could not be run"
  [ -n "$python" ] && [ "$python" != null ] ||
    fail "the install found no Python of the assistant's own, so the night tidy-up cannot run at all"
  say "Running the routine ($name): $python $scripts/$SCRIPT"
  (cd "$scripts" && env "$@" "$python" "$scripts/$SCRIPT") \
    >"$EVIDENCE/$name-said" 2>"$EVIDENCE/$name-log"
  code=$?
  printf '%s\n' "$code" >"$EVIDENCE/$name-exit"
  say "  it ended $code; its log:"
  sed 's/^/  | /' "$EVIDENCE/$name-log" >&2
}

act() {
  [ -n "${GODSPEED_SCENARIO_AI_KEY:-}" ] ||
    fail "GODSPEED_SCENARIO_AI_KEY is not in this job's environment, and summarising a chat needs an AI model, so this scenario cannot run"
  fresh_evidence
  install_paths
  install_the_stage_line "$EVIDENCE/install-trace.log"
  need_node
  assistant_home
  connect_the_ai

  wait_for 300 "the assistant's own chat store" chat_store_is_ready || {
    show_assistant_home
    fail "the install left the assistant no chat store ($HERMES/state.db), so no chat could be seeded"
  }
  say "Seeding a chat of the owner's own: above 60,000 recorded tokens, quiet for an hour"
  chat_store seed --session "$CHAT" --other "$OTHER" --tokens 174000 --quiet-minutes 60 --messages 40 >&2 ||
    fail "a chat of the owner's own could not be seeded into the assistant's chat store (its own message says why)"

  wait_for 480 "the notebook to make the routine \"$ROUTINE\"" routine_is_there || {
    show_assistant_home
    fail "the notebook never made the routine \"$ROUTINE\" on this install, although the assistant has a chat app"
  }
  [ -f "$HERMES/scripts/$SCRIPT" ] ||
    fail "the routine is there but its script is not ($HERMES/scripts/$SCRIPT)"

  chat_store routing >"$EVIDENCE/routing-before.txt"
  chat_store dump --session "$OTHER" >"$EVIDENCE/other-before.txt"
  chat_store count --session "$CHAT" >"$EVIDENCE/chat-before.txt"
  run_the_routine "$HERMES/scripts" summarised
  chat_store routing >"$EVIDENCE/routing-after.txt"
  chat_store dump --session "$OTHER" >"$EVIDENCE/other-after.txt"
  chat_store count --session "$CHAT" >"$EVIDENCE/chat-after.txt"

  say "The same chat, with a message five minutes old: the routine has to leave it alone"
  chat_store retime --session "$CHAT" --quiet-minutes 5 --tokens 174000 >&2
  run_the_routine "$HERMES/scripts" in-use

  say "A resume that answers with a different conversation: nothing may be compressed"
  local stand_in=$EVIDENCE/stand-in scripts=$EVIDENCE/wrong-resume-scripts
  mkdir -p "$stand_in/tui_gateway" "$scripts"
  : >"$stand_in/tui_gateway/__init__.py"
  cp "$HERE/stand-in-channel.py" "$stand_in/tui_gateway/entry.py"
  cp "$HERMES/scripts/$SCRIPT" "$HERMES/scripts/godspeed_routines.py" "$scripts/"
  "$NODE" -e '
const fs=require("fs");
const config=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));
config.hermes_source=process.argv[2];
fs.writeFileSync(process.argv[3],JSON.stringify(config,null,2)+"\n");
' "$HERMES/scripts/godspeed-routines.json" "$stand_in" "$scripts/godspeed-routines.json" ||
    fail "the routine's settings could not be copied for the stand-in channel"
  # It answers the close as well, which the routine always asks for: a channel that never answers
  # it would only make the run wait out its half minute.
  printf '{"session.resume":{"session_id":"live-1","resumed":"a-conversation-of-somebody-else","status":"idle","message_count":320},"session.close":{"closed":true}}\n' \
    >"$EVIDENCE/wrong-resume-plan.json"
  : >"$EVIDENCE/wrong-resume-asked.json"
  chat_store retime --session "$CHAT" --quiet-minutes 60 --tokens 174000 >&2
  chat_store count --session "$CHAT" >"$EVIDENCE/wrong-resume-chat-before.txt"
  run_the_routine "$scripts" wrong-resume \
    "CHANNEL_PLAN=$EVIDENCE/wrong-resume-plan.json" "CHANNEL_RECORD=$EVIDENCE/wrong-resume-asked.json"
  chat_store count --session "$CHAT" >"$EVIDENCE/wrong-resume-chat-after.txt"
}

number() { # <value> <what it was supposed to be>
  case $1 in
    '' | *[!0-9]*) fail "$2" ;;
  esac
}

check() { # <evidence folder>
  local folder=$1
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of a run"
  need_node
  for file in summarised-log summarised-exit routing-before.txt routing-after.txt \
    other-before.txt other-after.txt chat-before.txt chat-after.txt in-use-log in-use-exit \
    wrong-resume-log wrong-resume-exit wrong-resume-chat-before.txt wrong-resume-chat-after.txt; do
    kept "$folder" "$file" "what the routine did and what the chat looked like around it"
  done
  # These two have to be there and may be empty: what the routine said to the person (nothing),
  # and what it asked the stand-in channel.
  for file in summarised-said wrong-resume-asked.json; do
    [ -f "$folder/$file" ] ||
      fail "$file is not in what the scenario kept, so what the routine said and asked is unknown"
  done

  # The long chat: the routine ran, said nothing to the person, and summarised it.
  [ "$(cat "$folder/summarised-exit")" = 0 ] ||
    fail "the routine ended $(cat "$folder/summarised-exit") on the long chat: $(head -1 "$folder/summarised-log")"
  [ ! -s "$folder/summarised-said" ] ||
    fail "the routine said something to the person, and it sends nothing to the chat: $(head -1 "$folder/summarised-said")"
  local line
  line=$(grep -o 'summarised in .*' "$folder/summarised-log" | tail -1)
  [ -n "$line" ] ||
    fail "the routine's log does not say it summarised the chat at all: $(tail -1 "$folder/summarised-log")"
  case $line in
    *'status compressed'*) ;;
    *) fail "the summary did not end as a summary: $line" ;;
  esac
  local from to tokens_from tokens_to
  from=$(printf '%s' "$line" | sed -n 's/.*messages \([0-9]*\) -> \([0-9]*\).*/\1/p')
  to=$(printf '%s' "$line" | sed -n 's/.*messages \([0-9]*\) -> \([0-9]*\).*/\2/p')
  tokens_from=$(printf '%s' "$line" | sed -n 's/.*about \([0-9]*\) -> \([0-9]*\) tokens.*/\1/p')
  tokens_to=$(printf '%s' "$line" | sed -n 's/.*about \([0-9]*\) -> \([0-9]*\) tokens.*/\2/p')
  number "$from" "the routine's log does not say how many messages the chat had: $line"
  number "$to" "the routine's log does not say how many messages are left: $line"
  number "$tokens_from" "the routine's log does not say how large the chat was: $line"
  number "$tokens_to" "the routine's log does not say how large it is now: $line"
  [ "$to" -lt "$from" ] || fail "the chat has $to messages after the summary and had $from: nothing was shortened"
  [ "$tokens_to" -lt "$tokens_from" ] ||
    fail "the estimate is $tokens_to tokens after the summary and was $tokens_from: nothing got smaller"

  # And nothing else moved.
  cmp -s "$folder/routing-before.txt" "$folder/routing-after.txt" ||
    fail "the gateway's routing table is not the same after the summary, so the chat may now be routed elsewhere"
  cmp -s "$folder/other-before.txt" "$folder/other-after.txt" ||
    fail "the second stored conversation is not byte-for-byte the same after the summary"
  local kept_before kept_after
  kept_before=$(sed -n 's/^messages=\([0-9]*\).*/\1/p' "$folder/chat-before.txt")
  kept_after=$(sed -n 's/^messages=\([0-9]*\).*/\1/p' "$folder/chat-after.txt")
  number "$kept_before" "chat-before.txt does not say how many messages the chat had: $(cat "$folder/chat-before.txt")"
  number "$kept_after" "chat-after.txt does not say how many messages the chat has: $(cat "$folder/chat-after.txt")"
  [ "$kept_after" -lt "$kept_before" ] ||
    fail "the chat store still holds $kept_after of its $kept_before messages, so the summary was not written into it"

  # A chat in use is left alone.
  [ "$(cat "$folder/in-use-exit")" = 0 ] ||
    fail "the routine ended $(cat "$folder/in-use-exit") on a chat that is in use, instead of leaving it alone: $(head -1 "$folder/in-use-log")"
  grep -qF 'skip: in use' "$folder/in-use-log" ||
    fail "the routine did not skip a chat whose last message is five minutes old: $(tail -1 "$folder/in-use-log")"

  # A resume that names another conversation stops it, and nothing is compressed.
  [ "$(cat "$folder/wrong-resume-exit")" = 1 ] ||
    fail "a resume naming another conversation left the routine at exit $(cat "$folder/wrong-resume-exit"), not 1"
  grep -qF 'Resume opened' "$folder/wrong-resume-log" ||
    fail "the routine did not say that the resume opened the wrong conversation: $(tail -1 "$folder/wrong-resume-log")"
  grep -qF 'session.compress' "$folder/wrong-resume-asked.json" &&
    fail "the routine asked for a summary although the resume had named another conversation"
  cmp -s "$folder/wrong-resume-chat-before.txt" "$folder/wrong-resume-chat-after.txt" ||
    fail "the chat changed during the run whose resume named another conversation"

  pass "the routed chat went from $from messages and about $tokens_from tokens to $to and about $tokens_to, the second conversation stayed byte-for-byte and the routing unchanged; a chat five minutes old was skipped; a resume naming another conversation compressed nothing (that one against a stand-in channel)"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
