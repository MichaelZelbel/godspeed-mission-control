#!/bin/sh
# Every public line of this repository reads the public stage, beta, or one exact version. This
# check fails when one of them names the main branch or a dated release tag instead.
#
#   sh stage/check-public-lines.sh            the checkout you are in
#   sh stage/check-public-lines.sh <folder>   another copy of these files, for example one
#                                             written out of an older commit
#
# Exit: 0 nothing found, 1 at least one line names main or a dated tag (each printed as
# <file>:<line>, why it is wrong, and the line itself), 2 the command line was wrong.
#
# Why it matters: a line naming main installs whatever was merged today, tested or not, and a line
# naming a dated release tag (godspeed-v2-integrated-2026-10-21-1) installs a version that is no
# longer current. beta holds the version the maintainer released, and only the release step moves
# it. An exact commit, an image digest and the release marked Latest are fine too: each names one
# version and goes on naming it.
#
# It lives here beside the stage readers and not in tools/, because kit-bootstrap installs every
# file of tools/ onto every user's computer as a program, and this is a check for this repository.
#
# Its own test is stage/test-check-public-lines.sh. It reads files only and reaches no network.
set -u
LC_ALL=C
export LC_ALL

TAB=$(printf '\t')
NL='
'

ROOT=.
case ${1:-} in
  -h | --help)
    printf 'usage: sh stage/check-public-lines.sh [folder holding these files]\n'
    exit 0
    ;;
  '') ;;
  -*)
    printf 'sh stage/check-public-lines.sh takes a folder, and %s is not one.\n' "$1" >&2
    exit 2
    ;;
  *) ROOT=$1 ;;
esac
if [ ! -d "$ROOT" ]; then
  printf '%s is not a folder.\n' "$ROOT" >&2
  exit 2
fi

# The public lines: everything a reader copies, and every address one of our own installers
# fetches from. install-godspeed-dev.sh and docker/hostinger/README.md are read for the sake of
# the allowed list below, which is about addresses in them.
FILES="README.md
docker/README.md
server/README.md
server/setup.md
install-godspeed.sh
installers/install-godspeed.sh
docker/server/install.sh
server/install.sh
docker/rootfs/usr/local/bin/godspeed-telegram-setup
install-godspeed-dev.sh
docker/hostinger/README.md"

# What is wrong: an expression and why, each looked for only in lines that name this repository,
# so a pin of kit-bootstrap or of an add-on is left alone. The first expression ends the branch
# name on anything a ref name cannot hold, so it finds the branch however the line goes on:
# ".../godspeed-mission-control/main/docker/install.sh", a bare ".../godspeed-mission-control/main"
# at the end of a line, and one inside a shell setting, ".../godspeed-mission-control/main}". A
# branch whose name only starts with those letters, were there ever one, is not it.
rules() {
  printf '%s\t%s\n' \
    'godspeed-mission-control/main([^A-Za-z0-9._-]|$)' \
    'reads the main branch, which every merge moves' \
    'godspeed-mission-control%2Fmain' \
    'reads the main branch, which every merge moves, through a web address spelled out' \
    'refs/heads/main' \
    'asks for the newest commit of the main branch' \
    'godspeed-v2-integrated-' \
    'names a dated release tag, which the next release leaves behind'
}

# Addresses that are allowed on purpose: the file, the expression that finds the line, and why.
#
# Also allowed and needing no line here: Hostinger's purchase link in docker/hostinger/README.md.
# Its compose_url names a fixed commit (78ea790d...), which is neither main nor a dated tag, so no
# rule above objects to it. The one-click server has no update path, so that link stays at its
# commit; and because the file is read, changing it to main or to a dated tag would be found.
allowed() {
  printf '%s\t%s\t%s\n' \
    'install-godspeed-dev.sh' \
    'git ls-remote .*refs/heads/main' \
    'the alpha line installs main newest commit by design, and says so; it is not for readers'
}

found=0
missing=0
read_files=''

for file in $FILES; do
  path=$ROOT/$file
  if [ ! -f "$path" ]; then
    printf '%s is not there. Every file this check reads has to be read, so a file that was\n' "$file"
    printf 'renamed or moved cannot turn the check off quietly.\n'
    missing=1
    continue
  fi
  read_files="$read_files  $file$NL"

  # Only the lines that name this repository; anything else is another repository's pin.
  mine=$(grep -n 'godspeed-mission-control' "$path" 2>/dev/null) || mine=''
  [ -n "$mine" ] || continue

  # The allowed expressions of this file, joined into one, so a single grep passes them over.
  pass=''
  while IFS=$TAB read -r afile apattern areason; do
    [ "$afile" = "$file" ] || continue
    [ -n "$areason" ] || continue
    if [ -n "$pass" ]; then pass="$pass|$apattern"; else pass=$apattern; fi
  done <<ALL
$(allowed)
ALL

  while IFS=$TAB read -r pattern reason; do
    [ -n "$reason" ] || continue
    hits=$(printf '%s\n' "$mine" | grep -E -- "$pattern") || continue
    if [ -n "$pass" ]; then
      hits=$(printf '%s\n' "$hits" | grep -E -v -- "$pass") || continue
    fi
    [ -n "$hits" ] || continue
    printf '%s\n' "$hits" | while IFS= read -r hit; do
      number=${hit%%:*}
      text=${hit#*:}
      printf '%s:%s: %s\n' "$file" "$number" "$reason"
      printf '  %s\n' "$(printf '%s' "$text" | sed 's/^[[:space:]]*//')"
    done
    found=1
  done <<RUN
$(rules)
RUN
done

if [ "$missing" -ne 0 ]; then
  printf '\nAt least one file this check reads is not there.\n'
  exit 1
fi

printf 'Read for addresses of this repository:\n%s' "$read_files"
if [ "$found" -ne 0 ]; then
  printf '\nA public line names the main branch or a dated release tag. Every line a reader copies,\n'
  printf 'and every address one of our installers fetches from, reads the public stage beta, or one\n'
  printf 'exact commit, image digest, or the release marked Latest.\n'
  exit 1
fi
printf 'No public line names the main branch or a dated release tag.\n'
exit 0
