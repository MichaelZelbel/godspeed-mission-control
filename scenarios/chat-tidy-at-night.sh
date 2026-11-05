#!/usr/bin/env bash
# PROVING SCENARIO OF 2.0.0-beta.19: the night routine shortens a chat that has grown past the limit,
# the next message is answered with no summary in front, and a chat under the limit is left as it was.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.19-looks-after-itself/tickets/05-scenarios.md,
# scenario 1), on a fresh install whose assistant has a chat app:
#   long    a made-up conversation past the limit (night-tidy-chat.mjs seeds it into the assistant's own
#           chat store, as night-tidy.sh does); the "Night chat tidy-up" routine, started by hand the way
#           the routine runs it, makes that conversation in the assistant's database shorter and logs it
#           tidied
#   next    the next message to that conversation is answered by the assistant itself, and the answer
#           has no summary in front of it
#   short   a conversation under the limit, run through the same routine, is byte-for-byte as it was
#
# Before the tickets of beta.19 are on the stage this ends in the FAIL line of whichever of these the
# install does not do yet; it never skips.
#
# THE CONVERSATIONS ARE MADE UP, in the assistant's own chat store, beside one conversation the
# assistant keeps itself first (scenario-lib.sh, assistant_keeps_a_conversation). The chat app is the
# fake one of night-tidy-chat.mjs: a chat id and a routing entry, no account. Summarising and the next
# message need an AI model, so the job hands this scenario a key (GODSPEED_SCENARIO_AI_KEY, _URL, _MODEL).
#
#   bash scenarios/chat-tidy-at-night.sh candidate/2.0.0-beta.19
#   bash scenarios/chat-tidy-at-night.sh --check <folder>
#
# What it keeps for its checking part:
#   short-before.txt / short-after.txt   the under-limit conversation's own rows around its run
#   short-log / -exit                    that run
#   short-count.txt                      messages=<n> tokens=<n> of the short conversation
#   long-before.txt / long-after.txt     messages=<n> tokens=<n> of the long conversation around its run
#   long-log / -exit / -said             that run
#   next-reply.txt / next-exit           what the assistant answered to the next message
SCENARIO=chat-tidy-at-night
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"

ROUTINE='Night chat tidy-up'
LIMIT_TOKENS=60000 # the product's limit on recorded prompt tokens (night-tidy-chat.mjs)
SCRIPT=godspeed-chat-tidy.py
LONG=scenario-chat-1
SHORT=scenario-short-3
NEXT_MESSAGE='Reply with the single word Hello.'

# Asked by wait_for, which takes the command to try as its arguments.
# shellcheck disable=SC2329
routine_is_there() { grep -qF "$ROUTINE" "$HERMES/cron/jobs.json" 2>/dev/null; }
# shellcheck disable=SC2329
chat_store_is_ready() { chat_store count --session "$LONG" >/dev/null 2>&1; }

# The routine, started by hand the way the routine runs it: the script file the notebook wrote, from
# the assistant's own scripts folder, with the assistant's own Python.
run_the_routine() { # <name for the evidence>
  local scripts=$HERMES/scripts name=$1 python code
  python=$(json_value "$scripts/godspeed-routines.json" hermes_python) ||
    fail "the routine's own settings name no Python for the assistant, so the night routine could not be run"
  [ -n "$python" ] && [ "$python" != null ] ||
    fail "the install found no Python of the assistant's own, so the night routine cannot run at all"
  say "Running the routine ($name): $python $scripts/$SCRIPT"
  (cd "$scripts" && "$python" "$scripts/$SCRIPT") >"$EVIDENCE/$name-said" 2>"$EVIDENCE/$name-log"
  code=$?
  printf '%s\n' "$code" >"$EVIDENCE/$name-exit"
  say "  it ended $code; its log:"
  sed 's/^/  | /' "$EVIDENCE/$name-log" >&2
}

act() {
  need_the_ai_key "tidying a chat and answering the next message"
  fresh_evidence
  install_paths
  install_the_stage_line "$EVIDENCE/install-trace.log"
  need_node
  assistant_home
  connect_the_ai
  assistant_keeps_a_conversation "$EVIDENCE/first-conversation.txt"
  chat_store_is_ready ||
    fail "the assistant's own chat store holds no conversations to seed a chat beside ($HERMES/state.db)"
  wait_for 480 "the notebook to make the routine \"$ROUTINE\"" routine_is_there || {
    show_assistant_home
    fail "the notebook never made the routine \"$ROUTINE\" on this install, although the assistant has a chat app"
  }
  [ -f "$HERMES/scripts/$SCRIPT" ] || fail "the routine is there but its script is not ($HERMES/scripts/$SCRIPT)"

  say "A conversation under the limit (20,000 recorded tokens), quiet for an hour"
  chat_store seed --session "$SHORT" --tokens 20000 --quiet-minutes 60 --messages 12 >&2 ||
    fail "a conversation under the limit could not be seeded into the assistant's chat store"
  chat_store dump --session "$SHORT" >"$EVIDENCE/short-before.txt"
  chat_store count --session "$SHORT" >"$EVIDENCE/short-count.txt"
  run_the_routine short
  chat_store dump --session "$SHORT" >"$EVIDENCE/short-after.txt"

  say "A conversation past the limit (174,000 recorded tokens), quiet for an hour, in the same place"
  chat_store seed --session "$LONG" --tokens 174000 --quiet-minutes 60 --messages 40 >&2 ||
    fail "a conversation past the limit could not be seeded into the assistant's chat store"
  chat_store count --session "$LONG" >"$EVIDENCE/long-before.txt"
  run_the_routine long
  chat_store count --session "$LONG" >"$EVIDENCE/long-after.txt"

  local executable code
  executable=$(json_value "$STATE/assistant.json" executable) ||
    fail "the install recorded no command for its assistant, so the next message could not be sent"
  say "The next message, to the same conversation: $NEXT_MESSAGE"
  (cd "$ROOT" && HERMES_HOME="$HERMES" timeout 600 "$executable" chat -q "$NEXT_MESSAGE" -Q --resume "$LONG" </dev/null) \
    >"$EVIDENCE/next-reply.txt" 2>&1
  code=$?
  printf '%s\n' "$code" >"$EVIDENCE/next-exit"
  sed 's/^/  | /' "$EVIDENCE/next-reply.txt" >&2
}

number() { # <value> <what it was supposed to be>
  case $1 in
    '' | *[!0-9]*) fail "$2" ;;
  esac
}

check() { # <evidence folder>
  local folder=$1 file
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of a night"
  for file in short-before.txt short-after.txt short-log short-exit short-count.txt long-before.txt long-after.txt \
    long-log long-exit next-reply.txt next-exit; do
    kept "$folder" "$file" "what the night routine did and what the chats looked like around it"
  done
  [ -f "$folder/long-said" ] || fail "long-said is not in what the scenario kept, so what the routine said is unknown"

  # The long conversation: shorter in the database, and the log says it was tidied.
  [ "$(cat "$folder/long-exit")" = 0 ] ||
    fail "the night routine ended $(cat "$folder/long-exit") on the long conversation: $(head -1 "$folder/long-log")"
  local before after tokens
  before=$(sed -n 's/^messages=\([0-9]*\).*/\1/p' "$folder/long-before.txt")
  after=$(sed -n 's/^messages=\([0-9]*\).*/\1/p' "$folder/long-after.txt")
  tokens=$(sed -n 's/^messages=[0-9]* tokens=\([0-9]*\)$/\1/p' "$folder/long-before.txt")
  number "$tokens" "long-before.txt does not say how many tokens the conversation had recorded: $(cat "$folder/long-before.txt")"
  [ "$tokens" -ge "$LIMIT_TOKENS" ] ||
    fail "the long conversation had $tokens recorded tokens before the night routine, under the limit of $LIMIT_TOKENS, so tidying it proves nothing"
  tokens=$(sed -n 's/^messages=[0-9]* tokens=\([0-9]*\)$/\1/p' "$folder/short-count.txt")
  number "$tokens" "short-count.txt does not say how many tokens the short conversation had recorded: $(cat "$folder/short-count.txt")"
  [ "$tokens" -lt "$LIMIT_TOKENS" ] ||
    fail "the short conversation had $tokens recorded tokens, not under the limit of $LIMIT_TOKENS"
  number "$before" "long-before.txt does not say how many messages the conversation had: $(cat "$folder/long-before.txt")"
  number "$after" "long-after.txt does not say how many messages the conversation has: $(cat "$folder/long-after.txt")"
  [ "$after" -lt "$before" ] ||
    fail "the long conversation holds $after messages in the assistant's database after the night routine and held $before: nothing was shortened"
  grep -qiE 'tidied|summaris|compress' "$folder/long-log" ||
    fail "the night routine's log does not say it tidied the conversation: $(tail -1 "$folder/long-log")"

  # The next message: answered, and nothing summary-like in front of the answer.
  [ "$(cat "$folder/next-exit")" = 0 ] ||
    fail "the assistant ended $(cat "$folder/next-exit") on the next message to the tidied conversation: $(head -c 300 "$folder/next-reply.txt" | tr '\n' ' ')"
  local reply
  reply=$(grep -vE '^[[:space:]]*(session_id|Session|Resumed)[: ]' "$folder/next-reply.txt" | sed '/^[[:space:]]*$/d')
  [ -n "$reply" ] || fail "the assistant answered the next message with nothing"
  grep -qi 'hello' <<<"$reply" || fail "the answer to the next message is not the answer asked for: $(head -c 300 <<<"$reply" | tr '\n' ' ')"
  if grep -qiE 'summary|summari[sz]ed|earlier (part of )?(our|the) conversation|context (compaction|was compacted)|previous conversation' <<<"$reply" ||
    [ "$(wc -c <<<"$reply")" -gt 600 ]; then
    fail "the answer to the next message has a summary in front of it or is far longer than asked: $(head -c 300 <<<"$reply" | tr '\n' ' ')"
  fi

  # The conversation under the limit: left exactly as it was.
  [ "$(cat "$folder/short-exit")" = 0 ] ||
    fail "the night routine ended $(cat "$folder/short-exit") on the conversation under the limit: $(head -1 "$folder/short-log")"
  cmp -s "$folder/short-before.txt" "$folder/short-after.txt" ||
    fail "the conversation under the limit is not byte-for-byte the same after the night routine"
  grep -q 'status compressed' "$folder/short-log" &&
    fail "the night routine tidied a conversation that was under the limit: $(grep 'status compressed' "$folder/short-log" | tail -1)"

  pass "the long conversation went from $before to $after messages and its log says it was tidied; the next message was answered with no summary in front; the conversation under the limit was byte-for-byte as it was"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  need_node
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
