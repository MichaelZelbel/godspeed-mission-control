#!/usr/bin/env bash
# The gate for the four proving scenarios (scenarios/README.md).
#
# A scenario's acting part needs a throwaway machine, a stage to install and, for two of them, a key
# of its own; its CHECKING part needs nothing but files, and that is where its judgement lives. So
# every case here builds a folder standing in for what one scenario saw on a machine - one that
# should pass, and one per failure the scenario names - and asks the scenario itself what it makes
# of it, by the one line it prints and the code it leaves. What this proves is therefore what the
# scenarios do, and not what some machine happened to be like on the day.
#
# The last section holds them all to the same shape: bash reads them, a folder that is not there is
# one FAIL line, and no stage ref at all says how they are called instead of pretending to run.
#
# Run: bash scenarios/test-scenarios.sh   (from the root of a checkout)
set -u
# shellcheck source=tools/test-guard.bash
. "$(dirname "$0")/../tools/test-guard.bash"

HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/.." && pwd)
TMP=$(mktemp -d)
trap 'rm -rf "$TMP" "$TEST_GUARD_HOME"' EXIT

PASS=0
FAIL=0
ok() {
  PASS=$((PASS + 1))
  printf '  ok   %s\n' "$1"
}
bad() {
  FAIL=$((FAIL + 1))
  printf '  FAIL %s\n' "$1"
}
section() { printf '== %s\n' "$1"; }

# What a scenario's checking part answered: its one line and its exit code.
run() { # <scenario> <arguments...>
  local scenario=$1
  shift
  OUT=$(bash "$ROOT/scenarios/$scenario.sh" "$@" 2>/dev/null)
  CODE=$?
  LINES=$(printf '%s\n' "$OUT" | grep -c .)
}
answers() { # <case> <scenario> <folder> <PASS|FAIL> <code> <words it has to say>
  local case=$1 scenario=$2 folder=$3 word=$4 code=$5 words=$6
  run "$scenario" --check "$folder"
  if [ "$CODE" != "$code" ]; then
    bad "$case (exit $CODE, wanted $code: $OUT)"
    return
  fi
  if [ "$LINES" != 1 ]; then
    bad "$case (it said $LINES lines on its own output, and the verdict is one line)"
    return
  fi
  case $OUT in
    "$word $scenario: "*) ;;
    *)
      bad "$case (it did not begin '$word $scenario: ': $OUT)"
      return
      ;;
  esac
  case $OUT in
    *"$words"*) ok "$case" ;;
    *) bad "$case (its verdict never says [$words]: $OUT)" ;;
  esac
}
passes() { answers "$1" "$2" "$3" PASS 0 "$4"; }
refuses() { answers "$1" "$2" "$3" FAIL 1 "$4"; }

# A folder that should pass, so a case for one failure is that folder with one thing changed.
copy() { # <good folder> <new folder>
  rm -rf "$2"
  cp -r "$1" "$2"
}

# =============================================================== 1. settings-on-install
# A settings file as a wiring leaves it: Hermes' own keys, and the five of ticket 1.
settings_good() { # <folder>
  local folder=$1
  rm -rf "$folder"
  mkdir -p "$folder"
  cat >"$folder/config-after-install.yaml" <<'YAML'
_config_version: 44
memory:
  memory_enabled: false
streaming:
  enabled: true
compression:
  threshold_tokens: 100000
display:
  streaming: false
  interim_assistant_messages: true
  long_running_notifications: true
  platforms:
    telegram:
      streaming: true
      interim_assistant_messages: false
      long_running_notifications: false
cron:
  provider: godspeed_notebook
  script_timeout_seconds: 9000
YAML
  sed 's/threshold_tokens: 100000/threshold_tokens: 150000/' \
    "$folder/config-after-install.yaml" >"$folder/config-after-owner-change.yaml"
}

section settings-on-install
S=$TMP/settings
settings_good "$S/good"
passes "a fresh install with the five values, and the owner's 150000 after the line ran again" \
  settings-on-install "$S/good" "the owner's own 150000 was still there"

copy "$S/good" "$S/no-file"
rm "$S/no-file/config-after-install.yaml"
refuses "a run that kept no settings file at all" settings-on-install "$S/no-file" \
  "config-after-install.yaml is not in what the scenario kept"

copy "$S/good" "$S/not-streaming"
sed -i 's/^  enabled: true$/  enabled: false/' "$S/not-streaming/config-after-install.yaml"
refuses "an install that left streaming off" settings-on-install "$S/not-streaming" \
  "streaming.enabled is false"

copy "$S/good" "$S/no-threshold"
sed -i '/^compression:$/,+1d' "$S/no-threshold/config-after-install.yaml"
refuses "an install that wrote no summarising threshold" settings-on-install "$S/no-threshold" \
  "compression.threshold_tokens is not in"

copy "$S/good" "$S/talks-back"
sed -i 's/^      interim_assistant_messages: false$/      interim_assistant_messages: true/' \
  "$S/talks-back/config-after-install.yaml"
refuses "an install that left the \"let me check\" sentences on" settings-on-install "$S/talks-back" \
  "display.platforms.telegram.interim_assistant_messages is true"

copy "$S/good" "$S/overwritten"
sed -i 's/^  threshold_tokens: 150000$/  threshold_tokens: 100000/' \
  "$S/overwritten/config-after-owner-change.yaml"
refuses "a second run that overwrote the owner's own 150000" settings-on-install "$S/overwritten" \
  "compression.threshold_tokens is 100000"

copy "$S/good" "$S/lost-a-key"
sed -i 's/^      streaming: true$/      streaming: false/' \
  "$S/lost-a-key/config-after-owner-change.yaml"
refuses "a second run that switched Telegram's live draft off again" settings-on-install "$S/lost-a-key" \
  "display.platforms.telegram.streaming is false"

# ======================================================================= 2. night-tidy
night_good() { # <folder>
  local folder=$1
  rm -rf "$folder"
  mkdir -p "$folder"
  cat >"$folder/summarised-log" <<'LOG'
2026-10-27 01:30:01 UTC chat scenario-chat-1: last prompt 174000 tokens, last message 60 min ago, open leases 0
2026-10-27 01:32:52 UTC summarised in 171 s: status compressed, messages 320 -> 20, about 174000 -> 45000 tokens
LOG
  printf '0\n' >"$folder/summarised-exit"
  : >"$folder/summarised-said"
  printf '{"entry_json":"{\\"session_id\\":\\"scenario-chat-1\\"}","scope":"/home/runner/hermes/sessions","session_key":"agent:main:telegram:dm:4242"}\n' \
    >"$folder/routing-before.txt"
  cp "$folder/routing-before.txt" "$folder/routing-after.txt"
  printf '{"id":"scenario-other-2","model_config":"{}"}\n{"content":"a message of the second conversation","session_id":"scenario-other-2"}\n' \
    >"$folder/other-before.txt"
  cp "$folder/other-before.txt" "$folder/other-after.txt"
  printf 'messages=320 tokens=174000\n' >"$folder/chat-before.txt"
  printf 'messages=20 tokens=none\n' >"$folder/chat-after.txt"
  printf '2026-10-27 01:30:02 UTC chat scenario-chat-1: last prompt 174000 tokens, last message 5 min ago, open leases 0\n2026-10-27 01:30:02 UTC skip: in use (quiet for less than 30 min)\n' \
    >"$folder/in-use-log"
  printf '0\n' >"$folder/in-use-exit"
  printf "Resume opened 'a-conversation-of-somebody-else', not 'scenario-chat-1'; stopping.\n" \
    >"$folder/wrong-resume-log"
  printf '1\n' >"$folder/wrong-resume-exit"
  printf '[{"method":"session.resume","params":{"session_id":"scenario-chat-1"}}]' \
    >"$folder/wrong-resume-asked.json"
  printf 'messages=20 tokens=174000\n' >"$folder/wrong-resume-chat-before.txt"
  cp "$folder/wrong-resume-chat-before.txt" "$folder/wrong-resume-chat-after.txt"
}

section night-tidy
N=$TMP/night
night_good "$N/good"
passes "a summarised chat, a second conversation left alone, a chat in use skipped, a wrong resume stopped" \
  night-tidy "$N/good" "320 messages and about 174000 tokens to 20"

copy "$N/good" "$N/no-log"
rm "$N/no-log/summarised-log"
refuses "a run that kept no log of the summary" night-tidy "$N/no-log" \
  "summarised-log is not in what the scenario kept"

copy "$N/good" "$N/failed"
printf '1\n' >"$N/failed/summarised-exit"
refuses "a routine that ended in a failure" night-tidy "$N/failed" \
  "the routine ended 1 on the long chat"

copy "$N/good" "$N/said-something"
printf 'I have tidied up your chat.\n' >"$N/said-something/summarised-said"
refuses "a routine that said something to the person" night-tidy "$N/said-something" \
  "the routine said something to the person"

copy "$N/good" "$N/nothing-shorter"
sed -i 's/messages 320 -> 20/messages 320 -> 320/' "$N/nothing-shorter/summarised-log"
refuses "a summary that shortened nothing" night-tidy "$N/nothing-shorter" \
  "nothing was shortened"

copy "$N/good" "$N/routing-moved"
printf '{"entry_json":"{\\"session_id\\":\\"somewhere-else\\"}","scope":"/home/runner/hermes/sessions","session_key":"agent:main:telegram:dm:4242"}\n' \
  >"$N/routing-moved/routing-after.txt"
refuses "a run after which the chat is routed elsewhere" night-tidy "$N/routing-moved" \
  "the gateway's routing table is not the same"

copy "$N/good" "$N/other-touched"
printf '{"id":"scenario-other-2","model_config":"{}"}\n' >"$N/other-touched/other-after.txt"
refuses "a run that changed the second stored conversation" night-tidy "$N/other-touched" \
  "the second stored conversation is not byte-for-byte the same"

copy "$N/good" "$N/not-skipped"
printf '2026-10-27 01:30:02 UTC summarised in 90 s: status compressed, messages 20 -> 5, about 70000 -> 20000 tokens\n' \
  >"$N/not-skipped/in-use-log"
refuses "a chat five minutes old that was summarised anyway" night-tidy "$N/not-skipped" \
  "did not skip a chat whose last message is five minutes old"

copy "$N/good" "$N/compressed-anyway"
printf '[{"method":"session.resume","params":{"session_id":"scenario-chat-1"}},{"method":"session.compress","params":{"session_id":"live-1"}}]' \
  >"$N/compressed-anyway/wrong-resume-asked.json"
printf '0\n' >"$N/compressed-anyway/wrong-resume-exit"
refuses "a wrong resume that was followed by a summary" night-tidy "$N/compressed-anyway" \
  "a resume naming another conversation left the routine at exit 0"

# =========================================================================== 3. voice
voice_good() { # <folder>
  local folder=$1
  rm -rf "$folder"
  mkdir -p "$folder"
  cat >"$folder/may-status.json" <<'JSON'
{
  "available": true,
  "voice": {"service": "elevenlabs", "voice_id": "21m00Tcm4TlvDq8ikWAM", "model": "eleven_v4_turbo"},
  "key": true,
  "chats": {"voice_only": 1, "all": 0, "off": 0},
  "transcribe": {"service": "elevenlabs", "model": "scribe_v2", "words": null},
  "failing": null
}
JSON
  cat >"$folder/may-config.yaml" <<'YAML'
stt:
  provider: "elevenlabs"
  elevenlabs:
    model_id: "scribe_v2"
tts:
  provider: "godspeed-elevenlabs"
  providers:
    godspeed-elevenlabs:
      type: command
      command: "'/node' '/elevenlabs-voice.mjs' --voice {voice} --model {model} --stability 0.5 --similarity 0.75 --style 0 --keys '/hermes/.env' --state '/.godspeed' {input_path} {output_path}"
      voice: "21m00Tcm4TlvDq8ikWAM"
      model: "eleven_v4_turbo"
      format: ogg
YAML
  printf 'Please answer this voice note with a short spoken reply.\n' >"$folder/may-transcript.txt"
  cat >"$folder/may-transcription-call.json" <<'JSON'
{
  "function": "tools.transcription_cloud._transcribe_elevenlabs",
  "arguments": ["api_key", "audio_path", "model_id"],
  "model": "scribe_v2",
  "model_key": "stt.elevenlabs.model_id",
  "provider": "elevenlabs"
}
JSON
  {
    printf 'OggS'
    head -c 2000 /dev/zero | tr '\0' 'a'
  } >"$folder/may-answer.ogg"
  printf 'Yes. Here is your short spoken reply.\n' >"$folder/may-answer-text.txt"
  printf "'/node' '/elevenlabs-voice.mjs' --voice 21m00Tcm4TlvDq8ikWAM --model eleven_v4_turbo --stability 0.5 '/text' '/sound.ogg'\n" \
    >"$folder/may-spoken-command.txt"
  cat >"$folder/maynot-status.json" <<'JSON'
{
  "available": true,
  "voice": {"service": "elevenlabs", "voice_id": "21m00Tcm4TlvDq8ikWAM", "model": "eleven_v4_turbo"},
  "key": true,
  "transcribe": {"service": "local", "model": null, "words": "Your ElevenLabs key may not transcribe: allow it Speech to Text on the ElevenLabs page for API keys and save it again."},
  "failing": null
}
JSON
  cat >"$folder/maynot-config.yaml" <<'YAML'
tts:
  provider: "godspeed-elevenlabs"
  providers:
    godspeed-elevenlabs:
      model: "eleven_v4_turbo"
YAML
}

section voice
V=$TMP/voice
voice_good "$V/good"
passes "a key that may transcribe, a spoken answer in eleven_v4_turbo, and a key that may not" \
  voice "$V/good" "understood by ElevenLabs Scribe"

copy "$V/good" "$V/no-transcript"
rm "$V/no-transcript/may-transcript.txt"
refuses "a run that kept no transcript" voice "$V/no-transcript" \
  "may-transcript.txt is not in what the scenario kept"

copy "$V/good" "$V/stayed-local"
sed -i 's/"service": "elevenlabs", "model": "scribe_v2"/"service": "local", "model": null/' \
  "$V/stayed-local/may-status.json"
refuses "a key that may transcribe which was never used for it" voice "$V/stayed-local" \
  "transcribe.service is 'local'"

copy "$V/good" "$V/other-words"
printf 'Something else entirely.\n' >"$V/other-words/may-transcript.txt"
refuses "a transcript that is not the recording's words" voice "$V/other-words" \
  "of the recording's words, fewer than"

copy "$V/good" "$V/slow-model"
sed -i 's/--model eleven_v4_turbo/--model eleven_v3/' "$V/slow-model/may-spoken-command.txt"
refuses "a spoken answer asked for in the slower model" voice "$V/slow-model" \
  "not asked for in eleven_v4_turbo"

copy "$V/good" "$V/no-sound"
printf '<html>not a recording</html>' >"$V/no-sound/may-answer.ogg"
refuses "an answer that came back as something other than a recording" voice "$V/no-sound" \
  "is no Ogg recording"

copy "$V/good" "$V/left-behind"
cat >"$V/left-behind/maynot-config.yaml" <<'YAML'
stt:
  provider: "elevenlabs"
  elevenlabs:
    model_id: "scribe_v2"
YAML
refuses "a refused key that left ElevenLabs transcribing anyway" voice "$V/left-behind" \
  "stt.provider is still in"

copy "$V/good" "$V/said-twice"
sed -i 's/save it again."/save it again. Allow the key Speech to Text."/' "$V/said-twice/maynot-status.json"
refuses "a page that names the missing permission twice" voice "$V/said-twice" \
  "names the missing Speech to Text permission 2 times"

# ======================================================= 4. update-keeps-everything
NEW=1111111111111111111111111111111111111111
OLD=2222222222222222222222222222222222222222
ENGINE=3333333333333333333333333333333333333333

update_good() { # <folder>
  local folder=$1
  rm -rf "$folder"
  mkdir -p "$folder"
  printf '%s\n' "$OLD" >"$folder/version-before"
  printf '%s\n' "$NEW" >"$folder/version-after"
  printf '{\n  "version": "2.0.0-beta.8",\n  "productCommit": "%s",\n  "kitBootstrap": {\n    "unixEngineCommit": "%s"\n  }\n}\n' \
    "$NEW" "$ENGINE" >"$folder/stage.json"
  cp "$folder/stage.json" "$folder/kept-stage.json"
  printf '+ curl -fsSL https://raw.githubusercontent.com/x/kit-bootstrap/%s/setup-godspeed.sh\n+ KB_BRANCH=%s\n+ GODSPEED_STARTER_REF=%s\n' \
    "$ENGINE" "$ENGINE" "$NEW" >"$folder/trace-1.log"
  cp "$folder/trace-1.log" "$folder/trace-2.log"
  printf '["notes","scenario-four"]\n["settings","installation"]\n' >"$folder/records-before.txt"
  printf '["goals","the-first-goal"]\n["notes","scenario-four"]\n["settings","installation"]\n' \
    >"$folder/records-after.txt"
  printf '{"records":[{"type":"notes","id":"scenario-four","content":"A note the owner wrote before the update"}]}\n' \
    >"$folder/export-after.json"
  printf '150000\n' >"$folder/owner-setting-before.txt"
  printf '150000\n' >"$folder/owner-setting-after.txt"
  printf '{"id":"scenario-chat-1"}\n{"content":"a message of the chat history","session_id":"scenario-chat-1"}\n' \
    >"$folder/chat-before.txt"
  cp "$folder/chat-before.txt" "$folder/chat-after.txt"
  printf 'Goal research\nThe day ahead\nNight chat tidy-up\n' >"$folder/routines-after.txt"
  printf '200\n' >"$folder/health.txt"
}

section update-keeps-everything
U=$TMP/update
update_good "$U/good"
passes "an update onto the stage's commits that kept the records, the setting, the chat and one routine" \
  update-keeps-everything "$U/good" "is there exactly once"

copy "$U/good" "$U/no-version"
rm "$U/no-version/version-after"
refuses "a run that kept no version after the update" update-keeps-everything "$U/no-version" \
  "version-after is not in what the scenario kept"

copy "$U/good" "$U/old-version"
printf '%s\n' "$OLD" >"$U/old-version/version-after"
refuses "a machine still on the version it started from" update-keeps-everything "$U/old-version" \
  "after the update, and the stage names"

copy "$U/good" "$U/wrong-engine"
sed -i 's/KB_BRANCH=3333333333333333333333333333333333333333/KB_BRANCH=4444444444444444444444444444444444444444/' \
  "$U/wrong-engine/trace-2.log"
refuses "an update that ran another kit-bootstrap than the stage's" update-keeps-everything "$U/wrong-engine" \
  "did not run kit-bootstrap"

copy "$U/good" "$U/record-gone"
printf '["settings","installation"]\n' >"$U/record-gone/records-after.txt"
refuses "an update that lost a notebook record" update-keeps-everything "$U/record-gone" \
  "notebook records of the owner's are gone"

copy "$U/good" "$U/setting-gone"
printf '100000\n' >"$U/setting-gone/owner-setting-after.txt"
refuses "an update that overwrote the owner's own setting" update-keeps-everything "$U/setting-gone" \
  "the owner's own setting is 100000 after the update"

copy "$U/good" "$U/chat-gone"
printf '{"id":"scenario-chat-1"}\n' >"$U/chat-gone/chat-after.txt"
refuses "an update that lost the chat history" update-keeps-everything "$U/chat-gone" \
  "the chat history is not the same"

copy "$U/good" "$U/twice"
printf 'Goal research\nNight chat tidy-up\nNight chat tidy-up\n' >"$U/twice/routines-after.txt"
refuses "an update that left the night routine there twice" update-keeps-everything "$U/twice" \
  "2 times after the update, not once"

copy "$U/good" "$U/silent"
printf '000\n' >"$U/silent/health.txt"
refuses "a notebook that does not answer after the update" update-keeps-everything "$U/silent" \
  "answered 000 on its own address"

# ================================================================== the assistant's own home
# Where the acting parts look for the assistant's settings and chat store: the home the install
# recorded in .godspeed/assistant.json (scenario-lib.sh, assistant_home), never a folder named by
# hand. Until 27 October 2026 they named .godspeed/integrated-runtime/hermes, which only an install
# beside another assistant makes, and all four failed on a stranger's machine.
section "the assistant's home"
H=$TMP/home
home_of() { # <state folder>: what assistant_home makes of it, its last line and its code
  OUT=$(SCENARIO=home STATE=$1 NODE=$(command -v node) bash -c '. "$0" && assistant_home && printf "%s\n" "$HERMES"' \
    "$ROOT/scenarios/scenario-lib.sh" 2>/dev/null)
  CODE=$?
  OUT=$(printf '%s\n' "$OUT" | tail -n 1)
}
mkdir -p "$H/recorded/state" "$H/recorded/.hermes"
printf '{"verified":true,"executable":"/usr/local/bin/hermes","home":"%s"}\n' "$H/recorded/.hermes" \
  >"$H/recorded/state/assistant.json"
home_of "$H/recorded/state"
if [ "$CODE" = 0 ] && [ "$OUT" = "$H/recorded/.hermes" ]; then
  ok "the assistant's home is the one the install recorded"
else
  bad "the assistant's home is not the one the install recorded (exit $CODE: $OUT)"
fi
mkdir -p "$H/none/state"
home_of "$H/none/state"
case "$CODE $OUT" in
  "1 FAIL home: the install recorded no home for its assistant"*) ok "an install that recorded no home is one FAIL line" ;;
  *) bad "an install that recorded no home was not one FAIL line (exit $CODE: $OUT)" ;;
esac
mkdir -p "$H/gone/state"
printf '{"verified":true,"home":"%s"}\n' "$H/gone/.hermes" >"$H/gone/state/assistant.json"
home_of "$H/gone/state"
case "$CODE $OUT" in
  "1 FAIL home: "*"there is no such folder") ok "a recorded home that is not there is one FAIL line" ;;
  *) bad "a recorded home that is not there was not one FAIL line (exit $CODE: $OUT)" ;;
esac

# ======================================================================= the assistant's chat store
# night-tidy-chat.mjs seeds a chat beside the conversation the assistant kept first, with that
# conversation's rows as its template. This store has the two parts of the assistant's own shape that
# made that fail on 27 October 2026: a title no two conversations may share, and messages that may
# not lose their conversation (node:sqlite keeps foreign keys on).
section "the assistant's chat store"
C=$TMP/chat
mkdir -p "$C/home"
sql() { # <sql>: one value out of the store
  node --input-type=module -e '
import {DatabaseSync} from "node:sqlite";
const db=new DatabaseSync(process.argv[1]);
const [statement,...more]=process.argv[2].split(";").map(s=>s.trim()).filter(Boolean).reverse();
for(const s of more.reverse())db.exec(s);
const row=db.prepare(statement).get();process.stdout.write(row?String(Object.values(row)[0]):"");
' "$C/home/state.db" "$1" 2>/dev/null
}
sql "create table sessions(id text primary key, source text not null, title text, model_config text,
  parent_session_id text references sessions(id), started_at real not null);
create unique index idx_sessions_title_unique on sessions(title) where title is not null;
create table messages(id integer primary key autoincrement, session_id text not null references sessions(id),
  role text not null, content text, timestamp real not null);
insert into sessions(id, source, title, started_at) values ('first', 'cli', 'Hello', 1761559800);
insert into messages(session_id, role, content, timestamp) values ('first', 'user', 'Reply with the single word Hello.', 1761559800);
select count(*) from sessions" >/dev/null
if node "$ROOT/scenarios/night-tidy-chat.mjs" --home "$C/home" seed >/dev/null 2>&1; then
  ok "a chat is seeded beside a titled conversation of the assistant's own"
else
  bad "a chat could not be seeded beside a titled conversation of the assistant's own"
fi
counted=$(node "$ROOT/scenarios/night-tidy-chat.mjs" --home "$C/home" count --session scenario-chat-1 2>/dev/null)
if [ "$counted" = "messages=40 tokens=174000" ]; then
  ok "the seeded chat holds its 40 messages and its size"
else
  bad "the seeded chat holds $counted, not messages=40 tokens=174000"
fi
if [ "$(sql "select count(*) from sessions where id = 'first' and title = 'Hello'")" = 1 ]; then
  ok "the assistant's own conversation is still there, with its title"
else
  bad "the assistant's own conversation is gone or lost its title after the seed"
fi

# ============================================================ every one of them, the same shape
section 'every script'
for file in scenario-lib.sh settings-on-install.sh night-tidy.sh voice.sh update-keeps-everything.sh \
  test-scenarios.sh; do
  if bash -n "$ROOT/scenarios/$file" 2>/dev/null; then
    ok "bash reads scenarios/$file"
  else
    bad "bash cannot read scenarios/$file"
  fi
done
for scenario in settings-on-install night-tidy voice update-keeps-everything; do
  refuses "$scenario on a folder that is not there" "$scenario" "$TMP/no-such-folder" \
    "there is nothing at"
  run "$scenario"
  if [ "$CODE" = 2 ]; then
    ok "$scenario with no stage ref says how it is called (exit 2)"
  else
    bad "$scenario with no stage ref left exit $CODE, not 2"
  fi
  OUT=$(bash "$ROOT/scenarios/$scenario.sh" 2>&1 >/dev/null)
  case $OUT in
    *usage*) ok "$scenario prints its usage on the error stream" ;;
    *) bad "$scenario printed no usage ($OUT)" ;;
  esac
done

printf '\n%s of %s pass.\n' "$PASS" "$((PASS + FAIL))"
[ "$FAIL" -eq 0 ]
