#!/usr/bin/env sh
# The world pull is retired (#90, second slice): facts are the notebook's own records, so nothing
# writes them down into world/ as files any more. This file keeps the name the CI workflows run
# (.github/workflows/required.yml, tools-test.yml) and checks that it stays retired.
# Usage: sh tools/test-world-pull.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }

[ ! -e "$HERE/world-pull.py" ] && ok "the pull program is gone" || bad "tools/world-pull.py is back"
if grep -q 'world-pull' "$HERE/mc-notebook-sync"; then
  case "$(grep 'world-pull' "$HERE/mc-notebook-sync")" in
    *"#"*) ok "mc-notebook-sync only names it in a comment" ;;
    *) bad "mc-notebook-sync still runs the pull" ;;
  esac
else ok "mc-notebook-sync does not run it"; fi
case " $(sed -n '/^HELPERS=/,/"$/p' "$HERE/mc-uninstall") " in
  *world-pull*) bad "mc-uninstall still lists the pull program" ;;
  *) ok "mc-uninstall does not list it" ;;
esac

echo; echo "world pull retired: $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
