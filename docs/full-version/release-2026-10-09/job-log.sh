#!/usr/bin/env bash
# job-log.sh <repo> <run id> <job name substring> : saves and prints the path of that job's log
P=$(dirname "$0"); G="$P/gh-api.sh"
jid=$("$G" "https://api.github.com/repos/MichaelZelbel/$1/actions/runs/$2/jobs?per_page=50" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s).jobs.find(j=>j.name.includes(process.argv[1]));console.log(j?j.id:'')})" "$3")
mkdir -p "$P/logs"; out="$P/logs/$1-$2-$(echo "$3" | tr -c 'a-zA-Z0-9-' '_').log"
"$G" -L "https://api.github.com/repos/MichaelZelbel/$1/actions/jobs/$jid/logs" -o "$out"; echo "$out"
