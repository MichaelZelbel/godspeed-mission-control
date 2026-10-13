#!/usr/bin/env bash
# Writes starter-godspeed/skills/<name>/.shipped-sha256: the sha256 (Windows line endings taken
# out) of every version of that recipe's SKILL.md ever committed, under its current path or an
# older one, plus the version in the working tree. kit-bootstrap replaces a reader's copy only
# when it matches one of these, so a recipe the reader edited is never touched. Run it after
# changing a starter recipe and commit the result with the change.
# A hash once committed stays listed (2026-10-13): git log --name-only names no file for a merge
# commit, so a version only a merge produced (morning-brief's of 2026-10-09, listed by hand in
# 983e4d0) dropped out on the next run, and a reader with that copy would have counted as edited.
#
# A RECIPE THE NOTEBOOK SHIPS TOO IS THE SAME FILE (2026-10-13). The notebook installs its own copy
# (notebook/recipes/<name>, made from notebook/reusable-recipes/<name>) over the reader's skills/,
# and files a review that stops the folder's sync whenever the reader's copy is neither its own
# copy nor a version it knows (notebook/data/recipe-revisions.json). Its next-action copy stayed
# at an older version while the starter's moved on, so every new install got a "Review edited
# next-action skill" it never asked for. So this run also:
#   - lists every version the notebook ever shipped of such a recipe here, so kit-bootstrap keeps
#     a reader's stock copy current whichever of the two put it there;
#   - copies the starter's SKILL.md and .shipped-sha256 over both notebook copies;
#   - adds every hash listed here to recipe-revisions.json, so no version the kit shipped ever
#     counts as the reader's own edit (the notebook test "packaged recipes" checks all three).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
sum() { if command -v sha256sum >/dev/null 2>&1; then sha256sum | cut -d' ' -f1; else shasum -a 256 | cut -d' ' -f1; fi; }
# Every committed version of one file: "<commit> <path>" per version, under older names too.
versions() { git log --follow --format='C %H' --name-only -- "$1" | awk '/^C /{c=$2; next} NF{print c, $0}'; }
hashes() { while read -r c p; do if git cat-file -e "$c:$p" 2>/dev/null; then git show "$c:$p" | tr -d '\r' | sum; fi; done; }
for dir in starter-godspeed/skills/*/; do
  f="${dir}SKILL.md"; [ -f "$f" ] || continue
  name="$(basename "$dir")"
  copies=""
  for pkg in notebook/recipes notebook/reusable-recipes; do [ -d "$pkg/$name" ] && copies="$copies $pkg/$name"; done
  # The committed list, not the file on disk: a run between two edits must not keep the hash of a
  # version that was never committed (and the write below truncates the file as the pipe starts).
  listed="$(git show "HEAD:${dir}.shipped-sha256" 2>/dev/null | tr -d '\r' || true)"
  {
    if [ -n "$listed" ]; then printf '%s\n' "$listed"; fi
    versions "$f" | hashes
    for c in $copies; do versions "$c/SKILL.md" | hashes; done
    tr -d '\r' < "$f" | sum
  } | sort -u > "${dir}.shipped-sha256"
  for c in $copies; do cp "$f" "$c/SKILL.md"; cp "${dir}.shipped-sha256" "$c/.shipped-sha256"; done
  echo "$(wc -l < "${dir}.shipped-sha256") version(s) in ${dir}.shipped-sha256${copies:+; copied to$copies}"
done
# The notebook's list of versions it knows, and the provenance list of notebook/reusable-recipes.
node - <<'EOF'
const fs = require('fs'), path = require('path');
const skills = 'starter-godspeed/skills', revisions = 'notebook/data/recipe-revisions.json', sources = 'notebook/data/reusable-recipe-sources.json';
const known = JSON.parse(fs.readFileSync(revisions, 'utf8'));
let added = 0;
for (const name of fs.readdirSync(skills).sort()) {
  const list = path.join(skills, name, '.shipped-sha256');
  if (!fs.existsSync(list)) continue;
  const key = name + '/SKILL.md', have = known[key] || (known[key] = []);
  for (const h of fs.readFileSync(list, 'utf8').split(/\r?\n/).filter(Boolean)) if (!have.includes(h)) { have.push(h); added++; }
}
fs.writeFileSync(revisions, JSON.stringify(known, null, 2) + '\n');
const record = JSON.parse(fs.readFileSync(sources, 'utf8'));
for (const key of Object.keys(record.files || {})) {
  const file = path.join('notebook/reusable-recipes', key);
  if (fs.existsSync(path.join(skills, key.split('/')[0])) && fs.existsSync(file))
    record.files[key] = require('crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
fs.writeFileSync(sources, JSON.stringify(record, null, 2) + '\n');
console.log(`${added} hash(es) added to ${revisions}`);
EOF
