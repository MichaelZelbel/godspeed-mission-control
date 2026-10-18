#!/usr/bin/env bash
# The gate for mc-coach-prep: each coaching talk is prepared the day before it, with the coach-prep
# recipe, through mc-run, and only a file the coach itself calls ready counts. A talk further ahead
# waits, a prepared talk is left alone, a refresh that fails puts the older preparation back, the
# time budget skips a talk by name, a talk named by hand is prepared whenever it is, and the commit
# holds only the preparation and the run's own folder. The coach's clock is frozen with GODSPEED_NOW
# at Saturday 24 October 2026, 03:00 in Berlin (01:00 UTC).
set -uo pipefail
. "$(dirname "$0")/test-guard.bash"
HERE="$(cd "$(dirname "$0")" && pwd)"
NODE=""; for c in node nodejs /usr/local/bin/node /usr/bin/node; do "$c" -e '' >/dev/null 2>&1 && { NODE="$c"; break; }; done
NODE="$(command -v "$NODE")"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP" "$TEST_GUARD_HOME"' EXIT
P() { if command -v cygpath >/dev/null 2>&1; then cygpath -m "$1"; else printf '%s' "$1"; fi; }
G="$(P "$TMP/g")"; B="$TMP/bin"; mkdir -p "$G/rules" "$G/skills/coach-prep" "$B" "$TMP/home"
cp "$HERE/../notebook/recipes/coach-prep/SKILL.md" "$G/skills/coach-prep/SKILL.md"
: > "$G/AGENTS.md"
area() { # slug title rhythm time
  mkdir -p "$G/coach/$1"
  printf 'AREA: %s\nTITLE: %s\nRHYTHM: %s\nTIME: %s\nSTARTS: 2026-10-01\nSTATUS: on\nSTYLE: review\nTONE: gentle\nSERVES: run-10k\n\n## Preparation\nRead the goal and its research.\n' "$1" "$2" "$3" "$4" > "$G/coach/$1/area.md"
}
mkdir -p "$G/coach"; printf '{"timezone":"Europe/Berlin","git_sync":"off"}\n' > "$G/coach/settings.json"
area weekly-check-in "Weekly check-in" "weekly sunday" "18:00"
area health "Health" "weekly monday" "19:00"
export GODSPEED_NOW=2026-10-24T01:00:00Z GODSPEED_TODAY=2026-10-24
export GODSPEED_COACH_SCRIPT="$(P "$HERE/../third-party/addons/godspeed-coach/bin/godspeed-coach.mjs")" GODSPEED_COACH_GIT_SYNC=off
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
check()    { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (wanted [$3], got [$2])"; fi; }
contains() { case "$2" in *"$3"*) ok "$1";; *) bad "$1 (missing [$3] in: $(printf '%s' "$2" | head -5))";; esac; }
missing()  { case "$2" in *"$3"*) bad "$1 (should not contain [$3])";; *) ok "$1";; esac; }

# THE STAND-IN for claude: finds the file the prompt names and writes a preparation there. What it
# writes is set per area by files in $TMP: <area>.draft (STATE draft), <area>.nothing (no file),
# <area>.undated (no PREPARED line); otherwise a ready file dated with the prompt's "Now:".
cat > "$B/claude" <<STAND
#!/bin/sh
[ "\$1" = --help ] && { printf '  --restricted  Restricted mode\n  --permission-mode <mode>  ("dontAsk")\n  --strict-mcp-config\n'; exit 0; }
printf '[%s]\n' "\$@" > "$TMP/args"
P="\$*"; [ -t 0 ] || P="\$P \$(cat)"
printf '%s\n' "\$P" > "$TMP/prompt"
F="\$(printf '%s' "\$P" | sed -n 's/.*and write \(coach\/[a-z0-9-]*\/prep\/[0-9-]*\.md\)\..*/\1/p' | head -1)"
A="\$(printf '%s' "\$F" | cut -d/ -f2)"; D="\$(basename "\$F" .md)"
NOW="\$(printf '%s' "\$P" | sed -n 's/.*Now: \([0-9TZ:-]*\) (UTC).*/\1/p' | head -1)"
echo "\$A \$D" >> "$TMP/ran"
[ -f "$TMP/\$A.nothing" ] && { echo "I could not finish."; exit 1; }
STATE=ready; [ -f "$TMP/\$A.draft" ] && STATE=draft
DATED="PREPARED: \$NOW
"; [ -f "$TMP/\$A.undated" ] && DATED=""
mkdir -p "$G/coach/\$A/prep"
printf 'AREA: %s\nTALK: %s 18:00\n%sSTATE: %s\n\n## The opening\nFrom your coach, your weekly check-in: you are at 4 km. Book the race?\n\n## Talk card\nOne move: book the race. Longest run 4 km (2026-10-20, the tracker).\n\n## Where they stand\n- 4 km\n' "\$A" "\$D" "\$DATED" "\$STATE" > "$G/\$F"
echo "Prepared the talk of \$D."
STAND
chmod +x "$B/claude"
run() { PATH="$B:$PATH" GODSPEED_RUNNER=claude bash "$HERE/mc-coach-prep" --godspeed "$G" "$@" 2>&1; }

echo "mc-coach-prep gate"
OUT="$(run --dry-run)"; check "a dry run exits 0" "$?" "0"
contains "  it would prepare tomorrow's weekly check-in" "$OUT" "Weekly check-in (weekly-check-in), 2026-10-25 at 18:00 Europe/Berlin -> coach/weekly-check-in/prep/2026-10-25.md"
missing "  and not Monday's health talk, which is two days away" "$OUT" "health"
check "  and runs nothing" "$(test -f "$TMP/ran" && echo ran || echo nothing)" "nothing"

OUT="$(run)"; check "a talk prepared the day before exits 0" "$?" "0"
check "  only that talk ran" "$(cat "$TMP/ran")" "weekly-check-in 2026-10-25"
F="$G/coach/weekly-check-in/prep/2026-10-25.md"
contains "  its file is ready" "$(cat "$F")" "STATE: ready"
check "  the coach agrees" "$("$NODE" "$GODSPEED_COACH_SCRIPT" prep-check weekly-check-in --date 2026-10-25 --godspeed "$G" | cut -d, -f1)" "ready: coach/weekly-check-in/prep/2026-10-25.md"
contains "  the summary says so" "$(cat "$G/routines/coach-prep/2026-10-24/summary.txt")" "weekly-check-in 2026-10-25: prepared (coach/weekly-check-in/prep/2026-10-25.md): Prepared the talk of 2026-10-25."
PR="$(cat "$TMP/prompt")"
contains "  the prompt names the talk, its day and its clock" "$PR" "Prepare the Weekly check-in talk (area weekly-check-in) on 2026-10-25 at 18:00 (Europe/Berlin)."
contains "  and the time now on the coach's clock" "$PR" "Now: 2026-10-24T01:00:00Z (UTC)"
contains "  and says never to open the talk" "$PR" "never run godspeed-coach talk open"
contains "  the recipe is coach-prep, read from the skills folder" "$PR" "# Coaching talk preparation"
A="$(cat "$TMP/args")"
GC="$(cd "$G" && pwd)"; command -v cygpath >/dev/null 2>&1 && GC="$(cygpath -m "$GC" | sed -E 's#^([A-Za-z]):#/\L\1#')"
contains "  claude may write only in that talk's prep folder" "$A" "[Edit(/$GC/coach/weekly-check-in/prep/**)]"
case "$A" in *"[Write]"*|*"[Edit]"*|*"[Bash]"*) bad "  and has no bare Write, Edit or Bash";; *) ok "  and has no bare Write, Edit or Bash";; esac
contains "  and runs in dontAsk" "$A" "[dontAsk]"
check "  no talk was opened" "$(ls "$G/coach/weekly-check-in/talks" 2>/dev/null | wc -l | tr -d ' ')" "0"

rm -f "$TMP/ran"
OUT="$(run)"; check "a second run the same night exits 0" "$?" "0"
check "  and prepares nothing again" "$(cat "$TMP/ran" 2>/dev/null | wc -l | tr -d ' ')" "0"
contains "  it says so" "$OUT" "nothing to prepare"

# The next day, Sunday 03:00: Monday's health talk is tomorrow now. A draft does not count.
export GODSPEED_NOW=2026-10-25T02:00:00Z GODSPEED_TODAY=2026-10-25
: > "$TMP/health.draft"; rm -f "$TMP/ran"
OUT="$(run)"; check "a talk whose file stays a draft exits 1" "$?" "1"
check "  only the health talk ran (today's check-in is prepared)" "$(cat "$TMP/ran")" "health 2026-10-26"
contains "  the summary says it is not prepared, and why" "$(cat "$G/routines/coach-prep/2026-10-25/summary.txt")" "health 2026-10-26: NOT PREPARED (not ready: coach/health/prep/2026-10-26.md: its STATE is draft, not ready)"
rm -f "$TMP/health.draft" "$TMP/ran"
OUT="$(run)"; check "the next run prepares it" "$?" "0"
check "  it ran again" "$(cat "$TMP/ran")" "health 2026-10-26"

# A file the recipe left undated gets the time of the run, so the coach can tell it is fresh.
rm -rf "$G/coach/health/prep" "$TMP/ran"; : > "$TMP/health.undated"
OUT="$(run)"; check "an undated file exits 0" "$?" "0"
contains "  and gets PREPARED from the run" "$(cat "$G/coach/health/prep/2026-10-26.md")" "PREPARED: 2026-10-25T02:00:00Z"
rm -f "$TMP/health.undated"

# A STALE PREPARATION (written days before the talk) is prepared again, and when the refresh fails
# the older one is put back exactly as it was.
export GODSPEED_NOW=2026-10-31T02:00:00Z GODSPEED_TODAY=2026-10-31
mkdir -p "$G/coach/weekly-check-in/prep"
printf 'AREA: weekly-check-in\nTALK: 2026-11-01 18:00\nPREPARED: 2026-10-27T08:00:00Z\nSTATE: ready\n\n## The opening\nFrom your coach: an older opening?\n\n## Talk card\nThe older card.\n' > "$G/coach/weekly-check-in/prep/2026-11-01.md"
cp "$G/coach/weekly-check-in/prep/2026-11-01.md" "$TMP/older.md"
: > "$TMP/weekly-check-in.draft"; rm -f "$TMP/ran"
OUT="$(run)"; check "a refresh that fails exits 1" "$?" "1"
check "  it ran for the stale one" "$(cat "$TMP/ran")" "weekly-check-in 2026-11-01"
contains "  the prompt says an older preparation is there" "$(cat "$TMP/prompt")" "That file holds an older preparation (prepared 2026-10-27T08:00:00Z)"
check "  and the older preparation is back, unchanged" "$(cmp -s "$TMP/older.md" "$G/coach/weekly-check-in/prep/2026-11-01.md" && echo same || echo changed)" "same"
contains "  the summary says it stays" "$(cat "$G/routines/coach-prep/2026-10-31/summary.txt")" "its earlier preparation stays"
check "  no copy is left behind" "$(ls "$G/routines/coach-prep/2026-10-31/" | grep -c before)" "0"
rm -f "$TMP/weekly-check-in.draft" "$TMP/ran"
OUT="$(run)"; check "a refresh that works exits 0" "$?" "0"
contains "  and replaces the older one" "$(cat "$G/coach/weekly-check-in/prep/2026-11-01.md")" "PREPARED: 2026-10-31T02:00:00Z"

# THE TIME BUDGET bounds the finish: a budget shorter than one talk's limit skips it by name.
export GODSPEED_NOW=2026-11-01T02:00:00Z GODSPEED_TODAY=2026-11-01
rm -f "$TMP/ran"
OUT="$(run --budget-minutes 5)"; check "a budget shorter than one talk exits 1" "$?" "1"
contains "  and names the talk it skipped" "$(cat "$G/routines/coach-prep/2026-11-01/summary.txt")" "health 2026-11-02: skipped for time"
check "  without starting it" "$(cat "$TMP/ran" 2>/dev/null | wc -l | tr -d ' ')" "0"

# A TALK NAMED BY HAND is prepared whenever it is, also weeks ahead; a day that is not a talk day is refused.
rm -f "$TMP/ran"
OUT="$(run --area weekly-check-in --talk 2026-11-22)"; check "a talk named by hand exits 0" "$?" "0"
check "  it ran for that talk" "$(cat "$TMP/ran")" "weekly-check-in 2026-11-22"
OUT="$(run --area weekly-check-in --talk 2026-11-23)"; check "a day that is not a talk day exits 2" "$?" "2"
contains "  and says so" "$OUT" "2026-11-23 is not a day of the weekly-check-in talk"
OUT="$(run --area weekly-check-in)"; check "--area without --talk exits 2" "$?" "2"
OUT="$(run --budget-minutes soon)"; check "a budget that is not a number exits 2" "$?" "2"

# ITS COMMIT HOLDS ONLY ITS OWN FILES: the preparation and the run's folder, never another job's file.
G2="$(P "$TMP/g2")"; mkdir -p "$G2"; cp -R "$G/." "$G2/"; rm -rf "$G2/coach/health/prep" "$G2/routines"
export GODSPEED_NOW=2026-11-08T02:00:00Z GODSPEED_TODAY=2026-11-08
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@example.org GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@example.org
git -C "$G2" init -q && git -C "$G2" add -A && git -C "$G2" commit -q -m start
mkdir -p "$G2/routines/briefing"; echo "half a briefing" > "$G2/routines/briefing/2026-11-08.md"
# A file of tonight's run folder that an earlier, refused commit left staged.
mkdir -p "$G2/routines/coach-prep/2026-11-08"; echo "an earlier try" > "$G2/routines/coach-prep/2026-11-08/earlier.answer.txt"; git -C "$G2" add routines/coach-prep
sed -i "s#\$G/#\$G2/#g" "$B/claude" 2>/dev/null || true
cat > "$B/claude" <<STAND
#!/bin/sh
[ "\$1" = --help ] && { printf '  --restricted  Restricted mode\n  --permission-mode <mode>  ("dontAsk")\n'; exit 0; }
P="\$*"; [ -t 0 ] || P="\$P \$(cat)"
F="\$(printf '%s' "\$P" | sed -n 's/.*and write \(coach\/[a-z0-9-]*\/prep\/[0-9-]*\.md\)\..*/\1/p' | head -1)"
A="\$(printf '%s' "\$F" | cut -d/ -f2)"; D="\$(basename "\$F" .md)"
NOW="\$(printf '%s' "\$P" | sed -n 's/.*Now: \([0-9TZ:-]*\) (UTC).*/\1/p' | head -1)"
mkdir -p "$G2/coach/\$A/prep"
printf 'AREA: %s\nPREPARED: %s\nSTATE: ready\n\n## The opening\nFrom your coach: ready?\n\n## Talk card\nA card.\n' "\$A" "\$NOW" > "$G2/\$F"
echo "Done."
STAND
chmod +x "$B/claude"
OUT="$(PATH="$B:$PATH" GODSPEED_RUNNER=claude bash "$HERE/mc-coach-prep" --godspeed "$G2" 2>&1)"; check "a run in a folder kept in git exits 0" "$?" "0"
check "  one commit was made" "$(git -C "$G2" log --format=%s | head -1)" "Coaching talks prepared 2026-11-08"
IN="$(git -C "$G2" show --name-only --format= HEAD)"
contains "  it holds the preparation" "$IN" "coach/health/prep/2026-11-09.md"
contains "  and the run's summary" "$IN" "routines/coach-prep/2026-11-08/summary.txt"
contains "  and a run file an earlier refused commit left staged" "$IN" "routines/coach-prep/2026-11-08/earlier.answer.txt"
missing "  and not another job's file" "$IN" "routines/briefing"

# A NEW INSTALL'S GIT HAS NO NAME: the commit is made as the notebook's first commit is, not refused
# (found on a real Linux install, 18 October 2026: the preparation stayed uncommitted).
G3="$(P "$TMP/g3")"; mkdir -p "$G3"; cp -R "$G2/." "$G3/"; rm -rf "$G3/.git" "$G3/coach/health/prep" "$G3/coach/weekly-check-in/prep" "$G3/routines"
: > "$TMP/empty.gitconfig"
nameless() { env -u GIT_AUTHOR_NAME -u GIT_AUTHOR_EMAIL -u GIT_COMMITTER_NAME -u GIT_COMMITTER_EMAIL GIT_CONFIG_GLOBAL="$TMP/empty.gitconfig" GIT_CONFIG_NOSYSTEM=1 "$@"; }
nameless git -C "$G3" init -q && nameless git -C "$G3" add -A && nameless git -C "$G3" -c user.name=t -c user.email=t@example.org commit -q -m start
sed -i "s#$G2/#$G3/#g" "$B/claude"
OUT="$(nameless env PATH="$B:$PATH" GODSPEED_RUNNER=claude bash "$HERE/mc-coach-prep" --godspeed "$G3" 2>&1)"; check "a run where git has no name exits 0" "$?" "0"
check "  and still commits, as Godspeed Mission Control" "$(nameless git -C "$G3" log -1 --format='%an|%s')" "Godspeed Mission Control|Coaching talks prepared 2026-11-08"

echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
