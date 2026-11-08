#!/usr/bin/env bash
# Which stage a run of .github/workflows/scenarios.yml proves, and where its files are read from.
#
#   bash scenarios/stage-for-run.sh <stage or ''> <commit> <folder>
#
# A stage given (a candidate's tag, beta, main) is that stage, read from GitHub as ever: nothing is
# made. No stage given (the night) is THIS COMMIT: a stage file made the way godspeed-dev's
# freeze.mjs makes a candidate's, with the product commit the one given, kit-bootstrap, the Windows
# setup and the withdrawn list carried from the public stage (beta), the add-ons pinned as
# third-party/addons/sources.json holds them at the commit, and the server image the commit's own
# v2-sha-<commit> (or, when CI built none for it because no image input changed, the newest
# first-parent ancestor's within 50, named on stderr). A same-repository pull-request scenario gets
# GODSPEED_SCENARIO_PR_IMAGE, the selected PR-head image's immutable digest; it never falls back.
# The folder then holds this-commit/ (the commit's files, its stage.json made) and beta/stage.json
# (the public stage as read), and a line reading raw=file://<folder> lets every installer and
# scenario read it as it reads GitHub.
#
# Standard output is exactly two lines, ready for >> "$GITHUB_OUTPUT":  ref=<ref>  raw=<address>
# Seams for the tests: GODSPEED_SCENARIO_PUBLIC_RAW (where beta/stage.json is read),
# GODSPEED_SCENARIO_IMAGES (a file of "<image>:<tag> sha256:<64 hex>" lines; the registry is not
# asked when it is set), GODSPEED_SCENARIO_REPO (the checkout).
set -euo pipefail
GH_RAW=https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO=${GODSPEED_SCENARIO_REPO:-$(cd "$HERE/.." && pwd)}
PUBLIC_RAW=${GODSPEED_SCENARIO_PUBLIC_RAW:-$GH_RAW}
PUBLIC_RAW=${PUBLIC_RAW%/}
say() { printf '%s\n' "$*" >&2; }
usage() { say "usage: bash scenarios/stage-for-run.sh <stage or ''> <commit> <folder>"; exit 2; }
[ $# -eq 3 ] || usage
stage=$1; commit=$2; folder=$3
case $commit in *[!0-9a-f]* | '') usage ;; esac
[ ${#commit} -eq 40 ] || usage
pr_image=${GODSPEED_SCENARIO_PR_IMAGE:-}
if [ -n "$pr_image" ]; then
  [[ $pr_image =~ ^ghcr\.io/[a-z0-9][a-z0-9._/-]*@sha256:[0-9a-f]{64}$ ]] || { say "The PR scenario image is not an immutable ghcr.io digest: $pr_image"; exit 2; }
  pr_image_name=${pr_image%@*}
  pr_image_digest=${pr_image#*@}
fi

if [ -n "$stage" ]; then
  printf 'ref=%s\nraw=%s\n' "$stage" "$GH_RAW"
  exit 0
fi

mkdir -p "$folder"
folder=$(cd "$folder" && pwd)
mkdir -p "$folder/beta" "$folder/this-commit"
curl -fsSL "$PUBLIC_RAW/beta/stage.json" -o "$folder/beta/stage.json" ||
  { say "The public stage at $PUBLIC_RAW/beta/stage.json could not be read, so this commit's stage cannot be made."; exit 1; }

digest_of() { # <image name> <tag>: the digest, or nothing
  local image=$1 tag=$2 line name token
  if [ -n "${GODSPEED_SCENARIO_IMAGES:-}" ]; then
    awk -v k="$image:$tag" '$1 == k { print $2; exit }' "$GODSPEED_SCENARIO_IMAGES"
    return 0
  fi
  case $image in ghcr.io/*) name=${image#ghcr.io/} ;; *) return 0 ;; esac
  token=$(curl -fsSL "https://ghcr.io/token?service=ghcr.io&scope=repository:$name:pull" 2>/dev/null |
    sed -n 's/.*"token" *: *"\([^"]*\)".*/\1/p') || true
  [ -n "$token" ] || return 0
  line=$(curl -fsSI -H "Authorization: Bearer $token" \
    -H 'Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.v2+json' \
    "https://ghcr.io/v2/$name/manifests/$tag" 2>/dev/null | tr -d '\r' | grep -i '^docker-content-digest:') || true
  printf '%s\n' "${line#*: }" | grep -E '^sha256:[0-9a-f]{64}$' || true
}

# The editions the public stage names; the commit whose image they get is the first with all of them.
editions=$(node "$HERE/../stage/stage.mjs" "$folder/beta/stage.json" json |
  node -e 'const s=JSON.parse(require("fs").readFileSync(0,"utf8"));for(const [k,v] of Object.entries(s.serverEditions))console.log(k+" "+v.image.split("@")[0])')
chosen=''
commits=$(git -C "$REPO" rev-list --first-parent -n 50 "$commit")
[ -z "$pr_image" ] || commits=$commit
for c in $commits; do
  all=yes; found=''
  while read -r edition image; do
    if [ -n "$pr_image" ]; then
      [ "$image" = "$pr_image_name" ] || { say "The PR scenario image is not the $edition server image: $pr_image"; exit 2; }
      d=$pr_image_digest
    else
      d=$(digest_of "$image" "v2-sha-$c")
    fi
    if [ -z "$d" ]; then all=no; break; fi
    found="$found$edition $d;"
  done <<<"$editions"
  if [ "$all" = yes ]; then chosen=$c; digests=$found; break; fi
done
[ -n "$chosen" ] || { if [ -n "$pr_image" ]; then say "The PR-head server image is unavailable, so this commit cannot be proved on the Docker server."; else say "No server image v2-sha-<commit> exists for $commit or its 49 first-parent ancestors, so this commit cannot be proved on the Docker server."; fi; exit 1; }
if [ -n "$pr_image" ]; then
  say "The server image is PR head ${commit:0:7}'s immutable image."
elif [ "$chosen" != "$commit" ]; then
  say "CI built no server image for ${commit:0:7} (no image input changed); the server image is ${chosen:0:7}'s, the newest commit before it that has one."
else
  say "The server image is ${commit:0:7}'s own."
fi

git -C "$REPO" archive "$commit" | tar -x -C "$folder/this-commit"
git -C "$REPO" show "$commit:third-party/addons/sources.json" >"$folder/sources.json"
node -e '
const fs = require("fs");
const [pub, sources, commit, digests, out] = process.argv.slice(1);
const s = JSON.parse(fs.readFileSync(pub, "utf8"));
s.version = `${s.version}.commit.${commit.slice(0, 7)}`;
s.productCommit = commit;
for (const pair of digests.split(";").filter(Boolean)) {
  const [edition, digest] = pair.split(" ");
  s.serverEditions[edition].image = `${s.serverEditions[edition].image.split("@")[0]}@${digest}`;
}
s.addons = {};
for (const a of JSON.parse(fs.readFileSync(sources, "utf8"))) s.addons[a.name] = a.commit || commit;
s.previous = null;
fs.writeFileSync(out, JSON.stringify(s, null, 2) + "\n");
' "$folder/beta/stage.json" "$folder/sources.json" "$commit" "$digests" "$folder/this-commit/stage.json"
rm -f "$folder/sources.json"
node "$HERE/../stage/stage.mjs" "$folder/this-commit/stage.json" check
sh "$HERE/../stage/stage.sh" "$folder/this-commit/stage.json" check
printf 'ref=this-commit\nraw=file://%s\n' "$folder"
