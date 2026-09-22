#!/usr/bin/env bash
# The gate for mc-forecast: forecasts with their reference class, revisions that never overwrite
# history, resolutions with evidence, and a score that counts each question once against the
# baseline it named. Runs in a throwaway godspeed root; never touches the real forecasts/.
# Usage: bash tools/test-forecast.sh   (from a checkout of this kit)
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
NODE=""
for c in node nodejs /usr/local/bin/node /usr/bin/node; do
  "$c" -e '' >/dev/null 2>&1 && { NODE="$c"; break; }
done
[ -n "$NODE" ] || { echo "FAIL: no node on this box"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/rules" "$TMP/bin"
: > "$TMP/AGENTS.md"
cp "$HERE/forecast.js" "$TMP/bin/"
cp "$HERE/mc-cards.js" "$TMP/bin/"
export GODSPEED_ROOT="$TMP"
export GODSPEED_TODAY="2026-09-13"
hf() { "$NODE" "$TMP/bin/forecast.js" "$@"; }

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (wanted [$3], got [$2])"; fi; }
contains() { case "$2" in *"$3"*) ok "$1";; *) bad "$1 (missing [$3] in: $(printf '%s' "$2" | head -5))";; esac; }
missing()  { case "$2" in *"$3"*) bad "$1 (should not contain [$3])";; *) ok "$1";; esac; }

echo "mc-forecast gate"

BASE=(--resolves-when "a post card carries OUTCOME posted with a link" --reference-class "nine post cards shown in 14 days, none posted; three posted on day one in August" --evidence "outcomes table 2026-09-13" --failures-included yes --fit "same person, same channel" --differs "the lines are now redrafts of ones that were refused")

# --- filing refuses what it must ---------------------------------------------------------------
OUT="$(hf file --question "One line is posted by 09-26" --resolves-when "a card says posted" --deadline 2026-09-26 --p 0.2 --evidence e 2>&1)"; check "no reference class, no forecast" "$?" "1"
contains "  and says so" "$OUT" "reference-class is required"
OUT="$(hf file --question "q" --deadline 2026-09-26 --p 0.2 --reference-class x --evidence e 2>&1)"; check "no resolution criteria, no forecast" "$?" "1"
OUT="$(hf file --question "q" --deadline 2026-09-26 --p 0.234 "${BASE[@]}" 2>&1)"; check "three decimals are refused as invented precision" "$?" "1"
contains "  and says why" "$OUT" "invented precision"
OUT="$(hf file --question "q" --deadline 2026-09-26 --p 0.99 "${BASE[@]}" 2>&1)"; check "an extreme probability needs a reason" "$?" "1"
OUT="$(hf file --question "q" --deadline 2026-09-01 --p 0.5 "${BASE[@]}" 2>&1)"; check "a deadline in the past is refused" "$?" "1"
OUT="$(hf file --question "One of the drafted lines is posted by 2026-09-26" --id F1 --deadline 2026-09-26 --p 0.2 --baseline 0.1 --baseline-source "0 of 9 shown posted in 14 days, floored at one in ten" --goal lead "${BASE[@]}" 2>&1)"
contains "a complete forecast files" "$OUT" "F1: filed, p=0.2, resolves by 2026-09-26 (13 days)"
check "  the MADE line carries the number" "$(grep -c '^- 2026-09-13 MADE p=0.2' "$TMP/forecasts/F1.md")" "1"
check "  horizon days are recorded" "$(grep -c '^HORIZON DAYS: 13' "$TMP/forecasts/F1.md")" "1"
OUT="$(hf file --question "Kit sales by 2026-10-24" --id R1 --deadline 2026-10-24 --low 0 --high 2 --unit "copies" "${BASE[@]}" 2>&1)"
contains "a range forecast files" "$OUT" "R1: filed, range"
OUT="$(hf file --question "Kit sales" --id R2 --deadline 2026-10-24 --low 0 "${BASE[@]}" 2>&1)"; check "a half range is refused" "$?" "1"

# --- revisions append, never overwrite ---------------------------------------------------------
OUT="$(hf revise F1 --p 0.3 2>&1)"; check "a revision without a reason is refused" "$?" "1"
OUT="$(hf revise F1 --p 0.2 --why "same" 2>&1)"; check "a revision to the same number is refused" "$?" "1"
OUT="$(GODSPEED_TODAY=2026-09-16 hf revise F1 --p 0.35 --why "you said on 09-15 that you liked the second line" 2>&1)"
contains "a revision with a reason is recorded" "$OUT" "1 revision(s) on record"
check "  the header holds the new number" "$(grep -c '^P: 0.35' "$TMP/forecasts/F1.md")" "1"
check "  the first number stays in the log" "$(grep -c '^- 2026-09-13 MADE p=0.2$' "$TMP/forecasts/F1.md")" "1"
check "  the revision line says from what and why" "$(grep -c '^- 2026-09-16 REVISED p=0.35 from 0.2 because you said' "$TMP/forecasts/F1.md")" "1"
OUT="$(GODSPEED_TODAY=2026-09-27 hf revise F1 --p 0.5 --why "late" 2>&1)"; check "a revision after the deadline is refused" "$?" "1"
contains "  and says to resolve instead" "$OUT" "resolve it, do not revise it"

# --- resolution needs evidence; the score uses the last pre-deadline number once -------------------
OUT="$(GODSPEED_TODAY=2026-09-27 hf resolve F1 --outcome yes 2>&1)"; check "a resolution without evidence is refused" "$?" "1"
OUT="$(GODSPEED_TODAY=2026-09-27 hf due 2>&1)"; contains "due lists a forecast past its deadline" "$OUT" "F1"
OUT="$(GODSPEED_TODAY=2026-09-27 hf resolve F1 --outcome no --evidence "no post card carries OUTCOME posted on 09-27, and the page shows nothing new" 2>&1)"
contains "resolution prints the Brier at the last number" "$OUT" "Brier 0.122 at p=0.35"
contains "  and the baseline's" "$OUT" "baseline 0.010 at p=0.1"
OUT="$(GODSPEED_TODAY=2026-09-27 hf resolve F1 --outcome yes --evidence x 2>&1)"; check "a resolved forecast is not resolved twice" "$?" "1"
OUT="$(hf score 2>&1)"
contains "score counts the question once" "$OUT" "over 1 resolved question(s), each counted once"
contains "  mean Brier at the final number" "$OUT" "mean Brier (0 is perfect, 0.25 is a coin at 50%, 1 is confidently wrong): 0.122"
contains "  and at first filing separately" "$OUT" "at first filing 0.040"
contains "  compared with the named baseline on the same question" "$OUT" "godspeed 0.122 vs baseline 0.010 over 1"
contains "  with the small-n warning" "$OUT" "fewer than five resolved questions: a note, not a track record"
# five more, to see calibration buckets and horizon split
for i in 2 3 4 5 6; do hf file --question "q$i" --id F$i --deadline 2026-11-01 --p 0.8 "${BASE[@]}" >/dev/null; done
for i in 2 3 4 5; do GODSPEED_TODAY=2026-11-02 hf resolve F$i --outcome yes --evidence "seen" >/dev/null; done
GODSPEED_TODAY=2026-11-02 hf resolve F6 --outcome no --evidence "seen" >/dev/null
OUT="$(hf score 2>&1)"
contains "calibration bucket 0.8-1.0 shows 5 forecasts at 0.80 with 0.80 observed" "$OUT" "0.8-1.0  n=5  forecast 0.80  observed 0.80"
contains "horizons are split" "$OUT" "by horizon: under 30 days 0.122, 30 days and more 0.160"
missing "  the small-n note is gone at six" "$OUT" "fewer than five"
J="$(hf score --json)"
N="$(printf '%s' "$J" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);console.log(p.resolved, p.rows.filter(r=>r.id==="F1").length)})')"
check "  json: six resolved, F1 once" "$N" "6 1"
OUT="$(hf resolve R1 --outcome yes --evidence "the shop shows two sales" 2>&1)"; check "a range resolves only with a value" "$?" "1"
OUT="$(hf resolve R1 --outcome yes --value 1 --evidence "the shop shows one sale" 2>&1)"
contains "  and with one it resolves" "$OUT" "R1: resolved"
OUT="$(hf score 2>&1)"; contains "a range forecast is not in the binary score" "$OUT" "over 6 resolved"

# --- a goal change flags the open forecasts under it; void is an outcome ------------------------------
hf file --question "q7" --id F7 --deadline 2026-12-01 --p 0.5 --goal lead "${BASE[@]}" >/dev/null
OUT="$(hf flag --goal lead --reason "lead paused" 2>&1)"
contains "flag writes a review line on the open forecast under the goal" "$OUT" "review line written on 1 open forecast(s): F7"
check "  (in the file)" "$(grep -c '^- 2026-09-13 REVIEW lead paused' "$TMP/forecasts/F7.md")" "1"
OUT="$(hf resolve F7 --outcome void --evidence "the goal was retired, the question no longer resolves" 2>&1)"
contains "void is recorded" "$OUT" "F7: void"
OUT="$(hf score 2>&1)"; contains "  and not scored" "$OUT" "over 6 resolved"

# --- check ---------------------------------------------------------------------------------------
OUT="$(hf check 2>&1)"; check "check passes on a clean register" "$?" "0"
hf file --question "old" --id OLD --deadline 2026-09-20 --p 0.5 "${BASE[@]}" >/dev/null
OUT="$(GODSPEED_TODAY=2026-10-20 hf check 2>&1)"; check "check fails on a deadline two weeks past and still open" "$?" "1"
contains "  and says resolve it" "$OUT" "resolve it"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
