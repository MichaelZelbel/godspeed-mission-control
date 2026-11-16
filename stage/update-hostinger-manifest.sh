#!/bin/sh
# The release step calls this after freezing stage.json and again with --check after promoting beta.
set -eu

case ${1:-} in
  '') mode='' ;;
  --check) mode=--check ;;
  *) printf 'usage: sh stage/update-hostinger-manifest.sh [--check]\n' >&2; exit 2 ;;
esac

image=$(node stage/stage.mjs stage.json get serverEditions.server.image)
node docker/hostinger/installer/public-compose.mjs "$image" $mode
