#!/usr/bin/env bash
# PROVING SCENARIO 2 OF 2.0.0-beta.13: a new install has no video skills, and the video add-on
# brings them.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.13-charm-video-notebook/plan.md,
# scenario 2 and item 2): a fresh install lists none of the twenty-five skills whose only job is
# making or finishing video in the reader's skills folder, and still lists the ones about web pages
# and pictures; after the video add-on's own setup all twenty-five are there; and video-finishing
# does its work on the add-on's own sample clip, which is captions burned into the picture.
#
# The Windows half of the plan's scenario 2 is the release step's check on the frozen Windows setup,
# not a job here (the ticket says so).
#
# THE ADD-ON'S SETUP IS THE INSTALL'S OWN COPY of it, so what runs is the commit the stage pins and
# not whatever mc-video's own main holds today; a reader runs the same program through
# `npx --yes github:MichaelZelbel/mc-video setup`. It reaches the network for HyperFrames' pinned
# release, ffmpeg and the speech model, which is the one thing this scenario asks beyond the install.
# No key.
#
#   bash scenarios/no-video-skills-by-default.sh candidate/2.0.0-beta.13
#   bash scenarios/no-video-skills-by-default.sh --check <folder>
#
# What it keeps for its checking part:
#   version.txt                  the commit the install runs
#   video-skills.txt             the twenty-five names, the release plan's own list
#   keep-skills.txt              the skills about web pages and pictures, which stay
#   skills-after-install.txt     the reader's skills folder as the install left it
#   recipes-in-the-version.txt   the video skills the installed version still carries as recipes
#   setup.log / setup-code.txt   the video add-on's own setup, and how it ended
#   skills-after-addon.txt       the reader's skills folder after that setup
#   addon-check.txt              what `mc-video check` says is installed and what is missing
#   captions.log / captions-code.txt   video-finishing's own work on the sample clip
#   captions.ass                 the captions it wrote
#   words.json                   the words the speech model heard in the clip
#   sizes.txt                    the bytes of the sample clip and of the captioned one
SCENARIO=no-video-skills-by-default
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"

SAMPLE=sample/sample-vertical.mp4

# shellcheck disable=SC2329  # asked by wait_for, which takes the command to try as its arguments
notebook_answers() { curl -fsS "http://127.0.0.1:$NOTEBOOK_PORT/health" >/dev/null 2>&1; }

# The video skills the installed version still carries as recipes of its own: a fresh install copies
# notebook/recipes into the reader's skills folder (notebook/bin/godspeed.mjs), so one still there
# would be handed to the next reader even when this install's folder happens to be clean.
recipes_in_the_version() { # <file>
  local out=$1 folder dir name
  : >"$out"
  for folder in notebook/recipes notebook/reusable-recipes; do
    dir=$(product_script "$ROOT" "$folder")
    [ -d "$dir" ] || continue
    for name in "$dir"/*; do
      [ -d "$name" ] || continue
      basename "$name" >>"$out"
    done
  done
  sort -u -o "$out" "$out"
}

act() {
  fresh_evidence
  install_paths
  install_the_stage_line "$EVIDENCE/.install.log"
  need_node
  wait_for 180 "the notebook to answer after the install" notebook_answers ||
    fail "the notebook does not answer after the install, so this is no install a reader would have"
  read_version "$ROOT"
  printf '%s\n' "$VERSION" >"$EVIDENCE/version.txt"
  printf '%s\n' "$VIDEO_SKILLS" >"$EVIDENCE/video-skills.txt"
  printf '%s\n' "$VIDEO_SKILLS_KEEP" >"$EVIDENCE/keep-skills.txt"

  say "The reader's skills folder, as the install left it"
  skills_of "$ROOT" "$EVIDENCE/skills-after-install.txt"
  sed 's/^/  | /' "$EVIDENCE/skills-after-install.txt" >&2
  recipes_in_the_version "$EVIDENCE/.all-recipes.txt"
  comm -12 <(sort -u "$EVIDENCE/.all-recipes.txt") <(sort -u "$EVIDENCE/video-skills.txt") \
    >"$EVIDENCE/recipes-in-the-version.txt"

  say 'The video add-on, set up the way a reader sets it up (the install carries the pinned copy)'
  mc_video_on "$ROOT" setup --godspeed "$ROOT" --yes >"$EVIDENCE/setup.log" 2>&1
  printf '%s\n' "$?" >"$EVIDENCE/setup-code.txt"
  sed 's/^/  | /' "$EVIDENCE/setup.log" >&2
  skills_of "$ROOT" "$EVIDENCE/skills-after-addon.txt"
  mc_video_on "$ROOT" check --godspeed "$ROOT" >"$EVIDENCE/addon-check.txt" 2>&1 ||
    say "  (mc-video check ended $?)"
  sed 's/^/  | /' "$EVIDENCE/addon-check.txt" >&2

  say 'video-finishing on the add-on carries its own sample clip, which it captions'
  local work=${GODSPEED_SCENARIO_WORK:-${RUNNER_TEMP:-/tmp}}/$SCENARIO-clip clip
  rm -rf "$work"
  mkdir -p "$work" || fail "the folder for the sample clip ($work) could not be made"
  [ -f "$(addon_file "$ROOT" "$SAMPLE")" ] ||
    fail "the video add-on the install carries has no sample clip of its own at $SAMPLE, so there was nothing to caption"
  clip=$work/sample-vertical.mp4
  cp "$(addon_file "$ROOT" "$SAMPLE")" "$clip" ||
    fail "the add-on's own sample clip could not be copied to $work"
  mc_video_on "$ROOT" captions "$clip" --godspeed "$ROOT" >"$EVIDENCE/captions.log" 2>&1
  printf '%s\n' "$?" >"$EVIDENCE/captions-code.txt"
  sed 's/^/  | /' "$EVIDENCE/captions.log" >&2
  cp "$work/sample-vertical.ass" "$EVIDENCE/captions.ass" 2>/dev/null || : >"$EVIDENCE/captions.ass"
  cp "$work/sample-vertical.words.json" "$EVIDENCE/words.json" 2>/dev/null || : >"$EVIDENCE/words.json"
  {
    printf 'clip=%s\n' "$(wc -c <"$clip" | tr -d ' ')"
    printf 'captioned=%s\n' "$(wc -c <"$work/sample-vertical.captioned.mp4" 2>/dev/null | tr -d ' ')"
  } >"$EVIDENCE/sizes.txt"
  rm -f "$EVIDENCE"/.[a-z]*
}

# One value of sizes.txt.
size_of() { # <folder> <name>
  sed -n "s/^$2=//p" "$1/sizes.txt" | head -n 1
}
# The two lengths the add-on's own words report: the captioned clip's and the source's.
# "ok: <out> (2.3 MB, 8.0s; the source was 8.0s)"
seconds_of() { # <log> <made|source>
  if [ "$2" = made ]; then
    sed -n 's/^ok: .*(.*MB, \([0-9.]*\)s; the source was .*/\1/p' "$1" | head -n 1
  else
    sed -n 's/^ok: .*(.*MB, .*s; the source was \([0-9.]*\)s.*/\1/p' "$1" | head -n 1
  fi
}

check() { # <evidence folder>
  local folder=$1 missing present stay
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of an install"
  kept_all "$folder" "the reader's skills folder before and after the video add-on's setup" \
    version.txt video-skills.txt keep-skills.txt skills-after-install.txt setup.log \
    setup-code.txt skills-after-addon.txt addon-check.txt captions.log captions-code.txt \
    captions.ass words.json sizes.txt
  [ -f "$folder/recipes-in-the-version.txt" ] ||
    fail "recipes-in-the-version.txt is not in what the scenario kept: the video skills the installed version still carries"

  # The folder was really read: the skills about web pages and pictures are in it, before and after.
  stay=$(skills_missing "$folder/skills-after-install.txt" "$folder/keep-skills.txt")
  [ -z "$stay" ] ||
    fail "a fresh install has none of $stay in the reader's skills folder, and this release takes out the video skills only, so this is not a skills folder an install left"

  # 1. A fresh install lists none of the video skills, and carries none of them as a recipe either.
  present=$(skills_present "$folder/skills-after-install.txt" "$folder/video-skills.txt")
  [ -z "$present" ] ||
    fail "a fresh install has $(how_many "$present") of the video skills in the reader's skills folder: $present"
  present=$(tr '\n' ' ' <"$folder/recipes-in-the-version.txt" | sed 's/[[:space:]]*$//')
  [ -z "$present" ] ||
    fail "the version the install runs still carries $(how_many "$present") of the video skills as recipes of its own, so the next install would copy them: $present"

  # 2. After the video add-on's setup they are all there, and the others are still there.
  [ "$(tr -d ' \n\r' <"$folder/setup-code.txt")" = 0 ] ||
    fail "the video add-on's own setup ended $(tr -d ' \n\r' <"$folder/setup-code.txt"), so the skills it installs were never installed: $(grep -E '^(not yet|error|look)' "$folder/setup.log" | tr '\n' ' ' | cut -c1-200)"
  missing=$(skills_missing "$folder/skills-after-addon.txt" "$folder/video-skills.txt")
  [ -z "$missing" ] ||
    fail "$(how_many "$missing") of the video skills are missing after the video add-on's setup: $missing"
  stay=$(skills_missing "$folder/skills-after-addon.txt" "$folder/keep-skills.txt")
  [ -z "$stay" ] ||
    fail "the video add-on's setup left the reader without $stay, which is none of its business"
  ! grep -q '^missing:' "$folder/addon-check.txt" ||
    fail "the video add-on says something is missing after its own setup: $(grep '^missing:' "$folder/addon-check.txt" | tr '\n' ' ' | cut -c1-200)"

  # 3. video-finishing captions the add-on's own sample clip.
  [ "$(tr -d ' \n\r' <"$folder/captions-code.txt")" = 0 ] ||
    fail "captioning the add-on's own sample clip ended $(tr -d ' \n\r' <"$folder/captions-code.txt"): $(tr '\n' ' ' <"$folder/captions.log" | cut -c1-200)"
  grep -q '^Dialogue:' "$folder/captions.ass" ||
    fail "the captions written for the sample clip hold no line of speech at all, so nothing was heard in it"
  grep -q '"word"' "$folder/words.json" ||
    fail "the words the speech model heard in the sample clip were not kept, so the captions came from nowhere"
  local made source clip captioned
  made=$(seconds_of "$folder/captions.log" made)
  source=$(seconds_of "$folder/captions.log" source)
  [ -n "$made" ] && [ -n "$source" ] ||
    fail "the add-on never said it burned the captions into the picture: $(tr '\n' ' ' <"$folder/captions.log" | cut -c1-200)"
  [ "${made%.*}" = "${source%.*}" ] ||
    fail "the captioned clip is ${made}s long and the sample clip is ${source}s, so it is not the same clip with captions on it"
  clip=$(size_of "$folder" clip)
  captioned=$(size_of "$folder" captioned)
  [ -n "$captioned" ] && [ "$captioned" != 0 ] ||
    fail "the captioned clip was never written, so video-finishing captioned nothing"
  [ "$captioned" != "$clip" ] ||
    fail "the captioned clip is the sample clip's own $clip bytes, so nothing was burned into the picture"

  pass "a fresh install of $(tr -d ' \n\r' <"$folder/version.txt") lists none of the $(grep -c . "$folder/video-skills.txt") video skills and still has $(tr '\n' ' ' <"$folder/keep-skills.txt" | sed 's/[[:space:]]*$//'); after the video add-on's own setup all $(grep -c . "$folder/video-skills.txt") are in the reader's skills folder, the add-on says nothing is missing, and video-finishing wrote $(grep -c '^Dialogue:' "$folder/captions.ass") captions into the add-on's own ${source}s sample clip ($captioned bytes against the sample's $clip)"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
