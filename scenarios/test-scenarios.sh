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
SHA_ONE=1111111111111111111111111111111111111111111111111111111111111111
SHA_TWO=2222222222222222222222222222222222222222222222222222222222222222
SHA_THREE=3333333333333333333333333333333333333333333333333333333333333333

move_good() { # <folder>
  local folder=$1 pass what
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
    {
      printf '%s\tdue/deadline-only.md\n' "$SHA_ONE"
      printf '%s\tdue/repeating-windows.md\n' "$SHA_TWO"
      printf '%s\tworld/events/2026-10-30-repeating-windows-closed.md\n' "$SHA_THREE"
    } >"$folder/$pass-copied.txt"
    printf 'nothing yet\n' >"$folder/$pass-fingerprint-after.txt"
    cp "$folder/$pass-fingerprint-after.txt" "$folder/$pass-fingerprint-second.txt"
  done
  # Where the notebook owns the files: in the archive, out of due/.
  {
    printf '%s\tarchives/2026-10-30-due-moved-to-the-notebook/due/deadline-only.md\n' "$SHA_ONE"
    printf '%s\tarchives/2026-10-30-due-moved-to-the-notebook/due/repeating-windows.md\n' "$SHA_TWO"
    printf '%s\tarchives/2026-10-30-due-moved-to-the-notebook/world/events/2026-10-30-repeating-windows-closed.md\n' "$SHA_THREE"
  } >"$folder/owned-archive.txt"
  {
    printf 'gone\tdue/deadline-only.md\n'
    printf 'gone\tdue/repeating-windows.md\n'
    printf 'gone\tworld/events/2026-10-30-repeating-windows-closed.md\n'
  } >"$folder/owned-files-after.txt"
  printf 'README.md\n' >"$folder/owned-due-after.txt"
  printf 'not there\n' >"$folder/owned-note.txt"
  printf 'no repository of the owner\n' >"$folder/owned-git-status.txt"
  # Where they are the owner's own repository's: untouched, with the one note beside them.
  cp "$folder/folder-copied.txt" "$folder/folder-files-after.txt"
  printf 'MOVED-TO-THE-NOTEBOOK.txt\nREADME.md\ndeadline-only.md\nrepeating-windows.md\n' >"$folder/folder-due-after.txt"
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

copy "$M/good" "$M/second-start-writes"
printf 'a file the second start wrote\n' >"$M/second-start-writes/owned-fingerprint-second.txt"
refuses "a second start that changed a file" reminders-move-keeps-everything "$M/second-start-writes" \
  "a second start changed"

# ============================================== 7. two-machines-move-at-once (2.0.0-beta.12, 3)
two_machines_good() { # <folder>
  local folder=$1 computer
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
  done
}

section two-machines-move-at-once
W=$TMP/two-machines
two_machines_good "$W/good"
passes "two computers that moved the same reminders at once and hold every one of them exactly once" \
  two-machines-move-at-once "$W/good" "exactly once afterwards"

refuses "a run that kept nothing at all" two-machines-move-at-once "$W/never-written" \
  "there is nothing at"

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
  printf 'c0ffee1234567890abcd\t{"id":"c0ffee1234567890abcd","path":"due/both-dates.md","kind":"deadline","kept":"local"}\n' \
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
printf 'deadbeef1234\t{"id":"deadbeef1234","path":"due/both-dates.md","kind":"deadline"}\n' >>"$L/two-reviews/reviews.txt"
refuses "a change on both sides that left two review items" late-reminder-file "$L/two-reviews" \
  "review items, and the plan asks for one"

copy "$L/good" "$L/wrong-review"
printf 'c0ffee1234567890abcd\t{"id":"c0ffee1234567890abcd","path":"notes/something-else.md","kind":"git"}\n' \
  >"$L/wrong-review/reviews.txt"
refuses "a review item about something else entirely" late-reminder-file "$L/wrong-review" \
  "does not name"

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

# ============================================================ every one of them, the same shape
section 'every script'
for file in scenario-lib.sh settings-on-install.sh night-tidy.sh voice.sh update-keeps-everything.sh \
  reminder-closed-elsewhere.sh reminders-move-keeps-everything.sh two-machines-move-at-once.sh \
  late-reminder-file.sh closed-offline-on-both.sh reminder-from-settings.sh \
  test-scenarios.sh; do
  if bash -n "$ROOT/scenarios/$file" 2>/dev/null; then
    ok "bash reads scenarios/$file"
  else
    bad "bash cannot read scenarios/$file"
  fi
done
for scenario in settings-on-install night-tidy voice update-keeps-everything \
  reminder-closed-elsewhere reminders-move-keeps-everything two-machines-move-at-once \
  late-reminder-file closed-offline-on-both reminder-from-settings; do
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
