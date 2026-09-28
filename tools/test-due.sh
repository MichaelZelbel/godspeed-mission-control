#!/usr/bin/env bash
# test-due.sh - the gate for due.js: done is an event in world/events/, and every reader works out
# "open" from those events. Case 1 is the incident this model was built against: a post approved and
# published in a working session, the memory recording it that day, and the deadline file still
# saying open, so the morning brief kept handing the finished work back for five mornings.
#
# Runs inside a throwaway mission control. Needs node only.
# Usage: bash tools/test-due.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
G="$TMP/godspeed"
mkdir -p "$G/due" "$G/world/events" "$G/rules"
: > "$G/AGENTS.md"
d() { GODSPEED_ROOT="$G" node "$HERE/due.js" --godspeed "$G" "$@"; }

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
check()    { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (wanted [$3], got [$2])"; fi; }
contains() { case "$2" in *"$3"*) ok "$1";; *) bad "$1 (missing [$3] in: $(printf '%s' "$2" | head -3))";; esac; }
missing()  { case "$2" in *"$3"*) bad "$1 (should not contain [$3])";; *) ok "$1";; esac; }

echo "due.js gate"

# --- the incident --------------------------------------------------------------------------
for s in post-approve post-publish; do
cat > "$G/due/$s.md" <<PLAN
# Say yes to the post ($s)

TITLE: Say yes to the post ($s)
DONE-WHEN: You have said yes, or what to change
COST-IF-MISSED: The launch slips.
SELF-CHECK: none
REPEATS: no

## Windows

STRIP: 2026-09-23 2026-09-30 open

## Log

- 2026-09-16 created
PLAN
done
cat > "$G/world/events/2026-09-23-published-the-post.md" <<'FACT'
---
date: 2026-09-23
participants: [me]
source: my own words, 2026-09-23
---

I published the post.
FACT
BEFORE="$(GODSPEED_TODAY=2026-09-28 d today)"
contains "incident: with only the life fact, the brief still carries the approval" "$BEFORE" "post-approve"
cat > "$G/world/events/2026-09-23-post-approved-and-published.md" <<'FACT'
---
date: 2026-09-23
participants: [me]
closes: [due/post-approve, due/post-publish]
evidence: I said "please publish that" in the working session
---

Approved and published.
FACT
AFTER="$(GODSPEED_TODAY=2026-09-28 d today)"
missing "incident: once an event closes them, the brief carries neither" "$AFTER" "Say yes to the post"
missing "incident: nor does the full list" "$(GODSPEED_TODAY=2026-09-28 d)" "RUNNING OUT"
contains "incident: state names the event" "$(GODSPEED_TODAY=2026-09-28 d state)" "CLOSED   post-publish  (world/events/2026-09-23-post-approved-and-published.md)"

# --- no evidence, no closing -----------------------------------------------------------------
rm -f "$G"/due/*.md "$G"/world/events/*.md
d add chore --title "CHORE" --from 2026-01-01 --to 2026-01-10 --done-when x --cost y >/dev/null
printf -- '---\ndate: 2026-01-05\nparticipants: [me]\ncloses: [due/chore]\n---\n\nSurely done.\n' > "$G/world/events/2026-01-05-guess.md"
contains "an event without evidence closes nothing" "$(GODSPEED_TODAY=2026-01-06 d)" "CHORE"
contains "and check names it" "$(GODSPEED_TODAY=2026-01-06 d check)" "closes nothing"

# --- done and drop write events, and the file keeps only the window ------------------------------
GODSPEED_TODAY=2026-01-07 d done chore --evidence "the receipt is in my mail" >/dev/null
EV="$(cat "$G"/world/events/2026-01-07-chore-closed.md 2>/dev/null)"
contains "done writes an event with the window it closes" "$EV" "closes: [due/chore#2026-01-01]"
contains "and the evidence" "$EV" "evidence: you said so; the receipt is in my mail"
check "the file carries no state word" "$(grep -c '^STRIP: 2026-01-01 2026-01-10$' "$G/due/chore.md")" "1"
contains "and the list shows it done" "$(GODSPEED_TODAY=2026-01-08 d)" "DONE      CHORE"
missing "and the brief does not carry it" "$(GODSPEED_TODAY=2026-01-08 d today)" "CHORE"
d add monthly --title "MONTHLY" --from 2026-01-01 --to 2026-01-28 --repeats monthly --done-when x --cost y >/dev/null
GODSPEED_TODAY=2026-02-10 d drop monthly >/dev/null
[ -f "$G/due/monthly.md" ] && ok "drop refuses without --yes" || bad "drop refuses without --yes"
GODSPEED_TODAY=2026-02-10 d drop monthly --yes >/dev/null
[ -f "$G/due/monthly.md" ] && ok "drop deletes nothing" || bad "drop deletes nothing"
contains "a dropped one is listed as called off" "$(GODSPEED_TODAY=2026-05-10 d)" "CALLED OFF     MONTHLY"
missing "and never comes back to the brief" "$(GODSPEED_TODAY=2026-05-10 d today)" "MONTHLY"

# --- the old form moves itself -------------------------------------------------------------------
rm -f "$G"/due/*.md "$G"/world/events/*.md
cat > "$G/due/old.md" <<'PLAN'
# OLD

TITLE: OLD
DONE-WHEN: x
COST-IF-MISSED: y
SELF-CHECK: none
REPEATS: no

## Windows

STRIP: 2026-01-01 2026-01-10 done 2026-01-04

## Log

- 2026-01-01 created
- 2026-01-04 you said it was done
PLAN
contains "an old done word is honoured" "$(GODSPEED_TODAY=2026-01-05 d)" "DONE      OLD"
contains "and turned into an event on its true date" "$(cat "$G"/world/events/2026-01-04-old-closed.md 2>/dev/null)" "evidence: due/old.md log, 2026-01-04: you said it was done"
check "then the word goes" "$(grep -c '^STRIP: 2026-01-01 2026-01-10$' "$G/due/old.md")" "1"
GODSPEED_TODAY=2026-01-06 d >/dev/null
check "moving twice writes one event" "$(ls "$G/world/events" | grep -c old)" "1"

echo
echo "due.js: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
