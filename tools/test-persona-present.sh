#!/usr/bin/env bash
# The starter AGENTS.md ships a marked persona paragraph naming Godspeed Mission Control.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
f="$ROOT/starter-godspeed/AGENTS.md"
fail=0
grep -q "persona:begin" "$f" && grep -q "persona:end" "$f" || { echo "FAIL: no persona markers"; fail=1; }
para=$(awk '/persona:begin/{p=1;next} /persona:end/{p=0} p' "$f")
for need in "Godspeed Mission Control" "Speedy" "do you copy"; do
  grep -q -- "$need" <<<"$para" || { echo "FAIL: persona lacks '$need'"; fail=1; }
done
grep -q "called godspeed" "$f" && { echo "FAIL: claims the folder is called godspeed (a separate script renames it)"; fail=1; }
[ "$fail" = 0 ] && echo "starter persona OK"
exit $fail
