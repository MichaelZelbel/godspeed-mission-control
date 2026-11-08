#!/usr/bin/env bash

retain_new_charm_log() { # <source log> <line count before acting> <retained evidence file>
  local source=$1 before=$2 evidence=$3
  local symptom="the installed panel Charm judgement did not write evidence to $source"
  [ -f "$source" ] || fail "$symptom"
  tail -n "+$((before + 1))" "$source" >"$evidence" || fail "$symptom"
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
