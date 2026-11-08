#!/usr/bin/env bash

charm_log_cursor() { # <source log>
  [ -f "$1" ] || return 0
  stat -c '%i:%s' "$1"
}

retain_new_charm_log() { # <source log> <cursor before acting> <retained evidence file>
  local source=$1 cursor=$2 evidence=$3 current before_inode before_size current_inode current_size
  local symptom="the installed panel Charm judgement did not write evidence to $source"
  [ -f "$source" ] || fail "$symptom"
  current=$(charm_log_cursor "$source") || fail "$symptom"
  before_inode=${cursor%%:*}
  before_size=${cursor#*:}
  current_inode=${current%%:*}
  current_size=${current#*:}
  if [ -n "$cursor" ] && [ "$before_inode" = "$current_inode" ] && [ "$current_size" -ge "$before_size" ]; then
    tail -c "+$((before_size + 1))" "$source" >"$evidence" || fail "$symptom"
  else
    cat "$source" >"$evidence" || fail "$symptom"
  fi
  [ -s "$evidence" ] || fail "$symptom"
  "${NODE:-node}" -e '
const fs=require("fs"),text=fs.readFileSync(process.argv[1],"utf8");
if(!text.endsWith("\n"))process.exit(1);
for(const line of text.slice(0,-1).split("\n")){
 let entry;try{entry=JSON.parse(line);}catch{process.exit(1);}
 if(!entry||typeof entry!=="object"||Array.isArray(entry))process.exit(1);
}
' "$evidence" || fail "the installed panel Charm judgement wrote invalid JSONL evidence to $source"
}
