#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
CREATE_REPO_SCRIPT="${CREATE_REPO_SCRIPT:-$ROOT/create-private-repo.sh}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

pass=0
fail=0

check() {
  local name="$1"
  shift
  if "$@"; then
    printf 'PASS: %s\n' "$name"
    pass=$((pass + 1))
  else
    printf 'FAIL: %s\n' "$name"
    fail=$((fail + 1))
  fi
}

mkdir -p "$WORK/bin" "$WORK/godspeed"
printf '# My godspeed\n' > "$WORK/godspeed/README.md"
git -C "$WORK/godspeed" init -q -b main

cat > "$WORK/bin/gh" <<'GH'
#!/usr/bin/env bash
set -euo pipefail

if [ "$1 $2" = "repo create" ]; then
  shift 2
  name="$1"
  shift
  source_dir=""
  private=0
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --source) source_dir="$2"; shift 2 ;;
      --private) private=1; shift ;;
      *) shift ;;
    esac
  done
  [ "$private" -eq 1 ] || { printf 'repository was not requested as private\n' >&2; exit 3; }
  git init --bare -q "$FAKE_REMOTE"
  git -C "$source_dir" remote add origin "$FAKE_REMOTE"
  git -C "$source_dir" push -q -u origin main
  printf 'https://github.com/test/%s\n' "$name"
elif [ "$1 $2" = "repo view" ]; then
  # Like the real tool: with no repository named it reads the remotes of the
  # current directory and fails outside a repository. The helper used to ask from
  # the account's home, and the 2026-09-05 server run stopped on exactly this.
  git remote get-url origin >/dev/null 2>&1 \
    || { printf 'failed to run git: fatal: not a git repository\n' >&2; exit 1; }
  printf 'true\thttps://github.com/test/hub\n'
else
  printf 'unexpected gh call: %s\n' "$*" >&2
  exit 2
fi
GH
chmod +x "$WORK/bin/gh"

export PATH="$WORK/bin:$PATH"
export FAKE_REMOTE="$WORK/remote.git"

# Called from a plain folder, never from inside a repository: the installer runs
# this helper from the assistant's home, and a test started inside the kit's own
# checkout would hand the fake GitHub tool a remote that the real run never has.
mkdir -p "$WORK/home"
cd "$WORK/home" || exit 1

output="$(bash "$CREATE_REPO_SCRIPT" "$WORK/godspeed" godspeed 2>&1)"
rc=$?

check "fresh godspeed repository setup exits successfully" test "$rc" -eq 0
check "fresh godspeed receives its first commit" bash -c 'git -C "$1" rev-parse -q --verify HEAD >/dev/null' _ "$WORK/godspeed"
check "fresh godspeed receives an origin" test "$(git -C "$WORK/godspeed" remote get-url origin)" = "$FAKE_REMOTE"
check "first commit reaches the remote" test "$(git --git-dir "$FAKE_REMOTE" rev-parse refs/heads/main)" = "$(git -C "$WORK/godspeed" rev-parse HEAD)"
check "result reports the private GitHub address" bash -c 'case "$1" in *"private GitHub repository: https://github.com/test/hub"*) exit 0;; *) exit 1;; esac' _ "$output"

mkdir -p "$WORK/godspeed2"
printf '# Recovered godspeed\n' > "$WORK/godspeed2/README.md"
git -C "$WORK/godspeed2" init -q -b main
git -C "$WORK/godspeed2" config user.name "Test User"
git -C "$WORK/godspeed2" config user.email "test@example.com"
git -C "$WORK/godspeed2" add README.md
git -C "$WORK/godspeed2" commit -q -m "Existing local commit"
git init --bare -q "$WORK/recovery-remote.git"
git -C "$WORK/godspeed2" remote add origin "$WORK/recovery-remote.git"
export FAKE_REMOTE="$WORK/recovery-remote.git"

recovery_output="$(bash "$CREATE_REPO_SCRIPT" "$WORK/godspeed2" ignored 2>&1)"
recovery_rc=$?

check "a retry with an origin but no remote branch succeeds" test "$recovery_rc" -eq 0
check "a retry pushes the missing branch" test "$(git --git-dir "$WORK/recovery-remote.git" rev-parse refs/heads/main)" = "$(git -C "$WORK/godspeed2" rev-parse HEAD)"
check "a retry still verifies privacy" bash -c 'case "$1" in *"private GitHub repository: https://github.com/test/hub"*) exit 0;; *) exit 1;; esac' _ "$recovery_output"

mkdir -p "$WORK/godspeed3"
printf '# Ubuntu default branch\n' > "$WORK/godspeed3/README.md"
git -C "$WORK/godspeed3" -c init.defaultBranch=master init -q
export FAKE_REMOTE="$WORK/master-remote.git"

master_output="$(bash "$CREATE_REPO_SCRIPT" "$WORK/godspeed3" godspeed 2>&1)"
master_rc=$?

check "a mission control started on master is pushed as main" test "$master_rc" -eq 0
check "the local branch is renamed to main before the first push" test "$(git -C "$WORK/godspeed3" branch --show-current)" = "main"
check "the remote receives main, not master" git --git-dir "$WORK/master-remote.git" show-ref --verify --quiet refs/heads/main

printf '\n%d passed, %d failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
