#!/usr/bin/env bash
SCENARIO=local-voice
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"
assistant_python() {
 local executable source_root version
 version=$(cat "$RUNTIME/version"); executable=$(json_value "$STATE/assistant.json" executable); source_root=$(json_value "$STATE/assistant.json" sourceRoot) || source_root=''
 "$NODE" -e 'const [m,e,s,h]=process.argv.slice(1);import(require("url").pathToFileURL(m).href).then(x=>{const r=x.hermesPython({executable:e,sourceRoot:s||undefined,home:h});process.stdout.write(JSON.stringify({python:r.python||"",source:r.source||s||""}))})' "$RUNTIME/versions/$version/notebook/core/runtime.mjs" "$executable" "$source_root" "$HERMES"
}
act() {
 fresh_evidence; install_paths; install_the_stage_line "$EVIDENCE/install-trace.log"; need_node; assistant_home
 base64 -d "$HERE/german-voice-note.mp3.b64" >"$EVIDENCE/german.mp3"
 local found python source extra=(); found=$(assistant_python) || fail "the installed assistant's Python could not be found"
 python=$(printf %s "$found"|"$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).python))'); source=$(printf %s "$found"|"$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).source))'); [ -z "$source" ] || extra=(--source "$source")
 mkdir -p "$EVIDENCE/model-cache"; HF_HOME="$EVIDENCE/model-cache" "$python" "$HERE/local-voice-through-hermes.py" --audio "$EVIDENCE/german.mp3" --transcript "$EVIDENCE/transcript.txt" --call "$EVIDENCE/call.json" "${extra[@]}"; cp "$HERMES/config.yaml" "$EVIDENCE/config.yaml"
}
check() {
 local folder=$1; [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of a voice note"
 kept "$folder" transcript.txt "the returned words"; kept "$folder" call.json "the Hermes entry point"; kept "$folder" config.yaml "the fresh language setting"
 grep -Eqi 'guten|morgen|sonne|berlin' "$folder/transcript.txt" || fail "the recording did not come back as German words: $(head -1 "$folder/transcript.txt")"
 grep -q 'tools.transcription_local' "$folder/call.json" || fail "the recording did not use Hermes local transcription"
 want_config "$folder/config.yaml" stt.language '' "the fresh assistant's settings"
 pass "a fresh no-key native install returned German words through Hermes local transcription with automatic language detection"
}
if [ "$CHECK_ONLY" = yes ]; then install_paths; check "$EVIDENCE"; else act; check "$EVIDENCE"; fi
