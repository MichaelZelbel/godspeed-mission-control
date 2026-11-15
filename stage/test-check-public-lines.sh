#!/bin/sh
# The gate for stage/check-public-lines.sh, the check that no public line of this repository
# names the main branch or a dated release tag.
#
# Every case builds its own small tree of the files the check reads, in a throwaway folder, so
# what the test proves is what the check does and not what this repository happens to say today.
# The last case is the exception: it runs the check on this checkout to prove that every file the
# check names is really there, so a file that was renamed cannot turn the check off quietly.
# Itself POSIX, so it runs under dash as well: bash stage/test-check-public-lines.sh
# Run: bash stage/test-check-public-lines.sh   (from the root of a checkout of this kit)
set -u
. "$(dirname "$0")/../tools/test-guard.bash"

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
CHECK=$HERE/check-public-lines.sh

TMP=$(mktemp -d)
trap 'rm -rf "$TMP" "$TEST_GUARD_HOME"' EXIT

PASS=0
FAIL=0
ok()  { PASS=$((PASS + 1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL + 1)); printf '  FAIL %s\n' "$1"; }
same() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (wanted [$3], got [$2])"; fi; }
holds() { case $2 in *"$3"*) ok "$1" ;; *) bad "$1 ([$3] is not in what it said)" ;; esac; }
holds_not() { case $2 in *"$3"*) bad "$1 ([$3] is in what it said)" ;; *) ok "$1" ;; esac; }

RAW=https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control
HUB=https://github.com/MichaelZelbel/godspeed-mission-control
COMMIT=9390da492a0035a41b0eb02584234e269bca6dc8

run() { # <folder>: fills OUT and CODE
  OUT=$(sh "$CHECK" "$@" 2>&1)
  CODE=$?
  return 0
}

# A tree of all the files the check reads, every one of them holding only addresses it must be
# happy with: the public stage, an exact commit, the release marked Latest, and another
# repository's own pin of its main branch.
tree() { # <folder>
  d=$1
  rm -rf "$d"
  mkdir -p "$d/docker/server" "$d/docker/rootfs/usr/local/bin" "$d/docker/hostinger" \
           "$d/installers" "$d/server"
  cat > "$d/README.md" <<EOF
curl -fsSL https://godspeedmissioncontrol.com/install | bash
curl -fsSLO $RAW/beta/install-godspeed.sh
[Download GodspeedSetup.exe]($HUB/releases/latest/download/GodspeedSetup.exe)
GODSPEED_STAGE_REF=candidate/2.0.0-beta.7 names another stage.
EOF
  cat > "$d/docker/README.md" <<EOF
curl -fsSL $RAW/beta/docker/install.sh | bash
EOF
  cat > "$d/server/README.md" <<EOF
curl -fsSL https://godspeedmissioncontrol.com/server | bash
EOF
  cat > "$d/server/setup.md" <<EOF
curl -fsSL $RAW/beta/server/open-the-door.sh | bash
EOF
  cat > "$d/install-godspeed.sh" <<EOF
STAGE_RAW=\${GODSPEED_STAGE_RAW:-$RAW}
STARTER=$HUB.git
EOF
  cp "$d/install-godspeed.sh" "$d/installers/install-godspeed.sh"
  cat > "$d/docker/server/install.sh" <<EOF
# (the same file as $RAW/beta/docker/server/install.sh)
GODSPEED_RAW_BASE="\${GODSPEED_RAW_BASE:-$RAW}"
EOF
  cat > "$d/server/install.sh" <<EOF
KB_SELF_URL="\${KB_SELF_URL:-$RAW/beta/server/install.sh}"
EOF
  cat > "$d/docker/rootfs/usr/local/bin/godspeed-telegram-setup" <<EOF
ONE_LINER = "$RAW/beta/install-godspeed.sh"
WINDOWS_EXE = "$HUB/releases/latest/download/GodspeedSetup.exe"
EOF
  cat > "$d/install-godspeed-dev.sh" <<EOF
# For development only: main's newest commit.
GODSPEED_PRODUCT_REF=\$(git ls-remote $HUB.git refs/heads/main | cut -f1)
hook=\$(curl -fsSL "$RAW/\$GODSPEED_PRODUCT_REF/notebook/scripts/install-native-notebook.sh")
EOF
  cat > "$d/docker/hostinger/README.md" <<EOF
[Install on Hostinger](https://www.hostinger.com/docker-hosting?compose_url=https%3A%2F%2Fraw.githubusercontent.com%2FMichaelZelbel%2Fgodspeed-mission-control%2F78ea790d766073bf77059fadf4d1c340b022059d%2Fdocker%2Fhostinger%2Fone-click.yaml&REFERRALCODE=GHNMICHAEJC8#pricing)
A pin of another repository's main: $RAW/../kit-bootstrap/main/setup-godspeed.sh
EOF
  cat > "$d/other-repository-note.md" <<'EOF'
https://raw.githubusercontent.com/MichaelZelbel/kit-bootstrap/main/setup-godspeed.sh
EOF
}

T=$TMP/tree

printf 'A tree whose every address is beta, a commit or Latest\n'
tree "$T"; run "$T"
same  "it is happy with it" "$CODE" 0
holds "and says so in plain words" "$OUT" 'No public line names the main branch or a dated release tag.'
holds "and names each file it read" "$OUT" 'docker/rootfs/usr/local/bin/godspeed-telegram-setup'

printf 'Another repository pinned to its own main is not ours\n'
holds_not "kit-bootstrap at main is left alone" "$OUT" 'kit-bootstrap'

printf "The README's stale dated release tag\n"
tree "$T"
printf 'curl -fsSLO %s/releases/download/godspeed-v2-integrated-2026-10-21-1/install-godspeed.sh\n' \
  "$HUB" >> "$T/README.md"
run "$T"
same  "it is refused" "$CODE" 1
holds "the file and the line are named" "$OUT" 'README.md:5:'
holds "and why" "$OUT" 'names a dated release tag'
holds "and the line itself is shown" "$OUT" 'godspeed-v2-integrated-2026-10-21-1'

printf 'A download address reading main\n'
tree "$T"
printf 'curl -fsSL %s/main/docker/install.sh | bash\n' "$RAW" >> "$T/docker/README.md"
run "$T"
same  "it is refused" "$CODE" 1
holds "the file and the line are named" "$OUT" 'docker/README.md:2:'
holds "and why" "$OUT" 'reads the main branch'

printf "A reader's pasted line reading main, further down a long page\n"
tree "$T"
printf 'curl -fsSL %s/main/server/install-watchdog.sh | bash\n' "$RAW" >> "$T/server/setup.md"
run "$T"
same  "it is refused" "$CODE" 1
holds "the file and the line are named" "$OUT" 'server/setup.md:2:'

printf 'An installer setting whose default reads main\n'
tree "$T"
printf 'GODSPEED_RAW="${GODSPEED_RAW:-%s/main}"\n' "$RAW" >> "$T/docker/server/install.sh"
run "$T"
same  "it is refused, however the line goes on after the branch name" "$CODE" 1
holds "the file and the line are named" "$OUT" 'docker/server/install.sh:3:'

printf 'A web address with the slashes spelled out\n'
tree "$T"
printf 'compose_url=https%%3A%%2F%%2Fraw.githubusercontent.com%%2FMichaelZelbel%%2Fgodspeed-mission-control%%2Fmain%%2Fdocker%%2Fhostinger%%2Fone-click.yaml\n' \
  >> "$T/docker/hostinger/README.md"
run "$T"
same  "it is refused too" "$CODE" 1
holds "the file and the line are named" "$OUT" 'docker/hostinger/README.md:3:'

printf "Hostinger's purchase link at its fixed commit is allowed\n"
tree "$T"; run "$T"
same  "a link naming a commit is no dated tag and no branch" "$CODE" 0

printf "The alpha line's own main is allowed, and only that line\n"
tree "$T"; run "$T"
same  "install-godspeed-dev.sh asking main for its newest commit passes" "$CODE" 0
printf 'curl -fsSL %s/main/notebook/scripts/install-native-notebook.sh\n' "$RAW" \
  >> "$T/install-godspeed-dev.sh"
run "$T"
same  "a second, different main address in the same file is still refused" "$CODE" 1
holds "and that line is named" "$OUT" 'install-godspeed-dev.sh:4:'

printf 'An exact commit of this repository is what a pin should look like\n'
tree "$T"
printf 'hook=$(curl -fsSL %s/%s/notebook/scripts/install-native-notebook.sh)\n' "$RAW" "$COMMIT" \
  >> "$T/install-godspeed.sh"
run "$T"
same  "it passes" "$CODE" 0

printf 'A file the check reads that is not there\n'
tree "$T"; rm "$T/server/setup.md"; run "$T"
same  "it is refused rather than passed over" "$CODE" 1
holds "and the missing file is named" "$OUT" 'server/setup.md is not there'

printf 'The command line\n'
run "$TMP/no-such-folder"
same  "a folder that is not there is said so, apart from a finding" "$CODE" 2
OUT=$(sh "$CHECK" --help 2>&1); CODE=$?
same  "--help answers" "$CODE" 0
holds "with the usage" "$OUT" 'usage: sh stage/check-public-lines.sh'

printf 'This checkout itself\n'
run "$ROOT"
holds_not "every file the check names is really there" "$OUT" 'is not there'
if [ "$CODE" = 0 ] || [ "$CODE" = 1 ]; then
  ok "it reads this checkout and answers (exit $CODE)"
else
  bad "it could not read this checkout (exit $CODE)"
fi

printf '\n%s of %s pass.\n' "$PASS" "$((PASS + FAIL))"
[ "$FAIL" -eq 0 ]
