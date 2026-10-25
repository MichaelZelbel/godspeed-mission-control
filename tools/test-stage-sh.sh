#!/bin/sh
# The gate for tools/stage.sh, the stage reader installers use. It runs the whole case list under
# every shell on this machine - /bin/bash, dash and sh where they are there - because the reader
# has to answer the same in the Mac's own bash 3.2, in dash and in bash 5. The malformed files
# are the ones in tools/stage-cases/ that tools/test-stage.mjs holds the Node reader to, and the
# words their refusal must hold are in tools/stage-cases/expected.txt, so the two readers cannot
# drift apart.
# Itself POSIX, so it runs under dash as well: bash tools/test-stage-sh.sh
# Run: bash tools/test-stage-sh.sh   (from the root of a checkout of this kit)
set -u
. "$(dirname "$0")/test-guard.bash"

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
READER=$HERE/stage.sh
CASES=$HERE/stage-cases
STAGE=$ROOT/stage.json

TMP=$(mktemp -d)
trap 'rm -rf "$TMP" "$TEST_GUARD_HOME"' EXIT

PASS=0
FAIL=0
ok()   { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$1"; }
same() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (wanted [$3], got [$2])"; fi; }
holds() { case $2 in *"$3"*) ok "$1" ;; *) bad "$1 ([$2] does not hold [$3])" ;; esac; }

# A copy of stage.json that is sound JSON but not the layout the shell reader reads. It must be
# refused with a plain sentence rather than read wrongly; the Node reader takes it, and says so.
printf '' > "$TMP/crlf.json"
CR=$(printf '\r')
while IFS= read -r l; do printf '%s%s\n' "$l" "$CR" >> "$TMP/crlf.json"; done < "$STAGE"
tr -d '\n' < "$STAGE" > "$TMP/compact.json"

run_one() { # <shell> ...reader arguments: fills OUT, ERRS, CODE
  OUT=$("$RUNSH" "$READER" "$@" 2> "$TMP/err.txt")
  CODE=$?
  ERRS=$(cat "$TMP/err.txt")
  return 0
}

run_all() { # <shell>
  RUNSH=$1
  printf '\n%s\n' "tools/stage.sh under $RUNSH"

  run_one "$STAGE" check
  same "the real stage.json is read and checked" "$CODE" "0"
  same "  and check prints nothing" "$OUT$ERRS" ""

  run_one "$STAGE" fields
  same "fields leaves 0" "$CODE" "0"
  FIELDS=$OUT
  COUNT=$(printf '%s\n' "$FIELDS" | grep -c .)
  if [ "$COUNT" -ge 12 ]; then ok "fields names $COUNT fields"; else bad "fields names at least twelve fields (only $COUNT)"; fi
  for want in version productCommit kitBootstrap.unixEngineCommit serverEditions.server.image \
              windowsSetup.sha256 addons.mc-video previous withdrawn stageFormat; do
    if printf '%s\n' "$FIELDS" | grep -qx -- "$want"; then ok "  fields names $want"
    else bad "fields names $want (it does not)"; fi
  done

  everyfield=0
  for path in $FIELDS; do
    run_one "$STAGE" get "$path"
    if [ "$CODE" -ne 0 ]; then bad "get $path leaves 0 (exit $CODE: $ERRS)"; everyfield=1; fi
  done
  [ "$everyfield" -eq 0 ] && ok "every field fields names can be read"

  run_one "$STAGE" get productCommit
  case $OUT in
    *[!0123456789abcdef]*) bad "the product commit is forty lowercase hex ([$OUT])" ;;
    *) if [ "${#OUT}" -eq 40 ]; then ok "the product commit is forty lowercase hex"; else bad "the product commit is forty characters (${#OUT})"; fi ;;
  esac
  run_one "$STAGE" get serverEditions.server.image
  holds "the server image is pinned by digest" "$OUT" "@sha256:"

  run_one "$STAGE" json
  if cmp -s "$TMP/err.txt" /dev/null && printf '%s\n' "$OUT" | cmp -s - "$STAGE"; then
    ok "json prints the file it checked, byte for byte"
  else
    bad "json prints the file it checked, byte for byte"
  fi

  for path in thereIsNoSuchField kitBootstrap addons.not-an-addon serverEditions.server; do
    run_one "$STAGE" get "$path"
    same "get $path leaves 2, not the refusal 1" "$CODE" "2"
    same "  and prints nothing" "$OUT" ""
    holds "  and says so in one sentence" "$ERRS" "has no readable field"
  done

  printf '%s\n' "  the malformed files of tools/stage-cases/"
  cases=0
  while IFS='|' read -r file words; do
    case $file in '' | '#'*) continue ;; esac
    cases=$((cases + 1))
    run_one "$CASES/$file" check
    same "  $file is refused with exit 1" "$CODE" "1"
    same "    and prints nothing on stdout" "$OUT" ""
    lines=$(printf '%s\n' "$ERRS" | grep -c .)
    same "    and one sentence on stderr" "$lines" "1"
    holds "    saying what is wrong" "$ERRS" "$words"
  done < "$CASES/expected.txt"
  if [ "$cases" -ge 8 ]; then ok "  $cases malformed cases were run"; else bad "at least eight malformed cases ($cases)"; fi

  printf '%s\n' "  a sound file in a layout this reader does not read"
  for odd in crlf compact; do
    run_one "$TMP/$odd.json" check
    same "  the $odd copy of stage.json is refused with exit 1" "$CODE" "1"
    lines=$(printf '%s\n' "$ERRS" | grep -c .)
    same "    with one plain sentence" "$lines" "1"
    holds "    naming the layout" "$ERRS" "the layout a stage file is written in"
    run_one "$TMP/$odd.json" get productCommit
    same "    and it never answers from it" "$OUT" ""
  done

  printf '%s\n' "  the withdrawn answer"
  for pair in "ok-clean ok-clean no" "ok-clean ok-withdrawn yes" "ok-withdrawn ok-clean yes" "ok-withdrawn ok-withdrawn yes"; do
    set -- $pair
    run_one withdrawn "$CASES/$1.json" "$CASES/$2.json"
    same "  installed $1, public $2" "$OUT" "$3"
    same "    and leaves 0" "$CODE" "0"
  done
  run_one withdrawn "$CASES/ok-withdrawn.json" "$CASES/ok-withdrawn.json" 2.0.0-beta.5
  same "  a version nobody withdrew is not withdrawn" "$OUT" "no"
  run_one withdrawn "$CASES/ok-clean.json" "$CASES/ok-withdrawn.json" 2.0.0-beta.6
  same "  a version the public stage lists is withdrawn" "$OUT" "yes"
  run_one withdrawn "$CASES/ok-clean.json" "$CASES/ok-clean.json" "beta six"
  same "  a version that is not one is refused" "$CODE" "1"
  holds "    with a plain sentence" "$ERRS" "is not a version like 2.0.0-beta.6"
  run_one withdrawn "$CASES/bad-pattern.json" "$CASES/ok-clean.json"
  same "  a malformed installed stage is refused, so the answer fails closed" "$CODE" "1"
  same "    and no answer is printed" "$OUT" ""

  # This reader's own parser keeps the first of two fields with one name and JSON.parse in
  # tools/stage.mjs keeps the last, so a file that names withdrawn twice would read differently in
  # the two. Neither answers from it, whichever of the two stages holds the duplicate.
  for pair in "bad-duplicate-field ok-clean installed" "ok-clean bad-duplicate-field public"; do
    set -- $pair
    run_one withdrawn "$CASES/$1.json" "$CASES/$2.json" 2.0.0-beta.6
    same "  a $3 stage that names a field twice is refused" "$CODE" "1"
    same "    and no answer is printed" "$OUT" ""
    holds "    with a plain sentence" "$ERRS" "names withdrawn twice; a stage file names each field once."
  done
  run_one "$CASES/bad-duplicate-field.json" get withdrawn
  same "  and no field of it can be read either" "$CODE" "1"
  same "    with nothing on stdout" "$OUT" ""

  run_one "$CASES/ok-later-stage.json" get previous.version
  same "a stage that replaced another names its previous version" "$OUT" "2.0.0-beta.6"
  run_one "$CASES/ok-later-stage.json" get previous.stageCommit
  same "  and the commit of the stage file it came from" "$OUT" "9390da492a0035a41b0eb02584234e269bca6dc8"

  run_one "$TMP/nowhere.json" check
  same "a file that is not there is refused" "$CODE" "1"
  holds "  with a plain sentence" "$ERRS" "there is no such file"
  run_one --help
  same "--help leaves 0" "$CODE" "0"
  run_one "$STAGE" sing
  same "a command it does not know leaves 2" "$CODE" "2"
}

# ------------------------------------------------------------- every shell on this machine
# One name can reach one shell twice (/bin/bash and /usr/bin/bash are usually one file), so a
# shell already run is recognised by the file it is, not by the name it was found under.
SHELLS=''
SEEN=''
for candidate in /bin/bash /usr/bin/bash bash /bin/dash /usr/bin/dash dash /bin/sh /usr/bin/sh sh; do
  found=$(command -v "$candidate" 2>/dev/null) || continue
  [ -n "$found" ] || continue
  [ -x "$found" ] || continue
  which=$(ls -i "$found" 2>/dev/null | awk '{print $1}')
  [ -n "$which" ] || which=$found
  case " $SEEN " in *" $which "*) continue ;; esac
  SEEN="$SEEN $which"
  SHELLS="$SHELLS $found"
done
printf 'the stage reader for installers, under:%s\n' "$SHELLS"

HOWMANY=0
for one in $SHELLS; do
  HOWMANY=$((HOWMANY + 1))
  run_all "$one"
done
printf '\n'
if [ "$HOWMANY" -lt 2 ]; then
  bad "at least two shells were found on this machine (found $HOWMANY)"
else
  ok "$HOWMANY shells were found and every one of them ran the whole list:$SHELLS"
fi

printf '%s of %s pass.\n' "$PASS" "$((PASS + FAIL))"
[ "$FAIL" -eq 0 ]
