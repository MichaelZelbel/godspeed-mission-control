#!/usr/bin/env bash
# Read-only GitHub API helper; takes the token from git's credential store, never prints it.
tok=$(printf 'protocol=https\nhost=github.com\n\n' | git credential fill 2>/dev/null | sed -n 's/^password=//p')
curl -sS -H "Authorization: Bearer $tok" -H "Accept: application/vnd.github+json" "$@"
