#!/usr/bin/env bash
# The gate for mc-research: every due goal gets its night, a failed night leaves a gap file and a
# loud exit, and the time budget skips the most recently researched goals, by name.
#
# `bash tools/test-research.sh --live` also runs one small real night through this computer's
# claude (its own login), in a throwaway mission control: it moves into the goal's folder, then
# saves inside and tries to save outside. It costs a few cents and needs a logged-in Claude Code.
set -uo pipefail
LIVE=0; [ "${1:-}" = --live ] && LIVE=1
# The guard below empties these; the live run needs the real ones for its login.
REAL_HOME="$HOME"; REAL_USERPROFILE="${USERPROFILE:-}"; REAL_APPDATA="${APPDATA:-}"; REAL_LOCALAPPDATA="${LOCALAPPDATA:-}"; REAL_CCD="${CLAUDE_CONFIG_DIR:-}"
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
missing()  { case "$2" in *"$3"*) bad "$1 (should not contain [$3])";; *) ok "$1";; esac; }
hg() { GODSPEED_ROOT="$G" "$NODE" "$HERE/goals.js" "$@"; }
hg file --kind outcome --title "Money" --id money --area money --status adopted --source x >/dev/null
hg file --kind outcome --title "Health" --id health --area health --status adopted --source x >/dev/null

# THE STAND-IN for claude: reads the goal from the prompt and writes a complete night, unless the
# goal is named in $TMP/fail-these, in which case it writes nothing.
cat > "$B/claude" <<STAND
#!/bin/sh
# Asked what it knows (mc-run does, to bind the tool list), it answers like a current Claude Code.
[ "\$1" = --help ] && { printf '  --restricted  Restricted mode\n  --permission-mode <mode>  ("dontAsk")\n  --strict-mcp-config\n'; exit 0; }
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

# ITS COMMIT HOLDS ONLY ITS OWN FILES, AND ITS SUMMARY THE ANSWER'S LAST PARAGRAPH (2026-10-13). The
# first nights on the server staged all of goals/, ideas/ and routines/, so another job's briefing
# file and a running night's .tmp answer went into "Research <date>" commits; and the summary
# carried the assistant's first lines ("The three helpers are still working; ...") instead of its
# final sentence. A mission control in git, with another job's files lying around.
echo "-- the commit and the summary"
export GODSPEED_TODAY=2026-10-18
G2="$TMP/g2"; B2="$TMP/bin2"; mkdir -p "$G2/rules" "$G2/skills/goal-research" "$G2/routines/briefing" "$G2/ideas" "$B2"
cp "$HERE/../starter-godspeed/skills/goal-research/SKILL.md" "$G2/skills/goal-research/SKILL.md"
: > "$G2/AGENTS.md"
h2() { GODSPEED_ROOT="$G2" "$NODE" "$HERE/goals.js" "$@"; }
h2 file --kind outcome --title "Money" --id money --area money --status adopted --source x >/dev/null
h2 file --kind outcome --title "Sleep" --id sleep --area health --status adopted --source x >/dev/null
h2 file --kind outcome --title "Travel" --id travel --area other --status provisional --source x >/dev/null
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.org GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.org
git -C "$G2" init -q && git -C "$G2" add -A && git -C "$G2" commit -q -m start
# Another job's files: a half-written briefing, one it staged and has not committed yet, an idea it
# is writing, its change to a goal card the night does not touch, and a running night's .tmp answer.
echo "half a briefing" > "$G2/routines/briefing/2026-10-18.md"
echo "staged by another job" > "$G2/routines/briefing/staged.md"; git -C "$G2" add routines/briefing/staged.md
echo "another job's idea" > "$G2/ideas/another-job.md"
printf '\nanother job was here\n' >> "$G2/goals/travel.md"
mkdir -p "$G2/routines/research/2026-10-18"; : > "$G2/routines/research/2026-10-18/other.answer.txt.tmp"
cat > "$B2/claude" <<STAND
#!/bin/sh
# STAND_OLD=1: a Claude Code that knows neither --restricted nor --setting-sources.
[ "\$1" = --help ] && { [ -n "\${STAND_OLD:-}" ] || printf '  --restricted  Restricted mode\n  --permission-mode <mode>  ("dontAsk")\n  --strict-mcp-config\n'; exit 0; }
printf '[%s]\n' "\$@" > "$TMP/b2.args"
P="\$(cat)"
GOAL="\$(printf '%s' "\$P" | sed -n 's/.*Goal: \([a-z0-9-]*\)\. Mode.*/\1/p' | head -1)"
DAY="\$(printf '%s' "\$P" | sed -n 's/.*Today is \([0-9-]*\) (UTC).*/\1/p' | head -1)"
# A goal named in fail-once-<goal> writes nothing the first time, so the fix round runs.
if [ -f "$TMP/fail-once-\$GOAL" ]; then rm -f "$TMP/fail-once-\$GOAL"; echo "First try, nothing written."; exit 0; fi
R="$G2/goals/research/\$GOAL"
printf '# %s\n\n## Searched\n%s\n\n## Found\nx\n\n## Changed in the files\nx\n' "\$GOAL" "\$(printf 'word %.0s' \$(seq 1 160))" > "\$R/days/\$DAY.md"
sed -i "s/^UPDATED: .*/UPDATED: \$DAY/" "\$R/brief.md"
i=0; while [ \$i -lt 30 ]; do i=\$((i+1)); printf 'PERSON: P%s %s\nLINK: https://e.org/%s\nWHY: w\nLAST: never read\nOFFER: o\nSTATUS: verified %s\nHOT: no\n\n' "\$i" "\$DAY" "\$i" "\$DAY" >> "\$R/people.md"; done
printf 'TITLE: an opening for %s\n' "\$GOAL" > "$G2/ideas/\$GOAL-opening.md"
printf '\nNOTE: changed by tonight\n' >> "$G2/goals/\$GOAL.md"
if printf '%s' "\$P" | grep -q "is not finished"; then
  printf 'Fixed the gaps for %s.\n' "\$GOAL"
elif [ "\$GOAL" = money ]; then
  printf 'The three helpers are still working; I will assemble the files as soon as they report.\n\nThirty people are verified; still waiting on the cases helper.\n\n\nProtein is what limits this goal now.\n\n'
else
  printf 'Waiting on one helper.\n\n%s\n' "\$(printf 'long %.0s' \$(seq 1 150))"
fi
STAND
chmod +x "$B2/claude"
OUT="$(HOME="$TMP/home" PATH="$B2:$PATH" GODSPEED_RUNNER=claude bash "$HERE/mc-research" --godspeed "$G2" --date 2026-10-18 2>&1)"
check "two good nights exit 0" "$?" "0"
check "  one commit was made" "$(git -C "$G2" log --format=%s | head -1)" "Research 2026-10-18"
IN="$(git -C "$G2" show --name-only --format= HEAD)"
contains "  it holds the research folders" "$IN" "goals/research/money/days/2026-10-18.md"
contains "  tonight's run folder" "$IN" "routines/research/2026-10-18/summary.txt"
contains "  the ideas the night filed" "$IN" "ideas/money-opening.md"
contains "  and the goal card the night changed" "$IN" "goals/money.md"
for f in routines/briefing/2026-10-18.md routines/briefing/staged.md ideas/another-job.md goals/travel.md routines/research/2026-10-18/other.answer.txt.tmp; do
  case "$IN" in *"$f"*) bad "  $f is not in it";; *) ok "  $f is not in it";; esac
done
contains "  the file another job staged is still staged for it" "$(git -C "$G2" diff --cached --name-only)" "routines/briefing/staged.md"
contains "  its change to its card is still there, uncommitted" "$(git -C "$G2" diff --name-only)" "goals/travel.md"
S2="$(cat "$G2/routines/research/2026-10-18/summary.txt")"
contains "the summary line is the answer's last paragraph" "$S2" "money: done (founding): Protein is what limits this goal now."
case "$S2" in *"helpers are still working"*|*"still waiting"*) bad "  and not the interim lines";; *) ok "  and not the interim lines";; esac
LINE="$(grep '^sleep: done' "$G2/routines/research/2026-10-18/summary.txt")"
case "$LINE" in *"Waiting on one helper"*) bad "  a long last paragraph is used too";; "sleep: done (founding): long long"*) ok "  a long last paragraph is used too";; *) bad "  a long last paragraph is used too (got [$LINE])";; esac
N="$(printf '%s' "${LINE#sleep: done (founding): }" | wc -c | tr -d ' ')"
[ "$N" -le 400 ] && ok "  and cut at 400 characters ($N)" || bad "  and cut at 400 characters (it has $N)"

# THE NIGHT WRITES ONLY ITS OWN FOLDERS (2026-10-13). A bare Write or Edit let a night write
# anywhere in the mission control, which holds what later runs execute with the whole shell. The
# list names goal research and ideas only, and mc-run runs claude in dontAsk, not acceptEdits.
A2="$(cat "$TMP/b2.args" 2>/dev/null)"
# The mission control's folder as Claude Code matches a path (C:/x is /c/x on Windows).
G2C="$(cd "$G2" && pwd)"; command -v cygpath >/dev/null 2>&1 && G2C="$(cygpath -m "$G2C" | sed -E 's#^([A-Za-z]):#/\L\1#')"
contains "the night's list writes only in goals/research and ideas, of this mission control" "$A2" "[Edit(/$G2C/goals/research/**)]
[Edit(/$G2C/ideas/**)]"
case "$A2" in *"[Write]"*|*"[Edit]"*) bad "  and has no bare Write or Edit";; *) ok "  and has no bare Write or Edit";; esac
# Claude Code never reads a Write(<path>) rule (Edit rules hold every file tool) and warns about one.
missing "  and no Write(...) rule, which Claude Code never reads" "$A2" "[Write("
contains "  claude runs in dontAsk" "$A2" "[--permission-mode]
[dontAsk]"
missing "  never acceptEdits" "$A2" "acceptEdits"

# A CHANGE ANOTHER STEP ALREADY STAGED in a research folder goes into the night's commit too
# (ls-files -m misses a change whose working copy matches what is staged).
export GODSPEED_TODAY=2026-10-19
printf 'staged before the night\n' >> "$G2/goals/research/sleep/brief.md"; git -C "$G2" add goals/research/sleep/brief.md
# THE SUMMARY TAKES THE FIX ROUND'S ANSWER when the fix round ran.
: > "$TMP/fail-once-money"
OUT="$(HOME="$TMP/home" PATH="$B2:$PATH" GODSPEED_RUNNER=claude bash "$HERE/mc-research" --godspeed "$G2" --date 2026-10-19 --only money 2>&1)"
check "a night fixed in its fix round exits 0" "$?" "0"
contains "  its summary line is the fix round's answer" "$(cat "$G2/routines/research/2026-10-19/summary.txt")" "money: done (founding): Fixed the gaps for money."
contains "  a staged change in a research folder is in the night's commit" "$(git -C "$G2" show --name-only --format= HEAD)" "goals/research/sleep/brief.md"

# A CLAUDE THAT CANNOT BE HELD to the list: mc-run says so beside the answer, and the summary says it.
export GODSPEED_TODAY=2026-10-20
OUT="$(HOME="$TMP/home" PATH="$B2:$PATH" GODSPEED_RUNNER=claude STAND_OLD=1 bash "$HERE/mc-research" --godspeed "$G2" --date 2026-10-20 --only money 2>&1)"
contains "a claude that knows neither switch is named in the summary" "$(cat "$G2/routines/research/2026-10-20/summary.txt")" "was not held to its list of tools, because"
contains "  with mc-run's reason" "$(cat "$G2/routines/research/2026-10-20/summary.txt")" "knows neither --restricted nor --setting-sources"
check "  said once" "$(grep -c 'not held' "$G2/routines/research/2026-10-20/summary.txt")" "1"

# AN mc-run OLDER THAN mc-research cannot hold the night to its list; the summary says so instead of
# staying silent. A copy of the tools whose mc-run binds the list but approves every edit (no dontAsk).
OLD="$TMP/old"; mkdir -p "$OLD"
cp "$HERE/mc-research" "$HERE/goals.js" "$HERE/mc-cards.js" "$HERE/check-research.js" "$OLD/"
sed 's/dontAsk/oldMode/g' "$HERE/mc-run" > "$OLD/mc-run"
export GODSPEED_TODAY=2026-10-21
OUT="$(HOME="$TMP/home" PATH="$B2:$PATH" GODSPEED_RUNNER=claude bash "$OLD/mc-research" --godspeed "$G2" --date 2026-10-21 --only money 2>&1)"
contains "an older mc-run is named in the summary" "$(cat "$G2/routines/research/2026-10-21/summary.txt")" "older than mc-research"

# THE BUDGET KEEPS ROOM FOR THE TWO CHECKS that read tonight's quotes again (15 s a page, at most
# --fetch-quotes pages each): a budget that fits the night and its fix round but not the checks
# skips the goal; with no pages to read, the same budget fits.
export GODSPEED_TODAY=2026-10-22
rm -f "$TMP/ran"
OUT="$(HOME="$TMP/home" PATH="$B2:$PATH" GODSPEED_RUNNER=claude bash "$HERE/mc-research" --godspeed "$G2" --date 2026-10-22 --only sleep --budget-minutes 16 --timeout-daily 30 --timeout-founding 30 2>&1)"
check "a budget with no room for the two checks exits 1" "$?" "1"
contains "  and skips the goal by name" "$(cat "$G2/routines/research/2026-10-22/summary.txt")" "skipped for time: sleep"
OUT="$(HOME="$TMP/home" PATH="$B2:$PATH" GODSPEED_RUNNER=claude bash "$HERE/mc-research" --godspeed "$G2" --date 2026-10-22 --only sleep --budget-minutes 16 --timeout-daily 30 --timeout-founding 30 --fetch-quotes 0 2>&1)"
check "  the same budget fits when the checks read no pages" "$?" "0"

# A NIGHT THAT MOVES INTO ITS GOAL'S FOLDER STILL SAVES THERE, AND ONLY THERE (2026-10-15). Claude
# Code reads a plain path in an Edit rule against its CURRENT folder, and its shell keeps a cd. The
# financial-security night began with `cd goals/research/financial-security && ls` and never went
# back, so Edit(goals/research/**) pointed into goals/research/financial-security/goals/research/
# and every save was refused, twice. This stand-in holds its file tools to its Edit rules the way
# Claude Code does (checked with real runs, see mc-run's anchor_rules): //x is the absolute x, ~/x
# the home's, /x the folder it started in, x the folder it is in now. Its first act is that cd.
# Then it saves a whole night and tries files outside goals/research/ and ideas/.
echo "-- a night that moves into its goal's folder first"
export GODSPEED_TODAY=2026-10-23
G3="$TMP/mission control three"; B3="$TMP/bin3"; mkdir -p "$G3/rules" "$G3/skills/goal-research" "$G3/ideas" "$G3/routines" "$B3"
cp "$HERE/../starter-godspeed/skills/goal-research/SKILL.md" "$G3/skills/goal-research/SKILL.md"
: > "$G3/AGENTS.md"
GODSPEED_ROOT="$G3" "$NODE" "$HERE/goals.js" file --kind outcome --title "Money" --id money --area money --status adopted --source x >/dev/null
cat > "$TMP/cd-claude.js" <<'JS'
const fs = require("fs"), path = require("path");
const log = process.argv[2], args = process.argv.slice(3);
const at = args.indexOf("--allowedTools"), rules = at >= 0 ? args.slice(at + 1) : [];
let prompt = ""; try { prompt = fs.readFileSync(0, "utf8"); } catch (e) {}
const goal = (prompt.match(/Goal: ([a-z0-9-]+)\. Mode/) || [])[1], day = (prompt.match(/Today is ([0-9-]+) \(UTC\)/) || [])[1];
// As Claude Code matches a path: forward slashes, and C:\x is /c/x.
const posix = (p) => { p = p.replace(/\\/g, "/"); const m = p.match(/^([A-Za-z]):\/?(.*)$/); return m ? "/" + m[1].toLowerCase() + "/" + m[2] : p; };
const start = process.cwd(), home = process.env.HOME || "";
const cwd = path.join(start, "goals", "research", goal); // the night's first command: cd goals/research/<goal>
const anchor = (p) => p.startsWith("//") ? p.slice(1) : p.startsWith("~/") ? posix(home) + p.slice(1)
  : p.startsWith("/") ? posix(start) + p : posix(cwd) + "/" + p.replace(/^\.\//, "");
const regex = (pat) => { let re = "";
  for (let i = 0; i < pat.length; i++) {
    const c = pat[i];
    if (c === "\\" && i + 1 < pat.length) re += pat[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    else if (pat.startsWith("/**", i) && i + 3 === pat.length) { re += "/.*"; i += 2; }
    else if (pat.startsWith("**/", i)) { re += "(?:.*/)?"; i += 2; }
    else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + re + "$"); };
const allowed = (f) => rules.some((r) => { const m = r.match(/^Edit\((.*)\)$/); return !!m && regex(anchor(m[1])).test(posix(f)); });
const save = (rel, change) => { // rel is written from the goal's folder, where the night now is
  const f = path.resolve(cwd, rel), ok = allowed(f);
  fs.appendFileSync(log, (ok ? "allowed " : "refused ") + path.relative(start, f).replace(/\\/g, "/") + "\n");
  if (!ok) return; fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, change(fs.existsSync(f) ? fs.readFileSync(f, "utf8") : ""));
};
save(`days/${day}.md`, () => `# ${goal}\n\n## Searched\n${"word ".repeat(160)}\n\n## Found\nx\n\n## Changed in the files\nx\n`);
save("brief.md", (t) => t.replace(/^UPDATED: .*/m, `UPDATED: ${day}`));
save("people.md", (t) => t + Array.from({ length: 30 }, (_, i) => `PERSON: P${i} ${day}\nLINK: https://e.org/${i}\nWHY: w\nLAST: never read\nOFFER: o\nSTATUS: verified ${day}\nHOT: no\n\n`).join(""));
save(`../../../ideas/${goal}-opening.md`, () => `TITLE: an opening for ${goal}\n`);
save("../../../skills/planted/SKILL.md", () => "planted\n");
save(`../../${goal}.md`, (t) => t + "\nplanted\n");
save(path.join(start, "routines", "planted.sh"), () => "planted\n");
console.log(`Saved tonight's research for ${goal}.`);
JS
cat > "$B3/claude" <<STAND
#!/bin/sh
[ "\$1" = --help ] && { printf '  --restricted  Restricted mode\n  --permission-mode <mode>  ("dontAsk")\n  --strict-mcp-config\n'; exit 0; }
exec "$NODE" "$TMP/cd-claude.js" "$TMP/cd.log" "\$@"
STAND
chmod +x "$B3/claude"
night3() { # tools-folder date
  rm -f "$TMP/cd.log"
  HOME="$TMP/home" PATH="$B3:$PATH" GODSPEED_RUNNER=claude bash "$1/mc-research" --godspeed "$G3" --date "$2" --only money >/dev/null 2>&1
}
# Before the fix: mc-research's plain paths, and an mc-run that passed them on as written.
OLD3="$TMP/old3"; NEWRES="$TMP/newres"; NEWRUN="$TMP/newrun"; mkdir -p "$OLD3" "$NEWRES" "$NEWRUN"
for d in "$OLD3" "$NEWRES" "$NEWRUN"; do cp "$HERE/goals.js" "$HERE/mc-cards.js" "$HERE/check-research.js" "$d/"; done
sed 's#Edit(/goals/research/\*\*) Edit(/ideas/\*\*)#Edit(goals/research/**) Edit(ideas/**)#' "$HERE/mc-research" > "$OLD3/mc-research"
sed '/^  anchor_rules$/d' "$HERE/mc-run" > "$OLD3/mc-run"
grep -q 'Edit(goals/research/\*\*) Edit(ideas/\*\*)' "$OLD3/mc-research" && ! grep -q '^  anchor_rules$' "$OLD3/mc-run" \
  && ok "the copy from before the fix is what ran on 2026-10-15" || bad "the copy from before the fix could not be made"
night3 "$OLD3" 2026-10-23; rc=$?
check "before the fix, a night that moved into its folder fails (as on 2026-10-15)" "$rc" "1"
contains "  its saves in its own folder were refused" "$(cat "$TMP/cd.log" 2>/dev/null)" "refused goals/research/money/days/2026-10-23.md"
check "  and it left a gap file" "$(test -f "$G3/goals/research/money/days/2026-10-23.gap.md" && echo yes)" "yes"
# Today's mc-research with yesterday's mc-run: its /paths already mean the mission control.
cp "$HERE/mc-research" "$NEWRES/"; cp "$OLD3/mc-run" "$NEWRES/"
export GODSPEED_TODAY=2026-10-24
night3 "$NEWRES" 2026-10-24; check "today's mc-research holds even with an older mc-run" "$?" "0"
# Yesterday's mc-research with today's mc-run: the plain paths are anchored at the mission control.
cp "$OLD3/mc-research" "$NEWRUN/"; cp "$HERE/mc-run" "$NEWRUN/"
export GODSPEED_TODAY=2026-10-25
night3 "$NEWRUN" 2026-10-25; check "today's mc-run holds even an older mc-research's plain paths" "$?" "0"
export GODSPEED_TODAY=2026-10-26
night3 "$HERE" 2026-10-26; check "after the fix, a night that moved into its folder completes" "$?" "0"
LOG3="$(cat "$TMP/cd.log" 2>/dev/null)"
check "  its day record is there" "$(test -f "$G3/goals/research/money/days/2026-10-26.md" && echo yes)" "yes"
check "  with no gap file beside it" "$(test -f "$G3/goals/research/money/days/2026-10-26.gap.md" && echo still-there || echo gone)" "gone"
contains "  its edit of a file it already had went through" "$LOG3" "allowed goals/research/money/people.md"
check "  the idea it filed is there" "$(test -f "$G3/ideas/money-opening.md" && echo yes)" "yes"
for f in skills/planted/SKILL.md goals/money.md routines/planted.sh; do
  contains "  a save to $f was refused" "$LOG3" "refused $f"
done
check "  no recipe was planted" "$(test -e "$G3/skills/planted" && echo planted || echo none)" "none"
missing "  the goal card was not changed" "$(cat "$G3/goals/money.md")" "planted"
check "  no routine was planted" "$(test -e "$G3/routines/planted.sh" && echo planted || echo none)" "none"

# THE SAME WITH A REAL CLAUDE (--live only). Through the real mc-run, with mc-research's own list,
# in a throwaway mission control whose name has a space and [ ] in it.
if [ "$LIVE" -eq 1 ]; then
  echo "-- live: a real claude moves into the goal's folder, then saves"
  LV="$TMP/mission control [live]"; mkdir -p "$LV/rules" "$LV/skills/cd-then-save" "$LV/goals/research/money/days" "$LV/ideas" "$LV/routines"
  echo "old" > "$LV/goals/research/money/people.md"
  LW="$LV"; command -v cygpath >/dev/null 2>&1 && LW="$(cygpath -m "$LV")"
  cat > "$LV/skills/cd-then-save/SKILL.md" <<SKILL
Do exactly these steps with your tools, one at a time. When a step fails, go on with the next. Do nothing else.
1. Bash: cd goals/research/money && ls
2. Edit tool: in $LW/goals/research/money/people.md replace old with new.
3. Write tool: create $LW/goals/research/money/days/2026-10-15.md with the text: day
4. Write tool: create $LW/ideas/money-opening.md with the text: idea
5. Write tool: create $LW/routines/notes.md with the text: note
6. Write tool: create $LW/goals/notes.md with the text: note
Then answer with one line per step: STEP <n>: and the first 80 characters of what the tool answered.
SKILL
  TOOLS_LIVE="$(sed -n 's/^TOOLS="\(.*\)"$/\1/p' "$HERE/mc-research")"
  contains "  the list is mc-research's own" "$TOOLS_LIVE" "Edit(/goals/research/**)"
  REAL=(HOME="$REAL_HOME")
  for v in USERPROFILE="$REAL_USERPROFILE" APPDATA="$REAL_APPDATA" LOCALAPPDATA="$REAL_LOCALAPPDATA" CLAUDE_CONFIG_DIR="$REAL_CCD"; do
    [ -n "${v#*=}" ] && REAL+=("$v")
  done
  env "${REAL[@]}" GODSPEED_RUNNER=claude bash "$HERE/mc-run" cd-then-save --godspeed "$LV" \
    --timeout 600 --out "$TMP/live.txt" --allowed-tools "$TOOLS_LIVE"
  echo "  the assistant answered:"; sed 's/^/    /' "$TMP/live.txt"
  check "  after its cd, its edit in the goal's folder went through" "$(cat "$LV/goals/research/money/people.md")" "new"
  check "  its day record was saved" "$(cat "$LV/goals/research/money/days/2026-10-15.md" 2>/dev/null | tr -d '\r\n')" "day"
  check "  its idea was saved" "$(cat "$LV/ideas/money-opening.md" 2>/dev/null | tr -d '\r\n')" "idea"
  check "  a save in routines/ was refused" "$(test -e "$LV/routines/notes.md" && echo saved || echo refused)" "refused"
  check "  a save to a goal card's folder was refused" "$(test -e "$LV/goals/notes.md" && echo saved || echo refused)" "refused"
  contains "  and the refusals were Claude Code's own" "$(grep -iE '^STEP [56]:' "$TMP/live.txt" | tr 'A-Z' 'a-z')" "denied"
fi

echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
