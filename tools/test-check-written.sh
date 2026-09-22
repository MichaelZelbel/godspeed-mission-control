#!/usr/bin/env bash
# The gate for hub-check-written: a written answer closes a learn item only when a check that is
# not the runner has opened the file. The cases are the ways a "we found out X" goes wrong: the
# file is not there, it is too short to hold an answer, a template line was never filled, a
# section that was asked for is missing, it reads like a machine wrote it (em dash, a banned
# word, a long id), or it is padded past the length asked for. A Sources section is provenance
# and is neither counted nor searched.
# Runs in a throwaway hub root; never touches a real hub.
# Usage: bash tools/test-check-written.sh   (from a checkout of this kit)
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
NODE=""
for c in node nodejs /usr/local/bin/node /usr/bin/node; do
  "$c" -e '' >/dev/null 2>&1 && { NODE="$c"; break; }
done
[ -n "$NODE" ] || { echo "FAIL: no node on this box"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/rules" "$TMP/bin" "$TMP/research"
: > "$TMP/AGENTS.md"
printf 'receipt\nstderr\n' > "$TMP/rules/machine-words.txt"
cp "$HERE/check-written.js" "$TMP/bin/"
cp "$HERE/hub-cards.js" "$TMP/bin/"
export HUB_ROOT="$TMP"
cw() { "$NODE" "$TMP/bin/check-written.js" "$@"; }

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (wanted [$3], got [$2])"; fi; }
contains() { case "$2" in *"$3"*) ok "$1";; *) bad "$1 (missing [$3] in: $(printf '%s' "$2" | head -5))";; esac; }
missing()  { case "$2" in *"$3"*) bad "$1 (should not contain [$3])";; *) ok "$1";; esac; }

# Sixty plain words, six lines of ten. The "## Answer" heading over them is two more tokens, so 62.
SIXTY="one two three four five six seven eight nine ten
one two three four five six seven eight nine ten
one two three four five six seven eight nine ten
one two three four five six seven eight nine ten
one two three four five six seven eight nine ten
one two three four five six seven eight nine ten"
EMDASH="$(printf '\342\200\224')"
HEXID="9f8e7d6c5b4a39281706f5e4d3c2b1a0"

echo "hub-check-written gate"

# --- no args, help -------------------------------------------------------------------------------------
OUT="$(cw 2>&1)"; check "no arguments prints usage and fails" "$?" "1"
contains "  the usage names the command" "$OUT" "hub-check-written <path>"
OUT="$(cw --help 2>&1)"; check "--help exits 0" "$?" "0"

# --- the good case ---------------------------------------------------------------------------------------
printf '## Answer\n%s\n' "$SIXTY" > "$TMP/research/good.md"
OUT="$(cw research/good.md --min-words 50 2>&1)"; check "a 60-word answer passes --min-words 50" "$?" "0"
check "  and says so with the count" "$OUT" "ok: research/good.md, 62 words"
OUT="$(cw "$TMP/research/good.md" --min-words 50 2>&1)"; check "an absolute path works too" "$?" "0"

# --- the ways it is not there ----------------------------------------------------------------------------
OUT="$(cw research/nothing.md 2>&1)"; check "a missing file fails" "$?" "1"
contains "  and says it does not exist" "$OUT" "PROBLEM: research/nothing.md does not exist"
: > "$TMP/research/empty.md"
OUT="$(cw research/empty.md 2>&1)"; check "an empty file fails" "$?" "1"
contains "  and says it is empty" "$OUT" "PROBLEM: research/empty.md is empty"
printf '## Answer\nseven words are not an answer here\n' > "$TMP/research/short.md"
OUT="$(cw research/short.md --min-words 50 2>&1)"; check "too short fails" "$?" "1"
contains "  and gives both numbers" "$OUT" "9 words outside Sources, fewer than the 50 asked for"
OUT="$(cw research/good.md --max-words 40 2>&1)"; check "--max-words exceeded fails" "$?" "1"
contains "  and gives both numbers" "$OUT" "62 words outside Sources, more than the 40 allowed"

# --- the ways it is not finished ------------------------------------------------------------------------
printf '## Answer\n%s\n\n## Evidence\n(what was read, and where)\n' "$SIXTY" > "$TMP/research/template.md"
OUT="$(cw research/template.md 2>&1)"; check "a placeholder line left under a heading fails" "$?" "1"
contains "  and names the line" "$OUT" "PROBLEM: line 10 is still a placeholder: (what was read, and where)"
printf '(a note before any heading is not a placeholder)\n## Answer\n%s\n' "$SIXTY" > "$TMP/research/preamble.md"
OUT="$(cw research/preamble.md 2>&1)"; check "a bracketed line before the first heading is not a placeholder" "$?" "0"
OUT="$(cw research/good.md --sections "## Answer,## Evidence" 2>&1)"; check "a missing required section fails" "$?" "1"
contains "  and names it" "$OUT" "PROBLEM: section \"## Evidence\" is missing"
missing "  and not the one that is there" "$OUT" "## Answer\" is missing"
printf '## Answer\n%s\n## Evidence\nread it\n' "$SIXTY" > "$TMP/research/sections.md"
OUT="$(cw research/sections.md --sections "## Answer,## Evidence" 2>&1)"; check "both sections present passes" "$?" "0"

# --- the ways it reads like a machine --------------------------------------------------------------------
printf '## Answer\n%s\nthe answer %s in one line\n' "$SIXTY" "$EMDASH" > "$TMP/research/dash.md"
OUT="$(cw research/dash.md 2>&1)"; check "an em dash fails" "$?" "1"
contains "  and names the line" "$OUT" "PROBLEM: line 8 has an em dash"
printf '## Answer\n%s\nthe receipt order is to write it down\n' "$SIXTY" > "$TMP/research/word.md"
OUT="$(cw research/word.md 2>&1)"; check "a word from rules/machine-words.txt in the body fails" "$?" "1"
contains "  and says which word" "$OUT" "PROBLEM: line 8 has \"receipt\""
printf '## Answer\n%s\nthe id was %s and nobody should read that\n' "$SIXTY" "$HEXID" > "$TMP/research/hex.md"
OUT="$(cw research/hex.md 2>&1)"; check "a long hex id in the body fails" "$?" "1"
contains "  and says what it is" "$OUT" "(a long hexadecimal id)"
printf '## Answer\n%s\nsee https://example.org/%s/receipt for the page\n' "$SIXTY" "$HEXID" > "$TMP/research/link.md"
OUT="$(cw research/link.md 2>&1)"; check "a machine word inside an https link is allowed" "$?" "0"

# --- Sources is provenance: not counted, not searched ------------------------------------------------------
printf '## Answer\n%s\n\n## Sources\nhttps://example.org/%s\nreceipt receipt %s\n' "$SIXTY" "$HEXID" "$HEXID" > "$TMP/research/provenance.md"
OUT="$(cw research/provenance.md --min-words 50 2>&1)"; check "a Sources section with ids and banned words still passes" "$?" "0"
check "  and its words are not counted" "$OUT" "ok: research/provenance.md, 62 words"
printf '## Answer\nten words here in the body only, and nothing more\n\n## sources\n%s\n' "$SIXTY" > "$TMP/research/padded.md"
OUT="$(cw research/padded.md --min-words 50 2>&1)"; check "padding the Sources section does not reach the minimum" "$?" "1"
contains "  and the count excludes it, any case" "$OUT" "12 words outside Sources, fewer than the 50 asked for"

# --- every fault on one run --------------------------------------------------------------------------------
printf '## Answer\nshort %s receipt\n## Evidence\n(fill in)\n' "$EMDASH" > "$TMP/research/all.md"
OUT="$(cw research/all.md --min-words 50 --sections "## Answer,## Reading" 2>&1)"; check "several faults fail once" "$?" "1"
check "  one PROBLEM line each" "$(printf '%s\n' "$OUT" | grep -c '^PROBLEM: ')" "5"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
