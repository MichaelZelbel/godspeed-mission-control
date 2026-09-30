#!/usr/bin/env bash
# Writes starter-godspeed/skills/<name>/.shipped-sha256: the sha256 (Windows line endings taken
# out) of every version of that recipe's SKILL.md ever committed, under its current path or an
# older one, plus the version in the working tree. kit-bootstrap replaces a reader's copy only
# when it matches one of these, so a recipe the reader edited is never touched. Run it after
# changing a starter recipe and commit the result with the change.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
sum() { if command -v sha256sum >/dev/null 2>&1; then sha256sum | cut -d' ' -f1; else shasum -a 256 | cut -d' ' -f1; fi; }
for dir in starter-godspeed/skills/*/; do
  f="${dir}SKILL.md"; [ -f "$f" ] || continue
  {
    git log --follow --format='C %H' --name-only -- "$f" | awk '/^C /{c=$2; next} NF{print c, $0}' |
      while read -r c p; do git show "$c:$p" 2>/dev/null | tr -d '\r' | sum; done
    tr -d '\r' < "$f" | sum
  } | sort -u > "${dir}.shipped-sha256"
  echo "$(wc -l < "${dir}.shipped-sha256") version(s) in ${dir}.shipped-sha256"
done
