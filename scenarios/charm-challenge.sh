#!/usr/bin/env bash
# PROVING SCENARIO 1 OF 2.0.0-beta.13: the Charm Challenge, start to finish.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.13-charm-video-notebook/plan.md,
# scenario 1, from Michael's design of 21 October 2026): on a fresh install, "start the Charm
# Challenge" gives the start reply with the right end date; the morning brief's input carries its
# one line; a vent in the chat ends with "Back to 21? Yes / No"; "no" changes nothing; "yes" and
# "charm slip" start over with a new end date; and the card on the Trackers shelf shows the same
# numbers.
#
# WHERE IT SAYS ALL THAT. The owner's own chat, the notebook's own one (POST /api/browser-chat),
# which keeps one conversation, so the reset question and the yes or no that answers it are in the
# conversation that asked it, which is the only place the design lets a bare "yes" count. The model
# that answers is the one Settings connects (POST /api/provider), with the key the job hands this
# scenario. The morning brief's one line is written by the program, not by the model, and is read
# through the one line an owner's assistant runs (the notebook's own personal command, as the
# reminder scenarios read a reminder). The Trackers shelf's own card and its events are read over
# the notebook's own query API, which is what the shelf itself is drawn from.
#
# THE DAYS HAVE TO PASS. A fresh install starts the challenge today, and a reset today would name
# the same end date, so "start over with a new end date" would say nothing. GODSPEED_NOW is the
# product's own frozen clock for a rehearsal (notebook/core/tracker-operations.mjs), and this is a
# rehearsal: the scenario sets it on the notebook's own service and starts it again, so the fourth
# day and the fifth day of the count really arrive. A clock it cannot move is a FAIL.
#
# WHAT IT ASSUMES OF THE ADD-ON, because it is written from the release plan while the add-on is
# built beside it (ticket 01): the notebook knows `charm` as a personal command and answers `brief`
# with the one line the morning brief is given, and the challenge is a collection on the Trackers
# shelf whose card names the specialist "charm" and whose items are its events, each with its own
# `when`. Both are the design's own words. A stage where they are not so fails here with that as
# its symptom, which is what a proving scenario is for.
#
#   ELEVENLABS... none: no voice note is involved.
#   GODSPEED_SCENARIO_AI_KEY    the model that answers the owner (without it: FAIL), with
#   GODSPEED_SCENARIO_AI_URL and GODSPEED_SCENARIO_AI_MODEL, the names update-keeps-everything uses
#
#   bash scenarios/charm-challenge.sh candidate/2.0.0-beta.13
#   bash scenarios/charm-challenge.sh --check <folder>
#
# What it keeps for its checking part:
#   days.txt                     the three days it acted on, and the machine's own clock offset
#   start-reply.txt              the reply to "start the Charm Challenge"
#   status-after-start.txt       what it says the challenge stands at, on the day it started
#   brief-after-start.txt        the line the morning brief is given, that day
#   shelf-after-start.txt        the Trackers shelf's own card and its events, that day
#   vent-reply.txt               the reply to a vent, that day
#   no-reply.txt                 the reply to "no"
#   status-after-no.txt / brief-after-no.txt / shelf-after-no.txt    the same three after the "no"
#   status-fourth-day.txt / brief-fourth-day.txt                     three days later
#   second-vent-reply.txt / yes-reply.txt                            the vent and the "yes"
#   status-after-yes.txt / brief-after-yes.txt / shelf-after-yes.txt
#   slip-reply.txt                                                   the day after, "charm slip"
#   status-after-slip.txt / brief-after-slip.txt / shelf-after-slip.txt
#   chat.txt                     the whole conversation as the notebook kept it
SCENARIO=charm-challenge
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"

DAYS=21
QUESTION='Back to 21? Yes / No'
# A vent is venting at the assistant instead of saying what to fix (the design). Neither of these
# says "reset", "start" or "slip", so a word of the owner's kept beside an event cannot be read as
# one of those by this scenario's own reader.
VENT='This caption file is garbage again. Why do you always hand me this rubbish?'
SECOND_VENT='Rubbish once more. Are you even reading what I write, or do you just make things up?'
ASK='how is my Charm Challenge?'
UNIT=godspeed-integrated-notebook.service

# shellcheck disable=SC2329  # asked by wait_for, which takes the command to try as its arguments
notebook_answers() { curl -fsS "http://127.0.0.1:$NOTEBOOK_PORT/health" >/dev/null 2>&1; }

# One string, written the way JSON writes it, so the owner's own words go into a request whole.
json_string() { "$NODE" -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"; }

# The Trackers shelf's own rows, as plain lines: the card of the charm tracker and one line per
# event of it. The shelf is drawn from the collections and their items (core/trackers.mjs: a tracker
# is a collection with a `tracker` card), which is what the notebook answers here.
SHELF_READER='
const fs=require("fs");
const read=f=>{const d=JSON.parse(fs.readFileSync(f,"utf8"));return Array.isArray(d)?d:(d.data||[]);};
const cards=read(process.argv[1]).filter(c=>c&&c.tracker&&typeof c.tracker==="object"&&c.tracker.specialist==="charm");
const out=[];
for(const c of cards){
 out.push(["card",c.name||"",c.tracker.specialist,JSON.stringify(c.tracker)].join("\t"));
 const items=read(process.argv[2]).filter(i=>i&&i.collection_id===c.id);
 for(const i of items)out.push(["event",String((i.data||{}).when||"?"),JSON.stringify(i.data||{})].join("\t"));
}
process.stdout.write(out.sort().join("\n")+"\n");
'
# The conversation as the notebook kept it: one line per message, <role><TAB>what was said.
CHAT_READER='
const fs=require("fs");
const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),rows=d.messages||d.data||[];
process.stdout.write(rows.map(m=>[m.role||"",String(m.content||"").replace(/\s+/g," ").trim()].join("\t")).join("\n")+"\n");
'

# Settings' own way of connecting a model (server/main.mjs POST /api/provider), which is what the
# owner's chat thinks with. Not the routines: the brief's one line is written by the program.
settings_connects_the_model() {
  local body=$EVIDENCE/.provider.json code request=$EVIDENCE/.provider-ask.json
  printf '{"url":%s,"key":%s,"model":%s,"routines":false}\n' \
    "$(json_string "$AI_URL")" "$(json_string "$GODSPEED_SCENARIO_AI_KEY")" "$(json_string "$AI_MODEL")" >"$request"
  code=$(curl -sS -o "$body" -w '%{http_code}' --max-time 300 -X POST \
    -H 'Content-Type: application/json' --data-binary @"$request" \
    "http://127.0.0.1:$NOTEBOOK_PORT/api/provider") ||
    fail "Settings could not be reached to connect a model, so the owner's chat has nobody to answer it"
  [ "$code" = 200 ] ||
    fail "Settings refused the model $AI_MODEL at $AI_URL with HTTP $code: $(tr -d '\n' <"$body" | cut -c1-200)"
  say "The owner's chat thinks with $AI_MODEL at $AI_URL"
}

# The owner says something in the notebook's own chat, and what came back is kept.
owner_says() { # <what they say> <file for the reply>
  local said=$1 file=$2 request body code
  request=$EVIDENCE/.ask.json
  body=$EVIDENCE/.answer.json
  say "The owner says: $said"
  printf '{"message":%s,"request_id":%s}\n' "$(json_string "$said")" \
    "$(json_string "scenario-$(od -An -N8 -tx1 /dev/urandom | tr -d ' \n')")" >"$request"
  code=$(curl -sS -o "$body" -w '%{http_code}' --max-time 900 -X POST \
    -H 'Content-Type: application/json' --data-binary @"$request" \
    "http://127.0.0.1:$NOTEBOOK_PORT/api/browser-chat") ||
    fail "the notebook's own chat could not be reached, so the owner could not say \"$said\""
  [ "$code" = 200 ] ||
    fail "the notebook's own chat answered HTTP $code to \"$said\": $(tr -d '\n' <"$body" | cut -c1-200)"
  json_value "$body" reply >"$file" ||
    fail "the notebook's own chat answered \"$said\" with no reply of its own"
  printf '\n' >>"$file"
  sed 's/^/  | /' "$file" >&2
}

# The one line the morning brief is given, through the one line an owner's assistant runs: the
# notebook's own personal command hands an add-on's command to the add-on under the workspace lock
# (notebook/bin/personal-command.mjs, core/native-personal.mjs addonCommand), as due_on does for a
# reminder.
charm_on() { # <arguments...>
  GODSPEED_WORKSPACE="$ROOT" "$NODE" "$(product_script "$ROOT" notebook/bin/personal-command.mjs)" charm "$@"
}
keep_the_brief_line() { # <file>
  charm_on brief >"$1" 2>"$EVIDENCE/.brief-error.txt" ||
    fail "the notebook could not say what the morning brief is given about the Charm Challenge (charm brief: $(tr -d '\n' <"$EVIDENCE/.brief-error.txt" | cut -c1-200))"
  sed 's/^/  | /' "$1" >&2
}
keep_the_shelf() { # <file>
  curl -fsS --max-time 120 -X POST -H 'Content-Type: application/json' -d '{"table":"collections"}' \
    "http://127.0.0.1:$NOTEBOOK_PORT/api/query" -o "$EVIDENCE/.collections.json" ||
    fail "the collections the Trackers shelf shows could not be read from the notebook"
  curl -fsS --max-time 120 -X POST -H 'Content-Type: application/json' -d '{"table":"collection_items"}' \
    "http://127.0.0.1:$NOTEBOOK_PORT/api/query" -o "$EVIDENCE/.items.json" ||
    fail "the rows of the Trackers shelf's cards could not be read from the notebook"
  "$NODE" -e "$SHELF_READER" "$EVIDENCE/.collections.json" "$EVIDENCE/.items.json" >"$1" ||
    fail "what the notebook answered about the Trackers shelf could not be read"
  sed 's/^/  | /' "$1" >&2
}

# THE NOTEBOOK'S OWN CLOCK, set to one day and started again. Written as an Environment= of its own
# service, which is how the install runs it (notebook/scripts/install-native-notebook.sh: this
# account's own systemd unit, or the machine's where the install made that one).
clock_of_this_account() { # <moment>
  local dropin=$HOME/.config/systemd/user/$UNIT.d
  mkdir -p "$dropin" || return 1
  printf '[Service]\nEnvironment="GODSPEED_NOW=%s"\n' "$1" >"$dropin/scenario-clock.conf" || return 1
  systemctl --user daemon-reload || return 1
  systemctl --user restart "$UNIT" || return 1
}
clock_of_the_machine() { # <moment>
  local dropin=/etc/systemd/system/$UNIT.d
  sudo mkdir -p "$dropin" || return 1
  printf '[Service]\nEnvironment="GODSPEED_NOW=%s"\n' "$1" | sudo tee "$dropin/scenario-clock.conf" >/dev/null || return 1
  sudo systemctl daemon-reload || return 1
  sudo systemctl restart "$UNIT" || return 1
}
notebook_clock_at() { # <day, YYYY-MM-DD>
  local day=$1 moment=$1T12:00:00Z
  say "The notebook's own clock is set to $day"
  if systemctl --user cat "$UNIT" >/dev/null 2>&1; then
    clock_of_this_account "$moment" ||
      fail "the notebook's own clock could not be set to $day (its own service of this account would not take it), so the days of the count could not pass"
  elif systemctl cat "$UNIT" >/dev/null 2>&1; then
    clock_of_the_machine "$moment" ||
      fail "the notebook's own clock could not be set to $day (the machine's own service would not take it), so the days of the count could not pass"
  else
    fail "the install runs its notebook neither as this account's own service nor as the machine's ($UNIT is not there), so the days of the count could not pass"
  fi
  wait_for 180 "the notebook to answer on $day" notebook_answers ||
    fail "the notebook does not answer after its clock was set to $day"
}

act() {
  need_the_ai_key "the owner's own chat with the assistant"
  fresh_evidence
  install_paths
  install_the_stage_line "$EVIDENCE/.install.log"
  need_node
  wait_for 180 "the notebook to answer after the install" notebook_answers ||
    fail "the notebook does not answer after the install, so the owner has no chat to say anything in"
  read_version "$ROOT"
  settings_connects_the_model

  # The three days: today, the fourth day of the count, and the day after the reset on it. The
  # offset is kept too, because the scenario measures the days in UTC.
  START=$(day_in +0)
  RESET_DAY=$(day_in +3)
  SLIP_DAY=$(day_in +4)
  {
    printf 'start=%s\n' "$START"
    printf 'reset=%s\n' "$RESET_DAY"
    printf 'slip=%s\n' "$SLIP_DAY"
    printf 'offset=%s\n' "$(date +%z)"
  } >"$EVIDENCE/days.txt"

  phase start
  owner_says 'start the Charm Challenge' "$EVIDENCE/start-reply.txt"
  owner_says "$ASK" "$EVIDENCE/status-after-start.txt"
  keep_the_brief_line "$EVIDENCE/brief-after-start.txt"
  keep_the_shelf "$EVIDENCE/shelf-after-start.txt"

  phase 'a vent, and no'
  owner_says "$VENT" "$EVIDENCE/vent-reply.txt"
  owner_says no "$EVIDENCE/no-reply.txt"
  owner_says "$ASK" "$EVIDENCE/status-after-no.txt"
  keep_the_brief_line "$EVIDENCE/brief-after-no.txt"
  keep_the_shelf "$EVIDENCE/shelf-after-no.txt"

  phase 'the fourth day'
  notebook_clock_at "$RESET_DAY"
  owner_says "$ASK" "$EVIDENCE/status-fourth-day.txt"
  keep_the_brief_line "$EVIDENCE/brief-fourth-day.txt"

  phase 'a vent, and yes'
  owner_says "$SECOND_VENT" "$EVIDENCE/second-vent-reply.txt"
  owner_says yes "$EVIDENCE/yes-reply.txt"
  owner_says "$ASK" "$EVIDENCE/status-after-yes.txt"
  keep_the_brief_line "$EVIDENCE/brief-after-yes.txt"
  keep_the_shelf "$EVIDENCE/shelf-after-yes.txt"

  phase 'a slip somewhere else'
  notebook_clock_at "$SLIP_DAY"
  owner_says 'charm slip' "$EVIDENCE/slip-reply.txt"
  owner_says "$ASK" "$EVIDENCE/status-after-slip.txt"
  keep_the_brief_line "$EVIDENCE/brief-after-slip.txt"
  keep_the_shelf "$EVIDENCE/shelf-after-slip.txt"

  curl -fsS --max-time 120 "http://127.0.0.1:$NOTEBOOK_PORT/api/browser-chat" -o "$EVIDENCE/.chat.json" ||
    fail "the conversation the owner had could not be read back from the notebook"
  "$NODE" -e "$CHAT_READER" "$EVIDENCE/.chat.json" >"$EVIDENCE/chat.txt" ||
    fail "the conversation the notebook kept could not be read"
  rm -f "$EVIDENCE"/.[a-z]*
}

# ------------------------------------------------------------------------------ what it judges
# The words a reply names a day in: "Wednesday 11 November", the weekday, the day and the month of
# the design's own example, each asked for on its own so a reply that writes them in another order
# still counts.
day_words() { # <day> <%A|%-d|%B>
  date -u -d "$1" +"$2" 2>/dev/null || date -u -jf %Y-%m-%d "$1" +"$2"
}
day_plus() { # <day> <days>
  date -u -d "$1 + $2 days" +%Y-%m-%d 2>/dev/null || date -u -jf %Y-%m-%d -v"+$2"d "$1" +%Y-%m-%d
}
# Does a reply name that day? Prints nothing and leaves 0, or the part it is missing. Each part as
# the product writes it, a capital letter and all: a fixed string and a case of its own, because
# some GNU greps (3.0 on the maintainer's machine) end in a crash when asked for both at once.
names_the_day() { # <file> <day>
  local part
  for part in '%A' '%-d' '%B'; do
    grep -qF -- "$(day_words "$2" "$part")" "$1" || {
      printf '%s' "$(day_words "$2" "$part")"
      return 1
    }
  done
  return 0
}
# The number of days to go a reply names ("12 days to go"), or nothing.
days_to_go_in() { # <file>
  grep -oiE '[0-9]+[[:space:]]*days to go' "$1" | head -n 1 | grep -oE '^[0-9]+' || true
}
# How many restarts a reply names ("Restarts: 2"), or nothing.
restarts_in() { # <file>
  grep -oiE 'restarts?[^0-9]{0,12}[0-9]+' "$1" | head -n 1 | grep -oE '[0-9]+$' || true
}
# One value of days.txt.
day_named() { # <folder> <name>
  sed -n "s/^$2=//p" "$1/days.txt" | head -n 1
}
# The card the Trackers shelf holds, and the days of the events under it, one per line.
cards_in() { # <shelf file>
  awk -F'\t' '$1=="card"{print $4}' "$1"
}
events_in() { # <shelf file>
  awk -F'\t' '$1=="event"{print $2}' "$1"
}
# The days the events happened on, each named once, as one line.
event_days_in() { # <shelf file>
  events_in "$1" | sort -u | tr '\n' ' ' | sed 's/[[:space:]]*$//'
}
# What the card and the brief's line have to agree on, for one day of the count: the day of the
# count and the days to go, worked out the way the design works them out (started on S, on T it has
# 21 - (T - S) days to go, and T is day (T - S) + 1 of 21).
days_between() { # <from> <to>
  local from to
  from=$(date -u -d "$1" +%s 2>/dev/null || date -u -jf %Y-%m-%d "$1" +%s)
  to=$(date -u -d "$2" +%s 2>/dev/null || date -u -jf %Y-%m-%d "$2" +%s)
  printf '%s' $(((to - from) / 86400))
}

# One moment of the count: the status the owner was given, the line the brief was given, and the day
# the count started on then. Fails with what disagrees.
judge_the_moment() { # <folder> <what to call it> <status file> <brief file> <started on> <day now>
  local folder=$1 what=$2 status=$3 brief=$4 started=$5 now=$6 gone left day line lines missing
  gone=$(days_between "$started" "$now")
  left=$((DAYS - gone))
  day=$((gone + 1))

  missing=$(names_the_day "$folder/$status" "$(day_plus "$started" "$DAYS")") ||
    fail "$what the challenge does not name its end date, $(day_words "$(day_plus "$started" "$DAYS")" '%A') $(day_words "$(day_plus "$started" "$DAYS")" '%-d') $(day_words "$(day_plus "$started" "$DAYS")" '%B') ($missing is not in it): $(tr '\n' ' ' <"$folder/$status" | cut -c1-160)"
  [ "$(days_to_go_in "$folder/$status")" = "$left" ] ||
    fail "$what the challenge says $(days_to_go_in "$folder/$status") days to go, and it started on $started, so on $now it has $left"

  lines=$(grep -c -F 'Charm Challenge' "$folder/$brief" || true)
  [ "$lines" != 0 ] ||
    fail "$what the morning brief is given no line about the Charm Challenge, so the morning would never mention it"
  [ "$lines" = 1 ] ||
    fail "$what the morning brief is given its Charm Challenge line $lines times, and it is one line"
  line=$(grep -F 'Charm Challenge' "$folder/$brief" | head -n 1)
  case $line in
    *"day $day of $DAYS"*) ;;
    *) fail "$what the brief's line says \"$line\", and on $now a count started on $started is day $day of $DAYS" ;;
  esac
  case $line in
    *"$left days to go"*) ;;
    *) fail "$what the brief's line says \"$line\", and the challenge says $left days to go" ;;
  esac
}

check() { # <evidence folder>
  local folder=$1 start reset slip offset
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of a Charm Challenge"
  kept_all "$folder" 'what the owner said, what came back, and what the notebook then held' \
    days.txt start-reply.txt status-after-start.txt brief-after-start.txt shelf-after-start.txt \
    vent-reply.txt no-reply.txt status-after-no.txt brief-after-no.txt shelf-after-no.txt \
    status-fourth-day.txt brief-fourth-day.txt second-vent-reply.txt yes-reply.txt \
    status-after-yes.txt brief-after-yes.txt shelf-after-yes.txt slip-reply.txt \
    status-after-slip.txt brief-after-slip.txt shelf-after-slip.txt chat.txt

  start=$(day_named "$folder" start)
  reset=$(day_named "$folder" reset)
  slip=$(day_named "$folder" slip)
  offset=$(day_named "$folder" offset)
  [ -n "$start" ] && [ -n "$reset" ] && [ -n "$slip" ] ||
    fail "days.txt does not say which days this scenario acted on, so what the right end date would be cannot be said"
  [ "$offset" = "+0000" ] ||
    fail "this scenario counts the days of the challenge in UTC, and the machine it ran on was $offset off it"

  # 1. The start: the reply names the end date, and says the count stands at 21.
  local missing
  missing=$(names_the_day "$folder/start-reply.txt" "$(day_plus "$start" "$DAYS")") ||
    fail "the start reply does not name the end date, $(day_words "$(day_plus "$start" "$DAYS")" '%A') $(day_words "$(day_plus "$start" "$DAYS")" '%-d') $(day_words "$(day_plus "$start" "$DAYS")" '%B') ($missing is not in it), so the owner is left working it out: $(tr '\n' ' ' <"$folder/start-reply.txt" | cut -c1-160)"
  [ "$(days_to_go_in "$folder/start-reply.txt")" = "$DAYS" ] ||
    fail "the start reply says $(days_to_go_in "$folder/start-reply.txt") days to go, and a challenge that starts stands at $DAYS"
  judge_the_moment "$folder" 'on the day it started,' status-after-start.txt brief-after-start.txt "$start" "$start"

  # The card on the Trackers shelf, and the one event the start made.
  local cards events
  cards=$(cards_in "$folder/shelf-after-start.txt" | grep -c . || true)
  [ "$cards" = 1 ] ||
    fail "the Trackers shelf holds $cards cards of the Charm Challenge after it was started, and it is one card"
  cards_in "$folder/shelf-after-start.txt" | grep -q '"specialist":"charm"' ||
    fail "the card on the Trackers shelf does not name the charm specialist, so it is a card of something else"
  events=$(events_in "$folder/shelf-after-start.txt" | grep -c . || true)
  [ "$events" = 1 ] ||
    fail "the card on the Trackers shelf holds $events events after the challenge was started, and starting it is one"
  [ "$(events_in "$folder/shelf-after-start.txt" | head -n 1)" = "$start" ] ||
    fail "the start the card holds is dated $(events_in "$folder/shelf-after-start.txt" | head -n 1), and the challenge was started on $start"

  # 2. A vent is answered with the work and then the one question, at the end of the reply.
  local tail_of
  tail_of=$(tr -d '\r' <"$folder/vent-reply.txt" | sed -e :a -e '/^[[:space:]]*$/{$d;N;ba' -e '}' | tail -n 1)
  case $tail_of in
    *"$QUESTION") ;;
    *) fail "the reply to a vent ends \"$(printf '%s' "$tail_of" | tail -c 60)\", and a slip Godspeed sees ends with \"$QUESTION\"" ;;
  esac

  # 3. "no" changes nothing: the same numbers, the same end date, and no reset on the card.
  judge_the_moment "$folder" 'after the owner said no,' status-after-no.txt brief-after-no.txt "$start" "$start"
  [ "$(restarts_in "$folder/status-after-no.txt")" = "$(restarts_in "$folder/status-after-start.txt")" ] ||
    fail "the \"no\" moved the restarts from $(restarts_in "$folder/status-after-start.txt") to $(restarts_in "$folder/status-after-no.txt"), and a \"no\" changes nothing"
  events=$(events_in "$folder/shelf-after-no.txt" | grep -c . || true)
  [ "$events" = 2 ] ||
    fail "the card holds $events events after the \"no\", and it should hold the start and the kept answer"
  [ "$(event_days_in "$folder/shelf-after-no.txt")" = "$start" ] ||
    fail "the events on the card after the \"no\" are dated $(event_days_in "$folder/shelf-after-no.txt"), and all of it happened on $start"

  # 4. The fourth day: it counted down by itself, and the end date did not move.
  judge_the_moment "$folder" 'on the fourth day,' status-fourth-day.txt brief-fourth-day.txt "$start" "$reset"

  # 5. "yes" starts over, with a new end date and one more restart.
  judge_the_moment "$folder" 'after the owner said yes,' status-after-yes.txt brief-after-yes.txt "$reset" "$reset"
  names_the_day "$folder/yes-reply.txt" "$(day_plus "$reset" "$DAYS")" >/dev/null ||
    fail "the reply to \"yes\" does not name the new end date, $(day_words "$(day_plus "$reset" "$DAYS")" '%A') $(day_words "$(day_plus "$reset" "$DAYS")" '%-d') $(day_words "$(day_plus "$reset" "$DAYS")" '%B'): $(tr '\n' ' ' <"$folder/yes-reply.txt" | cut -c1-160)"
  if names_the_day "$folder/status-after-yes.txt" "$(day_plus "$start" "$DAYS")" >/dev/null; then
    fail "the challenge still names $(day_words "$(day_plus "$start" "$DAYS")" '%-d') $(day_words "$(day_plus "$start" "$DAYS")" '%B') as its end date after the \"yes\", so it did not start over"
  fi
  [ "$(restarts_in "$folder/status-after-yes.txt")" = 1 ] ||
    fail "the challenge counts $(restarts_in "$folder/status-after-yes.txt") restarts after the first \"yes\", and it should count 1"
  events=$(events_in "$folder/shelf-after-yes.txt" | grep -c . || true)
  [ "$events" = 3 ] ||
    fail "the card holds $events events after the \"yes\", and it should hold the start, the kept answer and the reset"
  events_in "$folder/shelf-after-yes.txt" | grep -qx "$reset" ||
    fail "the card holds no event of $reset, the day the owner said yes"

  # 6. "charm slip" the next day starts over again, with another new end date.
  judge_the_moment "$folder" 'after a charm slip,' status-after-slip.txt brief-after-slip.txt "$slip" "$slip"
  names_the_day "$folder/slip-reply.txt" "$(day_plus "$slip" "$DAYS")" >/dev/null ||
    fail "the reply to \"charm slip\" does not name the new end date, $(day_words "$(day_plus "$slip" "$DAYS")" '%A') $(day_words "$(day_plus "$slip" "$DAYS")" '%-d') $(day_words "$(day_plus "$slip" "$DAYS")" '%B'): $(tr '\n' ' ' <"$folder/slip-reply.txt" | cut -c1-160)"
  [ "$(restarts_in "$folder/status-after-slip.txt")" = 2 ] ||
    fail "the challenge counts $(restarts_in "$folder/status-after-slip.txt") restarts after a \"yes\" on $reset and a \"charm slip\" on $slip, and those are two days, so it should count 2"
  events=$(events_in "$folder/shelf-after-slip.txt" | grep -c . || true)
  [ "$events" = 4 ] ||
    fail "the card holds $events events after the charm slip, and it should hold the start, the kept answer and two resets"
  events_in "$folder/shelf-after-slip.txt" | grep -qx "$slip" ||
    fail "the card holds no event of $slip, the day of the charm slip"

  # The conversation it all happened in is one, and the question was asked in it.
  grep -q "$QUESTION" "$folder/chat.txt" ||
    fail "the conversation the notebook kept holds no \"$QUESTION\", so the owner was never asked in the chat they answered in"

  pass "\"start the Charm Challenge\" answered with $DAYS days to go and $(day_words "$(day_plus "$start" "$DAYS")" '%A') $(day_words "$(day_plus "$start" "$DAYS")" '%-d') $(day_words "$(day_plus "$start" "$DAYS")" '%B') as its end date, the brief was given that one line, a vent ended with \"$QUESTION\", \"no\" left every number where it was, and \"yes\" on the fourth day and \"charm slip\" the day after started over with a new end date each and 2 restarts, with the card on the Trackers shelf holding the four events of it"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
