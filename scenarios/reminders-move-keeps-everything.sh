#!/usr/bin/env bash
# PROVING SCENARIO 2 of 2.0.0-beta.12: the move into the notebook keeps every reminder, and loses
# nothing of the old files.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.12-reminders-in-the-notebook/plan.md,
# scenario 2): a mission control on today's public version, with the whole set of reminders a person
# can have, is updated to the stage. Afterwards the three things a person and the morning read -
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
#   <pass>-note.txt         due/MOVED-TO-THE-NOTEBOOK.md, where the plan asks for it
#   <pass>-git-status.txt / -git-status-all.txt   due/ and world/ alone, and the whole folder
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
NOTE=due/MOVED-TO-THE-NOTEBOOK.md
ARCHIVE_NAME='due-moved-to-the-notebook'

# The old files the move has to take in: every reminder in due/ except its README, and every event
# that closes or drops one (tools/due.js writes `closes:`/`drops:` with due/<name>).
copied_files() { # <root> <file>
  local root=$1 out=$2 file
  : >"$out"
  for file in "$root"/due/*.md; do
    [ -f "$file" ] || continue
    case $(basename "$file") in README.md | MOVED-TO-THE-NOTEBOOK.md) continue ;; esac
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
  local pass=$1 root=$2 port=$3 bare=$4 address
  say "== the $pass pass, in $root"
  rm -rf "$root"
  install_the_public_line_into "$root" "$port"
  # This installation's own Node, the one the product itself runs on.
  RUNTIME=$(runtime_of "$root")
  need_node
  read_version "$root"
  cp "$(runtime_of "$root")/version" "$EVIDENCE/$pass-version-before" ||
    fail "the public install in $root left no version file, so what it was cannot be said"
  if [ "$pass" = folder ]; then
    address=$(stand_in_github "$bare")
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
  due_on "$root" check >&2 || fail "the second start's own checks could not be run on $root"
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
  local folder=$1 pass what missing archive_folders line sha path second left
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of a move"
  need_node

  for pass in $PASSES; do
    kept_all "$folder" "what the $pass pass saw before the update and after it" \
      "$pass-version-before" "$pass-version-after" "$pass-copied.txt" "$pass-files-after.txt" \
      "$pass-due-after.txt" "$pass-note.txt" "$pass-git-status.txt" \
      "$pass-fingerprint-after.txt" "$pass-fingerprint-second.txt"
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
      fail "the set this scenario has to seed is not in what the public version said in the $pass pass:$missing"

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
        grep -q "^$sha	archives/.*/$path\$" "$folder/$pass-archive.txt" ||
          fail "$path is not in the archive with the bytes it had, so the move did not keep it"
      done <"$folder/$pass-copied.txt"
      # And they are out of the owner's way: nothing is left in due/ but its own two notes.
      left=$(grep -E '\.md$' "$folder/$pass-due-after.txt" | grep -vxE 'README\.md|MOVED-TO-THE-NOTEBOOK\.md' | grep -c . || true)
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

    # A SECOND START CHANGES NOTHING, down to the bytes of every folder the move touches.
    second=$(comm -3 "$folder/$pass-fingerprint-after.txt" "$folder/$pass-fingerprint-second.txt" | grep -c . || true)
    [ "$second" = 0 ] ||
      fail "a second start changed $second file(s) under $WATCHED_FOLDERS ($pass)"
  done

  pass "the set of the plan, seeded by the public version, prints the same due state, list and today after the update as before it, byte for byte, in a mission control the notebook owns and in one that is the owner's own repository; the old files are in archives/<date>-$ARCHIVE_NAME with their bytes, or untouched with $NOTE beside them and nothing else to commit; a second start changed nothing"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
