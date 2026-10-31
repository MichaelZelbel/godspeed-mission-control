#!/bin/sh
# The gate that the two stage readers are one reader. It takes the real stage.json and asks both
# stage/stage.mjs and stage/stage.sh for the same things: the list of fields, the value of every
# field on it, the whole file as checked JSON, the refusal of every malformed file in
# stage/stage-cases/, and the withdrawn answer in all four pairs. Then it checks each value in
# stage.json against the release record it came from and against the file that holds the same pin
# today, printing what it compared with what, and it holds the Mac and Linux installers to naming
# no version at all, since they read stage.json rather than pinning anything themselves.
# Run: bash stage/test-stage-agree.sh   (from the root of a checkout of this kit)
set -u
. "$(dirname "$0")/../tools/test-guard.bash"

ROOT=$(cd "$(dirname "$0")/.." && pwd)
# Everything below names its files the way a reader of this kit types them, from the root. On
# Windows that also keeps the two readers comparable: Git Bash rewrites an absolute POSIX path
# into a Windows one on its way to node.exe but not on its way to a shell, and the readers name
# the file they were handed.
cd "$ROOT" || exit 1
CASES=stage/stage-cases
STAGE=stage.json
RECORD=docs/full-version/release-beta6-2026-10-24.md

TMP=$(mktemp -d)
trap 'rm -rf "$TMP" "$TEST_GUARD_HOME"' EXIT

PASS=0
FAIL=0
ok()   { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$1"; }
same() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (wanted [$3], got [$2])"; fi; }

node_reader() { node stage/stage.mjs "$@"; }
sh_reader()   { sh stage/stage.sh "$@"; }

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
while IFS='|' read -r file words shwords; do
  case $file in '' | '#'*) continue ;; esac
  a=$(node_reader "$CASES/$file" check 2>&1); ae=$?
  b=$(sh_reader "$CASES/$file" check 2>&1); be=$?
  printf '  %-28s node(%s) %s\n' "$file" "$ae" "$a"
  printf '  %-28s shell(%s) %s\n' "" "$be" "$b"
  same "  $file: the Node reader refuses it with exit 1" "$ae" "1"
  same "  $file: the shell reader refuses it with exit 1" "$be" "1"
  # One sentence is one line, whatever the file holds: a value that holds a newline of its own
  # would otherwise break the sentence that refuses it in two.
  same "  $file: the Node reader says it on one line" "$(printf '%s\n' "$a" | grep -c .)" "1"
  same "  $file: the shell reader says it on one line" "$(printf '%s\n' "$b" | grep -c .)" "1"
  case $a in *"$words"*) ok "    the Node reader says what is wrong" ;; *) bad "    the Node reader says what is wrong ([$a] holds no [$words])" ;; esac
  # The two say it in the same words, except where the file is not in the layout the shell reader
  # reads at all: there that reader stops at the line it cannot read before it reaches the rule
  # the Node reader names. expected.txt names its own words for those, and holds each reader to
  # its own; for every other case the third field is empty and the sentence must be the same one.
  if [ -z "$shwords" ]; then
    case $b in *"$words"*) ok "    the shell reader says what is wrong" ;; *) bad "    the shell reader says what is wrong ([$b] holds no [$words])" ;; esac
    same "    and both say it in the same words" "$b" "$a"
  else
    case $b in *"$shwords"*) ok "    the shell reader says what is wrong in its own words" ;; *) bad "    the shell reader says what is wrong in its own words ([$b] holds no [$shwords])" ;; esac
  fi
done < "$CASES/expected.txt"

# ------------------------------- no name JavaScript gives every object, asked of both readers
# A stage file's fields are the ones it names itself. stage/stage.mjs builds its objects with
# JSON.parse, so JavaScript hands it toString, constructor, __proto__ and the rest for free, while
# stage/stage.sh has no prototypes and never sees one: that is exactly where the two readers could
# answer differently about one same file. Every name on stage/stage-cases/inherited-names.txt is
# put in six places and asked for in six, and the two readers are held to one same sentence and
# one same exit code throughout.
# Every value put in is one no rule can object to - the pin of a real add-on, the real edition's
# image - so each refusal is about the name and nothing else. Where addons and serverEditions name
# their children by a pattern, a lowercase inherited name is a name that pattern matches, so a
# wrong value would refuse the file for the wrong reason and prove nothing: there both readers
# refuse the name itself, out of the list stage.schema.json writes down.
printf '%s\n' "  no name JavaScript gives every object is a field, in either reader"
# The copies are named relative to the root, like everything else here: Git Bash rewrites an
# absolute POSIX path on its way to node.exe but not on its way to a shell, and each reader names
# the file it was handed, so only a relative path reads the same in both sentences.
INH=.stage-agree-inherited
rm -rf "$INH"
mkdir "$INH" || exit 1
trap 'rm -rf "$TMP" "$TEST_GUARD_HOME" "$ROOT/$INH"' EXIT

refuse_alike() { # <file> <what it is>: both readers refuse it, in one same sentence
  a=$(node_reader "$1" check 2>&1); ae=$?
  b=$(sh_reader "$1" check 2>&1); be=$?
  printf '  %-36s node(%s) %s\n' "$2" "$ae" "$a"
  printf '  %-36s shell(%s) %s\n' "" "$be" "$b"
  same "  $2: the Node reader refuses it with exit 1" "$ae" "1"
  same "  $2: the shell reader refuses it with exit 1" "$be" "1"
  same "    the Node reader says it on one line" "$(printf '%s\n' "$a" | grep -c .)" "1"
  same "    the shell reader says it on one line" "$(printf '%s\n' "$b" | grep -c .)" "1"
  same "    and both say it in the same words" "$b" "$a"
}

COMMIT=fecb22dd6f0376ebec810fa733a50eb880484f2e
DIGEST=$(node_reader "$STAGE" get serverEditions.server.image)
inhcount=0
while IFS= read -r name; do
  case $name in '' | '#'*) continue ;; esac
  inhcount=$((inhcount + 1))
  { head -n 1 "$STAGE"; printf '  "%s": "%s",\n' "$name" "$COMMIT"; tail -n +2 "$STAGE"; } > "$INH/root.json"
  refuse_alike "$INH/root.json" "a root field $name"
  for parent in kitBootstrap windowsSetup addons; do
    awk -v n="$name" -v c="$COMMIT" -v p="  \"$parent\": {" \
      '{ print } $0 == p { printf "    \"%s\": \"%s\",\n", n, c }' "$STAGE" > "$INH/$parent.json"
    refuse_alike "$INH/$parent.json" "$parent.$name"
  done
  awk -v n="$name" -v d="$DIGEST" '{ print } $0 == "  \"serverEditions\": {" { printf "    \"%s\": {\n      \"image\": \"%s\"\n    },\n", n, d }' \
    "$STAGE" > "$INH/named-edition.json"
  refuse_alike "$INH/named-edition.json" "serverEditions.$name"
  awk -v n="$name" -v d="$DIGEST" '{ print } $0 == "    \"server\": {" { printf "      \"%s\": \"%s\",\n", n, d }' \
    "$STAGE" > "$INH/edition.json"
  refuse_alike "$INH/edition.json" "serverEditions.server.$name"
  for path in "$name" "kitBootstrap.$name" "windowsSetup.$name" "addons.$name" \
              "serverEditions.$name" "serverEditions.server.$name"; do
    a=$(node_reader "$STAGE" get "$path" 2> "$TMP/inh-node.err"); ae=$?
    b=$(sh_reader "$STAGE" get "$path" 2> "$TMP/inh-sh.err"); be=$?
    same "  get $path: the Node reader leaves 2" "$ae" "2"
    same "  get $path: the shell reader leaves 2" "$be" "2"
    same "    the Node reader prints nothing" "$a" ""
    same "    the shell reader prints nothing" "$b" ""
    same "    and both say what is missing in the same words" "$(cat "$TMP/inh-sh.err")" "$(cat "$TMP/inh-node.err")"
  done
done < "$CASES/inherited-names.txt"
if [ "$inhcount" -ge 12 ]; then ok "  $inhcount inherited names were swept in both readers"
else bad "at least twelve inherited names were swept (only $inhcount)"; fi
rm -rf "$INH"

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

# A file that names one field twice is the one file the two readers would read differently:
# JSON.parse keeps the last of the two and the shell reader's own parser the first. Neither
# answers the withdrawn question from it, so the answer cannot be yes in one reader and no in the
# other; both refuse, and in the same words.
printf '%s\n' "  a file that names a field twice, asked the withdrawn question by both"
DUP=$CASES/bad-duplicate-field.json
for pair in "$DUP $CASES/ok-clean.json" "$CASES/ok-clean.json $DUP"; do
  set -- $pair
  a=$(node_reader withdrawn "$1" "$2" 2.0.0-beta.6 2> "$TMP/dup-node.err"); ae=$?
  b=$(sh_reader withdrawn "$1" "$2" 2.0.0-beta.6 2> "$TMP/dup-sh.err"); be=$?
  aerr=$(cat "$TMP/dup-node.err")
  berr=$(cat "$TMP/dup-sh.err")
  printf '  installed %-44s node(%s)[%s] shell(%s)[%s]\n' "$1" "$ae" "$aerr" "$be" "$berr"
  same "  the Node reader refuses it with exit 1" "$ae" "1"
  same "  the shell reader refuses it with exit 1" "$be" "1"
  same "    the Node reader answers neither yes nor no" "$a" ""
  same "    the shell reader answers neither yes nor no" "$b" ""
  same "    and both say what is wrong in the same words" "$berr" "$aerr"
done

# ------------------------------- a candidate's release tag, read the same by both readers
# The freeze publishes a candidate's Windows setup on the tag candidate/<version> and writes that
# tag into the stage file, so a release tag may hold one slash between two parts. The six files
# that break that rule are swept by the expected.txt loop above, which holds both readers to one
# same sentence; here the tag a candidate really carries is read by both and the two are compared.
printf '%s\n' "  a candidate's stage file, whose release tag holds one slash"
CANDIDATE=$CASES/ok-candidate-tag.json
a=$(node_reader "$CANDIDATE" get windowsSetup.releaseTag 2>&1); ae=$?
b=$(sh_reader "$CANDIDATE" get windowsSetup.releaseTag 2>&1); be=$?
printf '  %-38s node[%s] shell[%s]\n' "windowsSetup.releaseTag" "$a" "$b"
same "  the Node reader reads it" "$ae" "0"
same "  the shell reader reads it" "$be" "0"
same "    and both read it the same" "$b" "$a"
same "    and it is the candidate's own tag" "$a" "candidate/2.0.0-beta.7"
node_reader "$CANDIDATE" fields > "$TMP/cand-node.txt" 2>&1
same "    the Node reader lists its fields" "$?" "0"
sh_reader "$CANDIDATE" fields > "$TMP/cand-sh.txt" 2>&1
same "    the shell reader lists its fields" "$?" "0"
if diff -u "$TMP/cand-node.txt" "$TMP/cand-sh.txt" > "$TMP/cand.diff"; then
  ok "    both readers name the same fields of it"
else
  bad "    both readers name the same fields of it"
  cat "$TMP/cand.diff"
fi
while IFS= read -r path; do
  [ -n "$path" ] || continue
  a=$(node_reader "$CANDIDATE" get "$path" 2>&1); ae=$?
  b=$(sh_reader "$CANDIDATE" get "$path" 2>&1); be=$?
  if [ "$ae" -ne 0 ] || [ "$be" -ne 0 ]; then
    bad "    $path: a reader failed on the candidate's stage file (node exit $ae, shell exit $be)"
  else
    same "    $path reads the same in both readers" "$b" "$a"
  fi
done < "$TMP/cand-node.txt"

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

pins_nothing() { # <file>: a file that names no version of its own, because it reads stage.json
  file=$1
  printf '  reading %s, which pins nothing of its own: it reads the stage file instead\n' "$file"
  if found=$(grep -nE '[0-9a-f]{40}' "$file"); then bad "  $file still names a commit: $found"
  else ok "  $file names no commit"; fi
  if found=$(grep -nE 'godspeed-v[0-9][0-9A-Za-z.]*-[0-9A-Za-z]' "$file"); then bad "  $file still names a release tag: $found"
  else ok "  $file names no release tag"; fi
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
compare "version" "$VERSION" installers/windows-manifest.json
compare "product commit" "$PRODUCT" installers/windows-manifest.json
compare "Windows bootstrap commit" "$BOOTSTRAP" installers/windows-manifest.json
for f in docker/hostinger/compose.yaml docker/hostinger/one-click.yaml \
         docker/server/browser-compose-traefik.yaml docker/hostinger/installer/compose.mjs; do
  compare "server image" "$IMAGE" "$f"
done

# The Mac and Linux line stopped pinning anything on 25 October 2026: install-godspeed.sh reads the
# stage file of the stage it is told to install, and installers/install-godspeed.sh runs that
# installer rather than being a second copy of it. So the thing to ask about those two is the other
# way round from the files above: neither of them may name a version at all.
printf '%s\n' "  and the two files that pin nothing, because they read the stage file instead:"
pins_nothing install-godspeed.sh
pins_nothing installers/install-godspeed.sh

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
# AN ADD-ON THIS REPOSITORY CARRIES ITSELF has no commit of its own to be pinned to: its entry in
# sources.json says "carriedHere": true in place of a commit (notebook/scripts/vendor-addons.py says
# why; the Charm Challenge is the first). The product at the product commit is its source, so that
# commit is the pin the stage file names for it, and it is compared like every other add-on.
# Such an add-on is read from the working tree as well as from the product commit, and the two lists
# are merged by name: it is part of the product itself, so the stage file names it from the stage
# that first carries it, which is a stage whose product commit may still be an older one. Every
# other add-on is still read only at the product commit, never at today's main.
node -e '
  const read = (f) => JSON.parse(require("fs").readFileSync(f, "utf8"));
  const [frozen, here, product] = [read(process.argv[1]), read(process.argv[2]), process.argv[3]];
  const pins = new Map();
  for (const a of frozen) pins.set(a.name, a.carriedHere ? product : a.commit);
  for (const a of here) if (a.carriedHere && !pins.has(a.name)) pins.set(a.name, product);
  for (const name of [...pins.keys()].sort()) console.log(name + " " + pins.get(name));
' "$TMP/sources.json" third-party/addons/sources.json "$PRODUCT" > "$TMP/pins.txt"
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
