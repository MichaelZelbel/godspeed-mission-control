#!/usr/bin/env bash
# test-launchers.sh - the gate for the tools' shell launchers inside Hermes on Windows (2026-10-09).
# Hermes runs its commands in Git Bash with MSYS_NO_PATHCONV=1 and MSYS2_ARG_CONV_EXCL=*, which
# stop Git Bash from turning /c/... into C:/... for the Windows programs it starts. node.exe was
# then told to load /c/.../due.js, looked for C:\c\...\due.js, and every launcher failed: mc-due
# and mc-check-brief in the morning brief, mc-goals, and mc-work-run said "mc-work is not
# installed". Every check below runs with those two settings. Elsewhere they mean nothing, and the
# same checks show the launchers are unchanged there.
#
# Runs in a throwaway folder with its own HOME and a short PATH, so nothing installed on this
# computer is used. Usage: bash tools/test-launchers.sh
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
NODE=""
for c in node nodejs /usr/local/bin/node /usr/bin/node; do
  "$c" -e '' >/dev/null 2>&1 && { NODE="$c"; break; }
done
[ -n "$NODE" ] || { echo "FAIL: no node on this box"; exit 1; }
NODE_DIR="$(dirname "$(command -v "$NODE")")"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/home" "$TMP/bin" "$TMP/godspeed/rules"
SHORT="$TMP/bin:$NODE_DIR:/usr/bin:/bin"
# What Hermes gives every command it runs on Windows.
hermes_shell() { HOME="$TMP/home" PATH="$SHORT" MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' "$@"; }

PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
contains() { case "$2" in *"$3"*) ok "$1";; *) bad "$1 (missing [$3] in: $(printf '%s' "$2" | head -3 | cut -c1-200))";; esac; }
missing()  { case "$2" in *"$3"*) bad "$1 (should not contain [$3])";; *) ok "$1";; esac; }

echo "launcher gate$(command -v cygpath >/dev/null 2>&1 && echo ' (Windows: Hermes'"'"' settings are in force)')"

# 1. Every one-line launcher, copied beside a stand-in for its program, run by name the way
#    Hermes' terminal runs it.
n=0
for f in "$HERE"/mc-*; do
  name="$(basename "$f")"
  target="$(sed -n 's|^exec node "$HERE/\([^"]*\)".*|\1|p' "$f")"
  [ -n "$target" ] || continue
  n=$((n+1))
  cp "$f" "$TMP/bin/$name"; chmod +x "$TMP/bin/$name"
  printf 'console.log("ran " + require("path").basename(__filename) + " " + process.argv.slice(2).join(" "));\n' > "$TMP/bin/$target"
  out="$(cd "$TMP" && hermes_shell "$name" one "two words" 2>&1)"
  contains "$name starts $target and passes its arguments on" "$out" "ran $target one two words"
done
[ "$n" -ge 10 ] && ok "$n one-line launchers were checked" || bad "only $n one-line launchers were found"

# 2. The real ones, run by hand in a folder outside any mission control. The folder is named the
#    way a Windows program can read it: a /c/... typed as an argument is still the typist's to fix.
G="$TMP/godspeed"; command -v cygpath >/dev/null 2>&1 && G="$(cygpath -m "$G")"
out="$(cd "$TMP" && hermes_shell sh "$HERE/mc-due" list --godspeed "$G" 2>&1)"
contains "mc-due reads the deadlines" "$out" "Nothing with a last day yet"
missing "  and node found its program" "$out" "Cannot find module"
out="$(cd "$TMP/godspeed" && hermes_shell sh "$HERE/mc-goals" list 2>&1)"
contains "mc-goals reads the goals of the folder it is run in" "$out" "No goals on the register yet"

# 3. The two runners, which call node themselves.
out="$(cd "$TMP" && hermes_shell bash "$HERE/mc-work-run" --godspeed "$TMP/godspeed" --dry-run 2>&1)"
contains "mc-work-run finds the work register beside it" "$out" "nothing runnable now"
missing "  and does not call it missing" "$out" "not installed"
mkdir -p "$TMP/godspeed/due"
printf 'TITLE: Paint the fence\nDONE-WHEN: painted\nCOST-IF-MISSED: rust\nSELF-CHECK: none\n\n## Windows\n\nSTRIP: 2026-10-01 2026-10-12\n' > "$TMP/godspeed/due/fence.md"
out="$(cd "$TMP" && GODSPEED_TODAY=2026-10-09 hermes_shell bash "$HERE/mc-decide" --godspeed "$TMP/godspeed" --date 2026-10-09 --dry-run 2>&1)"
contains "mc-decide gets an attention plan from mc-goals" "$out" "Attention for 2026-10-09"
contains "  and a list of the work from mc-work" "$(cat "$TMP/godspeed/routines/next-action/2026-10-09/tick.txt" 2>/dev/null)" "no open work"
# An mc-due on the path may be another program (the notebook's refuses --godspeed); the one beside
# mc-decide is the one it asks. Here the path's mc-due is section 1's stand-in.
due="$(cat "$TMP/godspeed/routines/next-action/2026-10-09/due.txt" 2>/dev/null)"
contains "  and today's deadlines from the due.js beside it" "$due" "Paint the fence"
missing "  not from whatever mc-due is on the path" "$due" "ran due.js"

# 4. The others still read as shell.
for f in mc-run mc-decide mc-work-run; do bash -n "$HERE/$f" && ok "$f reads as bash" || bad "$f does not read as bash"; done
for f in mc-notebook-sync mc-notebook-env mc-install-count; do sh -n "$HERE/$f" && ok "$f reads as sh" || bad "$f does not read as sh"; done

echo
echo "launchers: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
