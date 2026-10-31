#!/usr/bin/env bash
# PROVING SCENARIO 1 OF 2.0.0-beta.13: the Charm Challenge, start to finish.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.13-charm-video-notebook/plan.md,
# scenario 1, from Michael's design of 21 October 2026): on a fresh install, "start the Charm
# Challenge" gives the start reply with the right end date; the morning brief's input carries its
# one line and the brief itself delivers it; a vent in the chat ends with "Back to 21? Yes / No";
# "no" changes nothing; "yes" and "charm slip" start over with a new end date; and the card on the
# Trackers shelf shows the same numbers.
#
# WHERE IT SAYS ALL THAT, each thing where the notebook itself holds it:
#   the chat        the owner's own chat, the notebook's own one (POST /api/browser-chat), which
#                   keeps one conversation, so the reset question and the yes or no that answers it
#                   are in the conversation that asked it, which is the only place the design lets a
#                   bare "yes" count. The model that answers is the one Settings connects (POST
#                   /api/provider), with the key the job hands this scenario.
#   the brief       the line the morning brief is GIVEN, through the notebook's own operation, which
#                   is the call the brief itself makes (core/briefing.mjs asks the cycle tracker for
#                   its heads-up line exactly so: {action:'brief'}.line, and puts it in word for
#                   word or refuses the draft). And then the morning brief itself, run as Settings
#                   runs it, and the note it wrote, which is what the owner reads.
#   the shelf       the Trackers shelf's own list, as the notebook answers it for its own pages
#                   (tracker-list: every tracker with its card, its columns and its entries), and
#                   the card's own numbers, as the notebook says them.
# Nothing here reads a record file by hand and nothing imports the product's code.
#
# THE DAYS HAVE TO PASS. A fresh install starts the challenge today, and a reset today would name
# the same end date, so "start over with a new end date" would say nothing. GODSPEED_NOW is the
# product's own frozen clock for a rehearsal (notebook/core/tracker-operations.mjs), and this is a
# rehearsal: the scenario sets it on the notebook's own service and starts it again, so the fourth
# day and the fifth day of the count really arrive. A clock it cannot move is a FAIL.
#
# WHAT IT ASSUMES OF THE ADD-ON, because it is written from the release plan while the add-on is
# built beside it (ticket 01), and both are the design's own words: the notebook answers the charm
# operation (`{type:"charm"}`, as it answers the cycle's and the headache's) with `brief` for the
# one line the morning brief is given and `status` for what the challenge stands at; and the
# challenge is a collection on the Trackers shelf whose card names the specialist "charm" and whose
# items are its events, each with its own `when`. A stage where they are not so fails here with that
# as its symptom, which is what a proving scenario is for.
#
#   GODSPEED_SCENARIO_AI_KEY    the model that answers the owner and writes the brief (without it:
#                               FAIL), with GODSPEED_SCENARIO_AI_URL and GODSPEED_SCENARIO_AI_MODEL,
#                               the names update-keeps-everything uses. No ElevenLabs key: no voice
#                               note is involved.
#
#   bash scenarios/charm-challenge.sh candidate/2.0.0-beta.13
#   bash scenarios/charm-challenge.sh --check <folder>
#
# What it keeps for its checking part:
#   days.txt                     the three days it acted on, and the machine's own clock offset
#   start-reply.txt              the reply to "start the Charm Challenge"
#   status-after-start.txt       what the chat says the challenge stands at, on the day it started
#   card-after-start.txt         what the notebook says the card shows, that day
#   brief-after-start.txt        the line the morning brief is given, that day
#   shelf-after-start.txt        the Trackers shelf's own list: the card and its events
#   vent-reply.txt               the reply to a vent, that day
#   no-reply.txt                 the reply to "no"
#   status-after-no.txt / card-after-no.txt / brief-after-no.txt / shelf-after-no.txt
#   status-fourth-day.txt / card-fourth-day.txt / brief-fourth-day.txt    three days later
#   brief-run.json               what the notebook said when it ran its routines that day
#   brief-job.txt                its morning brief routine afterwards
#   brief-note.txt               the note the morning brief wrote, which is what the owner reads
#   second-vent-reply.txt / yes-reply.txt                                 the vent and the "yes"
#   status-after-yes.txt / card-after-yes.txt / brief-after-yes.txt / shelf-after-yes.txt
#   slip-reply.txt                                                        the day after, "charm slip"
#   status-after-slip.txt / card-after-slip.txt / brief-after-slip.txt / shelf-after-slip.txt
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

# The Trackers shelf's own list, as plain lines: the card of the charm tracker and one line per
# event under it. tracker-list is what the notebook answers for its own pages (every tracker with
# its card, its other names, its columns and its entries).
SHELF_READER='
const fs=require("fs");
const answer=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),list=(answer.data||answer).trackers||[];
const out=[];
for(const t of list.filter(t=>t&&t.specialist==="charm")){
 out.push(["card",t.name||"",t.specialist,JSON.stringify(t)].join("\t"));
 for(const e of (t.recent||[]))out.push(["event",String(e.when||"?"),JSON.stringify(e.data||{})].join("\t"));
}
process.stdout.write(out.sort().join("\n")+"\n");
'
# The conversation as the notebook kept it: one line per message, <role><TAB>what was said.
CHAT_READER='
const fs=require("fs");
const d=JSON.parse(fs.readFileSync(process.argv[1],"utf8")),rows=d.messages||d.data||[];
process.stdout.write(rows.map(m=>[m.role||"",String(m.content||"").replace(/\s+/g," ").trim()].join("\t")).join("\n")+"\n");
'
# The morning brief routine as the notebook holds it, and the note it wrote: the newest note the
# brief itself saved (core/briefing.mjs saves it with source_app "morning-brief").
BRIEF_READER='
const fs=require("fs");
const rows=f=>{const d=JSON.parse(fs.readFileSync(f,"utf8"));return Array.isArray(d)?d:(d.data||[]);};
const job=rows(process.argv[1]).find(j=>j&&j.id==="morning-brief")||{};
fs.writeFileSync(process.argv[3],["state="+(job.state||""),"paused="+(job.paused===true),"next_run="+(job.next_run||"")].join("\n")+"\n");
const notes=rows(process.argv[2]).filter(n=>n&&n.source_app==="morning-brief"&&!n.is_trashed)
 .sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));
fs.writeFileSync(process.argv[4],notes.length?String(notes.at(-1).content||""):"");
'

# Settings' own way of connecting a model (server/main.mjs POST /api/provider), which is what the
# owner's chat thinks with and what the routines are run with.
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
  say "The owner's chat and the routines think with $AI_MODEL at $AI_URL"
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

# One answer of the notebook's own, over its own address: POST /api/functions/<name>, which is what
# its own pages ask it. The answer is {data,error}.
notebook_answer() { # <function> <body> <file> <what it is for>
  local code
  code=$(curl -sS -o "$3" -w '%{http_code}' --max-time 600 -X POST \
    -H 'Content-Type: application/json' -d "$2" \
    "http://127.0.0.1:$NOTEBOOK_PORT/api/functions/$1") ||
    fail "the notebook could not be reached on its own address, so $4 could not be read"
  [ "$code" = 200 ] ||
    fail "the notebook answered HTTP $code when asked for $4: $(tr -d '\n' <"$3" | cut -c1-200)"
}
one_table() { # <table> <file>
  curl -fsS --max-time 300 -X POST -H 'Content-Type: application/json' -d "{\"table\":\"$1\"}" \
    "http://127.0.0.1:$NOTEBOOK_PORT/api/query" -o "$2" ||
    fail "the notebook's own $1 could not be read"
}

# THE ONE LINE THE MORNING BRIEF IS GIVEN: the notebook's own answer, the call the brief makes.
keep_the_brief_line() { # <file>
  notebook_answer personal-operation '{"type":"charm","action":"brief"}' "$EVIDENCE/.brief.json" \
    'the one line the morning brief is given about the Charm Challenge'
  json_value "$EVIDENCE/.brief.json" data.line >"$1" ||
    fail "the notebook's own answer for the morning brief holds no line about the Charm Challenge: $(tr -d '\n' <"$EVIDENCE/.brief.json" | cut -c1-200)"
  printf '\n' >>"$1"
  sed 's/^/  | /' "$1" >&2
}
# THE CARD'S OWN NUMBERS, as the notebook says them: what the challenge stands at, which is what the
# card on the Trackers shelf shows.
keep_the_card() { # <file>
  notebook_answer personal-operation '{"type":"charm","action":"status"}' "$EVIDENCE/.card.json" \
    'what the Charm Challenge stands at'
  json_value "$EVIDENCE/.card.json" data.reply >"$1" ||
    fail "the notebook's own answer about the Charm Challenge holds nothing a card could show: $(tr -d '\n' <"$EVIDENCE/.card.json" | cut -c1-200)"
  printf '\n' >>"$1"
  sed 's/^/  | /' "$1" >&2
}
# THE TRACKERS SHELF'S OWN LIST, and the charm card in it.
keep_the_shelf() { # <file>
  notebook_answer personal-operation '{"type":"tracker-list","days":366}' "$EVIDENCE/.shelf.json" \
    "the Trackers shelf's own list"
  "$NODE" -e "$SHELF_READER" "$EVIDENCE/.shelf.json" >"$1" ||
    fail "what the notebook answered for the Trackers shelf could not be read"
  sed 's/^/  | /' "$1" >&2
}

# THE MORNING BRIEF ITSELF, run the way Settings runs it: the routine turned on (POST /api/jobs/add,
# core/jobs/routine-control.mjs) and then the notebook's own run of what is due (POST /api/jobs/run).
# On this day the clock has moved three days on, so the brief is due whether the install had made
# the routine already or not. It is paused afterwards, so it does not write a note a minute for the
# rest of the scenario.
the_brief_runs() {
  local body=$EVIDENCE/.job-answer.json code
  say 'The morning brief, turned on and run the way Settings runs it'
  code=$(curl -sS -o "$body" -w '%{http_code}' --max-time 300 -X POST \
    -H 'Content-Type: application/json' -d '{"kind":"morning-brief","interval_ms":60000}' \
    "http://127.0.0.1:$NOTEBOOK_PORT/api/jobs/add") ||
    fail "the notebook could not be reached to turn its morning brief on"
  [ "$code" = 200 ] ||
    fail "the notebook would not turn its morning brief on (HTTP $code): $(tr -d '\n' <"$body" | cut -c1-200)"
  curl -sS --max-time 2400 -X POST -H 'Content-Type: application/json' -d '{}' \
    "http://127.0.0.1:$NOTEBOOK_PORT/api/jobs/run" -o "$EVIDENCE/brief-run.json" ||
    fail "the notebook's own run of its routines could not be asked for, so the morning brief never ran"
  sed 's/^/  | /' "$EVIDENCE/brief-run.json" >&2
  one_table jobs "$EVIDENCE/.jobs.json"
  one_table notes "$EVIDENCE/.notes.json"
  "$NODE" -e "$BRIEF_READER" "$EVIDENCE/.jobs.json" "$EVIDENCE/.notes.json" \
    "$EVIDENCE/brief-job.txt" "$EVIDENCE/brief-note.txt" ||
    fail "what the notebook holds of its morning brief and its note could not be read"
  sed 's/^/  | /' "$EVIDENCE/brief-job.txt" >&2
  sed 's/^/  | /' "$EVIDENCE/brief-note.txt" >&2
  curl -sS -o /dev/null --max-time 300 -X POST -H 'Content-Type: application/json' \
    -d '{"id":"morning-brief","paused":true}' "http://127.0.0.1:$NOTEBOOK_PORT/api/jobs/update" ||
    say '  (the morning brief could not be paused again; it will write another note each minute)'
}

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
  need_the_ai_key "the owner's own chat with the assistant and the morning brief"
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
  keep_the_card "$EVIDENCE/card-after-start.txt"
  keep_the_brief_line "$EVIDENCE/brief-after-start.txt"
  keep_the_shelf "$EVIDENCE/shelf-after-start.txt"

  phase 'a vent, and no'
  owner_says "$VENT" "$EVIDENCE/vent-reply.txt"
  owner_says no "$EVIDENCE/no-reply.txt"
  owner_says "$ASK" "$EVIDENCE/status-after-no.txt"
  keep_the_card "$EVIDENCE/card-after-no.txt"
  keep_the_brief_line "$EVIDENCE/brief-after-no.txt"
  keep_the_shelf "$EVIDENCE/shelf-after-no.txt"

  phase 'the fourth day, and the morning brief'
  notebook_clock_at "$RESET_DAY"
  owner_says "$ASK" "$EVIDENCE/status-fourth-day.txt"
  keep_the_card "$EVIDENCE/card-fourth-day.txt"
  keep_the_brief_line "$EVIDENCE/brief-fourth-day.txt"
  the_brief_runs

  phase 'a vent, and yes'
  owner_says "$SECOND_VENT" "$EVIDENCE/second-vent-reply.txt"
  owner_says yes "$EVIDENCE/yes-reply.txt"
  owner_says "$ASK" "$EVIDENCE/status-after-yes.txt"
  keep_the_card "$EVIDENCE/card-after-yes.txt"
  keep_the_brief_line "$EVIDENCE/brief-after-yes.txt"
  keep_the_shelf "$EVIDENCE/shelf-after-yes.txt"

  phase 'a slip somewhere else'
  notebook_clock_at "$SLIP_DAY"
  owner_says 'charm slip' "$EVIDENCE/slip-reply.txt"
  owner_says "$ASK" "$EVIDENCE/status-after-slip.txt"
  keep_the_card "$EVIDENCE/card-after-slip.txt"
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
all_day_words() { # <day>
  printf '%s %s %s' "$(day_words "$1" '%A')" "$(day_words "$1" '%-d')" "$(day_words "$1" '%B')"
}
# Does what it says name that day? Prints nothing and leaves 0, or the part it is missing. Each part
# as the product writes it, a capital letter and all: a fixed string and a case of its own, because
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
# The number of days to go something says ("12 days to go"), or nothing.
days_to_go_in() { # <file>
  grep -oiE '[0-9]+[[:space:]]*days to go' "$1" | head -n 1 | grep -oE '^[0-9]+' || true
}
# How many restarts it says ("Restarts: 2"), or nothing.
restarts_in() { # <file>
  grep -oiE 'restarts?[^0-9]{0,12}[0-9]+' "$1" | head -n 1 | grep -oE '[0-9]+$' || true
}
# The longest run it says ("Longest run so far: 9 days"), or nothing.
longest_run_in() { # <file>
  grep -oiE 'longest run[^0-9]{0,16}[0-9]+' "$1" | head -n 1 | grep -oE '[0-9]+$' || true
}
# One value of a file of <name>=<value> lines.
valued() { # <file> <name>
  sed -n "s/^$2=//p" "$1" | head -n 1
}
# The card the Trackers shelf holds, and the days of the events under it, one per line.
cards_in() { # <shelf file>
  awk -F'\t' '$1=="card"{print $4}' "$1"
}
events_in() { # <shelf file>
  awk -F'\t' '$1=="event"{print $2}' "$1"
}
event_days_in() { # <shelf file>
  events_in "$1" | sort -u | tr '\n' ' ' | sed 's/[[:space:]]*$//'
}
days_between() { # <from> <to>
  local from to
  from=$(date -u -d "$1" +%s 2>/dev/null || date -u -jf %Y-%m-%d "$1" +%s)
  to=$(date -u -d "$2" +%s 2>/dev/null || date -u -jf %Y-%m-%d "$2" +%s)
  printf '%s' $(((to - from) / 86400))
}

# ONE MOMENT OF THE COUNT, read in the three places a person meets it: the card on the Trackers
# shelf, the chat, and the line the morning brief is given. Every one of them has to say the count
# the design works out (started on S, on T it has 21 - (T - S) days to go, and T is day (T - S) + 1
# of 21) and name the same end date.
judge_the_moment() { # <folder> <what to call it> <card file> <status file> <brief file> <started on> <day now>
  local folder=$1 what=$2 card=$3 status=$4 brief=$5 started=$6 now=$7 gone left day line lines missing end
  gone=$(days_between "$started" "$now")
  left=$((DAYS - gone))
  day=$((gone + 1))
  end=$(day_plus "$started" "$DAYS")

  for file in "$card" "$status"; do
    missing=$(names_the_day "$folder/$file" "$end") ||
      fail "$what $(what_it_is "$file") does not name the end date, $(all_day_words "$end") ($missing is not in it): $(tr '\n' ' ' <"$folder/$file" | cut -c1-160)"
    [ "$(days_to_go_in "$folder/$file")" = "$left" ] ||
      fail "$what $(what_it_is "$file") says $(days_to_go_in "$folder/$file") days to go, and the challenge started on $started, so on $now it has $left"
  done
  # The two of them are the same count, so every number a person sees in both has to be the same.
  [ "$(restarts_in "$folder/$card")" = "$(restarts_in "$folder/$status")" ] ||
    fail "$what the card on the Trackers shelf says $(restarts_in "$folder/$card") restarts and the chat says $(restarts_in "$folder/$status")"
  [ "$(longest_run_in "$folder/$card")" = "$(longest_run_in "$folder/$status")" ] ||
    fail "$what the card on the Trackers shelf says the longest run is $(longest_run_in "$folder/$card") and the chat says $(longest_run_in "$folder/$status")"

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
what_it_is() { # <file name>: what to call it in a symptom
  case $1 in
    card-*) printf 'the card on the Trackers shelf' ;;
    *) printf 'the chat' ;;
  esac
}

check() { # <evidence folder>
  local folder=$1 start reset slip offset
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of a Charm Challenge"
  kept_all "$folder" 'what the owner said, what came back, and what the notebook then held' \
    days.txt start-reply.txt status-after-start.txt card-after-start.txt brief-after-start.txt \
    shelf-after-start.txt vent-reply.txt no-reply.txt status-after-no.txt card-after-no.txt \
    brief-after-no.txt shelf-after-no.txt status-fourth-day.txt card-fourth-day.txt \
    brief-fourth-day.txt brief-run.json brief-job.txt second-vent-reply.txt yes-reply.txt \
    status-after-yes.txt card-after-yes.txt brief-after-yes.txt shelf-after-yes.txt slip-reply.txt \
    status-after-slip.txt card-after-slip.txt brief-after-slip.txt shelf-after-slip.txt chat.txt
  [ -f "$folder/brief-note.txt" ] ||
    fail "brief-note.txt is not in what the scenario kept: the note the morning brief wrote"

  start=$(valued "$folder/days.txt" start)
  reset=$(valued "$folder/days.txt" reset)
  slip=$(valued "$folder/days.txt" slip)
  offset=$(valued "$folder/days.txt" offset)
  [ -n "$start" ] && [ -n "$reset" ] && [ -n "$slip" ] ||
    fail "days.txt does not say which days this scenario acted on, so what the right end date would be cannot be said"
  [ "$offset" = "+0000" ] ||
    fail "this scenario counts the days of the challenge in UTC, and the machine it ran on was $offset off it"

  # 1. The start: the reply names the end date, and says the count stands at 21.
  local missing
  missing=$(names_the_day "$folder/start-reply.txt" "$(day_plus "$start" "$DAYS")") ||
    fail "the start reply does not name the end date, $(all_day_words "$(day_plus "$start" "$DAYS")") ($missing is not in it), so the owner is left working it out: $(tr '\n' ' ' <"$folder/start-reply.txt" | cut -c1-160)"
  [ "$(days_to_go_in "$folder/start-reply.txt")" = "$DAYS" ] ||
    fail "the start reply says $(days_to_go_in "$folder/start-reply.txt") days to go, and a challenge that starts stands at $DAYS"
  judge_the_moment "$folder" 'on the day it started,' card-after-start.txt status-after-start.txt \
    brief-after-start.txt "$start" "$start"

  # The card is on the Trackers shelf, with the one event the start made.
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

  # 3. "no" changes nothing: the same numbers in all three places, and no reset on the card.
  judge_the_moment "$folder" 'after the owner said no,' card-after-no.txt status-after-no.txt \
    brief-after-no.txt "$start" "$start"
  [ "$(restarts_in "$folder/card-after-no.txt")" = "$(restarts_in "$folder/card-after-start.txt")" ] ||
    fail "the \"no\" moved the restarts on the card from $(restarts_in "$folder/card-after-start.txt") to $(restarts_in "$folder/card-after-no.txt"), and a \"no\" changes nothing"
  [ "$(longest_run_in "$folder/card-after-no.txt")" = "$(longest_run_in "$folder/card-after-start.txt")" ] ||
    fail "the \"no\" moved the longest run on the card from $(longest_run_in "$folder/card-after-start.txt") to $(longest_run_in "$folder/card-after-no.txt"), and a \"no\" changes nothing"
  events=$(events_in "$folder/shelf-after-no.txt" | grep -c . || true)
  [ "$events" = 2 ] ||
    fail "the card holds $events events after the \"no\", and it should hold the start and the kept answer"
  [ "$(event_days_in "$folder/shelf-after-no.txt")" = "$start" ] ||
    fail "the events on the card after the \"no\" are dated $(event_days_in "$folder/shelf-after-no.txt"), and all of it happened on $start"

  # 4. The fourth day: it counted down by itself, and the morning brief carried the line of that day
  # to the owner, word for word and as a line of its own (core/briefing.mjs refuses a draft without
  # it), which is the brief being given the line and delivering it.
  judge_the_moment "$folder" 'on the fourth day,' card-fourth-day.txt status-fourth-day.txt \
    brief-fourth-day.txt "$start" "$reset"
  local line
  line=$(grep -F 'Charm Challenge' "$folder/brief-fourth-day.txt" | head -n 1)
  [ -s "$folder/brief-note.txt" ] ||
    fail "the notebook's morning brief wrote no note on the fourth day, so its one line reached nobody (its routine is \"$(valued "$folder/brief-job.txt" state)\" and it said $(tr -d '\n' <"$folder/brief-run.json" | cut -c1-200))"
  grep -qxF -- "$line" <(sed 's/^[[:space:]]*//;s/[[:space:]]*$//' "$folder/brief-note.txt") ||
    fail "the morning brief's own note does not carry \"$line\" as a line of its own, so the brief was given the line and lost it: $(tr '\n' ' ' <"$folder/brief-note.txt" | cut -c1-200)"
  [ "$(times_in "$folder/brief-note.txt" "$line")" = 1 ] ||
    fail "the morning brief's own note carries \"$line\" $(times_in "$folder/brief-note.txt" "$line") times, and the brief carries its one line once"

  # 5. "yes" starts over, with a new end date and one more restart, in all three places.
  judge_the_moment "$folder" 'after the owner said yes,' card-after-yes.txt status-after-yes.txt \
    brief-after-yes.txt "$reset" "$reset"
  names_the_day "$folder/yes-reply.txt" "$(day_plus "$reset" "$DAYS")" >/dev/null ||
    fail "the reply to \"yes\" does not name the new end date, $(all_day_words "$(day_plus "$reset" "$DAYS")"): $(tr '\n' ' ' <"$folder/yes-reply.txt" | cut -c1-160)"
  if names_the_day "$folder/card-after-yes.txt" "$(day_plus "$start" "$DAYS")" >/dev/null; then
    fail "the card still names $(day_words "$(day_plus "$start" "$DAYS")" '%-d') $(day_words "$(day_plus "$start" "$DAYS")" '%B') as the end date after the \"yes\", so the challenge did not start over"
  fi
  [ "$(restarts_in "$folder/card-after-yes.txt")" = 1 ] ||
    fail "the card counts $(restarts_in "$folder/card-after-yes.txt") restarts after the first \"yes\", and it should count 1"
  events=$(events_in "$folder/shelf-after-yes.txt" | grep -c . || true)
  [ "$events" = 3 ] ||
    fail "the card holds $events events after the \"yes\", and it should hold the start, the kept answer and the reset"
  events_in "$folder/shelf-after-yes.txt" | grep -qx "$reset" ||
    fail "the card holds no event of $reset, the day the owner said yes"

  # 6. "charm slip" the next day starts over again, with another new end date.
  judge_the_moment "$folder" 'after a charm slip,' card-after-slip.txt status-after-slip.txt \
    brief-after-slip.txt "$slip" "$slip"
  names_the_day "$folder/slip-reply.txt" "$(day_plus "$slip" "$DAYS")" >/dev/null ||
    fail "the reply to \"charm slip\" does not name the new end date, $(all_day_words "$(day_plus "$slip" "$DAYS")"): $(tr '\n' ' ' <"$folder/slip-reply.txt" | cut -c1-160)"
  [ "$(restarts_in "$folder/card-after-slip.txt")" = 2 ] ||
    fail "the card counts $(restarts_in "$folder/card-after-slip.txt") restarts after a \"yes\" on $reset and a \"charm slip\" on $slip, and those are two days, so it should count 2"
  events=$(events_in "$folder/shelf-after-slip.txt" | grep -c . || true)
  [ "$events" = 4 ] ||
    fail "the card holds $events events after the charm slip, and it should hold the start, the kept answer and two resets"
  events_in "$folder/shelf-after-slip.txt" | grep -qx "$slip" ||
    fail "the card holds no event of $slip, the day of the charm slip"

  # The conversation it all happened in is one, and the question was asked in it.
  grep -q "$QUESTION" "$folder/chat.txt" ||
    fail "the conversation the notebook kept holds no \"$QUESTION\", so the owner was never asked in the chat they answered in"

  pass "\"start the Charm Challenge\" answered with $DAYS days to go and $(all_day_words "$(day_plus "$start" "$DAYS")") as its end date; on the fourth day the card on the Trackers shelf, the chat and the brief's own line all said day 4 of $DAYS and $((DAYS - 3)) days to go, and the morning brief's note carried \"$line\" word for word; a vent ended with \"$QUESTION\", \"no\" left every number where it was, and \"yes\" on the fourth day and \"charm slip\" the day after started over with a new end date each and 2 restarts, with the four events of it on the card"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
