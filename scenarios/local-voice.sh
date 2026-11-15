#!/usr/bin/env bash
SCENARIO=local-voice
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"
notebook_answers() { curl -fsS "http://127.0.0.1:$NOTEBOOK_PORT/health" >/dev/null 2>&1; }
act() {
 fresh_evidence; install_paths; mkdir -p "$EVIDENCE/model-cache"; export HF_HOME="$EVIDENCE/model-cache"
 install_the_stage_line "$EVIDENCE/install-trace.log"; need_node; assistant_home
 base64 -d "$HERE/german-voice-note.mp3.b64" >"$EVIDENCE/german.mp3"
 wait_for 120 "the installed notebook to answer" notebook_answers || fail "the installed notebook did not answer"
 local code response=$EVIDENCE/response.json
 code=$(curl -sS -o "$response" -w '%{http_code}' -X POST \
   -H 'Content-Type: audio/mp4' --data-binary @"$EVIDENCE/german.mp3" \
   "http://127.0.0.1:$NOTEBOOK_PORT/api/chat/transcribe") || fail "the installed notebook's dictation endpoint could not be reached"
 [ "$code" = 200 ] || fail "the installed notebook could not transcribe the recording (HTTP $code: $(tr -d '\n' <"$response" | cut -c1-200))"
 "$NODE" -e 'const fs=require("fs"),[input,transcript,call]=process.argv.slice(1),answer=JSON.parse(fs.readFileSync(input,"utf8"));if(!String(answer.text||"").trim())throw Error("the dictation endpoint returned no words");fs.writeFileSync(transcript,String(answer.text).trim()+"\n");fs.writeFileSync(call,JSON.stringify({endpoint:"/api/chat/transcribe",implementation:"notebook/assistant-files/dictate.py",status:200})+"\n")' "$response" "$EVIDENCE/transcript.txt" "$EVIDENCE/call.json" || fail "the installed notebook's dictation response was not usable"
 cp "$HERMES/config.yaml" "$EVIDENCE/config.yaml"
}
check() {
 local folder=$1; [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of a voice note"
 kept "$folder" transcript.txt "the returned words"; kept "$folder" call.json "the Hermes entry point"; kept "$folder" config.yaml "the fresh language setting"
 grep -Eqi 'guten|morgen|sonne|berlin' "$folder/transcript.txt" || fail "the recording did not come back as German words: $(head -1 "$folder/transcript.txt")"
 want_json "$folder/call.json" endpoint /api/chat/transcribe "the installed Notebook dictation call"
 want_json "$folder/call.json" implementation notebook/assistant-files/dictate.py "the installed Notebook dictation call"
 want_config "$folder/config.yaml" stt.language '' "the fresh assistant's settings"
 pass "a fresh no-key native install returned German words through the Notebook's local dictation path with automatic language detection"
}
if [ "$CHECK_ONLY" = yes ]; then install_paths; check "$EVIDENCE"; else act; check "$EVIDENCE"; fi
