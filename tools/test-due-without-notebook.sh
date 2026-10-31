#!/usr/bin/env bash
# test-due-without-notebook.sh - the reminder tool the way a READER receives it, and the check that
# would have caught #112.
#
# WHY THIS EXISTS. A reminder is a record in the notebook (#90), so every command of due.js needs
# notebook/core/due-records.mjs. The installer copies tools/ into the assistant's command folder,
# where no notebook stands beside it, and the Docker image - what a Hostinger reader and the
# one-line server installer give you - installs no notebook at all. 2.0.0-beta.12 therefore went
# public having taken every reminder away from that whole edition: nothing added, nothing listed, no
# deadline line in the morning brief, no self check that could close a renewed key. Nothing saw it
# for two weeks, because the one check that runs the tools as a reader receives them is
# docker/test.sh, which runs only on changes under docker/, server/ or computer/, and that work
# changed tools/ and notebook/. So this runs the tool the reader's way, in two seconds and with no
# Docker: from a folder with no notebook beside it, against a throwaway mission control.
#
# Runs inside throwaway folders. Needs node only.
# Usage: bash tools/test-due-without-notebook.sh
set -uo pipefail
. "$(dirname "$0")/test-guard.bash"
KIT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP" "$TEST_GUARD_HOME"' EXIT

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
check()    { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (wanted [$3], got [$2])"; fi; }
contains() { case "$2" in *"$3"*) ok "$1";; *) bad "$1 (missing [$3] in: $(printf '%s' "$2" | head -3))";; esac; }
missing()  { case "$2" in *"$3"*) bad "$1 (should not contain [$3])";; *) ok "$1";; esac; }

# The tools exactly as the installer hands them over: every file of tools/, copied away from the
# kit, with no notebook folder anywhere above them.
BIN="$TMP/bin"; mkdir -p "$BIN"; cp -r "$KIT/tools/." "$BIN/"
[ -e "$TMP/notebook" ] || [ -e "$BIN/../notebook" ] && bad "the copied tools must have no notebook beside them" || ok "the copied tools have no notebook beside them"

# A mission control folder as a reader has one, and nothing else.
fresh() { local g="$TMP/$1"; mkdir -p "$g/due" "$g/world/events" "$g/rules"; : > "$g/AGENTS.md"; printf '%s' "$g"; }
# The copied tool, on a day, with the kit named the way the image names it (KB_KIT_DIR), or with
# nothing named at all.
copy()   { local day="$1" g="$2"; shift 2; GODSPEED_TODAY="$day" KB_KIT_DIR="$KIT" node "$BIN/due.js" --godspeed "$g" "$@" 2>&1; }
alone()  { local day="$1" g="$2"; shift 2; GODSPEED_TODAY="$day" node "$BIN/due.js" --godspeed "$g" "$@" 2>&1; }

echo "due.js, from a folder with no notebook beside it"

# --- the code is nowhere: one plain sentence, and it fails ---------------------------------------
# A copy that cannot keep a reminder must say so rather than pretend. These are the words it has.
G="$(fresh refused)"
OUT="$(alone 2026-05-01 "$G" add present --title "A present" --target 2026-04-20 --done-when "bought")"; RC=$?
check "with the notebook code nowhere, it says so in two plain lines" "$OUT" \
"I could not find the notebook that keeps your reminders, so I did not read or change anything.
Your reminders are pages in notebook/Deadlines/. Run this through your mission control (godspeed due ...)."
check "  and fails" "$RC" "1"
check "  and nothing was written" "$(find "$G/notebook" -type f 2>/dev/null | wc -l | tr -d ' ')" "0"
OUT="$(alone 2026-05-01 "$G" list)"
contains "a list has the same answer" "$OUT" "I could not find the notebook that keeps your reminders"

# --- docker/test.sh's own check, word for word ---------------------------------------------------
# "the deadline tool takes a target alone, and asks once when it has passed", as the image's test
# runs it, with KB_KIT_DIR naming the kit the way the image does (docker/Dockerfile). Here it needs
# no image and no nine-minute build.
G="$(fresh docker-check)"
copy 2026-05-01 "$G" add present --title "A present" --target 2026-04-20 --done-when "bought" >/dev/null \
  && ok "a target alone is taken" || bad "a target alone is taken"
OUT="$(copy 2026-05-01 "$G" today)"
contains "  and the brief asks once, in the words the image's test greps for" "$OUT" \
  "A present: you aimed for 2026-04-20. A new date, or as soon as you can?"
copy 2026-05-01 "$G" drop present --yes >/dev/null && ok "  and it can be called off" || bad "  and it can be called off"

# --- a reader's whole path ----------------------------------------------------------------------
# Add one with a day you would like it done, see it, let that day pass, read the one question,
# answer it, close it.
G="$(fresh reader)"
OUT="$(copy 2026-04-10 "$G" add birthday --title "Priya's present" --target 2026-04-20 --done-when "it is bought")"
contains "a reminder with a target is made" "$OUT" "Made birthday"
OUT="$(copy 2026-04-10 "$G" list)"
contains "  and the list shows it, with its day" "$OUT" "Priya's present"
contains "  and says when you aimed for it" "$OUT" "2026-04-20"
OUT="$(copy 2026-04-20 "$G" today)"
contains "on the day, the brief says so" "$OUT" "Priya's present"
OUT="$(copy 2026-04-21 "$G" today)"
contains "the morning after, it asks its one question" "$OUT" \
  "Priya's present: you aimed for 2026-04-20. A new date, or as soon as you can?"
OUT="$(copy 2026-04-21 "$G" target birthday 2026-04-30)"
contains "the answer is taken: a new day" "$OUT" "2026-04-30"
OUT="$(copy 2026-04-22 "$G" today)"
missing "  and the question is not asked again" "$OUT" "A new date, or as soon as you can?"
OUT="$(copy 2026-04-23 "$G" done birthday --evidence "wrapped it")"
contains "it closes, as a moment on the timeline" "$OUT" "Closed birthday"
contains "  named with the day it happened" "$OUT" "notebook/Timeline/2026-04-23"
OUT="$(copy 2026-04-24 "$G" state)"
contains "and afterwards it is closed" "$OUT" "CLOSED   birthday"
OUT="$(copy 2026-04-24 "$G" list)"
contains "  and the list says it is done" "$OUT" "DONE      Priya's present"
OUT="$(copy 2026-04-24 "$G" today)"
check "  and the brief has nothing left to ask" "$OUT" "Nothing needs saying today."

# --- one home, and no second storage ------------------------------------------------------------
# The records are the notebook's own, in the mission control folder, and nowhere else.
[ -n "$(grep -rl '^id: due-birthday$' "$G/notebook/Deadlines" 2>/dev/null)" ] \
  && ok "the reminder is a page under notebook/Deadlines/" || bad "the reminder is a page under notebook/Deadlines/"
[ -n "$(ls "$G/notebook/Timeline" 2>/dev/null)" ] \
  && ok "its closing is a moment under notebook/Timeline/" || bad "its closing is a moment under notebook/Timeline/"
check "nothing is kept in due/" "$(ls "$G/due" | wc -l | tr -d ' ')" "0"
check "nothing is kept in world/events/" "$(ls "$G/world/events" | wc -l | tr -d ' ')" "0"
missing "and nothing of it is written beside the copied tools" "$(find "$BIN" -newer "$BIN/due.js" -type f 2>/dev/null)" "notebook"

# --- the same answers as a kit's own copy -------------------------------------------------------
# What a reader on this edition is told, word for word against what a developer's checkout says:
# the same program, the same records, the same words.
say_all() { # <program> <godspeed> [kit]
  local p="$1" g="$2" kit="${3:-}"
  for c in "add present --title A-present --target 2026-04-20 --done-when bought" "today" \
           "target present asap" "done present --evidence it-is-wrapped" "state"; do
    # shellcheck disable=SC2086
    GODSPEED_TODAY=2026-05-01 KB_KIT_DIR="$kit" node "$p" --godspeed "$g" $c 2>&1
  done
}
A="$(say_all "$KIT/tools/due.js" "$(fresh in-the-kit)")"
B="$(say_all "$BIN/due.js" "$(fresh away-from-it)" "$KIT")"
check "a copy away from the notebook answers exactly what the kit's own copy answers" "$B" "$A"
check "  and keeps the same files" \
  "$(cd "$TMP/away-from-it" && find notebook -type f | sort)" "$(cd "$TMP/in-the-kit" && find notebook -type f | sort)"

# --- where the kit may be named -----------------------------------------------------------------
G="$(fresh own-name)"
OUT="$(GODSPEED_TODAY=2026-05-01 GODSPEED_KIT_DIR="$KIT" node "$BIN/due.js" --godspeed "$G" add present --title "A present" --target 2026-04-20 --done-when "bought" 2>&1)"
contains "GODSPEED_KIT_DIR names the kit too" "$OUT" "Made present"
G="$(fresh home-kit)"
mkdir -p "$HOME/teach-it-once-kit"; cp -r "$KIT/notebook" "$KIT/tools" "$HOME/teach-it-once-kit/" 2>/dev/null
OUT="$(alone 2026-05-01 "$G" add present --title "A present" --target 2026-04-20 --done-when "bought")"
contains "the kit where the installer puts it is found with nothing named" "$OUT" "Made present"
rm -rf "$HOME/teach-it-once-kit"
G="$(fresh wrong-name)"
OUT="$(GODSPEED_TODAY=2026-05-01 KB_KIT_DIR="$TMP/not-a-kit" node "$BIN/due.js" --godspeed "$G" list 2>&1)"
contains "a named folder that holds no notebook code is passed over, with the plain sentence" "$OUT" \
  "I could not find the notebook that keeps your reminders"
missing "  and no stack trace" "$OUT" "at Function"

# --- the place that already worked still comes first --------------------------------------------
# A computer with the notebook installed keeps each version in
# <root>/.godspeed/integrated-runtime/versions/<commit>; nothing about that changed, and a copied
# tool still finds it with no kit named anywhere.
G="$(fresh installed)"
V="$G/.godspeed/integrated-runtime/versions/$(printf 'a%.0s' $(seq 40))"
mkdir -p "$V"; cp -r "$KIT/notebook" "$KIT/tools" "$V/"
OUT="$(alone 2026-05-01 "$G" add present --title "A present" --target 2026-04-20 --done-when "bought")"
contains "an installed version beside the mission control is still used" "$OUT" "Made present"

# --- as a reader types it -----------------------------------------------------------------------
# The launcher, not the program: mc-due is what the reader and the assistant have on PATH.
G="$(fresh launcher)"
OUT="$(GODSPEED_TODAY=2026-05-01 KB_KIT_DIR="$KIT" sh "$BIN/mc-due" --godspeed "$G" add present --title "A present" --target 2026-04-20 --done-when "bought" 2>&1)"
contains "the mc-due launcher in the copied folder keeps a reminder" "$OUT" "Made present"
OUT="$(GODSPEED_TODAY=2026-05-01 KB_KIT_DIR="$KIT" sh "$BIN/mc-due" --godspeed "$G" today 2>&1)"
contains "  and reads it back" "$OUT" "A present: you aimed for 2026-04-20. A new date, or as soon as you can?"

echo
echo "due.js without a notebook: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
