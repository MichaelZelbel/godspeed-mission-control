#!/usr/bin/env bash
# PROVING SCENARIO 2 of 2.0.0-beta.12: the move into the notebook keeps every reminder, and loses
# nothing of the old files.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.12-reminders-in-the-notebook/plan.md,
# scenario 2): a mission control on the last version before the move, with the whole set of
# reminders a person can have, is updated to the stage. That plan says "an update from
# 2.0.0-beta.11", and this scenario installed "today's public version" to say it, which was
# 2.0.0-beta.11 while that version was the public one. Since 31 October 2026 the public version is
# 2.0.0-beta.12, which keeps reminders in the notebook already and writes no file in due/ at all, so
# from today's public line there would be nothing to move: it installs the version before the move
# by its own tag instead (scenario-lib.sh BEFORE_THE_MOVE). Afterwards the three things a person and the morning read -
# `due state`, `due list`, `due today` - print the same bytes as before the update, and the old
# files are where the plan says: in archives/<date>-due-moved-to-the-notebook/ where the notebook
# owns them, and untouched with one note beside them where they are the owner's own repository's
# (deleting tracked files there would stop the owner's next `git pull`). A second start changes
# nothing.
#
# TWICE, for the two homes the old files can have:
#   owned   no repository of the owner's: the files are the notebook's to archive
#   folder  the mission control is its own repository carrying notebook/ (`godspeed sync folder
#           notebook`), which is how Michael's machines are set up
#
# THE SET, seeded with the public version's own commands, never by hand except where the point is a
# file nobody wrote with them: a deadline only; a target only, past its target; one with both; one
# whose target was moved after it was missed; a repeating one grown to three windows with one of
# them closed; one dropped; one hand-written file that does not read; and a key in
# secrets/expires.txt, which is a reminder like any other (tools/due.js reads that file).
#
# `git status --porcelain` IS READ TWICE: once for the whole folder, which goes into the evidence
# for the step log, and once for due/ and world/ alone, which is what the judgement uses. An update
# rewrites the recipes and skills it ships, and those are tracked in the owner's own repository;
# what this scenario is about is that THE MOVE left no uncommitted change there but the one note.
#
#   bash scenarios/reminders-move-keeps-everything.sh candidate/2.0.0-beta.12
#   bash scenarios/reminders-move-keeps-everything.sh --check <folder>
#
# What it keeps for its checking part, per pass (owned, folder):
#   <pass>-state-before.txt / -list-before.txt / -today-before.txt   what the public version said
#   <pass>-state-after.txt / -list-after.txt / -today-after.txt      what the stage says
#   <pass>-state-second.txt / -list-second.txt / -today-second.txt   and after a second start
#   <pass>-version-before / -version-after    the commit it ran before the update and after it
#   <pass>-copied.txt       the old files the move had to take in: <sha256><TAB><path>
#   <pass>-files-after.txt  the same paths after the update, with their bytes
#   <pass>-archive.txt      everything under archives/*-due-moved-to-the-notebook/
#   <pass>-due-after.txt    what is in due/ afterwards
#   <pass>-note.txt         due/MOVED-TO-THE-NOTEBOOK.txt, where the plan asks for it
#   <pass>-git-status.txt / -git-status-all.txt   due/ and world/ alone, and the whole folder
#   <pass>-check-second.txt / -check-code.txt     what `due check` said on the second start, and
#                                                 the answer it left (never 0 for this seed, which
#                                                 holds a file that needs a look on purpose)
#   <pass>-fingerprint-after.txt / -second.txt    the bytes of due/, world/events/, archives/ and
#                                                 the notebook's reminder pages, twice
SCENARIO=reminders-move-keeps-everything
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"

PASSES='owned folder'
# The three a person and the morning read, which have to print the same bytes.
READS='state list today'
# The set, as scenario-lib.sh seeds it (OLD_SET), by the name each one has in `due state`.
SEEDED=$OLD_SET
WATCHED_FOLDERS='due world/events archives notebook/Deadlines notebook/Timeline'
NOTE=due/MOVED-TO-THE-NOTEBOOK.txt
ARCHIVE_NAME='due-moved-to-the-notebook'
# THE ONE FILE THE MOVE LEAVES EXACTLY WHERE IT IS. The move takes in the files it can read and
# retires those; "a file nobody can read was never taken in and is never touched"
# (core/due-retire.mjs), and the hand-written one of this seed is such a file on purpose. So it is
# in neither archive, it stays in due/ with the bytes it had, and it is what makes `due check`
# answer 3 - every morning until someone fixes it, which is what a person should see.
STAYS_BEHIND=due/does-not-read.md

# The old files the move has to take in: every reminder in due/ except its README, and every event
# that closes or drops one (tools/due.js writes `closes:`/`drops:` with due/<name>).
copied_files() { # <root> <file>
  local root=$1 out=$2 file
  : >"$out"
  for file in "$root"/due/*.md; do
    [ -f "$file" ] || continue
    case $(basename "$file") in README.md | MOVED-TO-THE-NOTEBOOK.txt) continue ;; esac
    printf '%s\tdue/%s\n' "$(sha256sum <"$file" | cut -d' ' -f1)" "$(basename "$file")" >>"$out"
  done
  for file in "$root"/world/events/*.md; do
    [ -f "$file" ] || continue
    grep -qE '^(closes|drops):.*due/' "$file" || continue
    printf '%s\tworld/events/%s\n' "$(sha256sum <"$file" | cut -d' ' -f1)" "$(basename "$file")" >>"$out"
  done
  sort -o "$out" "$out"
}
# The same paths again, whatever became of them.
files_now() { # <root> <file>
  local root=$1 out=$2 path
  : >"$out"
  while IFS=$'\t' read -r _ path; do
    [ -n "$path" ] || continue
    if [ -f "$root/$path" ]; then printf '%s\t%s\n' "$(sha256sum <"$root/$path" | cut -d' ' -f1)" "$path" >>"$out"; else printf 'gone\t%s\n' "$path" >>"$out"; fi
  done <"$3"
  sort -o "$out" "$out"
}
reads_into() { # <root> <pass> <when>
  local root=$1 pass=$2 when=$3 what
  for what in $READS; do
    due_on "$root" "$what" >"$EVIDENCE/$pass-$what-$when.txt" ||
      fail "due $what could not be read on $root $when the update, so there is nothing to compare"
  done
}

# ------------------------------------------------------------------------------------ the acting
one_pass() { # <pass> <root> <port> <stand-in folder>
  local pass=$1 root=$2 port=$3 bare=$4 address code
  say "== the $pass pass, in $root"
  rm -rf "$root"
  install_the_line_of_into "$BEFORE_THE_MOVE" "$root" "$port" "$EVIDENCE/$pass-before.log"
  # This installation's own Node, the one the product itself runs on.
  RUNTIME=$(runtime_of "$root")
  need_node
  read_version "$root"
  cp "$(runtime_of "$root")/version" "$EVIDENCE/$pass-version-before" ||
    fail "the public install in $root left no version file, so what it was cannot be said"
  if [ "$pass" = folder ]; then
    # The SSH address of the stand-in repository, because this way in reads the address back with
    # `git remote get-url` and the notebook joins a private GitHub repository and nothing else
    # (scenario-lib.sh stand_in_github_over_ssh says the whole of it).
    stand_in_github_over_ssh "$bare"
    address=$STAND_IN_ADDRESS
    git -C "$root" remote add origin "$address" || fail "the mission control in $root could not be given its copy on GitHub"
    notebook_on "$root" sync folder notebook >&2 ||
      fail "godspeed sync folder notebook was refused on $root, so there is no mission control carrying its own notebook"
  fi
  seed_the_old_set "$root"
  reads_into "$root" "$pass" before
  copied_files "$root" "$EVIDENCE/$pass-copied.txt"
  [ -s "$EVIDENCE/$pass-copied.txt" ] || fail "the public version wrote no reminder files at all in $root, so there is nothing to move"
  if [ "$pass" = folder ]; then
    # Everything the seeding wrote belongs to the owner's repository, as it does on a machine where
    # sessions and jobs commit it.
    git -C "$root" add -A -- due world secrets >&2 || fail "the seeded files could not be put into the owner's repository"
    git -C "$root" -c commit.gpgsign=false commit -q -m 'The reminders, as the old version wrote them' >&2 ||
      fail "the seeded files could not be committed in the owner's repository"
  fi

  say "The line again, against the stage: the move runs on this first start"
  install_the_stage_line_into "$root" "$port" "$EVIDENCE/$pass-update.log"
  read_version "$root"
  cp "$(runtime_of "$root")/version" "$EVIDENCE/$pass-version-after" || fail "the update left no version file behind in $root"
  reads_into "$root" "$pass" after
  files_now "$root" "$EVIDENCE/$pass-files-after.txt" "$EVIDENCE/$pass-copied.txt"
  (cd "$root" && ls -1 due 2>/dev/null) >"$EVIDENCE/$pass-due-after.txt" || : >"$EVIDENCE/$pass-due-after.txt"
  : >"$EVIDENCE/$pass-archive.txt"
  local archive
  for archive in "$root"/archives/*-"$ARCHIVE_NAME"; do
    [ -d "$archive" ] || continue
    fingerprint "$root" "$EVIDENCE/$pass-archive-one.txt" "archives/$(basename "$archive")"
    cat "$EVIDENCE/$pass-archive-one.txt" >>"$EVIDENCE/$pass-archive.txt"
  done
  rm -f "$EVIDENCE/$pass-archive-one.txt"
  if [ -f "$root/$NOTE" ]; then cp "$root/$NOTE" "$EVIDENCE/$pass-note.txt"; else printf 'not there\n' >"$EVIDENCE/$pass-note.txt"; fi
  if [ "$pass" = folder ]; then
    git -C "$root" status --porcelain -- due world >"$EVIDENCE/$pass-git-status.txt" ||
      fail "git status could not be read in the owner's own repository $root"
    git -C "$root" status --porcelain >"$EVIDENCE/$pass-git-status-all.txt" || : >"$EVIDENCE/$pass-git-status-all.txt"
  else
    printf 'no repository of the owner\n' >"$EVIDENCE/$pass-git-status.txt"
    cp "$EVIDENCE/$pass-git-status.txt" "$EVIDENCE/$pass-git-status-all.txt"
  fi
  # shellcheck disable=SC2086  # the folders are one list on purpose
  fingerprint "$root" "$EVIDENCE/$pass-fingerprint-after.txt" $WATCHED_FOLDERS

  say "A second start: the move finds nothing left to do"
  # What its own check answered is kept, not required to be 0: `due check` says that a file needs a
  # look whenever one does, and this seed holds such a file on purpose. The judging part is where
  # that answer is held to what it should be.
  due_on "$root" check >"$EVIDENCE/$pass-check-second.txt" 2>&1
  code=$?
  printf '%s\n' "$code" >"$EVIDENCE/$pass-check-code.txt"
  sed 's/^/  | /' "$EVIDENCE/$pass-check-second.txt" >&2
  reads_into "$root" "$pass" second
  # shellcheck disable=SC2086  # the folders are one list on purpose
  fingerprint "$root" "$EVIDENCE/$pass-fingerprint-second.txt" $WATCHED_FOLDERS
}

act() {
  fresh_evidence
  install_paths
  local work=${GODSPEED_SCENARIO_WORK:-${RUNNER_TEMP:-/tmp}}
  # The first pass is the install's own folder and port, the ones a stranger gets.
  one_pass owned "$ROOT" "$NOTEBOOK_PORT" ''
  one_pass folder "$work/computer-folder" 47841 "$work/github-folder"
}

# ----------------------------------------------------------------------------------- the judging
check() { # <evidence folder>
  local folder=$1 pass what missing archive_folders line sha path second left code stays
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of a move"
  need_node

  for pass in $PASSES; do
    kept_all "$folder" "what the $pass pass saw before the update and after it" \
      "$pass-version-before" "$pass-version-after" "$pass-copied.txt" "$pass-files-after.txt" \
      "$pass-due-after.txt" "$pass-note.txt" "$pass-git-status.txt" \
      "$pass-fingerprint-after.txt" "$pass-fingerprint-second.txt" \
      "$pass-check-second.txt" "$pass-check-code.txt"
    for what in $READS; do
      kept_all "$folder" "what a person reads, before the update and after it" \
        "$pass-$what-before.txt" "$pass-$what-after.txt" "$pass-$what-second.txt"
    done

    # The update happened at all.
    [ "$(tr -d ' \n\r' <"$folder/$pass-version-before")" != "$(tr -d ' \n\r' <"$folder/$pass-version-after")" ] ||
      fail "the $pass pass runs the same commit after the update as before it, so no move ever ran"

    # The set was really seeded, or the pass proved nothing.
    missing=''
    for line in $SEEDED; do
      grep -qF "$line" "$folder/$pass-state-before.txt" || missing="$missing $line"
    done
    [ -z "$missing" ] ||
      fail "the set this scenario has to seed is not in what the version before the move said in the $pass pass:$missing"

    # AND THAT VERSION WROTE THEM AS FILES IN due/, or there was never a move to prove. This is
    # an update from the last version before the move: the public version keeps reminders in the
    # notebook already and writes no file there, so a pass that started from one of those would
    # have nothing to take in, nothing to archive, and would say nothing about the move.
    missing=''
    for line in $SEEDED; do
      grep -q "	due/$line.md$" "$folder/$pass-copied.txt" || missing="$missing $line"
    done
    [ -z "$missing" ] ||
      fail "the version the $pass pass started from kept no file in due/ for:$missing, so it was not a version before the move and there was nothing to move"

    # THE THREE, BYTE FOR BYTE: before the update and after it, and again after a second start.
    for what in $READS; do
      cmp -s "$folder/$pass-$what-before.txt" "$folder/$pass-$what-after.txt" ||
        fail "due $what does not print the same bytes after the update as before it ($pass): $(diff "$folder/$pass-$what-before.txt" "$folder/$pass-$what-after.txt" | tr '\n' ' ' | cut -c1-240)"
    done
    for what in $READS; do
      cmp -s "$folder/$pass-$what-after.txt" "$folder/$pass-$what-second.txt" ||
        fail "due $what does not print the same bytes after a second start as after the first ($pass)"
    done

    if [ "$pass" = owned ]; then
      # THE OLD FILES ARE IN THE ARCHIVE, with their bytes, under a folder named for the day.
      kept "$folder" "$pass-archive.txt" "what is under archives/*-$ARCHIVE_NAME/ after the move"
      archive_folders=$(cut -f2 "$folder/$pass-archive.txt" | cut -d/ -f2 | sort -u)
      printf '%s\n' "$archive_folders" | grep -qvE "^[0-9]{4}-[0-9]{2}-[0-9]{2}-$ARCHIVE_NAME$" &&
        fail "the move put the old files under archives/$(printf '%s' "$archive_folders" | tr '\n' ' '), and the plan asks for <date>-$ARCHIVE_NAME"
      while IFS=$'\t' read -r sha path; do
        [ -n "$path" ] || continue
        [ "$path" != "$STAYS_BEHIND" ] || continue
        grep -q "^$sha	archives/.*/$path$" "$folder/$pass-archive.txt" ||
          fail "$path is not in the archive with the bytes it had, so the move did not keep it"
      done <"$folder/$pass-copied.txt"
      # AND THE ONE IT CANNOT READ IS LEFT EXACTLY WHERE IT WAS, with the bytes it had: the
      # move never took it in, so it never touches it (core/due-retire.mjs), and the reminders
      # go on saying it needs a look.
      stays=$(awk -F'\t' -v path="$STAYS_BEHIND" '$2==path{print $1;exit}' "$folder/$pass-copied.txt")
      grep -q "^$stays	$STAYS_BEHIND$" "$folder/$pass-files-after.txt" ||
        fail "the move did not leave $STAYS_BEHIND where it was with the bytes it had, and it is a file it cannot read: $(grep -F "$STAYS_BEHIND" "$folder/$pass-files-after.txt" | tr '\n' ' ' | cut -c1-120)"
      grep -q "	archives/.*/$STAYS_BEHIND$" "$folder/$pass-archive.txt" &&
        fail "the move put $STAYS_BEHIND into the archive, and a file it cannot read was never taken in, so it is never touched"
      # And the rest are out of the owner's way: nothing is left in due/ but its own two notes
      # and that one file.
      left=$(grep -E '\.md$' "$folder/$pass-due-after.txt" |
        grep -vxE 'README\.md|MOVED-TO-THE-NOTEBOOK\.txt|does-not-read\.md' | grep -c . || true)
      [ "$left" = 0 ] ||
        fail "due/ still holds $left reminder file(s) after the move, and the notebook owns them here"
    else
      # THE OWNER'S OWN FILES ARE UNTOUCHED, with one note beside them and nothing else to commit.
      cmp -s "$folder/$pass-copied.txt" "$folder/$pass-files-after.txt" ||
        fail "the move changed the owner's own tracked files: $(diff "$folder/$pass-copied.txt" "$folder/$pass-files-after.txt" | tr '\n' ' ' | cut -c1-240)"
      grep -qi 'notebook' "$folder/$pass-note.txt" ||
        fail "$NOTE does not say that the reminders live in the notebook now (it holds: $(tr '\n' ' ' <"$folder/$pass-note.txt" | cut -c1-160))"
      if [ "$(grep -c . "$folder/$pass-git-status.txt" || true)" != 1 ] ||
        ! grep -qF "$NOTE" "$folder/$pass-git-status.txt"; then
        fail "git status --porcelain says more about due/ and world/ than the one note: $(tr '\n' ';' <"$folder/$pass-git-status.txt" | cut -c1-240)"
      fi
    fi

    # THE SECOND START'S OWN CHECK SAID WHAT THIS SEED MAKES IT SAY, and never that all was clear.
    # The program that owns reminders answers 3 when the only thing wrong is a file that needs a
    # look and 0 when nothing is (tools/due.js cmdCheck), and this seed holds such a file on
    # purpose; run the way the owner's assistant runs it, through the reminder commands
    # (notebook/bin/personal-command.mjs), that 3 reaches whoever asked as a refusal, 1, carrying
    # the same words. So both are the right answer here and 0 is not: a 0 would mean the file
    # nobody can read had been swallowed somewhere in the move, and nobody would ever be told
    # about it again.
    code=$(tr -d ' \n\r' <"$folder/$pass-check-code.txt")
    case $code in
      1 | 3) ;;
      *) fail "the second start's own check answered $code on the $pass pass, and this seed holds a file that needs a look, which the product rightly answers 3 for (1 through the reminder commands)" ;;
    esac
    grep -qF "$(basename "$STAYS_BEHIND")" "$folder/$pass-check-second.txt" ||
      fail "the second start's own check never names $STAYS_BEHIND, the file that needs a look ($pass): $(tr '\n' ' ' <"$folder/$pass-check-second.txt" | cut -c1-200)"

    # A SECOND START CHANGES NOTHING, down to the bytes of every folder the move touches.
    second=$(comm -3 "$folder/$pass-fingerprint-after.txt" "$folder/$pass-fingerprint-second.txt" | grep -c . || true)
    [ "$second" = 0 ] ||
      fail "a second start changed $second file(s) under $WATCHED_FOLDERS ($pass)"
  done

  pass "the set of the plan, seeded by the version before the move, prints the same due state, list and today after the update as before it, byte for byte, in a mission control the notebook owns and in one that is the owner's own repository; the old files are in archives/<date>-$ARCHIVE_NAME with their bytes, or untouched with $NOTE beside them and nothing else to commit; $STAYS_BEHIND, which no version can read, is where it was and the second start's own check still says so instead of all-clear; a second start changed nothing else"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
