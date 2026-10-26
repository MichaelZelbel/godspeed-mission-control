#!/usr/bin/env bash
# The gate for mc-work-run: the runner takes one item at a time under a lease, what the
# assistant says is only ATTEMPTED, the item's own check is what verifies, a dead assistant is a
# failure with a retry gap, a dry run touches nothing, a finished piece becomes a page named with
# the assistant's own sentence for the person. No model runs here: a fake mc-run stands in for it.
# Runs in a throwaway godspeed root; never touches a real work/.
# Usage: bash tools/test-work-run.sh   (from a checkout of this kit)
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
mkdir -p "$TMP/rules" "$TMP/bin" "$TMP/goals/playbooks" "$TMP/skills/work-item" "$TMP/research"
: > "$TMP/AGENTS.md"
printf 'receipt\n' > "$TMP/rules/machine-words.txt"
for f in work.js goals.js mc-cards.js mc-work-run check-written.js; do cp "$HERE/$f" "$TMP/bin/"; done
cp "$HERE/../starter-godspeed/skills/work-item/SKILL.md" "$TMP/skills/work-item/SKILL.md"
chmod +x "$TMP/bin/mc-work-run"

# THE FAKE ASSISTANT. It reads the prompt the runner built, finds the path DONE WHEN names,
# writes a file there, and answers with one RESULT line. FAKE_MODE picks the failure to imitate.
cat > "$TMP/bin/mc-run" <<'FAKE'
#!/usr/bin/env bash
PF=""; OUT=""; SKILL=""
while [ $# -gt 0 ]; do case "$1" in --prompt-file) PF="$2"; shift 2;; --out) OUT="$2"; shift 2;; --godspeed|--cwd|--prompt|--timeout|--allowed-tools) shift 2;; *) [ -z "$SKILL" ] && SKILL="$1"; shift;; esac; done
[ "$SKILL" = "work-item" ] || { echo "wrong recipe: $SKILL" >&2; exit 9; }
cp "$PF" "$(dirname "$OUT")/prompt-seen.txt"
mkdir -p "$(dirname "$OUT")"
P="$(grep -m1 '^DONE WHEN:' "$PF" | grep -oE '[A-Za-z0-9_][A-Za-z0-9_./-]*/[A-Za-z0-9_./-]+\.(md|csv|txt)' | head -1)"
case "${FAKE_MODE:-ok}" in
  exit1)    echo "boom" > "$OUT"; exit 1 ;;
  noresult) echo "I did things but never said so" > "$OUT"; exit 0 ;;
  failed)   echo "RESULT: FAILED: the shop needs a login this machine does not have" > "$OUT"; exit 0 ;;
  short)    [ -n "$P" ] && { mkdir -p "$(dirname "$P")"; echo "too short" > "$P"; }; echo "RESULT: wrote $P" > "$OUT"; exit 0 ;;
  *)        [ -n "${FAKE_TOUCH:-}" ] && printf 'repaired\n' > "$FAKE_TOUCH"
            [ -n "${FAKE_BEFORE:-}" ] && printf '%s\n' "$FAKE_BEFORE" > "$(dirname "$OUT")/before.txt"
            [ -n "${FAKE_KEEP:-}" ] && { mkdir -p "$(dirname "$OUT")/before/$(dirname "$FAKE_KEEP")"; printf 'as it was\n' > "$(dirname "$OUT")/before/$FAKE_KEEP"; }
            [ -n "$P" ] && { mkdir -p "$(dirname "$P")"; { echo "# Answer"; for i in $(seq 1 80); do printf 'word%s ' "$i"; done; echo; echo; echo "## Sources"; echo "- https://example.org/a"; } > "$P"; }
            echo "scratch line"; [ -n "${FAKE_SAY:-}" ] && echo "SAY: $FAKE_SAY"
            echo "RESULT: wrote $P with 80 words" ;;
esac > "${OUT:-/dev/stdout}"
exit 0
FAKE
chmod +x "$TMP/bin/mc-run"

# A fake publisher that keeps what it was asked, so the last step is seen without a server.
cat > "$TMP/bin/publish" <<'PUB'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$GODSPEED_ROOT/publish-argv.txt"
echo "https://example.org/pages/$(basename "$1" .md).html"
PUB
chmod +x "$TMP/bin/publish"

export GODSPEED_ROOT="$TMP"
export GODSPEED_TODAY="2026-09-15"
export GODSPEED_NOW="2026-09-15T08:00:00.000Z"
export PATH="$TMP/bin:$PATH"
hw() { "$NODE" "$TMP/bin/work.js" "$@"; }
hg() { "$NODE" "$TMP/bin/goals.js" "$@"; }
run() { bash "$TMP/bin/mc-work-run" --godspeed "$TMP" "$@"; }
status_of() { sed -n 's/^STATUS: //p' "$TMP/work/$1.md"; }

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (wanted [$3], got [$2])"; fi; }
contains() { case "$2" in *"$3"*) ok "$1";; *) bad "$1 (missing [$3] in: $(printf '%s' "$2" | head -5))";; esac; }
missing()  { case "$2" in *"$3"*) bad "$1 (should not contain [$3])";; *) ok "$1";; esac; }

echo "mc-work-run gate"

# --- nothing to run, dry run ---------------------------------------------------------------------
OUT="$(run 2>&1)"; check "an empty register is a quiet exit 0" "$?" "0"
contains "  and says so" "$OUT" "nothing runnable now"

hg file --kind outcome --status adopted --title "Five friends I can talk to without a filter" --own-words "five really good friends" --measure "count of them" --source "his words 2026-09-13" --id five-friends >/dev/null
hw file --what "Write the memo on the three candidates" --done-when "research/five-friends-candidates.md exists with the three named" --check "$NODE $TMP/bin/check-written.js research/five-friends-candidates.md --min-words 50" --goal five-friends --key memo --source test >/dev/null
hw file --learn "How do people who reached five close friends get there" --path goals/playbooks/five-friends.md --check "$NODE $TMP/bin/check-written.js goals/playbooks/five-friends.md --min-words 50" --goal five-friends --key playbook --source test >/dev/null
hw file --what "Compute the number" --done-when "research/number.md exists" --key number --source test >/dev/null
OUT="$(run --dry-run 2>&1)"
contains "a dry run lists what would run" "$OUT" "Would run"
contains "  a playbook goes first, before the doing" "$(printf '%s' "$OUT" | grep -m1 'W-')" "W-20260915-02"
contains "  and says nothing was written" "$OUT" "Nothing was taken, run or written"
check "  every item still planned" "$(grep -l '^STATUS: planned' "$TMP/work"/W-*.md | wc -l | tr -d ' ')" "3"
check "  no run folder made" "$([ -d "$TMP/routines/work" ] && echo yes || echo no)" "no"

# --- one item at a time, attempted then verified by its check ---------------------------------------------
OUT="$(FAKE_SAY="How people in their fifties make close friends is written up for you." run --max-items 1 --publish-cmd "$TMP/bin/publish" 2>&1)"; check "one item runs and the runner exits 0" "$?" "0"
contains "  the playbook item was taken first" "$OUT" "W-20260915-02 taken (learn)"
contains "  the assistant saw the goal's own words" "$(cat "$TMP/routines/work/2026-09-15/W-20260915-02/prompt-seen.txt")" "five really good friends"
contains "  and where the answer goes" "$(cat "$TMP/routines/work/2026-09-15/W-20260915-02/prompt-seen.txt")" "How this goal is won"
contains "  what it said is ATTEMPTED" "$(grep -c 'ATTEMPTED attempt 1 by work-2026-09-15-01' "$TMP/work/W-20260915-02.md")" "1"
check "  the check, not the runner, made it verified" "$(status_of W-20260915-02)" "verified"
contains "  verified by its check on the record" "$(cat "$TMP/work/W-20260915-02.md")" "VERIFIED check passed"
check "  the other two were left alone" "$(grep -l '^STATUS: planned' "$TMP/work"/W-*.md | wc -l | tr -d ' ')" "2"
contains "  the finished file became a page" "$OUT" "published: https://example.org/pages/five-friends.html"
contains "  and the page is on the item" "$(cat "$TMP/work/W-20260915-02.md")" "LINK: https://example.org/pages/five-friends.html"
contains "  the page is named with what the assistant wrote for the reader" "$(cat "$TMP/publish-argv.txt")" "is written up for you."
missing "  and not with the item's own description" "$(cat "$TMP/publish-argv.txt")" "It is written and ready to read"
contains "  the prompt asked for that sentence" "$(cat "$TMP/routines/work/2026-09-15/W-20260915-02/prompt-seen.txt")" "starts with SAY:"
# The run is asked to run the item's own check before it answers (18 October 2026).
contains "  and to run the item's own check before its final line" "$(cat "$TMP/routines/work/2026-09-15/W-20260915-02/prompt-seen.txt")" "Run the item's CHECK yourself"
contains "  quoting that check" "$(cat "$TMP/routines/work/2026-09-15/W-20260915-02/prompt-seen.txt")" "check-written.js goals/playbooks/five-friends.md --min-words 50"
contains "  and the sentence stays with the item's answer, where the schedule reads it" "$(cat "$TMP/routines/work/2026-09-15/W-20260915-02/answer.txt")" "SAY: How people in their fifties make close friends is written up for you."
contains "  the run ends with its count" "$OUT" "1 taken, 1 attempted, 1 verified"

# --- the runner said done, the check says not: stays attempted, run goes on --------------------------------
OUT="$(FAKE_MODE=short run --only W-20260915-01 2>&1)"; check "a failing check does not fail the run" "$?" "0"
check "  the item stays attempted" "$(status_of W-20260915-01)" "attempted"
contains "  and says so" "$OUT" "attempted, not verified"
missing "  nothing was published" "$OUT" "published:"

# --- an assistant that dies, or never says what it did, is a failure with a gap ------------------------------
OUT="$(FAKE_MODE=exit1 run --only W-20260915-03 2>&1)"
# 2026-10-11: the run itself fails too, so a schedule's job check hears of it the same day. Exit
# 4, not 1: the notebook's daily round reads 1 to 3 as "could not start".
check "an assistant that dies fails the run with exit 4" "$?" "4"
contains "  and the run says so in its last line" "$(printf '%s\n' "$OUT" | tail -1)" "NOT finished: 1 of 1 assistant run(s) ended without a RESULT line"
check "  the item is failed" "$(status_of W-20260915-03)" "failed"
contains "  with the reason and a retry day" "$(cat "$TMP/work/W-20260915-03.md")" "retry on 2026-09-16"
contains "  named in the run" "$OUT" "without a RESULT line"
OUT="$(run --only W-20260915-03 2>&1)"
contains "  and it is not hammered the same day" "$OUT" "not runnable now"
OUT="$(GODSPEED_TODAY=2026-09-16 FAKE_MODE=failed run --only W-20260915-03 2>&1)"
check "  a FAILED line is the assistant's own finished answer, so the run went through" "$?" "0"
missing "  and is not called NOT finished" "$OUT" "NOT finished"
check "  on the retry day a FAILED line is a failure with its reason" "$(status_of W-20260915-03)" "failed"
contains "  the reason is the assistant's own" "$(cat "$TMP/work/W-20260915-03.md")" "the shop needs a login this machine does not have"

# --- a lease held elsewhere is skipped, not fought over --------------------------------------------------------
hw file --what "Held by another runner" --done-when "research/held.md exists" --key held --source test >/dev/null
hw file --what "Free to run" --done-when "research/free.md exists" --key free --source test >/dev/null
hw take W-20260915-04 --runner hermes-server >/dev/null
OUT="$(run --max-items 2 2>&1)"
contains "an item another runner holds is not runnable and is not taken" "$OUT" "W-20260915-05 taken"
missing "  and the held one was left alone" "$OUT" "W-20260915-04 taken"
contains "  its lease is still the other runner's" "$(cat "$TMP/work/W-20260915-04.md")" "LEASE: hermes-server until"

# --- no check at all: attempted, for a person to verify ----------------------------------------------------------
check "an item with no check stays attempted after the assistant's word" "$(status_of W-20260915-05)" "attempted"

# --- a finished piece with no sentence for the person is recorded, not announced ----------------------------------
hw file --learn "Does housekeeping stay quiet?" --path research/quiet.md --check "$NODE $TMP/bin/check-written.js research/quiet.md --min-words 50" --key quiet --source test >/dev/null
QID="$(grep -l 'KEY: quiet' "$TMP/work"/W-*.md | head -1 | xargs basename | sed 's/.md$//')"
OUT="$(run --only "$QID" --publish-cmd "$TMP/bin/publish" 2>&1)"
missing "a piece with no SAY line leaves no sentence for the schedule to say" "$(cat "$TMP/routines/work/2026-09-15/$QID/answer.txt")" "SAY:"
contains "  and the run says why" "$OUT" "no sentence for the person"

# --- the mission control's own machinery runs last, however early it was filed ------------------------------------------------
hw file --what "Tidy the mission control's own plumbing" --done-when "research/plumbing.md exists" --key plumbing --source test >/dev/null
hw file --what "Make the thing for the goal" --done-when "research/thing.md exists" --goal five-friends --key thing --source test >/dev/null
OUT="$(run --dry-run 2>&1)"
PL="$(printf '%s\n' "$OUT" | grep -n "Tidy the mission control's own plumbing" | head -1 | cut -d: -f1)"
TH="$(printf '%s\n' "$OUT" | grep -n "Make the thing for the goal" | head -1 | cut -d: -f1)"
check "work for a goal runs before the mission control's own machinery" "$([ -n "$PL" ] && [ -n "$TH" ] && [ "$TH" -lt "$PL" ] && echo yes || echo no)" "yes"

# --- what an item changed is saved with the run, not only the file it named --------------------------------------
if command -v git >/dev/null 2>&1; then
  ( cd "$TMP" && git init -q . && git config user.email t@example.org && git config user.name t \
    && printf 'old\n' > tool.sh && printf 'mine\n' > already-dirty.txt && git add tool.sh already-dirty.txt && git commit -q -m start \
    && printf 'changed before the run\n' > already-dirty.txt ) >/dev/null 2>&1
  hw file --learn "Does the runner save a program an item repaired?" --path research/saved.md --check "$NODE $TMP/bin/check-written.js research/saved.md --min-words 50" --key saved --source test >/dev/null
  SID="$(grep -l 'KEY: saved' "$TMP/work"/W-*.md | head -1 | xargs basename | sed 's/.md$//')"
  OUT="$(FAKE_TOUCH="tool.sh" run --only "$SID" 2>&1)"
  contains "a program the item repaired is saved with the run" "$(git -C "$TMP" show --stat --format= HEAD 2>/dev/null)" "tool.sh"
  missing "  and a file that was already changed before the run is left alone" "$(git -C "$TMP" show --stat --format= HEAD 2>/dev/null)" "already-dirty.txt"
fi

# --- a machine repair may reach outside the folder, keeping a copy first (2026-10-27) -----------------------------
# From 9 to 26 October 2026 five runs found the server's broken upgrade and its one-line fix, and
# could only write the fix into a note, because every run was held inside the folder.
hw file --what "Put the fixed nightly upgrade script back in place" --done-when "the upgrade's own check passes again on this machine" --kind repair --key upgrade --source test >/dev/null
RID="$(grep -l 'KEY: upgrade$' "$TMP/work"/W-*.md | head -1 | xargs basename | sed 's/.md$//')"
OUT="$(FAKE_KEEP="etc/example/job.conf" run --only "$RID" 2>&1)"
contains "a repair item is taken as a repair" "$OUT" "$RID taken (repair)"
PS="$(cat "$TMP/routines/work/2026-09-15/$RID/prompt-seen.txt")"
contains "  and told it is a machine repair" "$PS" "## This item is a machine repair"
contains "  that it may change what the mission control installed or runs outside its folder" "$PS" "you may change files outside "
contains "  only for the fault the item names" "$PS" "only as far as repairing that fault needs"
contains "  to copy each file whole first, under the item's own run folder" "$PS" "copy it whole under routines/work/2026-09-15/$RID/before/"
contains "  never a secret, an account, a payment or anything outward" "$PS" "Never touch a password, a key or a token, an account, a payment"
contains "  to prove the fault gone with the check that found it" "$PS" "run again, live, the check that found it"
contains "  and that a repair written down for later does not count" "$PS" "A repair written down for later"
contains "the copies it kept are named in the run" "$OUT" "$RID kept 1 file(s) as they were before the repair"
missing "an item of another kind is never told it may reach outside" "$(cat "$TMP/routines/work/2026-09-15/W-20260915-02/prompt-seen.txt")" "machine repair"
missing "  and neither is a do item" "$(cat "$TMP/routines/work/2026-09-15/W-20260915-01/prompt-seen.txt")" "machine repair"

# --- the budget and the limit -----------------------------------------------------------------------------------
hw file --what "One more" --done-when "research/one.md exists" --key one --source test >/dev/null
hw file --what "And another" --done-when "research/two.md exists" --key two --source test >/dev/null
OUT="$(run --max-items 1 2>&1)"
contains "the limit stops the run after one" "$OUT" "1 item(s) is the limit"
OUT="$(run --budget 0 2>&1)"
contains "a spent budget starts nothing" "$OUT" "used of a 0s budget"
check "  and took nothing" "$(grep -c "taken (" <<< "$OUT")" "0"

# --- an assistant that ends well but never says what it did fails the run too -------------------------------------
hw file --what "Say what you did" --done-when "research/said.md exists" --key said --source test >/dev/null
NID="$(grep -l 'KEY: said' "$TMP/work"/W-*.md | head -1 | xargs basename | sed 's/.md$//')"
OUT="$(FAKE_MODE=noresult run --only "$NID" 2>&1)"
check "an answer with no RESULT line fails the run with exit 4" "$?" "4"
check "  and the item is failed" "$(status_of "$NID")" "failed"
contains "  the run still ends with its count" "$OUT" "1 taken, 0 attempted, 0 verified"

# --- a step on a standing permission goes out at its time, not before, and never once stopped ---------------------
# GOES OUT is UTC; this file's clock stands at 2026-09-15T08:00Z.
hg allow five-friends --kind circle-replies --what "answer replies in my reading circle thread" --per-week 5 --words "yes, answer them for me" >/dev/null 2>&1
hw file --what "Answer the reply in the circle thread" --done-when "research/circle-reply.md exists" --goal five-friends --outward yes --may circle-replies --check "test -f research/circle-reply.md" --goes-out 2026-09-15T18:00 --key circle --source test >/dev/null
CID="$(grep -l 'KEY: circle$' "$TMP/work"/W-*.md | head -1 | xargs basename | sed 's/.md$//')"
OUT="$(run --only "$CID" 2>&1)"
contains "a notice step is not run before its time" "$OUT" "not runnable now"
check "  and stays planned" "$(status_of "$CID")" "planned"
hw announce "$CID" >/dev/null 2>&1   # the morning message showed it
OUT="$(GODSPEED_NOW=2026-09-15T18:01:00.000Z run --only "$CID" 2>&1)"
contains "after its time it is taken without anybody quoting a yes again" "$OUT" "$CID taken"
contains "  as a move to apply" "$(cat "$TMP/routines/work/2026-09-15/$CID/prompt-seen.txt")" "This item is an approved move: apply it"
contains "  told the yes is a standing one, for this kind of step, in the person's words" "$(cat "$TMP/routines/work/2026-09-15/$CID/prompt-seen.txt")" 'a standing yes to every step of this kind (circle-replies), in these words: "yes, answer them for me"'
contains "  and told that without its UNDO copy it is not done" "$(cat "$TMP/routines/work/2026-09-15/$CID/prompt-seen.txt")" "Without before.txt"
# Every step that goes out keeps its UNDO (2026-10-13): this assistant wrote no before.txt.
check "a standing step with no UNDO copy is recorded failed, not done" "$(status_of "$CID")" "failed"
contains "  with the reason" "$(cat "$TMP/work/$CID.md")" "no UNDO: routines/work/2026-09-15/$CID/before.txt was not written"
missing "  and no ATTEMPTED line" "$(cat "$TMP/work/$CID.md")" " ATTEMPTED "
contains "  the run says so" "$OUT" "$CID failed: no UNDO"
hw file --what "Answer the third reply" --done-when "research/circle-three.md exists" --goal five-friends --outward yes --may circle-replies --check "test -f research/circle-three.md" --goes-out 2026-09-15T18:00 --key circle3 --source test >/dev/null
C3="$(grep -l 'KEY: circle3$' "$TMP/work"/W-*.md | head -1 | xargs basename | sed 's/.md$//')"
hw announce "$C3" >/dev/null 2>&1   # the morning message showed it
OUT="$(GODSPEED_NOW=2026-09-15T18:02:00.000Z FAKE_BEFORE="the thread before my reply" run --only "$C3" 2>&1)"
check "a standing step that kept its UNDO copy is verified by its live check" "$(status_of "$C3")" "verified"
contains "  by the check, not the runner" "$(cat "$TMP/work/$C3.md")" "VERIFIED check passed (test -f research/circle-three.md)"
# The runner never runs a step nobody was shown (Rulings 19 and 21, 2026-10-13): the person can stop only what they saw.
hw file --what "Answer the fourth reply" --done-when "research/circle-four.md exists" --goal five-friends --outward yes --may circle-replies --check "test -f research/circle-four.md" --goes-out 2026-09-15T18:30 --key circle4 --source test >/dev/null
C4="$(grep -l 'KEY: circle4$' "$TMP/work"/W-*.md | head -1 | xargs basename | sed 's/.md$//')"
OUT="$(GODSPEED_NOW=2026-09-15T18:31:00.000Z run --dry-run 2>&1)"
missing "a dry run does not offer a step nobody was shown" "$OUT" "$C4"
check "  and moves nothing" "$(sed -n 's/^GOES OUT: //p' "$TMP/work/$C4.md")" "2026-09-15T18:30"
OUT="$(GODSPEED_NOW=2026-09-15T18:31:00.000Z run --only "$C4" 2>&1)"
contains "the runner does not run a step nobody was shown, even after its time" "$OUT" "not runnable now"
check "  it waits for the next day's 18:00 UTC" "$(sed -n 's/^GOES OUT: //p' "$TMP/work/$C4.md")" "2026-09-16T18:00"
contains "  saying why in its log" "$(cat "$TMP/work/$C4.md")" "NOT SHOWN: goes out 2026-09-16T18:00 instead"
check "  and no assistant saw it" "$([ -d "$TMP/routines/work/2026-09-15/$C4" ] && echo ran || echo never)" "never"
hw file --what "Answer the second reply" --done-when "research/circle-two.md exists" --goal five-friends --outward yes --may circle-replies --check "test -f research/circle-two.md" --goes-out 2026-09-15T19:00 --key circle2 --source test >/dev/null
C2="$(grep -l 'KEY: circle2$' "$TMP/work"/W-*.md | head -1 | xargs basename | sed 's/.md$//')"
GODSPEED_NOW=2026-09-15T18:59:00.000Z hw stop "$C2" --words "not that one" >/dev/null 2>&1
OUT="$(GODSPEED_NOW=2026-09-15T19:01:00.000Z run --only "$C2" 2>&1)"
contains "a step stopped a minute before its time is never run" "$OUT" "not runnable now"
check "  and stays stopped" "$(status_of "$C2")" "cancelled"
check "  no assistant ever saw it" "$([ -d "$TMP/routines/work/2026-09-15/$C2" ] && echo ran || echo never)" "never"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
