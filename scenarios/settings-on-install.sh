#!/usr/bin/env bash
# PROVING SCENARIO 1: the faster-chat settings a fresh install carries, and the owner's own value.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.8-faster-chat/plan.md, scenario 1):
# every install and update runs godspeedHermesSettings over the assistant's settings
# (notebook/core/hermes-config.mjs, notebook/scripts/wire-assistant.mjs), so a stranger who installs
# today gets a chat that answers as it is written, leaves no "let me check" sentences behind, and
# summarises a long conversation long before anyone waits for it. And a value the owner set
# themselves stays theirs: the one number where that is a real choice is
# compression.threshold_tokens, so the scenario sets it to 150000 and runs the line again.
#
#   bash scenarios/settings-on-install.sh candidate/2.0.0-beta.8
#   bash scenarios/settings-on-install.sh --check <folder>
#
# What it keeps for its checking part, in the evidence folder:
#   config-after-install.yaml       the assistant's settings file after a fresh install
#   config-after-owner-change.yaml  the same file after the owner's own 150000 and the line again
#   install-trace.log, second-trace.log  what the install line said, for the step log
SCENARIO=settings-on-install
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"

# Ticket 1's five values, at the exact keys Hermes reads them at.
FASTER_CHAT="streaming.enabled=true
display.platforms.telegram.streaming=true
display.platforms.telegram.interim_assistant_messages=false
display.platforms.telegram.long_running_notifications=false
compression.threshold_tokens=100000"

act() {
  fresh_evidence
  install_paths
  install_the_stage_line "$EVIDENCE/install-trace.log"
  need_node
  assistant_home
  [ -f "$HERMES/config.yaml" ] || {
    show_assistant_home
    fail "the install left the assistant no settings file at all ($HERMES/config.yaml is not there)"
  }
  cp "$HERMES/config.yaml" "$EVIDENCE/config-after-install.yaml"

  say "The owner sets their own summarising threshold, the way they would in the assistant's settings"
  owner_sets_threshold "$HERMES/config.yaml" 150000
  install_the_stage_line "$EVIDENCE/second-trace.log"
  assistant_home
  [ -f "$HERMES/config.yaml" ] || fail "the second run of the line left no settings file behind"
  cp "$HERMES/config.yaml" "$EVIDENCE/config-after-owner-change.yaml"
}

check() { # <evidence folder>
  local folder=$1 key value
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of an install"
  kept "$folder" config-after-install.yaml "the assistant's settings file as a fresh install left it"
  kept "$folder" config-after-owner-change.yaml "the assistant's settings file after the owner's own value and the line again"
  need_node

  local fresh=$folder/config-after-install.yaml after=$folder/config-after-owner-change.yaml
  while IFS='=' read -r key value; do
    [ -n "$key" ] || continue
    want_config "$fresh" "$key" "$value" "the settings a fresh install wrote"
  done <<FIVE
$FASTER_CHAT
FIVE

  # The owner's own number is still theirs after the line ran again.
  want_config "$after" compression.threshold_tokens 150000 \
    "the settings after the owner set 150000 and the line ran again"
  # And the four the owner did not touch are still Godspeed's.
  while IFS='=' read -r key value; do
    [ -n "$key" ] || continue
    [ "$key" != compression.threshold_tokens ] || continue
    want_config "$after" "$key" "$value" "the settings after the owner set 150000 and the line ran again"
  done <<FIVE
$FASTER_CHAT
FIVE

  pass "a fresh install carries streaming on, Telegram's live draft, no interim or long-running messages and 100000 tokens; the owner's own 150000 was still there after the line ran again"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
