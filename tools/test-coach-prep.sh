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

# AN AREA WITHOUT RESEARCH DOMAINS needs no receipts and no review: none were written for it.
check "an area without research domains gets no receipts, review or tries" "$(ls "$G"/routines/coach-prep/*/ "$G"/coach/*/prep/ 2>/dev/null | grep -cE 'evidence|review|tries')" "0"

# A TALK WHOSE AREA HAS RESEARCH DOMAINS (#135): the run's own record gives the receipts, a second
# run reviews the preparation, the host seals the review, and only then does the talk open from it.
# The stand-in claude keeps a transcript as Claude Code does (~/.claude/projects/...), with the
# prompt's RUN MARKER: one page read successfully at the run's time, one that failed, one read long
# before the run. As the reviewer (the coach-prep-review recipe) it answers with the JSON verdict:
# a pass for every domain and goal named in its prompt, or a fail when $ST/review.fail exists.
# With $ST/forge the writer also writes the sidecars itself, which must never count.
ST="$TMP/research"; mkdir -p "$ST"
G4="$(P "$TMP/g4")"; mkdir -p "$G4/rules" "$G4/coach/work" "$G4/skills/coach-prep" "$G4/skills/coach-prep-review"
cp "$HERE/../notebook/recipes/coach-prep/SKILL.md" "$G4/skills/coach-prep/SKILL.md"
cp "$HERE/../notebook/recipes/coach-prep-review/SKILL.md" "$G4/skills/coach-prep-review/SKILL.md"
: > "$G4/AGENTS.md"; printf '{"timezone":"Europe/Berlin","git_sync":"off"}\n' > "$G4/coach/settings.json"
printf 'AREA: work\nTITLE: Work and money\nRHYTHM: weekly sunday\nTIME: 18:00\nSTARTS: 2026-10-01\nSTATUS: on\nSERVES: run-10k\nRESEARCH DOMAIN: income | new earning paths\n\n## Preparation\nIncome routes.\n' > "$G4/coach/work/area.md"
git -C "$G4" init -q && git -C "$G4" add -A && git -C "$G4" commit -q -m start
cat > "$B/claude" <<'STAND'
#!/bin/sh
[ "$1" = --help ] && { printf '  --restricted  Restricted mode\n  --permission-mode <mode>  ("dontAsk")\n  --strict-mcp-config\n'; exit 0; }
P="$*"; [ -t 0 ] || P="$P
$(cat)"
n=$(( $(cat "$ST/calls" 2>/dev/null || echo 0) + 1 )); echo "$n" > "$ST/calls"
for a in "$@"; do printf '[%s]\n' "$a"; done > "$ST/args.$n"; printf '%s\n' "$P" > "$ST/prompt.$n"
NOW="$(printf '%s\n' "$P" | sed -n 's/.*Now: \([0-9TZ:.-]*\) (UTC).*/\1/p' | head -1)"
MARK="$(printf '%s\n' "$P" | sed -n 's/^RUN MARKER: \([a-z0-9-]*\)$/\1/p' | head -1)"
mkdir -p "$HOME/.claude/projects/-stand-in"
S="session-$MARK"; L="$HOME/.claude/projects/-stand-in/$S.jsonl"
printf '{"type":"user","sessionId":"%s","timestamp":"%s","message":{"role":"user","content":"RUN MARKER: %s\\nThe prompt."}}\n' "$S" "$NOW" "$MARK" > "$L"
read_page() { # id url when text error
  printf '{"type":"assistant","sessionId":"%s","timestamp":"%s","message":{"role":"assistant","content":[{"type":"tool_use","id":"%s","name":"WebFetch","input":{"url":"%s","prompt":"read"}}]}}\n' "$S" "$3" "$1" "$2" >> "$L"
  printf '{"type":"user","sessionId":"%s","timestamp":"%s","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"%s","content":"%s","is_error":%s}]},"toolUseResult":{"code":200}}\n' "$S" "$3" "$1" "$4" "$5" >> "$L"
}
case "$P" in
*"# Reviewing a coaching talk's preparation"*)
  DOMS="$(printf '%s\n' "$P" | sed -n 's/^The research domains: \(.*\)\. The goals it serves: \(.*\)\. Your coverage.*/\1, \2/p' | head -1)"
  ROWS=""; for id in $(printf '%s' "$DOMS" | tr ',' ' '); do
    ROWS="$ROWS${ROWS:+,}{\"id\":\"$id\",\"verdict\":\"pass\",\"reason\":\"The report supports it; the contrary finding is weighed.\",\"sources\":[\"https://example.org/report\"]}"
  done
  if [ -f "$ST/review.fail" ]; then
    printf '{"verdict":"fail","coverage":[%s],"issues":["The 12 percent rise in Routes is not in the text of https://example.org/report."]}\n' "$ROWS"
  else printf '{"verdict":"pass","coverage":[%s],"issues":[]}\n' "$ROWS"; fi ;;
*)
  F="$(printf '%s' "$P" | sed -n 's/.*and write \(coach\/[a-z0-9-]*\/prep\/[0-9-]*\.md\)\..*/\1/p' | head -1)"
  read_page toolu_ok https://example.org/report "$NOW" "Freelance rates rose 12 percent in 2026." false
  read_page toolu_err https://example.org/gone "$NOW" "Request failed with status code 404" true
  read_page toolu_old https://example.org/old 2020-01-01T00:00:00.000Z "Read long before this run." false
  mkdir -p "$G4/$(dirname "$F")"
  { printf 'AREA: work\nTALK: %s 18:00\nPREPARED: %s\nSTATE: ready\n\n' "$(basename "$F" .md)" "$NOW"
    for s in "The opening" "Talk card" "Where they stand" "What changed since the last talk" "The world this week" "Opportunities" "Routes" "Rejected routes" "What I think" "Gaps" "Cut, and why" "Research coverage"; do
      printf '## %s\nRun %s: a line for %s, from https://example.org/report.\n\n' "$s" "$MARK" "$s"; done; } > "$G4/$F"
  [ -f "$ST/forge" ] && for x in evidence review; do printf '{"version":1,"forged":true}\n' > "$G4/${F%.md}.$x.json"; done
  echo "Prepared the talk." ;;
esac
STAND
chmod +x "$B/claude"
export ST G4
rrun() { PATH="$B:$PATH" GODSPEED_RUNNER=claude bash "$HERE/mc-coach-prep" --godspeed "$G4" "$@" 2>&1; }
repairs() { "$NODE" --input-type=module -e 'import {pathToFileURL} from "node:url";const {Store}=await import(pathToFileURL(process.argv[1]).href);console.log(new Store(process.argv[2]).list("work_items").filter(r=>r.kind==="repair").length)' "$(P "$HERE/../notebook/core/records/store.mjs")" "$G4"; }
export GODSPEED_NOW=2026-11-14T01:00:00Z GODSPEED_TODAY=2026-11-14
R4="$G4/routines/coach-prep/2026-11-14"; P4="$G4/coach/work/prep"

echo "-- an area with research domains"
OUT="$(rrun --dry-run)"; check "a dry run of a researched talk exits 0" "$?" "0"
contains "  it names the talk" "$OUT" "Work and money (work), 2026-11-15 at 18:00 Europe/Berlin -> coach/work/prep/2026-11-15.md"
contains "  and the receipts and the review step" "$OUT" "then its receipts (coach/work/prep/2026-11-15.evidence.json, from the run's own record) and a review by a second AI (coach-prep-review, coach/work/prep/2026-11-15.review.json) before it may open the talk"
contains "  and the tries and the repair item" "$OUT" "after three failed tries in a row, one repair item goes to your work list"

: > "$ST/forge"
OUT="$(rrun)"; check "a researched talk whose review passes exits 0" "$?" "0"
check "  the writer ran, then the reviewer" "$(cat "$ST/calls")" "2"
contains "  the writer's prompt carries its marker" "$(cat "$ST/prompt.1")" "RUN MARKER: gs-prep-"
contains "  and asks for Routes, from pages read" "$(cat "$ST/prompt.1")" "write Routes, Rejected routes and Research coverage"
contains "  the reviewer's prompt carries a marker of its own" "$(cat "$ST/prompt.2")" "RUN MARKER: gs-review-"
contains "  and the review recipe" "$(cat "$ST/prompt.2")" "# Reviewing a coaching talk's preparation"
contains "  and the domains and goals it must judge" "$(cat "$ST/prompt.2")" "The research domains: income. The goals it serves: run-10k."
contains "  and the preparation and the evidence whole" "$(cat "$ST/prompt.2")" "Freelance rates rose 12 percent in 2026."
contains "  the reviewer may read and search only" "$(cat "$ST/args.2")" "[--tools]
[Read,Grep,Glob,WebSearch,WebFetch,ToolSearch]"
case "$(cat "$ST/args.2")" in *Edit*|*Write*|*Bash*) bad "  and has no write tool and no shell";; *) ok "  and has no write tool and no shell";; esac
contains "  the writer's own list is still binding" "$(cat "$ST/args.1")" "[dontAsk]"
EVF="$P4/2026-11-15.evidence.json"; RVF="$P4/2026-11-15.review.json"
check "  the coach opens the talk from it" "$("$NODE" "$GODSPEED_COACH_SCRIPT" prep-check work --date 2026-11-15 --godspeed "$G4" | cut -d, -f1)" "ready: coach/work/prep/2026-11-15.md"
missing "  the evidence the model wrote is overwritten" "$(cat "$EVF")" "forged"
missing "  and so is its review" "$(cat "$RVF")" "forged"
WM="$(sed -n 's/^RUN MARKER: //p' "$ST/prompt.1" | head -1)"
check "  the evidence names the writer's marker" "$("$NODE" -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).run.token)' "$EVF")" "$WM"
check "  and only the page read successfully inside the run" "$("$NODE" -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).sources.map(s=>s.url+" "+s.tool).join("|"))' "$EVF")" "https://example.org/report WebFetch"
check "  the review is the reviewer's session, not the writer's" "$("$NODE" -e 'const r=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log(r.reviewer.token.slice(0,10)+" "+r.verdict+" "+r.coverage.map(c=>c.id).join(","))' "$RVF")" "gs-review- pass income,run-10k"
contains "  the summary says it passed its review" "$(cat "$R4/summary.txt")" "work 2026-11-15: prepared (coach/work/prep/2026-11-15.md), its review passed on try 1"
check "  the try is recorded as passed" "$(cut -f1 "$R4/work-2026-11-15.tries")" "pass"
IN="$(git -C "$G4" show --name-only --format= HEAD)"
contains "  the commit holds the evidence" "$IN" "coach/work/prep/2026-11-15.evidence.json"
contains "  and the review" "$IN" "coach/work/prep/2026-11-15.review.json"
check "  and nothing but the talk's files and the run folder" "$(printf '%s\n' "$IN" | grep -vcE '^(coach/work/prep/2026-11-15\.|routines/coach-prep/2026-11-14/)')" "0"

# AN OLDER PREPARATION THAT STILL OPENS ITS TALK KEEPS ITS PROOF when a new try fails its review.
for x in md evidence.json review.json; do cp "$P4/2026-11-15.$x" "$ST/kept.$x"; done
: > "$ST/review.fail"; rm -f "$ST/calls"
OUT="$(rrun --area work --talk 2026-11-15 --tries 1)"; check "a new try that fails its review exits 1" "$?" "1"
for x in md evidence.json review.json; do
  check "  the older $x is back, unchanged" "$(cmp -s "$ST/kept.$x" "$P4/2026-11-15.$x" && echo same || echo changed)" "same"
done
check "  and still opens the talk" "$("$NODE" "$GODSPEED_COACH_SCRIPT" prep-check work --date 2026-11-15 --godspeed "$G4" | cut -d, -f1)" "ready: coach/work/prep/2026-11-15.md"
contains "  the summary says why, and that it stays" "$(cat "$R4/summary.txt")" "work 2026-11-15: NOT PREPARED again (its independent research review did not pass); its earlier preparation stays"
check "  no copy is left behind" "$(ls "$R4" | grep -c before)" "0"
contains "  the failed candidates stay in the run folder" "$(ls "$R4")" "work-2026-11-15.try1.review.json"

# THREE FAILED TRIES IN A ROW FILE ONE REPAIR ITEM, and a fourth files no second one. Each try
# after a failed one gets the review's issues.
rm -f "$ST/calls"
OUT="$(rrun --area work --talk 2026-11-22)"; check "a talk whose review fails three times exits 1" "$?" "1"
check "  it was tried three times in one run (writer and reviewer each)" "$(cat "$ST/calls")" "6"
contains "  the second try gets the review's issues" "$(cat "$ST/prompt.3")" "The last try at this talk failed its review. Resolve each issue with evidence, not new wording:
- The 12 percent rise in Routes is not in the text of https://example.org/report."
missing "  the first try had none to resolve" "$(cat "$ST/prompt.1")" "Resolve each issue"
check "  three failed tries are recorded" "$(cut -f1 "$R4/work-2026-11-22.tries" | tr '\n' ' ')" "fail fail fail "
check "  one repair item is in the work list" "$(repairs)" "1"
contains "  the summary names it" "$(cat "$R4/summary.txt")" "work 2026-11-22: 3 failed tries in a row; repair item: filed repair-coach-prep-"
check "  no sidecar stays beside a preparation that did not pass" "$(ls "$P4" | grep -c '2026-11-22\..*json')" "0"
OUT="$(rrun --area work --talk 2026-11-22 --tries 1)"; check "a fourth failed try exits 1" "$?" "1"
check "  and files no second repair item" "$(repairs)" "1"
contains "  the summary says the item is open" "$(cat "$R4/summary.txt")" "work 2026-11-22: 4 failed tries in a row; repair item: already open repair-coach-prep-"
rm -f "$ST/review.fail"
OUT="$(rrun --area work --talk 2026-11-22)"; check "a try that passes exits 0" "$?" "0"
check "  and ends the count" "$(tail -1 "$R4/work-2026-11-22.tries" | cut -f1)" "pass"
OUT="$(rrun --area work --talk 2026-11-22 --tries 1)"
check "  a run after it starts with no issues to resolve" "$(grep -c 'Resolve each issue' "$ST/prompt.$(cat "$ST/calls" | awk '{print $1-1}')")" "0"

# A RUN WHOSE RECORD HAS NO PAGE READ gets no receipts: the review is not even started.
rm -f "$ST/calls"; sed -i 's/^  read_page toolu_ok /  : read_page toolu_ok /' "$B/claude"
OUT="$(rrun --area work --talk 2026-11-29 --tries 1)"; check "a run that read no page exits 1" "$?" "1"
check "  and no reviewer ran" "$(cat "$ST/calls")" "1"
contains "  the summary says why" "$(cat "$R4/summary.txt")" "work 2026-11-29: try 1 did not pass (claude session"

echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
