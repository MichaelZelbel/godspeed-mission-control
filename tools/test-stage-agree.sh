#!/bin/sh
# The gate that the two stage readers are one reader. It takes the real stage.json and asks both
# tools/stage.mjs and tools/stage.sh for the same things: the list of fields, the value of every
# field on it, the whole file as checked JSON, the refusal of every malformed file in
# tools/stage-cases/, and the withdrawn answer in all four pairs. Then it checks each value in
# stage.json against the release record it came from and against the file that holds the same pin
# today, printing what it compared with what.
# Run: bash tools/test-stage-agree.sh   (from the root of a checkout of this kit)
set -u
. "$(dirname "$0")/test-guard.bash"

ROOT=$(cd "$(dirname "$0")/.." && pwd)
# Everything below names its files the way a reader of this kit types them, from the root. On
# Windows that also keeps the two readers comparable: Git Bash rewrites an absolute POSIX path
# into a Windows one on its way to node.exe but not on its way to a shell, and the readers name
# the file they were handed.
cd "$ROOT" || exit 1
CASES=tools/stage-cases
STAGE=stage.json
RECORD=docs/full-version/release-beta6-2026-10-24.md

TMP=$(mktemp -d)
trap 'rm -rf "$TMP" "$TEST_GUARD_HOME"' EXIT

PASS=0
FAIL=0
ok()   { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$1"; }
same() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (wanted [$3], got [$2])"; fi; }

node_reader() { node tools/stage.mjs "$@"; }
sh_reader()   { sh tools/stage.sh "$@"; }

printf 'the two stage readers, on %s\n' "$STAGE"

# ------------------------------------------------------------------ the same list of fields
node_reader "$STAGE" fields > "$TMP/fields-node.txt" 2> "$TMP/fields-node.err"
same "the Node reader lists the fields" "$?" "0"
sh_reader "$STAGE" fields > "$TMP/fields-sh.txt" 2> "$TMP/fields-sh.err"
same "the shell reader lists the fields" "$?" "0"
if diff -u "$TMP/fields-node.txt" "$TMP/fields-sh.txt" > "$TMP/fields.diff"; then
  ok "both readers name the same fields"
else
  bad "both readers name the same fields"
  cat "$TMP/fields.diff"
fi
COUNT=$(grep -c . "$TMP/fields-node.txt")
if [ "$COUNT" -ge 12 ]; then ok "$COUNT fields are readable"; else bad "only $COUNT readable fields"; fi

# ---------------------------------------------------------- the same value for every field
while IFS= read -r path; do
  [ -n "$path" ] || continue
  a=$(node_reader "$STAGE" get "$path" 2>&1); ae=$?
  b=$(sh_reader "$STAGE" get "$path" 2>&1); be=$?
  printf '  %-38s node[%s] shell[%s]\n' "$path" "$a" "$b"
  if [ "$ae" -ne 0 ] || [ "$be" -ne 0 ]; then
    bad "$path: a reader failed (node exit $ae, shell exit $be)"
  else
    same "  $path reads the same in both readers" "$b" "$a"
  fi
done < "$TMP/fields-node.txt"

node_reader "$STAGE" json > "$TMP/json-node.txt"
sh_reader "$STAGE" json > "$TMP/json-sh.txt"
if cmp -s "$TMP/json-node.txt" "$TMP/json-sh.txt"; then ok "both readers print the same checked JSON"
else bad "both readers print the same checked JSON"; fi
if cmp -s "$TMP/json-node.txt" "$STAGE"; then ok "  and it is stage.json byte for byte, so the layout the shell reader needs is the one on disk"
else bad "the checked JSON is stage.json byte for byte"; fi

for path in thereIsNoSuchField kitBootstrap; do
  node_reader "$STAGE" get "$path" >/dev/null 2>&1; ae=$?
  sh_reader "$STAGE" get "$path" >/dev/null 2>&1; be=$?
  same "both readers answer 2 for $path, which stage.json does not hold" "$be" "$ae"
  same "  and that answer is 2, not the refusal 1" "$ae" "2"
done

# --------------------------------------------------- the same refusal for every malformed file
printf '%s\n' "  every malformed file, refused by both"
while IFS='|' read -r file words; do
  case $file in '' | '#'*) continue ;; esac
  a=$(node_reader "$CASES/$file" check 2>&1); ae=$?
  b=$(sh_reader "$CASES/$file" check 2>&1); be=$?
  printf '  %-28s node(%s) %s\n' "$file" "$ae" "$a"
  printf '  %-28s shell(%s) %s\n' "" "$be" "$b"
  same "  $file: the Node reader refuses it with exit 1" "$ae" "1"
  same "  $file: the shell reader refuses it with exit 1" "$be" "1"
  case $a in *"$words"*) ok "    the Node reader says what is wrong" ;; *) bad "    the Node reader says what is wrong" ;; esac
  case $b in *"$words"*) ok "    the shell reader says what is wrong" ;; *) bad "    the shell reader says what is wrong" ;; esac
  # The two say it in the same words, except for a file that is no JSON at all: there the Node
  # reader has JSON.parse's verdict and the shell reader names the line it stopped at.
  if [ "$file" != "bad-not-json.json" ]; then
    same "    and both say it in the same words" "$b" "$a"
  fi
done < "$CASES/expected.txt"

# ---------------------------------------------------------- the same withdrawn answer, four pairs
printf '%s\n' "  the withdrawn answer, both readers, all four pairs"
for pair in "ok-clean ok-clean no" "ok-clean ok-withdrawn yes" "ok-withdrawn ok-clean yes" "ok-withdrawn ok-withdrawn yes"; do
  set -- $pair
  a=$(node_reader withdrawn "$CASES/$1.json" "$CASES/$2.json" 2>&1)
  b=$(sh_reader withdrawn "$CASES/$1.json" "$CASES/$2.json" 2>&1)
  printf '  installed %-13s public %-13s node[%s] shell[%s] wanted[%s]\n' "$1" "$2" "$a" "$b" "$3"
  same "  the Node reader says $3" "$a" "$3"
  same "  the shell reader says $3" "$b" "$3"
done

# ----------------------------------- every value, against the record and the file that holds it
printf '\n%s\n' "every value of stage.json, against the record and the files the release named"
get() { node_reader "$STAGE" get "$1"; }

compare() { # <what> <the value in stage.json> <the file that must hold it too> [what to look for]
  what=$1
  value=$2
  file=$3
  look=${4:-$2}
  printf '  comparing the %s: stage.json [%s] <-> %s [%s]\n' "$what" "$value" "$file" "$look"
  if grep -qF -- "$look" "$file"; then ok "  $file holds the same $what"
  else bad "  $file does not hold the $what [$look]"; fi
}

VERSION=$(get version)
PRODUCT=$(get productCommit)
ENGINE=$(get kitBootstrap.unixEngineCommit)
BOOTSTRAP=$(get kitBootstrap.windowsBootstrapCommit)
IMAGE=$(get serverEditions.server.image)
DIGEST=${IMAGE#*@sha256:}
EXE=$(get windowsSetup.file)
TAG=$(get windowsSetup.releaseTag)
EXESHA=$(get windowsSetup.sha256)

printf '%s\n' "  against docs/full-version/release-beta6-2026-10-24.md, the record this stage was read from:"
compare "version" "$VERSION" "$RECORD"
compare "product commit" "$PRODUCT" "$RECORD"
compare "shared Unix engine commit" "$ENGINE" "$RECORD"
compare "Windows bootstrap commit" "$BOOTSTRAP" "$RECORD"
compare "server image digest" "$IMAGE" "$RECORD" "sha256:$DIGEST"
compare "Windows setup file name" "$EXE" "$RECORD"
compare "Windows setup release tag" "$TAG" "$RECORD"
compare "Windows setup SHA-256" "$EXESHA" "$RECORD"

printf '%s\n' "  against the files that pin the same thing today:"
compare "product commit" "$PRODUCT" install-godspeed.sh
compare "shared Unix engine commit" "$ENGINE" install-godspeed.sh
compare "version" "$VERSION" installers/windows-manifest.json
compare "product commit" "$PRODUCT" installers/windows-manifest.json
compare "Windows bootstrap commit" "$BOOTSTRAP" installers/windows-manifest.json
for f in docker/hostinger/compose.yaml docker/hostinger/one-click.yaml \
         docker/server/browser-compose-traefik.yaml docker/hostinger/installer/compose.mjs; do
  compare "server image" "$IMAGE" "$f"
done

# ------------------------------------- the add-on pins, as they were at the product commit
printf '%s\n' "  the add-on pins, at the product commit, not at today's main:"
printf '  reading git show %s:third-party/addons/sources.json\n' "$PRODUCT"
if git cat-file -e "$PRODUCT^{commit}" 2>/dev/null &&
   git show "$PRODUCT:third-party/addons/sources.json" > "$TMP/sources.json" 2>/dev/null; then
  ok "  the product commit $PRODUCT is in this checkout, so its own sources.json was read"
  WHERE="$PRODUCT:third-party/addons/sources.json"
else
  printf '  (the product commit %s is not in this checkout, a shallow clone: the working tree is compared instead)\n' "$PRODUCT"
  cp third-party/addons/sources.json "$TMP/sources.json"
  WHERE="third-party/addons/sources.json in the working tree"
fi
node -e '
  const s = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  for (const a of s) console.log(a.name + " " + a.commit);
' "$TMP/sources.json" > "$TMP/pins.txt"
pins=0
while read -r name commit; do
  [ -n "$name" ] || continue
  pins=$((pins + 1))
  got=$(node_reader "$STAGE" get "addons.$name" 2>&1); code=$?
  printf '  comparing the pin of %s: stage.json addons.%s [%s] <-> %s [%s]\n' "$name" "$name" "$got" "$WHERE" "$commit"
  if [ "$code" -ne 0 ]; then
    bad "  stage.json names no add-on $name"
  else
    same "  the pin of $name" "$got" "$commit"
    bothsame=$(sh_reader "$STAGE" get "addons.$name" 2>&1)
    same "    and the shell reader reads it the same" "$bothsame" "$got"
  fi
done < "$TMP/pins.txt"
if [ "$pins" -ge 1 ]; then ok "  $pins add-on pins were compared"; else bad "no add-on pin was compared"; fi
listed=$(grep -c '^addons\.' "$TMP/fields-node.txt")
same "  stage.json carries exactly those add-ons and no others" "$listed" "$pins"

printf '\n%s of %s pass.\n' "$PASS" "$((PASS + FAIL))"
[ "$FAIL" -eq 0 ]
