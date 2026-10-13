#!/usr/bin/env bash
# The gate for mc-work: dispatched, attempted and verified stay three states; a duplicate
# trigger files nothing; a lease keeps two runners off one item; outward work never runs or
# retries on its own; a reply on a card cancels the work under it; time makes plans stale.
# Runs in a throwaway godspeed root; never touches the real work/.
# Usage: bash tools/test-work.sh   (from a checkout of this kit)
set -uo pipefail
. "$(dirname "$0")/test-guard.bash"

HERE="$(cd "$(dirname "$0")" && pwd)"
NODE=""
for c in node nodejs /usr/local/bin/node /usr/bin/node; do
  "$c" -e '' >/dev/null 2>&1 && { NODE="$c"; break; }
done
[ -n "$NODE" ] || { echo "FAIL: no node on this box"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP" "$TEST_GUARD_HOME"' EXIT
mkdir -p "$TMP/rules" "$TMP/bin"
: > "$TMP/AGENTS.md"
cp "$HERE/work.js" "$TMP/bin/"
cp "$HERE/goals.js" "$TMP/bin/"
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
OUT="$(hw next 2>&1)"; missing "outward work you have not approved is never offered to the runner" "$OUT" "W-20260913-02"
hw unblock W-20260913-02 --why "you answered on your phone" --approved-by "same price as the other one, go" >/dev/null
OUT="$(hw next 2>&1)"; contains "once your words are on it, the runner is offered it" "$OUT" "W-20260913-02"
OUT="$(hw take W-20260913-02 --runner claude-laptop 2>&1)"
contains "and takes it without quoting you a second time" "$OUT" "dispatched to claude-laptop"
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

# --- steps that go out unless stopped ----------------------------------------------------------
# GOES OUT is UTC and is compared with GODSPEED_NOW; this file's clock stands at 2026-09-13T10:00Z.
mkdir -p "$TMP/goals"
cat > "$TMP/goals/aud.md" <<'EOF'
ID: aud
KIND: outcome
STATUS: adopted
TITLE: Audience

MAY: yt-replies | reply to comments on my YouTube videos | 2 per week | notice | "yes, answer comments" 2026-09-10
MAY: own-pages | fix wording on my own sites | 5 per week | alone | "fix my pages yourself" 2026-09-10

## Log
- 2026-09-10 FILED adopted outcome, source: x
EOF
OUT="$(hw file --what "Reply to the question under video 12" --done-when "reply visible" --goal aud --outward yes --may yt-replies --check "test -f live.txt" --goes-out 2026-09-13T18:00 --key r1 --source t 2>&1)"
contains "a step under a notice permission files planned" "$OUT" "planned"
ID1="$(printf '%s' "$OUT" | grep -o 'W-[0-9]*-[0-9]*' | head -1)"
check "  with GOES OUT" "$(grep -c '^GOES OUT: 2026-09-13T18:00' "$TMP/work/$ID1.md")" "1"
check "  and his words as its approval" "$(grep -c '^APPROVED: standing yt-replies: "yes, answer comments"' "$TMP/work/$ID1.md")" "1"
missing "next skips it before its time" "$(GODSPEED_NOW=2026-09-13T17:59:00Z hw next 2>&1)" "$ID1"
hw announce "$ID1" >/dev/null 2>&1   # the morning message showed it
contains "next offers it after its time" "$(GODSPEED_NOW=2026-09-13T18:01:00Z hw next 2>&1)" "$ID1"
OUT="$(hw file --what "Reply two" --done-when x --goal aud --outward yes --may yt-replies --check "test -f live.txt" --key r2 --source t 2>&1)"
OUT="$(hw file --what "Reply three" --done-when x --goal aud --outward yes --may yt-replies --check "test -f live.txt" --key r3 --source t 2>&1)"
contains "past the weekly limit it needs a fresh yes" "$OUT" "blocked"
OUT="$(hw file --what "Post" --done-when x --goal aud --outward yes --may linkedin-posts --check "test -f live.txt" --key r4 --source t 2>&1)"; check "a kind the goal does not have is refused" "$?" "1"
contains "  and names the goal's kinds" "$OUT" "yt-replies, own-pages"
OUT="$(hw file --what "Fix my homepage typo" --done-when x --goal aud --outward yes --may own-pages --check "test -f live.txt" --key p1 --source t 2>&1)"
IDP="$(printf '%s' "$OUT" | grep -o 'W-[0-9]*-[0-9]*' | head -1)"
contains "an alone-mode step is runnable at once" "$(hw next 2>&1)" "$IDP"
GO="$(hw going-out --date 2026-09-13 2>&1)"
contains "going-out lists today's notice steps" "$GO" "1. Reply to the question under video 12"
OUT="$(hw stop "$ID1" --words "not that one" 2>&1)"
check "stop cancels it" "$(grep -c '^STATUS: cancelled' "$TMP/work/$ID1.md")" "1"
check "  with his words" "$(grep -c 'STOPPED "not that one"' "$TMP/work/$ID1.md")" "1"
OUT="$(hw take "$ID1" --runner test 2>&1)"; check "a stopped step can never be taken" "$?" "1"

st() { for i in "$@"; do sed -n 's/^STATUS: //p' "$TMP/work/$i.md"; done | tr '\n' ' '; }
ID2="$(idof r2)"; ID3="$(idof r3)"
check "a notice step given no time goes out at 18:00 UTC on the day it was filed" "$(sed -n 's/^GOES OUT: //p' "$TMP/work/$ID2.md")" "2026-09-13T18:00"
hw stop "$ID2" --words "test cleanup" >/dev/null 2>&1   # never shown: it would roll into later days
check "an alone step has no GOES OUT" "$(grep -c '^GOES OUT:' "$TMP/work/$IDP.md")" "0"
check "  and carries his words as its approval too" "$(grep -c '^APPROVED: standing own-pages: "fix my pages yourself"' "$TMP/work/$IDP.md")" "1"
check "the step past the weekly limit needs authorization" "$(sed -n 's/^NEEDS: //p' "$TMP/work/$ID3.md")" "authorization"
check "  with no standing approval and no time on it" "$(grep -c -e '^APPROVED:' -e '^GOES OUT:' "$TMP/work/$ID3.md")" "0"
check "  and its log says the week's limit is used" "$(grep -c "BLOCKED this week's 2 yt-replies steps are used; this one needs a fresh yes" "$TMP/work/$ID3.md")" "1"
missing "  next never offers it, even after the hour" "$(GODSPEED_NOW=2026-09-13T19:00:00Z hw next 2>&1)" "$ID3"
OUT="$(GODSPEED_NOW=2026-09-13T19:00:00Z hw take "$ID3" --runner test 2>&1)"; check "  nor can it be taken without a fresh yes" "$?" "1"
OUT="$(hw file --what "Reply in a new week" --done-when x --goal aud --outward yes --may yt-replies --check "test -f live.txt" --key r5 --source t --date 2026-09-20 2>&1)"
contains "seven days on, the limit counts again from zero" "$OUT" "planned"
hw stop "$(idof r5)" --words "test cleanup" >/dev/null 2>&1   # never shown: it would roll into later days
sed -i 's/$/\r/' "$TMP/goals/aud.md"
OUT="$(hw file --what "Fix the footer" --done-when x --goal aud --outward yes --may own-pages --check "test -f live.txt" --key p2 --source t 2>&1)"
contains "a goal card with Windows line endings is read the same" "$OUT" "planned"

cat > "$TMP/goals/news.md" <<'EOF'
ID: news
KIND: outcome
STATUS: adopted
TITLE: Newsletter readers

MAY: nl-replies | answer replies to my newsletter | 10 per week | notice | "answer them for me" 2026-09-10

## Log
- 2026-09-10 FILED adopted outcome, source: x
EOF
nf() { local w="$1" k="$2"; shift 2; hw file --what "$w" --done-when "the reply is visible" --goal news --outward yes --may nl-replies --check "test -f live.txt" --key "$k" --source t "$@" 2>&1; }
OUT="$(nf "Answer A" n0 --goes-out "2026-09-14 18:00")"; check "a GOES OUT not written YYYY-MM-DDTHH:MM is refused" "$?" "1"
contains "  and says it is UTC" "$OUT" "UTC"
OUT="$(nf "Answer A" n0 --goes-out 2026-09-13T09:59)"; check "a GOES OUT already past is refused" "$?" "1"
contains "  it must leave time to stop it" "$OUT" "time to stop it"
OUT="$(hw file --what "Answer A" --done-when x --goal news --may nl-replies --check "test -f live.txt" --key n0 --source t 2>&1)"; check "--may on inward work is refused" "$?" "1"
OUT="$(hw file --what "Answer A" --done-when x --outward yes --may nl-replies --check "test -f live.txt" --key n0 --source t 2>&1)"; check "--may without a goal is refused" "$?" "1"
OUT="$(hw file --what "Answer A" --done-when x --goal nowhere --outward yes --may nl-replies --check "test -f live.txt" --key n0 --source t 2>&1)"; check "--may for a goal that is not there is refused" "$?" "1"
# Every step that goes out without a yes each time is checked live after it lands (2026-10-13).
OUT="$(hw file --what "Answer A" --done-when x --goal news --outward yes --may nl-replies --key n0 --source t 2>&1)"; check "--may without a live check is refused" "$?" "1"
contains "  and says why" "$OUT" "checked live"
check "  and files nothing" "$(grep -l '^KEY: n0$' "$TMP/work"/*.md 2>/dev/null | wc -l | tr -d ' ')" "0"
OUT="$(hw file --what "Answer A" --done-when x --goal news --outward yes --may nl-replies --check --key n0 --source t 2>&1)"; check "  a bare --check, which checks nothing, is refused too" "$?" "1"
OUT="$(GODSPEED_NOW=2026-09-13T18:30:00Z nf "Answer late" n1)"
N1="$(idof n1)"
check "filed after 18:00 UTC, it goes out at 18:00 UTC the next day" "$(sed -n 's/^GOES OUT: //p' "$TMP/work/$N1.md")" "2026-09-14T18:00"
hw stop "$N1" --words "test cleanup" >/dev/null 2>&1   # never shown: it would roll into later days

# Review focus 1: a step stopped one minute before its time never goes out.
nf "Answer B" n2 --goes-out 2026-09-15T18:00 >/dev/null
N2="$(idof n2)"
OUT="$(GODSPEED_TODAY=2026-09-15 GODSPEED_NOW=2026-09-15T17:59:00Z hw stop "$N2" --words "hold that one back" 2>&1)"
contains "a step stopped a minute before its time is stopped" "$OUT" "$N2: stopped"
check "  it is cancelled" "$(st "$N2")" "cancelled "
check "  with his words on it" "$(grep -c '^- 2026-09-15 STOPPED "hold that one back"' "$TMP/work/$N2.md")" "1"
missing "  after its time next never offers it" "$(GODSPEED_TODAY=2026-09-15 GODSPEED_NOW=2026-09-15T18:01:00Z hw next 2>&1)" "$N2"
OUT="$(GODSPEED_TODAY=2026-09-15 GODSPEED_NOW=2026-09-15T18:01:00Z hw take "$N2" --runner test 2>&1)"; check "  nor can it be taken" "$?" "1"
OUT="$(GODSPEED_TODAY=2026-09-15 GODSPEED_NOW=2026-09-15T18:01:00Z hw stop "$N2" --words "again" 2>&1)"; check "stopping it twice is no error" "$?" "0"
contains "  and says so" "$OUT" "already stopped"
nf "Answer C" n3 --goes-out 2026-09-15T19:00 >/dev/null
N3="$(idof n3)"
OUT="$(GODSPEED_TODAY=2026-09-15 GODSPEED_NOW=2026-09-15T18:30:00Z hw take "$N3" --runner test 2>&1)"; check "a step is not taken before its time" "$?" "1"
contains "  and says when it goes" "$OUT" "goes out at 2026-09-15T19:00 UTC unless stopped"
hw stop "$N3" --words "test cleanup" >/dev/null 2>&1   # never shown: it would roll into later days

# Review focus 2: stop --today stops every step of the day that has not gone out; stop <id> stops one.
nf "Morning answer" n4 --goes-out 2026-09-16T09:00 >/dev/null
nf "Answer one" n5 --goes-out 2026-09-16T18:00 >/dev/null
nf "Answer two" n6 --goes-out 2026-09-16T19:00 >/dev/null
nf "Answer three" n7 --goes-out 2026-09-16T20:00 >/dev/null
nf "Answer for tomorrow" n8 --goes-out 2026-09-17T18:00 >/dev/null
N4="$(idof n4)"; N5="$(idof n5)"; N6="$(idof n6)"; N7="$(idof n7)"; N8="$(idof n8)"
D16() { GODSPEED_TODAY=2026-09-16 GODSPEED_NOW="2026-09-16T$1:00Z" hw "${@:2}"; }
GO="$(D16 05:00 going-out 2>&1)"
check "going-out numbers the day's steps in time order" "$(printf '%s\n' "$GO" | cut -d' ' -f1-3 | tr '\n' '|')" "1. Morning answer|2. Answer one|3. Answer two|4. Answer three|"
missing "  and leaves out the next day's" "$GO" "tomorrow"
contains "  with the time in UTC" "$GO" "(news, 18:00 UTC)"
D16 05:20 announce "$N4" "$N5" "$N6" "$N7" >/dev/null 2>&1   # the morning message showed them
D16 09:05 take "$N4" --runner test >/dev/null 2>&1
D16 09:06 attempt "$N4" --runner test --ok --result "replied, https://example.org/r" >/dev/null 2>&1
check "(the morning step went out)" "$(st "$N4")" "attempted "
GO="$(D16 12:00 going-out 2>&1)"
missing "a step that went out leaves the list" "$GO" "Morning answer"
contains "  and the others keep their numbers, so stop 2 still means the second" "$GO" "2. Answer one"
OUT="$(D16 12:00 stop "$N6" --words "stop 3" 2>&1)"
check "stop <id> stops that step" "$(st "$N6")" "cancelled "
check "  and only that one" "$(st "$N5" "$N7" "$N8")" "planned planned planned "
GO="$(D16 12:00 going-out 2>&1)"
contains "  the list keeps its numbers" "$GO" "4. Answer three"
missing "  without the stopped step" "$GO" "Answer two"
J="$(D16 12:00 going-out --json 2>&1)"
check "going-out --json carries number, id and UTC time" "$(printf '%s' "$J" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s).map(r=>r.n+":"+r.id+":"+r.at).join(","))})')" "2:$N5:2026-09-16T18:00,4:$N7:2026-09-16T20:00"
OUT="$(D16 12:00 stop --today --words "stop" 2>&1)"
check "stop --today stops every step of the day not yet gone out" "$(st "$N5" "$N7")" "cancelled cancelled "
check "  with his words on each" "$(cat "$TMP/work/$N5.md" "$TMP/work/$N7.md" | grep -c '^- 2026-09-16 STOPPED "stop"')" "2"
check "  leaves the one that already went out" "$(st "$N4")" "attempted "
check "  and the next day's" "$(st "$N8")" "planned "
check "  going-out is then empty" "$(D16 12:00 going-out --json 2>&1)" "[]"
OUT="$(D16 12:00 stop "$N4" --words "too late" 2>&1)"; check "a step that went out cannot be stopped" "$?" "1"
contains "  and says so" "$OUT" "already went out"
OUT="$(D16 12:00 stop --today --words "stop" 2>&1)"; check "stop --today with nothing waiting is no error" "$?" "0"
contains "  and says nothing is waiting" "$OUT" "nothing is waiting to go out on 2026-09-16"
OUT="$(hw stop "$N8" 2>&1)"; check "stop without his words is refused" "$?" "1"

# A permission taken back stops what was queued under it from going out.
"$NODE" "$TMP/bin/goals.js" allow news --kind nl-replies --revoke --words "stop answering for me" >/dev/null 2>&1
check "(the permission is off the goal card)" "$(grep -c '^MAY: nl-replies' "$TMP/goals/news.md")" "0"
D17() { GODSPEED_TODAY=2026-09-17 GODSPEED_NOW="2026-09-17T$1:00Z" hw "${@:2}"; }
missing "a step whose permission was taken back is never offered" "$(D17 18:05 next 2>&1)" "$N8"
OUT="$(D17 18:05 take "$N8" --runner test 2>&1)"; check "  nor taken" "$?" "1"
contains "  and says it needs a fresh yes" "$OUT" "fresh yes"
contains "check names it as a problem" "$(D17 18:05 check 2>&1)" "PROBLEM $N8: its standing permission nl-replies is no longer on news"
OUT="$(D17 18:05 tick 2>&1)"
check "tick sets it to wait for a fresh yes" "$(st "$N8")$(sed -n 's/^NEEDS: //p' "$TMP/work/$N8.md")" "blocked authorization"
contains "  and says why" "$OUT" "$N8: the standing permission nl-replies is no longer on news"
missing "  after which check has no problem with it" "$(D17 18:05 check 2>&1)" "PROBLEM $N8"
OUT="$(D17 18:06 unblock "$N8" --why "he said yes" --approved-by "go on, send it" 2>&1)"
contains "  a fresh yes lets it go" "$(D17 18:06 next 2>&1)" "$N8"

# stop --today names a step that is going out right now (news's permission is gone, so aud's is used)
af() { local w="$1" k="$2"; shift 2; hw file --what "$w" --done-when "the reply is visible" --goal aud --outward yes --may yt-replies --check "test -f live.txt" --key "$k" --source t "$@" 2>&1; }
af "Early answer" n9 --goes-out 2026-09-18T09:00 >/dev/null
af "Evening answer" n10 --goes-out 2026-09-18T18:00 >/dev/null
N9="$(idof n9)"; N10="$(idof n10)"
D18() { GODSPEED_TODAY=2026-09-18 GODSPEED_NOW="2026-09-18T$1:00Z" hw "${@:2}"; }
D18 05:20 announce "$N9" "$N10" >/dev/null 2>&1
D18 09:05 take "$N9" --runner test >/dev/null 2>&1
OUT="$(D18 09:10 stop --today --words "stop" 2>&1)"
contains "stop --today names a step that is going out right now" "$OUT" "$N9 is going out right now"
check "  and leaves it going" "$(st "$N9")" "dispatched "
check "  while it stops the rest of the day" "$(st "$N10")" "cancelled "
D18 09:12 attempt "$N9" --runner test --ok --result "replied, https://example.org/r9" >/dev/null 2>&1

# A GOES OUT edited by hand out of its form is never due (review of unit C, 2026-10-13).
cat > "$TMP/goals/re.md" <<'EOF'
ID: re
KIND: outcome
STATUS: adopted
TITLE: Forum

## Log
- 2026-09-10 FILED adopted outcome, source: x
EOF
hgr() { "$NODE" "$TMP/bin/goals.js" "$@"; }
hgr allow re --kind forum-replies --what "answer replies on my forum thread" --per-week 5 --words "answer them" >/dev/null 2>&1
rf() { local w="$1" k="$2"; shift 2; hw file --what "$w" --done-when "the reply is visible" --goal re --outward yes --may forum-replies --check "test -f live.txt" --key "$k" --source t "$@" 2>&1; }
rf "Hand-edited time" m1 --goes-out 2026-09-13T18:00 >/dev/null
M1="$(idof m1)"
sed -i 's/^GOES OUT: .*/GOES OUT: 2026-09-13 18:00/' "$TMP/work/$M1.md"
missing "a GOES OUT out of its form is never due for next" "$(GODSPEED_NOW=2026-09-14T09:00:00Z hw next 2>&1)" "$M1"
OUT="$(GODSPEED_NOW=2026-09-14T09:00:00Z hw take "$M1" --runner test 2>&1)"; check "  nor for take" "$?" "1"
contains "  which says what is wrong" "$OUT" "not YYYY-MM-DDTHH:MM"
OUT="$(GODSPEED_NOW=2026-09-14T09:00:00Z hw take "$M1" --runner test --now 2>&1)"; check "  not even with --now" "$?" "1"
contains "  and check names it" "$(hw check 2>&1)" "PROBLEM $M1: GOES OUT 2026-09-13 18:00 is not YYYY-MM-DDTHH:MM (UTC)"
missing "  and it is not listed as going out" "$(hw going-out --date 2026-09-13 2>&1)" "Hand-edited time"
hw stop "$M1" --words "test cleanup" >/dev/null 2>&1

# A permission taken back and given again in new words: what was queued under the old words
# does not go out under the new ones (review of unit C, 2026-10-13).
rf "Answer under the old words" m2 --goes-out 2026-09-13T18:00 >/dev/null
M2="$(idof m2)"
hgr allow re --kind forum-replies --revoke --words "stop that" >/dev/null 2>&1
hgr allow re --kind forum-replies --what "answer replies on my forum thread" --per-week 5 --words "answer them, but only the kind ones" >/dev/null 2>&1
check "(the permission is back, in new words)" "$(grep -c '^MAY: forum-replies .*"answer them, but only the kind ones"' "$TMP/goals/re.md")" "1"
missing "a step queued under the old words does not go out under the new ones" "$(GODSPEED_NOW=2026-09-13T18:05:00Z hw next 2>&1)" "$M2"
OUT="$(GODSPEED_NOW=2026-09-13T18:05:00Z hw take "$M2" --runner test 2>&1)"; check "  nor can it be taken" "$?" "1"
contains "  it needs a fresh yes" "$OUT" "fresh yes"
GODSPEED_NOW=2026-09-13T18:05:00Z hw tick >/dev/null 2>&1
check "  tick sets it to wait for that fresh yes" "$(st "$M2")$(sed -n 's/^NEEDS: //p' "$TMP/work/$M2.md")" "blocked authorization"
rf "Answer under the new words" m3 --goes-out 2026-09-13T18:00 >/dev/null
M3="$(idof m3)"
hw announce "$M3" >/dev/null 2>&1
contains "  while a step filed under the new words goes" "$(GODSPEED_NOW=2026-09-13T18:05:00Z hw next 2>&1)" "$M3"
hgr allow re --kind forum-replies --revoke --words "stop" --date 2026-09-14 >/dev/null 2>&1
hgr allow re --kind forum-replies --what "answer replies on my forum thread" --per-week 5 --words "answer them, but only the kind ones" --date 2026-09-14 >/dev/null 2>&1
missing "given again in the same words on a later day, a step queued before it does not go out" "$(GODSPEED_TODAY=2026-09-14 GODSPEED_NOW=2026-09-14T18:05:00Z hw next 2>&1)" "$M3"

# --- a step goes out only after the morning message showed it (Rulings 19 and 21, 2026-10-13) ----
# The person can stop only what they saw: a step filed after the morning message waits a day.
cat > "$TMP/goals/eve.md" <<'EOF'
ID: eve
KIND: outcome
STATUS: adopted
TITLE: Evening

MAY: eve-replies | answer replies under my posts | 20 per week | notice | "answer them" 2026-09-20

## Log
- 2026-09-20 FILED adopted outcome, source: x
EOF
D21() { GODSPEED_TODAY=2026-09-21 GODSPEED_NOW="2026-09-21T$1:00Z" hw "${@:2}"; }
D22() { GODSPEED_TODAY=2026-09-22 GODSPEED_NOW="2026-09-22T$1:00Z" hw "${@:2}"; }
ef() { local t="$1" w="$2" k="$3"; shift 3; GODSPEED_TODAY=2026-09-21 GODSPEED_NOW="2026-09-21T$t:00Z" hw file --what "$w" --done-when "the reply is visible" --goal eve --outward yes --may eve-replies --check "test -f live.txt" --key "$k" --source t "$@" 2>&1; }
gf() { "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s).map(r=>r.n+":"+r.announced).join(","))})'; }
ef 04:10 "Shown reply" e1 >/dev/null
ef 04:10 "Shown late reply" e2 --goes-out 2026-09-21T19:00 >/dev/null
E1="$(idof e1)"; E2="$(idof e2)"
check "going-out --json says a step was not shown yet" "$(D21 05:15 going-out --json | gf)" "1:,2:"
contains "  and the text marks it" "$(D21 05:15 going-out 2>&1)" "not shown in a morning message yet"
OUT="$(D21 05:16 announce "$E1" "$E2" 2>&1)"; check "announce marks the steps the morning message showed" "$?" "0"
check "  ANNOUNCED on each" "$(grep -h '^ANNOUNCED:' "$TMP/work/$E1.md" "$TMP/work/$E2.md" | tr '\n' ' ')" "ANNOUNCED: 2026-09-21 ANNOUNCED: 2026-09-21 "
check "  with a line in the log" "$(grep -c '^- 2026-09-21 ANNOUNCED in the morning message' "$TMP/work/$E1.md")" "1"
check "  going-out --json carries the date" "$(D21 05:17 going-out --json | gf)" "1:2026-09-21,2:2026-09-21"
missing "  and the text no longer marks them" "$(D21 05:17 going-out 2>&1)" "not shown"
ef 09:00 "Unshown reply" e3 --goes-out 2026-09-21T18:00 >/dev/null
E3="$(idof e3)"
GO="$(D21 09:05 going-out 2>&1)"
check "a step filed after the morning message comes after the shown ones, so their numbers hold" "$(printf '%s\n' "$GO" | cut -d' ' -f1-3 | tr '\n' '|')" "1. Shown reply|2. Shown late|3. Unshown reply|"
contains "  and is marked as not shown" "$(printf '%s\n' "$GO" | grep 'Unshown')" "not shown in a morning message yet"
missing "before 18:00 the shown step waits" "$(D21 17:59 next 2>&1)" "$E1"
OUT="$(D21 18:01 take "$E3" --runner test 2>&1)"; check "at 18:01 the step nobody was shown cannot be taken" "$?" "1"
contains "  and says why" "$OUT" "has not been shown"
OUT="$(D21 18:01 take "$E3" --runner test --now 2>&1)"; check "  not even with --now" "$?" "1"
OUT="$(D21 18:01 next 2>&1)"
contains "after 18:00 the shown step is due" "$OUT" "$E1"
missing "  the step nobody was shown is not" "$OUT" "$E3"
check "  it moved to the next day's 18:00 UTC" "$(sed -n 's/^GOES OUT: //p' "$TMP/work/$E3.md")" "2026-09-22T18:00"
check "  saying so in its log" "$(grep -c '^- 2026-09-21 NOT SHOWN: goes out 2026-09-22T18:00 instead' "$TMP/work/$E3.md")" "1"
check "  and it is still not marked shown" "$(grep -c '^ANNOUNCED:' "$TMP/work/$E3.md")" "0"
missing "  it left the evening's list" "$(D21 18:02 going-out 2>&1)" "Unshown reply"
contains "the next morning it is in that day's list" "$(D22 05:15 going-out 2>&1)" "1. Unshown reply"
D22 05:16 announce "$E3" >/dev/null 2>&1
missing "  shown, it still waits for 18:00" "$(D22 17:59 next 2>&1)" "$E3"
contains "  and goes after it" "$(D22 18:01 next 2>&1)" "$E3"
ef 09:30 "Missed by everyone" e4 --goes-out 2026-09-21T20:00 >/dev/null
E4="$(idof e4)"
OUT="$(D21 20:05 tick 2>&1)"
contains "tick moves a step that passed its time unshown" "$OUT" "$E4: not shown in a morning message, so it goes out at 2026-09-22T18:00 instead"
check "  to the next day's 18:00 UTC" "$(sed -n 's/^GOES OUT: //p' "$TMP/work/$E4.md")" "2026-09-22T18:00"
OUT="$(D21 18:10 announce "$E1" W-19990101-01 "$N2" "$IDP" 2>&1)"; check "announce with an id it cannot mark exits 1" "$?" "1"
contains "  names an id that is not on the register" "$OUT" "W-19990101-01: no such work, not marked"
contains "  names a closed one" "$OUT" "$N2: is cancelled, not marked"
contains "  names one that goes out alone, with no GOES OUT" "$OUT" "$IDP: has no GOES OUT"
contains "  and still marks the one it can" "$OUT" "$E1: shown"
OUT="$(hw announce 2>&1)"; check "announce with no id is refused" "$?" "1"

# --- a strategy's steps go out under its outcome's MAY lines (final review I6, 2026-10-13) --------
# A strategy or project with no MAY lines of its own uses those of the first outcome on its SERVES
# line that has some, one level up; the weekly limit is the outcome's, shared with its own steps.
cat > "$TMP/goals/out6.md" <<'EOF'
ID: out6
KIND: outcome
STATUS: adopted
TITLE: Kit sales

MAY: page-fixes | fix wording on my own kit pages | 3 per week | alone | "fix them yourself" 2026-09-10

## Log
- 2026-09-10 FILED adopted outcome, source: x
EOF
printf 'ID: str6\nKIND: strategy\nSTATUS: adopted\nTITLE: Kit pages\nSERVES: out6\n\n## Log\n' > "$TMP/goals/str6.md"
printf 'ID: own6\nKIND: strategy\nSTATUS: adopted\nTITLE: Videos\nSERVES: out6\n\nMAY: shorts | cut shorts from my videos | 3 per week | alone | "cut them" 2026-09-10\n\n## Log\n' > "$TMP/goals/own6.md"
printf 'ID: prj6\nKIND: project\nSTATUS: adopted\nTITLE: One page\nSERVES: str6\n\n## Log\n' > "$TMP/goals/prj6.md"
sf() { local g="$1" k="$2"; shift 2; hw file --what "Fix a line for $g ($k)" --done-when "the page reads right" --goal "$g" --outward yes --may page-fixes --check "test -f live.txt" --key "$k" --source t "$@" 2>&1; }
OUT="$(sf str6 s1)"
contains "a strategy's step under its outcome's MAY line files planned" "$OUT" "planned"
contains "  and says whose permission it uses" "$OUT" "standing page-fixes of out6"
S1="$(idof s1)"
check "  its APPROVED quotes the outcome's words" "$(grep -c '^APPROVED: standing page-fixes: "fix them yourself"' "$TMP/work/$S1.md")" "1"
contains "  next offers it (alone: when ready)" "$(hw next 2>&1)" "$S1"
OUT="$(hw take "$S1" --runner test 2>&1)"; check "  and take takes it on the outcome's permission" "$?" "0"
contains "mc-goals may names the outcome a strategy's permissions come from" "$("$NODE" "$TMP/bin/goals.js" may str6 2>&1)" "its steps go out under those of out6"
check "  and --json says from: out6" "$("$NODE" "$TMP/bin/goals.js" may str6 --json 2>&1 | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{console.log(JSON.parse(s).map(m=>m.kind+":"+m.from).join(","))})')" "page-fixes:out6"
OUT="$(sf out6 s2)"; contains "the outcome's own step counts toward the same three" "$OUT" "planned"
OUT="$(sf str6 s3)"; contains "  and so does the strategy's next one" "$OUT" "planned"
OUT="$(sf str6 s4)"
contains "the weekly limit is the outcome's, shared with the strategy's steps" "$OUT" "this week's 3 page-fixes steps of out6 are used"
check "  so the fourth waits for a fresh yes" "$(st "$(idof s4)")" "blocked "
OUT="$(sf own6 s5)"; check "a strategy with MAY lines of its own uses only those" "$?" "1"
contains "  and names its own kinds" "$OUT" "its kinds are: shorts"
OUT="$(sf prj6 s6)"; check "a project serving a strategy does not reach the outcome above it (one level)" "$?" "1"
"$NODE" "$TMP/bin/goals.js" allow out6 --kind page-fixes --revoke --words "stop fixing my pages" >/dev/null 2>&1
S3="$(idof s3)"
missing "with the outcome's line taken back, a strategy's queued step is not offered" "$(hw next 2>&1)" "$S3"
OUT="$(hw tick 2>&1)"
contains "  and tick sets it to wait for a fresh yes" "$OUT" "$S3: the standing permission page-fixes is no longer on str6"
check "  (blocked, needing authorization)" "$(st "$S3")$(sed -n 's/^NEEDS: //p' "$TMP/work/$S3.md")" "blocked authorization"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
