#!/usr/bin/env bash
# watch-runs.sh <repo> <run id> ... : prints each job's result once, exits when every run has completed.
P=$(dirname "$0"); G="$P/gh-api.sh"; seen=""
while true; do
  all_done=1
  for spec in "$@"; do
    repo=${spec%%:*}; id=${spec##*:}
    run=$("$G" "https://api.github.com/repos/MichaelZelbel/$repo/actions/runs/$id" 2>/dev/null)
    st=$(printf '%s' "$run" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const r=JSON.parse(s);console.log(r.status+' '+r.conclusion)}catch{console.log('unknown')}})")
    case "$st" in completed*) ;; *) all_done=0;; esac
    jobs=$("$G" "https://api.github.com/repos/MichaelZelbel/$repo/actions/runs/$id/jobs?per_page=50" 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{for(const j of JSON.parse(s).jobs)if(j.status==='completed')console.log(j.id+'|'+j.name+'|'+j.conclusion)}catch{}})")
    while IFS='|' read -r jid name concl; do
      [ -n "$jid" ] || continue
      case " $seen " in *" $jid "*) continue;; esac
      seen="$seen $jid"; echo "$repo run $id: job '$name' $concl"
    done <<< "$jobs"
    case "$st" in completed*) case " $seen " in *" run$id "*) ;; *) seen="$seen run$id"; echo "$repo run $id: $st";; esac;; esac
  done
  [ $all_done = 1 ] && break
  sleep 60
done
