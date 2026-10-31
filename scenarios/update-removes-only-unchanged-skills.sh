#!/usr/bin/env bash
# PROVING SCENARIO 3 OF 2.0.0-beta.13: an update removes only the copies Godspeed itself put there
# unchanged.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.13-charm-video-notebook/plan.md,
# scenario 3 and item 2): from today's public version, where every new install still gets the
# twenty-five video skills, an install where the reader changed one of them by hand keeps that one
# and loses the unchanged others when it is updated to the stage; and an install where the video
# add-on is set up keeps them all.
#
# TWO COMPUTERS ON ONE MACHINE, as the reminder scenarios do it: two installations, each with its
# own folder and its own port. The first is the plain one, the second is the one with the video
# add-on. The add-on is set up on it the way a reader of today's version would, who already has the
# skills Godspeed gave them: the setup leaves a folder it did not write alone, so what the update
# has to notice is that the add-on is set up at all, not who wrote which folder.
#
# No key. The add-on's setup reaches the network for HyperFrames' pinned release, ffmpeg and the
# speech model, which is the one thing this scenario asks beyond the two installs.
#
#   bash scenarios/update-removes-only-unchanged-skills.sh candidate/2.0.0-beta.13
#   bash scenarios/update-removes-only-unchanged-skills.sh --check <folder>
#
# What it keeps for its checking part:
#   video-skills.txt                  the twenty-five names, the release plan's own list
#   stage.json                        the stage's own file, to say what the update should have made
#   one-version-before.txt / one-version-after.txt   the first computer before the update and after
#   one-before.txt / one-after.txt    its skills folder before the update and after
#   one-edited-before.txt             the skill the reader changed, its bytes and their own line
#   one-edited-after.txt              whether it is still there, still theirs
#   one-trace.log                     what the update did on it
#   two-version-before.txt / two-version-after.txt   the second computer, the one with the add-on
#   two-before.txt                    its skills folder on the public version
#   two-setup.log / two-setup-code.txt  the video add-on's own setup on it
#   two-after-addon.txt / two-after.txt  its skills folder after that setup, and after the update
#   two-trace.log                     what the update did on it
SCENARIO=update-removes-only-unchanged-skills
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"

# The one the reader changes by hand: a skill of our own, whose SKILL.md is prose a reader can edit.
EDITED=video-hooks
OWNER_LINE='My own note: always ask me before you cut the first three seconds.'
SECOND_PORT=47841

sum_of() { # <file>
  if command -v sha256sum >/dev/null 2>&1; then sha256sum <"$1" | cut -d' ' -f1; else shasum -a 256 <"$1" | cut -d' ' -f1; fi
}
# What the skill the reader changed looks like now: there or not, its bytes, their own line in it.
keep_the_edited_skill() { # <root> <file>
  local file=$1/skills/$EDITED/SKILL.md out=$2
  if [ -f "$file" ]; then
    {
      printf 'there=yes\n'
      printf 'sum=%s\n' "$(sum_of "$file")"
      if grep -qF "$OWNER_LINE" "$file"; then printf 'line=yes\n'; else printf 'line=no\n'; fi
    } >"$out"
  else
    printf 'there=no\nsum=\nline=no\n' >"$out"
  fi
  sed 's/^/  | /' "$out" >&2
}
valued() { # <file> <name>
  sed -n "s/^$2=//p" "$1" | head -n 1
}

act() {
  fresh_evidence
  install_paths
  local work=${GODSPEED_SCENARIO_WORK:-${RUNNER_TEMP:-/tmp}} b skill
  b=$work/computer-b
  rm -rf "$b"
  printf '%s\n' "$VIDEO_SKILLS" >"$EVIDENCE/video-skills.txt"
  curl -fsSL "$RAW/$STAGE_REF/stage.json" -o "$EVIDENCE/stage.json" ||
    fail "the stage's own file at $STAGE_REF could not be read, so what the update should make cannot be said"

  say '== the first computer: today public version, with one video skill changed by hand'
  install_the_public_line_into "$ROOT" "$NOTEBOOK_PORT"
  RUNTIME=$(runtime_of "$ROOT")
  need_node
  read_version "$ROOT"
  printf '%s\n' "$VERSION" >"$EVIDENCE/one-version-before.txt"
  skills_of "$ROOT" "$EVIDENCE/one-before.txt"
  skill=$ROOT/skills/$EDITED/SKILL.md
  [ -f "$skill" ] ||
    fail "today's public version put no $EDITED in the reader's skills folder, so the reader had nothing to change by hand"
  say "The reader writes a line of their own into $EDITED"
  printf '\n%s\n' "$OWNER_LINE" >>"$skill" ||
    fail "the reader's own line could not be written into $EDITED"
  {
    printf 'name=%s\n' "$EDITED"
    printf 'sum=%s\n' "$(sum_of "$skill")"
    printf 'line=%s\n' "$OWNER_LINE"
  } >"$EVIDENCE/one-edited-before.txt"

  install_the_stage_line_into "$ROOT" "$NOTEBOOK_PORT" "$EVIDENCE/one-trace.log"
  read_version "$ROOT"
  printf '%s\n' "$VERSION" >"$EVIDENCE/one-version-after.txt"
  skills_of "$ROOT" "$EVIDENCE/one-after.txt"
  keep_the_edited_skill "$ROOT" "$EVIDENCE/one-edited-after.txt"

  say '== the second computer: the same public version, with the video add-on set up on it'
  install_the_public_line_into "$b" "$SECOND_PORT"
  read_version "$b"
  printf '%s\n' "$VERSION" >"$EVIDENCE/two-version-before.txt"
  skills_of "$b" "$EVIDENCE/two-before.txt"
  mc_video_on "$b" setup --godspeed "$b" --yes --skip-proof >"$EVIDENCE/two-setup.log" 2>&1
  printf '%s\n' "$?" >"$EVIDENCE/two-setup-code.txt"
  sed 's/^/  | /' "$EVIDENCE/two-setup.log" >&2
  skills_of "$b" "$EVIDENCE/two-after-addon.txt"

  install_the_stage_line_into "$b" "$SECOND_PORT" "$EVIDENCE/two-trace.log"
  read_version "$b"
  printf '%s\n' "$VERSION" >"$EVIDENCE/two-version-after.txt"
  skills_of "$b" "$EVIDENCE/two-after.txt"
}

# The update really happened on that computer: the stage's own commits, by its own file.
the_stage_was_installed() { # <folder> <which computer> <version file> <trace>
  local folder=$1 which=$2 product engine after
  product=$(json_value "$folder/stage.json" productCommit) ||
    fail "the stage's own file names no productCommit, so it is no stage file"
  engine=$(json_value "$folder/stage.json" kitBootstrap.unixEngineCommit) ||
    fail "the stage's own file names no kit-bootstrap commit, so it is no stage file"
  after=$(tr -d ' \n\r' <"$folder/$3")
  [ "$after" = "$product" ] ||
    fail "$which runs $after after the update, and the stage names $product, so this is not the update the scenario set out to see"
  grep -qF "KB_BRANCH=$engine" "$folder/$4" ||
    fail "the update on $which did not run kit-bootstrap $engine, the stage's"
  grep -qF "GODSPEED_STARTER_REF=$product" "$folder/$4" ||
    fail "the update on $which did not make the mission control from starter $product, the stage's"
}

check() { # <evidence folder>
  local folder=$1 before present left stayed
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of an update"
  need_node
  kept_all "$folder" 'the two computers before the update and after it' \
    video-skills.txt stage.json one-version-before.txt one-version-after.txt one-before.txt \
    one-after.txt one-edited-before.txt one-edited-after.txt one-trace.log \
    two-version-before.txt two-version-after.txt two-before.txt two-setup.log two-setup-code.txt \
    two-after-addon.txt two-after.txt two-trace.log

  # There was something to remove: the version both computers started on gave them all of them.
  before=$(skills_missing "$folder/one-before.txt" "$folder/video-skills.txt")
  [ -z "$before" ] ||
    fail "today's public version put $(how_many "$before") of the video skills nowhere in the reader's skills folder, so this scenario had nothing to watch being removed: $before"

  the_stage_was_installed "$folder" 'the first computer' one-version-after.txt one-trace.log
  the_stage_was_installed "$folder" 'the computer with the video add-on' two-version-after.txt two-trace.log

  # 1. The one the reader changed stays, and stays theirs.
  [ "$(valued "$folder/one-edited-after.txt" there)" = yes ] ||
    fail "the update removed $(valued "$folder/one-edited-before.txt" name), which the reader had changed by hand"
  [ "$(valued "$folder/one-edited-after.txt" sum)" = "$(valued "$folder/one-edited-before.txt" sum)" ] ||
    fail "$(valued "$folder/one-edited-before.txt" name) is not the reader's own file any more after the update (its bytes went from $(valued "$folder/one-edited-before.txt" sum) to $(valued "$folder/one-edited-after.txt" sum))"
  [ "$(valued "$folder/one-edited-after.txt" line)" = yes ] ||
    fail "the line the reader wrote into $(valued "$folder/one-edited-before.txt" name) is not in it after the update"

  # 2. The unchanged others are gone.
  present=$(skills_present "$folder/one-after.txt" "$folder/video-skills.txt")
  left=$(printf '%s\n' "$present" | tr ' ' '\n' | grep -v -x "$(valued "$folder/one-edited-before.txt" name)" | grep -v '^$' | tr '\n' ' ' | sed 's/[[:space:]]*$//')
  [ -z "$left" ] ||
    fail "$(how_many "$left") unchanged video skills are still in the reader's skills folder after the update: $left"

  # 3. The install with the video add-on keeps them all.
  [ "$(tr -d ' \n\r' <"$folder/two-setup-code.txt")" = 0 ] ||
    fail "the video add-on's own setup on the second computer ended $(tr -d ' \n\r' <"$folder/two-setup-code.txt"), so there was no install with the add-on to update: $(grep -E '^(not yet|error|look)' "$folder/two-setup.log" | tr '\n' ' ' | cut -c1-200)"
  stayed=$(skills_missing "$folder/two-after-addon.txt" "$folder/video-skills.txt")
  [ -z "$stayed" ] ||
    fail "the video add-on's setup left the second computer without $(how_many "$stayed") of the video skills before the update even ran: $stayed"
  stayed=$(skills_missing "$folder/two-after.txt" "$folder/video-skills.txt")
  [ -z "$stayed" ] ||
    fail "$(how_many "$stayed") video skills are gone from the install that has the video add-on: $stayed"

  pass "from $(tr -d ' \n\r' <"$folder/one-version-before.txt") to $(tr -d ' \n\r' <"$folder/one-version-after.txt"), the stage's own commit: the $EDITED the reader had changed is still there with their own line and its own bytes, every one of the other $(($(grep -c . "$folder/video-skills.txt") - 1)) unchanged video skills is gone, and the install with the video add-on set up on it kept all $(grep -c . "$folder/video-skills.txt")"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
