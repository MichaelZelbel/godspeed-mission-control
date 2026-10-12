#!/usr/bin/env bash
# The gate for mc-research: every due goal gets its night, a failed night leaves a gap file and a
# loud exit, and the time budget skips the most recently researched goals, by name.
set -uo pipefail
. "$(dirname "$0")/test-guard.bash"
HERE="$(cd "$(dirname "$0")" && pwd)"
NODE=""; for c in node nodejs /usr/local/bin/node /usr/bin/node; do "$c" -e '' >/dev/null 2>&1 && { NODE="$c"; break; }; done
NODE="$(command -v "$NODE")"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP" "$TEST_GUARD_HOME"' EXIT
G="$TMP/g"; B="$TMP/bin"; mkdir -p "$G/rules" "$G/skills/goal-research" "$B" "$TMP/home"
cp "$HERE/../starter-godspeed/skills/goal-research/SKILL.md" "$G/skills/goal-research/SKILL.md"
: > "$G/AGENTS.md"
export GODSPEED_TODAY=2026-10-12
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
check()    { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (wanted [$3], got [$2])"; fi; }
contains() { case "$2" in *"$3"*) ok "$1";; *) bad "$1 (missing [$3] in: $(printf '%s' "$2" | head -5))";; esac; }
hg() { GODSPEED_ROOT="$G" "$NODE" "$HERE/goals.js" "$@"; }
hg file --kind outcome --title "Money" --id money --area money --status adopted --source x >/dev/null
hg file --kind outcome --title "Health" --id health --area health --status adopted --source x >/dev/null

# THE STAND-IN for claude: reads the goal from the prompt and writes a complete night, unless the
# goal is named in $TMP/fail-these, in which case it writes nothing.
cat > "$B/claude" <<STAND
#!/bin/sh
# The prompt may come as an argument or on standard input, depending on mc-run's claude branch.
P="\$*"; [ -t 0 ] || P="\$P \$(cat)"
GOAL="\$(printf '%s' "\$P" | sed -n 's/.*Goal: \([a-z0-9-]*\)\. Mode.*/\1/p' | head -1)"
DAY="\$(printf '%s' "\$P" | sed -n 's/.*Today is \([0-9-]*\) (UTC).*/\1/p' | head -1)"
echo "\$GOAL" >> "$TMP/ran"
[ -f "$G/goals/research/\$GOAL/days/\$DAY.gap.md" ] && echo "\$GOAL" >> "$TMP/gap-during"
grep -qx "\$GOAL" "$TMP/fail-these" 2>/dev/null && { echo "crashed"; exit 1; }
R="$G/goals/research/\$GOAL"
W="\$(printf 'word %.0s' \$(seq 1 160))"
grep -qx "\$GOAL" "$TMP/short-day" 2>/dev/null && W="too short"
printf '# %s\n\n## Searched\n%s\n\n## Found\nx\n\n## Changed in the files\nx\n' "\$GOAL" "\$W" > "\$R/days/\$DAY.md"
sed -i "s/^UPDATED: .*/UPDATED: \$DAY/" "\$R/brief.md"
i=0; while [ \$i -lt 30 ]; do i=\$((i+1)); printf 'PERSON: P%s %s %s\nLINK: https://e.org/%s\nWHY: w\nLAST: never read\nOFFER: o\nSTATUS: verified %s\nHOT: no\n\n' "\$i" "\$GOAL" "\$DAY" "\$i" "\$DAY" >> "\$R/people.md"; done
echo "Learned one thing for \$GOAL."
STAND
chmod +x "$B/claude"
run() { HOME="$TMP/home" PATH="$B:$PATH" GODSPEED_RUNNER=claude bash "$HERE/mc-research" --godspeed "$G" --date 2026-10-12 "$@" 2>&1; }

echo "mc-research gate"
OUT="$(run)"; check "two good nights exit 0" "$?" "0"
check "  both goals ran" "$(sort "$TMP/ran" | tr '\n' ' ')" "health money "
check "  each has tonight's day record" "$(ls "$G"/goals/research/*/days/2026-10-12.md | wc -l | tr -d ' ')" "2"
contains "  the summary names each goal's answer" "$(cat "$G/routines/research/2026-10-12/summary.txt")" "money: done"
rm -f "$TMP/ran"
OUT="$(run)"; check "a second run the same night does nothing" "$(cat "$TMP/ran" 2>/dev/null | wc -l | tr -d ' ')" "0"

export GODSPEED_TODAY=2026-10-13
echo health > "$TMP/fail-these"; rm -f "$TMP/ran"
OUT="$(HOME="$TMP/home" PATH="$B:$PATH" GODSPEED_RUNNER=claude bash "$HERE/mc-research" --godspeed "$G" --date 2026-10-13 2>&1)"
check "a night that fails exits 1" "$?" "1"
check "  and leaves a gap file" "$(test -f "$G/goals/research/health/days/2026-10-13.gap.md" && echo yes)" "yes"
check "  it was sent back once, so it ran twice" "$(grep -c '^health$' "$TMP/ran")" "2"
contains "  the summary says it did not complete" "$(cat "$G/routines/research/2026-10-13/summary.txt")" "health: NOT COMPLETED"
check "  and the gap is not counted as a night" "$(hg research health --state --date 2026-10-13 | cut -d' ' -f2)" "founding;"

export GODSPEED_TODAY=2026-10-14
rm -f "$TMP/fail-these" "$TMP/ran"
OUT="$(HOME="$TMP/home" PATH="$B:$PATH" GODSPEED_RUNNER=claude bash "$HERE/mc-research" --godspeed "$G" --date 2026-10-14 --budget-minutes 0 2>&1)"
check "a spent budget exits 1" "$?" "1"
contains "  and names who was skipped" "$(cat "$G/routines/research/2026-10-14/summary.txt")" "skipped for time:"
rm -f "$TMP/ran"
OUT="$(HOME="$TMP/home" PATH="$B:$PATH" GODSPEED_RUNNER=claude bash "$HERE/mc-research" --godspeed "$G" --date 2026-10-14 --only money 2>&1)"
check "--only runs just the named goal" "$(cat "$TMP/ran" | tr '\n' ' ')" "money "
OUT="$(HOME="$TMP/home" PATH="$B:$PATH" GODSPEED_RUNNER=claude bash "$HERE/mc-research" --godspeed "$G" --date 2026-10-14 --dry-run 2>&1)"
contains "--dry-run lists what would run" "$OUT" "health"

# A FOUNDED goal whose night writes a day record that fails the check (under 150 words): the
# record is set aside, a gap file is written, and the goal is neither "last night: that date" nor
# out of the due list.
export GODSPEED_TODAY=2026-10-15
hg file --kind outcome --title "Sleep" --id sleep --area health --status adopted --source x >/dev/null
hg research sleep >/dev/null
S="$G/goals/research/sleep"
i=0; while [ $i -lt 30 ]; do i=$((i+1)); printf 'PERSON: S%s
LINK: https://e.org/s%s
WHY: w
LAST: never read
OFFER: o
STATUS: verified 2026-10-01
HOT: no

' "$i" "$i" >> "$S/people.md"; done
i=0; while [ $i -lt 5 ]; do i=$((i+1)); printf 'CASE: C%s
START: s
DID: d
RESULT: r
SOURCE: https://e.org/c%s (read 2026-10-01)

' "$i" "$i" >> "$S/cases.md"; done
i=0; while [ $i -lt 10 ]; do i=$((i+1)); printf 'CLAIM: K%s
STATUS: supported 2026-10-01
SOURCE: https://e.org/k%s (read 2026-10-01)
QUOTE: "q"
MEANS: m

' "$i" "$i" >> "$S/claims.md"; done
mkdir -p "$S/days"; printf '# sleep 2026-10-13
' > "$S/days/2026-10-13.md"
check "a founded goal reads as founded" "$(hg research sleep --state --date 2026-10-15 | cut -d' ' -f2)" "stale;"
echo sleep > "$TMP/short-day"; rm -f "$TMP/ran"
OUT="$(HOME="$TMP/home" PATH="$B:$PATH" GODSPEED_RUNNER=claude bash "$HERE/mc-research" --godspeed "$G" --date 2026-10-15 --only sleep 2>&1)"
check "a night whose record fails the check exits 1" "$?" "1"
check "  and leaves a gap file" "$(test -f "$S/days/2026-10-15.gap.md" && echo yes)" "yes"
check "  the failed record is set aside" "$(test -f "$S/days/2026-10-15.md" && echo still-there || echo set-aside)" "set-aside"
contains "  and the gap file says so" "$(cat "$S/days/2026-10-15.gap.md")" "unchecked"
check "  the goal's last night is not that date" "$(hg research sleep --state --json --date 2026-10-15 | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).last))')" "2026-10-13"
contains "  and it is still due" "$(hg research --due --date 2026-10-15)" "sleep"
rm -f "$TMP/short-day"

# The budget bounds the finish: a budget smaller than one night's timeout skips the goal by name.
rm -f "$TMP/ran"
OUT="$(HOME="$TMP/home" PATH="$B:$PATH" GODSPEED_RUNNER=claude bash "$HERE/mc-research" --godspeed "$G" --date 2026-10-15 --only money --budget-minutes 5 2>&1)"
check "a budget shorter than one night exits 1" "$?" "1"
contains "  and names the goal it skipped" "$(cat "$G/routines/research/2026-10-15/summary.txt")" "skipped for time: money"
check "  without starting it" "$(cat "$TMP/ran" 2>/dev/null | wc -l | tr -d ' ')" "0"

# A gap file is written BEFORE each goal's run and removed when the night passes its check, so a run
# that is killed part way is never read as done; a goal skipped for time gets one too.
export GODSPEED_TODAY=2026-10-16
rm -f "$TMP/ran" "$TMP/gap-during"
OUT="$(HOME="$TMP/home" PATH="$B:$PATH" GODSPEED_RUNNER=claude bash "$HERE/mc-research" --godspeed "$G" --date 2026-10-16 --only money 2>&1)"
check "a good night exits 0" "$?" "0"
check "  the gap file was already there while the goal ran" "$(cat "$TMP/gap-during" 2>/dev/null | tr '
' ' ')" "money "
check "  and is gone once the night passed its check" "$(test -f "$G/goals/research/money/days/2026-10-16.gap.md" && echo still-there || echo gone)" "gone"
check "  the night counts" "$(hg research money --state --json --date 2026-10-16 | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).last))')" "2026-10-16"
# A run killed mid-goal: the day record is there, the pre-written gap file is still beside it.
export GODSPEED_TODAY=2026-10-17
M="$G/goals/research/money/days"
cp "$M/2026-10-16.md" "$M/2026-10-17.md"; printf '# money 2026-10-17: started, not finished
' > "$M/2026-10-17.gap.md"
check "a killed night does not count as a night" "$(hg research money --state --json --date 2026-10-17 | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).last))')" "2026-10-16"
contains "  and the goal is still due" "$(hg research --due --date 2026-10-17)" "money"
rm -f "$TMP/ran"
OUT="$(HOME="$TMP/home" PATH="$B:$PATH" GODSPEED_RUNNER=claude bash "$HERE/mc-research" --godspeed "$G" --date 2026-10-17 --only money --budget-minutes 5 2>&1)"
contains "  a goal skipped for time says so in its own folder" "$(cat "$M/2026-10-17.gap.md")" "skipped for time"

echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
