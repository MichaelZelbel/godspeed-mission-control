#!/usr/bin/env bash
# The gate for mc-work: dispatched, attempted and verified stay three states; a duplicate
# trigger files nothing; a lease keeps two runners off one item; outward work never runs or
# retries on its own; a reply on a card cancels the work under it; time makes plans stale.
# Runs in a throwaway mission control root; never touches the real work/.
# Usage: bash tools/test-work.sh   (from a checkout of this kit)
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
NODE=""
for c in node nodejs /usr/local/bin/node /usr/bin/node; do
  "$c" -e '' >/dev/null 2>&1 && { NODE="$c"; break; }
done
[ -n "$NODE" ] || { echo "FAIL: no node on this box"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/rules" "$TMP/bin" "$TMP/attention"
: > "$TMP/AGENTS.md"
cp "$HERE/work.js" "$TMP/bin/"
cp "$HERE/mc-cards.js" "$TMP/bin/"
cp "$HERE/check-written.js" "$TMP/bin/"
export GODSPEED_ROOT="$TMP"
export GODSPEED_TODAY="2026-09-13"
export GODSPEED_NOW="2026-09-13T10:00:00.000Z"
hw() { "$NODE" "$TMP/bin/work.js" "$@"; }
idof() { hw list --all --json | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const x=JSON.parse(s).find(x=>x.KEY===process.argv[1]);console.log(x?x.id:"none")})' "$1"; }

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (wanted [$3], got [$2])"; fi; }
contains() { case "$2" in *"$3"*) ok "$1";; *) bad "$1 (missing [$3] in: $(printf '%s' "$2" | head -5))";; esac; }
missing()  { case "$2" in *"$3"*) bad "$1 (should not contain [$3])";; *) ok "$1";; esac; }

echo "mc-work gate"

# --- filing and duplicate triggers ---------------------------------------------------------------
OUT="$(hw file --what "Redraft the three lines" 2>&1)"; check "no done-when, no item" "$?" "1"
contains "  and says why" "$OUT" "done-when is required"
OUT="$(hw file --what "Redraft the three lines against what was refused" --done-when "a new post card exists with the lines" --key redraft-m017 --goal lead --card M017 --source test 2>&1)"
contains "an item files as planned" "$OUT" "W-20260913-01: planned"
OUT="$(hw file --what "Redraft the three lines against what was refused" --done-when "a new post card exists" --key redraft-m017 --source test 2>&1)"
contains "the same key again files nothing" "$OUT" "already on the register with this key"
check "  exit 0 so a cron that fires twice is not an error" "$?" "0"
check "  still one file" "$(ls "$TMP/work"/W-*.md | wc -l | tr -d ' ')" "1"
OUT="$(hw file --what "Put the guide on the shop shelf" --done-when "the listing is live at a public link" --outward yes --owner person --source test 2>&1)"
contains "outward work files blocked, needing authorization" "$OUT" "W-20260913-02: blocked"
contains "  and says it never runs on its own" "$OUT" "outward: never on its own"
OUT="$(hw file --what "Post to the feed" --done-when "x" --owner robot --source test 2>&1)"; check "a made-up owner is refused" "$?" "1"
OUT="$(hw file --what "Fix the cover picture" --done-when "the routing test passes" --check "test -f $TMP/cover-fixed" --key cover --source test 2>&1)"
contains "an item with a mechanical check files" "$OUT" "W-20260913-03: planned"
OUT="$(hw file --what "Read the replies on the last post" --done-when "the replies are in the log" --needs "capability:browser bridge from this machine" --source test 2>&1)"
contains "a missing capability files blocked and names it" "$OUT" "blocked (needs capability:browser bridge from this machine)"

# --- take, lease, attempt, verify: three states ----------------------------------------------------
OUT="$(hw take W-20260913-01 2>&1)"; check "take without a runner is refused" "$?" "1"
OUT="$(hw take W-20260913-01 --runner claude-laptop 2>&1)"
contains "take leases it for two hours" "$OUT" "dispatched to claude-laptop until 2026-09-13T12:00:00.000Z"
OUT="$(hw take W-20260913-01 --runner codex-x30 2>&1)"; check "a second runner is refused while the lease lives" "$?" "1"
contains "  and told who holds it" "$OUT" "held by claude-laptop until"
OUT="$(hw next 2>&1)"; missing "a leased item is not offered as next" "$OUT" "W-20260913-01"
contains "  the checked item is" "$OUT" "W-20260913-03"
OUT="$(hw attempt W-20260913-01 --runner codex-x30 --ok --result "done" 2>&1)"; check "another runner cannot report on a leased item" "$?" "1"
OUT="$(hw attempt W-20260913-01 --runner claude-laptop --ok --result "filed card M025 with the three lines" 2>&1)"
contains "an attempt is attempted, not verified" "$OUT" "attempted, not yet verified"
check "  status attempted" "$(grep -c '^STATUS: attempted' "$TMP/work/W-20260913-01.md")" "1"
check "  attempts counted" "$(grep -c '^ATTEMPTS: 1' "$TMP/work/W-20260913-01.md")" "1"
OUT="$(hw verify W-20260913-01 --evidence "done" 2>&1)"; check "the word done is not evidence for mc-owned work" "$?" "1"
OUT="$(hw verify W-20260913-01 --evidence "opened attention/M025.md, the three lines are in DRAFT" 2>&1)"
contains "evidence naming what was observed verifies" "$OUT" "verified by observation"
OUT="$(hw take W-20260913-03 --runner claude-laptop 2>&1)"
hw attempt W-20260913-03 --runner claude-laptop --ok --result "patched the router" >/dev/null
OUT="$(hw verify W-20260913-03 2>&1)"; check "a failing check keeps the runner's claim unverified (exit 2)" "$?" "2"
contains "  and says so" "$OUT" "the runner said done, the check says not; stays attempted"
check "  UNVERIFIED line recorded" "$(grep -c 'UNVERIFIED check failed' "$TMP/work/W-20260913-03.md")" "1"
touch "$TMP/cover-fixed"
OUT="$(hw verify W-20260913-03 2>&1)"
contains "  once the check passes it verifies" "$OUT" "verified by its check"

# --- failure, retries with a gap, attempts used up ------------------------------------------------------
hw file --what "Refresh the contact list" --done-when "rows 1 to 15 carry today's date" --key dream --source test >/dev/null
DREAM="$(idof dream)"
hw take "$DREAM" --runner claude-laptop >/dev/null
OUT="$(hw attempt $DREAM --runner claude-laptop --failed "browser bridge unreachable" 2>&1)"
contains "a failure schedules a retry one day later" "$OUT" "retry 2026-09-14"
OUT="$(hw take $DREAM --runner claude-laptop 2>&1)"; check "retrying before the gap is refused" "$?" "1"
contains "  a gap, not a hammer" "$OUT" "a failure gets a gap, not a hammer"
OUT="$(GODSPEED_TODAY=2026-09-14 hw next 2>&1)"; contains "on the retry day it is next again" "$OUT" "$DREAM"
GODSPEED_TODAY=2026-09-14 hw take $DREAM --runner claude-laptop >/dev/null
OUT="$(GODSPEED_TODAY=2026-09-14 hw attempt $DREAM --runner claude-laptop --failed "still unreachable" 2>&1)"
contains "the second failure waits two days" "$OUT" "retry 2026-09-16"
GODSPEED_TODAY=2026-09-16 hw take $DREAM --runner claude-laptop >/dev/null
OUT="$(GODSPEED_TODAY=2026-09-16 hw attempt $DREAM --runner claude-laptop --failed "still" 2>&1)"
missing "the third failure has no retry" "$OUT" "retry 2026"
OUT="$(GODSPEED_TODAY=2026-09-20 hw take $DREAM --runner claude-laptop 2>&1)"; check "attempts used up, a person decides" "$?" "1"
OUT="$(GODSPEED_TODAY=2026-09-20 hw tick 2>&1)"; contains "  and tick names it" "$OUT" "$DREAM: failed, attempts used up or outward; a person decides"

# --- outward: never taken without your words, never retried on its own ---------------------------------
OUT="$(hw unblock W-20260913-02 --why "approval" 2>&1)"; check "outward work is not unblocked without your words" "$?" "1"
hw unblock W-20260913-02 --why "you answered on your phone" --approved-by "same price as the other one, go" >/dev/null
OUT="$(hw take W-20260913-02 --runner claude-laptop 2>&1)"; check "taking outward work without quoting you is refused" "$?" "1"
OUT="$(hw take W-20260913-02 --runner claude-laptop --approved-by "same price as the other one, go" 2>&1)"
contains "with your words it is dispatched" "$OUT" "dispatched to claude-laptop"
check "  APPROVED holds your words" "$(grep -c '^APPROVED: 2026-09-13 "same price as the other one, go"' "$TMP/work/W-20260913-02.md")" "1"
OUT="$(hw attempt W-20260913-02 --runner claude-laptop --failed "the shop login had expired" 2>&1)"
contains "an outward failure has no retry" "$OUT" "failed (the shop login had expired)"
missing "  no retry date" "$OUT" "retry 2026"
OUT="$(GODSPEED_TODAY=2026-10-01 hw next 2>&1)"; missing "  and next never offers it" "$OUT" "W-20260913-02"

# --- tick: dead leases, stale plans, waiting on you ----------------------------------------------------
hw file --what "Mirror the results table into the summary page" --done-when "the page shows the table" --key mirror --source test >/dev/null
MIRROR="$(idof mirror)"
hw take "$MIRROR" --runner hermes-server >/dev/null
OUT="$(GODSPEED_NOW=2026-09-13T13:00:00.000Z hw tick 2>&1)"
contains "an expired lease with no attempt goes back to planned" "$OUT" "$MIRROR: lease of hermes-server expired, planned again"
OUT="$(GODSPEED_TODAY=2026-09-21 hw tick 2>&1)"
contains "a plan nothing touched for a week is stale" "$OUT" "$MIRROR: stale after 8 days"
hw file --what "Pick a price" --done-when "you named a number" --owner person --key price --source test >/dev/null
OUT="$(GODSPEED_TODAY=2026-09-28 hw tick 2>&1)"
contains "waiting on you for two weeks is named for reassessment, not repeated" "$OUT" "waiting on you for 15 days; reassess whether it is still wanted, do not ask again the same way"

# --- a reply on a card reaches the work under it --------------------------------------------------------
hw file --what "Build the picture for M017" --done-when "a picture is saved beside the card" --key visual --card M017 --source test >/dev/null
ID="$(hw list --json | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s).find(x=>x.KEY==="visual").id)})')"
# In a mission control that has one, the card ledger calls this itself when you answer a card. Here the
# call is made directly, because the rule being tested belongs to this program: an answer on a
# card closes the work that was filed under it, with your words as the reason.
OUT="$(hw sweep --card M017 --reason "you answered M017: not this one, super lame" 2>&1)"
contains "a card you answered sweeps the work under it" "$OUT" "cancelled"
check "  and the work under the card is cancelled" "$(grep -c '^STATUS: cancelled' "$TMP/work/$ID.md")" "1"
check "  with your words as the reason" "$(grep -c 'CANCELLED you answered M017: not this one' "$TMP/work/$ID.md")" "1"

# --- a learn item is done when the answer is written somewhere a reader can open ------------------------
OUT="$(hw file --learn "Which three tools do readers actually install first" --source test 2>&1)"; check "a learn item with no file to write into is refused" "$?" "1"
contains "  and says why" "$OUT" "a learn item is done when the answer is written somewhere a reader can open"
OUT="$(hw file --learn "Which three tools do readers actually install first" --path research/first-tools.md --key first-tools --source test 2>&1)"
contains "a learn item with a path files as planned" "$OUT" ": planned"
LEARN="$(idof first-tools)"
check "  KIND learn" "$(grep -c '^KIND: learn' "$TMP/work/$LEARN.md")" "1"
check "  WHAT is the question" "$(grep -c '^WHAT: Which three tools do readers actually install first' "$TMP/work/$LEARN.md")" "1"
check "  DONE WHEN carries the path" "$(grep -c '^DONE WHEN: the answer to "Which three tools do readers actually install first" is written in research/first-tools.md, with the evidence read' "$TMP/work/$LEARN.md")" "1"
OUT="$(hw file --what "Count the tools" --done-when "a number" --kind nonsense --source test 2>&1)"; check "a made-up kind is refused" "$?" "1"
OUT="$(hw file --what "Count the tools" --done-when "the count is in research/tool-count.csv" --kind learn --key tool-count --source test 2>&1)"
contains "--kind learn with a DONE WHEN that names a file files" "$OUT" ": planned"
OUT="$(hw list 2>&1)"
contains "list shows the kind" "$OUT" "planned    learn $LEARN"
contains "  and do for an item filed before there was a kind" "$OUT" "failed     do    W-20260913-02"
OUT="$(hw next --json 2>&1)"; contains "next carries KIND in JSON" "$OUT" "\"KIND\":\"learn\""
# The point of a learn item: "we found out X" in the runner's report closes nothing; the file does,
# and mc-check-written is the check that is not the runner.
hw file --learn "How many readers reach chapter 5" --path research/chapter-5.md --key ch5 --check "$NODE $TMP/bin/check-written.js research/chapter-5.md --min-words 5" --source test >/dev/null
CH5="$(idof ch5)"
hw take "$CH5" --runner claude-laptop >/dev/null
hw attempt "$CH5" --runner claude-laptop --ok --result "we found out it is about forty percent" >/dev/null
OUT="$(hw verify $CH5 2>&1)"; check "a learn item whose answer was only reported stays attempted" "$?" "2"
mkdir -p "$TMP/research"; printf '## Answer\nAbout forty percent of readers reach chapter 5, from the reading log.\n' > "$TMP/research/chapter-5.md"
OUT="$(hw verify $CH5 2>&1)"; contains "  once the answer is written where it was promised, it verifies" "$OUT" "verified by its check"

# --- sweep by goal, check ---------------------------------------------------------------------------
hw file --what "Write the chapter" --done-when "chapter in the manuscript" --key chapter --goal book --source test >/dev/null
OUT="$(hw sweep --goal book --stale --reason "book deadline moved" 2>&1)"
contains "a goal sweep marks stale" "$OUT" "marked stale"
OUT="$(hw sweep --goal book --cancel --reason "book retired" 2>&1)"
contains "  or cancels" "$OUT" "cancelled"
OUT="$(hw check 2>&1)"; check "check passes on a clean register" "$?" "0"
sed -i '/^KIND: /d' "$TMP/work/W-20260913-03.md"
OUT="$(hw check 2>&1)"; check "an old card with no KIND is read as do, not a problem" "$?" "0"
sed -i 's/^KIND: do$/KIND: ponder/' "$TMP/work/W-20260913-02.md"
OUT="$(hw check 2>&1)"; check "a KIND that is neither do nor learn is a problem" "$?" "1"
contains "  and named" "$OUT" "PROBLEM W-20260913-02: KIND ponder"
sed -i 's/^KIND: ponder$/KIND: do/' "$TMP/work/W-20260913-02.md"
sed -i 's/^STATUS: verified/STATUS: verified/; s/^OUTWARD: no/OUTWARD: yes/' "$TMP/work/W-20260913-01.md"
OUT="$(hw check 2>&1)"; check "check fails on outward work moved without approval" "$?" "1"

# --- link: the page a finished piece became --------------------------------------------------------------
OUT="$(hw link W-20260913-01 --url "lead/drafts/x.md" 2>&1)"; check "a link that is not https is refused" "$?" "1"
OUT="$(hw link W-20260913-01 --url "https://example.org/p/x.html" 2>&1)"
contains "an https link is recorded" "$OUT" "link recorded"
check "  LINK on the item" "$(grep -c '^LINK: https://example.org/p/x.html' "$TMP/work/W-20260913-01.md")" "1"
check "  and a PUBLISHED line" "$(grep -c 'PUBLISHED https://example.org/p/x.html' "$TMP/work/W-20260913-01.md")" "1"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
