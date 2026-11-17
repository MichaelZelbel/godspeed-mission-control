#!/usr/bin/env bash
# An established native workspace proves both halves of #279 with local stand-ins: structural work
# checks remain necessary but content review decides verification, and an old approval list cannot
# enter a briefing whose current decision has two live waiting steps.
SCENARIO=established-daily-trust
. "$(dirname "${BASH_SOURCE[0]}")/scenario-lib.sh"
scenario_arguments "$@"

post_query() { # <table> <values>
  curl -fsS --max-time 120 -X POST -H 'Content-Type: application/json' \
    -d "{\"table\":\"$1\",\"operation\":\"insert\",\"values\":$2}" \
    "http://127.0.0.1:$NOTEBOOK_PORT/api/query" >/dev/null || fail "the installed notebook would not save $1"
}
status_of() { sed -n 's/^STATUS: //p' "$ROOT/work/$1.md"; }

act() {
  local bin installed work_js fixture_pid port today incomplete complete
  fresh_evidence; install_paths; need_node
  install_the_stage_line "$EVIDENCE/install.log"
  assistant_home 'the established-workspace scenario'
  installed=$(dirname "$(command -v mc-work-run)")
  bin=$EVIDENCE/bin; mkdir -p "$bin"
  cp "$installed/mc-work-run" "$installed/work.js" "$installed/run-log-folders.js" "$installed/mc-cards.js" "$bin/" ||
    fail "the installed work programs could not be copied for the local stand-in run"
  [ ! -f "$installed/unattended-git.cjs" ] || cp "$installed/unattended-git.cjs" "$bin/"
  work_js=$bin/work.js
  [ -f "$work_js" ] || fail "the installed work register is not beside mc-work-run"
  trap '[ -z "${fixture_pid:-}" ] || kill "$fixture_pid" 2>/dev/null || true' EXIT
  cat >"$bin/mc-run" <<'STANDIN'
#!/usr/bin/env bash
out= prompt= skill=
while [ $# -gt 0 ]; do case "$1" in --out) out=$2;shift 2;;--prompt-file) prompt=$2;shift 2;;--godspeed|--cwd|--prompt|--timeout|--allowed-tools) shift 2;;*) [ -z "$skill" ]&&skill=$1;shift;;esac;done
mkdir -p "$(dirname "$out")"
if [ "$skill" = work-result-review ]; then
  file=$(sed -n 's/^RESULT FILE: //p' "$prompt"|head -1)
  if grep -q 'third candidate: Cedar' "$file"; then printf '%s\n' '{"passed":true,"reason":"all three named candidates are present","missing":[]}' >"$out"
  else printf '%s\n' '{"passed":false,"reason":"the third candidate is absent","missing":["third candidate: Cedar"]}' >"$out"; fi
  exit 0
fi
file=$(grep -m1 '^DONE WHEN:' "$prompt"|grep -oE '[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\.md'|head -1)
mkdir -p "$(dirname "$file")"
printf '# Candidates\n\n- Atlas\n- River\n' >"$file"
case "$file" in *complete*) printf '%s\n' '- third candidate: Cedar' >>"$file";; esac
printf 'RESULT: wrote %s\n' "$file" >"$out"
STANDIN
  chmod +x "$bin/mc-run"
  today=$(date -u +%Y-%m-%d)
  incomplete=W-${today//-/}-91; complete=W-${today//-/}-92
  GODSPEED_ROOT=$ROOT "$NODE" "$work_js" file --id "$incomplete" --key established-incomplete --what 'Write the candidate note' \
    --done-when 'work/established-incomplete.md names Atlas, River, and the third candidate: Cedar' --check 'test -s work/established-incomplete.md' --source scenario >/dev/null
  GODSPEED_ROOT=$ROOT "$NODE" "$work_js" file --id "$complete" --key established-complete --what 'Write the complete candidate note' \
    --done-when 'work/established-complete.md names Atlas, River, and the third candidate: Cedar' --check 'test -s work/established-complete.md' --source scenario >/dev/null
  GODSPEED_ROOT=$ROOT GODSPEED_TODAY=$today bash "$bin/mc-work-run" --godspeed "$ROOT" --only "$incomplete" >"$EVIDENCE/incomplete-run.txt" 2>&1 || fail 'the incomplete installed work run stopped'
  GODSPEED_ROOT=$ROOT GODSPEED_TODAY=$today bash "$bin/mc-work-run" --godspeed "$ROOT" --only "$complete" >"$EVIDENCE/complete-run.txt" 2>&1 || fail 'the complete installed work run stopped'
  status_of "$incomplete" >"$EVIDENCE/incomplete-status.txt"; status_of "$complete" >"$EVIDENCE/complete-status.txt"
  cp "$ROOT/work/$incomplete.md" "$EVIDENCE/incomplete-card.txt"
  port=$(python3 -c 'import socket;s=socket.socket();s.bind(("127.0.0.1",0));print(s.getsockname()[1]);s.close()')
  "$NODE" "$HERE/brief-ai-fixture.mjs" "$port" >"$EVIDENCE/stand-in-ai.log" 2>&1 & fixture_pid=$!
  wait_for 30 'the local stand-in AI' curl -fsS "http://127.0.0.1:$port" >/dev/null 2>&1 || true
  printf '{"url":"http://127.0.0.1:%s/v1/chat/completions","key":"stand-in","model":"stand-in","routines":true}' "$port" >"$EVIDENCE/provider.json"
  curl -fsS --max-time 120 -X POST -H 'Content-Type: application/json' --data-binary @"$EVIDENCE/provider.json" "http://127.0.0.1:$NOTEBOOK_PORT/api/provider" >/dev/null || fail 'the local briefing stand-in could not be connected'
  post_query decisions '{"title":"Old seven-item approval list","state":"selected","created_at":"2020-01-01T08:00:00Z","proposals":["Old one","Old two","Old three","Old four","Old five","Old six","Old seven"]}'
  post_query decisions "{\"title\":\"Choose Atlas proposal and River proposal\",\"state\":\"selected\",\"created_at\":\"${today}T07:00:00Z\",\"proposals\":[\"Atlas proposal\",\"River proposal\"]}"
  post_query approvals "{\"title\":\"Atlas proposal\",\"status\":\"pending\",\"asked_at\":\"${today}T07:10:00Z\"}"
  post_query approvals "{\"title\":\"River proposal\",\"status\":\"pending\",\"asked_at\":\"${today}T07:20:00Z\"}"
  run_the_morning_brief "$EVIDENCE/brief-run.json" 600 300
  curl -fsS -X POST -H 'Content-Type: application/json' -d '{"table":"notes"}' "http://127.0.0.1:$NOTEBOOK_PORT/api/query" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{let r=JSON.parse(s);r=(Array.isArray(r)?r:r.data||[]).filter(x=>x.source_app==="morning-brief");process.stdout.write(String(r.at(-1)?.content||""))})' >"$EVIDENCE/brief-note.txt"
  kill "$fixture_pid" 2>/dev/null || true; wait "$fixture_pid" 2>/dev/null || true; fixture_pid=
  find "$EVIDENCE/bin" -type f -delete; rmdir "$EVIDENCE/bin"
}

check() {
  local f=$1
  [ -d "$f" ] || fail "there is nothing at $f, so this scenario kept no established-workspace evidence"
  kept_all "$f" 'the two installed work results and saved briefing' incomplete-run.txt complete-run.txt incomplete-status.txt complete-status.txt incomplete-card.txt brief-run.json brief-note.txt
  grep -qx attempted "$f/incomplete-status.txt" || fail 'the structurally passing incomplete result was called verified'
  grep -q 'third candidate: Cedar' "$f/incomplete-card.txt" || fail 'the incomplete card does not name its missing content'
  grep -qx verified "$f/complete-status.txt" || fail 'the content-complete result was not verified'
  grep -q 'Atlas proposal' "$f/brief-note.txt" && grep -q 'River proposal' "$f/brief-note.txt" || fail 'the saved brief does not name both live proposals'
  grep -Eqi 'Old one|Old two|Old three|Old four|Old five|Old six|Old seven' "$f/brief-note.txt" && fail 'the saved brief repeated the historical approval list'
  pass 'an established install rejected the incomplete result, verified the matching result, and briefed only the two live proposals'
}

if [ "$CHECK_ONLY" = yes ]; then install_paths; need_node; check "$EVIDENCE"; else act; check "$EVIDENCE"; fi
