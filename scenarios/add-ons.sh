#!/usr/bin/env bash
# PROVING SCENARIO: adding an add-on, and the add-on's page through the notebook, on a fresh install
# (godspeed-dev, releases/godspeed-2.0.0-beta.36-add-ons-on-request/plan.md, Proving; issues #1162, #1166).
#
# A stranger's Docker server is made with the stage's own /server line, and then
# notebook/test/acceptance/add-ons.sh runs inside it as the account Godspeed runs under (hermes), with
# GODSPEED_WORKSPACE and GODSPEED_NOTEBOOK_URL set to that install's folder and its web door (the door
# every visit through the secure address reaches, which asks everyone to sign in). It adds a local test add-on (which follows the Wingman's
# contract and asks no AI anything), twice, then opens its page signed in and unsigned, and reads
# Settings' own list (GET /api/addons) for the page's link. Then this script checks that every file
# under .godspeed/addons/teston/, including what the page process wrote, belongs to that account.
#
#   bash scenarios/add-ons.sh candidate/2.0.0-beta.36
#   bash scenarios/add-ons.sh --check <folder>
#
# What it keeps for its checking part:
#   acceptance.log   what add-ons.sh said (its last line is ACCEPTANCE PASSED or FAILED)
#   acceptance-code.txt   how it ended
#   owners.txt       "<file> <owner>" for everything under .godspeed/addons/teston/, and "account <name>"
SCENARIO=add-ons
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "${BASH_SOURCE[0]}")/scenario-lib.sh"
# shellcheck source=scenarios/server-lib.sh
. "$HERE/server-lib.sh"
scenario_arguments "$@"

HOME_IN=/opt/data
WORKSPACE_IN=/opt/data/full-candidate/workspace
KIT_IN=/opt/godspeed/kit
# The test add-on's catalog entry, the same as the one add-ons.sh makes for its own command. The running
# notebook lists the add-ons of a catalog it read when it started, so Settings' list (GET /api/addons)
# can carry the test add-on's page only if the server is started with this catalog.
CATALOG='[{"id":"teston","name":"the Teston","aliases":["teston"],"repository":"acme/teston","setup":["bin/teston.mjs","setup"],"check":["bin/teston.mjs","check"],"description":"A test add-on.","start":"Open the Teston page."}]'

act() {
  fresh_evidence
  need_node
  server_install
  say "The server is started again with the test add-on's catalog (the notebook reads its catalog when it starts)"
  printf '%s\n' "$CATALOG" | in_server_as_hermes tee "$HOME_IN/teston-catalog.json" >/dev/null ||
    fail "the test catalog could not be written into the server"
  printf 'services:\n  godspeed:\n    environment:\n      GODSPEED_ADDON_CATALOG: "%s"\n' "$HOME_IN/teston-catalog.json" |
    sudo tee "$SERVER_DIR/compose.override.yaml" >/dev/null || fail "the server's catalog could not be set"
  server_compose -f "$SERVER_DIR/compose.override.yaml" up -d --force-recreate >&2 ||
    fail "the server could not be started again with the test catalog"
  server_healthy 300 || fail "the server is not healthy after it was started with the test catalog"
  say "add-ons.sh, inside the server as hermes, against $WORKSPACE_IN and its web door"
  in_server_as_hermes tee /tmp/add-ons.sh <"$HERE/../notebook/test/acceptance/add-ons.sh" >/dev/null ||
    fail "add-ons.sh could not be put into the server"
  in_server_as_hermes env GODSPEED_CLI="$KIT_IN/notebook/bin/godspeed.mjs" GODSPEED_WORKSPACE="$WORKSPACE_IN" \
    GODSPEED_NOTEBOOK_URL=http://127.0.0.1:47831 GODSPEED_LOCAL_URL=http://127.0.0.1:"$INGEST_PORT" \
    timeout 600 bash /tmp/add-ons.sh </dev/null >"$EVIDENCE/acceptance.log" 2>&1
  printf '%s\n' "$?" >"$EVIDENCE/acceptance-code.txt"
  sed 's/^/  | /' "$EVIDENCE/acceptance.log" >&2
  {
    printf 'account %s\n' "$(in_server_as_hermes id -un)"
    in_server_as_hermes find "$WORKSPACE_IN/.godspeed/addons/teston" -printf '%p %u\n'
  } >"$EVIDENCE/owners.txt" 2>/dev/null
  rm -f "$EVIDENCE"/.[a-z]*
  sudo rm -f "$SERVER_DIR/compose.override.yaml"
}

check() { # <evidence folder>
  local folder=$1 account last wrong
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of an install"
  kept_all "$folder" "add-ons.sh's own words and the owners of the add-on's files" acceptance.log acceptance-code.txt owners.txt
  last=$(grep -E '^(ACCEPTANCE|NOT RUN)' "$folder/acceptance.log" | tail -n 1)
  [ "$(tr -d ' \n\r' <"$folder/acceptance-code.txt")" = 0 ] && [ "$last" = "ACCEPTANCE PASSED" ] ||
    fail "add-ons.sh ended $(tr -d ' \n\r' <"$folder/acceptance-code.txt"): ${last:-it said nothing of its own}"
  account=$(sed -n 's/^account //p' "$folder/owners.txt" | head -n 1)
  [ -n "$account" ] || fail "the account Godspeed runs under was not kept"
  [ "$(grep -c '^/' "$folder/owners.txt")" -ge 3 ] ||
    fail "the add-on's folder holds almost nothing, so there was nothing to check the owner of"
  grep -q '/page-wrote ' "$folder/owners.txt" || fail "the add-on's page wrote no file into its own folder"
  wrong=$(grep '^/' "$folder/owners.txt" | awk -v a="$account" '$NF != a { print $1 " (" $NF ")" }' | head -n 5 | tr '\n' ' ')
  [ -z "$wrong" ] || fail "files of the add-on belong to another account than $account: $wrong"
  pass "a fresh Docker server added the test add-on twice, its page answered signed in and sent an unsigned visit to sign-in, Settings' list carried the page, and all $(grep -c '^/' "$folder/owners.txt") files under .godspeed/addons/teston/ belong to $account"
}

if [ "$CHECK_ONLY" = yes ]; then
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
