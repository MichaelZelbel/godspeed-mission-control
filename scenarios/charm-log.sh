#!/usr/bin/env bash

charm_log_cursor() { # <source log>
  [ -f "$1" ] || return 0
  stat -c '%s' "$1"
}

retain_new_charm_log() { # <source log> <cursor before acting> <retained evidence file>
  local source=$1 cursor=$2 evidence=$3
  local symptom="the installed panel Charm judgement did not write evidence to $source"
  [ -f "$source" ] || fail "$symptom"
  charm_log_cursor "$source" >/dev/null || fail "$symptom"
  if [ -n "$cursor" ]; then
    tail -c "+$((cursor + 1))" "$source" >"$evidence" || fail "$symptom"
  else
    cat "$source" >"$evidence" || fail "$symptom"
  fi
  [ -s "$evidence" ] || fail "$symptom"
}
