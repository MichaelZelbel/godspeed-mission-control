#!/usr/bin/env bash
# PROVING SCENARIO 1 of 2.0.0-beta.12: a reminder closed on one computer is closed on the other,
# and nobody runs Git.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.12-reminders-in-the-notebook/plan.md,
# scenario 1): this is the incident of 19 October 2026. A reminder was a file in due/ and its
# closing a second file in world/events/, and on a mission control that is its own repository the
# notebook's sync carries only notebook/, so both travelled only when a session or a job committed
# them. That day only the first one was committed, and for nine mornings the brief asked its owner
# about something he had finished. Now a reminder is a page in the notebook and its closing a
# moment on its timeline, so both go the way every note goes.
#
# TWICE, because both ways of syncing have to carry it:
#   connected  the two joined the way Settings connects a repository (Connect record sync, then the
#              second computer set up from that copy: the installer clones it and runs
#              `godspeed sync folder` with no paths, core/sync/git.mjs joinRepository)
#   folder     a mission control that is its own repository, carrying notebook/ only
#              (`godspeed sync folder notebook`, useFolderRepository) - Michael's own machines
# Four installations, because the two kinds of repository cannot be one folder: a copy Settings
# made tracks only what that connection syncs, and an owner's own mission control tracks its
# programs and settings beside the notebook.
#
# NOBODY RUNS GIT. Between adding the reminder, closing it on the other computer and reading it
# back, the scenario runs no git of its own: a `git` earlier on the path writes down every call
# with the step it was made in (scenario-lib.sh git_calls_shim), and the checking part holds the
# steps to none and the sync rounds to some. Setting the two computers up is a step of its own, as
# a person's installer is.
#
#   bash scenarios/reminder-closed-elsewhere.sh candidate/2.0.0-beta.12
#   bash scenarios/reminder-closed-elsewhere.sh --check <folder>
#
# What it keeps for its checking part, in the evidence folder:
#   what.txt                     the reminder it added: its name, its title, the evidence it closed it with
#   git-calls.txt                every call of git, as <step><TAB>arguments
#   <mode>-sync-config.json      how that pair was joined, as the notebook wrote it
#   folder-join.json             what the notebook answered when the folder pair joined, the
#                                address it read back among it
#   <mode>-state.json/.txt       A's own `due state`, after the two sync rounds
#   <mode>-today.txt             A's own `due today`
#   <mode>-closing.txt           what `due done --evidence` said on B
#   <mode>-pages.txt             A's reminder pages: <title><TAB>file
#   <mode>-closings.txt          A's closing moments: <kind><TAB>title<TAB>evidence<TAB>file
#   <mode>-rounds.txt            what every sync round answered
#   <mode>-install-*.log         the install lines' own traces
SCENARIO=reminder-closed-elsewhere
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"

MODES='connected folder'
SLUG=passport-renewal
TITLE='Renew my passport'
EVIDENCE_WORDS='I posted it at the town hall, receipt 4711'
# The steps in which no git call of the scenario's own may appear, and the ones that carry.
STEPS_WITHOUT_GIT='add-on-a close-on-b read-on-a'

# One row of `due state --json`, by the reminder's name: <state><TAB>what closed it<TAB>title.
# Exit 1 when the reminders do not name it at all, 3 when the file is no state at all.
# shellcheck disable=SC2016  # a JavaScript program, which this shell must not expand
STATE_ROW='
const fs=require("fs");
let rows;try{rows=JSON.parse(fs.readFileSync(process.argv[1],"utf8"));}catch{process.exit(3);}
if(!Array.isArray(rows))process.exit(3);
const row=rows.find(r=>r&&r.slug===process.argv[2]);
if(!row)process.exit(1);
process.stdout.write([row.state||"",row.closedBy||"",row.title||""].join("\t"));
'
state_row() { # <file> <slug>
  "$NODE" -e "$STATE_ROW" "$1" "$2"
}
said() { # <file> <key>
  awk -F'\t' -v key="$2" '$1==key{print $2;exit}' "$1"
}
# Every git call made in one step, as the shim wrote them down.
calls_in() { # <file> <step>
  awk -F'\t' -v step="$2" '$1==step' "$1" | grep -c . || true
}

# ------------------------------------------------------------------------------------ the acting
# One pair of computers, joined one of the two ways, and the one thing that has to happen on them.
one_pair() { # <mode> <A root> <A port> <B root> <B port> <stand-in folder>
  local mode=$1 a=$2 a_port=$3 b=$4 b_port=$5 bare=$6 address

  phase "$mode-install-a"
  rm -rf "$a" "$b"
  install_the_stage_line_into "$a" "$a_port" "$EVIDENCE/$mode-install-a.log"
  # This installation's own Node, the one the product itself runs on.
  RUNTIME=$(runtime_of "$a")
  need_node
  read_version "$a"

  phase "$mode-join"
  if [ "$mode" = folder ]; then
    # The owner's own mission control, which the installer has already made a repository with its
    # first commit (core/first-commit.mjs), given the copy on GitHub a person makes for it. Here the
    # stand-in is the SSH address of that repository and nothing is rewritten, because this way in
    # reads the address back with `git remote get-url` (scenario-lib.sh stand_in_github_over_ssh
    # says the whole of it), and what it read back is kept, so the judging part can see it.
    stand_in_github_over_ssh "$bare"
    address=$STAND_IN_ADDRESS
    owner_ignores_what_the_notebook_keeps "$a"
    git -C "$a" remote add origin "$address" || fail "the mission control in $a could not be given its copy on GitHub"
    notebook_on "$a" sync folder notebook >"$EVIDENCE/$mode-join.json" ||
      fail "godspeed sync folder notebook was refused on $a, so there is no mission control carrying its own notebook (what it said is in the step log)"
  else
    address=$(stand_in_github "$bare")
    sync_on "$a" configure "$address" >"$EVIDENCE/$mode-configure.json" ||
      fail "Settings' own way of connecting a repository was refused on $a (its answer is in $mode-configure.json)"
    grep -q 'configuration_failed\|configuration_error' "$EVIDENCE/$mode-configure.json" &&
      fail "connecting the repository the way Settings connects it failed: $(tr -d '\n' <"$EVIDENCE/$mode-configure.json" | cut -c1-300)"
  fi
  sync_on "$a" >"$EVIDENCE/$mode-rounds.txt" || fail "the first sync round on $a failed, so the second computer had nothing to be set up from"
  cp "$a/.godspeed/sync-config.json" "$EVIDENCE/$mode-sync-config.json" ||
    fail "$a kept no sync-config.json, so how it was joined cannot be said"
  # The second computer, the way a person's installer sets it up: it clones the copy on GitHub and
  # installs into that folder (notebook/test/installer-join-sync.test.mjs).
  git clone -q "$address" "$b" || fail "the second computer could not be set up from the copy on GitHub"
  install_the_stage_line_into "$b" "$b_port" "$EVIDENCE/$mode-install-b.log"
  read_version "$b"
  if [ "$mode" = folder ]; then
    notebook_on "$b" sync folder notebook >&2 || fail "godspeed sync folder notebook was refused on the second computer $b"
  else
    notebook_on "$b" sync folder >&2 || fail "godspeed sync folder was refused on the second computer $b, so it never joined"
  fi

  phase "$mode-add-on-a"
  due_on "$a" add "$SLUG" --title "$TITLE" --to "$(day_in +21)" \
    --cost 'I cannot travel until it comes back.' --done-when 'The new passport is in my hand.' >&2 ||
    fail "the reminder could not be added on the first computer $a"

  phase "$mode-sync-a-1"
  sync_on "$a" >>"$EVIDENCE/$mode-rounds.txt" || fail "the sync round that carries the new reminder away from $a failed"
  phase "$mode-sync-b-1"
  sync_on "$b" >>"$EVIDENCE/$mode-rounds.txt" || fail "the sync round that brings the new reminder to $b failed"

  phase "$mode-close-on-b"
  due_on "$b" 'done' "$SLUG" --evidence "$EVIDENCE_WORDS" >"$EVIDENCE/$mode-closing.txt" 2>&1 ||
    fail "the reminder could not be closed on the second computer $b: $(tr -d '\n' <"$EVIDENCE/$mode-closing.txt" | cut -c1-300)"
  sed 's/^/  | /' "$EVIDENCE/$mode-closing.txt" >&2

  phase "$mode-sync-b-2"
  sync_on "$b" >>"$EVIDENCE/$mode-rounds.txt" || fail "the sync round that carries the closing away from $b failed"
  phase "$mode-sync-a-2"
  sync_on "$a" >>"$EVIDENCE/$mode-rounds.txt" || fail "the sync round that brings the closing to $a failed"

  phase "$mode-read-on-a"
  due_on "$a" state --json >"$EVIDENCE/$mode-state.json" || fail "the first computer $a could not say what it holds (due state --json)"
  due_on "$a" state >"$EVIDENCE/$mode-state.txt" || fail "the first computer $a could not say what it holds (due state)"
  due_on "$a" today >"$EVIDENCE/$mode-today.txt" || fail "the first computer $a could not say what needs saying today"
  pages_of "$a" "$EVIDENCE/$mode-pages.txt"
  closings_of "$a" "$EVIDENCE/$mode-closings.txt"
}

act() {
  fresh_evidence
  install_paths
  git_calls_shim "$EVIDENCE/git-calls.txt"
  {
    printf 'slug\t%s\n' "$SLUG"
    printf 'title\t%s\n' "$TITLE"
    printf 'evidence\t%s\n' "$EVIDENCE_WORDS"
  } >"$EVIDENCE/what.txt"
  local work=${GODSPEED_SCENARIO_WORK:-${RUNNER_TEMP:-/tmp}}
  one_pair connected "$ROOT" "$NOTEBOOK_PORT" "$work/computer-b" 47841 "$work/github-connected"
  one_pair folder "$work/computer-c" 47851 "$work/computer-d" 47861 "$work/github-folder"
  phase finished
}

# ----------------------------------------------------------------------------------- the judging
check() { # <evidence folder>
  local folder=$1 mode slug title evidence row state closed_by git_calls carried joined
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of a reminder closed elsewhere"
  need_node
  kept_all "$folder" "what the two computers did and what git did" what.txt git-calls.txt
  slug=$(said "$folder/what.txt" slug)
  title=$(said "$folder/what.txt" title)
  evidence=$(said "$folder/what.txt" evidence)
  [ -n "$slug" ] && [ -n "$title" ] && [ -n "$evidence" ] ||
    fail "what.txt says no reminder (slug '$slug', title '$title', evidence '$evidence'), so there is nothing to look for"

  for mode in $MODES; do
    kept_all "$folder" "what the $mode pair of computers saw" \
      "$mode-sync-config.json" "$mode-state.json" "$mode-state.txt" "$mode-today.txt" \
      "$mode-closing.txt" "$mode-closings.txt" "$mode-rounds.txt"

    # Joined the way this half is about, as the notebook itself wrote it down.
    if [ "$mode" = folder ]; then
      want_json "$folder/$mode-sync-config.json" repository folder "how the $mode pair was joined"
      want_json "$folder/$mode-sync-config.json" paths '["notebook"]' "how the $mode pair was joined"
      # AND THE ADDRESS IT JOINED IS A GITHUB ONE. This way in reads the address back out of the
      # owner's own repository with `git remote get-url`, which applies every rewriting this
      # machine's Git settings ask for, and the notebook joins a private GitHub repository and
      # nothing else (core/sync/git.mjs verifyRemote). A stand-in that is a folder on this machine
      # is therefore no stand-in at all: the product refuses it, rightly, and this scenario proved
      # nothing. So what the notebook answered when it joined is kept, and read here.
      kept "$folder" "$mode-join.json" "what the notebook answered when the $mode pair joined"
      joined=$(json_value "$folder/$mode-join.json" remote)
      case $joined in
        https://github.com/*.git | https://github.com/*/* | git@github.com:*) ;;
        *) fail "the $mode pair joined the address \"$joined\", and a mission control carrying its own notebook joins a private GitHub repository: the stand-in has to be one the product takes as GitHub" ;;
      esac
    else
      want_json "$folder/$mode-sync-config.json" enabled true "how the $mode pair was joined"
      grep -q '"repository"' "$folder/$mode-sync-config.json" &&
        fail "the $mode pair was joined in folder mode, and this half is about a repository connected the way Settings connects one"
    fi

    # The first computer says it is closed, although it was closed on the other one.
    row=$(state_row "$folder/$mode-state.json" "$slug")
    case $? in
      3) fail "$mode-state.json is not what due state --json answers" ;;
      1) fail "the first computer's own reminders do not name $slug at all after the $mode sync, so nothing travelled" ;;
    esac
    state=$(printf '%s' "$row" | cut -f1)
    closed_by=$(printf '%s' "$row" | cut -f2)
    case $state in
      closed | done | dropped) ;;
      *) fail "the first computer says $slug is \"$state\" after it was closed on the other one and both synced ($mode)" ;;
    esac
    # Closed BY THAT EVIDENCE: the words the other computer closed it with are here, in what the
    # state says closed it or in the closing moment the notebook carried over.
    if ! printf '%s\n' "$closed_by" | grep -qF "$evidence" &&
      ! grep -qF "$evidence" "$folder/$mode-closings.txt"; then
      fail "the first computer holds no closing carrying the evidence \"$evidence\" ($mode): what closed $slug is \"$closed_by\""
    fi
    # And it has stopped asking.
    grep -qF "$title" "$folder/$mode-today.txt" &&
      fail "the first computer's due today still names \"$title\" after it was closed elsewhere ($mode)"
  done

  # Nobody ran Git. The steps are clean, and the sync rounds are where git was used.
  for step in $STEPS_WITHOUT_GIT; do
    for mode in $MODES; do
      git_calls=$(calls_in "$folder/git-calls.txt" "$mode-$step")
      [ "$git_calls" = 0 ] ||
        fail "the scenario ran git itself $git_calls times in the step $mode-$step, so what it proved is not that the notebook carried it"
    done
  done
  carried=0
  for mode in $MODES; do
    carried=$((carried + $(calls_in "$folder/git-calls.txt" "$mode-sync-a-2") + $(calls_in "$folder/git-calls.txt" "$mode-sync-b-2")))
  done
  [ "$carried" -gt 0 ] ||
    fail "no git call at all was made in the sync rounds that carry the closing, so nothing was carried by the product's own sync"

  pass "a reminder added on one computer and closed on the other with \"$evidence\" is closed on the first, both joined the way Settings connects a repository and in folder mode with notebook/ only, that one through the GitHub address $joined; its due today no longer names \"$title\", and the scenario ran no git of its own in any step - only the notebook's own sync did, $carried calls in the rounds that carried the closing"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
