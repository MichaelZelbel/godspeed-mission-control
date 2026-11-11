#!/usr/bin/env bash
# Makes the GitHub runner's apt work before Playwright installs the browser's system packages
# (sourced by test.sh; issue #442: "Temporary failure resolving 'azure.archive.ubuntu.com'", four runs in a row).
# Acts only on a GitHub runner (GITHUB_ACTIONS=true) and only when apt cannot update; a user's machine is never touched.
ci_apt_prepare() {
  [ "${GITHUB_ACTIONS:-}" = "true" ] || return 0
  command -v apt-get >/dev/null 2>&1 || return 0
  if sudo apt-get update -o Acquire::Retries=5 -o Acquire::http::Timeout=20 >/dev/null 2>&1; then
    echo "apt: the runner's mirror works"; return 0
  fi
  echo "apt: the runner's mirror list failed to resolve; using archive.ubuntu.com for this run"
  local f
  for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.sources /etc/apt/sources.list.d/*.list; do
    [ -f "$f" ] || continue
    sudo sed -i -E \
      -e 's#(https?|mirror\+file):(//)?(azure\.archive\.ubuntu\.com|[a-z0-9.-]*\.archive\.ubuntu\.com)/ubuntu/?#http://archive.ubuntu.com/ubuntu/#g' \
      -e 's#mirror\+file:/etc/apt/apt-mirrors\.txt#http://archive.ubuntu.com/ubuntu/#g' \ "$f"
  done
  sudo apt-get update -o Acquire::Retries=5 -o Acquire::http::Timeout=20
}
