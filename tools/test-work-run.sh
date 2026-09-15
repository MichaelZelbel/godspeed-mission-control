#!/usr/bin/env bash
# The gate for hub-work-run: the runner takes one item at a time under a lease, what the
# assistant says is only ATTEMPTED, the item's own check is what verifies, a dead assistant is a
# failure with a retry gap, a dry run touches nothing, a finished piece becomes a page and one
# card through the ledger's own door. No model runs here: a fake hub-run stands in for it.
# Runs in a throwaway hub root; never touches a real work/.
# Usage: bash tools/test-work-run.sh   (from a checkout of this kit)
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
NODE=""
for c in node nodejs /usr/local/bin/node /usr/bin/node; do
  "$c" -e '' >/dev/null 2>&1 && { NODE="$c"; break; }
done
[ -n "$NODE" ] || { echo "FAIL: no node on this box"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/rules" "$TMP/bin" "$TMP/goals/playbooks" "$TMP/skills/work-item" "$TMP/research"
: > "$TMP/AGENTS.md"
printf 'receipt\n' > "$TMP/rules/machine-words.txt"
for f in work.js goals.js hub-cards.js hub-work-run check-written.js; do cp "$HERE/$f" "$TMP/bin/"; done
cp "$HERE/../starter-hub/skills/work-item/SKILL.md" "$TMP/skills/work-item/SKILL.md"
chmod +x "$TMP/bin/hub-work-run"

# THE FAKE ASSISTANT. It reads the prompt the runner built, finds the path DONE WHEN names,
# writes a file there, and answers with one RESULT line. FAKE_MODE picks the failure to imitate.
cat > "$TMP/bin/hub-run" <<'FAKE'
#!/usr/bin/env bash
PF=""; OUT=""; SKILL=""
while [ $# -gt 0 ]; do case "$1" in --prompt-file) PF="$2"; shift 2;; --out) OUT="$2"; shift 2;; --hub|--cwd|--prompt|--timeout|--allowed-tools) shift 2;; *) [ -z "$SKILL" ] && SKILL="$1"; shift;; esac; done
[ "$SKILL" = "work-item" ] || { echo "wrong recipe: $SKILL" >&2; exit 9; }
cp "$PF" "$(dirname "$OUT")/prompt-seen.txt"
mkdir -p "$(dirname "$OUT")"
P="$(grep -m1 '^DONE WHEN:' "$PF" | grep -oE '[A-Za-z0-9_][A-Za-z0-9_./-]*/[A-Za-z0-9_./-]+\.(md|csv|txt)' | head -1)"
case "${FAKE_MODE:-ok}" in
  exit1)    echo "boom" > "$OUT"; exit 1 ;;
  noresult) echo "I did things but never said so" > "$OUT"; exit 0 ;;
  failed)   echo "RESULT: FAILED: the shop needs a login this machine does not have" > "$OUT"; exit 0 ;;
  short)    [ -n "$P" ] && { mkdir -p "$(dirname "$P")"; echo "too short" > "$P"; }; echo "RESULT: wrote $P" > "$OUT"; exit 0 ;;
  *)        [ -n "$P" ] && { mkdir -p "$(dirname "$P")"; { echo "# Answer"; for i in $(seq 1 80); do printf 'word%s ' "$i"; done; echo; echo; echo "## Sources"; echo "- https://example.org/a"; } > "$P"; }
            echo "scratch line"; echo "RESULT: wrote $P with 80 words" ;;
esac > "${OUT:-/dev/stdout}"
exit 0
FAKE
chmod +x "$TMP/bin/hub-run"

# A fake publisher and a fake ledger, so the last two steps are seen without a server.
cat > "$TMP/bin/publish" <<'PUB'
#!/usr/bin/env bash
echo "https://example.org/pages/$(basename "$1" .md).html"
PUB
chmod +x "$TMP/bin/publish"
cat > "$TMP/bin/hub-attention" <<'LEDGER'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$HUB_ROOT/card-argv.txt"
echo "filed 2026-09-15-work-x (deliverable)"
LEDGER
chmod +x "$TMP/bin/hub-attention"

export HUB_ROOT="$TMP"
export HUB_TODAY="2026-09-15"
export HUB_NOW="2026-09-15T08:00:00.000Z"
export PATH="$TMP/bin:$PATH"
hw() { "$NODE" "$TMP/bin/work.js" "$@"; }
hg() { "$NODE" "$TMP/bin/goals.js" "$@"; }
run() { bash "$TMP/bin/hub-work-run" --hub "$TMP" "$@"; }
status_of() { sed -n 's/^STATUS: //p' "$TMP/work/$1.md"; }

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (wanted [$3], got [$2])"; fi; }
contains() { case "$2" in *"$3"*) ok "$1";; *) bad "$1 (missing [$3] in: $(printf '%s' "$2" | head -5))";; esac; }
missing()  { case "$2" in *"$3"*) bad "$1 (should not contain [$3])";; *) ok "$1";; esac; }

echo "hub-work-run gate"

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
OUT="$(run --max-items 1 --publish-cmd "$TMP/bin/publish" 2>&1)"; check "one item runs and the runner exits 0" "$?" "0"
contains "  the playbook item was taken first" "$OUT" "W-20260915-02 taken (learn)"
contains "  the assistant saw the goal's own words" "$(cat "$TMP/routines/work/2026-09-15/W-20260915-02/prompt-seen.txt")" "five really good friends"
contains "  and where the answer goes" "$(cat "$TMP/routines/work/2026-09-15/W-20260915-02/prompt-seen.txt")" "How this goal is won"
contains "  what it said is ATTEMPTED" "$(grep -c 'ATTEMPTED attempt 1 by work-2026-09-15-01' "$TMP/work/W-20260915-02.md")" "1"
check "  the check, not the runner, made it verified" "$(status_of W-20260915-02)" "verified"
contains "  verified by its check on the record" "$(cat "$TMP/work/W-20260915-02.md")" "VERIFIED check passed"
check "  the other two were left alone" "$(grep -l '^STATUS: planned' "$TMP/work"/W-*.md | wc -l | tr -d ' ')" "2"
contains "  the finished file became a page" "$OUT" "published: https://example.org/pages/five-friends.html"
contains "  and the page is on the item" "$(cat "$TMP/work/W-20260915-02.md")" "LINK: https://example.org/pages/five-friends.html"
contains "  and one card went through the ledger's door" "$(cat "$TMP/card-argv.txt")" "deliverable"
contains "  with the link on it" "$(cat "$TMP/card-argv.txt")" "https://example.org/pages/five-friends.html"
contains "  the run ends with its count" "$OUT" "1 taken, 1 attempted, 1 verified"

# --- the runner said done, the check says not: stays attempted, run goes on --------------------------------
OUT="$(FAKE_MODE=short run --only W-20260915-01 2>&1)"; check "a failing check does not fail the run" "$?" "0"
check "  the item stays attempted" "$(status_of W-20260915-01)" "attempted"
contains "  and says so" "$OUT" "attempted, not verified"
missing "  nothing was published" "$OUT" "published:"

# --- an assistant that dies, or never says what it did, is a failure with a gap ------------------------------
rm -f "$TMP/card-argv.txt"
OUT="$(FAKE_MODE=exit1 run --only W-20260915-03 2>&1)"
check "  the item is failed" "$(status_of W-20260915-03)" "failed"
contains "  with the reason and a retry day" "$(cat "$TMP/work/W-20260915-03.md")" "retry on 2026-09-16"
contains "  named in the run" "$OUT" "without a RESULT line"
OUT="$(run --only W-20260915-03 2>&1)"
contains "  and it is not hammered the same day" "$OUT" "not runnable now"
OUT="$(HUB_TODAY=2026-09-16 FAKE_MODE=failed run --only W-20260915-03 2>&1)"
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

# --- the budget and the limit -----------------------------------------------------------------------------------
hw file --what "One more" --done-when "research/one.md exists" --key one --source test >/dev/null
hw file --what "And another" --done-when "research/two.md exists" --key two --source test >/dev/null
OUT="$(run --max-items 1 2>&1)"
contains "the limit stops the run after one" "$OUT" "1 item(s) is the limit"
OUT="$(run --budget 0 2>&1)"
contains "a spent budget starts nothing" "$OUT" "used of a 0s budget"
check "  and took nothing" "$(grep -c "taken (" <<< "$OUT")" "0"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
