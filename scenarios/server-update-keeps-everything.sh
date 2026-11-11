#!/usr/bin/env bash
# PROVING SCENARIO: a Docker server updates from the current public version with godspeed-update
# and keeps everything (#456).
#
# A server installed with today's public /server line, whose owner gave the notebook a first goal,
# runs the stage's own docker/server/update.sh as the administrator. GitHub's releases stand in on
# this machine (update-keeps-everything-release.sh): the Latest release is the stage, its source
# archive made from this checkout and vouched for by its SHA256SUMS. The update checks the download,
# runs the installer inside it, and the server then runs the image the stage names, healthy, with
# the owner's goal still there, and says which version it is. The godspeed-update command the update
# installed, run again, says the newest version is installed and changes nothing.
#
# The public line comes from godspeedmissioncontrol.com/server, as in server_install
# (server-lib.sh), only without the stage: what it installs is the current public version.
#
#   bash scenarios/server-update-keeps-everything.sh this-commit
#   bash scenarios/server-update-keeps-everything.sh --check <folder>
#
# What it keeps for its checking part:
#   stage.json                          the stage's own file
#   image-before / -after / -again      the server image .env names before, after, and after the second run
#   container-image.txt / health.txt    the image the running container was made from, and its health
#   version.txt                         the version the server says it runs ($DIR/version)
#   update-said.txt / again-said.txt    what the update said, and what godspeed-update said after it
#   goals-before.json / goals-after.json  the notebook's goals before the update and after it
SCENARIO=server-update-keeps-everything
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/scenario-lib.sh"
# shellcheck source=scenarios/server-lib.sh
. "$HERE/server-lib.sh"
# shellcheck source=scenarios/update-keeps-everything-release.sh
. "$HERE/update-keeps-everything-release.sh"
scenario_arguments "$@"

FIRST_GOAL='Keep the server scenario ready'

server_install_public() {
  local installer=$EVIDENCE/.server-installer.sh
  say "Today's public /server line, which installs the current public version"
  curl -fsSL https://godspeedmissioncontrol.com/server >"$installer" ||
    fail "today's public /server line could not be downloaded, so there was nothing to update from"
  sudo GODSPEED_HOST=localhost bash "$installer" >&2 ||
    fail "today's public /server line failed, so there was nothing to update from"
  server_healthy 300 || fail "the Docker server of the current public version is not healthy, so there was nothing to update from"
}
server_image() { sudo sed -n 's/^GODSPEED_SERVER_IMAGE=//p' "$SERVER_DIR/.env" | tail -n 1; }
# What godspeed-update reads, standing in for GitHub's.
as_the_administrator() { # <file for what it said> <command...>
  sudo GODSPEED_SCENARIO_RELEASES_URL="$RELEASES_URL" GODSPEED_STAGE_RAW="$RAW" "${@:2}" 2>&1 | tee "$1" >&2
  return "${PIPESTATUS[0]}"
}

act() {
  fresh_evidence
  need_node
  server_install_public
  server_image >"$EVIDENCE/image-before"
  say "The server starts on $(cat "$EVIDENCE/image-before")"

  printf '{"goal":%s,"timezone":"Etc/UTC","delivery":"notebook"}\n' "$(quoted_json "$FIRST_GOAL")" >"$EVIDENCE/.setup.json"
  [ "$(server_post /api/setup "$EVIDENCE/.setup.json" "$EVIDENCE/setup.json")" = 200 ] ||
    fail "the server's notebook refused the owner's first goal: $(tr -d '\n' <"$EVIDENCE/setup.json" | cut -c1-200)"
  server_table goals "$EVIDENCE/goals-before.json"

  rm -rf "$EVIDENCE.releases"
  stand_in_release "$EVIDENCE.releases" "$STAGE_REF"
  serve_stand_in_releases "$EVIDENCE.releases"
  say "The stage's own update, as the administrator"
  as_the_administrator "$EVIDENCE/update-said.txt" bash "$HERE/../docker/server/update.sh" ||
    fail "the update stopped: $(tail -n 3 "$EVIDENCE/update-said.txt" | tr '\n' ' ' | cut -c1-300)"
  server_healthy 300 || fail "the Docker server is not healthy after the update"
  server_image >"$EVIDENCE/image-after"
  sudo docker inspect -f '{{.Config.Image}}' "$(server_container)" >"$EVIDENCE/container-image.txt" 2>/dev/null ||
    printf 'none\n' >"$EVIDENCE/container-image.txt"
  sudo docker inspect -f '{{.State.Health.Status}}' "$(server_container)" >"$EVIDENCE/health.txt" 2>/dev/null ||
    printf 'none\n' >"$EVIDENCE/health.txt"
  sudo cat "$SERVER_DIR/version" >"$EVIDENCE/version.txt" 2>/dev/null || printf 'none\n' >"$EVIDENCE/version.txt"
  server_table goals "$EVIDENCE/goals-after.json"

  say "godspeed-update again, which the update installed"
  [ -x /usr/local/bin/godspeed-update ] || fail "the update installed no godspeed-update command on the server"
  as_the_administrator "$EVIDENCE/again-said.txt" /usr/local/bin/godspeed-update ||
    fail "godspeed-update run a second time stopped: $(tail -n 3 "$EVIDENCE/again-said.txt" | tr '\n' ' ' | cut -c1-300)"
  server_image >"$EVIDENCE/image-again"
  curl -fsSL "$RAW/$STAGE_REF/stage.json" -o "$EVIDENCE/stage.json" ||
    fail "the stage's own file at $STAGE_REF could not be read, so there is nothing to compare with"
}

check() { # <evidence folder>
  local folder=$1
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of a server update"
  need_node
  for file in stage.json image-before image-after image-again container-image.txt health.txt version.txt \
    update-said.txt again-said.txt goals-before.json goals-after.json; do
    kept "$folder" "$file" "what the server looked like before the update and after it"
  done

  local version image before after
  version=$(json_value "$folder/stage.json" version) || fail "the stage's own file names no version, so it is no stage file"
  image=$(json_value "$folder/stage.json" serverEditions.server.image) ||
    fail "the stage's own file names no server image, so it is no stage file"
  before=$(tr -d ' \n\r' <"$folder/image-before")
  after=$(tr -d ' \n\r' <"$folder/image-after")

  [ "$before" != "$image" ] ||
    fail "the public server already ran $image, the stage's image, so there was nothing to update"
  grep -qF "The download of $version matched the checksum its release publishes." "$folder/update-said.txt" ||
    fail "the update did not say the download of $version matched its release's checksum, so it did not verify the download"
  [ "$after" = "$image" ] || fail "the server's settings name $after after the update, and the stage names $image"
  [ "$(tr -d ' \n\r' <"$folder/container-image.txt")" = "$image" ] ||
    fail "the running container was made from $(tr -d ' \n\r' <"$folder/container-image.txt"), not the stage's $image"
  [ "$(tr -d ' \n\r' <"$folder/health.txt")" = healthy ] ||
    fail "the container is $(tr -d ' \n\r' <"$folder/health.txt") after the update, not healthy"
  [ "$(tr -d ' \n\r' <"$folder/version.txt")" = "$version" ] ||
    fail "the server says it runs $(tr -d ' \n\r' <"$folder/version.txt") after the update, not the stage's $version"

  grep -qF "$FIRST_GOAL" "$folder/goals-before.json" ||
    fail "the owner's first goal was not in the notebook before the update, so the scenario had nothing to keep"
  grep -qF "$FIRST_GOAL" "$folder/goals-after.json" ||
    fail "the owner's first goal is gone from the notebook after the update"

  grep -qF "You have the newest version, $version. Nothing was changed." "$folder/again-said.txt" ||
    fail "godspeed-update run again did not say $version is the newest version and nothing was changed"
  [ "$(tr -d ' \n\r' <"$folder/image-again")" = "$after" ] ||
    fail "godspeed-update run again changed the server image to $(tr -d ' \n\r' <"$folder/image-again")"

  pass "$before became $image, the stage's $version, through godspeed-update from a checked download; the container is healthy, the owner's goal is kept, and the command run again changed nothing"
}

if [ "$CHECK_ONLY" = yes ]; then
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
