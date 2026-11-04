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
  if [ -f "$ROOT/scenarios/$scenario.ps1" ]; then
    # The Windows scenarios are PowerShell; their checking part runs under pwsh anywhere.
    OUT=$("${PWSH:-pwsh}" -NoProfile -File "$ROOT/scenarios/$scenario.ps1" "$@" 2>/dev/null)
  else
    OUT=$(bash "$ROOT/scenarios/$scenario.sh" "$@" 2>/dev/null)
  fi
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

copy "$E/good" "$E/folder-pending"
printf '{"state":"pending","at":"2026-10-30T09:00:00.000Z","detail":"Command failed: git fetch --no-tags origin main"}\n' >>"$E/folder-pending/folder-rounds.txt"
refuses "a folder pair whose last sync round answered pending" reminder-closed-elsewhere "$E/folder-pending" \
  'answered "{"state":"pending"'

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
charm_shelf() { # <file> <kind@day[@epoch@conversation] of each event...>
  # Every start, question, reset, kept answer, finish and stop is one row of the card, with its kind
  # (the add-on's README, Files), so the question asked after a vent is a row too.
  local file=$1 event
  shift
  printf 'card\tCharm Challenge\tcharm\t{"names":["Charm Challenge"],"cadence":"daily","specialist":"charm"}\n' >"$file"
  local kind day epoch conversation at
  for event in "$@"; do
    IFS=@ read -r kind day epoch conversation <<<"$event"
    at=''
    if [ -n "$epoch" ]; then at=$(printf ',"conversation":"%s","at":"%s"' "$conversation" "$(date -u -d "@$epoch" +%Y-%m-%dT%H:%M:%S.000Z)"); fi
    printf 'event\t%s\t{"kind":"%s","when":"%s"%s}\n' "$day" "$kind" "$day" "$at" >>"$file"
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
  charm_shelf "$folder/shelf-after-start.txt" "start@$CHARM_START"
  printf 'I have corrected the captions file and read it back.\n\nThat sounded like a slip. %s\n' \
    "$CHARM_QUESTION" >"$folder/vent-reply.txt"
  printf 'Fair enough. Still 21 days to go.\n' >"$folder/no-reply.txt"
  # Five first vents, each in a conversation of its own (the first keeps the names it always had),
  # and the assistant's command log with the record command of each, typed without --conversation.
  local n at=1793000000
  : >"$folder/vents.txt"
  : >"$folder/commands.txt"
  : >"$folder/charm-log.txt"
  for n in 1 2 3 4 5; do
    if [ "$n" != 1 ]; then
      printf 'The file is fixed.\n\nThat sounded like a slip. %s\n' "$CHARM_QUESTION" >"$folder/vent-$n-reply.txt"
      printf 'Fair enough. Still 21 days to go.\n' >"$folder/no-$n-reply.txt"
    fi
    printf 'vent\t%s\t%s\t%s\n' "$n" "$((at + n * 100))" "$((at + n * 100 + 40))" >>"$folder/vents.txt"
    printf 'no\t%s\t%s\t%s\n' "$n" "$((at + n * 100 + 45))" "$((at + n * 100 + 60))" >>"$folder/vents.txt"
    printf '%s\tsession-%s\tfind . -name "*.srt"\n' "$((at + n * 100 + 20))" "$n" >>"$folder/commands.txt"
    printf '{"at":"x","conversation":"api_server:conv-%s","verdict":"ask","source":"model","why":"the model said slip","did":"asked"}\n' "$n" >>"$folder/charm-log.txt"
  done
  printf '%s\tsession-1\tls -la\n' "$((at + 30))" >>"$folder/commands.txt"
  charm_stands "$folder" after-no 21 "$first" 0 0
  cp "$folder/brief-after-start.txt" "$folder/brief-after-no.txt"
  local events=("start@$CHARM_START")
  for n in 1 2 3 4 5; do
    events+=("asked@$CHARM_START@$((at + n * 100 + 20))@api_server:conv-$n" "kept@$CHARM_START@$((at + n * 100 + 50))@api_server:conv-$n")
  done
  charm_shelf "$folder/shelf-after-no.txt" "${events[@]}"
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
  charm_shelf "$folder/shelf-after-yes.txt" "start@$CHARM_START" "asked@$CHARM_START" "asked@$CHARM_START" \
    "asked@$CHARM_START" "asked@$CHARM_START" "asked@$CHARM_START" "kept@$CHARM_START" "kept@$CHARM_START" \
    "kept@$CHARM_START" "kept@$CHARM_START" "kept@$CHARM_START" "asked@$CHARM_RESET" "reset@$CHARM_RESET"
  printf 'Back to 21. Done on %s. Restarts: 2.\n' "$third" >"$folder/slip-reply.txt"
  charm_stands "$folder" after-slip 21 "$third" 3 2
  printf 'Charm Challenge: day 1 of 21, 21 days to go.\n' >"$folder/brief-after-slip.txt"
  charm_shelf "$folder/shelf-after-slip.txt" "start@$CHARM_START" "asked@$CHARM_START" "asked@$CHARM_START" \
    "asked@$CHARM_START" "asked@$CHARM_START" "asked@$CHARM_START" "kept@$CHARM_START" "kept@$CHARM_START" \
    "kept@$CHARM_START" "kept@$CHARM_START" "kept@$CHARM_START" "asked@$CHARM_RESET" "reset@$CHARM_RESET" "reset@$CHARM_SLIP"
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
sed -i '0,/^event\t[^\t]*\t{"kind":"kept"/s//event\t'"$CHARM_START"'\t{"kind":"reset"/' "$C/no-was-a-reset/shelf-after-no.txt"
refuses 'a "no" that was written as a reset' charm-challenge "$C/no-was-a-reset" \
  'has no kept event in the conversation "api_server:conv-1"'

copy "$C/good" "$C/no-question-row"
sed -i '0,/^event\t[^\t]*\t{"kind":"asked"/{//d}' "$C/no-question-row/shelf-after-no.txt"
refuses 'a "no" with no question on the card before it' charm-challenge "$C/no-question-row" \
  'holds no asked event while vent 1'

copy "$C/good" "$C/unreadable-row"
charm_shelf "$C/unreadable-row/shelf-after-slip.txt" "Weird@$CHARM_SLIP"
sed -n '2,$p' "$C/good/shelf-after-slip.txt" | grep -v '"kind":"asked","when":"'"$CHARM_RESET"'"' >>"$C/unreadable-row/shelf-after-slip.txt"
refuses 'a card row whose kind cannot be read' charm-challenge "$C/unreadable-row" \
  'after the charm slip, and it should hold'

copy "$C/good" "$C/four-vents"
awk -F'\t' '!($1=="vent" && $2==5)' "$C/good/vents.txt" >"$C/four-vents/vents.txt"
refuses 'a run that kept four vents, not five' charm-challenge "$C/four-vents" \
  'holds 4 vents, and this scenario vents five times'

copy "$C/good" "$C/fifth-no-question"
printf 'The slides are redone.\n' >"$C/fifth-no-question/vent-5-reply.txt"
refuses 'a fifth vent that ended without the question' charm-challenge "$C/fifth-no-question" \
  'the reply to vent 5'

copy "$C/good" "$C/no-asked-for-vent-3"
grep -v '"kind":"asked".*conv-3' "$C/good/shelf-after-no.txt" >"$C/no-asked-for-vent-3/shelf-after-no.txt"
refuses 'a vent with no asked event on the card inside its time' charm-challenge "$C/no-asked-for-vent-3" \
  'holds no asked event while vent 3'

copy "$C/good" "$C/shared-conversation"
sed -i 's/conv-4/conv-3/g' "$C/shared-conversation/shelf-after-no.txt"
refuses 'two vents whose questions share a conversation' charm-challenge "$C/shared-conversation" \
  'which another vent'"'"'s question has too'

copy "$C/good" "$C/no-kept-for-vent-2"
grep -v '"kind":"kept".*conv-2' "$C/good/shelf-after-no.txt" >"$C/no-kept-for-vent-2/shelf-after-no.txt"
refuses 'a "no" with no kept event in its conversation' charm-challenge "$C/no-kept-for-vent-2" \
  'has no kept event in the conversation "api_server:conv-2"'

copy "$C/good" "$C/typed-conversation"
printf '1793000250\tsession-2\tgodspeed-charm asked --conversation "cli:20261103_101010_abcd" --words "x"\n' >>"$C/typed-conversation/commands.txt"
refuses 'a vent command typed with --conversation by the model' charm-challenge "$C/typed-conversation" \
  'typed with --conversation'

copy "$C/good" "$C/path-and-node"
printf '1793000250\tsession-2\tnode /x/godspeed-charm.mjs slip --words "charm slip"\n' >>"$C/path-and-node/commands.txt"
passes 'a run whose model typed the add-on'"'"'s program and its path without --conversation' charm-challenge "$C/path-and-node" \
  'five first vents, each in a new conversation'

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
refuses 'a starting version that never gave the reader the video skills' \
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

# The script starts both computers from the last version with the video skills, by its constant.
UR_SCRIPT=$ROOT/scenarios/update-removes-only-unchanged-skills.sh
# shellcheck disable=SC2016 # the script text is searched for literally, nothing is meant to expand
UR_INSTALLS=$(grep -c '^[[:space:]]*install_the_line_of_into "\$WITH_THE_VIDEO_SKILLS" ' "$UR_SCRIPT")
# shellcheck disable=SC2016 # likewise
if grep -qxF 'WITH_THE_VIDEO_SKILLS=${GODSPEED_SCENARIO_WITH_THE_VIDEO_SKILLS:-candidate/2.0.0-beta.12}' "$UR_SCRIPT" &&
  [ "$UR_INSTALLS" = 2 ] && ! grep -q 'install_the_public_line_into' "$UR_SCRIPT" &&
  ! grep -qi 'public version' "$UR_SCRIPT"; then
  ok "update-removes-only-unchanged-skills installs both computers from WITH_THE_VIDEO_SKILLS (candidate/2.0.0-beta.12), never through install_the_public_line_into"
else
  bad "update-removes-only-unchanged-skills does not install both computers from WITH_THE_VIDEO_SKILLS=candidate/2.0.0-beta.12 alone ($UR_INSTALLS installs from it)"
fi

# ======================================== 14. briefing-breaks-a-rule (2.0.0-beta.14, 4)
# What the scenario saw on a machine where a line the morning brief must carry broke the owner's voice
# rules: the brief was saved and delivered without it, and a repair item reported it.
briefing_good() { # <folder>
  local folder=$1
  rm -rf "$folder"
  mkdir -p "$folder"
  printf 'Challenge\n' >"$folder/banned-word.txt"
  # shellcheck disable=SC2016  # the backticks are the voice file's own fence, not a command
  printf '# My voice\n\n```voice-rules\nBANNED-WORD: Challenge\n```\n' >"$folder/voice.md"
  printf 'Charm Challenge: day 1 of 21, 21 days to go.\n' >"$folder/brief-line.txt"
  printf '{"results":[{"id":"morning-brief","state":"verified"}]}\n' >"$folder/brief-run.json"
  printf 'state=pending\npaused=true\n' >"$folder/brief-job.txt"
  printf 'No fresh health observations are recorded.\nReview the fictional list today.\n' >"$folder/brief-note.txt"
  printf 'ready\n' >"$folder/delivery.txt"
  printf 'repair-brief-line-abc\tneeds_review\tthe Charm Challenge line\tBANNED-WORD: Challenge\n' >"$folder/repairs.txt"
}
section '14. briefing-breaks-a-rule'
briefing_good "$TMP/briefing-good"
passes 'briefing: saved and delivered without the line, problem reported' briefing-breaks-a-rule \
  "$TMP/briefing-good" 'saved and delivered'

copy "$TMP/briefing-good" "$TMP/briefing-case"
printf 'Short and plain.\n' >"$TMP/briefing-case/voice.md"
refuses 'briefing: a voice file that bans nothing' briefing-breaks-a-rule "$TMP/briefing-case" 'nothing was banned'

copy "$TMP/briefing-good" "$TMP/briefing-case"
printf 'Charm: day 1 of 21, 21 days to go.\n' >"$TMP/briefing-case/brief-line.txt"
refuses 'briefing: the line holds no banned word, so nothing was proved' briefing-breaks-a-rule \
  "$TMP/briefing-case" 'does not contain the banned word'

copy "$TMP/briefing-good" "$TMP/briefing-case"
: >"$TMP/briefing-case/brief-note.txt"
refuses 'briefing: no note was saved' briefing-breaks-a-rule "$TMP/briefing-case" 'saved no note'

copy "$TMP/briefing-good" "$TMP/briefing-case"
printf 'Your full morning briefing for 2026-11-02 could not be written today.\n' >"$TMP/briefing-case/brief-note.txt"
refuses 'briefing: the note is the short fallback' briefing-breaks-a-rule "$TMP/briefing-case" 'short fallback'

copy "$TMP/briefing-good" "$TMP/briefing-case"
printf 'Review the fictional list today.\nCharm Challenge: day 1 of 21, 21 days to go.\n' >"$TMP/briefing-case/brief-note.txt"
refuses 'briefing: the note carries the line that breaks the rules' briefing-breaks-a-rule "$TMP/briefing-case" \
  'the line that breaks'

copy "$TMP/briefing-good" "$TMP/briefing-case"
printf 'Review the fictional challenge list today.\n' >"$TMP/briefing-case/brief-note.txt"
refuses 'briefing: the note holds the banned word elsewhere' briefing-breaks-a-rule "$TMP/briefing-case" \
  'still contains the banned word'

copy "$TMP/briefing-good" "$TMP/briefing-case"
printf 'none\n' >"$TMP/briefing-case/delivery.txt"
refuses 'briefing: saved but not delivered' briefing-breaks-a-rule "$TMP/briefing-case" 'not delivered'

copy "$TMP/briefing-good" "$TMP/briefing-case"
: >"$TMP/briefing-case/repairs.txt"
printf '\n' >"$TMP/briefing-case/repairs.txt"
refuses 'briefing: no repair item reports the problem' briefing-breaks-a-rule "$TMP/briefing-case" 'no open repair item'

copy "$TMP/briefing-good" "$TMP/briefing-case"
printf 'repair-x\tneeds_review\tsomething else\tother\n' >"$TMP/briefing-case/repairs.txt"
refuses 'briefing: a repair item that is not about the line' briefing-breaks-a-rule "$TMP/briefing-case" \
  'names the Charm Challenge line'

copy "$TMP/briefing-good" "$TMP/briefing-case"
rm "$TMP/briefing-case/delivery.txt"
refuses 'briefing: a file the scenario should have kept is missing' briefing-breaks-a-rule "$TMP/briefing-case" \
  'delivery.txt is not in what the scenario kept'

section 'the Charm Challenge line is asked as the briefing asks it'
for scenario in charm-challenge briefing-breaks-a-rule; do
  file="$ROOT/scenarios/$scenario.sh"
  if grep -qF -- '{"type":"addon-command","addon":"charm","args":["brief","--no-write"]}' "$file"; then
    ok "$scenario asks the addon-command call with --no-write, as core/briefing.mjs does"
  else
    bad "$scenario does not ask the addon-command call with --no-write"
  fi
  if grep -qF -- '{"type":"charm","action":"brief"}' "$file"; then
    bad "$scenario still asks {\"type\":\"charm\",\"action\":\"brief\"}, which the charm operation refuses"
  else
    ok "$scenario never asks {\"type\":\"charm\",\"action\":\"brief\"}"
  fi
done

# ======================================== 15. windows-old-names-move (2.0.0-beta.15, 3)
# What the scenario saw on a Windows machine whose install from 2.0.0-beta.10 was updated: listings
# of the folders, the Start menu, tasks and Apps entries, and the notebook's and the setup's answers.
# The acting part needs Windows; its checking part is held to these prepared folders under pwsh.
section "windows-old-names-move: the checks' own logic"
WN=windows-old-names-move
if ! "${PWSH:-pwsh}" -NoProfile -Command '$PSVersionTable.PSVersion.ToString()' >/dev/null 2>&1; then
  bad "$WN: pwsh is not installed, so the scenario's checking part cannot be run (this is a failure, not a skip)"
else
  if "${PWSH:-pwsh}" -NoProfile -Command "[scriptblock]::Create((Get-Content -Raw '$ROOT/scenarios/$WN.ps1')) | Out-Null"; then
    ok "$WN: pwsh reads the script"
  else
    bad "$WN: pwsh cannot parse the script"
  fi
  wn_after() { # <folder> <p>: the machine after a move that went right
    local f=$1 p=$2
    printf '%s\n' 'Godspeed' 'Godspeed Mission Control' 'Godspeed Mission Control State' 'Temp' >"$f/localappdata-$p.txt"
    printf '%s\n' installation.json notes.db 'media/photo.png' 'backups/one/notes.db' 'logs/today.log' 'hermes/config.yaml' >"$f/files-$p.txt"
    printf '%s\n' \
      'startmenu: C:\Start\Godspeed Mission Control\Open my notebook.lnk -> powershell.exe -File "C:\Local\Godspeed Mission Control\open-notebook.ps1"' \
      'startup: C:\Startup\Godspeed Mission Control.lnk -> powershell.exe -File "C:\Local\Godspeed Mission Control\start-notebook.ps1"' \
      'task: Godspeed prompt archive -> powershell.exe -File "C:\Local\Godspeed Mission Control\archive.ps1"' \
      'uninstall: Godspeed Mission Control_is1 Godspeed Mission Control C:\Local\Godspeed Mission Control "C:\Local\Godspeed Mission Control\unins000.exe"' >"$f/names-$p.txt"
    echo 0 >"$f/update-exit-$p.txt"
    echo ok >"$f/health-$p.txt"
    printf 'written-before-the-move\tWritten before the move\n' >"$f/notes-$p.txt"
    printf '%s\n' 'Reminder written before the move (in 30 days)' >"$f/reminders-$p.txt"
    printf '%s\n' '2026-11-02T10:00:00 Godspeed Mission Control now lives in C:\Local\Godspeed Mission Control and keeps its notebook'"'"'s data in C:\Local\Godspeed Mission Control State.' >"$f/setup-log-$p.txt"
  }
  wn_good() { # <folder>
    local f=$1
    rm -rf "$f"
    mkdir -p "$f"
    echo moves >"$f/mode.txt"
    printf '%s\n' 'Godspeed' 'Godspeed Mission Control Full Alpha' 'Godspeed Mission Control Full Alpha State' >"$f/localappdata-before.txt"
    printf '%s\n' installation.json notes.db 'media/photo.png' 'backups/one/notes.db' 'logs/yesterday.log' 'hermes/config.yaml' >"$f/files-before.txt"
    wn_after "$f" after
  }
  wn_good_held() { # <folder>
    local f=$1
    wn_good "$f"
    echo held >"$f/mode.txt"
    printf '%s\n' 'Godspeed' 'Godspeed Mission Control Full Alpha' 'Godspeed Mission Control Full Alpha State' >"$f/localappdata-held.txt"
    printf '%s\n' installation.json notes.db 'media/photo.png' >"$f/files-held.txt"
    echo ok >"$f/health-held.txt"
    printf 'written-before-the-move\tWritten before the move\n' >"$f/notes-held.txt"
    echo '2026-11-02T10:00:00 Godspeed Mission Control stays in its old folders this time and works there as before, because a file is in use. The next update tries the move again.' >"$f/setup-log-held.txt"
    : >"$f/names-held.txt"
    : >"$f/reminders-held.txt"
  }
  wn_good "$TMP/wn-good"
  passes "$WN: a moved install passes" "$WN" "$TMP/wn-good" "both folders moved"
  wn_good_held "$TMP/wn-held"
  passes "$WN: a held folder left working, then moved, passes" "$WN" "$TMP/wn-held" "kept working"

  copy "$TMP/wn-good" "$TMP/wn-x"
  printf '%s\n' 'Godspeed' 'Godspeed Mission Control Full Alpha' 'Godspeed Mission Control' 'Godspeed Mission Control State' >"$TMP/wn-x/localappdata-after.txt"
  refuses "$WN: the old folders left behind" "$WN" "$TMP/wn-x" "old folder Godspeed Mission Control Full Alpha is still there"
  copy "$TMP/wn-good" "$TMP/wn-x"
  printf '%s\n' 'Godspeed' 'Godspeed Mission Control Full Alpha State' 'Godspeed Mission Control' 'Godspeed Mission Control State' >"$TMP/wn-x/localappdata-after.txt"
  printf '%s\n' 'installation.json' >"$TMP/wn-x/old-state-left-after.txt"
  refuses "$WN: the old state name that never went says what it still holds" "$WN" "$TMP/wn-x" "Full Alpha State is still there after the update (it still holds: installation.json)"
  copy "$TMP/wn-good" "$TMP/wn-x"
  printf '%s\n' 'Godspeed' 'Godspeed Mission Control' >"$TMP/wn-x/localappdata-after.txt"
  refuses "$WN: the new state folder missing" "$WN" "$TMP/wn-x" "Godspeed Mission Control State is not there"
  copy "$TMP/wn-good" "$TMP/wn-x"
  echo 'startmenu: C:\Start\Godspeed Mission Control Full Alpha\Open my notebook.lnk -> powershell.exe' >>"$TMP/wn-x/names-after.txt"
  refuses "$WN: a Start menu entry still naming Full Alpha" "$WN" "$TMP/wn-x" "still names Full Alpha"
  copy "$TMP/wn-good" "$TMP/wn-x"
  echo 'task: Godspeed daily -> powershell.exe -File "C:\Local\Godspeed Mission Control Full Alpha State\x.ps1"' >>"$TMP/wn-x/names-after.txt"
  refuses "$WN: a scheduled task still naming Full Alpha" "$WN" "$TMP/wn-x" "still names Full Alpha"
  copy "$TMP/wn-good" "$TMP/wn-x"
  echo 'uninstall: Godspeed_Full_Alpha_is1 Godspeed Mission Control Full Alpha' >>"$TMP/wn-x/names-after.txt"
  refuses "$WN: an uninstall entry still naming Full Alpha" "$WN" "$TMP/wn-x" "still names Full Alpha"
  copy "$TMP/wn-good" "$TMP/wn-x"
  grep -v '^startmenu:' "$TMP/wn-good/names-after.txt" >"$TMP/wn-x/names-after.txt"
  refuses "$WN: no Start menu entry at all proves nothing" "$WN" "$TMP/wn-x" "no startmenu entry"
  copy "$TMP/wn-good" "$TMP/wn-x"
  grep -v 'notes.db$' "$TMP/wn-good/files-after.txt" >"$TMP/wn-x/files-after.txt"
  refuses "$WN: a file of the old state folder missing after the move" "$WN" "$TMP/wn-x" "not in the new one"
  copy "$TMP/wn-good" "$TMP/wn-x"
  printf '%s\n' 'hermes-runtime\uv-cache\interpreter-v4\aa\one.msgpack' >>"$TMP/wn-x/files-before.txt"
  passes "$WN: an entry of uv's cache the move made again under another name is no lost file" "$WN" "$TMP/wn-x" "both folders moved"
  copy "$TMP/wn-good" "$TMP/wn-x"
  printf '%s\n' installation.json notes.db 'media/photo.png' 'backups/one/notes.db' 'hermes/config.yaml' >"$TMP/wn-x/files-after.txt"
  passes "$WN: only the setup's own logs missing is no loss" "$WN" "$TMP/wn-x" "both folders moved"
  copy "$TMP/wn-good" "$TMP/wn-x"
  echo 1 >"$TMP/wn-x/update-exit-after.txt"
  refuses "$WN: the update ending with a failure code, everything else in place" "$WN" "$TMP/wn-x" "ended with exit 1"
  copy "$TMP/wn-good" "$TMP/wn-x"
  echo 'no answer' >"$TMP/wn-x/health-after.txt"
  refuses "$WN: the notebook not answering after the move" "$WN" "$TMP/wn-x" "does not answer"
  copy "$TMP/wn-good" "$TMP/wn-x"
  : >"$TMP/wn-x/notes-after.txt"
  refuses "$WN: the note missing after the move" "$WN" "$TMP/wn-x" "note written before"
  copy "$TMP/wn-good" "$TMP/wn-x"
  echo 'nothing due' >"$TMP/wn-x/reminders-after.txt"
  refuses "$WN: the reminder missing after the move" "$WN" "$TMP/wn-x" "reminder written before"
  copy "$TMP/wn-good" "$TMP/wn-x"
  echo 'Update finished.' >"$TMP/wn-x/setup-log-after.txt"
  refuses "$WN: the setup never says the move happened" "$WN" "$TMP/wn-x" "never say the move happened"
  copy "$TMP/wn-good" "$TMP/wn-x"
  printf '%s\n' 'Godspeed' 'Godspeed Mission Control Full Alpha' 'Godspeed Mission Control' >"$TMP/wn-x/localappdata-before.txt"
  printf '%s\n' 'Godspeed' >"$TMP/wn-x/localappdata-before.txt"
  refuses "$WN: a start that was not an old install" "$WN" "$TMP/wn-x" "was not an old install"

  copy "$TMP/wn-held" "$TMP/wn-x"
  echo 'no answer' >"$TMP/wn-x/health-held.txt"
  refuses "$WN: a held folder left not working" "$WN" "$TMP/wn-x" "does not start while the move waits"
  copy "$TMP/wn-held" "$TMP/wn-x"
  printf '%s\n' 'Godspeed' 'Godspeed Mission Control' 'Godspeed Mission Control State' >"$TMP/wn-x/localappdata-held.txt"
  refuses "$WN: a held folder moved anyway" "$WN" "$TMP/wn-x" "took Godspeed Mission Control Full Alpha away"
  copy "$TMP/wn-held" "$TMP/wn-x"
  printf '%s\n' 'Godspeed' 'Godspeed Mission Control Full Alpha' 'Godspeed Mission Control Full Alpha State' 'Godspeed Mission Control State' >"$TMP/wn-x/localappdata-held.txt"
  refuses "$WN: a held folder left half moved" "$WN" "$TMP/wn-x" "half a move"
  copy "$TMP/wn-held" "$TMP/wn-x"
  echo 'Update finished.' >"$TMP/wn-x/setup-log-held.txt"
  refuses "$WN: a held folder and no word of trying again" "$WN" "$TMP/wn-x" "never said it will try again"
  copy "$TMP/wn-held" "$TMP/wn-x"
  printf '%s\n' 'Godspeed' 'Godspeed Mission Control Full Alpha' 'Godspeed Mission Control' 'Godspeed Mission Control Full Alpha State' >"$TMP/wn-x/localappdata-after.txt"
  refuses "$WN: released, the next update still leaves the old folders" "$WN" "$TMP/wn-x" "still there after the update"

  run "$WN"
  if [ "$CODE" = 2 ]; then ok "$WN with no stage ref says how it is called (exit 2)"; else bad "$WN with no stage ref left exit $CODE, not 2"; fi
  refuses "$WN on a folder that is not there" "$WN" "$TMP/no-such-folder" "there is nothing at"
  OUT=$("${PWSH:-pwsh}" -NoProfile -File "$ROOT/scenarios/$WN.ps1" 2>&1 >/dev/null)
  case $OUT in *usage*) ok "$WN prints its usage on the error stream" ;; *) bad "$WN printed no usage ($OUT)" ;; esac
  if grep -qF "candidate/2.0.0-beta.10" "$ROOT/scenarios/$WN.ps1"; then ok "$WN starts from candidate/2.0.0-beta.10"; else bad "$WN does not name candidate/2.0.0-beta.10"; fi
fi

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
# The scenario no longer writes the two ignore lines by hand: the product does (issue #125).
if grep -q 'owner_ignores_what_the_notebook_''keeps' "$ROOT/scenarios/scenario-lib.sh" "$ROOT/scenarios/reminder-closed-elsewhere.sh"; then
  bad "a scenario still has the helper that writes NOTEBOOK.md and assistant-state/ into an ignore file by hand"
else
  ok "no scenario writes NOTEBOOK.md and assistant-state/ into a mission control's ignore file by hand"
fi
SI_SSH=$(HOME="$SI_HOME" GIT_CONFIG_GLOBAL="$SI_HOME/gitconfig" SCENARIO=stand-in-test GODSPEED_SCENARIO_WORK="$TMP/si-work" bash -c '
  . "$1/scenarios/scenario-lib.sh"; stand_in_github_over_ssh "$2/ssh" >/dev/null 2>&1; echo done' _ "$ROOT" "$TMP" 2>/dev/null)
SI_SSH_BARE=$(find "$TMP/ssh" -maxdepth 1 -name "*.git" | head -1)
if [ -n "$SI_SSH_BARE" ] && [ -z "$(git -C "$SI_SSH_BARE" for-each-ref 2>/dev/null)" ]; then
  ok "stand_in_github_over_ssh makes an empty repository, so the mission control's history can be pushed to it"
else
  bad "stand_in_github_over_ssh made a repository with history ($SI_SSH)"
fi

# ======================================= sync rounds that have to end synced (issue #125)
# On 2.0.0-beta.14 the folder half's first round answered "pending", sent nothing, and the answer went
# to folder-rounds.txt, which the run did not keep. sync_round keeps every answer in the evidence and
# fails a round still not synced at its deadline, with that answer.
section sync-round
SR_HOME=$TMP/sync-round-home
mkdir -p "$SR_HOME"
sr_run() { # <answer the round gives> <evidence folder>
  HOME="$SR_HOME" GIT_CONFIG_GLOBAL="$SR_HOME/gitconfig" SCENARIO=sync-round-test EVIDENCE="$2" \
    GODSPEED_SCENARIO_ROUND_DEADLINE=2 GODSPEED_SCENARIO_ROUND_STEP=1 SR_ANSWER="$1" bash -c '
    . "$1/scenarios/scenario-lib.sh"
    sync_on() { printf "%s\n" "$SR_ANSWER"; }
    mkdir -p "$EVIDENCE"
    sync_round /nowhere folder "sends the mission control to its copy" && echo REACHED' _ "$ROOT" 2>/dev/null
}
SR_OUT=$(sr_run '{"state":"synced","at":"2026-11-02T10:00:00.000Z"}' "$TMP/sr-synced")
if [ "$SR_OUT" = REACHED ] && grep -q '"state":"synced"' "$TMP/sr-synced/folder-rounds.txt"; then
  ok "a round that answers synced lands in the evidence as folder-rounds.txt, and the scenario goes on"
else
  bad "folder-rounds.txt did not land in the evidence for a synced round ($SR_OUT)"
fi
SR_OUT=$(sr_run '{"state":"pending","detail":"Command failed: git fetch --no-tags origin main"}' "$TMP/sr-pending")
case $SR_OUT in
  "FAIL sync-round-test: "*'"state":"pending"'*'git fetch --no-tags origin main'*) ok "a round still pending at the deadline fails the scenario with that answer" ;;
  *) bad "a round still pending at its deadline did not fail with its answer ($SR_OUT)" ;;
esac
if [ "$(grep -c pending "$TMP/sr-pending/folder-rounds.txt")" -ge 2 ]; then
  ok "every pending answer is kept in folder-rounds.txt, the round having been asked again until the deadline"
else
  bad "the pending answers were not all kept in folder-rounds.txt"
fi

# =========================== the diagnosis of a failed AI request, printed into the job log (issue #127)
# On 31 October 2026 the Charm Challenge failed twice with "The AI request failed" and the diagnosis
# went with the throwaway machine. A scenario that meets such a failure prints what the notebook and
# the assistant kept, and never a key. Prepared here: a state folder whose ai-failures.log holds a
# failure that carries the scenario's own key in three forms, and an assistant home whose error log
# does too.
section kept-diagnosis
KD=$TMP/kept-diagnosis
KD_KEY='fictional-scenario-key-0123456789'
mkdir -p "$KD/state" "$KD/home/logs" "$KD/empty-state"
printf '%s\n' \
  '{"at":"2026-11-01T10:00:00.000Z","said":"The AI request failed (HTTP 400). Check the AI connection in Settings, then try again.","exit_code":2,"model":"fictional/model","conversation":"browser-owner","diagnosis":"Error: Resume retains gateway session policy; creation overrides are unsupported on resume.\nOPENAI_API_KEY='"$KD_KEY"'\nrequest sent with Authorization: Bearer '"$KD_KEY"'"}' \
  >"$KD/state/ai-failures.log"
printf '%s\n' "2026-11-01 10:00:01 ERROR agent: API call failed for key $KD_KEY" "2026-11-01 10:00:02 ERROR agent: Error code: 400 - No endpoints found" >"$KD/home/logs/errors.log"
kd_run() { # <state> <home>
  GODSPEED_SCENARIO_AI_KEY=$KD_KEY SCENARIO=kept-diagnosis-test bash -c '. "$1/scenarios/scenario-lib.sh"; print_kept_diagnosis "$2" "$3"; echo "rc=$?"' _ "$ROOT" "$1" "$2" 2>&1
}
KD_OUT=$(kd_run "$KD/state" "$KD/home")
case $KD_OUT in
  *'Resume retains gateway session policy'*) ok "a prepared AI problem prints the notebook's kept diagnosis" ;;
  *) bad "the notebook's kept diagnosis was not printed ($KD_OUT)" ;;
esac
case $KD_OUT in
  *'No endpoints found'*) ok "and the assistant's own error log" ;;
  *) bad "the assistant's error log was not printed ($KD_OUT)" ;;
esac
case $KD_OUT in
  *"$KD_KEY"*) bad "the scenario's key is in what was printed ($KD_OUT)" ;;
  *) ok "the scenario's key is nowhere in what was printed" ;;
esac
case $KD_OUT in
  *'Bearer fictional'*) bad "a bearer credential is in what was printed" ;;
  *) ok "and no bearer credential" ;;
esac
case $KD_OUT in
  *'rc=0'*) ok "printing it ends well by itself (the scenario still says its own verdict)" ;;
  *) bad "printing the diagnosis ended with something other than 0 ($KD_OUT)" ;;
esac
KD_NONE=$(kd_run "$KD/empty-state" "$KD/empty-home")
case $KD_NONE in
  *'No kept diagnosis was found'*'rc=0'*) ok "a machine that kept nothing says so, and carries on" ;;
  *) bad "a machine that kept nothing did not say so ($KD_NONE)" ;;
esac
# The home the install recorded is found from the state folder, as the Charm Challenge (which never
# asks for the assistant's home itself) needs.
printf '{"home":"%s"}\n' "$KD/home" >"$KD/state/assistant.json"
KD_HOME=$(kd_run "$KD/state" "")
case $KD_HOME in
  *'No endpoints found'*) ok "the assistant's home is found from the state folder's assistant.json" ;;
  *) bad "the assistant's home was not found from assistant.json ($KD_HOME)" ;;
esac
# The Charm Challenge calls it before it says FAIL, in both places where the AI can fail it.
if [ "$(grep -c '^ *print_kept_diagnosis\( \|$\)' "$ROOT/scenarios/charm-challenge.sh")" -ge 2 ]; then
  ok "charm-challenge.sh prints the kept diagnosis when Settings or the chat meets a broken AI request"
else
  bad "charm-challenge.sh does not print the kept diagnosis at both places its AI can break"
fi

# ============================================================ telegram-language
# What the replies went through (the installed Hermes' hook and Telegram send path) is judged from the
# turns the driver kept and the plugin's own log.
telegram_good() { # <folder>
  local folder=$1
  mkdir -p "$folder"
  cat >"$folder/turns.json" <<'JSON'
{
 "j1": {"user": "Track Journal: finished the login page", "draft": "Alles klar, das ist gespeichert. Woran merkst du, dass es fertig ist?", "delivered": true, "sent": "All right, that is saved. What does done look like?"},
 "j2": {"user": "Done with the docs", "draft": "Gespeichert. Woran merkst du, dass es fertig ist?", "delivered": true, "sent": "Saved. What does done look like?"},
 "j3": {"user": "I finished the tests", "draft": "Notiert. Woran merkst du, dass es fertig ist?", "delivered": true, "sent": "Noted. What does done look like?"},
 "chat-en-1": {"user": "Track Journal: finished it", "draft": "Gespeichert. Woran merkst du, dass es fertig ist?", "delivered": true, "sent": "Saved. What does done look like?"},
 "chat-de": {"user": "Ich bin heute fertig", "draft": "I saved it. What does done look like?", "delivered": true, "sent": "Ich habe es gespeichert. Woran merkst du, dass es fertig ist?"},
 "chat-en-2": {"user": "Done with the tests", "draft": "Gespeichert. Woran merkst du, dass es fertig ist?", "delivered": true, "sent": "Saved. What does done look like?"},
 "cron": {"user": "Good morning", "draft": "Guten Morgen, hier ist die Liste für heute.", "delivered": true, "sent": "Guten Morgen, hier ist die Liste für heute."},
 "_plugins": ["godspeed-coach", "godspeed-reply"]
}
JSON
  printf 'plugins:\n  enabled: ["godspeed-coach", "godspeed-reply"]\n' >"$folder/config.yaml"
  : >"$folder/godspeed-reply.log"
  local n
  for n in 1 2 3 4 5 6; do printf '{"session": "s", "result": "corrected"}\n' >>"$folder/godspeed-reply.log"; done
  printf '{"session": "morning", "result": "scheduled"}\n' >>"$folder/godspeed-reply.log"
  printf 'stand-in AI\n' >"$folder/ai.txt"
}
section telegram-language
TL=$TMP/telegram
telegram_good "$TL/good"
passes "three English journal messages with a German draft sent in English, a chat that follows its messages, a cron delivery left alone" \
  telegram-language "$TL/good" "three English journal messages with a German draft were sent in English"

copy "$TL/good" "$TL/german-question"
sed -i 's/"sent": "Saved. What does done look like?"/"sent": "Gespeichert. Woran merkst du, dass es fertig ist?"/' "$TL/german-question/turns.json"
refuses "an English journal message that still got the German question" telegram-language "$TL/german-question" \
  "answered in something other than English"

copy "$TL/good" "$TL/stayed-english"
sed -i 's/"sent": "Ich habe es gespeichert. Woran merkst du, dass es fertig ist?"/"sent": "I saved it. What does done look like?"/' "$TL/stayed-english/turns.json"
refuses "a German message answered in English" telegram-language "$TL/stayed-english" \
  "German message in the chat was not answered in German"

copy "$TL/good" "$TL/cron-changed"
sed -i 's/"sent": "Guten Morgen, hier ist die Liste für heute."/"sent": "Good morning, here is the list for today."/' "$TL/cron-changed/turns.json"
refuses "a scheduled delivery that was changed" telegram-language "$TL/cron-changed" "a scheduled delivery was changed"

copy "$TL/good" "$TL/not-delivered"
sed -i '0,/"delivered": true/s//"delivered": false/' "$TL/not-delivered/turns.json"
refuses "a reply the Telegram send path did not deliver" telegram-language "$TL/not-delivered" "delivered is 'false'"

copy "$TL/good" "$TL/not-enabled"
printf 'plugins:\n  enabled: ["godspeed-coach"]\n' >"$TL/not-enabled/config.yaml"
refuses "an install that never enabled the plugin" telegram-language "$TL/not-enabled" "never enabled the plugin"

copy "$TL/good" "$TL/not-loaded"
sed -i 's/"_plugins": \["godspeed-coach", "godspeed-reply"\]/"_plugins": ["godspeed-coach"]/' "$TL/not-loaded/turns.json"
refuses "a Hermes that never loaded the plugin" telegram-language "$TL/not-loaded" "did not load godspeed-reply"

copy "$TL/good" "$TL/short-log"
sed -i '1d' "$TL/short-log/godspeed-reply.log"
refuses "a plugin log that misses a correction" telegram-language "$TL/short-log" "records 5 corrections, not 6"

# ============================================================ the assistant's command log
# night-tidy-chat.mjs commands: the commands the model ran with a tool, as it typed them, read only.
section "the assistant's command log"
C=$TMP/commands
mkdir -p "$C/home"
node --input-type=module -e '
import {DatabaseSync} from "node:sqlite";
const db=new DatabaseSync(process.argv[1]+"/state.db");
db.exec("create table sessions(id text primary key, source text not null, started_at real not null)");
db.exec("create table messages(id integer primary key autoincrement, session_id text not null, role text not null, content text, tool_calls text, timestamp real not null)");
db.prepare("insert into sessions(id, source, started_at) values (?,?,?)").run("s1","cli",1000);
db.prepare("insert into sessions(id, source, started_at) values (?,?,?)").run("s2","cli",1000);
const add=(session,role,calls,t)=>db.prepare("insert into messages(session_id, role, content, tool_calls, timestamp) values (?,?,?,?,?)").run(session,role,"x",calls,t);
add("s1","assistant",JSON.stringify([{id:"c1",function:{name:"terminal",arguments:JSON.stringify({command:"godspeed-charm asked --words \"a vent\"\n  --foo"})}}]),2000);
add("s2","assistant",JSON.stringify([{id:"c2",function:{name:"web_search",arguments:JSON.stringify({query:"nothing to run"})}},{id:"c3",function:{name:"terminal",arguments:{command:"ls -la"}}}]),3000);
add("s1","assistant",JSON.stringify([{id:"c4",function:{name:"terminal",arguments:JSON.stringify({command:"old command"})}}]),500);
add("s1","assistant",null,2500);
add("s1","user",JSON.stringify([{function:{name:"terminal",arguments:"{\"command\":\"not the model\"}"}}]),2600);
db.close();' "$C/home" 2>/dev/null
OUT=$(node "$ROOT/scenarios/night-tidy-chat.mjs" --home "$C/home" commands 2>"$C/stderr")
if [ "$(printf '%s\n' "$OUT" | grep -c .)" = 3 ] && printf '%s\n' "$OUT" | head -n 1 | grep -q "^500	s1	old command$"; then
  ok "the command log lists the commands the model ran, oldest first"
else
  bad "the command log listed [$OUT]"
fi
case $OUT in
  *'2000	s1	godspeed-charm asked --words "a vent" --foo'*) ok "a command is one line, as the model typed it, with its session and time" ;;
  *) bad "the command log does not show the command of session s1 as one line: $OUT" ;;
esac
case $OUT in
  *'3000	s2	ls -la'*) ok "a command whose arguments are an object counts too" ;;
  *) bad "the command log lacks the command whose arguments are an object: $OUT" ;;
esac
case $OUT in
  *nothing*|*'not the model'*) bad "the command log lists a call that ran no command, or a message that is not the assistant's: $OUT" ;;
  *) ok "a search, an empty call and a message of the person are not commands" ;;
esac
OUT=$(node "$ROOT/scenarios/night-tidy-chat.mjs" --home "$C/home" commands --since 2500 2>"$C/stderr")
if [ "$OUT" = "$(printf '3000\ts2\tls -la')" ]; then
  ok "--since leaves out the commands before that time"
else
  bad "--since 2500 listed [$OUT]"
fi
mkdir -p "$C/plain"
node --input-type=module -e '
import {DatabaseSync} from "node:sqlite";
const db=new DatabaseSync(process.argv[1]+"/state.db");
db.exec("create table messages(id integer primary key, session_id text, role text, content text, timestamp real)");db.close();' "$C/plain" 2>/dev/null
if OUT=$(node "$ROOT/scenarios/night-tidy-chat.mjs" --home "$C/plain" commands 2>"$C/stderr") && [ -z "$OUT" ]; then
  ok "a store without a tool_calls column has no commands, and no crash"
else
  bad "a store without tool_calls answered [$OUT]"
fi

# ===================================================== brief-asked-in-chat (2.0.0-beta.16)
# The briefing the routine saved, with the Charm line and without the sentence that breaks a rule,
# the repair item for it, and the chat's two answers.
BRIEF_LINE='Charm Challenge: day 1 of 21, 21 days to go, done on Tuesday 24 November.'
BRIEF_SENTENCE='Synergy between your goals is worth a look today, so keep one hour free for it.'
brief_good() { # <folder>
  local folder=$1
  rm -rf "$folder"
  mkdir -p "$folder"
  printf 'synergy\n' >"$folder/banned-word.txt"
  printf '# My voice\n\n```voice-rules\nBANNED-WORD: synergy\n```\n' >"$folder/voice.md"
  printf '%s\n' "$BRIEF_SENTENCE" >"$folder/contribution.txt"
  printf '%s\n' "$BRIEF_LINE" >"$folder/charm-line.txt"
  printf '{"results":[{"id":"morning-brief","state":"completed"}]}\n' >"$folder/brief-run.json"
  printf 'state=completed\npaused=true\n' >"$folder/brief-job.txt"
  printf 'Good morning. One thing today.\n\n%s\n' "$BRIEF_LINE" >"$folder/brief-note.txt"
  printf 'repair-brief-line-1\tneeds_review\tthe checked contribution\tIt breaks the rule: the word synergy is banned.\n' >"$folder/repairs.txt"
  printf '1\n' >"$folder/notes-after-brief.txt"
  printf '1\n' >"$folder/notes-after-asks.txt"
  printf 'Good morning. One thing today.\n\n%s\n' "$BRIEF_LINE" >"$folder/chat-brief-1.txt"
  printf 'Here it is again.\n\n%s\n' "$BRIEF_LINE" >"$folder/chat-brief-2.txt"
  : >"$folder/brief-folder.txt"
}
section brief-asked-in-chat
B=$TMP/brief
brief_good "$B/good"
passes 'the briefing asked for twice in the chat, with the Charm line and without the rule-breaking sentence' \
  brief-asked-in-chat "$B/good" 'were each answered with that Charm line word for word'

copy "$B/good" "$B/no-note"
: >"$B/no-note/brief-note.txt"
refuses 'a run that kept no briefing note' brief-asked-in-chat "$B/no-note" 'saved no note'

copy "$B/good" "$B/line-lost"
printf 'Good morning. One thing today.\n' >"$B/line-lost/brief-note.txt"
refuses 'a briefing without its Charm line' brief-asked-in-chat "$B/line-lost" 'does not carry'

copy "$B/good" "$B/note-has-sentence"
printf '%s\n%s\n' "$BRIEF_LINE" "$BRIEF_SENTENCE" >"$B/note-has-sentence/brief-note.txt"
refuses 'a briefing that still carries the sentence that breaks a rule' brief-asked-in-chat "$B/note-has-sentence" \
  'still carries the sentence that breaks'

copy "$B/good" "$B/no-repair"
: >"$B/no-repair/repairs.txt"
refuses 'a briefing with no repair item for the cut line' brief-asked-in-chat "$B/no-repair" 'holds no open repair item'

copy "$B/good" "$B/repair-elsewhere"
printf 'repair-1\tneeds_review\tthe cycle heads-up line\tit breaks the rule synergy\n' >"$B/repair-elsewhere/repairs.txt"
refuses 'a repair item that is about another line' brief-asked-in-chat "$B/repair-elsewhere" 'names the checked contribution'

copy "$B/good" "$B/chat-other-line"
printf 'Your day: day 3 of 21, 18 days to go.\n' >"$B/chat-other-line/chat-brief-1.txt"
refuses "a chat brief whose Charm line is not the note's" brief-asked-in-chat "$B/chat-other-line" \
  'does not carry the briefing'"'"'s Charm line word for word'

copy "$B/good" "$B/chat-has-sentence"
printf '%s\n%s\n' "$BRIEF_LINE" "$BRIEF_SENTENCE" >"$B/chat-has-sentence/chat-brief-2.txt"
refuses 'a chat brief that still carries the line that breaks a rule' brief-asked-in-chat "$B/chat-has-sentence" \
  'carries the sentence that breaks'

copy "$B/good" "$B/second-note"
printf '2\n' >"$B/second-note/notes-after-asks.txt"
refuses 'asking again saved a second briefing note' brief-asked-in-chat "$B/second-note" 'asking saves no second one'

copy "$B/good" "$B/own-brief"
printf '2026-11-03.md\n' >"$B/own-brief/brief-folder.txt"
refuses 'a chat that wrote a brief of its own' brief-asked-in-chat "$B/own-brief" 'wrote a brief of its own'

copy "$B/good" "$B/charm-line-banned"
printf 'Charm Challenge: day 1 of 21, synergy of 21 days to go.\n' >"$B/charm-line-banned/charm-line.txt"
refuses 'a Charm line that holds the banned word' brief-asked-in-chat "$B/charm-line-banned" 'contains the banned word'

copy "$B/good" "$B/sentence-fine"
printf 'Plain words between your goals are worth a look today.\n' >"$B/sentence-fine/contribution.txt"
refuses 'a seeded sentence that breaks no rule' brief-asked-in-chat "$B/sentence-fine" 'does not contain the banned word'

copy "$B/good" "$B/no-chat"
rm "$B/no-chat/chat-brief-2.txt"
refuses 'a second question that was never answered' brief-asked-in-chat "$B/no-chat" 'chat-brief-2.txt is not in what the scenario kept'

# ======================================================= talk-prep-honest (2.0.0-beta.16)
TALK_SENTENCE='The preparation for this talk is not ready: the second check did not pass.'
PREP_A_OPENING='Good evening. Tonight: your LDL result, the half hour of sleep, and one thing to try.'
PREP_B_OPENING='Good evening. Tonight: three routes, one for each of your goals, and the experiment I would start with.'
talk_prep() { # <file> <opening> <routes>
  local n goal
  {
    printf 'AREA: health\nSTATE: ready\n\n## The opening\n\n%s\n\n## Talk card\n\n- one\n\n## Routes\n\n' "$2"
    for n in $(seq 1 "$3"); do
      goal=$(printf 'lower-ldl sleep-better visible-abs' | cut -d' ' -f"$n")
      printf '### Route %s: a route\n- Goal: %s\n- Source: https://example.org/%s\n- Published: 2025-09-10\n- Read: 2026-11-03\n- Studied: 400 adults\n- Effect: 8 percent\n- Limits: short trial\n- Contrary evidence: a larger trial found less\n- Fit to this person: fits\n- Cost or burden: 20 minutes a day\n- Experiment: two weeks\n\n' "$n" "$goal" "$n"
    done
    printf '## Rejected routes\n\n- A trending supplement: unreplicated.\n'
  } >"$1"
}
talk_good() { # <folder>
  local folder=$1 goal
  rm -rf "$folder"
  mkdir -p "$folder"
  printf 'a=2026-11-02\nb=2026-11-03\noffset=+0000\n' >"$folder/days.txt"
  {
    printf 'AREA: health\nSERVES: lower-ldl, sleep-better, visible-abs\n'
    printf 'RESEARCH DOMAIN: blood-lipids | LDL\nRESEARCH DOMAIN: sleep | sleep\nRESEARCH DOMAIN: body-composition | abs\n'
  } >"$folder/area.md"
  talk_prep "$folder/prep-a.md" "$PREP_A_OPENING" 2
  talk_prep "$folder/prep-b.md" "$PREP_B_OPENING" 3
  printf '{"verdict":"fail","coverage":[{"id":"lower-ldl","verdict":"pass"},{"id":"sleep-better","verdict":"pass"},{"id":"visible-abs","verdict":"fail"}]}\n' >"$folder/review-a.json"
  printf '{"verdict":"pass","coverage":[' >"$folder/review-b.json"
  for goal in lower-ldl sleep-better visible-abs; do printf '{"id":"%s","verdict":"pass"},' "$goal" >>"$folder/review-b.json"; done
  printf '{"id":"sleep","verdict":"pass"}]}\n' >>"$folder/review-b.json"
  printf '{"version":1}\n' >"$folder/evidence-b.json"
  printf 'not sealed: its independent research review did not pass\n' >"$folder/seal-a.txt"
  printf '1\n' >"$folder/seal-a.code"
  printf 'sealed: the review passed, 6 domains and goals judged\n' >"$folder/seal-b.txt"
  printf '0\n' >"$folder/seal-b.code"
  printf 'not ready: coach/health/prep/2026-11-02.md: its independent research review did not pass\n' >"$folder/check-a.txt"
  printf 'ready: coach/health/prep/2026-11-03.md, prepared 2026-11-02 21:00\n' >"$folder/check-b.txt"
  {
    printf '# Brief\n\nRecord: coach/health/talks/2026-11-02.md\n\n## Not prepared\n'
    printf 'The preparation for this talk is not ready, and the opening must say so. Right after where it comes from, say this one sentence, word for word: "%s" Then carry on from this brief. Never say how long anything was researched.\n' "$TALK_SENTENCE"
  } >"$folder/brief-a.txt"
  printf '%s Let us start from your week: how did the sleep go?\n' "$TALK_SENTENCE" >"$folder/opening-a.txt"
  printf '%s\n' "$PREP_B_OPENING" >"$folder/opening-b.txt"
  printf 'Recorded: the Health talk of 2026-11-02 is not-held.\n' >"$folder/close-a.txt"
  printf '# Scheduled\n\n- Open talk: Sleep, since 2026-11-01\n' >"$folder/block-b.txt"
  printf 'AREA: health\n\n## The opening\n\n%s Let us start from your week: how did the sleep go?\n\n## Prepared\n\n- nothing\n' "$TALK_SENTENCE" >"$folder/talk-a.md"
  printf 'AREA: health\n\n## The opening\n\n%s\n\n## Prepared\n\n- the card\n' "$PREP_B_OPENING" >"$folder/talk-b.md"
}
section talk-prep-honest
T=$TMP/talk
talk_good "$T/good"
passes 'a talk opened unprepared saying so, then one opened from a sealed preparation of all three goals' \
  talk-prep-honest "$T/good" 'opened from the preparation'"'"'s own opening'

copy "$T/good" "$T/empty-block"
: >"$T/empty-block/block-b.txt"
passes 'a day B whose scheduled context is empty, which is clean' \
  talk-prep-honest "$T/empty-block" 'opened from the preparation'"'"'s own opening'

copy "$T/good" "$T/a-still-open"
printf '# Scheduled\n\n- Open talk: Health, since 2026-11-02\n' >"$T/a-still-open/block-b.txt"
refuses 'a day B on which the talk of (a) is still open' talk-prep-honest "$T/a-still-open" 'still lists a Health talk'

copy "$T/good" "$T/a-waiting"
printf -- '- Waiting talk: Health, since 2026-11-02\n' >"$T/a-waiting/block-b.txt"
refuses 'a day B on which the talk of (a) is waiting' talk-prep-honest "$T/a-waiting" 'still lists a Health talk'

copy "$T/good" "$T/no-close"
rm "$T/no-close/close-a.txt"
refuses 'a scenario that never closed the talk of (a)' talk-prep-honest "$T/no-close" 'close-a.txt is not in what'

copy "$T/good" "$T/no-block"
rm "$T/no-block/block-b.txt"
refuses 'a scenario that kept no scheduled context of day B' talk-prep-honest "$T/no-block" 'block-b.txt is not in what the scenario kept'

copy "$T/good" "$T/close-wrong"
printf 'Recorded: the Health talk of 2026-11-01 is not-held.\n' >"$T/close-wrong/close-a.txt"
refuses 'a close that names another day' talk-prep-honest "$T/close-wrong" 'was not closed before day B'

copy "$T/good" "$T/no-talk-b"
: >"$T/no-talk-b/talk-b.md"
# An opening longer than 200 characters: the message carries its first 200 and nothing after.
NO_TALK_B_WINDOW='Good evening. Tonight: three routes, one for each of your goals, and the experiment I would start with, taken slowly so that nothing in it is hurried or skipped, xxxxxxxxxxxxxxxxxxxxxxxxxxxxWINDOWEDGE'
printf '%sQ and the rest of what the coach said.\n' "$NO_TALK_B_WINDOW" >"$T/no-talk-b/opening-b.txt"
refuses 'no talk opened on day B' talk-prep-honest "$T/no-talk-b" "no talk of day 2026-11-03 was opened when the owner asked for it: $NO_TALK_B_WINDOW"
case $OUT in
  *"$NO_TALK_B_WINDOW"Q*) bad "no talk opened on day B (the message carries the opening past its 200th character: $OUT)" ;;
  *) ok "no talk opened on day B names no more than the first 200 characters of the opening" ;;
esac

copy "$T/good" "$T/sealed-anyway"
printf '0\n' >"$T/sealed-anyway/seal-a.code"
refuses 'a review the seal sealed although a goal was uncovered' talk-prep-honest "$T/sealed-anyway" 'sealed a review that leaves a goal uncovered'

copy "$T/good" "$T/no-seal-words"
printf 'something went wrong\n' >"$T/no-seal-words/seal-a.txt"
refuses 'a refusal that never says it was not sealed' talk-prep-honest "$T/no-seal-words" 'without saying it was not sealed'

copy "$T/good" "$T/gate-open"
printf 'ready: coach/health/prep/2026-11-02.md\n' >"$T/gate-open/check-a.txt"
refuses 'a preparation the gate did not refuse' talk-prep-honest "$T/gate-open" 'does not refuse the preparation'

copy "$T/good" "$T/a-all-covered"
printf '{"verdict":"pass","coverage":[{"id":"lower-ldl","verdict":"pass"},{"id":"sleep-better","verdict":"pass"},{"id":"visible-abs","verdict":"pass"}]}\n' >"$T/a-all-covered/review-a.json"
refuses 'a refusal although the review of (a) covered every goal' talk-prep-honest "$T/a-all-covered" 'does not say fail'

copy "$T/good" "$T/a-two-uncovered"
printf '{"verdict":"fail","coverage":[{"id":"lower-ldl","verdict":"fail"},{"id":"sleep-better","verdict":"pass"},{"id":"visible-abs","verdict":"fail"}]}\n' >"$T/a-two-uncovered/review-a.json"
refuses 'a review of (a) that leaves two goals uncovered' talk-prep-honest "$T/a-two-uncovered" 'does not cover the goal lower-ldl'

copy "$T/good" "$T/a-other-goal"
printf '{"verdict":"fail","coverage":[{"id":"lower-ldl","verdict":"pass"},{"id":"sleep-better","verdict":"pass"}]}\n' >"$T/a-other-goal/review-a.json"
refuses 'a review of (a) with no failing row for visible-abs' talk-prep-honest "$T/a-other-goal" 'visible-abs uncovered'

copy "$T/good" "$T/a-has-route"
talk_prep "$T/a-has-route/prep-a.md" "$PREP_A_OPENING" 3
refuses 'a preparation of (a) that records a route for visible-abs' talk-prep-honest "$T/a-has-route" 'is not missing from it'

copy "$T/good" "$T/a-malformed"
printf 'not sealed: the review could not be read\n' >"$T/a-malformed/seal-a.txt"
refuses 'a seal that refused (a) for a malformed review' talk-prep-honest "$T/a-malformed" 'for another reason than the review not passing'

copy "$T/good" "$T/a-gate-other"
printf 'not ready: coach/health/prep/2026-11-02.md: its research evidence or independent review is missing or unreadable\n' >"$T/a-gate-other/check-a.txt"
refuses 'a gate that refused (a) for another reason' talk-prep-honest "$T/a-gate-other" 'another reason than the review not passing'

copy "$T/good" "$T/no-section"
printf '# Brief\n\nRecord: x\n' >"$T/no-section/brief-a.txt"
refuses 'a brief with no Not prepared section' talk-prep-honest "$T/no-section" 'has no section'

copy "$T/good" "$T/no-sentence"
printf 'Good evening! How did the sleep go?\n' >"$T/no-sentence/opening-a.txt"
refuses 'an unready talk that opens without the sentence' talk-prep-honest "$T/no-sentence" 'did not open with the one sentence'

copy "$T/good" "$T/not-in-record"
printf 'AREA: health\n\n## The opening\n\nGood evening.\n' >"$T/not-in-record/talk-a.md"
refuses 'a talk record that lost the sentence' talk-prep-honest "$T/not-in-record" 'talk record of (a) does not hold the sentence'

for claim in 'I researched this all week.' 'I spent hours researching your LDL.' 'After 3 hours of research I found a route.' 'I read dozens of studies for you.'; do
  copy "$T/good" "$T/claims"
  printf '%s %s\n' "$TALK_SENTENCE" "$claim" >"$T/claims/opening-a.txt"
  refuses "an opening that claims how long research ran: $claim" talk-prep-honest "$T/claims" 'claims research it cannot show'
done

copy "$T/good" "$T/claim-in-record"
printf 'AREA: health\n\n## The opening\n\n%s I have been through the research all week.\n' "$TALK_SENTENCE" >"$T/claim-in-record/talk-a.md"
refuses 'a talk record that claims how long research ran' talk-prep-honest "$T/claim-in-record" 'claims research it cannot show'

copy "$T/good" "$T/refused-words"
printf '%s %s\n' "$TALK_SENTENCE" "$PREP_A_OPENING" >"$T/refused-words/opening-a.txt"
refuses "an opening that uses the refused preparation's words" talk-prep-honest "$T/refused-words" 'refused'

copy "$T/good" "$T/two-routes"
talk_prep "$T/two-routes/prep-b.md" "$PREP_B_OPENING" 2
refuses 'a covered preparation with only two routes recorded' talk-prep-honest "$T/two-routes" 'records 2 routes'

copy "$T/good" "$T/no-experiment"
sed -i '0,/^- Experiment:/{//d}' "$T/no-experiment/prep-b.md"
refuses 'a route recorded without its experiment' talk-prep-honest "$T/no-experiment" 'does not record "Experiment"'

copy "$T/good" "$T/no-rejected"
sed -i '/^## Rejected routes/,$d' "$T/no-rejected/prep-b.md"
refuses 'a preparation with no rejected routes section' talk-prep-honest "$T/no-rejected" 'Rejected routes'

copy "$T/good" "$T/seal-b-refused"
printf '1\n' >"$T/seal-b-refused/seal-b.code"
refuses 'a passing review the seal refused' talk-prep-honest "$T/seal-b-refused" 'refused the passing review'

copy "$T/good" "$T/review-missing-goal"
printf '{"verdict":"pass","coverage":[{"id":"lower-ldl","verdict":"pass"},{"id":"sleep-better","verdict":"pass"}]}\n' >"$T/review-missing-goal/review-b.json"
refuses 'a sealed review that does not judge every goal' talk-prep-honest "$T/review-missing-goal" 'does not judge the goal visible-abs'

copy "$T/good" "$T/gate-refuses"
printf 'not ready: coach/health/prep/2026-11-03.md: its research scope changed after preparation\n' >"$T/gate-refuses/check-b.txt"
refuses 'a sealed review the gate refuses' talk-prep-honest "$T/gate-refuses" 'does not call the covered, sealed preparation ready'

copy "$T/good" "$T/b-not-from-prep"
printf 'Good evening! How was your week?\n' >"$T/b-not-from-prep/opening-b.txt"
refuses "a ready talk whose opening is not the preparation's" talk-prep-honest "$T/b-not-from-prep" 'did not open with the preparation'"'"'s opening'

copy "$T/good" "$T/b-says-not-ready"
printf '%s %s\n' "$TALK_SENTENCE" "$PREP_B_OPENING" >"$T/b-says-not-ready/opening-b.txt"
refuses 'a ready talk that still says the preparation is not ready' talk-prep-honest "$T/b-says-not-ready" 'still opened by saying'

copy "$T/good" "$T/two-goals"
sed -i 's/^SERVES:.*/SERVES: lower-ldl, sleep-better/' "$T/two-goals/area.md"
refuses 'an area that serves two goals' talk-prep-honest "$T/two-goals" 'exactly three goals'

copy "$T/good" "$T/no-domains"
sed -i '/^RESEARCH DOMAIN/d' "$T/no-domains/area.md"
refuses 'an area with no research domain' talk-prep-honest "$T/no-domains" 'names no RESEARCH DOMAIN'

# ===================================================== the owner on Telegram (2.0.0-beta.17)
# no-question-he-cannot-judge, plain-yes, what-was-that and connection-check judge what an install sent
# to a fixture Telegram (run.json) and what the notebook held afterwards. Every case is a folder of
# those files with one thing changed.
JUDGE="$ROOT/scenarios/telegram-judge.mjs"
msg() { # <label> <text> [accepted true|false] [buttons JSON]
  printf '{"label":"%s","method":"send_message","chat_id":"31415","text":%s,"buttons":%s,"accepted":%s}' \
    "$1" "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$2")" "${4:-[]}" "${3:-true}"
}
run_json() { # <folder> <messages...>: a run.json holding these messages and steps that all worked
  local folder=$1 joined='' m
  shift
  for m in "$@"; do joined=${joined:+$joined,}$m; done
  printf '{"outbox":[%s],"steps":[{"label":"s1","kind":"cron","success":true}],"_plugins":[],"hermes":"test"}\n' "$joined" >"$folder/run.json"
}
FIXTURE_OWNER=31415
FIXTURE_VALID_TOKEN='5550001111:SCENARIO-valid-aaaaaaaaaaaaaaaaaaaaaaaaaaaa'
FIXTURE_OTHER_TOKEN='5550001111:SCENARIO-revoked-bbbbbbbbbbbbbbbbbbbbbbbb'
fixture_json() { # <file>: a telegram-fixture.json as scenario-lib.sh writes it
  printf '{"owner":"%s","valid_token":"%s","other_token":"%s","bot_id":5550001111}\n' \
    "$FIXTURE_OWNER" "$FIXTURE_VALID_TOKEN" "$FIXTURE_OTHER_TOKEN" >"$1"
}
rows() { # <file> <status|id|text>...: waiting-step records
  local file=$1 joined='' status id text
  shift
  while [ $# -ge 3 ]; do
    status=$1 id=$2 text=$3
    shift 3
    joined=${joined:+$joined,}$(printf '{"id":"%s","status":"%s","about":"%s"}' "$id" "$status" "$text")
  done
  printf '[%s]\n' "$joined" >"$file"
}
OLD='Seven old programs can post into your bot chats'

section 'telegram-fixture-fetch: revoked tokens are refused'
FETCH="$ROOT/scenarios/telegram-fixture-fetch.mjs"
mkdir -p "$TMP/fetch"
fixture_json "$TMP/fetch/fixture.json"
: >"$TMP/fetch/calls.log"
fetched() { # <token>: the HTTP status the preload answers getMe with
  GODSPEED_SCENARIO_FIXTURE="$TMP/fetch/fixture.json" GODSPEED_SCENARIO_CALLS="$TMP/fetch/calls.log" \
    node --import="file://$FETCH" -e "fetch('https://api.telegram.org/bot'+process.argv[1]+'/getMe').then(r=>console.log(r.status))" "$1"
}
[ "$(fetched "$FIXTURE_VALID_TOKEN")" = 200 ] && ok 'the valid token is answered 200' || bad 'the valid token was not answered 200'
[ "$(fetched "$FIXTURE_OTHER_TOKEN")" = 401 ] && ok 'the revoked token is answered 401' || bad 'the revoked token was not answered 401'
[ "$(tr '\n' ',' <"$TMP/fetch/calls.log")" = 'getMe valid,getMe invalid,' ] && ok 'both calls are logged without the token' || bad "the call log is: $(cat "$TMP/fetch/calls.log")"
printf '{"owner":"31415"}\n' >"$TMP/fetch/partial.json"
if GODSPEED_SCENARIO_FIXTURE="$TMP/fetch/partial.json" node --import="file://$FETCH" -e "fetch('https://api.telegram.org/botx/getMe')" >/dev/null 2>&1; then
  bad 'a fixture with no valid_token was accepted'
else
  ok 'a fixture with no valid_token is refused'
fi

section 'telegram-judge: what counts as a code'
code_case() { # <wanted: clean|code> <text>
  printf '{"outbox":[{"label":"x","text":%s,"accepted":true,"buttons":[]}]}\n' "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$2")" >"$TMP/code.json"
  if node "$JUDGE" codes "$TMP/code.json" >/dev/null; then got=clean; else got=code; fi
  if [ "$got" = "$1" ]; then ok "a message [$2] is $1"; else bad "a message [$2] is $got, not $1"; fi
}
code_case clean 'The decade ends with a facade on 2026-11-04.'
code_case clean 'Yes, I turned them off.'
code_case code 'Reply approve 59f1d506 to continue'
code_case code 'reject aad2598f'
code_case code '/approve x1'
code_case code 'Your step is 1ad58918.'
rows "$TMP/code-rows.json" pending step-aaaa-1111-2222 'x'
printf '{"outbox":[{"label":"x","text":"see step-aaa","accepted":true,"buttons":[]}]}\n' >"$TMP/code.json"
if node "$JUDGE" codes "$TMP/code.json" "$TMP/code-rows.json" >/dev/null; then bad "a step id from the snapshot passed"; else ok "a step id from the snapshot is a code"; fi

# ---------------------------------------------------------------- no-question-he-cannot-judge
nq_good() { # <folder>
  local f=$1 label
  rm -rf "$f"
  mkdir -p "$f"
  run_json "$f" "$(msg s3-ask 'Should I turn off the seven old programs that can still post into your bot chats?')" \
    "$(msg s3 'Done: they are turned off.')"
  for label in s1 s2 s4 s5; do rows "$f/approvals-$label.json" approved step-qqqq-0001 'Restart the gateway'; done
  rows "$f/approvals-s3-ask.json" pending step-qqqq-0002 "$OLD"
  rows "$f/approvals-s3.json" approved step-qqqq-0002 "$OLD"
  fixture_json "$f/telegram-fixture.json"
}
section no-question-he-cannot-judge
Q=$TMP/nq
nq_good "$Q/good"
passes 'five situations: nothing for 1, 2, 4, 5, one question and one confirming reply for 3' no-question-he-cannot-judge "$Q/good" 'none holds a code'
copy "$Q/good" "$Q/asker-failed"
printf '{"outbox":[],"steps":[{"label":"s1","kind":"cron","success":false,"error":"this install has no godspeed-step, the one way to ask for a yes (ticket 01, #196)"}]}\n' >"$Q/asker-failed/run.json"
refuses 'an asker that cannot ask (no godspeed-step)' no-question-he-cannot-judge "$Q/asker-failed" 'no godspeed-step'
copy "$Q/good" "$Q/s1-asked"
run_json "$Q/s1-asked" "$(msg s1 'Restart your bot gateway?')" "$(msg s3-ask 'Turn off the seven old programs?')" "$(msg s3 'Done.')"
refuses 'a message for the quiet restart' no-question-he-cannot-judge "$Q/s1-asked" 'situation s1 sent'
copy "$Q/good" "$Q/s1-waits"
rows "$Q/s1-waits/approvals-s1.json" pending step-qqqq-0001 'Restart the gateway'
refuses 'a quiet restart left waiting' no-question-he-cannot-judge "$Q/s1-waits" 'situation s1 left a step waiting'
copy "$Q/good" "$Q/s2-waits"
rows "$Q/s2-waits/approvals-s2.json" pending step-qqqq-0003 "$OLD"
refuses 'a bundle that left a step waiting' no-question-he-cannot-judge "$Q/s2-waits" 'situation s2 left a step waiting'
copy "$Q/good" "$Q/s4-asked"
run_json "$Q/s4-asked" "$(msg s3-ask 'Turn off the seven old programs?')" "$(msg s3 'Done.')" "$(msg s4 'Lock the seven stopped programs down too?')"
refuses 'a message for the optional extra' no-question-he-cannot-judge "$Q/s4-asked" 'situation s4 sent'
copy "$Q/good" "$Q/s5-lock"
run_json "$Q/s5-lock" "$(msg s3-ask 'Turn off the seven old programs?')" "$(msg s3 'Done.')" "$(msg s5 'Reminder: lock the seven programs down.')"
refuses 'a reminder about the optional extra' no-question-he-cannot-judge "$Q/s5-lock" 'sent the owner a message'
copy "$Q/good" "$Q/s5-other"
run_json "$Q/s5-other" "$(msg s3-ask 'Turn off the seven old programs?')" "$(msg s3 'Done.')" "$(msg s5 'Everything is fine.')"
refuses 'any message from the reminder routine' no-question-he-cannot-judge "$Q/s5-other" 'sent the owner a message'
copy "$Q/good" "$Q/vague-question"
run_json "$Q/vague-question" "$(msg s3-ask 'Is it fine to go on?')" "$(msg s3 'Done.')"
refuses 'a question that does not say what it is about' no-question-he-cannot-judge "$Q/vague-question" 'does not say what it is about'
copy "$Q/good" "$Q/asks-again"
run_json "$Q/asks-again" "$(msg s3-ask 'Turn off the seven old programs?')" "$(msg s3 'Done, anything else?')"
refuses 'a reply to "approve" that asks again' no-question-he-cannot-judge "$Q/asks-again" 'asks the owner something again'
copy "$Q/good" "$Q/not-approved"
rows "$Q/not-approved/approvals-s3.json" pending step-qqqq-0002 "$OLD"
refuses 'an "approve" that approved nothing' no-question-he-cannot-judge "$Q/not-approved" 'did not approve the step'
copy "$Q/good" "$Q/typed-code"
run_json "$Q/typed-code" "$(msg s3-ask 'Turn off the seven old programs? Reply approve 59f1d506')" "$(msg s3 'Done.')"
refuses 'a question that tells him to type approve and an id' no-question-he-cannot-judge "$Q/typed-code" 'holds a code'
copy "$Q/good" "$Q/hex-id"
run_json "$Q/hex-id" "$(msg s3-ask 'Turn off the seven old programs?')" "$(msg s3 'Done: aad2598f.')"
refuses 'a reply that shows an id' no-question-he-cannot-judge "$Q/hex-id" 'holds a code'
copy "$Q/good" "$Q/no-snapshot"
rm "$Q/no-snapshot/approvals-s4.json"
refuses 'a run that kept no snapshot after situation 4' no-question-he-cannot-judge "$Q/no-snapshot" 'approvals-s4.json is not in what the scenario kept'

# ---------------------------------------------------------------------------------- plain-yes
PB1='Send this week food log to your nutritionist'
PB2='Cancel the renewal of your gym membership'
PA='Share this week food log with your nutritionist'
PC='Book the car yearly inspection'
YN='[{"text":"Yes","callback_data":"y"},{"text":"No","callback_data":"n"}]'
py_snapshots() { # <folder> <statuses of a, b1, b2, c in order, for each label>
  local f=$1
  rows "$f/approvals-a-ask.json" pending a1 "$PA"
  rows "$f/approvals-a.json" approved a1 "$PA"
  rows "$f/approvals-b-ask.json" approved a1 "$PA" pending b1 "$PB1" pending b2 "$PB2"
  rows "$f/approvals-b.json" approved a1 "$PA" pending b1 "$PB1" pending b2 "$PB2"
  rows "$f/approvals-b-choice.json" approved a1 "$PA" approved b1 "$PB1" pending b2 "$PB2"
  rows "$f/approvals-c-ask.json" approved a1 "$PA" approved b1 "$PB1" pending b2 "$PB2" pending c1 "$PC"
  rows "$f/approvals-c-press.json" approved a1 "$PA" approved b1 "$PB1" approved b2 "$PB2" pending c1 "$PC"
  rows "$f/approvals-d-no.json" approved a1 "$PA" approved b1 "$PB1" approved b2 "$PB2" rejected c1 "$PC"
  rows "$f/approvals-d.json" approved a1 "$PA" approved b1 "$PB1" approved b2 "$PB2" rejected c1 "$PC"
}
py_good() { # <folder>
  local f=$1
  rm -rf "$f"
  mkdir -p "$f"
  run_json "$f" "$(msg a-ask 'Share the food log with your nutritionist?' true "$YN")" "$(msg a 'Done, I shared it.')" \
    "$(msg b-ask 'Send the food log to your nutritionist?' true "$YN")" "$(msg b-ask 'Cancel the renewal of your gym membership?' true "$YN")" \
    "$(msg b 'Which one: the food log for your nutritionist, or cancelling the gym membership?')" "$(msg b-choice 'Sent the food log.')" \
    "$(msg c-ask 'Book the car inspection?' true "$YN")" "$(msg c-press 'Cancelled the gym membership renewal.')" "$(msg d 'Nothing is waiting for a yes right now.')"
  py_snapshots "$f"
  fixture_json "$f/telegram-fixture.json"
}
section plain-yes
P=$TMP/py
py_good "$P/good"
passes 'plain yes, two waiting, a button, and nothing waiting' plain-yes "$P/good" 'approved nothing'
copy "$P/good" "$P/a-open"
rows "$P/a-open/approvals-a.json" pending a1 "$PA"
refuses 'a yes to one waiting step that approved nothing' plain-yes "$P/a-open" 'did not approve it'
copy "$P/good" "$P/b-approved-one"
rows "$P/b-approved-one/approvals-b.json" approved a1 "$PA" approved b1 "$PB1" pending b2 "$PB2"
refuses 'a yes with two waiting that approved one' plain-yes "$P/b-approved-one" 'approved one of them'
copy "$P/good" "$P/b-names-one"
run_json "$P/b-names-one" "$(msg a-ask 'Share the log?' true "$YN")" "$(msg a 'Done.')" "$(msg b 'Do you mean the food log for your nutritionist?')" \
  "$(msg b-ask 'Cancel the gym membership?' true "$YN")" "$(msg c-ask 'Book the inspection?' true "$YN")"
refuses 'a question that names only one of two waiting steps' plain-yes "$P/b-names-one" 'does not name both'
copy "$P/good" "$P/b-two-questions"
run_json "$P/b-two-questions" "$(msg a 'Done.')" "$(msg b 'The food log, or the gym membership?')" "$(msg b 'Which one, the food log or the gym?')" \
  "$(msg b-ask 'Cancel the gym?' true "$YN")" "$(msg c-ask 'Book the inspection?' true "$YN")"
refuses 'two questions for one yes' plain-yes "$P/b-two-questions" 'got 2 messages'
copy "$P/good" "$P/choice-approved-both"
rows "$P/choice-approved-both/approvals-b-choice.json" approved a1 "$PA" approved b1 "$PB1" approved b2 "$PB2"
refuses 'an answer naming one that approved both' plain-yes "$P/choice-approved-both" 'approved the gym step too'
copy "$P/good" "$P/no-buttons"
run_json "$P/no-buttons" "$(msg a 'Done.')" "$(msg b 'The food log, or the gym membership?')" \
  "$(msg b-ask 'Cancel the gym membership?')" "$(msg c-ask 'Book the inspection?')"
refuses 'a question that went out without buttons' plain-yes "$P/no-buttons" 'without Yes/No buttons'
copy "$P/good" "$P/press-approved-other"
rows "$P/press-approved-other/approvals-c-press.json" approved a1 "$PA" approved b1 "$PB1" approved b2 "$PB2" approved c1 "$PC"
refuses 'a press that approved another step too' plain-yes "$P/press-approved-other" 'changed the car inspection step'
copy "$P/good" "$P/no-not-rejected"
rows "$P/no-not-rejected/approvals-d-no.json" approved a1 "$PA" approved b1 "$PB1" approved b2 "$PB2" pending c1 "$PC"
refuses 'a No that rejected nothing' plain-yes "$P/no-not-rejected" 'did not reject it'
copy "$P/good" "$P/yes-with-nothing-waiting"
rows "$P/yes-with-nothing-waiting/approvals-d.json" approved a1 "$PA" approved b1 "$PB1" approved b2 "$PB2" approved c1 "$PC"
refuses 'a yes with nothing waiting that approved something' plain-yes "$P/yes-with-nothing-waiting" 'changed the status of a step'
copy "$P/good" "$P/typed-code"
run_json "$P/typed-code" "$(msg a 'Done.')" "$(msg b 'The food log, or the gym membership? Reply approve 59f1d506')" \
  "$(msg b-ask 'Cancel the gym membership?' true "$YN")" "$(msg c-ask 'Book the inspection?' true "$YN")" "$(msg d 'ok')"
refuses 'a question that asks for a code' plain-yes "$P/typed-code" 'holds a code'

# ------------------------------------------------------------------------------- what-was-that
WW_TEXT='Your notebook backup to GitHub did not run last night.'
WW_FACTS='["At 03:00 GitHub refused the sign-in this computer uses for the backup","Your notes are safe on this computer; the copy on GitHub is from the day before"]'
ww_good() { # <folder>
  local f=$1
  rm -rf "$f"
  mkdir -p "$f"
  run_json "$f" "$(msg report "$WW_TEXT")" "$(msg question 'That was about last night: the nightly backup of your notebook to GitHub stopped, because GitHub refused the sign-in.')"
  printf '%s\n' "$WW_FACTS" >"$f/report-facts.json"
  printf '{"data":[{"id":"m1","source_app":"background","content":%s,"report":{"facts":%s}}]}\n' \
    "$(node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$WW_TEXT")" "$WW_FACTS" >"$f/conversation_messages-report.json"
  fixture_json "$f/telegram-fixture.json"
}
section what-was-that
W=$TMP/ww
ww_good "$W/good"
passes 'a report recorded with its facts and explained afterwards' what-was-that "$W/good" 'was answered with the backup and GitHub'
copy "$W/good" "$W/not-recorded"
printf '{"data":[]}\n' >"$W/not-recorded/conversation_messages-report.json"
refuses 'a report that was not recorded in the chat' what-was-that "$W/not-recorded" 'not recorded where the chat reads it'
copy "$W/good" "$W/other-words"
printf '{"data":[{"id":"m1","source_app":"background","content":"Something else was said","report":{"facts":%s}}]}\n' "$WW_FACTS" >"$W/other-words/conversation_messages-report.json"
refuses 'a record with other words than were sent' what-was-that "$W/other-words" 'not recorded where the chat reads it'
copy "$W/good" "$W/facts-differ"
printf '["Something else"]\n' >"$W/facts-differ/report-facts.json"
refuses 'recorded facts that differ' what-was-that "$W/facts-differ" 'does not carry the facts'
copy "$W/good" "$W/not-sent"
run_json "$W/not-sent" "$(msg question 'It was about the backup to GitHub.')"
refuses 'a routine that sent no report' what-was-that "$W/not-sent" 'did not send exactly one message'
copy "$W/good" "$W/vague-answer"
run_json "$W/vague-answer" "$(msg report "$WW_TEXT")" "$(msg question 'I am not sure what you mean.')"
refuses 'an answer that does not name the subject' what-was-that "$W/vague-answer" 'did not name what the report was about'
copy "$W/good" "$W/no-answer"
run_json "$W/no-answer" "$(msg report "$WW_TEXT")"
refuses 'a question that got no answer' what-was-that "$W/no-answer" 'got no answer'

# ---------------------------------------------------------------------------- connection-check
cc_good() { # <folder>
  local f=$1 label
  rm -rf "$f"
  mkdir -p "$f"
  run_json "$f" "$(msg broken 'Telegram refused your bot key, so I cannot reach you there. Open Settings to connect it again.')"
  printf '[{"id":"r1","name":"Daily connection check"}]\n' >"$f/routines.json"
  printf '[]\n' >"$f/due-before.json"
  printf '{"data":[]}\n' >"$f/notifications-before.json"
  for label in fine; do printf '[]\n' >"$f/due-$label.json"; printf '{"data":[]}\n' >"$f/notifications-$label.json"; done
  printf '[{"slug":"telegram-key","title":"Connect Telegram again","state":"open"}]\n' >"$f/due-broken.json"
  printf '{"data":[{"id":"n1","kind":"connection-telegram","body":"Telegram refused your bot key, so I cannot reach you there. Open Settings to connect it again."}]}\n' >"$f/notifications-broken.json"
  printf '[{"slug":"telegram-key","title":"Connect Telegram again","state":"closed"}]\n' >"$f/due-repaired.json"
  printf '{"data":[]}\n' >"$f/notifications-repaired.json"
  printf 'getMe valid\ngetMe invalid\ngetMe valid\n' >"$f/telegram-fixture-calls.log"
}
section connection-check
C=$TMP/cc
cc_good "$C/good"
passes 'silent while fine, one message and one deadline when broken, closed when repaired' connection-check "$C/good" 'told the owner once'
copy "$C/good" "$C/no-routine"
printf '[{"id":"r1","name":"Journal check-ins"}]\n' >"$C/no-routine/routines.json"
refuses 'an install with no Daily connection check' connection-check "$C/no-routine" 'has no Daily connection check'
copy "$C/good" "$C/never-reached"
printf 'getMe valid\n' >"$C/never-reached/telegram-fixture-calls.log"
refuses 'a check that never reached the stand-in' connection-check "$C/never-reached" 'never asked the stand-in'
copy "$C/good" "$C/speaks-when-fine"
run_json "$C/speaks-when-fine" "$(msg fine 'All is well.')" "$(msg broken 'Telegram refused your bot key.')"
refuses 'a message although everything is fine' connection-check "$C/speaks-when-fine" 'although everything was fine'
copy "$C/good" "$C/deadline-when-fine"
printf '[{"slug":"x","title":"Something","state":"open"}]\n' >"$C/deadline-when-fine/due-fine.json"
refuses 'a deadline although everything is fine' connection-check "$C/deadline-when-fine" 'opened a deadline although'
copy "$C/good" "$C/bell-when-fine"
printf '{"data":[{"id":"n9","kind":"connection-telegram","body":"x"}]}\n' >"$C/bell-when-fine/notifications-fine.json"
printf '{"data":[{"id":"n9","kind":"connection-telegram","body":"x"}]}\n' >"$C/bell-when-fine/notifications-broken.json"
refuses 'a connection record in the bell although everything is fine' connection-check "$C/bell-when-fine" 'connection record in the bell'
copy "$C/good" "$C/two-texts"
run_json "$C/two-texts" "$(msg broken 'Telegram refused your bot key.')"
refuses 'two different texts when broken' connection-check "$C/two-texts" 'in 2 different texts'
copy "$C/good" "$C/silent-when-broken"
run_json "$C/silent-when-broken"
printf '{"data":[]}\n' >"$C/silent-when-broken/notifications-broken.json"
refuses 'no word at all when broken' connection-check "$C/silent-when-broken" 'in 0 different texts'
copy "$C/good" "$C/no-deadline"
printf '[]\n' >"$C/no-deadline/due-broken.json"
refuses 'no deadline when broken' connection-check "$C/no-deadline" 'opened 0 deadlines'
copy "$C/good" "$C/two-deadlines"
printf '[{"slug":"a","title":"Connect Telegram again","state":"open"},{"slug":"b","title":"Telegram again","state":"open"}]\n' >"$C/two-deadlines/due-broken.json"
refuses 'two deadlines when broken' connection-check "$C/two-deadlines" 'opened 2 deadlines'
copy "$C/good" "$C/still-open"
printf '[{"slug":"telegram-key","title":"Connect Telegram again","state":"open"}]\n' >"$C/still-open/due-repaired.json"
copy "$C/good" "$C/deleted"
printf '[]\n' >"$C/deleted/due-repaired.json"
refuses 'a deadline deleted instead of closed' connection-check "$C/deleted" 'absent, not closed'
copy "$C/good" "$C/decoy-closed"
printf '[{"slug":"the-open-deadline","title":"Connect Telegram again","state":"open"},{"slug":"the-decoy","title":"Telegram old","state":"closed"}]\n' >"$C/decoy-closed/due-broken.json"
printf '[{"slug":"the-open-deadline","title":"Connect Telegram again","state":"open"},{"slug":"the-decoy","title":"Telegram old","state":"closed"}]\n' >"$C/decoy-closed/due-repaired.json"
refuses 'another closed Telegram deadline standing in for the open one' connection-check "$C/decoy-closed" 'not closed, after'
refuses 'a deadline still open after the key is valid again' connection-check "$C/still-open" 'not closed, after'

# ============================================== the five scenarios of 2.0.0-beta.18 (numbers come in)
# Each is judged on made-up folders only: one that should pass, and one per failure that is easy to
# make by a plausible edit of the product or of the scenario.
section 'phone-health-days'
P=$TMP/phone
phone_good() { # <folder>
  rm -rf "$1"; mkdir -p "$1"
  node -e '
const rows=[["2026-11-03","steps",6500],["2026-11-04","steps",40],["2026-11-03","food_kcal",1000],["2026-11-03","active_kcal",300],["2026-11-03","weight_kg",69.5],
["2026-11-04","sleep_total_h",7.5],["2026-11-04","sleep_in_bed_h",8],["2026-11-04","sleep_deep_h",1.5],["2026-11-04","sleep_rem_h",1.75],["2026-11-04","sleep_start","23:10"],["2026-11-04","sleep_end","06:45"],
["2026-11-03","run_km",5.5],["2026-11-03","run_min",33],["2026-11-03","walk_km",3],["2026-11-03","walk_min",30],["2026-11-03","workout_min",45],["2026-11-03","workout_types","Traditional Strength Training"]]
 .map(([d,m,v],i)=>({id:"r"+i,observed_on:d,metric:m,value:v,source:"Health Auto Export"}));
const fs=require("fs");for(const f of ["server-days","second-days","before-wrong","after-wrong"])fs.writeFileSync(process.argv[1]+"/"+f+".json",JSON.stringify(rows));' "$1"
  printf 'u1 200\nu2 200\nu3 200\nu3-again 200\n' >"$1/uploads.txt"
  printf 'wrong 404\nmissing 404\n' >"$1/wrong-token.txt"
  printf 'abc  /opt/data/ingest/2026-11-04.jsonl\n' | tee "$1/raw-before.txt" >"$1/raw-after.txt"
}
phone_good "$P/good"
passes 'exact day records, a second notebook that agrees, a wrong token that stored nothing' phone-health-days "$P/good" 'a wrong or missing token answered 404 and stored nothing'
copy "$P/good" "$P/tripled"; sed -i 's/6500/19500/' "$P/tripled/server-days.json"
refuses 'steps counted once per copy' phone-health-days "$P/tripled" 'steps on 2026-11-03 is 19500, not 6500'
copy "$P/good" "$P/ok-token"; printf 'wrong 200\nmissing 404\n' >"$P/ok-token/wrong-token.txt"
refuses 'a wrong token that was taken' phone-health-days "$P/ok-token" 'a wrong token was not answered 404'
copy "$P/good" "$P/stored"; printf 'zzz  /opt/data/ingest/2026-11-04.jsonl\n' >"$P/stored/raw-after.txt"
refuses 'a wrong token that wrote a file' phone-health-days "$P/stored" 'wrote or changed a file'
copy "$P/good" "$P/unsynced"; sed -i 's/"walk_km"/"walk_kmx"/' "$P/unsynced/second-days.json"
refuses 'a second notebook that does not show the same days' phone-health-days "$P/unsynced" 'differ from the server'
copy "$P/good" "$P/last"; sed -i 's/69.5/70/' "$P/last/server-days.json"
refuses 'a weight that is not the last of the day' phone-health-days "$P/last" 'weight_kg on 2026-11-03 is 70'

section 'incomplete-day'
I=$TMP/incomplete
incomplete_good() {
  rm -rf "$1"; mkdir -p "$1"
  printf '{"data":{"metrics":[{"name":"step_count","data":[{"date":"2026-11-03 19:55:00 +0100","qty":500}]}]}}\n' >"$1/upload.json"
  printf '200\n' >"$1/upload-code.txt"
  printf 'Your data for yesterday stopped at 19:55, so I cannot say how the day ended.\nProtein days this week: 3 of 6 known, yesterday unknown.\n' >"$1/brief-1.txt"
  printf 'Protein days this week: 4 of 7; yesterday you gave 118 g.\n' >"$1/brief-2.txt"
  printf '{"ok":true}\n' >"$1/given.txt"
}
incomplete_good "$I/good"
passes 'a day stopped at 19:55 briefed so, and counted once a protein number is given' incomplete-day "$I/good" 'counted it'
copy "$I/good" "$I/no-time"; sed -i 's/19:55/the evening/' "$I/no-time/brief-1.txt"
refuses 'a briefing that never says when the data stopped' incomplete-day "$I/no-time" 'never says the data stopped at 19:55'
copy "$I/good" "$I/short"; printf 'Yesterday was a short day at 19:55.\nProtein: unknown.\n' >"$I/short/brief-1.txt"
refuses 'a briefing that calls the day short' incomplete-day "$I/short" 'called the unfinished day short'
copy "$I/good" "$I/counted"; printf 'Data stopped at 19:55.\nProtein days this week: 3 of 7.\n' >"$I/counted/brief-1.txt"
refuses 'a day counted although it is unfinished' incomplete-day "$I/counted" 'as unknown'
copy "$I/good" "$I/still"; printf 'Protein: yesterday still unknown, 118 g never counted.\n' >"$I/still/brief-2.txt"
refuses 'a number given by hand that is not counted' incomplete-day "$I/still" 'still shows the day as unknown'

section 'phone-goes-quiet'
Q=$TMP/quiet
quiet_good() {
  rm -rf "$1"; mkdir -p "$1"
  printf 'first 200\nafter 200\n' >"$1/upload-code.txt"
  printf '2026-11-03T08:00:00Z\n' >"$1/last-upload.txt"
  printf '2026-11-04T21:00:00Z\n' >"$1/now-moved.txt"
  printf '[]\n' | tee "$1/deadlines-before.json" "$1/bell-before.json" >/dev/null
  printf '[{"slug":"phone-quiet","title":"Your phone has not sent health data for 37 hours","status":"open"}]\n' | tee "$1/deadlines-first.json" "$1/deadlines-second.json" >/dev/null
  printf '[{"slug":"phone-quiet","title":"Your phone has not sent health data for 37 hours","status":"closed"}]\n' >"$1/deadlines-upload.json"
  printf '[{"id":"b1","title":"Your phone stopped sending health data"}]\n' | tee "$1/bell-first.json" "$1/bell-second.json" >/dev/null
}
quiet_good "$Q/good"
passes 'one message and one deadline, none more on a second run, closed by an upload' phone-goes-quiet "$Q/good" 'an upload closed the deadline'
copy "$Q/good" "$Q/twice"; printf '[{"id":"b1","title":"Your phone stopped sending health data"},{"id":"b2","title":"phone again"}]\n' >"$Q/twice/bell-second.json"
refuses 'a second message on a second run' phone-goes-quiet "$Q/twice" 'more messages about the phone'
copy "$Q/good" "$Q/silent"; printf '[]\n' >"$Q/silent/bell-first.json"; cp "$Q/silent/bell-first.json" "$Q/silent/bell-second.json"
refuses 'no message after 37 hours' phone-goes-quiet "$Q/silent" 'not one'
copy "$Q/good" "$Q/open"; sed -i 's/closed/open/' "$Q/open/deadlines-upload.json"
refuses 'a deadline that an upload leaves open' phone-goes-quiet "$Q/open" 'not closed'
copy "$Q/good" "$Q/early"; printf '2026-11-04T20:00:00Z\n' >"$Q/early/now-moved.txt"
refuses 'a clock moved less than 37 hours' phone-goes-quiet "$Q/early" 'less than 37 hours'

section 'mail-count'
M=$TMP/mail
mail_good() {
  rm -rf "$1"; mkdir -p "$1"
  printf 'MAILCOUNT-MARKER-abc\n' >"$1/marker.txt"
  printf 'Count new orders\t\n' >"$1/routine.txt"
  printf '["CAPABILITY","UID SEARCH FROM shop"]\n' | tee "$1/commands-connected.json" "$1/commands-norule.json" >/dev/null
  printf '["CAPABILITY","UID SEARCH FROM shop","UID FETCH 101 (ENVELOPE)","UID FETCH 102 (ENVELOPE BODY.PEEK[HEADER.FIELDS (MESSAGE-ID)])"]\n' >"$1/commands-final.json"
  printf 'That would count 3 mails from shop in the last 30 days. Save it?\n' >"$1/reply-1.txt"
  printf 'Saved.\n' >"$1/reply-2.txt"
  printf '[{"id":"i1","note":"scenario-1@example.invalid"},{"id":"i2","note":"scenario-2@example.invalid"},{"id":"i3","note":"scenario-3@example.invalid"}]\n' | tee "$1/items-1.json" "$1/items-2.json" >/dev/null
  : >"$1/marker-hits.txt"
}
mail_good "$M/good"
passes 'exactly the orders, once each, headers only, no marker, no call without a rule' mail-count "$M/good" 'counted exactly the 3 orders once each'
copy "$M/good" "$M/body"; printf '["UID FETCH 101 (BODY.PEEK[TEXT])"]\n' >"$M/body/commands-final.json"
refuses 'a body fetched' mail-count "$M/body" "asked the mailbox for a mail's body"
copy "$M/good" "$M/call"; printf '["CAPABILITY","UID SEARCH ALL"]\n' >"$M/call/commands-norule.json"
refuses 'a mail call with no rule' mail-count "$M/call" 'no tracker has a mail rule'
copy "$M/good" "$M/extra"; printf '[{"id":"i1","n":"scenario-1@example.invalid"},{"id":"i2","n":"scenario-2@example.invalid"},{"id":"i3","n":"scenario-3@example.invalid"},{"id":"i4","n":"scenario-6@example.invalid"}]\n' >"$M/extra/items-1.json"
refuses 'an application reply counted' mail-count "$M/extra" 'is not an order from'
copy "$M/good" "$M/again"; printf '[{"id":"i1","n":"scenario-1@example.invalid"},{"id":"i2","n":"scenario-2@example.invalid"},{"id":"i3","n":"scenario-3@example.invalid"},{"id":"i9","n":"scenario-3@example.invalid"}]\n' >"$M/again/items-2.json"
refuses 'a second run that counts again' mail-count "$M/again" 'a second run of the routine changed the count'
copy "$M/good" "$M/leak"; printf '/home/x/godspeed-v2/logs/a.log\n' >"$M/leak/marker-hits.txt"
refuses 'the marker in a log' mail-count "$M/leak" 'the marker that every mail body carries'

# the mailbox itself, read over IMAP from the stand-in the way the scenario fills it
FX=$(node -e '
const net = require("net"), F = require(process.argv[1] + "/tools/test-mc-mail-imap-fixture.js"), { mails } = require(process.argv[1] + "/scenarios/mail-fixture.cjs");
(async () => {
  const f = await F.start();
  f.boxes.INBOX.messages = mails("FIXTURE-MARKER-xyz");
  const sock = net.connect(f.port, "127.0.0.1"); let buf = "";
  sock.on("data", d => { buf += d; });
  const send = async (c, tag) => { sock.write(tag + " " + c + "\r\n"); for (let i = 0; i < 100 && !buf.includes("\r\n" + tag + " OK") && !buf.includes(tag + " OK"); i++) await new Promise(r => setTimeout(r, 20)); };
  await new Promise(r => setTimeout(r, 100));
  await send("LOGIN " + F.USER + " " + F.PASSWORD, "a1"); await send("SELECT INBOX", "a2"); buf = "";
  await send("UID FETCH 1:* (BODY.PEEK[])", "a3");
  const subjects = [...buf.matchAll(/^Subject: (.*)\r$/gm)].map(m => m[1].split(".")[0]);
  const froms = [...buf.matchAll(/^From: .*<(.*)>\r$/gm)].map(m => m[1]);
  const marked = (buf.match(/FIXTURE-MARKER-xyz/g) || []).length;
  console.log(JSON.stringify({ n: subjects.length, orders: subjects.filter(s => /^new order #/i.test(s)).length,
    shopOther: froms.filter((a, i) => /^shop@/.test(a) && !/^new order/i.test(subjects[i])).length,
    replies: subjects.filter(s => /^Re: Your application/.test(s)).length, unrelated: subjects.filter(s => /Lunch|newsletter/.test(s)).length, marked }));
  sock.destroy(); await f.close(); process.exit(0);
})();' "$ROOT" 2>&1)
if [ "$FX" = '{"n":9,"orders":3,"shopOther":2,"replies":2,"unrelated":2,"marked":9}' ]; then
  ok "mail fixture: 3 orders, 2 same-sender non-orders, 2 application replies, 2 unrelated mails, the marker in all 9, read over IMAP"
else
  bad "mail fixture read over IMAP is not the expected population: $FX"
fi

section 'talk-on-talk-day'
T2=$TMP/talkday
talkday_good() {
  rm -rf "$1"; mkdir -p "$1"
  printf 'old=2026-11-03\nnew=2026-11-10\n' >"$1/days.txt"
  printf 'AREA: health\n\n## The opening\n\nGood evening. Tonight: your LDL result and one thing to try.\n' >"$1/prep-new.md"
  printf 'ready: the review passed\n' >"$1/check-new.txt"
  printf 'Good evening.\n' >"$1/opening-old.txt"
  printf 'Last Tuesday'"'"'s talk is still open; its points are in today'"'"'s. Good evening. Tonight: your LDL result and one thing to try.\n' >"$1/opening-new.txt"
  printf 'AREA: health\nSTATE: opened\n\n## The opening\n\nGood evening.\n' >"$1/talk-old.md"
  printf 'AREA: health\nSTATE: not-held\n\n## The opening\n\nGood evening.\n' >"$1/talk-old-after.md"
  printf 'AREA: health\n\n## The opening\n\nGood evening. Tonight: your LDL result and one thing to try.\n' >"$1/talk-new.md"
}
talkday_good "$T2/good"
passes 'today'"'"'s talk opened, last week'"'"'s named once and closed as not held' talk-on-talk-day "$T2/good" 'closed as not held'
copy "$T2/good" "$T2/continued"; : >"$T2/continued/talk-new.md"
refuses 'last week'"'"'s talk continued instead' talk-on-talk-day "$T2/continued" "opened no talk of 2026-11-10"
copy "$T2/good" "$T2/unnamed"; printf 'Good evening. Tonight: your LDL result and one thing to try.\n' >"$T2/unnamed/opening-new.txt"
refuses 'last week'"'"'s talk never named' talk-on-talk-day "$T2/unnamed" "never names last week's talk"
copy "$T2/good" "$T2/twice"; printf 'Last Tuesday was open, and on Tuesday 2026-11-03 it stayed so. Good evening. Tonight: your LDL result and one thing to try.\n' >"$T2/twice/opening-new.txt"
refuses 'last week'"'"'s talk named twice' talk-on-talk-day "$T2/twice" 'more than once'
copy "$T2/good" "$T2/held"; printf 'AREA: health\nSTATE: held\n\n## The opening\n\nGood evening.\n' >"$T2/held/talk-old.md"
refuses 'last week'"'"'s talk already held, not open' talk-on-talk-day "$T2/held" 'was not open and unanswered'
copy "$T2/good" "$T2/still-open"; cp "$T2/good/talk-old.md" "$T2/still-open/talk-old-after.md"
refuses 'last week'"'"'s talk left open' talk-on-talk-day "$T2/still-open" 'not closed as not held'
copy "$T2/good" "$T2/other-opening"; printf 'Last Tuesday'"'"'s talk is still open. Hello there.\n' >"$T2/other-opening/opening-new.txt"
refuses 'an opening that is not the preparation'"'"'s' talk-on-talk-day "$T2/other-opening" "did not open with the preparation's opening"

# ============================================================ every one of them, the same shape
section 'every script'
for file in scenario-lib.sh settings-on-install.sh night-tidy.sh voice.sh update-keeps-everything.sh \
  reminder-closed-elsewhere.sh reminders-move-keeps-everything.sh two-machines-move-at-once.sh \
  late-reminder-file.sh closed-offline-on-both.sh reminder-from-settings.sh \
  charm-challenge.sh no-video-skills-by-default.sh update-removes-only-unchanged-skills.sh \
  briefing-breaks-a-rule.sh telegram-language.sh brief-asked-in-chat.sh talk-prep-honest.sh \
  no-question-he-cannot-judge.sh plain-yes.sh what-was-that.sh connection-check.sh numbers-lib.sh phone-health-days.sh incomplete-day.sh \
  phone-goes-quiet.sh mail-count.sh talk-on-talk-day.sh test-scenarios.sh; do
  if bash -n "$ROOT/scenarios/$file" 2>/dev/null; then
    ok "bash reads scenarios/$file"
  else
    bad "bash cannot read scenarios/$file"
  fi
done
for scenario in settings-on-install night-tidy voice update-keeps-everything \
  reminder-closed-elsewhere reminders-move-keeps-everything two-machines-move-at-once \
  late-reminder-file closed-offline-on-both reminder-from-settings charm-challenge \
  no-video-skills-by-default update-removes-only-unchanged-skills briefing-breaks-a-rule telegram-language \
  brief-asked-in-chat talk-prep-honest no-question-he-cannot-judge plain-yes what-was-that connection-check \
  phone-health-days incomplete-day phone-goes-quiet mail-count talk-on-talk-day; do
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

# ================================================================ which stage a run proves
# stage-for-run.sh: a stage given is that stage; none given is this commit's own build.
section "stage-for-run.sh: which stage a run proves"
SFR="$ROOT/scenarios/stage-for-run.sh"
SFR_REPO="$TMP/sfr-repo"
mkdir -p "$SFR_REPO/third-party/addons"
git -C "$SFR_REPO" init -q
printf '#!/bin/sh\necho installer\n' >"$SFR_REPO/install-godspeed.sh"
printf '[{"name":"carried","carriedHere":true},{"name":"outside","commit":"%s"}]\n' "$(printf 'c%.0s' $(seq 40))" >"$SFR_REPO/third-party/addons/sources.json"
git -C "$SFR_REPO" add -A
git -C "$SFR_REPO" -c user.name=t -c user.email=t@t commit -q -m one
SFR_ONE=$(git -C "$SFR_REPO" rev-parse HEAD)
echo two >"$SFR_REPO/two"
git -C "$SFR_REPO" add -A
git -C "$SFR_REPO" -c user.name=t -c user.email=t@t commit -q -m two
SFR_TWO=$(git -C "$SFR_REPO" rev-parse HEAD)
mkdir -p "$TMP/sfr-public/beta"
cp "$ROOT/stage.json" "$TMP/sfr-public/beta/stage.json"
SFR_IMAGE=$(node "$ROOT/stage/stage.mjs" "$ROOT/stage.json" get serverEditions.server.image)
SFR_IMAGE=${SFR_IMAGE%%@*}
SFR_DA=sha256:$(printf 'a%.0s' $(seq 64))
SFR_DB=sha256:$(printf 'b%.0s' $(seq 64))
printf '%s:v2-sha-%s %s\n' "$SFR_IMAGE" "$SFR_TWO" "$SFR_DA" >"$TMP/sfr-images-two"
printf '%s:v2-sha-%s %s\n' "$SFR_IMAGE" "$SFR_ONE" "$SFR_DB" >"$TMP/sfr-images-one"
: >"$TMP/sfr-images-none"
GH_RAW_ADDR=https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control
sfr() { # <images file> <stage> <commit> <folder>
  GODSPEED_SCENARIO_REPO=$SFR_REPO GODSPEED_SCENARIO_PUBLIC_RAW=file:///no/such/place GODSPEED_SCENARIO_IMAGES=$1 \
    bash "$SFR" "$2" "$3" "$4" 2>"$TMP/sfr.err"
}
SFR_OUT=$(sfr "$TMP/sfr-images-none" candidate/2.0.0-beta.15 "$SFR_TWO" "$TMP/sfr-given"); SFR_CODE=$?
if [ "$SFR_CODE" = 0 ] && [ "$SFR_OUT" = "$(printf 'ref=candidate/2.0.0-beta.15\nraw=%s' "$GH_RAW_ADDR")" ] && [ ! -e "$TMP/sfr-given" ]; then
  ok "a stage given means that stage: GitHub's address, nothing made, nothing read"
else
  bad "a stage given means that stage (exit $SFR_CODE: $SFR_OUT)"
fi
sfr_night() { # <images file> <folder>
  SFR_OUT=$(GODSPEED_SCENARIO_REPO=$SFR_REPO GODSPEED_SCENARIO_PUBLIC_RAW=file://$TMP/sfr-public GODSPEED_SCENARIO_IMAGES=$1 \
    bash "$SFR" '' "$SFR_TWO" "$2" 2>"$TMP/sfr.err"); SFR_CODE=$?
}
sfr_night "$TMP/sfr-images-two" "$TMP/sfr-night"
SFR_S=$TMP/sfr-night/this-commit/stage.json
if [ "$SFR_CODE" = 0 ] && [ "$SFR_OUT" = "$(printf 'ref=this-commit\nraw=file://%s' "$TMP/sfr-night")" ] \
  && node "$ROOT/stage/stage.mjs" "$SFR_S" check && sh "$ROOT/stage/stage.sh" "$SFR_S" check \
  && [ "$(node "$ROOT/stage/stage.mjs" "$SFR_S" get productCommit)" = "$SFR_TWO" ] \
  && [ "$(node "$ROOT/stage/stage.mjs" "$SFR_S" get serverEditions.server.image)" = "$SFR_IMAGE@$SFR_DA" ] \
  && [ "$(node "$ROOT/stage/stage.mjs" "$SFR_S" get addons.carried)" = "$SFR_TWO" ] \
  && [ "$(node "$ROOT/stage/stage.mjs" "$SFR_S" get kitBootstrap.unixEngineCommit)" = "$(node "$ROOT/stage/stage.mjs" "$ROOT/stage.json" get kitBootstrap.unixEngineCommit)" ] \
  && [ -f "$TMP/sfr-night/this-commit/two" ] && [ -f "$TMP/sfr-night/beta/stage.json" ]; then
  ok "no stage means this commit's own build: its commit, its image, its add-on pins, the public kit-bootstrap, its files"
else
  bad "no stage means this commit's own build (exit $SFR_CODE: $SFR_OUT; $(cat "$TMP/sfr.err"))"
fi
sfr_night "$TMP/sfr-images-one" "$TMP/sfr-night2"
if [ "$SFR_CODE" = 0 ] && [ "$(node "$ROOT/stage/stage.mjs" "$TMP/sfr-night2/this-commit/stage.json" get serverEditions.server.image)" = "$SFR_IMAGE@$SFR_DB" ] \
  && grep -qF "${SFR_ONE:0:7}" "$TMP/sfr.err"; then
  ok "a commit with no image of its own gets the newest ancestor's, and says whose"
else
  bad "a commit with no image of its own (exit $SFR_CODE: $(cat "$TMP/sfr.err"))"
fi
sfr_night "$TMP/sfr-images-none" "$TMP/sfr-night3"
if [ "$SFR_CODE" != 0 ]; then ok "no image within reach fails"; else bad "no image within reach succeeded"; fi
bash "$SFR" '' notacommit "$TMP/sfr-night4" >/dev/null 2>&1
if [ $? = 2 ]; then ok "a commit that is not one prints the usage (exit 2)"; else bad "a bad commit was not refused with exit 2"; fi

# install_the_line_of_into: the stage's own ref is read from the stage's address (a folder on a
# night), any other version from GitHub, because the folder holds only this commit and beta.
mkdir -p "$TMP/sfr-bin"
cat >"$TMP/sfr-bin/curl" <<'STUB'
#!/bin/sh
for a in "$@"; do case $a in *install-godspeed.sh) echo "$a" >>"$SFR_ASKED" ;; esac; done
echo true
STUB
chmod +x "$TMP/sfr-bin/curl"
: >"$TMP/sfr-asked"
PATH="$TMP/sfr-bin:$PATH" SFR_ASKED=$TMP/sfr-asked SCENARIO=sfr-test GODSPEED_SCENARIO_RAW=file:///the/folder bash -c '
  . "$1/scenarios/scenario-lib.sh"; STAGE_REF=this-commit
  install_the_line_of_into this-commit /r1 47831 /dev/null
  install_the_line_of_into candidate/2.0.0-beta.11 /r2 47832 /dev/null' _ "$ROOT" >/dev/null 2>&1
if [ "$(cat "$TMP/sfr-asked")" = "$(printf 'file:///the/folder/this-commit/install-godspeed.sh\n%s/candidate/2.0.0-beta.11/install-godspeed.sh' "$GH_RAW_ADDR")" ]; then
  ok "another version's line reads GitHub, the stage's own line reads the stage's address"
else
  bad "install_the_line_of_into read: $(cat "$TMP/sfr-asked")"
fi

# ================================================================ the night's report
# report-night.mjs opens, comments on and closes the issues of a failed night; its own tests stand a
# fake GitHub in for the real one.
section "report-night.mjs: the night's issues"
if node --test "$ROOT/scenarios/test-report-night.mjs" >"$TMP/report-night.log" 2>&1; then
  ok "report-night.mjs: its node --test cases pass"
else
  cat "$TMP/report-night.log"
  bad "report-night.mjs: its node --test cases fail"
fi

printf '\n%s of %s pass.\n' "$PASS" "$((PASS + FAIL))"
[ "$FAIL" -eq 0 ]
