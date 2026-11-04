#!/usr/bin/env bash
# PROVING SCENARIO OF 2.0.0-beta.16: "today's brief" asked in the chat is the morning briefing.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.16-prepared-talks/plan.md, "Proving
# scenarios" 3, and ticket 08 of that release): on an install with the Charm Challenge running, the
# Morning brief routine runs, and then "today's brief" asked in the notebook's chat is answered
# with the saved briefing: its Charm line word for word, a sentence that breaks one of the owner's
# writing rules absent from the briefing and from the answer, and the repair item that reports it
# listed. Asking again saves no second briefing note, and the chat writes no brief of its own
# (the starter recipe wrote brief/<day>.md; the chat no longer does).
#
# THE SENTENCE THAT BREAKS A RULE is the checked contribution (the notebook's "lead" entry, ready
# and saved as a note), the sentence core/briefing.mjs has to carry word for word and leaves out,
# with a repair item, when it breaks a writing rule (issue #117). The scenario saves one through
# the notebook's own query operation, and the owner's voice file (profile/voice.md) bans a word it
# holds and the Charm line does not. So the cut does not depend on what a model happens to write.
#
# WHERE IT ASKS. A new conversation of the chat panel (scenario-lib.sh, chat_panel_new_conversation),
# the owner's own chat in the notebook, and in the same conversation once more.
#
#   GODSPEED_SCENARIO_AI_KEY    the model that writes the brief and answers the owner (without it:
#                               FAIL), with GODSPEED_SCENARIO_AI_URL and GODSPEED_SCENARIO_AI_MODEL.
#
#   bash scenarios/brief-asked-in-chat.sh candidate/2.0.0-beta.16
#   bash scenarios/brief-asked-in-chat.sh --check <folder>
#
# What it keeps for its checking part:
#   banned-word.txt       the word the voice rules ban
#   voice.md              the voice file as the owner wrote it
#   contribution.txt      the sentence of the checked contribution, which holds the banned word
#   charm-line.txt        the line the morning brief is given about the Charm Challenge
#   brief-run.json        what the notebook said when it ran its routines
#   brief-job.txt         the morning brief routine afterwards
#   brief-note.txt        the newest note the morning brief saved, which is what the owner reads
#   repairs.txt           one line per open repair item: id, state, what was left out, why
#   notes-after-brief.txt how many briefing notes the notebook held after the routine ran
#   chat-brief-1.txt      the answer to "today's brief"
#   chat-brief-2.txt      the answer to asking for it again
#   notes-after-asks.txt  how many briefing notes it held after both questions
#   brief-folder.txt      the files written in brief/ since the routine ran (the starter recipe's own place)
SCENARIO=brief-asked-in-chat
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"

BANNED=synergy
SENTENCE='Synergy between your goals is worth a look today, so keep one hour free for it.'
ASK_1="today's brief"
ASK_2='my brief again'

# shellcheck disable=SC2317,SC2329  # asked by wait_for, which takes the command to try as its arguments
notebook_answers() { curl -fsS "http://127.0.0.1:$NOTEBOOK_PORT/health" >/dev/null 2>&1; }

# The morning brief routine, the briefing notes, and the open repair items, as plain files.
READER='
const fs=require("fs");
const rows=f=>{const d=JSON.parse(fs.readFileSync(f,"utf8"));return Array.isArray(d)?d:(d.data||[]);};
const [jobsF,notesF,workF,jobOut,noteOut,repairOut,countOut]=process.argv.slice(1);
const job=rows(jobsF).find(j=>j&&(j.id===process.env.BRIEF_ID||j.id==="morning-brief"))||{};
fs.writeFileSync(jobOut,["state="+(job.state||""),"paused="+(job.paused===true)].join("\n")+"\n");
const notes=rows(notesF).filter(n=>n&&n.source_app==="morning-brief"&&!n.is_trashed)
 .sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));
fs.writeFileSync(noteOut,notes.length?String(notes.at(-1).content||""):"");
fs.writeFileSync(countOut,notes.length+"\n");
const one=v=>String(v==null?"":v).replace(/\s+/g," ").trim();
fs.writeFileSync(repairOut,rows(workF).filter(w=>w&&w.kind==="repair"&&w.state!=="verified")
 .map(w=>[w.id,w.state,one(w.line_name||w.title),one(w.error)].join("\t")).join("\n")+"\n");
'
# The id of what an insert answered ({data: [row]} or {data: row}).
INSERTED_ID='
const d=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).data;
const row=Array.isArray(d)?d[0]:d;process.stdout.write(String(row&&row.id||""));
'

settings_connects_the_model() {
  local body=$EVIDENCE/.provider.json code request=$EVIDENCE/.provider-ask.json
  printf '{"url":%s,"key":%s,"model":%s,"routines":true}\n' \
    "$(quoted_json "$AI_URL")" "$(quoted_json "$GODSPEED_SCENARIO_AI_KEY")" "$(quoted_json "$AI_MODEL")" >"$request"
  code=$(curl -sS -o "$body" -w '%{http_code}' --max-time 300 -X POST \
    -H 'Content-Type: application/json' --data-binary @"$request" \
    "http://127.0.0.1:$NOTEBOOK_PORT/api/provider") ||
    fail "Settings could not be reached to connect a model, so there is nobody to write or to say the brief"
  if [ "$code" != 200 ]; then
    print_kept_diagnosis "${STATE:-}" "${HERMES:-}"
    fail "Settings refused the model $AI_MODEL at $AI_URL with HTTP $code: $(tr -d '\n' <"$body" | cut -c1-200)"
  fi
  say "The chat and the routines think with $AI_MODEL at $AI_URL"
}
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
insert_row() { # <table> <values as JSON> <file for the answer>
  local code
  code=$(curl -sS -o "$3" -w '%{http_code}' --max-time 120 -X POST -H 'Content-Type: application/json' \
    -d "{\"table\":\"$1\",\"operation\":\"insert\",\"values\":$2}" "http://127.0.0.1:$NOTEBOOK_PORT/api/query") ||
    fail "the notebook could not be reached to save a row of $1"
  [ "$code" = 200 ] ||
    fail "the notebook would not save a row of $1 (HTTP $code): $(tr -d '\n' <"$3" | cut -c1-200)"
}
# What the notebook holds of the morning brief now: the routine, the newest briefing note, the open
# repair items and how many briefing notes there are.
read_the_notebook() { # <job file> <note file> <repairs file> <count file>
  one_table jobs "$EVIDENCE/.jobs.json"
  one_table notes "$EVIDENCE/.notes.json"
  one_table work_items "$EVIDENCE/.work.json"
  BRIEF_ID=${BRIEF_ID:-} "$NODE" -e "$READER" "$EVIDENCE/.jobs.json" "$EVIDENCE/.notes.json" "$EVIDENCE/.work.json" \
    "$1" "$2" "$3" "$4" ||
    fail "what the notebook holds of its morning brief could not be read"
}

act() {
  need_the_ai_key "the morning brief and the owner's own chat"
  fresh_evidence
  install_paths
  install_the_stage_line "$EVIDENCE/.install.log"
  need_node
  wait_for 180 "the notebook to answer after the install" notebook_answers ||
    fail "the notebook does not answer after the install, so there is no chat to ask"
  read_version "$ROOT"
  settings_connects_the_model
  assistant_home

  phase 'the Charm Challenge, the voice rules and a checked contribution that breaks one'
  notebook_answer personal-operation '{"type":"charm","action":"start"}' "$EVIDENCE/.start.json" \
    'the start of the Charm Challenge'
  notebook_answer personal-operation '{"type":"addon-command","addon":"charm","args":["brief","--no-write"]}' "$EVIDENCE/.line.json" \
    'the one line the morning brief is given about the Charm Challenge'
  if ! json_value "$EVIDENCE/.line.json" data.result >"$EVIDENCE/.line-result.json" ||
    ! json_value "$EVIDENCE/.line-result.json" reply >"$EVIDENCE/charm-line.txt" ||
    [ ! -s "$EVIDENCE/charm-line.txt" ]; then
    fail "the notebook's own answer for the morning brief holds no line about the Charm Challenge: $(tr -d '\n' <"$EVIDENCE/.line.json" | cut -c1-200)"
  fi
  printf '\n' >>"$EVIDENCE/charm-line.txt"
  sed 's/^/  | /' "$EVIDENCE/charm-line.txt" >&2
  mkdir -p "$ROOT/profile"
  # shellcheck disable=SC2016  # the backticks are the voice file's own fence, not a command
  printf '# My voice\n\nShort and plain.\n\n```voice-rules\nBANNED-WORD: %s\n```\n' "$BANNED" >"$ROOT/profile/voice.md"
  cp "$ROOT/profile/voice.md" "$EVIDENCE/voice.md"
  printf '%s\n' "$BANNED" >"$EVIDENCE/banned-word.txt"
  printf '%s\n' "$SENTENCE" >"$EVIDENCE/contribution.txt"
  # The contribution: a note, and the ready entry that names it with the same text (core/briefing.mjs
  # takes the newest ready entry whose note holds exactly its content).
  insert_row notes "{\"title\":\"A checked contribution\",\"content\":$(quoted_json "$SENTENCE")}" "$EVIDENCE/.note.json"
  local note_id
  note_id=$("$NODE" -e "$INSERTED_ID" "$EVIDENCE/.note.json")
  [ -n "$note_id" ] || fail "the notebook saved the note of the checked contribution and named no id for it"
  insert_row lead_entries "{\"status\":\"ready\",\"title\":\"A checked contribution\",\"note_id\":$(quoted_json "$note_id"),\"content\":$(quoted_json "$SENTENCE"),\"delivery_day\":$(quoted_json "$(day_in +0)")}" \
    "$EVIDENCE/.entry.json"

  phase 'the morning brief, turned on and run the way Settings runs it'
  run_the_morning_brief "$EVIDENCE/brief-run.json" 1800
  read_the_notebook "$EVIDENCE/brief-job.txt" "$EVIDENCE/brief-note.txt" "$EVIDENCE/repairs.txt" "$EVIDENCE/notes-after-brief.txt"
  for file in brief-job.txt brief-note.txt repairs.txt notes-after-brief.txt; do sed "s/^/  $file | /" "$EVIDENCE/$file" >&2; done
  curl -sS -o /dev/null --max-time 300 -X POST -H 'Content-Type: application/json' \
    -d "{\"id\":\"$BRIEF_ID\",\"paused\":true}" "http://127.0.0.1:$NOTEBOOK_PORT/api/jobs/update" ||
    say '  (the morning brief could not be paused again; it will write another note each minute)'

  phase "asked in the chat: $ASK_1, and again"
  chat_panel_new_conversation "$EVIDENCE/.panel-new.json"
  chat_panel_says "$ASK_1" "$EVIDENCE/chat-brief-1.txt"
  chat_panel_says "$ASK_2" "$EVIDENCE/chat-brief-2.txt"
  read_the_notebook "$EVIDENCE/.job-after.txt" "$EVIDENCE/.note-after.txt" "$EVIDENCE/.repairs-after.txt" "$EVIDENCE/notes-after-asks.txt"
  # Files of brief/ written since the routine ran: the starter recipe wrote its own brief there.
  find "$ROOT/brief" -maxdepth 1 -type f -name '*.md' -newer "$EVIDENCE/brief-run.json" -printf '%f\n' 2>/dev/null | sort >"$EVIDENCE/brief-folder.txt"
  [ -f "$EVIDENCE/brief-folder.txt" ] || : >"$EVIDENCE/brief-folder.txt"
  sed 's/^/  notes-after-asks | /' "$EVIDENCE/notes-after-asks.txt" >&2
  rm -f "$EVIDENCE"/.[a-z]*
}

# ------------------------------------------------------------------------------ what it judges
folded() { tr -s '[:space:]' ' ' <"$1"; }
check() { # <evidence folder>
  local folder=$1 banned line sentence answer n
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of a brief asked in the chat"
  kept_all "$folder" 'what the voice rules, the briefing and the chat held' \
    banned-word.txt voice.md contribution.txt charm-line.txt brief-run.json brief-job.txt \
    notes-after-brief.txt chat-brief-1.txt chat-brief-2.txt notes-after-asks.txt
  [ -f "$folder/brief-note.txt" ] || fail "brief-note.txt is not in what the scenario kept: the note the morning brief wrote"
  [ -f "$folder/repairs.txt" ] || fail "repairs.txt is not in what the scenario kept: the repair items the notebook holds"
  [ -f "$folder/brief-folder.txt" ] || fail "brief-folder.txt is not in what the scenario kept: what brief/ held after the questions"
  banned=$(head -n 1 "$folder/banned-word.txt")
  line=$(head -n 1 "$folder/charm-line.txt")
  sentence=$(head -n 1 "$folder/contribution.txt")

  # 1. The scenario set up what it says it set up.
  grep -qiw -- "$banned" "$folder/voice.md" ||
    fail "the voice file the scenario wrote does not name \"$banned\", so nothing was banned"
  grep -qiw -- "$banned" <<<"$sentence" ||
    fail "the seeded sentence (\"$sentence\") does not contain the banned word \"$banned\", so this run proves nothing about a sentence that breaks a rule"
  if grep -qiw -- "$banned" <<<"$line"; then
    fail "the Charm line (\"$line\") contains the banned word \"$banned\", so it would be cut and could not be compared word for word"
  fi

  # 2. The routine saved a briefing that carries the Charm line as a line of its own, once, and not the sentence.
  [ -s "$folder/brief-note.txt" ] ||
    fail "the morning brief saved no note (its routine is \"$(sed -n 's/^state=//p' "$folder/brief-job.txt")\" and the notebook said $(tr -d '\n' <"$folder/brief-run.json" | cut -c1-200)), so there was no briefing to ask for"
  grep -qxF -- "$line" <(sed 's/^[[:space:]]*//;s/[[:space:]]*$//' "$folder/brief-note.txt") ||
    fail "the saved briefing does not carry \"$line\" as a line of its own: $(tr '\n' ' ' <"$folder/brief-note.txt" | cut -c1-200)"
  if grep -qF -- "$sentence" "$folder/brief-note.txt" || grep -qiw -- "$banned" "$folder/brief-note.txt"; then
    fail "the saved briefing still carries the sentence that breaks the owner's rules (\"$banned\"): $(tr '\n' ' ' <"$folder/brief-note.txt" | cut -c1-200)"
  fi

  # 3. The repair item for the cut sentence is listed.
  grep -q . "$folder/repairs.txt" ||
    fail "the notebook holds no open repair item, so the owner is never told a sentence of the briefing was left out"
  grep -i 'contribution' "$folder/repairs.txt" | grep -qi -- "$banned" ||
    fail "no open repair item names the checked contribution and the banned word \"$banned\": $(tr '\n' '|' <"$folder/repairs.txt" | cut -c1-240)"

  # 4. "today's brief" in the chat, twice: the Charm line word for word, and not the sentence.
  for n in 1 2; do
    answer=$folder/chat-brief-$n.txt
    [ -s "$answer" ] || fail "the chat answered nothing the $n. time the brief was asked for"
    folded "$answer" | grep -qF -- "$line" ||
      fail "the chat's answer $n to a request for the brief does not carry the briefing's Charm line word for word (\"$line\"): $(tr '\n' ' ' <"$answer" | cut -c1-240)"
    if folded "$answer" | grep -qF -- "$sentence" || grep -qiw -- "$banned" "$answer"; then
      fail "the chat's answer $n to a request for the brief carries the sentence that breaks the owner's rules (\"$banned\"): $(tr '\n' ' ' <"$answer" | cut -c1-240)"
    fi
  done

  # 5. One briefing: asking saved no second note, and the chat wrote no brief of its own.
  [ "$(tr -d '[:space:]' <"$folder/notes-after-brief.txt")" = "$(tr -d '[:space:]' <"$folder/notes-after-asks.txt")" ] ||
    fail "the notebook held $(tr -d '[:space:]' <"$folder/notes-after-brief.txt") briefing notes after the routine and $(tr -d '[:space:]' <"$folder/notes-after-asks.txt") after the chat was asked for the brief twice, and asking saves no second one"
  grep -q . "$folder/brief-folder.txt" &&
    fail "the chat wrote a brief of its own (brief/$(head -n 1 "$folder/brief-folder.txt")), which is the starter recipe's, and not the morning briefing"

  pass "the Morning brief routine saved the briefing with \"$line\" as a line of its own and without the checked contribution that breaks the owner's rules (\"$banned\"), an open repair item reports it, \"$ASK_1\" and \"$ASK_2\" in the chat were each answered with that Charm line word for word and without the sentence, and no second briefing note and no brief of the chat's own was written"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  need_node
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
