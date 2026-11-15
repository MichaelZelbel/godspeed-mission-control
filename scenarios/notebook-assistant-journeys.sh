#!/usr/bin/env bash
# PROVING SCENARIO: Settings keeps a custom AI connection across a notebook restart, and Timeline
# saves moments without asking for AI enrichment until an AI is connected.
#
#   bash scenarios/notebook-assistant-journeys.sh <stage ref>
#   bash scenarios/notebook-assistant-journeys.sh --check <evidence folder>
#
# The browser driver keeps actions.json, provider-*.json, moments.json, fixture-requests.jsonl,
# browser-console.json, browser-network.json, restart.txt, cleanup.txt and screenshots/*.png.
SCENARIO=notebook-assistant-journeys
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"

notebook_answers() { curl -fsS "http://127.0.0.1:$NOTEBOOK_PORT/health" >/dev/null 2>&1; }

act() {
  fresh_evidence
  install_paths
  install_the_stage_line "$EVIDENCE/install.log"
  need_node
  wait_for 180 "the installed notebook to answer" notebook_answers ||
    fail "the installed notebook did not answer, so its Settings and Timeline could not be used"
  "$NODE" "$(dirname "$0")/notebook-assistant-browser.mjs" \
    --base "http://127.0.0.1:$NOTEBOOK_PORT" --evidence "$EVIDENCE" ||
    fail "the installed browser route did not finish; its retained browser evidence says where it stopped"
}

check() { # <evidence folder>
  local folder=$1 secret
  [ -d "$folder" ] || fail "there is nothing at $folder, so the installed browser route kept no evidence"
  if [ -e "$folder/failure.json" ]; then
    need_node
    "$NODE" - "$folder/failure.json" <<'NODE' || fail "the retained browser failure is malformed"
const fs=require('fs');
const value=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(!value||typeof value.phase!=='string'||typeof value.message!=='string'||!value.message.trim())throw Error('invalid failure');
if(/\n\s*at\s|\.mjs:\d+/.test(value.message))throw Error('failure contains a stack or source location');
NODE
    fail "the installed browser route stopped during $("$NODE" -p "require(process.argv[1]).phase || 'startup'" "$folder/failure.json")"
  fi
  for file in actions.json provider-navigation.json provider-reload.json provider-restart.json moments.json fixture-requests.jsonl browser-console.json browser-network.json restart.txt cleanup.txt; do
    kept "$folder" "$file" "the installed browser route's $file"
  done
  need_node
  "$NODE" - "$folder" <<'NODE' || fail "the retained installed-browser evidence is incomplete or contradicts the journeys it claims"
const fs=require('fs'),p=require('path'),root=process.argv[2],read=n=>JSON.parse(fs.readFileSync(p.join(root,n),'utf8'));
const actions=read('actions.json'),required=['provider-saved','provider-after-navigation','provider-after-reload','notebook-restarted','provider-after-restart','moment-saved-without-ai','moment-edited-without-ai','moment-saved-with-ai','moment-edited-with-ai'];
for(const name of required)if(!actions.some(a=>a.name===name&&a.ok===true))throw Error('missing successful visible action '+name);
for(const name of ['provider-navigation.json','provider-reload.json','provider-restart.json']){const x=read(name);if(x.service!=='Another service'||x.url!=='http://127.0.0.1:48763/v1'||x.model!=='fixture-model'||x.key!==true)throw Error(name+' did not retain the custom provider and its saved key');}
const moments=read('moments.json');for(const name of ['without-ai','with-ai']){const x=moments[name];if(!x||!x.saved||!x.edited)throw Error(name+' moment did not pass through both visible save paths');}
const requests=fs.readFileSync(p.join(root,'fixture-requests.jsonl'),'utf8').trim().split(/\n/).filter(Boolean).map(JSON.parse);
if(requests.some(x=>x.phase==='without-ai'&&x.operation==='extract-moment-profile'))throw Error('moment extraction was requested while no AI was connected');
for(const operation of ['save','edit'])if(!requests.some(x=>x.phase==='with-ai'&&x.operation==='extract-moment-profile'&&x.action===operation))throw Error('no AI-backed extraction request for '+operation);
const consoleRows=read('browser-console.json');if(consoleRows.some(x=>x.phase==='without-ai'&&/extract-moment-profile/i.test(String(x.text||''))))throw Error('the no-AI path reported an extraction error');
if(!/old_pid=\d+\s+new_pid=\d+\s+healthy=yes/.test(fs.readFileSync(p.join(root,'restart.txt'),'utf8')))throw Error('the notebook restart was not retained');
if(!/browser=stopped/.test(fs.readFileSync(p.join(root,'cleanup.txt'),'utf8'))||!/fixture=stopped/.test(fs.readFileSync(p.join(root,'cleanup.txt'),'utf8')))throw Error('owned processes were not stopped');
NODE
  secret=$(grep -RIl --exclude=install.log 'scenario-secret-never-retain' "$folder" 2>/dev/null | head -n 1 || true)
  [ -z "$secret" ] || fail "the submitted AI key leaked into retained evidence at $secret"
  pass "the installed Settings form retained Another service, its model and its saved key through navigation, reload and notebook restart; Timeline saved and edited a moment without an extraction request when no AI was connected, then requested enrichment for both save paths with AI; the owned browser and fixture stopped"
}

if [ "$CHECK_ONLY" = yes ]; then install_paths; check "$EVIDENCE"; else act; check "$EVIDENCE"; fi
