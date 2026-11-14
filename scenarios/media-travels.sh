#!/usr/bin/env bash
# PROVING SCENARIO of 2.0.0-beta.24, item 3 (#57): a picture and a PDF added on one computer show
# in the same note on a fresh install made from the GitHub copy.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.24-never-empty-handed/plan.md, item 3
# and the two-install description in pull request #499): pictures and PDFs used to stay on the
# computer they were added on, so a second computer or a new server showed notes whose pictures
# were missing. Each media item of 50 MB or less is now also kept in notebook/_media/, named by its
# content, and sync commits that folder with the notes.
#
# The two computers are two installations on this one machine (as two-machines-move-at-once), joined
# through one bare repository standing in for the private GitHub repository:
#
#   computer A starts on the version before this one (2.0.0-beta.23), holds a picture, a PDF and a
#     file over 50 MB in its media library, and is then updated to the candidate. The first start
#     after the update has to carry the media it already holds into notebook/_media/ (and not the
#     large file);
#   computer B is a fresh install of the candidate made from A's copy on GitHub, with an empty media
#     root. It has to serve the picture and the PDF, and not the large file (that one stays on A and
#     A's media library says so: GET /api/media/kept-here);
#   a removal on B travels back: A then answers 404 for the picture, while A's own media root still
#     holds its bytes.
#
#   bash scenarios/media-travels.sh candidate/2.0.0-beta.24
#   bash scenarios/media-travels.sh --check <folder>
#
# What it keeps for its checking part (every file one value or one list):
#   a-version-before / a-version-after / b-version   the commit each computer ran
#   picture-sha / pdf-sha / large-sha                the SHA-256 of the three files that were added
#   a-carried-before-update.txt                      notebook/_media on A before the update
#   a-carried-after-update.txt                       notebook/_media on A after the update
#   a-kept-here.json                                 A's answer to GET /api/media/kept-here
#   b-carried.txt                                    notebook/_media on B after its first sync
#   b-picture.status / b-picture.sha                 what B answers for the picture
#   b-pdf.status / b-pdf.sha                         what B answers for the PDF
#   b-large.status                                   what B answers for the large file
#   b-remove.status                                  what B answered to removing the picture
#   a-picture-after-removal.status                   what A answers for the picture afterwards
#   a-media-root-after-removal.txt                   the files in A's media root afterwards
SCENARIO=media-travels
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"

BEFORE_MEDIA_TRAVELS=${GODSPEED_SCENARIO_BEFORE_MEDIA_TRAVELS:-candidate/2.0.0-beta.23}
B_PORT=47841
PICTURE_PATH='user/33333333-3333-4333-8333-333333333333.png'
PDF_PATH='chat/scan/Letter.pdf'
LARGE_PATH='user/44444444-4444-4444-8444-444444444444.mp4'
# A 1x1 PNG.
PICTURE_BASE64='iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

sha_of() { sha256sum "$1" | cut -d' ' -f1; }

# Adds one file to a computer's media library the way the note editor does (POST /api/media/upload).
upload_to() { # <port> <file> <path in the library> <content type> [text of a PDF]
  local port=$1 file=$2 original=$3 type=$4 text=${5:-} code
  if [ -n "$text" ]; then
    code=$(curl -sS -o "$EVIDENCE/.upload-answer" -w '%{http_code}' --max-time 300 -X POST \
      -F "file=@$file;type=$type" -F "path=$original" -F "extracted_text=$text" "http://127.0.0.1:$port/api/media/upload") ||
      fail "the media library on port $port could not be reached to add $original"
  else
    code=$(curl -sS -o "$EVIDENCE/.upload-answer" -w '%{http_code}' --max-time 300 -X POST \
      -F "file=@$file;type=$type" -F "path=$original" "http://127.0.0.1:$port/api/media/upload") ||
      fail "the media library on port $port could not be reached to add $original"
  fi
  [ "$code" = 200 ] || fail "the media library on port $port refused $original (HTTP $code): $(tr -d '\n' <"$EVIDENCE/.upload-answer" | cut -c1-200)"
}

# The status a computer answers for one library path, and the SHA-256 of the bytes it serves.
status_of() { # <port> <path in the library> <file for the status> [file for the sha]
  local code
  code=$(curl -sS -o "$EVIDENCE/.served" -w '%{http_code}' --max-time 60 "http://127.0.0.1:$1/api/media/file/$(printf '%s' "$2" | "$NODE" -e 'process.stdout.write(encodeURIComponent(require("fs").readFileSync(0,"utf8")))')") || code=000
  printf '%s\n' "$code" >"$3"
  if [ -n "${4:-}" ]; then
    if [ "$code" = 200 ]; then sha_of "$EVIDENCE/.served" >"$4"; else printf 'none\n' >"$4"; fi
  fi
}
serves() { # <port> <path> <file for the status> <file for the sha>: true when it answers 200
  status_of "$1" "$2" "$3" "$4"
  [ "$(cat "$3")" = 200 ]
}

# What notebook/_media holds, one name per line.
carried_of() { # <root> <file>
  { ls "$1/notebook/_media" 2>/dev/null || true; } | sort >"$2"
}

# ------------------------------------------------------------------------------------ the acting
act() {
  fresh_evidence
  install_paths
  local work=${GODSPEED_SCENARIO_WORK:-${RUNNER_TEMP:-/tmp}} b address picture pdf large
  b=$work/computer-b
  rm -rf "$b"
  picture=$EVIDENCE/.picture.png
  pdf=$EVIDENCE/.letter.pdf
  large=$EVIDENCE/.large.mp4
  printf '%s' "$PICTURE_BASE64" | base64 -d >"$picture" || fail "the made-up picture could not be written"
  printf '%%PDF-1.4 synthetic letter for the media scenario\n' >"$pdf" || fail "the made-up PDF could not be written"
  head -c $((51 * 1024 * 1024)) /dev/zero >"$large" || fail "the made-up large file could not be written"
  sha_of "$picture" >"$EVIDENCE/picture-sha"
  sha_of "$pdf" >"$EVIDENCE/pdf-sha"
  sha_of "$large" >"$EVIDENCE/large-sha"

  say "== the first computer, on the version before this one, holding a picture, a PDF and a file over 50 MB"
  install_the_line_of_into "$BEFORE_MEDIA_TRAVELS" "$ROOT" "$NOTEBOOK_PORT" "$EVIDENCE/a-before.log"
  need_node
  read_version "$ROOT"
  cp "$(runtime_of "$ROOT")/version" "$EVIDENCE/a-version-before" || fail "the install of the version before this one left no version file behind"
  upload_to "$NOTEBOOK_PORT" "$picture" "$PICTURE_PATH" image/png
  upload_to "$NOTEBOOK_PORT" "$pdf" "$PDF_PATH" application/pdf 'Page 1 Dear owner'
  upload_to "$NOTEBOOK_PORT" "$large" "$LARGE_PATH" video/mp4
  carried_of "$ROOT" "$EVIDENCE/a-carried-before-update.txt"

  say "== the first computer is updated to the candidate: its first start has to carry what it holds"
  install_the_stage_line_into "$ROOT" "$NOTEBOOK_PORT" "$EVIDENCE/a-update.log"
  read_version "$ROOT"
  cp "$(runtime_of "$ROOT")/version" "$EVIDENCE/a-version-after" || fail "the update left no version file behind on the first computer"
  wait_for 180 "the picture and the PDF are kept in notebook/_media on the first computer" \
    test -f "$ROOT/notebook/_media/$(cat "$EVIDENCE/picture-sha").png" -a -f "$ROOT/notebook/_media/$(cat "$EVIDENCE/pdf-sha").pdf" || true
  carried_of "$ROOT" "$EVIDENCE/a-carried-after-update.txt"
  curl -sS --max-time 60 "http://127.0.0.1:$NOTEBOOK_PORT/api/media/kept-here" -o "$EVIDENCE/a-kept-here.json" ||
    fail "the first computer's media library could not say which files it keeps only on this computer"

  say "== the first computer is connected to the private copy, and a second computer is made from the copy"
  # The owner's own mission control, which the installer made a repository with its first commit,
  # given the copy on GitHub a person makes for it (scenario-lib.sh stand_in_github_over_ssh).
  stand_in_github_over_ssh "$work/github"
  address=$STAND_IN_ADDRESS
  git -C "$ROOT" remote add origin "$address" || fail "the mission control in $ROOT could not be given its copy on GitHub"
  notebook_on "$ROOT" sync folder notebook >"$EVIDENCE/join.json" ||
    fail "godspeed sync folder notebook was refused on the first computer, so there is no mission control carrying its own notebook (what it said is in the step log)"
  sync_round "$ROOT" a "carries the first computer's notebook to the copy"
  git clone -q "$address" "$b" || fail "the second computer could not be set up from the copy on GitHub"
  install_the_stage_line_into "$b" "$B_PORT" "$EVIDENCE/b-install.log"
  read_version "$b"
  cp "$(runtime_of "$b")/version" "$EVIDENCE/b-version" || fail "the second computer's install left no version file behind"
  notebook_on "$b" sync folder notebook >&2 || fail "godspeed sync folder notebook was refused on the second computer, so it never joined"
  sync_round "$b" b "brings the first computer's notebook to the second computer"
  carried_of "$b" "$EVIDENCE/b-carried.txt"

  say "== the second computer, with an empty media root, serves the picture and the PDF"
  wait_for 120 "the second computer serves the picture" \
    serves "$B_PORT" "$PICTURE_PATH" "$EVIDENCE/b-picture.status" "$EVIDENCE/b-picture.sha" || true
  status_of "$B_PORT" "$PICTURE_PATH" "$EVIDENCE/b-picture.status" "$EVIDENCE/b-picture.sha"
  status_of "$B_PORT" "$PDF_PATH" "$EVIDENCE/b-pdf.status" "$EVIDENCE/b-pdf.sha"
  status_of "$B_PORT" "$LARGE_PATH" "$EVIDENCE/b-large.status"

  say "== removing the picture on the second computer travels back to the first"
  local code
  code=$(curl -sS -o "$EVIDENCE/.remove-answer" -w '%{http_code}' --max-time 60 -X POST -H 'Content-Type: application/json' \
    -d "{\"paths\":[\"$PICTURE_PATH\"]}" "http://127.0.0.1:$B_PORT/api/media/remove") || code=000
  printf '%s\n' "$code" >"$EVIDENCE/b-remove.status"
  sync_round "$b" b "carries the removal of the picture to the copy"
  sync_round "$ROOT" a "brings the removal of the picture to the first computer"
  # Installing the second computer took the service the first one ran as, so the first computer is
  # started again (the same line over the same folder is a restart) before it is asked anything.
  install_the_stage_line_into "$ROOT" "$NOTEBOOK_PORT" "$EVIDENCE/a-restart.log"
  wait_for 120 "the first computer answers again" curl -fsS --max-time 10 "http://127.0.0.1:$NOTEBOOK_PORT/health" -o /dev/null || true
  gone() { status_of "$NOTEBOOK_PORT" "$PICTURE_PATH" "$EVIDENCE/a-picture-after-removal.status"; [ "$(cat "$EVIDENCE/a-picture-after-removal.status")" = 404 ]; }
  wait_for 60 "the first computer no longer serves the picture" gone || true
  status_of "$NOTEBOOK_PORT" "$PICTURE_PATH" "$EVIDENCE/a-picture-after-removal.status"
  { ls "$(runtime_of "$ROOT")/media" 2>/dev/null || true; } | sort >"$EVIDENCE/a-media-root-after-removal.txt"
  rm -f "$picture" "$pdf" "$large"
}

# ----------------------------------------------------------------------------------- the judging
check() { # <evidence folder>
  local folder=$1 picture pdf large
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of media travelling between two computers"
  need_node
  kept_all "$folder" "what the two computers held and served" \
    a-version-before a-version-after b-version picture-sha pdf-sha large-sha \
    a-carried-after-update.txt a-kept-here.json b-carried.txt \
    b-picture.status b-picture.sha b-pdf.status b-pdf.sha b-large.status b-remove.status \
    a-picture-after-removal.status
  [ -f "$folder/a-carried-before-update.txt" ] || fail "a-carried-before-update.txt is not in what the scenario kept: notebook/_media on the first computer before the update"
  [ -f "$folder/a-media-root-after-removal.txt" ] || fail "a-media-root-after-removal.txt is not in what the scenario kept: the first computer's media root after the removal"
  picture=$(tr -d ' \n\r' <"$folder/picture-sha")
  pdf=$(tr -d ' \n\r' <"$folder/pdf-sha")
  large=$(tr -d ' \n\r' <"$folder/large-sha")

  # THE FIRST COMPUTER REALLY MOVED, and the media was only in its media root before.
  [ "$(tr -d ' \n\r' <"$folder/a-version-before")" != "$(tr -d ' \n\r' <"$folder/a-version-after")" ] ||
    fail "the first computer runs the same commit after the update as before it, so no first start after an update was tried"
  ! grep -q . "$folder/a-carried-before-update.txt" ||
    fail "notebook/_media already held files on the first computer before the update ($(tr '\n' ' ' <"$folder/a-carried-before-update.txt" | cut -c1-200)), so it did not start on a version that leaves media on its own computer and the first start had nothing to carry"
  [ "$(tr -d ' \n\r' <"$folder/b-version")" = "$(tr -d ' \n\r' <"$folder/a-version-after")" ] ||
    fail "the two computers do not run one version after the update ($(tr -d ' \n\r' <"$folder/a-version-after") and $(tr -d ' \n\r' <"$folder/b-version"))"

  # THE FIRST START AFTER THE UPDATE CARRIES WHAT THE COMPUTER HOLDS: the picture and the PDF, and
  # nothing is carried of the file over 50 MB.
  grep -qxF "$picture.png" "$folder/a-carried-after-update.txt" ||
    fail "the first computer's first start after the update did not carry the picture into notebook/_media (it holds: $(tr '\n' ' ' <"$folder/a-carried-after-update.txt" | cut -c1-200))"
  grep -qxF "$pdf.pdf" "$folder/a-carried-after-update.txt" ||
    fail "the first computer's first start after the update did not carry the PDF into notebook/_media (it holds: $(tr '\n' ' ' <"$folder/a-carried-after-update.txt" | cut -c1-200))"
  ! grep -qF "$large" "$folder/a-carried-after-update.txt" ||
    fail "the file over 50 MB was carried into notebook/_media, and GitHub refuses a file that large"
  grep -qF "user/44444444-4444-4444-8444-444444444444.mp4" "$folder/a-kept-here.json" ||
    fail "the first computer's media library does not say the file over 50 MB is kept on this computer only: $(tr -d '\n' <"$folder/a-kept-here.json" | cut -c1-200)"

  # THE SECOND COMPUTER, FROM THE COPY ALONE, SERVES THE SMALL ONES AND NOT THE LARGE ONE.
  grep -qxF "$picture.png" "$folder/b-carried.txt" && grep -qxF "$pdf.pdf" "$folder/b-carried.txt" ||
    fail "the copy on GitHub did not bring the picture and the PDF to the second computer's notebook/_media (it holds: $(tr '\n' ' ' <"$folder/b-carried.txt" | cut -c1-200))"
  [ "$(tr -d ' \n\r' <"$folder/b-picture.status")" = 200 ] ||
    fail "the second computer answers $(tr -d ' \n\r' <"$folder/b-picture.status") for the picture, so a note there would show it missing"
  [ "$(tr -d ' \n\r' <"$folder/b-picture.sha")" = "$picture" ] ||
    fail "the second computer serves different bytes for the picture than the first computer was given"
  [ "$(tr -d ' \n\r' <"$folder/b-pdf.status")" = 200 ] ||
    fail "the second computer answers $(tr -d ' \n\r' <"$folder/b-pdf.status") for the PDF, so a note there would show it missing"
  [ "$(tr -d ' \n\r' <"$folder/b-pdf.sha")" = "$pdf" ] ||
    fail "the second computer serves different bytes for the PDF than the first computer was given"
  [ "$(tr -d ' \n\r' <"$folder/b-large.status")" != 200 ] ||
    fail "the second computer serves the file over 50 MB, which never left the first computer"

  # A REMOVAL ON THE SECOND COMPUTER TRAVELS BACK, and removes nothing of the first one's own bytes.
  [ "$(tr -d ' \n\r' <"$folder/b-remove.status")" = 200 ] ||
    fail "the second computer refused to remove the picture (HTTP $(tr -d ' \n\r' <"$folder/b-remove.status"))"
  [ "$(tr -d ' \n\r' <"$folder/a-picture-after-removal.status")" = 404 ] ||
    fail "the first computer answers $(tr -d ' \n\r' <"$folder/a-picture-after-removal.status") for the picture after it was removed on the second one, not 404"
  grep -qF "$picture" "$folder/a-media-root-after-removal.txt" ||
    fail "the first computer's own media root lost the picture's bytes when the removal arrived, and nothing there is deleted by it"

  pass "a picture and a PDF added on one computer (carried by its first start after the update from $(tr -d ' \n\r' <"$folder/a-version-before" | cut -c1-12) to $(tr -d ' \n\r' <"$folder/a-version-after" | cut -c1-12)) are served by a fresh install made from the GitHub copy with the same bytes, the file over 50 MB stays on its computer and is listed as kept there, and a removal on the second computer reaches the first without deleting its own bytes"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
