#!/usr/bin/env bash
# Give a mission control its checked private GitHub home. The server installer calls this
# only after the starter files and secret-file ignores are in place. It also
# repairs a run where origin was added but the first push did not finish.
set -uo pipefail

godspeed="${1:-}"
repo_name="${2:-}"

fail() {
  printf '   stop: %s\n' "$*" >&2
  exit 1
}

[ -n "$godspeed" ] || fail "the mission control folder was not named"
[ -d "$godspeed/.git" ] || fail "$godspeed is not a git repository"
command -v gh >/dev/null 2>&1 || fail "the GitHub tool is not installed"

origin="$(git -C "$godspeed" remote get-url origin 2>/dev/null || true)"

if [ -z "$origin" ]; then
  if [ -z "$repo_name" ]; then
    printf 'Name for the new private GitHub repository [godspeed]: '
    IFS= read -r repo_name || true
  fi
  repo_name="${repo_name:-godspeed}"

  case "$repo_name" in
    *[!A-Za-z0-9._-]*|'')
      fail "repository names may contain letters, numbers, dots, dashes and underscores"
      ;;
  esac
fi

if ! git -C "$godspeed" config user.name >/dev/null 2>&1; then
  git -C "$godspeed" config user.name "Godspeed Owner"
fi
if ! git -C "$godspeed" config user.email >/dev/null 2>&1; then
  git -C "$godspeed" config user.email "godspeed@localhost"
fi

if ! git -C "$godspeed" rev-parse --verify HEAD >/dev/null 2>&1; then
  git -C "$godspeed" add -A || fail "the starter files could not be prepared for the first commit"
  git -C "$godspeed" commit -q -m "Start my mission control" \
    || fail "the first commit could not be created"
fi

branch="$(git -C "$godspeed" branch --show-current)"
[ -n "$branch" ] || fail "the mission control has no current branch to push"

# A folder started by `git init` on Ubuntu is on `master`; GitHub's own default is
# `main`, and so is every repository the book's other chapters make. Rename before
# the first push, while nothing points at the name yet. An existing origin is
# left exactly as it is.
if [ -z "$origin" ] && [ "$branch" = "master" ]; then
  git -C "$godspeed" branch -M main && branch=main
fi

if [ -z "$origin" ]; then
  printf '   Creating the private GitHub repository %s and pushing the mission control\n' "$repo_name"
  gh repo create "$repo_name" --private --source "$godspeed" --remote origin --push >/dev/null \
    || fail "GitHub did not create and receive the private repository '$repo_name'. No public repository was requested."
else
  printf '   Checking the private GitHub repository and its pushed branch\n'
  git -C "$godspeed" push -q -u origin "$branch" \
    || fail "the local branch could not be pushed to origin"
fi

git -C "$godspeed" ls-remote --exit-code origin "refs/heads/$branch" >/dev/null 2>&1 \
  || fail "the repository exists, but the first commit did not reach it"

# Asked from inside the mission control. With no repository named, the GitHub tool reads the
# remotes of the current directory, and the installer calls this script from the
# account's home, not from the mission control. Found on the 2026-09-05 end-to-end run, where
# every install stopped here with a private repository already created and pushed.
repo_check="$(cd "$godspeed" && gh repo view --json isPrivate,url --jq '[.isPrivate, .url] | @tsv' 2>/dev/null)" \
  || fail "the repository exists, but its privacy could not be checked from $godspeed"
private="${repo_check%%$'\t'*}"
url="${repo_check#*$'\t'}"
[ "$private" = "true" ] || fail "GitHub reports that $url is not private"

printf '   ok: private GitHub repository: %s\n' "$url"
printf '   ok: the first commit reached %s on branch %s\n' "$url" "$branch"
