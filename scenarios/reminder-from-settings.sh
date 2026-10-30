#!/usr/bin/env bash
# PROVING SCENARIO 6 of 2.0.0-beta.12: a reminder saved in Settings on a fresh install is a page in
# the notebook, is said by the 08:00 reminders, and is in the morning brief's input.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.12-reminders-in-the-notebook/plan.md,
# scenario 6): nothing a person does changes, and what they save in one place is read in every
# other. On 18 October 2026 a deadline saved in Settings was a notebook record while the 08:00
# reminders and the brief read only due/, so it was never mentioned at all; it was given a file in
# due/ to fix that. Now there is one home again, the notebook, and this holds the three readers to
# it on a machine that was installed today.
#
# Settings saves it the way the form does: POST /api/functions/personal-operation with
# {"type":"obligation-add", ...} on the notebook's own address (notebook/ui/src/local/
# ObligationForm.tsx, server/main.mjs). The 08:00 reminders are the routine Hermes runs at eight
# (notebook/core/routine-scripts/godspeed_routines.py, `due`: mc-due check and mc-due today, printed
# as "From your deadline reminders"). On a machine where no first goal has started the routines yet
# the notebook has written no script for them (core/native-scheduler.mjs writes them when the
# routines are made), so the scenario runs the two commands that routine runs, through this
# installation's own programs, and says in reminders-source.txt which of the two it ran.
# The brief's input is the deadlines the briefing reads (core/briefing.mjs: every deadline row that
# is not closed), read over GET /api/personal, which is the same rows; the brief itself is written
# by an AI and is not run here.
#
#   bash scenarios/reminder-from-settings.sh candidate/2.0.0-beta.12
#   bash scenarios/reminder-from-settings.sh --check <folder>
#
# What it keeps for its checking part:
#   what.txt             the reminder it saved: its title, what done means, its last day
#   settings-answer.json what Settings answered when it was saved
#   settings-code.txt    and the HTTP code it answered with
#   pages.txt            the notebook's reminder pages: <title><TAB>file
#   page.md              the page itself
#   reminders.txt        the text the 08:00 reminders say
#   reminders-source.txt where that text came from
#   brief-input.json     GET /api/personal, which holds the deadlines the brief reads
#   due-folder.txt       what is in due/ afterwards, which is where this no longer goes
SCENARIO='reminder-from-settings'
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"

TITLE='Pick up the parcel from the post office'
DONE_WHEN='The parcel is at home.'
COST='It goes back to the sender.'

said() { # <file> <key>
  awk -F'\t' -v key="$2" '$1==key{print $2;exit}' "$1"
}
# shellcheck disable=SC2329  # asked by wait_for, which takes the command to try as its arguments
notebook_answers() { curl -fsS "http://127.0.0.1:$NOTEBOOK_PORT/health" >/dev/null 2>&1; }
# One deadline row of what the brief reads, by its title: <status><TAB>title. Exit 1 when the brief
# would never see it, 3 when the answer is no answer of Settings'.
# shellcheck disable=SC2016  # a JavaScript program, which this shell must not expand
BRIEF_ROW='
const fs=require("fs");
let data;try{data=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));}catch{process.exit(3);}
const rows=data&&data.deadlines;if(!Array.isArray(rows))process.exit(3);
const row=rows.find(r=>r&&String(r.title||"").trim()===process.argv[2].trim());
if(!row)process.exit(1);
process.stdout.write([row.status||"",row.title||""].join("\t"));
'
brief_row() { # <file> <title>
  "$NODE" -e "$BRIEF_ROW" "$1" "$2"
}
# The assistant's own Python, found the way the product itself finds it (core/runtime.mjs).
assistant_python() {
  local version executable source_root
  version=$(cat "$RUNTIME/version") || fail "the install left no version file behind"
  executable=$(json_value "$STATE/assistant.json" executable) || return 1
  source_root=$(json_value "$STATE/assistant.json" sourceRoot) || source_root=''
  "$NODE" -e '
const [module_,executable,sourceRoot,home]=process.argv.slice(1);
import(require("url").pathToFileURL(module_).href).then(m=>{
 const {python}=m.hermesPython({executable,sourceRoot:sourceRoot||undefined,home});
 process.stdout.write(python||"");
}).catch(()=>process.exit(1));
' "$RUNTIME/versions/$version/notebook/core/runtime.mjs" "$executable" "$source_root" "$HERMES"
}

# ------------------------------------------------------------------------------------ the acting
# WHAT THE 08:00 REMINDERS SAY. The routine itself where the notebook has written it, else the two
# commands that routine runs, through this installation's own programs.
reminders_text() { # <text file> <where it came from, file>
  local script=$HERMES/scripts/godspeed-deadline-reminders.py python=''
  if [ -f "$script" ]; then
    python=$(assistant_python) || python=''
    [ -n "$python" ] && [ -x "$python" ] || python=$(command -v python3 2>/dev/null || true)
    [ -n "$python" ] ||
      fail "the notebook wrote the 08:00 routine ($script) and this machine has no Python to run it with"
    printf 'the routine itself, %s, run with %s\n' "$script" "$python" >"$2"
    (cd "$HERMES/scripts" && HERMES_HOME="$HERMES" timeout 300 "$python" "$script") >"$1" 2>&1 ||
      fail "the 08:00 deadline reminders routine failed: $(tr -d '\n' <"$1" | cut -c1-300)"
  else
    printf 'the two commands the 08:00 routine runs (mc-due check, mc-due today), because no first goal has started the routines on this machine yet\n' >"$2"
    : >"$1"
    due_on "$ROOT" check >>"$1" 2>&1 || fail "the check the 08:00 reminders run first failed: $(tr -d '\n' <"$1" | cut -c1-300)"
    due_on "$ROOT" today >>"$1" 2>&1 || fail "what the 08:00 reminders say (due today) could not be read: $(tr -d '\n' <"$1" | cut -c1-300)"
  fi
  sed 's/^/  | /' "$1" >&2
}

act() {
  fresh_evidence
  install_paths
  say "== a fresh install, the way a stranger gets one"
  install_the_stage_line "$EVIDENCE/install.log"
  need_node
  read_version "$ROOT"
  assistant_home
  wait_for 120 "the notebook to answer on its own address" notebook_answers ||
    fail "the notebook does not answer after the install, so Settings cannot be reached at all"
  {
    printf 'title\t%s\n' "$TITLE"
    printf 'done-when\t%s\n' "$DONE_WHEN"
    printf 'due\t%s\n' "$(day_in +2)"
  } >"$EVIDENCE/what.txt"

  say "== a reminder saved the way Settings > Obligations saves one"
  curl -sS -o "$EVIDENCE/settings-answer.json" -w '%{http_code}\n' -X POST \
    -H 'Content-Type: application/json' \
    -d "{\"type\":\"obligation-add\",\"title\":\"$TITLE\",\"done_when\":\"$DONE_WHEN\",\"due_at\":\"$(day_in +2)T12:00:00Z\",\"cost\":\"$COST\"}" \
    "http://127.0.0.1:$NOTEBOOK_PORT/api/functions/personal-operation" >"$EVIDENCE/settings-code.txt" ||
    fail "Settings could not be reached to save an obligation"
  sed 's/^/  | /' "$EVIDENCE/settings-answer.json" >&2

  say "== the three readers"
  pages_of "$ROOT" "$EVIDENCE/pages.txt"
  if [ -f "$ROOT/notebook/Deadlines/$TITLE.md" ]; then cp "$ROOT/notebook/Deadlines/$TITLE.md" "$EVIDENCE/page.md"; else : >"$EVIDENCE/page.md"; fi
  reminders_text "$EVIDENCE/reminders.txt" "$EVIDENCE/reminders-source.txt"
  curl -fsS "http://127.0.0.1:$NOTEBOOK_PORT/api/personal" -o "$EVIDENCE/brief-input.json" ||
    fail "what the brief reads (GET /api/personal) could not be read"
  (cd "$ROOT" && ls -1 due 2>/dev/null) >"$EVIDENCE/due-folder.txt" || : >"$EVIDENCE/due-folder.txt"
}

# ----------------------------------------------------------------------------------- the judging
check() { # <evidence folder>
  local folder=$1 title done_when code row status pages left
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of a reminder saved in Settings"
  need_node
  kept_all "$folder" "what the fresh install saw when a reminder was saved in Settings" \
    what.txt settings-answer.json settings-code.txt pages.txt reminders.txt brief-input.json
  title=$(said "$folder/what.txt" title)
  done_when=$(said "$folder/what.txt" done-when)
  [ -n "$title" ] || fail "what.txt names no reminder, so there is nothing to look for"

  # SETTINGS KEPT IT.
  code=$(tr -d ' \n\r' <"$folder/settings-code.txt")
  [ "$code" = 200 ] ||
    fail "Settings answered HTTP $code when the reminder was saved: $(tr -d '\n' <"$folder/settings-answer.json" | cut -c1-240)"
  grep -q '"error"[[:space:]]*:[[:space:]]*"' "$folder/settings-answer.json" &&
    fail "Settings refused the reminder: $(tr -d '\n' <"$folder/settings-answer.json" | cut -c1-240)"

  # IT IS A PAGE UNDER notebook/Deadlines/, and one.
  pages=$(awk -F'\t' -v title="$title" '$1==title' "$folder/pages.txt" | grep -c . || true)
  [ "$pages" != 0 ] || fail "the notebook holds no page under Deadlines/ for \"$title\", so Settings saved it somewhere else"
  [ "$pages" = 1 ] || fail "the notebook holds $pages pages under Deadlines/ for \"$title\", and one reminder is one page"
  kept "$folder" page.md "the page a person reads and edits for \"$title\""
  grep -qF "$done_when" "$folder/page.md" ||
    fail "the page of \"$title\" does not carry what done means (\"$done_when\"), so a reader lost what the old file held"
  grep -qE '^(windows|due_at|STRIP)' "$folder/page.md" ||
    fail "the page of \"$title\" carries no window at all, so nothing knows when to say it"

  # THE 08:00 REMINDERS SAY IT.
  [ -s "$folder/reminders-source.txt" ] ||
    fail "the scenario did not say where the 08:00 reminders' text came from, so it cannot be read"
  grep -qF "$title" "$folder/reminders.txt" ||
    fail "the 08:00 reminders do not name \"$title\" ($(tr '\n' ' ' <"$folder/reminders-source.txt" | cut -c1-120)): they say $(tr '\n' ' ' <"$folder/reminders.txt" | cut -c1-200)"

  # AND IT IS IN THE BRIEF'S INPUT.
  row=$(brief_row "$folder/brief-input.json" "$title")
  case $? in
    3) fail "brief-input.json is not what the notebook answers on /api/personal, so what the brief reads cannot be said" ;;
    1) fail "the brief's input holds no deadline for \"$title\", so the morning would not mention it" ;;
  esac
  status=$(printf '%s' "$row" | cut -f1)
  case $status in
    closed | completed) fail "the brief's input has \"$title\" as \"$status\", and the brief reads only what is not closed" ;;
  esac

  # AND NOTHING WENT INTO due/ ANY MORE.
  left=$(grep -cE '\.md$' "$folder/due-folder.txt" || true)
  if [ "$left" != 0 ] && grep -qvxE 'README\.md|MOVED-TO-THE-NOTEBOOK\.md' "$folder/due-folder.txt"; then
    fail "due/ holds $(tr '\n' ' ' <"$folder/due-folder.txt") after a reminder was saved in Settings, and reminders live in the notebook now"
  fi

  pass "a reminder saved through Settings' own obligation API on a fresh install is one page under notebook/Deadlines/ carrying what done means and its window, is named by the 08:00 reminders ($(tr '\n' ' ' <"$folder/reminders-source.txt" | cut -c1-80)), is in the brief's input as \"$status\", and left nothing in due/"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
