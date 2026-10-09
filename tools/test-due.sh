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

# =================================================================================================
# THREE DATES: the day you can start, the day you would like it done (a target, soft) and the day
# it starts costing you (a deadline, hard). At least one of the last two.
# =================================================================================================
fresh() { rm -f "$G"/due/*.md "$G"/world/events/*.md; }
said() { GODSPEED_TODAY="$1" d today; }
fresh

# --- still no date, not eligible -----------------------------------------------------------------
contains "neither a target nor a deadline is refused" "$(d add wish --title W --done-when x)" "No date, not eligible"
[ -f "$G/due/wish.md" ] && bad "and leaves no file" || ok "and leaves no file"
contains "a start alone is no day either" "$(d add half --title H --from 2026-01-01 --done-when x --cost y)" "No date, not eligible"
contains "a target after the deadline is refused" "$(d add up --title U --from 2026-01-01 --target 2026-03-01 --to 2026-02-01 --done-when x --cost y)" "A target sits on or before the deadline"
contains "a deadline still says what it costs" "$(d add nc --title N --target 2026-02-01 --to 2026-03-01 --done-when x)" "what it costs you if it slips"

# --- a target only: quiet, one mention, one question, then about weekly ------------------------------
OUT="$(GODSPEED_TODAY=2026-04-20 d add present --title "PRESENT" --target 2026-05-10 --done-when "the present is bought")"
contains "a target alone is enough, and no cost is asked for" "$OUT" "Nothing is said about it before that day"
contains "the start is today and there is no deadline" "$(cat "$G/due/present.md")" "STRIP: 2026-04-20 - target 2026-05-10"
contains "the list says when" "$(GODSPEED_TODAY=2026-05-01 d)" "AIMING FOR     PRESENT: you would like it done by 2026-05-10, in 9 days."
missing "the brief says nothing before the day" "$(said 2026-04-21; said 2026-05-09)" "PRESENT"
contains "on the day it is said once" "$(said 2026-05-10)" "TARGET TODAY   PRESENT: today, 2026-05-10, is the day you would like it done."
OUT="$(said 2026-05-11)"
contains "the next morning it asks once" "$OUT" "PRESENT: you aimed for 2026-05-10. A new date, or as soon as you can?"
missing "the brief gets the question in plain words, no commands" "$OUT" "mc-due target"
contains "the full list shows the two answers under it" "$(GODSPEED_TODAY=2026-05-11 d)" "mc-due target present YYYY-MM-DD    as soon as you can:  mc-due target present asap"
contains "asking again that morning gives the same page" "$(said 2026-05-11)" "A new date, or as soon as you can?"
missing "no answer: quiet the next day" "$(said 2026-05-12)" "PRESENT"
missing "and six days after the question" "$(said 2026-05-17)" "PRESENT"
OUT="$(said 2026-05-18)"
contains "a week later, the gentle line" "$OUT" "WHEN YOU CAN   PRESENT: still open, as soon as you can. You aimed for 2026-05-10."
missing "which does not ask again" "$OUT" "A new date"
contains "it never becomes a deadline, a year on" "$(GODSPEED_TODAY=2027-05-10 d)" "WHEN YOU CAN   PRESENT"
contains "state names the day aimed for" "$(GODSPEED_TODAY=2026-05-18 d state --json)" '"targetDay":"2026-05-10"'
contains "as soon as you can is taken as the answer" "$(GODSPEED_TODAY=2026-05-19 d target present asap)" "Kept present open, as soon as you can"
contains "and written into the log" "$(cat "$G/due/present.md")" "you said as soon as you can, after aiming for 2026-05-10"
missing "and changes nothing else: still quiet" "$(said 2026-05-20)" "PRESENT"
contains "still weekly" "$(said 2026-05-25)" "PRESENT: still open"

# --- a day far behind you is said at once: usually the wrong year -----------------------------------
fresh
OUT="$(GODSPEED_TODAY=2026-09-30 d add taxes --title T --target 2024-12-20 --to 2025-01-31 --done-when x --cost y)"
contains "a deadline long past is still taken, and said out loud" "$OUT" "Careful: the last day, 2025-01-31, was 607 days ago."
contains "and the target too" "$OUT" "Careful: the day you would like it done, 2024-12-20, was 649 days ago."
contains "the same name twice says how to change the one there is" "$(GODSPEED_TODAY=2026-09-30 d add taxes --title T --to 2027-01-31 --done-when x --cost y)" "edit the STRIP line in due/taxes.md"
missing "a target a few days back is normal and not warned about" "$(GODSPEED_TODAY=2026-09-30 d add fence2 --title F --target 2026-09-21 --done-when x)" "Careful"

# --- a name with a history is not reused ------------------------------------------------------------
GODSPEED_TODAY=2026-09-30 d add oldtax --title T --to 2027-01-31 --done-when x --cost y >/dev/null
GODSPEED_TODAY=2026-09-30 d drop oldtax --yes >/dev/null
rm -f "$G/due/oldtax.md"
contains "a name a drop or a closing already names is refused" "$(GODSPEED_TODAY=2026-09-30 d add oldtax --title T --to 2027-01-31 --done-when x --cost y)" "was used before"

# --- a new date is the new target ------------------------------------------------------------------
fresh
GODSPEED_TODAY=2026-04-01 d add fence --title "FENCE" --target 2026-05-01 --done-when painted >/dev/null
said 2026-05-01 >/dev/null; said 2026-05-02 >/dev/null
contains "a new day before the start is refused" "$(GODSPEED_TODAY=2026-05-02 d target fence 2026-03-01)" "before the day you can start"
contains "a guessed flag gets the one right form back" "$(GODSPEED_TODAY=2026-05-02 d target fence --to 2026-06-15)" "mc-due target fence 2027-03-14"
contains "a new date becomes the target" "$(GODSPEED_TODAY=2026-05-02 d target fence 2026-06-15)" "you would like it done by 2026-06-15"
contains "kept beside the old one" "$(cat "$G/due/fence.md")" "STRIP: 2026-04-01 - target 2026-05-01 moved 2026-06-15"
missing "quiet again until then" "$(said 2026-05-09; said 2026-06-14)" "FENCE"
contains "one mention on the new day" "$(said 2026-06-15)" "FENCE: today, 2026-06-15"
contains "and the question again if it passes too" "$(said 2026-06-16)" "you aimed for 2026-06-15. A new date"
GODSPEED_TODAY=2026-06-20 d done fence >/dev/null
contains "done closes a target like anything else" "$(cat "$G"/world/events/2026-06-20-fence-closed.md)" "done (window 2026-04-01, aiming for 2026-06-15)"

# --- a target and a deadline: the deadline rules, plus the target day ------------------------------
fresh
d add tax  --title "TAX"  --from 2026-10-01 --target 2027-01-31 --to 2027-02-28 --done-when filed --cost "a fee" >/dev/null
d add twin --title "TWIN" --from 2026-10-01                     --to 2027-02-28 --done-when filed --cost "a fee" >/dev/null
step() { GODSPEED_TODAY="$2" d | grep -- "$1:" | cut -c1-15; }
for day in 2026-10-01 2026-12-15 2027-01-31 2027-02-20 2027-03-05; do
  check "on $day the step is the deadline's, target or not" "$(step TAX $day)" "$(step TWIN $day)"
done
contains "before the target it names both" "$(GODSPEED_TODAY=2026-12-15 d)" "You would like it done by 2027-01-31."
said 2027-01-28 >/dev/null
OUT="$(said 2027-01-31)"
contains "the target day is said though the step would wait" "$OUT" "TAX: today is the day you aimed for (2027-01-31). 29 days left, and the last one is 2027-02-28."
missing "while the same deadline without a target waits" "$OUT" "TWIN"
contains "after the target it says so and names the deadline" "$(GODSPEED_TODAY=2027-02-01 d)" "TAX: past the day you aimed for (2027-01-31). 28 days left, and the last one is 2027-02-28."
missing "and never asks for a new date" "$(GODSPEED_TODAY=2027-02-01 d; said 2027-02-10)" "A new date"

# --- a deadline only: exactly as before, and an old file is left as it was ----------------------------
fresh
printf '# OLDFORM\n\nTITLE: OLDFORM\nDONE-WHEN: x\nCOST-IF-MISSED: y\nSELF-CHECK: none\nSELF-CHECK-ARG: \nREPEATS: no\nLINK: \nSOURCE: you\n\n## Windows\n\nSTRIP: 2026-01-01 2026-02-01\n\n## Log\n\n- 2026-01-01 created, window 2026-01-01 to 2026-02-01\n' > "$G/due/oldform.md"
BEFORE="$(cat "$G/due/oldform.md")"
for day in 2026-01-05 2026-01-20 2026-02-03; do GODSPEED_TODAY=$day d >/dev/null; GODSPEED_TODAY=$day d check >/dev/null; GODSPEED_TODAY=$day d state --json >/dev/null; done
check "an old window file is byte for byte unchanged by list, check and state" "$(cat "$G/due/oldform.md")" "$BEFORE"
contains "and read the way it always was" "$(GODSPEED_TODAY=2026-01-20 d)" "ON THE WAY     OLDFORM: 13 days left, and the last one is 2026-02-01."
missing "with no target words" "$(GODSPEED_TODAY=2026-01-20 d; GODSPEED_TODAY=2026-01-20 d state --json)" "target"

# --- past its last day: twice more, three days apart, then quiet until you answer ---------------------
fresh
d add late --title "LATE" --from 2026-01-01 --to 2026-01-10 --done-when x --cost y >/dev/null
contains "the day after the last day it is said" "$(said 2026-01-11)" "LATE: the last day was yesterday, 2026-01-10."
missing "the next morning it is quiet" "$(said 2026-01-12)" "LATE"
contains "three days later it is said once more" "$(said 2026-01-14)" "LATE"
missing "and after that it waits for your word" "$(said 2026-01-20)" "LATE"
contains "while the full list still shows it open" "$(GODSPEED_TODAY=2026-01-20 d)" "LATE: the last day was 2026-01-10"

# --- ranking in the morning's three places -------------------------------------------------------
fresh
for n in 1 2 3; do d add "dl$n" --title "DL$n" --from 2026-01-01 --to 2026-01-10 --done-when x --cost y >/dev/null; done
d add waits --title "WAITS" --from 2026-01-01 --target 2026-01-05 --done-when x >/dev/null
missing "three running-out deadlines come before a passed target" "$(said 2026-01-09)" "WAITS"
GODSPEED_TODAY=2026-01-09 d done dl3 >/dev/null
OUT="$(said 2026-01-10)"
contains "with a place free, it gets the place" "$OUT" "WAITS: you aimed for 2026-01-05"
check "and it comes last" "$(printf '%s\n' "$OUT" | grep -v '^ ' | tail -1 | grep -c WAITS)" "1"
fresh
for n in 1 2 3; do d add "gr$n" --title "GR$n" --from 2026-01-01 --to 2027-01-01 --done-when x --cost y >/dev/null; done
d add waits2 --title "WAITS2" --from 2025-12-01 --target 2025-12-20 --done-when x >/dev/null
missing "a passed target comes after even a quiet deadline's first mention" "$(said 2026-01-02)" "WAITS2"

# --- repeating: the target keeps its place in every window -----------------------------------------
fresh
d add sheet --title "SHEET" --from 2026-01-01 --target 2026-01-20 --to 2026-01-31 --repeats monthly --done-when x --cost y >/dev/null
GODSPEED_TODAY=2026-03-15 d >/dev/null
contains "February keeps the target's place" "$(cat "$G/due/sheet.md")" "STRIP: 2026-02-01 2026-02-28 target 2026-02-20"
contains "and March too" "$(cat "$G/due/sheet.md")" "STRIP: 2026-03-01 2026-03-31 target 2026-03-20"
GODSPEED_TODAY=2026-01-05 d add bins --title "BINS" --target 2026-01-09 --repeats weekly --done-when x >/dev/null
GODSPEED_TODAY=2026-01-10 d >/dev/null
contains "a repeating target grows its next window once the target passed" "$(cat "$G/due/bins.md")" "STRIP: 2026-01-12 - target 2026-01-16"
contains "the passed one stays as soon as you can until then" "$(GODSPEED_TODAY=2026-01-10 d)" "WHEN YOU CAN   BINS"

# --- a file I cannot read needs a look, and is never done (2026-10-09) -------------------------------
# A live run: the assistant wrote a deadline by hand with lines of its own (KIND:, TARGET-DATE:) and
# no STRIP line, and the list said DONE and the notebook said closed.
U="$TMP/unreadable"; mkdir -p "$U/due" "$U/rules"; : > "$U/AGENTS.md"
cat > "$U/due/present.md" <<'HAND'
ID: present
KIND: target (not costly deadline)
TITLE: Birthday present for Priya, bought and wrapped
TARGET-DATE: 2026-10-08
SELF-CHECK: none
FINISHED-WHEN: "Bought and wrapped"
HAND
printf 'TITLE: Garbled\nSTRIP: soon later\n' > "$U/due/garbled.md"
: > "$U/due/empty.md"
printf 'TITLE: Fine\nDONE-WHEN: x\nCOST-IF-MISSED: y\nSELF-CHECK: none\n\n## Windows\n\nSTRIP: 2026-10-01 2026-12-31\n' > "$U/due/fine.md"
printf 'TITLE: Spaces\nSTRIP: 2026-10-01 2026-12-31\n' > "$U/due/With Spaces.md"
BEFORE="$(cat "$U/due/present.md")"
u() { GODSPEED_TODAY=2026-10-09 GODSPEED_ROOT="$U" node "$HERE/due.js" --godspeed "$U" "$@"; }
out="$(u)"
missing "a hand-written file with no STRIP line is never DONE" "$out" "DONE"
contains "  it needs a look, by its file name" "$out" "NEEDS A LOOK   due/present.md (Birthday present for Priya, bought and wrapped): it has no STRIP line"
contains "  and the list says how to fix it" "$out" "mc-due add present --title"
contains "a STRIP line without dates needs a look too" "$out" "due/garbled.md (Garbled): its STRIP line does not hold dates I can read"
contains "an empty file needs a look" "$out" "due/empty.md: it is empty"
contains "a file whose name cannot be used is not hidden" "$out" "due/With Spaces.md: its file name is not one I can use"
contains "the readable one reads as before" "$out" "Fine: 84 days left"
out="$(u today)"
contains "the morning's list says it too" "$out" "NEEDS A LOOK   due/present.md"
out="$(u state)"
contains "its state is needs-a-look, not closed" "$out" "NEEDS-A-LOOK present"
missing "  and nothing reads as closed" "$out" "CLOSED"
json="$(u state --json)"
contains "the notebook's rows carry the state" "$json" '"state":"needs-a-look"'
contains "  and the reason" "$json" '"problem":"it has no STRIP line, so I cannot tell its dates"'
out="$(u check)"; rc=$?
contains "the check names each file" "$out" "due/present.md needs a look"
check "  and says only files need a look (3)" "$rc" "3"
out="$(u done present)"; rc=$?
contains "saying done on it changes nothing" "$out" "needs a look"
check "  and fails" "$rc" "1"
check "the hand-written file is never rewritten" "$(cat "$U/due/present.md")" "$BEFORE"
u drop present --yes >/dev/null
out="$(u)"
contains "called off, it is quiet" "$out" "CALLED OFF"
missing "  and no longer needs a look" "$out" "due/present.md (Birthday"
check "  and the file is still not rewritten" "$(cat "$U/due/present.md")" "$BEFORE"

# --- your due/README.md: brought up to date only if you never changed it ----------------------------
KIT="$(cd "$HERE/.." && pwd)"
EMBED="$(node -e '
const s = require("fs").readFileSync(process.argv[1], "utf8");
const m = s.match(/^const README = (".*");$/m); process.stdout.write(m ? JSON.parse(m[1]) : "");' "$HERE/due.js")"
check "the README inside due.js is the kit's README, byte for byte (python embed_readme.py if not)" \
  "$EMBED" "$(tr -d '\r' < "$KIT/starter-godspeed/due/README.md")"
if git -C "$KIT" cat-file -e d6583b2 2>/dev/null; then
  git -C "$KIT" show d6583b2:starter-godspeed/due/README.md > "$G/due/README.md"
  GODSPEED_TODAY=2026-01-10 d >/dev/null
  check "an unchanged older README is brought up to date" "$(cat "$G/due/README.md")" "$(cat "$KIT/starter-godspeed/due/README.md")"
  git -C "$KIT" show d6583b2:starter-godspeed/due/README.md | sed 's/an empty one costs you nothing/an empty one costs me nothing/' > "$G/due/README.md"
  MINE="$(cat "$G/due/README.md")"
  GODSPEED_TODAY=2026-01-10 d >/dev/null
  check "a README you changed by hand is never touched" "$(cat "$G/due/README.md")" "$MINE"
  rm -f "$G/due/README.md"
else
  ok "the kit's history is not here (a shallow copy), so the README refresh is checked where it is"
fi

echo
echo "due.js: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
