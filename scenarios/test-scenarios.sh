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
  printf 'Goal research\nThe day ahead\n' >"$folder/routines-after.txt"
  printf '200\n' >"$folder/health.txt"
}

section update-keeps-everything
U=$TMP/update
update_good "$U/good"
passes "an update onto the stage's commits that kept the records, the setting and the chat, and made no night routine" \
  update-keeps-everything "$U/good" "there is no \"Night chat tidy-up\""

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

copy "$U/good" "$U/made-it"
printf 'Goal research\nNight chat tidy-up\n' >"$U/made-it/routines-after.txt"
refuses "an update that made the night routine this release leaves out" update-keeps-everything "$U/made-it" \
  "1 times after the update, which this release does not make"

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
if [ "$(sql "select source from sessions where id = 'scenario-chat-1'")" = telegram ]; then
  ok "the seeded chat is a chat app's chat, not the terminal conversation it took its shape from"
else
  bad "the seeded chat says it is $(sql "select source from sessions where id = 'scenario-chat-1'"), not telegram"
fi
if [ "$(sql "select count(*) from sessions where id = 'first' and title = 'Hello'")" = 1 ]; then
  ok "the assistant's own conversation is still there, with its title"
else
  bad "the assistant's own conversation is gone or lost its title after the seed"
fi

# ============================================== 5. reminder-closed-elsewhere (2.0.0-beta.12, 1)
# A pair of computers joined each of the two ways, a reminder closed on the second one, and a log of
# every git call with the step it was made in.
closed_elsewhere_good() { # <folder>
  local folder=$1 mode
  rm -rf "$folder"
  mkdir -p "$folder"
  {
    printf 'slug\tpassport-renewal\n'
    printf 'title\tRenew my passport\n'
    printf 'evidence\tI posted it at the town hall, receipt 4711\n'
  } >"$folder/what.txt"
  # Git was run while the two were set up and in the sync rounds, and in no step of the scenario's.
  {
    for mode in connected folder; do
      printf '%s-join\tinit -q --bare --initial-branch=main\n' "$mode"
      printf '%s-join\tclone -q https://github.com/godspeed-scenario-stand-in/stand-in-abcd1234.git\n' "$mode"
      printf '%s-sync-a-1\tfetch origin main\n' "$mode"
      printf '%s-sync-b-1\tfetch origin main\n' "$mode"
      printf '%s-sync-b-2\tpush origin main\n' "$mode"
      printf '%s-sync-a-2\tfetch origin main\n' "$mode"
    done
  } >"$folder/git-calls.txt"
  printf '{"enabled":true}\n' >"$folder/connected-sync-config.json"
  printf '{"enabled":true,"repository":"folder","paths":["notebook"]}\n' >"$folder/folder-sync-config.json"
  # What the notebook answered when the folder pair joined: the address it read back is a
  # GitHub one, which is the whole point of the stand-in that pair joins through.
  printf '{"enabled":true,"repository":"folder","paths":["notebook"],"remote":"git@github.com:godspeed-scenario-stand-in/stand-in-abcd1234.git"}\n' \
    >"$folder/folder-join.json"
  for mode in connected folder; do
    printf '[{"slug":"passport-renewal","title":"Renew my passport","state":"closed","closedBy":"Timeline/2026-10-30 Done: Renew my passport","closedOn":"2026-10-30"}]\n' \
      >"$folder/$mode-state.json"
    printf 'CLOSED   passport-renewal  (Timeline/2026-10-30 Done: Renew my passport)\n' >"$folder/$mode-state.txt"
    printf 'Nothing needs saying today.\n' >"$folder/$mode-today.txt"
    printf 'Closed passport-renewal (2026-10-30 to 2026-11-20): Timeline/2026-10-30 Done: Renew my passport\n' \
      >"$folder/$mode-closing.txt"
    printf 'closes\tDone: Renew my passport\tyou said so; I posted it at the town hall, receipt 4711\t2026-10-30 Done: Renew my passport.md\n' \
      >"$folder/$mode-closings.txt"
    printf '{"state":"synced","at":"2026-10-30T09:00:00.000Z"}\n{"state":"synced","at":"2026-10-30T09:01:00.000Z"}\n' \
      >"$folder/$mode-rounds.txt"
  done
}

section reminder-closed-elsewhere
E=$TMP/closed-elsewhere
closed_elsewhere_good "$E/good"
passes "a reminder closed on the other computer, both ways of syncing, and no git of the scenario's own" \
  reminder-closed-elsewhere "$E/good" "is closed on the first"

refuses "a run that kept nothing at all" reminder-closed-elsewhere "$E/never-written" \
  "there is nothing at"

copy "$E/good" "$E/no-what"
printf 'slug\t\n' >"$E/no-what/what.txt"
refuses "a run that kept no word of what it added" reminder-closed-elsewhere "$E/no-what" \
  "what.txt says no reminder"

copy "$E/good" "$E/folder-twice"
cp "$E/folder-twice/folder-sync-config.json" "$E/folder-twice/connected-sync-config.json"
refuses "a pair that was joined in folder mode where Settings' own way was asked for" \
  reminder-closed-elsewhere "$E/folder-twice" "was joined in folder mode"

copy "$E/good" "$E/joined-a-folder"
printf '{"enabled":true,"repository":"folder","paths":["notebook"],"remote":"file:///tmp/github-folder/stand-in-abcd1234.git"}\n' \
  >"$E/joined-a-folder/folder-join.json"
refuses "a folder-mode pair that joined a file:// address and not a GitHub one" \
  reminder-closed-elsewhere "$E/joined-a-folder" "joined the address"

copy "$E/good" "$E/no-address"
rm "$E/no-address/folder-join.json"
refuses "a folder-mode pair that kept no word of the address it joined" \
  reminder-closed-elsewhere "$E/no-address" "folder-join.json is not in what the scenario kept"

copy "$E/good" "$E/no-state"
printf '{"not":"a state"}\n' >"$E/no-state/connected-state.json"
refuses "a state that is not what due state --json answers" reminder-closed-elsewhere "$E/no-state" \
  "is not what due state --json answers"

copy "$E/good" "$E/nothing-travelled"
printf '[{"slug":"something-else","state":"open"}]\n' >"$E/nothing-travelled/connected-state.json"
refuses "a first computer whose reminders never heard of it" reminder-closed-elsewhere "$E/nothing-travelled" \
  "do not name passport-renewal at all"

copy "$E/good" "$E/still-open"
printf '[{"slug":"passport-renewal","title":"Renew my passport","state":"open","closedBy":""}]\n' \
  >"$E/still-open/connected-state.json"
refuses "a closing that never reached the first computer" reminder-closed-elsewhere "$E/still-open" \
  'says passport-renewal is "open"'

copy "$E/good" "$E/no-evidence"
printf 'closes\tDone: Renew my passport\tyou said so\t2026-10-30 Done: Renew my passport.md\n' \
  >"$E/no-evidence/connected-closings.txt"
refuses "a closing that came over without the words it was closed with" reminder-closed-elsewhere "$E/no-evidence" \
  "holds no closing carrying the evidence"

copy "$E/good" "$E/still-asking"
printf 'RUNNING OUT  Renew my passport: three days left\n' >"$E/still-asking/connected-today.txt"
refuses "a first computer that still asks about it" reminder-closed-elsewhere "$E/still-asking" \
  "due today still names"

copy "$E/good" "$E/git-in-a-step"
printf 'connected-close-on-b\tcommit -m "the closing"\n' >>"$E/git-in-a-step/git-calls.txt"
refuses "a scenario that ran git itself between the steps" reminder-closed-elsewhere "$E/git-in-a-step" \
  "ran git itself 1 times in the step connected-close-on-b"

copy "$E/good" "$E/no-sync-git"
grep -v 'sync-a-2\|sync-b-2' "$E/good/git-calls.txt" >"$E/no-sync-git/git-calls.txt"
refuses "sync rounds in which git was never used at all" reminder-closed-elsewhere "$E/no-sync-git" \
  "no git call at all was made in the sync rounds"

# ========================================= 6. reminders-move-keeps-everything (2.0.0-beta.12, 2)
# The set of the plan before an update and after it, in a mission control the notebook owns and in
# one that is the owner's own repository.
OLD_COMMIT=5555555555555555555555555555555555555555
NEW_COMMIT=6666666666666666666666666666666666666666
SHA_THREE=3333333333333333333333333333333333333333333333333333333333333333
# The reminders the version before the move wrote as files in due/ (scenario-lib.sh OLD_SET),
# which is what that scenario asks of what a pass kept, and one sha of each that is the same
# every run.
OLD_SET_SLUGS='deadline-only target-only-passed both-dates target-moved repeating-windows dropped-one does-not-read'
fake_sha() { printf '%s' "$1" | sha256sum | cut -d' ' -f1; }

move_good() { # <folder>
  local folder=$1 pass what slug sha path
  rm -rf "$folder"
  mkdir -p "$folder"
  for pass in owned folder; do
    printf '%s\n' "$OLD_COMMIT" >"$folder/$pass-version-before"
    printf '%s\n' "$NEW_COMMIT" >"$folder/$pass-version-after"
    {
      printf 'OPEN     deadline-only\n'
      printf 'OPEN     target-only-passed\n'
      printf 'OPEN     both-dates\n'
      printf 'OPEN     target-moved\n'
      printf 'CLOSED   repeating-windows  (world/events/2026-10-30-repeating-windows-closed.md)\n'
      printf 'DROPPED  dropped-one  (world/events/2026-10-30-dropped-one-dropped.md)\n'
      printf 'NEEDS-A-LOOK does-not-read  (it has no STRIP line, so I cannot tell its dates)\n'
      printf 'OPEN     key-scenario-api-key\n'
    } >"$folder/$pass-state-before.txt"
    printf 'RUNNING OUT  File the VAT return: 30 days left\nAIMING FOR   Buy a present for Anna\n' \
      >"$folder/$pass-list-before.txt"
    printf 'RUNNING OUT  File the VAT return: 30 days left\n' >"$folder/$pass-today-before.txt"
    for what in state list today; do
      cp "$folder/$pass-$what-before.txt" "$folder/$pass-$what-after.txt"
      cp "$folder/$pass-$what-before.txt" "$folder/$pass-$what-second.txt"
    done
    # The old files the move had to take in: one for every reminder the version before the
    # move wrote as a file, and the two closings beside them.
    : >"$folder/$pass-copied.txt"
    for slug in $OLD_SET_SLUGS; do
      printf '%s\tdue/%s.md\n' "$(fake_sha "$slug")" "$slug" >>"$folder/$pass-copied.txt"
    done
    {
      printf '%s\tworld/events/2026-10-30-repeating-windows-closed.md\n' "$(fake_sha closed)"
      printf '%s\tworld/events/2026-10-30-dropped-one-dropped.md\n' "$(fake_sha dropped)"
    } >>"$folder/$pass-copied.txt"
    sort -o "$folder/$pass-copied.txt" "$folder/$pass-copied.txt"
    printf 'nothing yet\n' >"$folder/$pass-fingerprint-after.txt"
    cp "$folder/$pass-fingerprint-after.txt" "$folder/$pass-fingerprint-second.txt"
    # What `due check` said on the second start, as the reminder commands hand it over while a file
    # needs a look: the words of the check itself, and the 1 they refuse with (the program that owns
    # reminders answers 3; both say the same thing and neither is 0).
    {
      printf 'Error:   due/does-not-read.md needs a look: it has no STRIP line, so I cannot tell its dates.\n'
      printf 'Looked at 7 things with a last day. 0 closed themselves, 1 need a look.\n'
    } >"$folder/$pass-check-second.txt"
    printf '1\n' >"$folder/$pass-check-code.txt"
  done
  # Where the notebook owns the files: in the archive, out of due/ - every one of them but the
  # file no version can read, which the move never took in and so never touched.
  : >"$folder/owned-archive.txt"
  : >"$folder/owned-files-after.txt"
  while IFS=$'\t' read -r sha path; do
    if [ "$path" = due/does-not-read.md ]; then
      printf '%s\t%s\n' "$sha" "$path" >>"$folder/owned-files-after.txt"
    else
      printf '%s\tarchives/2026-10-30-due-moved-to-the-notebook/%s\n' "$sha" "$path" >>"$folder/owned-archive.txt"
      printf 'gone\t%s\n' "$path" >>"$folder/owned-files-after.txt"
    fi
  done <"$folder/owned-copied.txt"
  sort -o "$folder/owned-archive.txt" "$folder/owned-archive.txt"
  sort -o "$folder/owned-files-after.txt" "$folder/owned-files-after.txt"
  printf 'README.md\ndoes-not-read.md\n' >"$folder/owned-due-after.txt"
  printf 'not there\n' >"$folder/owned-note.txt"
  printf 'no repository of the owner\n' >"$folder/owned-git-status.txt"
  # Where they are the owner's own repository's: untouched, with the one note beside them.
  cp "$folder/folder-copied.txt" "$folder/folder-files-after.txt"
  {
    printf 'MOVED-TO-THE-NOTEBOOK.txt\nREADME.md\n'
    sed -n 's|^.*\tdue/||p' "$folder/folder-copied.txt"
  } >"$folder/folder-due-after.txt"
  printf 'The reminders now live in the notebook, under Deadlines/.\nNothing here is read any more except to take in a change an older version makes.\n' \
    >"$folder/folder-note.txt"
  printf '?? due/MOVED-TO-THE-NOTEBOOK.txt\n' >"$folder/folder-git-status.txt"
}

section reminders-move-keeps-everything
M=$TMP/move
move_good "$M/good"
passes "an update that kept every reminder, archived the old files and left the owner's own untouched" \
  reminders-move-keeps-everything "$M/good" "a second start changed nothing"

refuses "a run that kept nothing at all" reminders-move-keeps-everything "$M/never-written" \
  "there is nothing at"

copy "$M/good" "$M/no-update"
printf '%s\n' "$OLD_COMMIT" >"$M/no-update/owned-version-after"
refuses "a machine still on the version it started from" reminders-move-keeps-everything "$M/no-update" \
  "no move ever ran"

copy "$M/good" "$M/half-seeded"
grep -v 'repeating-windows\|does-not-read' "$M/good/owned-state-before.txt" >"$M/half-seeded/owned-state-before.txt"
refuses "a pass whose set was never fully seeded" reminders-move-keeps-everything "$M/half-seeded" \
  "the set this scenario has to seed is not in"

copy "$M/good" "$M/state-changed"
printf 'OPEN     deadline-only\n' >"$M/state-changed/owned-state-after.txt"
refuses "an update after which due state says something else" reminders-move-keeps-everything "$M/state-changed" \
  "due state does not print the same bytes"

copy "$M/good" "$M/list-changed"
printf 'RUNNING OUT  File the VAT return: 29 days left\n' >"$M/list-changed/owned-list-after.txt"
refuses "an update after which due list says something else" reminders-move-keeps-everything "$M/list-changed" \
  "due list does not print the same bytes"

copy "$M/good" "$M/today-changed"
printf 'Nothing needs saying today.\n' >"$M/today-changed/owned-today-after.txt"
refuses "an update after which due today says something else" reminders-move-keeps-everything "$M/today-changed" \
  "due today does not print the same bytes"

copy "$M/good" "$M/second-start-talks"
printf 'RUNNING OUT  File the VAT return: 30 days left\nRUNNING OUT  File the VAT return: 30 days left\n' \
  >"$M/second-start-talks/owned-today-second.txt"
refuses "a second start that changed what a person reads" reminders-move-keeps-everything "$M/second-start-talks" \
  "after a second start as after the first"

copy "$M/good" "$M/wrong-archive-name"
sed 's|2026-10-30-due-moved-to-the-notebook|due-files|' "$M/good/owned-archive.txt" >"$M/wrong-archive-name/owned-archive.txt"
refuses "old files archived under a folder not named for the day" reminders-move-keeps-everything "$M/wrong-archive-name" \
  "the plan asks for <date>-due-moved-to-the-notebook"

copy "$M/good" "$M/lost-in-the-move"
grep -v 'repeating-windows-closed' "$M/good/owned-archive.txt" >"$M/lost-in-the-move/owned-archive.txt"
refuses "a closing the move did not keep" reminders-move-keeps-everything "$M/lost-in-the-move" \
  "is not in the archive with the bytes it had"

copy "$M/good" "$M/still-in-the-way"
printf 'README.md\ndeadline-only.md\n' >"$M/still-in-the-way/owned-due-after.txt"
refuses "a move that left the old files in due/ where the notebook owns them" \
  reminders-move-keeps-everything "$M/still-in-the-way" "reminder file(s) after the move"

copy "$M/good" "$M/owner-file-changed"
printf '%s\tdue/deadline-only.md\n' "$SHA_THREE" >"$M/owner-file-changed/folder-files-after.txt"
refuses "a move that rewrote a file the owner's own repository tracks" \
  reminders-move-keeps-everything "$M/owner-file-changed" "changed the owner's own tracked files"

copy "$M/good" "$M/no-note"
printf 'something else entirely\n' >"$M/no-note/folder-note.txt"
refuses "a folder-mode move that left no note saying where the reminders are" \
  reminders-move-keeps-everything "$M/no-note" "does not say that the reminders live in the notebook now"

copy "$M/good" "$M/dirty-repository"
printf '?? due/MOVED-TO-THE-NOTEBOOK.txt\n D due/deadline-only.md\n' >"$M/dirty-repository/folder-git-status.txt"
refuses "a move that left the owner's repository with more to commit than the note" \
  reminders-move-keeps-everything "$M/dirty-repository" "says more about due/ and world/ than the one note"

copy "$M/good" "$M/check-said-nothing"
printf '0\n' >"$M/check-said-nothing/owned-check-code.txt"
refuses "a second start whose check said nothing needed a look" \
  reminders-move-keeps-everything "$M/check-said-nothing" "rightly answers 3 for"

copy "$M/good" "$M/check-named-nothing"
printf 'Looked at 7 things with a last day. 0 closed themselves, 0 need a look.\n' \
  >"$M/check-named-nothing/owned-check-second.txt"
refuses "a second start whose check never said which file needs a look" \
  reminders-move-keeps-everything "$M/check-named-nothing" "never names due/does-not-read.md"

copy "$M/good" "$M/already-moved"
grep 'does-not-read' "$M/good/owned-copied.txt" >"$M/already-moved/owned-copied.txt"
refuses "a start from a version that had already moved the reminders" \
  reminders-move-keeps-everything "$M/already-moved" "was not a version before the move"

copy "$M/good" "$M/read-file-gone"
sed 's|^.*\tdue/does-not-read.md$|gone\tdue/does-not-read.md|' "$M/good/owned-files-after.txt" \
  >"$M/read-file-gone/owned-files-after.txt"
refuses "a move that did not leave the file it cannot read where it was" \
  reminders-move-keeps-everything "$M/read-file-gone" "it is a file it cannot read"

copy "$M/good" "$M/read-file-archived"
grep 'does-not-read' "$M/good/owned-copied.txt" |
  sed 's|\tdue/|\tarchives/2026-10-30-due-moved-to-the-notebook/due/|' >>"$M/read-file-archived/owned-archive.txt"
refuses "a move that put the file it cannot read into the archive" \
  reminders-move-keeps-everything "$M/read-file-archived" "was never taken in"

copy "$M/good" "$M/second-start-writes"
printf 'a file the second start wrote\n' >"$M/second-start-writes/owned-fingerprint-second.txt"
refuses "a second start that changed a file" reminders-move-keeps-everything "$M/second-start-writes" \
  "a second start changed"

# ============================================== 7. two-machines-move-at-once (2.0.0-beta.12, 3)
two_machines_good() { # <folder>
  local folder=$1 computer slug
  rm -rf "$folder"
  mkdir -p "$folder"
  printf 'File the VAT return\nBuy a present for Anna\nSend the tax papers\nBook the dentist\nPay the quarterly rates\nChange the insurance\n' \
    >"$folder/expected-pages.txt"
  printf 'closes\tDone: Pay the quarterly rates\ndrops\tDropped: Change the insurance\n' \
    >"$folder/expected-closings.txt"
  for computer in a b; do
    printf '%s\n' "$OLD_COMMIT" >"$folder/$computer-version-before"
    printf '%s\n' "$NEW_COMMIT" >"$folder/$computer-version-after"
    awk '{print $0"\t"$0".md"}' "$folder/expected-pages.txt" | sort >"$folder/$computer-pages.txt"
    {
      printf 'closes\tDone: Pay the quarterly rates\tthe statement of this quarter shows it\t2026-10-30 Done: Pay the quarterly rates.md\n'
      printf 'drops\tDropped: Change the insurance\tyou said so; I am staying with the old policy\t2026-10-30 Dropped: Change the insurance.md\n'
    } | sort >"$folder/$computer-closings.txt"
    printf 'OPEN     deadline-only\nCLOSED   repeating-windows  (Timeline/2026-10-30 Done: Pay the quarterly rates)\n' \
      >"$folder/$computer-state.txt"
    # The old files that computer held before the update: one for every reminder the version before
    # the move wrote as a file in due/ (scenario-lib.sh OLD_SET), which is what it takes in.
    : >"$folder/$computer-old-files.txt"
    for slug in $OLD_SET_SLUGS; do
      printf 'due/%s.md\n' "$slug" >>"$folder/$computer-old-files.txt"
    done
    sort -o "$folder/$computer-old-files.txt" "$folder/$computer-old-files.txt"
  done
}

section two-machines-move-at-once
W=$TMP/two-machines
two_machines_good "$W/good"
passes "two computers that moved the same reminders at once and hold every one of them exactly once" \
  two-machines-move-at-once "$W/good" "exactly once afterwards"

refuses "a run that kept nothing at all" two-machines-move-at-once "$W/never-written" \
  "there is nothing at"

# A START THAT HAD ALREADY MOVED, which is what this scenario did until #120: on the public version
# `due add` writes a page in the notebook and no file in due/ at all, so the only file left there is
# the hand-written one the scenario writes itself, and neither computer has anything to take in.
copy "$W/good" "$W/already-moved"
printf 'due/does-not-read.md\n' >"$W/already-moved/a-old-files.txt"
cp "$W/already-moved/a-old-files.txt" "$W/already-moved/b-old-files.txt"
refuses "two computers that started from a version which had already moved the reminders" \
  two-machines-move-at-once "$W/already-moved" "did not start on a version before the move"

copy "$W/good" "$W/second-never-got-them"
printf 'due/does-not-read.md\n' >"$W/second-never-got-them/b-old-files.txt"
refuses "a second computer that never got the old files through the sync" \
  two-machines-move-at-once "$W/second-never-got-them" "computer b held no old reminder file"

copy "$W/good" "$W/two-versions-before"
printf '%s\n' "$NEW_COMMIT" >"$W/two-versions-before/b-version-before"
refuses "two computers that never started on one version" two-machines-move-at-once "$W/two-versions-before" \
  "did not start on one version"

copy "$W/good" "$W/two-versions-after"
printf '%s\n' "$OLD_COMMIT" >"$W/two-versions-after/b-version-after"
refuses "two computers that do not run one version after the update" two-machines-move-at-once "$W/two-versions-after" \
  "do not run one version after the update"

copy "$W/good" "$W/no-move"
printf '%s\n' "$OLD_COMMIT" >"$W/no-move/a-version-after"
printf '%s\n' "$OLD_COMMIT" >"$W/no-move/b-version-after"
refuses "two computers that never moved at all" two-machines-move-at-once "$W/no-move" \
  "no move ever ran"

copy "$W/good" "$W/reminder-lost"
grep -v 'Book the dentist' "$W/good/b-pages.txt" >"$W/reminder-lost/b-pages.txt"
refuses "a reminder that is on one computer and not the other" two-machines-move-at-once "$W/reminder-lost" \
  "holds no reminder page for"

copy "$W/good" "$W/reminder-twice"
printf 'Book the dentist\tBook the dentist 2.md\n' >>"$W/reminder-twice/a-pages.txt"
sort -o "$W/reminder-twice/a-pages.txt" "$W/reminder-twice/a-pages.txt"
refuses "a reminder both computers made a page of" two-machines-move-at-once "$W/reminder-twice" \
  "holds 2 reminder pages for"

copy "$W/good" "$W/closing-lost"
grep -v 'Dropped: Change the insurance' "$W/good/b-closings.txt" >"$W/closing-lost/b-closings.txt"
refuses "a closing that did not come through the move on one computer" two-machines-move-at-once "$W/closing-lost" \
  "holds no closing moment for"

copy "$W/good" "$W/closing-twice"
printf 'closes\tDone: Pay the quarterly rates\tthe statement of this quarter shows it\t2026-10-30 Done: Pay the quarterly rates 2.md\n' \
  >>"$W/closing-twice/a-closings.txt"
sort -o "$W/closing-twice/a-closings.txt" "$W/closing-twice/a-closings.txt"
refuses "one closing that became two moments" two-machines-move-at-once "$W/closing-twice" \
  "holds 2 closing moments for"

copy "$W/good" "$W/not-the-same"
sed 's/Done: Pay the quarterly rates\tthe statement/Done: Pay the quarterly rates\tsomething else/' \
  "$W/good/b-closings.txt" >"$W/not-the-same/b-closings.txt"
printf 'closes\tDone: Something only b has\tevidence\t2026-10-30 Done: Something only b has.md\n' \
  >>"$W/not-the-same/b-closings.txt"
sort -o "$W/not-the-same/b-closings.txt" "$W/not-the-same/b-closings.txt"
refuses "two computers that do not hold the same closings" two-machines-move-at-once "$W/not-the-same" \
  "do not hold the same closings"

# ===================================================== 8. late-reminder-file (2.0.0-beta.12, 4)
late_good() { # <folder>
  local folder=$1
  rm -rf "$folder"
  mkdir -p "$folder"
  {
    printf 'late\tlate-by-another-machine\n'
    printf 'late-title\tRenew the car insurance\n'
    printf 'closed\tdeadline-only\n'
    printf 'closed-title\tFile the VAT return\n'
    printf 'changed\tboth-dates\n'
    printf 'changed-title\tSend the tax papers\n'
    printf 'changed-words\tA line another machine wrote into the old file\n'
    printf 'page-words\tA line the owner wrote into the page\n'
  } >"$folder/what.txt"
  printf 'RUNNING OUT  Renew the car insurance: 25 days left\nAIMING FOR   Send the tax papers\n' \
    >"$folder/late-list.txt"
  printf '[{"slug":"late-by-another-machine","title":"Renew the car insurance","state":"open","closedBy":""}]\n' \
    >"$folder/late-state.json"
  printf '[{"slug":"deadline-only","title":"File the VAT return","state":"closed","closedBy":"Timeline/2026-10-30 Done: File the VAT return"}]\n' \
    >"$folder/closed-state.json"
  {
    printf 'Renew the car insurance\tRenew the car insurance.md\n'
    printf 'Send the tax papers\tSend the tax papers.md\n'
    printf 'File the VAT return\tFile the VAT return.md\n'
  } | sort >"$folder/pages.txt"
  printf 'closes\tDone: File the VAT return\tthe portal says it was filed, another machine saw it\t2026-10-30 Done: File the VAT return.md\n' \
    >"$folder/closings.txt"
  # The notebook's own review queue, where the product keeps the item about a reminder changed
  # in two places: <suggestion type><TAB><status><TAB><title><TAB><what it says>.
  printf 'deadline_both_changed\tpending_review\tA reminder changed in two places: Send the tax papers\tdue/both-dates.md and the page Send the tax papers were both changed since this reminder was copied into the notebook. The version in the notebook is the one being kept.\n' \
    >"$folder/reviews.txt"
  printf 'RUNNING OUT  Renew the car insurance: 25 days left\nAIMING FOR   Send the tax papers\n' \
    >"$folder/changed-list.txt"
  cp "$folder/changed-list.txt" "$folder/second-list.txt"
}

section late-reminder-file
L=$TMP/late
late_good "$L/good"
passes "a late file taken in once, a late closing that closed its reminder, and one review item" \
  late-reminder-file "$L/good" "exactly one review item"

refuses "a run that kept nothing at all" late-reminder-file "$L/never-written" \
  "there is nothing at"

copy "$L/good" "$L/no-what"
printf 'late\t\n' >"$L/no-what/what.txt"
refuses "a run that kept no word of what it wrote" late-reminder-file "$L/no-what" \
  "what.txt names no late reminder"

copy "$L/good" "$L/not-listed"
printf 'AIMING FOR   Send the tax papers\n' >"$L/not-listed/late-list.txt"
refuses "a file written the old way that was never taken in" late-reminder-file "$L/not-listed" \
  "is not in due list on the next run"

copy "$L/good" "$L/listed-twice"
printf 'RUNNING OUT  Renew the car insurance: 25 days left\nRUNNING OUT  Renew the car insurance: 25 days left\n' \
  >"$L/listed-twice/late-list.txt"
refuses "a late file that became two reminders in the list" late-reminder-file "$L/listed-twice" \
  "times on the run after it appeared"

copy "$L/good" "$L/no-state"
printf '{"not":"a state"}\n' >"$L/no-state/late-state.json"
refuses "a late run whose state is no state" late-reminder-file "$L/no-state" \
  "is not what due state --json answers"

copy "$L/good" "$L/unknown-slug"
printf '[{"slug":"something-else","state":"open"}]\n' >"$L/unknown-slug/late-state.json"
refuses "a late file the reminders never name" late-reminder-file "$L/unknown-slug" \
  "do not name late-by-another-machine at all"

copy "$L/good" "$L/two-pages"
printf 'Renew the car insurance\tRenew the car insurance 2.md\n' >>"$L/two-pages/pages.txt"
sort -o "$L/two-pages/pages.txt" "$L/two-pages/pages.txt"
refuses "a late file that became two pages" late-reminder-file "$L/two-pages" \
  "pages for the late reminder"

copy "$L/good" "$L/not-closed"
printf '[{"slug":"deadline-only","title":"File the VAT return","state":"open","closedBy":""}]\n' \
  >"$L/not-closed/closed-state.json"
refuses "a closing written the old way that closed nothing" late-reminder-file "$L/not-closed" \
  "after a closing written the old way named it"

copy "$L/good" "$L/no-review"
: >"$L/no-review/reviews.txt"
refuses "a change on both sides that left nothing for the owner" late-reminder-file "$L/no-review" \
  "reviews.txt is not in what the scenario kept"

copy "$L/good" "$L/two-reviews"
printf 'deadline_both_changed\tpending_review\tA reminder changed in two places: Book the dentist\tdue/target-moved.md and the page Book the dentist were both changed.\n' \
  >>"$L/two-reviews/reviews.txt"
refuses "a change on both sides that left two review items" late-reminder-file "$L/two-reviews" \
  "review items about a reminder changed in two places"

copy "$L/good" "$L/wrong-review"
printf 'deadline_both_changed\tpending_review\tA reminder changed in two places: Buy a present for Anna\tdue/target-only-passed.md and its page were both changed.\n' \
  >"$L/wrong-review/reviews.txt"
refuses "a review item about something else entirely" late-reminder-file "$L/wrong-review" \
  "does not name"

copy "$L/good" "$L/other-kind-only"
printf 'media_conflict\tpending_review\tReview the new imported version of a photo\tTwo machines wrote the same picture.\n' \
  >"$L/other-kind-only/reviews.txt"
refuses "a review queue that holds only an item about something else" late-reminder-file "$L/other-kind-only" \
  "review items about a reminder changed in two places"

copy "$L/good" "$L/changed-twice"
printf 'Send the tax papers\tSend the tax papers 2.md\n' >>"$L/changed-twice/pages.txt"
sort -o "$L/changed-twice/pages.txt" "$L/changed-twice/pages.txt"
refuses "a reminder that changed on both sides and became two pages" late-reminder-file "$L/changed-twice" \
  'pages for "Send the tax papers"'

copy "$L/good" "$L/second-run-differs"
printf 'RUNNING OUT  Renew the car insurance: 25 days left\n' >"$L/second-run-differs/second-list.txt"
refuses "a second run that lists something else" late-reminder-file "$L/second-run-differs" \
  "does not print the same bytes on a second run"

# =================================================== 9. closed-offline-on-both (2.0.0-beta.12, 5)
offline_good() { # <folder>
  local folder=$1 computer
  rm -rf "$folder"
  mkdir -p "$folder"
  {
    printf 'slug\tquarterly-report\n'
    printf 'title\tSend the quarterly report\n'
    printf 'evidence-a\tI sent it from my desk, mail of 09:12\n'
    printf 'evidence-b\tI sent it from the laptop on the train\n'
  } >"$folder/what.txt"
  for computer in a b; do
    printf '[{"slug":"quarterly-report","title":"Send the quarterly report","state":"closed","closedBy":"Timeline/2026-10-30 Done: Send the quarterly report"}]\n' \
      >"$folder/$computer-state.json"
    {
      printf 'closes\tDone: Send the quarterly report\tyou said so; I sent it from my desk, mail of 09:12\t2026-10-30 Done: Send the quarterly report.md\n'
      printf 'closes\tDone: Send the quarterly report\tyou said so; I sent it from the laptop on the train\t2026-10-30 Done: Send the quarterly report 2.md\n'
    } >"$folder/$computer-closings.txt"
    : >"$folder/$computer-reviews.txt"
  done
}

section closed-offline-on-both
O=$TMP/offline
offline_good "$O/good"
passes "one reminder closed on both computers, two moments, and nothing waiting for the owner" \
  closed-offline-on-both "$O/good" "two closing moments"

refuses "a run that kept nothing at all" closed-offline-on-both "$O/never-written" \
  "there is nothing at"

copy "$O/good" "$O/no-what"
printf 'slug\t\n' >"$O/no-what/what.txt"
refuses "a run that kept no word of the two closings" closed-offline-on-both "$O/no-what" \
  "names no reminder and no two evidences"

copy "$O/good" "$O/one-evidence"
sed 's/^evidence-b.*/evidence-b\tI sent it from my desk, mail of 09:12/' "$O/good/what.txt" >"$O/one-evidence/what.txt"
refuses "two closings the scenario could not tell apart" closed-offline-on-both "$O/one-evidence" \
  "closed it with the same words"

copy "$O/good" "$O/no-state"
printf '{"not":"a state"}\n' >"$O/no-state/a-state.json"
refuses "a computer whose state is no state" closed-offline-on-both "$O/no-state" \
  "is not what due state --json answers"

copy "$O/good" "$O/never-arrived"
printf '[{"slug":"something-else","state":"open"}]\n' >"$O/never-arrived/b-state.json"
refuses "a reminder that never reached the second computer" closed-offline-on-both "$O/never-arrived" \
  "does not name quarterly-report at all"

copy "$O/good" "$O/still-open"
printf '[{"slug":"quarterly-report","title":"Send the quarterly report","state":"open","closedBy":""}]\n' \
  >"$O/still-open/b-state.json"
refuses "a computer that still has it open after both closed it" closed-offline-on-both "$O/still-open" \
  'is "open" after both computers closed it'

copy "$O/good" "$O/one-moment"
head -1 "$O/good/a-closings.txt" >"$O/one-moment/a-closings.txt"
refuses "two closings that collapsed into one moment" closed-offline-on-both "$O/one-moment" \
  "closing moments for"

copy "$O/good" "$O/lost-the-first"
sed 's/I sent it from my desk, mail of 09:12/something nobody said/' "$O/good/b-closings.txt" \
  >"$O/lost-the-first/b-closings.txt"
refuses "a closing of the first computer that is nowhere" closed-offline-on-both "$O/lost-the-first" \
  "the closing made on the first computer"

copy "$O/good" "$O/lost-the-second"
sed 's/I sent it from the laptop on the train/something nobody said/' "$O/good/a-closings.txt" \
  >"$O/lost-the-second/a-closings.txt"
refuses "a closing of the second computer that is nowhere" closed-offline-on-both "$O/lost-the-second" \
  "the closing made on the second computer"

copy "$O/good" "$O/no-queue"
rm "$O/no-queue/b-reviews.txt"
refuses "a run that kept no review queue" closed-offline-on-both "$O/no-queue" \
  "kept no review queue for computer b"

copy "$O/good" "$O/conflict-waiting"
printf 'abcd1234\t{"id":"abcd1234","path":"notebook/Timeline/2026-10-30 Done: Send the quarterly report.md","kind":"git"}\n' \
  >"$O/conflict-waiting/a-reviews.txt"
refuses "two closings that left a conflict for the owner" closed-offline-on-both "$O/conflict-waiting" \
  "review item(s) waiting for the owner"

# ==================================================== 10. reminder-from-settings (2.0.0-beta.12, 6)
settings_reminder_good() { # <folder>
  local folder=$1
  rm -rf "$folder"
  mkdir -p "$folder"
  {
    printf 'title\tPick up the parcel from the post office\n'
    printf 'done-when\tThe parcel is at home.\n'
    printf 'due\t2026-11-01\n'
  } >"$folder/what.txt"
  printf '{"data":{"id":"due-pick-up-the-parcel-from-the-post-office","title":"Pick up the parcel from the post office","native_slug":"pick-up-the-parcel-from-the-post-office"},"error":null}\n' \
    >"$folder/settings-answer.json"
  printf '200\n' >"$folder/settings-code.txt"
  printf 'Pick up the parcel from the post office\tPick up the parcel from the post office.md\n' \
    >"$folder/pages.txt"
  cat >"$folder/page.md" <<'PAGE'
---
title: Pick up the parcel from the post office
done_when: The parcel is at home.
cost_if_missed: It goes back to the sender.
self_check: none
repeats: no
windows:
  - start: 2026-10-30
    deadline: 2026-11-01
---

- 2026-10-30 created, window 2026-10-30 to 2026-11-01
PAGE
  printf 'From your deadline reminders:\nRunning out. Pick up the parcel from the post office: 2 days left\n' \
    >"$folder/reminders.txt"
  printf 'the two commands the 08:00 routine runs (mc-due check, mc-due today)\n' >"$folder/reminders-source.txt"
  printf '{"goals":[],"deadlines":[{"id":"due-pick-up-the-parcel-from-the-post-office","title":"Pick up the parcel from the post office","status":"open","due_at":"2026-11-01T23:59:59Z"}],"jobs":[]}\n' \
    >"$folder/brief-input.json"
  printf 'README.md\n' >"$folder/due-folder.txt"
}

section reminder-from-settings
S6=$TMP/from-settings
settings_reminder_good "$S6/good"
passes "a reminder saved in Settings that is a page, is said at 08:00 and is in the brief's input" \
  reminder-from-settings "$S6/good" "is in the brief's input"

refuses "a run that kept nothing at all" reminder-from-settings "$S6/never-written" \
  "there is nothing at"

copy "$S6/good" "$S6/no-what"
printf 'title\t\n' >"$S6/no-what/what.txt"
refuses "a run that kept no word of what it saved" reminder-from-settings "$S6/no-what" \
  "what.txt names no reminder"

copy "$S6/good" "$S6/refused-code"
printf '500\n' >"$S6/refused-code/settings-code.txt"
refuses "Settings answering with a failure" reminder-from-settings "$S6/refused-code" \
  "Settings answered HTTP 500"

copy "$S6/good" "$S6/refused-reason"
printf '{"data":null,"error":"Say what is true when it is done"}\n' >"$S6/refused-reason/settings-answer.json"
refuses "Settings refusing the reminder in words" reminder-from-settings "$S6/refused-reason" \
  "Settings refused the reminder"

copy "$S6/good" "$S6/no-page"
printf 'Something else\tSomething else.md\n' >"$S6/no-page/pages.txt"
refuses "a reminder Settings kept somewhere other than the notebook" reminder-from-settings "$S6/no-page" \
  "holds no page under Deadlines/"

copy "$S6/good" "$S6/two-pages"
printf 'Pick up the parcel from the post office\tPick up the parcel from the post office 2.md\n' >>"$S6/two-pages/pages.txt"
refuses "a reminder saved twice" reminder-from-settings "$S6/two-pages" \
  "pages under Deadlines/"

copy "$S6/good" "$S6/page-without-done-when"
grep -v 'done_when' "$S6/good/page.md" >"$S6/page-without-done-when/page.md"
refuses "a page that lost what done means" reminder-from-settings "$S6/page-without-done-when" \
  "does not carry what done means"

copy "$S6/good" "$S6/page-without-window"
grep -v 'windows\|start:\|deadline:' "$S6/good/page.md" >"$S6/page-without-window/page.md"
refuses "a page with no window at all" reminder-from-settings "$S6/page-without-window" \
  "carries no window at all"

copy "$S6/good" "$S6/no-source"
: >"$S6/no-source/reminders-source.txt"
refuses "a run that did not say where the 08:00 text came from" reminder-from-settings "$S6/no-source" \
  "did not say where the 08:00 reminders' text came from"

copy "$S6/good" "$S6/silent-at-eight"
printf 'Nothing needs saying today.\n' >"$S6/silent-at-eight/reminders.txt"
refuses "08:00 reminders that never name it" reminder-from-settings "$S6/silent-at-eight" \
  "the 08:00 reminders do not name"

copy "$S6/good" "$S6/no-brief-input"
printf '{"goals":[]}\n' >"$S6/no-brief-input/brief-input.json"
refuses "an answer that is not what the notebook says about a person's own things" \
  reminder-from-settings "$S6/no-brief-input" "is not what the notebook answers on /api/personal"

copy "$S6/good" "$S6/not-in-the-brief"
printf '{"goals":[],"deadlines":[{"id":"something-else","title":"Something else","status":"open"}],"jobs":[]}\n' \
  >"$S6/not-in-the-brief/brief-input.json"
refuses "a reminder the brief would never see" reminder-from-settings "$S6/not-in-the-brief" \
  "holds no deadline for"

copy "$S6/good" "$S6/closed-in-the-brief"
sed 's/"status":"open"/"status":"closed"/' "$S6/good/brief-input.json" >"$S6/closed-in-the-brief/brief-input.json"
refuses "a new reminder the brief's input already calls closed" reminder-from-settings "$S6/closed-in-the-brief" \
  "the brief reads only what is not closed"

copy "$S6/good" "$S6/wrote-a-due-file"
printf 'README.md\npick-up-the-parcel-from-the-post-office.md\n' >"$S6/wrote-a-due-file/due-folder.txt"
refuses "a reminder that went into due/ as well" reminder-from-settings "$S6/wrote-a-due-file" \
  "reminders live in the notebook now"

# ================================================== 11. charm-challenge (2.0.0-beta.13, 1)
# What the scenario saw on a machine where the Charm Challenge did everything the release plan
# promises. The days are fixed days, and every date in a reply is worked out from them the way the
# scenario works it out, so these cases say the same thing in any month.
CHARM_START=2026-11-02
CHARM_RESET=2026-11-05
CHARM_SLIP=2026-11-06
CHARM_QUESTION='Back to 21? Yes / No'
charm_date() { # <day> <days later>: "Monday 23 November", as a reply names a day
  date -u -d "$1 + $2 days" +'%A %-d %B'
}
charm_shelf() { # <file> <day of each event...>
  local file=$1 day
  shift
  printf 'card\tCharm Challenge\tcharm\t{"names":["Charm Challenge"],"cadence":"daily","specialist":"charm"}\n' >"$file"
  for day in "$@"; do
    printf 'event\t%s\t{"when":"%s"}\n' "$day" "$day" >>"$file"
  done
}
# The card on the Trackers shelf and the chat say the same thing, because the chat relays what the
# notebook answers. So one writer fills both files of a moment.
charm_stands() { # <folder> <moment> <days to go> <end date> <longest run> <restarts>
  local folder=$1 moment=$2
  printf '%s days to go, done on %s. Longest run so far: %s days. Restarts: %s.\n' "$3" "$4" "$5" "$6" \
    >"$folder/card-$moment.txt"
  cp "$folder/card-$moment.txt" "$folder/status-$moment.txt"
}
charm_good() { # <folder>
  local folder=$1 first second third
  first=$(charm_date "$CHARM_START" 21)
  second=$(charm_date "$CHARM_RESET" 21)
  third=$(charm_date "$CHARM_SLIP" 21)
  rm -rf "$folder"
  mkdir -p "$folder"
  {
    printf 'start=%s\n' "$CHARM_START"
    printf 'reset=%s\n' "$CHARM_RESET"
    printf 'slip=%s\n' "$CHARM_SLIP"
    printf 'offset=+0000\n'
  } >"$folder/days.txt"
  printf 'Charm Challenge started. 21 days to go, done on %s.\n' "$first" >"$folder/start-reply.txt"
  charm_stands "$folder" after-start 21 "$first" 0 0
  printf 'Charm Challenge: day 1 of 21, 21 days to go.\n' >"$folder/brief-after-start.txt"
  charm_shelf "$folder/shelf-after-start.txt" "$CHARM_START"
  printf 'I have corrected the captions file and read it back.\n\nThat sounded like a slip. %s\n' \
    "$CHARM_QUESTION" >"$folder/vent-reply.txt"
  printf 'Fair enough. Still 21 days to go.\n' >"$folder/no-reply.txt"
  charm_stands "$folder" after-no 21 "$first" 0 0
  cp "$folder/brief-after-start.txt" "$folder/brief-after-no.txt"
  charm_shelf "$folder/shelf-after-no.txt" "$CHARM_START" "$CHARM_START"
  charm_stands "$folder" fourth-day 18 "$first" 3 0
  printf 'Charm Challenge: day 4 of 21, 18 days to go.\n' >"$folder/brief-fourth-day.txt"
  # The morning brief, run the way Settings runs it, and the note it wrote with the line in it.
  printf '{"results":[{"id":"morning-brief","kind":"morning-brief","state":"completed","verified":true}]}\n' \
    >"$folder/brief-run.json"
  {
    printf 'state=completed\n'
    printf 'paused=true\n'
    printf 'next_run=%sT06:00:00.000Z\n' "$CHARM_SLIP"
  } >"$folder/brief-job.txt"
  {
    printf 'Good morning. Two things today.\n\n'
    printf 'Charm Challenge: day 4 of 21, 18 days to go.\n\n'
    printf 'No fresh health observations are recorded, so there is nothing to say there yet.\n'
  } >"$folder/brief-note.txt"
  printf 'The draft is rewritten and saved.\n\nThat sounded like a slip. %s\n' \
    "$CHARM_QUESTION" >"$folder/second-vent-reply.txt"
  printf 'Back to 21. Done on %s. Restarts: 1.\n' "$second" >"$folder/yes-reply.txt"
  charm_stands "$folder" after-yes 21 "$second" 3 1
  printf 'Charm Challenge: day 1 of 21, 21 days to go.\n' >"$folder/brief-after-yes.txt"
  charm_shelf "$folder/shelf-after-yes.txt" "$CHARM_START" "$CHARM_START" "$CHARM_RESET"
  printf 'Back to 21. Done on %s. Restarts: 2.\n' "$third" >"$folder/slip-reply.txt"
  charm_stands "$folder" after-slip 21 "$third" 3 2
  printf 'Charm Challenge: day 1 of 21, 21 days to go.\n' >"$folder/brief-after-slip.txt"
  charm_shelf "$folder/shelf-after-slip.txt" "$CHARM_START" "$CHARM_START" "$CHARM_RESET" "$CHARM_SLIP"
  {
    printf 'user\tstart the Charm Challenge\n'
    printf 'assistant\tCharm Challenge started. 21 days to go, done on %s.\n' "$first"
    printf 'user\tThis caption file is garbage again.\n'
    printf 'assistant\tThat sounded like a slip. %s\n' "$CHARM_QUESTION"
    printf 'user\tno\n'
    printf 'assistant\tFair enough. Still 21 days to go.\n'
  } >"$folder/chat.txt"
}

section charm-challenge
C=$TMP/charm
charm_good "$C/good"
passes 'a challenge started, vented at, kept once and started over twice' \
  charm-challenge "$C/good" 'started over with a new end date each and 2 restarts'

copy "$C/good" "$C/no-shelf"
rm "$C/no-shelf/shelf-after-yes.txt"
refuses 'a run that kept nothing of the shelf after the yes' charm-challenge "$C/no-shelf" \
  'shelf-after-yes.txt is not in what the scenario kept'

copy "$C/good" "$C/no-days"
printf 'offset=+0000\n' >"$C/no-days/days.txt"
refuses 'a run that did not say which days it acted on' charm-challenge "$C/no-days" \
  'does not say which days this scenario acted on'

copy "$C/good" "$C/other-zone"
sed -i 's/^offset=.*/offset=+0200/' "$C/other-zone/days.txt"
refuses 'a machine whose clock is not UTC' charm-challenge "$C/other-zone" \
  'counts the days of the challenge in UTC'

copy "$C/good" "$C/no-end-date"
printf 'Charm Challenge started. 21 days to go.\n' >"$C/no-end-date/start-reply.txt"
refuses 'a start reply that leaves the owner working out the end date' charm-challenge "$C/no-end-date" \
  'the start reply does not name the end date'

copy "$C/good" "$C/not-21"
sed -i 's/21 days to go/20 days to go/' "$C/not-21/start-reply.txt"
refuses 'a start reply that does not start at 21' charm-challenge "$C/not-21" \
  'and a challenge that starts stands at 21'

copy "$C/good" "$C/no-brief-line"
printf 'Nothing to say about today.\n' >"$C/no-brief-line/brief-after-start.txt"
refuses 'a morning brief that is given no line' charm-challenge "$C/no-brief-line" \
  'is given no line about the Charm Challenge'

copy "$C/good" "$C/brief-twice"
cat "$C/good/brief-after-start.txt" "$C/good/brief-after-start.txt" >"$C/brief-twice/brief-after-start.txt"
refuses 'a morning brief that is given the line twice' charm-challenge "$C/brief-twice" \
  'times, and it is one line'

copy "$C/good" "$C/wrong-day"
sed -i 's/day 1 of 21/day 2 of 21/' "$C/wrong-day/brief-after-start.txt"
refuses "a brief's line on the wrong day of the count" charm-challenge "$C/wrong-day" \
  'is day 1 of 21'

copy "$C/good" "$C/no-question"
printf 'I have corrected the captions file. No need for the drama.\n' >"$C/no-question/vent-reply.txt"
refuses 'a vent that was answered without the one question' charm-challenge "$C/no-question" \
  "ends with \"$CHARM_QUESTION\""

copy "$C/good" "$C/no-at-the-end"
printf 'That sounded like a slip. %s\nAnything else?\n' "$CHARM_QUESTION" >"$C/no-at-the-end/vent-reply.txt"
refuses 'a vent whose question is not the end of the reply' charm-challenge "$C/no-at-the-end" \
  "ends with \"$CHARM_QUESTION\""

copy "$C/good" "$C/no-reset-counted"
sed -i 's/Restarts: 0./Restarts: 1./' "$C/no-reset-counted/status-after-no.txt" \
  "$C/no-reset-counted/card-after-no.txt"
refuses 'a "no" that counted a restart anyway' charm-challenge "$C/no-reset-counted" \
  'moved the restarts on the card'

copy "$C/good" "$C/no-moved-the-run"
sed -i 's/Longest run so far: 0/Longest run so far: 1/' "$C/no-moved-the-run/status-after-no.txt" \
  "$C/no-moved-the-run/card-after-no.txt"
refuses 'a "no" that moved the longest run' charm-challenge "$C/no-moved-the-run" \
  'moved the longest run on the card'

copy "$C/good" "$C/card-without-the-date"
printf '18 days to go. Longest run so far: 3 days. Restarts: 0.\n' >"$C/card-without-the-date/card-fourth-day.txt"
refuses 'a card that shows the number and not the end date' charm-challenge "$C/card-without-the-date" \
  'the card on the Trackers shelf does not name the end date'

copy "$C/good" "$C/card-against-the-chat"
sed -i 's/Restarts: 0./Restarts: 1./' "$C/card-against-the-chat/status-fourth-day.txt"
refuses 'a card and a chat that count restarts differently' charm-challenge "$C/card-against-the-chat" \
  'restarts and the chat says'

copy "$C/good" "$C/run-against-the-chat"
sed -i 's/Longest run so far: 3/Longest run so far: 5/' "$C/run-against-the-chat/status-fourth-day.txt"
refuses 'a card and a chat that say different longest runs' charm-challenge "$C/run-against-the-chat" \
  'the longest run is 3 and the chat says 5'

copy "$C/good" "$C/no-brief-note"
: >"$C/no-brief-note/brief-note.txt"
refuses 'a morning brief that wrote no note' charm-challenge "$C/no-brief-note" \
  'wrote no note on the fourth day'

copy "$C/good" "$C/brief-lost-the-line"
printf 'Good morning. Nothing much today.\n' >"$C/brief-lost-the-line/brief-note.txt"
refuses 'a morning brief that was given the line and lost it' charm-challenge "$C/brief-lost-the-line" \
  'does not carry'

copy "$C/good" "$C/brief-said-it-twice"
printf 'Good morning.\nCharm Challenge: day 4 of 21, 18 days to go.\nAnd again:\nCharm Challenge: day 4 of 21, 18 days to go.\n' \
  >"$C/brief-said-it-twice/brief-note.txt"
refuses 'a morning brief that said the line twice' charm-challenge "$C/brief-said-it-twice" \
  'times, and the brief carries its one line once'

copy "$C/good" "$C/no-was-a-reset"
charm_shelf "$C/no-was-a-reset/shelf-after-no.txt" "$CHARM_START" "$CHARM_START" "$CHARM_START"
refuses 'a "no" that left a third event on the card' charm-challenge "$C/no-was-a-reset" \
  'should hold the start and the kept answer'

copy "$C/good" "$C/never-counted-down"
cp "$C/good/card-after-start.txt" "$C/never-counted-down/card-fourth-day.txt"
cp "$C/good/status-after-start.txt" "$C/never-counted-down/status-fourth-day.txt"
cp "$C/good/brief-after-start.txt" "$C/never-counted-down/brief-fourth-day.txt"
refuses 'a count that did not go down by itself' charm-challenge "$C/never-counted-down" \
  'days to go, and the challenge started on'

copy "$C/good" "$C/same-end-date"
printf '21 days to go, done on %s. Before that it was %s. Longest run so far: 3 days. Restarts: 1.\n' \
  "$(charm_date "$CHARM_RESET" 21)" "$(charm_date "$CHARM_START" 21)" >"$C/same-end-date/card-after-yes.txt"
cp "$C/same-end-date/card-after-yes.txt" "$C/same-end-date/status-after-yes.txt"
refuses 'a "yes" that kept the end date it had' charm-challenge "$C/same-end-date" \
  'so the challenge did not start over'

copy "$C/good" "$C/yes-no-restart"
sed -i 's/Restarts: 1./Restarts: 0./' "$C/yes-no-restart/status-after-yes.txt" \
  "$C/yes-no-restart/card-after-yes.txt"
refuses 'a "yes" that counted no restart' charm-challenge "$C/yes-no-restart" \
  'restarts after the first "yes"'

copy "$C/good" "$C/slip-not-counted"
sed -i 's/Restarts: 2./Restarts: 1./' "$C/slip-not-counted/status-after-slip.txt" \
  "$C/slip-not-counted/card-after-slip.txt"
refuses 'a charm slip on another day that counted as the same restart' charm-challenge "$C/slip-not-counted" \
  'so it should count 2'

copy "$C/good" "$C/not-a-charm-card"
sed -i 's/"specialist":"charm"/"specialist":"habit"/' "$C/not-a-charm-card/shelf-after-start.txt"
refuses 'a card on the shelf that is a habit card' charm-challenge "$C/not-a-charm-card" \
  'does not name the charm specialist'

copy "$C/good" "$C/question-elsewhere"
grep -v 'Back to 21' "$C/good/chat.txt" >"$C/question-elsewhere/chat.txt"
refuses 'a question that was never in the conversation the owner answered in' charm-challenge "$C/question-elsewhere" \
  'so the owner was never asked in the chat they answered in'

# =========================================== 12. no-video-skills-by-default (2.0.0-beta.13, 2)
# The names the two video scenarios work from are read out of scenario-lib.sh itself, so a case here
# is about what the scenario makes of a skills folder and never about the list drifting from it.
video_names() { sed -n "/^VIDEO_SKILLS='/,/'\$/p" "$ROOT/scenarios/scenario-lib.sh" | sed "s/^VIDEO_SKILLS='//;s/'\$//" | grep -v '^$'; }
keep_names() { sed -n "/^VIDEO_SKILLS_KEEP='/,/'\$/p" "$ROOT/scenarios/scenario-lib.sh" | sed "s/^VIDEO_SKILLS_KEEP='//;s/'\$//" | grep -v '^$'; }
ORDINARY='keep-a-note
morning-note
next-action
work-item'
video_good() { # <folder>
  local folder=$1
  rm -rf "$folder"
  mkdir -p "$folder"
  printf 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0\n' >"$folder/version.txt"
  video_names >"$folder/video-skills.txt"
  keep_names >"$folder/keep-skills.txt"
  { keep_names; printf '%s\n' "$ORDINARY"; } | sort -u >"$folder/skills-after-install.txt"
  : >"$folder/recipes-in-the-version.txt"
  {
    printf 'mc-video 0.4.0: let your mission control finish your videos\n'
    printf 'ok: 25 recipes in /home/runner/godspeed-v2/skills (your assistant reads that folder)\n'
    printf 'ok: your caption look starts here: /home/runner/godspeed-v2/video/caption-style.json\n'
  } >"$folder/setup.log"
  printf '0\n' >"$folder/setup-code.txt"
  { keep_names; printf '%s\n' "$ORDINARY"; video_names; } | sort -u >"$folder/skills-after-addon.txt"
  {
    printf 'mc-video 0.4.0\n'
    printf 'ok: Node.js 22.19.0 (22 or newer)\n'
    printf 'ok: godspeed /home/runner/godspeed-v2\n'
    printf 'ok: the video-finishing recipe\n'
    printf 'ok: HyperFrames recipes (v0.8.43)\n'
    printf 'ok: HyperFrames 0.8.43 itself (mc-video hyperframes <command>)\n'
    printf 'ok: ffmpeg /usr/bin/ffmpeg\n'
    printf "ok: the speech model's code\n"
  } >"$folder/addon-check.txt"
  {
    printf 'ok: heard 5 words, language en, on the processor, 11s\n'
    printf 'ok: 7 captions written to /tmp/clip/sample-vertical.ass (box, 1080x1920, font Archivo Black)\n'
    printf 'burning the captions into the picture...\n'
    printf 'ok: /tmp/clip/sample-vertical.captioned.mp4 (1.4 MB, 8.0s; the source was 8.0s)\n'
    printf 'ok: captions inside the safe zone in 5 of 5 sample frames (/tmp/clip)\n'
  } >"$folder/captions.log"
  printf '0\n' >"$folder/captions-code.txt"
  {
    printf '[Events]\n'
    printf 'Dialogue: 0,0:00:00.10,0:00:00.60,Pop,,0,0,0,,{\\an5\\pos(540,1440)\\fad(80,0)}{\\t(0,120,0.5,\\c&H0000E5FF&\\fscy112)}HELLO{\\r} THERE\n'
    printf 'Dialogue: 0,0:00:00.60,0:00:01.40,Pop,,0,0,0,,{\\an5\\pos(540,1440)\\fad(0,90)}HELLO {\\t(0,120,0.5,\\c&H0000E5FF&\\fscy112)}THERE{\\r}\n'
    printf 'Dialogue: 0,0:00:01.40,0:00:02.90,Pop,,0,0,0,,{\\an5\\pos(540,1440)}AN ADD-ON\n'
  } >"$folder/captions.ass"
  printf '[\n {"w": " Hello", "s": 0.1, "e": 0.4},\n {"w": " there,", "s": 0.4, "e": 0.8},\n {"w": " an", "s": 1.4, "e": 1.5},\n {"w": " add", "s": 1.5, "e": 1.8},\n {"w": "-on.", "s": 1.8, "e": 2.1}\n]\n' >"$folder/words.json"
  {
    printf 'clip=273446\n'
    printf 'captioned=1402331\n'
  } >"$folder/sizes.txt"
}

section no-video-skills-by-default
NV=$TMP/no-video
video_good "$NV/good"
passes 'a fresh install without them, the add-on bringing them, and the sample clip captioned' \
  no-video-skills-by-default "$NV/good" 'are in the reader'

copy "$NV/good" "$NV/no-setup-log"
rm "$NV/no-setup-log/setup.log"
refuses "a run that kept nothing of the add-on's setup" no-video-skills-by-default "$NV/no-setup-log" \
  'setup.log is not in what the scenario kept'

copy "$NV/good" "$NV/no-recipe-list"
rm "$NV/no-recipe-list/recipes-in-the-version.txt"
refuses 'a run that never read what the version still carries' no-video-skills-by-default "$NV/no-recipe-list" \
  'recipes-in-the-version.txt is not in what the scenario kept'

copy "$NV/good" "$NV/video-on-install"
{ cat "$NV/good/skills-after-install.txt"; printf 'hyperframes\nslideshow\n'; } | sort -u \
  >"$NV/video-on-install/skills-after-install.txt"
refuses 'a fresh install that still lists video skills' no-video-skills-by-default "$NV/video-on-install" \
  'of the video skills in the reader'

copy "$NV/good" "$NV/still-a-recipe"
printf 'slideshow\n' >"$NV/still-a-recipe/recipes-in-the-version.txt"
refuses 'a version that still carries one of them as its own recipe' no-video-skills-by-default "$NV/still-a-recipe" \
  'so the next install would copy them'

copy "$NV/good" "$NV/took-the-others"
grep -v '^web-design$' "$NV/good/skills-after-install.txt" >"$NV/took-the-others/skills-after-install.txt"
refuses 'an install that lost a skill about web pages too' no-video-skills-by-default "$NV/took-the-others" \
  'this release takes out the video skills only'

copy "$NV/good" "$NV/setup-stopped"
printf '1\n' >"$NV/setup-stopped/setup-code.txt"
printf "not yet: HyperFrames did not install (see above).\n" >>"$NV/setup-stopped/setup.log"
refuses "an add-on setup that did not finish" no-video-skills-by-default "$NV/setup-stopped" \
  'so the skills it installs were never installed'

copy "$NV/good" "$NV/one-missing"
grep -v '^figma$' "$NV/good/skills-after-addon.txt" >"$NV/one-missing/skills-after-addon.txt"
refuses "a setup that brought all but one" no-video-skills-by-default "$NV/one-missing" \
  "of the video skills are missing after the video add-on's setup"

copy "$NV/good" "$NV/check-missing"
printf 'missing: HyperFrames recipes (v0.8.43)\n' >>"$NV/check-missing/addon-check.txt"
refuses 'an add-on that says something is missing after its own setup' no-video-skills-by-default "$NV/check-missing" \
  'says something is missing after its own setup'

copy "$NV/good" "$NV/captions-stopped"
printf '1\n' >"$NV/captions-stopped/captions-code.txt"
refuses 'a captions run that ended badly' no-video-skills-by-default "$NV/captions-stopped" \
  'captioning the add-on'

copy "$NV/good" "$NV/no-speech"
printf '[Events]\n' >"$NV/no-speech/captions.ass"
refuses 'captions without one line of speech in them' no-video-skills-by-default "$NV/no-speech" \
  'hold no line of speech at all'

copy "$NV/good" "$NV/nothing-heard"
printf '[]\n' >"$NV/nothing-heard/words.json"
refuses 'a words file in which nothing was heard' no-video-skills-by-default "$NV/nothing-heard" \
  'were not kept, so the captions came from nowhere'

copy "$NV/good" "$NV/words-not-json"
printf 'the words were here\n' >"$NV/words-not-json/words.json"
refuses 'a words file that is not JSON' no-video-skills-by-default "$NV/words-not-json" \
  'were not kept, so the captions came from nowhere'

copy "$NV/good" "$NV/old-word-key"
printf '[{"word": "hello", "start": 0.1, "end": 0.3}]\n' >"$NV/old-word-key/words.json"
sed -i 's/heard 5 words/heard 1 words/' "$NV/old-word-key/captions.log"
refuses 'a words file without the add-on'"'"'s own w key' no-video-skills-by-default "$NV/old-word-key" \
  'were not kept, so the captions came from nowhere'

copy "$NV/good" "$NV/from-nowhere"
sed -i 's/HELLO/GOODBYE/g; s/THERE/FRIENDS/g' "$NV/from-nowhere/captions.ass"
refuses 'captions that carry none of the heard words' no-video-skills-by-default "$NV/from-nowhere" \
  'words the speech model never heard (GOODBYE)'

copy "$NV/good" "$NV/tags-only"
{
  printf '[Events]\n'
  printf 'Dialogue: 0,0:00:00.10,0:00:00.60,Pop,,0,0,0,,{\\an5\\pos(540,1440)}\n'
  printf 'Dialogue: 0,0:00:00.60,0:00:01.40,Pop,,0,0,0,,{\\an5\\pos(540,1440)}{\\r}\n'
} >"$NV/tags-only/captions.ass"
refuses 'captions whose lines show no word at all' no-video-skills-by-default "$NV/tags-only" \
  'shows no word at all'

copy "$NV/good" "$NV/count-differs"
sed -i 's/heard 5 words/heard 33 words/' "$NV/count-differs/captions.log"
refuses 'a words file that keeps fewer words than the add-on heard' no-video-skills-by-default "$NV/count-differs" \
  'keeps another number'

copy "$NV/good" "$NV/another-clip"
sed -i 's/the source was 8.0s/the source was 21.0s/' "$NV/another-clip/captions.log"
refuses 'a captioned clip that is not the sample clip' no-video-skills-by-default "$NV/another-clip" \
  'so it is not the same clip with captions on it'

copy "$NV/good" "$NV/nothing-burned"
sed -i 's/^captioned=.*/captioned=273446/' "$NV/nothing-burned/sizes.txt"
refuses 'a captioned clip that is the sample clip byte for byte' no-video-skills-by-default "$NV/nothing-burned" \
  'so nothing was burned into the picture'

copy "$NV/good" "$NV/no-clip"
sed -i 's/^captioned=.*/captioned=/' "$NV/no-clip/sizes.txt"
refuses 'a captions run that wrote no clip at all' no-video-skills-by-default "$NV/no-clip" \
  'so video-finishing captioned nothing'

# ==================================== 13. update-removes-only-unchanged-skills (2.0.0-beta.13, 3)
PRODUCT_COMMIT=1111111111111111111111111111111111111111
ENGINE_COMMIT=2222222222222222222222222222222222222222
PUBLIC_COMMIT=3333333333333333333333333333333333333333
EDITED_SUM=4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a
update_trace() { # <file>
  {
    printf '+ curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/kit-bootstrap/%s/setup-godspeed.sh\n' "$ENGINE_COMMIT"
    printf '+ KB_BRANCH=%s\n' "$ENGINE_COMMIT"
    printf '+ GODSPEED_STARTER_REF=%s\n' "$PRODUCT_COMMIT"
  } >"$1"
}
update_removes_good() { # <folder>
  local folder=$1
  rm -rf "$folder"
  mkdir -p "$folder"
  video_names >"$folder/video-skills.txt"
  printf '{"version":"2.0.0-beta.13","productCommit":"%s","kitBootstrap":{"unixEngineCommit":"%s"}}\n' \
    "$PRODUCT_COMMIT" "$ENGINE_COMMIT" >"$folder/stage.json"
  printf '%s\n' "$PUBLIC_COMMIT" >"$folder/one-version-before.txt"
  printf '%s\n' "$PRODUCT_COMMIT" >"$folder/one-version-after.txt"
  { video_names; keep_names; printf '%s\n' "$ORDINARY"; } | sort -u >"$folder/one-before.txt"
  { keep_names; printf '%s\n' "$ORDINARY"; printf 'video-hooks\n'; } | sort -u >"$folder/one-after.txt"
  {
    printf 'name=video-hooks\n'
    printf 'sum=%s\n' "$EDITED_SUM"
    printf 'line=My own note: always ask me before you cut the first three seconds.\n'
  } >"$folder/one-edited-before.txt"
  {
    printf 'there=yes\n'
    printf 'sum=%s\n' "$EDITED_SUM"
    printf 'line=yes\n'
  } >"$folder/one-edited-after.txt"
  update_trace "$folder/one-trace.log"
  printf '%s\n' "$PUBLIC_COMMIT" >"$folder/two-version-before.txt"
  printf '%s\n' "$PRODUCT_COMMIT" >"$folder/two-version-after.txt"
  cp "$folder/one-before.txt" "$folder/two-before.txt"
  {
    printf 'mc-video 0.4.0: let your mission control finish your videos\n'
    printf 'ok: 1 recipes in /tmp/computer-b/skills (your assistant reads that folder)\n'
    printf '   Left alone because you already have a recipe with the same name: hyperframes, slideshow\n'
  } >"$folder/two-setup.log"
  printf '0\n' >"$folder/two-setup-code.txt"
  cp "$folder/one-before.txt" "$folder/two-after-addon.txt"
  cp "$folder/one-before.txt" "$folder/two-after.txt"
  update_trace "$folder/two-trace.log"
}

section update-removes-only-unchanged-skills
UR=$TMP/update-removes
update_removes_good "$UR/good"
passes 'the changed one kept, the unchanged ones gone, and all of them kept where the add-on is' \
  update-removes-only-unchanged-skills "$UR/good" 'is still there with their own line'

copy "$UR/good" "$UR/no-trace"
rm "$UR/no-trace/two-trace.log"
refuses 'a run that kept nothing of the second update' update-removes-only-unchanged-skills "$UR/no-trace" \
  'two-trace.log is not in what the scenario kept'

copy "$UR/good" "$UR/nothing-to-remove"
{ keep_names; printf '%s\n' "$ORDINARY"; } | sort -u >"$UR/nothing-to-remove/one-before.txt"
refuses 'a public version that never gave the reader the video skills' \
  update-removes-only-unchanged-skills "$UR/nothing-to-remove" 'had nothing to watch being removed'

copy "$UR/good" "$UR/never-updated"
printf '%s\n' "$PUBLIC_COMMIT" >"$UR/never-updated/one-version-after.txt"
refuses 'a first computer that is not on the stage after all' \
  update-removes-only-unchanged-skills "$UR/never-updated" 'after the update, and the stage names'

copy "$UR/good" "$UR/another-engine"
grep -v 'KB_BRANCH=' "$UR/good/one-trace.log" >"$UR/another-engine/one-trace.log"
refuses "an update that did not run the stage's own kit-bootstrap" \
  update-removes-only-unchanged-skills "$UR/another-engine" "did not run kit-bootstrap"

copy "$UR/good" "$UR/edited-gone"
printf 'there=no\nsum=\nline=no\n' >"$UR/edited-gone/one-edited-after.txt"
refuses 'an update that removed the one the reader had changed' \
  update-removes-only-unchanged-skills "$UR/edited-gone" 'which the reader had changed by hand'

copy "$UR/good" "$UR/edited-replaced"
sed -i "s/^sum=.*/sum=0000000000000000000000000000000000000000000000000000000000000000/" \
  "$UR/edited-replaced/one-edited-after.txt"
refuses "an update that wrote over the reader's own copy" \
  update-removes-only-unchanged-skills "$UR/edited-replaced" "is not the reader's own file any more"

copy "$UR/good" "$UR/line-gone"
sed -i 's/^line=yes/line=no/' "$UR/line-gone/one-edited-after.txt"
refuses 'an update that left the file and lost the line in it' \
  update-removes-only-unchanged-skills "$UR/line-gone" 'is not in it after the update'

copy "$UR/good" "$UR/unchanged-stayed"
{ cat "$UR/good/one-after.txt"; printf 'slideshow\nfigma\n'; } | sort -u >"$UR/unchanged-stayed/one-after.txt"
refuses 'an update that left the unchanged copies behind' \
  update-removes-only-unchanged-skills "$UR/unchanged-stayed" 'unchanged video skills are still in the reader'

copy "$UR/good" "$UR/addon-setup-failed"
printf '1\n' >"$UR/addon-setup-failed/two-setup-code.txt"
refuses "a second computer whose add-on setup did not finish" \
  update-removes-only-unchanged-skills "$UR/addon-setup-failed" 'so there was no install with the add-on to update'

copy "$UR/good" "$UR/addon-lost-them"
grep -v '^figma$' "$UR/good/two-after.txt" >"$UR/addon-lost-them/two-after.txt"
refuses 'an install with the add-on that lost one all the same' \
  update-removes-only-unchanged-skills "$UR/addon-lost-them" 'gone from the install that has the video add-on'

# =========================================== the stand-in for the private GitHub repository (issue #125)
# `godspeed sync folder notebook` refuses a repository whose ignore file lacks NOTEBOOK.md and
# assistant-state/, so both stand-ins must come with one.
section stand-in-ignore-file
SI_HOME=$TMP/stand-in-home
mkdir -p "$SI_HOME"
shape=stand_in_github
{
  SI_OUT=$(HOME="$SI_HOME" GIT_CONFIG_GLOBAL="$SI_HOME/gitconfig" SCENARIO=stand-in-test GODSPEED_SCENARIO_WORK="$TMP/si-work" bash -c '
    . "$1/scenarios/scenario-lib.sh"; '"$shape"' "$2/'"$shape"'" >/dev/null 2>&1; echo done' _ "$ROOT" "$TMP" 2>/dev/null)
  bare=$(find "$TMP/$shape" -maxdepth 1 -name "*.git" 2>/dev/null | sort | head -1)
  if [ -n "$bare" ] && git -C "$bare" show main:.gitignore 2>/dev/null | grep -qx 'NOTEBOOK.md' &&
    git -C "$bare" show main:.gitignore | grep -qx 'assistant-state/'; then
    ok "$shape makes a repository whose ignore file lists NOTEBOOK.md and assistant-state/"
  else
    bad "$shape made a repository without the ignore file the product asks for ($SI_OUT)"
  fi
}
# The folder-mode join checks the mission control's own repository, the way useFolderRepository does
# (git check-ignore --no-index): refused without the two lines, accepted with them.
ignores_both() { # <repository>
  git -C "$1" check-ignore -q --no-index NOTEBOOK.md && git -C "$1" check-ignore -q --no-index assistant-state/probe/x.json
}
SI_MC=$TMP/si-mission-control
git init -q -b main "$SI_MC"
printf '/.godspeed/\n' >"$SI_MC/.gitignore"
if ignores_both "$SI_MC"; then
  bad "a mission control without the two ignore lines was taken"
else
  ok "a mission control whose ignore file lacks NOTEBOOK.md and assistant-state/ is refused"
fi
SI_OUT=$(HOME="$SI_HOME" GIT_CONFIG_GLOBAL="$SI_HOME/gitconfig" SCENARIO=stand-in-test bash -c '
  . "$1/scenarios/scenario-lib.sh"; owner_ignores_what_the_notebook_keeps "$2"' _ "$ROOT" "$SI_MC" 2>&1)
if ignores_both "$SI_MC" && [ -z "$(git -C "$SI_MC" status --porcelain)" ]; then
  ok "owner_ignores_what_the_notebook_keeps makes a committed ignore file the product accepts"
else
  bad "a mission control given the ignore lines is still refused or left them uncommitted ($SI_OUT)"
fi
SI_SSH=$(HOME="$SI_HOME" GIT_CONFIG_GLOBAL="$SI_HOME/gitconfig" SCENARIO=stand-in-test GODSPEED_SCENARIO_WORK="$TMP/si-work" bash -c '
  . "$1/scenarios/scenario-lib.sh"; stand_in_github_over_ssh "$2/ssh" >/dev/null 2>&1; echo done' _ "$ROOT" "$TMP" 2>/dev/null)
SI_SSH_BARE=$(find "$TMP/ssh" -maxdepth 1 -name "*.git" | head -1)
if [ -n "$SI_SSH_BARE" ] && [ -z "$(git -C "$SI_SSH_BARE" for-each-ref 2>/dev/null)" ]; then
  ok "stand_in_github_over_ssh makes an empty repository, so the mission control's history can be pushed to it"
else
  bad "stand_in_github_over_ssh made a repository with history ($SI_SSH)"
fi

# ============================================================ every one of them, the same shape
section 'every script'
for file in scenario-lib.sh settings-on-install.sh night-tidy.sh voice.sh update-keeps-everything.sh \
  reminder-closed-elsewhere.sh reminders-move-keeps-everything.sh two-machines-move-at-once.sh \
  late-reminder-file.sh closed-offline-on-both.sh reminder-from-settings.sh \
  charm-challenge.sh no-video-skills-by-default.sh update-removes-only-unchanged-skills.sh \
  test-scenarios.sh; do
  if bash -n "$ROOT/scenarios/$file" 2>/dev/null; then
    ok "bash reads scenarios/$file"
  else
    bad "bash cannot read scenarios/$file"
  fi
done
for scenario in settings-on-install night-tidy voice update-keeps-everything \
  reminder-closed-elsewhere reminders-move-keeps-everything two-machines-move-at-once \
  late-reminder-file closed-offline-on-both reminder-from-settings charm-challenge \
  no-video-skills-by-default update-removes-only-unchanged-skills; do
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
