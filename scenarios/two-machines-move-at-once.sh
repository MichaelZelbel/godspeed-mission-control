#!/usr/bin/env bash
# PROVING SCENARIO 3 of 2.0.0-beta.12: two computers move the same reminders at once, and every
# reminder and every closing still exists exactly once.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.12-reminders-in-the-notebook/plan.md,
# scenario 3): the machines of one mission control update at different times, so two of them will
# take the same old files in before either has synced. The identity of a reminder and of a closing
# read out of an old file is derived from that file (core/deadline-records.mjs deadlineUid and
# closingUid), so the two machines make the same records and the sync merges them into one. Were
# they not derived, the owner would end with every reminder twice.
#
# The two computers are two installations on this one machine, each with its own mission control
# folder, its own port and its own device identity, joined through one bare repository standing in
# for the private GitHub repository. They are joined the way Settings connects a repository, where
# due/ and world/ travel as well (core/file-policy.mjs durableRoots), so both hold the same old
# files before either updates - which is the situation this is about.
#
# BOTH COMPUTERS START ON THE LAST VERSION BEFORE THE MOVE, by its own tag (scenario-lib.sh
# BEFORE_THE_MOVE). This scenario said that by installing "today's public version", which was
# 2.0.0-beta.11 while the release it comes from was being built. Since 31 October 2026 the public
# version is 2.0.0-beta.12, which keeps reminders in the notebook already: `due add` on it writes a
# page under Deadlines/ and no file in due/ at all, so from today's public line neither computer
# would have an old file to take in and there would be no move left to prove (#120; #108 for the
# three scripts before this one). What each computer really held before the update is kept, so the
# checking part refuses a run whose start had already moved instead of judging nothing.
#
#   bash scenarios/two-machines-move-at-once.sh candidate/2.0.0-beta.12
#   bash scenarios/two-machines-move-at-once.sh --check <folder>
#
# What it keeps for its checking part:
#   a-version-before / b-version-before   the version before the move both computers started on
#   a-old-files.txt / b-old-files.txt     the old reminder files each computer held before the update
#   a-version-after / b-version-after     the commit each ran the move on
#   a-pages.txt / b-pages.txt             each computer's reminder pages: <title><TAB>file
#   a-closings.txt / b-closings.txt       each computer's closing moments
#   a-state.txt / b-state.txt             what each computer's own reminders say afterwards
#   expected-pages.txt / expected-closings.txt  the set that was seeded, as it has to come out
#   rounds.txt                            what every sync round answered
SCENARIO=two-machines-move-at-once
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"

COMPUTERS='a b'

counted() { # <file> <column> <value>: how many lines hold that value in that column
  awk -F'\t' -v column="$2" -v value="$3" '$column==value' "$1" | grep -c . || true
}

# The old reminder files a computer holds, as one due/<name> per line: what the version before the
# move wrote with its own commands (scenario-lib.sh seed_the_old_set), which is what each computer
# takes in on its own first start after the update. The notebook's own two notes in that folder are
# not reminders, as reminders-move-keeps-everything reads its due/ the same way.
old_files_of() { # <root> <file>
  local root=$1 out=$2 file
  : >"$out"
  for file in "$root"/due/*.md; do
    [ -f "$file" ] || continue
    case $(basename "$file") in README.md | MOVED-TO-THE-NOTEBOOK.txt) continue ;; esac
    printf 'due/%s\n' "$(basename "$file")" >>"$out"
  done
  sort -o "$out" "$out"
}

# ------------------------------------------------------------------------------------ the acting
act() {
  fresh_evidence
  install_paths
  local work=${GODSPEED_SCENARIO_WORK:-${RUNNER_TEMP:-/tmp}} b=${GODSPEED_SCENARIO_WORK:-${RUNNER_TEMP:-/tmp}}/computer-b address
  b=$work/computer-b
  rm -rf "$b"

  say "== the first computer, on the last version before the move, with the set of the plan"
  install_the_line_of_into "$BEFORE_THE_MOVE" "$ROOT" "$NOTEBOOK_PORT" "$EVIDENCE/a-before.log"
  RUNTIME=$(runtime_of "$ROOT")
  need_node
  read_version "$ROOT"
  cp "$(runtime_of "$ROOT")/version" "$EVIDENCE/a-version-before" || fail "the install of the version before the move left no version file behind"
  seed_the_old_set "$ROOT"
  printf '%s\n' "$OLD_SET_PAGES" >"$EVIDENCE/expected-pages.txt"
  printf '%s\n' "$OLD_SET_CLOSINGS" >"$EVIDENCE/expected-closings.txt"

  say "== the second computer, set up from the copy on GitHub, also on the version before the move"
  address=$(stand_in_github "$work/github")
  sync_on "$ROOT" configure "$address" >"$EVIDENCE/configure.json" ||
    fail "Settings' own way of connecting a repository was refused on the first computer"
  sync_on "$ROOT" >"$EVIDENCE/rounds.txt" || fail "the first sync round failed, so the second computer had nothing to be set up from"
  git clone -q "$address" "$b" || fail "the second computer could not be set up from the copy on GitHub"
  install_the_line_of_into "$BEFORE_THE_MOVE" "$b" 47841 "$EVIDENCE/b-before.log"
  read_version "$b"
  cp "$(runtime_of "$b")/version" "$EVIDENCE/b-version-before" || fail "the second computer's install of the version before the move left no version file behind"
  notebook_on "$b" sync folder >&2 || fail "godspeed sync folder was refused on the second computer, so it never joined"
  sync_on "$b" >>"$EVIDENCE/rounds.txt" || fail "the sync round that brings the reminders to the second computer failed"
  [ -f "$b/due/deadline-only.md" ] ||
    fail "the second computer did not get the old reminder files through the sync, so there is nothing for it to move"
  # What each of them holds now, before either is updated: the old files they both take in.
  old_files_of "$ROOT" "$EVIDENCE/a-old-files.txt"
  old_files_of "$b" "$EVIDENCE/b-old-files.txt"

  say "== both updated before either syncs"
  install_the_stage_line_into "$ROOT" "$NOTEBOOK_PORT" "$EVIDENCE/a-update.log"
  install_the_stage_line_into "$b" 47841 "$EVIDENCE/b-update.log"
  read_version "$ROOT"
  read_version "$b"
  cp "$(runtime_of "$ROOT")/version" "$EVIDENCE/a-version-after" || fail "the update left no version file behind on the first computer"
  cp "$(runtime_of "$b")/version" "$EVIDENCE/b-version-after" || fail "the update left no version file behind on the second computer"
  # Each one takes the old files in on its own first run, before anything is carried either way.
  due_on "$ROOT" state >"$EVIDENCE/a-state.txt" || fail "the first computer could not say what it holds after the move"
  due_on "$b" state >"$EVIDENCE/b-state.txt" || fail "the second computer could not say what it holds after the move"

  say "== then both sync, twice each"
  sync_on "$ROOT" >>"$EVIDENCE/rounds.txt" || fail "the first computer's first sync round after the move failed"
  sync_on "$b" >>"$EVIDENCE/rounds.txt" || fail "the second computer's first sync round after the move failed"
  sync_on "$ROOT" >>"$EVIDENCE/rounds.txt" || fail "the first computer's second sync round after the move failed"
  sync_on "$b" >>"$EVIDENCE/rounds.txt" || fail "the second computer's second sync round after the move failed"

  pages_of "$ROOT" "$EVIDENCE/a-pages.txt"
  pages_of "$b" "$EVIDENCE/b-pages.txt"
  closings_of "$ROOT" "$EVIDENCE/a-closings.txt"
  closings_of "$b" "$EVIDENCE/b-closings.txt"
}

# ----------------------------------------------------------------------------------- the judging
check() { # <evidence folder>
  local folder=$1 computer title kind line n slug missing
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of two computers moving at once"
  need_node
  kept_all "$folder" "what the two computers held after they both moved and both synced" \
    a-version-before b-version-before a-old-files.txt b-old-files.txt \
    a-version-after b-version-after \
    a-pages.txt b-pages.txt a-closings.txt b-closings.txt a-state.txt b-state.txt \
    expected-pages.txt expected-closings.txt

  # BOTH STARTED BEFORE THE MOVE, or neither had anything to take in and this proves nothing. The
  # version before the move writes every reminder of the set as a file in due/ (scenario-lib.sh
  # seed_the_old_set, OLD_SET); the public version keeps them in the notebook already and writes no
  # file there, so a run that started from one of those is refused here instead of judged (#120).
  for computer in $COMPUTERS; do
    missing=''
    for slug in $OLD_SET; do
      grep -qxF "due/$slug.md" "$folder/$computer-old-files.txt" || missing="$missing $slug"
    done
    [ -z "$missing" ] ||
      fail "computer $computer held no old reminder file for:$missing before the update, so it did not start on a version before the move and there was nothing for it to move"
  done

  # Both really moved, from the same version to the same version.
  [ "$(tr -d ' \n\r' <"$folder/a-version-before")" = "$(tr -d ' \n\r' <"$folder/b-version-before")" ] ||
    fail "the two computers did not start on one version ($(tr -d ' \n\r' <"$folder/a-version-before") and $(tr -d ' \n\r' <"$folder/b-version-before")), so they were never one mission control"
  [ "$(tr -d ' \n\r' <"$folder/a-version-after")" = "$(tr -d ' \n\r' <"$folder/b-version-after")" ] ||
    fail "the two computers do not run one version after the update ($(tr -d ' \n\r' <"$folder/a-version-after") and $(tr -d ' \n\r' <"$folder/b-version-after"))"
  [ "$(tr -d ' \n\r' <"$folder/a-version-before")" != "$(tr -d ' \n\r' <"$folder/a-version-after")" ] ||
    fail "the computers run the same commit after the update as before it, so no move ever ran"

  # EVERY REMINDER EXACTLY ONCE, on each computer.
  for computer in $COMPUTERS; do
    while IFS= read -r title; do
      [ -n "$title" ] || continue
      n=$(counted "$folder/$computer-pages.txt" 1 "$title")
      [ "$n" != 0 ] || fail "computer $computer holds no reminder page for \"$title\" after both moved and both synced"
      [ "$n" = 1 ] || fail "computer $computer holds $n reminder pages for \"$title\", and a reminder exists once"
    done <"$folder/expected-pages.txt"
  done

  # AND EVERY CLOSING EXACTLY ONCE, which is what the derived identity is for.
  for computer in $COMPUTERS; do
    while IFS=$'\t' read -r kind title; do
      [ -n "$title" ] || continue
      n=$(counted "$folder/$computer-closings.txt" 2 "$title")
      [ "$n" != 0 ] || fail "computer $computer holds no closing moment for \"$title\" ($kind) after both moved and both synced"
      [ "$n" = 1 ] || fail "computer $computer holds $n closing moments for \"$title\", and one closing of one window is one moment"
    done <"$folder/expected-closings.txt"
  done

  # And the two computers hold the same thing, down to the pages and the moments.
  for line in pages closings; do
    diff <(cut -f1,2 "$folder/a-$line.txt") <(cut -f1,2 "$folder/b-$line.txt") >/dev/null ||
      fail "the two computers do not hold the same $line after both synced twice: $(diff <(cut -f1,2 "$folder/a-$line.txt") <(cut -f1,2 "$folder/b-$line.txt") | tr '\n' ' ' | cut -c1-240)"
  done

  pass "two computers that took the same $(grep -c . "$folder/expected-pages.txt") reminders and $(grep -c . "$folder/expected-closings.txt") closings in before either synced hold every one of them exactly once afterwards, the same on both, having each moved from $(tr -d ' \n\r' <"$folder/a-version-before") to $(tr -d ' \n\r' <"$folder/a-version-after")"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
