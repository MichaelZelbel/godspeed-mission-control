#!/usr/bin/env bash
# PROVING SCENARIO 3: a voice note, with the permission and without it.
#
# What it proves (godspeed-dev, releases/godspeed-2.0.0-beta.8-faster-chat/plan.md, scenario 3): on
# a fresh install, with a key ElevenLabs lets transcribe, the recording kept beside this script goes
# through the installed assistant's own transcription the way a voice note in a chat does, comes
# back as words from ElevenLabs Scribe, and is answered by the assistant's own text-to-speech
# command in eleven_v4_turbo, with the text beside the sound. With a key ElevenLabs refuses that
# permission, voice notes stay understood on the computer itself and Settings (GET /api/voice) names
# the missing permission once.
#
# The keys come from the job, which is also why the two halves run in this order: saving the refused
# key second is what takes ElevenLabs off understanding again, which is what a person replacing
# their key does.
#   ELEVENLABS_TEST_KEY_STT     a test key that may transcribe (without it: FAIL)
#   ELEVENLABS_TEST_KEY_NO_STT  a test key that may not (without it: FAIL)
#   ELEVENLABS_TEST_VOICE_ID    the voice to speak with, a public ElevenLabs voice by default
# No chat account of any kind: the voice note never goes near Telegram, it goes through the two
# halves of the assistant that a voice note in Telegram goes through.
#
#   bash scenarios/voice.sh candidate/2.0.0-beta.8
#   bash scenarios/voice.sh --check <folder>
#
# What it keeps for its checking part:
#   may-status.json / may-config.yaml          Settings and the assistant's settings, key that may
#   may-transcript.txt                         the words ElevenLabs understood
#   may-transcription-call.json                which of the assistant's functions did it, and with what
#   may-answer.ogg / may-answer-text.txt       the spoken answer and the same answer as text
#   may-spoken-command.txt                     the command the assistant speaks with, as it ran
#   maynot-status.json / maynot-config.yaml    Settings and the settings, key that may not
SCENARIO=voice
# shellcheck source=scenarios/scenario-lib.sh
. "$(dirname "$0")/scenario-lib.sh"
scenario_arguments "$@"

RECORDING=$HERE/voice-note.wav
# What is said in the recording. A transcript is never a copy, so the check asks for most of it.
VOICE_NOTE_WORDS="please answer this voice note with a short spoken reply"
VOICE_NOTE_NEEDS=4
ANSWER_TEXT='Yes. Here is your short spoken reply.'
VOICE_ID=${ELEVENLABS_TEST_VOICE_ID:-21m00Tcm4TlvDq8ikWAM}
SPEECH_PROVIDER=godspeed-elevenlabs

# shellcheck disable=SC2329  # asked by wait_for, which takes the command to try as its arguments
notebook_answers() { curl -fsS "http://127.0.0.1:$NOTEBOOK_PORT/health" >/dev/null 2>&1; }

# Settings, saving a voice and a key, over the notebook's own page address.
save_the_key() { # <key> <what to call it>
  local key=$1 what=$2 code body
  body=$EVIDENCE/$what-save.json
  code=$(curl -sS -o "$body" -w '%{http_code}' -X POST \
    -H 'Content-Type: application/json' \
    -d "{\"service\":\"elevenlabs\",\"key\":\"$key\",\"voice_id\":\"$VOICE_ID\"}" \
    "http://127.0.0.1:$NOTEBOOK_PORT/api/voice") ||
    fail "Settings could not be reached to save the $what key"
  [ "$code" = 200 ] ||
    fail "Settings refused the $what key with HTTP $code: $(tr -d '\n' <"$body" | cut -c1-200)"
  say "Settings kept the $what key (its sample came back)"
}
settings_voice() { # <file>
  curl -fsS "http://127.0.0.1:$NOTEBOOK_PORT/api/voice" -o "$1" ||
    fail "Settings' own voice page (GET /api/voice) could not be read"
}

# The assistant's own Python and source folder, found the way the product itself finds them.
assistant_python() {
  local version executable source_root
  version=$(cat "$RUNTIME/version") || fail "the install left no version file behind"
  executable=$(json_value "$STATE/assistant.json" executable) ||
    fail "this install's notebook has no assistant of its own, so a voice note has nothing to go through"
  source_root=$(json_value "$STATE/assistant.json" sourceRoot) || source_root=''
  "$NODE" -e '
const [module_,executable,sourceRoot,home]=process.argv.slice(1);
import(require("url").pathToFileURL(module_).href).then(m=>{
 const {python,source}=m.hermesPython({executable,sourceRoot:sourceRoot||undefined,home});
 process.stdout.write(JSON.stringify({python:python||"",source:source||sourceRoot||""}));
}).catch(error=>{console.error(error.message);process.exit(1);});
' "$RUNTIME/versions/$version/notebook/core/runtime.mjs" "$executable" "$source_root" "$HERMES"
}

# The spoken answer, made the way the assistant makes it: the command out of its own settings, with
# its own placeholders filled, run through a shell as the assistant runs it.
speak_the_answer() {
  local command voice model text=$EVIDENCE/may-answer-text.txt sound=$EVIDENCE/may-answer.ogg
  command=$(config_value "$HERMES/config.yaml" "tts.providers.$SPEECH_PROVIDER.command") ||
    fail "the assistant has no text-to-speech command of Godspeed's in its settings, so no voice note could be spoken"
  voice=$(config_value "$HERMES/config.yaml" "tts.providers.$SPEECH_PROVIDER.voice") || voice=''
  model=$(config_value "$HERMES/config.yaml" "tts.providers.$SPEECH_PROVIDER.model") || model=''
  printf '%s\n' "$ANSWER_TEXT" >"$text"
  command=${command//\{voice\}/$voice}
  command=${command//\{model\}/$model}
  command=${command//\{input_path\}/\'$text\'}
  command=${command//\{output_path\}/\'$sound\'}
  printf '%s\n' "$command" >"$EVIDENCE/may-spoken-command.txt"
  say "Speaking the answer the way the assistant does: $command"
  sh -c "$command" >&2 ||
    fail "the assistant's own text-to-speech command could not make the voice note (its words are in the step log)"
}

act() {
  [ -n "${ELEVENLABS_TEST_KEY_STT:-}" ] ||
    fail "ELEVENLABS_TEST_KEY_STT is not in this job's environment, so a voice note cannot be understood by ElevenLabs here and this scenario cannot run"
  [ -n "${ELEVENLABS_TEST_KEY_NO_STT:-}" ] ||
    fail "ELEVENLABS_TEST_KEY_NO_STT is not in this job's environment, so the half without the permission cannot run"
  [ -s "$RECORDING" ] || fail "the recording kept with this script is not there ($RECORDING)"
  fresh_evidence
  install_paths
  install_the_stage_line "$EVIDENCE/install-trace.log"
  need_node
  wait_for 120 "the notebook to answer" notebook_answers ||
    fail "the notebook does not answer on this install, so Settings could not be used at all"

  say "The key that may transcribe, saved in Settings the way a person saves it"
  save_the_key "$ELEVENLABS_TEST_KEY_STT" may
  settings_voice "$EVIDENCE/may-status.json"
  cp "$HERMES/config.yaml" "$EVIDENCE/may-config.yaml"

  local found python source extra=()
  found=$(assistant_python) || fail "the assistant's own Python could not be found on this install"
  python=$(printf '%s' "$found" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).python))')
  source=$(printf '%s' "$found" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).source))')
  [ -n "$python" ] && [ -f "$python" ] ||
    fail "the assistant's own Python is not on this machine, so its own transcription could not be used"
  [ -z "$source" ] || extra=(--source "$source")
  say "The voice note through the assistant's own transcription: $python"
  "$python" "$HERE/voice-through-hermes.py" --home "$HERMES" --audio "$RECORDING" "${extra[@]}" \
    --transcript "$EVIDENCE/may-transcript.txt" --call "$EVIDENCE/may-transcription-call.json" ||
    fail "the voice note did not come back from the assistant's own transcription (its one sentence is in the step log)"
  speak_the_answer

  say "The key that may not transcribe, saved the way a person replaces their key"
  save_the_key "$ELEVENLABS_TEST_KEY_NO_STT" maynot
  settings_voice "$EVIDENCE/maynot-status.json"
  cp "$HERMES/config.yaml" "$EVIDENCE/maynot-config.yaml"
}

check() { # <evidence folder>
  local folder=$1 word found=0
  [ -d "$folder" ] || fail "there is nothing at $folder, so this scenario kept no evidence of a voice note"
  need_node
  for file in may-status.json may-config.yaml may-transcript.txt may-transcription-call.json \
    may-answer.ogg may-answer-text.txt may-spoken-command.txt maynot-status.json maynot-config.yaml; do
    kept "$folder" "$file" "what Settings said and what the voice note came back as"
  done

  # WITH THE PERMISSION: ElevenLabs understands the voice note, and says so on the page.
  want_json "$folder/may-status.json" transcribe.service elevenlabs "Settings' voice page with the key that may transcribe"
  want_json "$folder/may-status.json" transcribe.model scribe_v2 "Settings' voice page with the key that may transcribe"
  want_json "$folder/may-status.json" key true "Settings' voice page with the key that may transcribe"
  want_config "$folder/may-config.yaml" stt.provider elevenlabs "the assistant's settings with the key that may transcribe"
  want_config "$folder/may-config.yaml" stt.elevenlabs.model_id scribe_v2 "the assistant's settings with the key that may transcribe"
  want_json "$folder/may-transcription-call.json" provider elevenlabs "what the voice note was sent through"
  want_json "$folder/may-transcription-call.json" model scribe_v2 "what the voice note was sent through"
  grep -qi 'elevenlabs' "$folder/may-transcription-call.json" ||
    fail "the voice note did not go through the assistant's own ElevenLabs transcription: $(tr -d '\n' <"$folder/may-transcription-call.json" | cut -c1-160)"

  # The words that came back are the words in the recording.
  for word in $VOICE_NOTE_WORDS; do
    grep -qi -- "$word" "$folder/may-transcript.txt" && found=$((found + 1))
  done
  [ "$found" -ge "$VOICE_NOTE_NEEDS" ] ||
    fail "ElevenLabs understood $found of the recording's words, fewer than $VOICE_NOTE_NEEDS: $(head -1 "$folder/may-transcript.txt")"

  # The spoken answer, in eleven_v4_turbo, with the text beside it.
  want_config "$folder/may-config.yaml" "tts.providers.$SPEECH_PROVIDER.model" eleven_v4_turbo \
    "the assistant's settings with the key that may transcribe"
  grep -qF -- "--model eleven_v4_turbo" "$folder/may-spoken-command.txt" ||
    fail "the spoken answer was not asked for in eleven_v4_turbo: $(head -1 "$folder/may-spoken-command.txt")"
  local magic bytes
  magic=$(head -c 4 "$folder/may-answer.ogg")
  bytes=$(wc -c <"$folder/may-answer.ogg")
  [ "$magic" = OggS ] ||
    fail "what came back as the spoken answer is no Ogg recording (it begins '$magic')"
  [ "$bytes" -gt 1000 ] || fail "the spoken answer is only $bytes bytes, which is no voice note"
  [ -s "$folder/may-answer-text.txt" ] || fail "the answer came back as sound without the text"

  # WITHOUT THE PERMISSION: nothing of Godspeed's is left in the settings, and the page says once
  # which permission to add.
  want_no_config "$folder/maynot-config.yaml" stt.provider \
    "the assistant's settings with the key that may not transcribe" \
    "a key that may not transcribe would then have every voice note sent to ElevenLabs all the same"
  want_no_config "$folder/maynot-config.yaml" stt.elevenlabs.model_id \
    "the assistant's settings with the key that may not transcribe" \
    "the model for a transcription nobody is allowed to make has no business being there"
  want_json "$folder/maynot-status.json" transcribe.service local \
    "Settings' voice page with the key that may not transcribe"
  local said
  said=$(times_in "$folder/maynot-status.json" 'Speech to Text')
  [ "$said" = 1 ] ||
    fail "Settings names the missing Speech to Text permission $said times on the page, not once"

  pass "a key that may transcribe had the voice note understood by ElevenLabs Scribe (scribe_v2, $found of the recording's words came back) and answered with a $bytes-byte Ogg voice note in eleven_v4_turbo beside the text; a key that may not left transcription on the computer and named the missing permission once"
}

if [ "$CHECK_ONLY" = yes ]; then
  install_paths
  check "$EVIDENCE"
else
  act
  check "$EVIDENCE"
fi
