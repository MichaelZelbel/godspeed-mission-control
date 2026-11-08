#!/usr/bin/env bash

retain_new_charm_log() { # <source log> <line count before acting> <retained evidence file>
  local source=$1 before=$2 evidence=$3
  local symptom="the installed panel Charm judgement did not write evidence to $source"
  [ -f "$source" ] || fail "$symptom"
  tail -n "+$((before + 1))" "$source" >"$evidence" || fail "$symptom"
  [ -s "$evidence" ] || fail "$symptom"
}
