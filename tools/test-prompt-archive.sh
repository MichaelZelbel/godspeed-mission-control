#!/usr/bin/env bash
# The prompt collector: what must never reach a repository, and what must never be missed.
#
# WHY THIS FILE IS HERE AND NOT IN A GODSPEED. The two programs in tools/ are what the book means
# by "a program fills it". They used to live in one person's private godspeed, and so did their
# tests. Since 2026-08-10 there is one copy of each, here, in the kit that readers install
# from, so the tests live beside the thing they test.
#
# TWO RISKS NOTHING ELSE IN THE KIT HAS. The collector WRITES, and what it writes comes from
# outside: years of conversation logs.
#
#   1. A secret written into a repository. Conversation logs are the one place a pasted key or
#      a client's name turns up by accident, and a repository is forever. Checks 11 to 14 are
#      that, and check 13 matters most: a line that still looks like a credential after
#      scrubbing must be DROPPED, never half-cleaned. Losing one prompt costs nothing.
#   2. A source that quietly reaches none of the drawer. Checks 24 to 28 are that.
#
# Usage: bash tools/test-prompt-archive.sh
set -u
. "$(dirname "$0")/test-guard.bash"
HERE="$(cd "$(dirname "$0")" && pwd)"
ARC="$HERE/mc-prompt-archive"
PY_BIN="${PYTHON:-python3}"; command -v "$PY_BIN" >/dev/null 2>&1 || PY_BIN=python
PY="$PY_BIN"
PASS=0; FAIL=0
ok()  { echo "  ok   $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL $1"; FAIL=$((FAIL+1)); [ -n "${2:-}" ] && echo "       $2"; }

# The fixture godspeed is built the way the mission control this kit INSTALLS is built: observations/, and no
# memory/. It made a memory/ until 2026-08-29, which is why this suite stayed green through the
# eight days both tools were unable to find a real godspeed at all (see the note in prompt-harvest.js).
# A fixture that is kinder than the world is a fixture that cannot fail.
# The fixture lives OUTSIDE the kit (2026-10-09). The harvest runs git in the folder it is given,
# and with the fixture inside the kit's own checkout it reached that checkout instead: it pulled
# and left a rebase of the branch half done.
W="$(mktemp -d)/archive-test"; mkdir -p "$W/observations" "$W/home"
trap 'rm -rf "$(dirname "$W")" "$TEST_GUARD_HOME"' EXIT
# Point the bot reader at nothing, for every case that is not about it. On a machine that runs
# bots this suite would otherwise find the REAL ones and archive real chats into a throwaway
# folder. Cases 24 onward set this to their own fixture. A test that reads live data is not a
# test.
export GODSPEED_HERMES_HOME="$W/no-hermes"

echo "== the prompt archive: what must never reach the repository =="

mkdir -p "$W/home/.claude/projects/proj" "$W/home/.godspeed"
J="$W/home/.claude/projects/proj/s.jsonl"
w() { printf '%s\n' "$1" >> "$J"; }
w '{"type":"user","timestamp":"2026-07-01T10:00:00Z","message":{"content":"Rewrite the landing page headline, shorter and less salesy."}}'
w '{"type":"user","timestamp":"2026-07-01T10:01:00Z","message":{"content":"here is the key sk-abcdefghijklmnop1234567890 use it"}}'
w '{"type":"user","timestamp":"2026-07-01T10:02:00Z","message":{"content":"token ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345"}}'
w '{"type":"user","timestamp":"2026-07-01T10:03:00Z","message":{"content":"mail me at someone@example.com about it"}}'
w '{"type":"user","timestamp":"2026-07-01T10:04:00Z","message":{"content":"The client is Umbrella Consolidated and they want a demo."}}'
w '{"type":"user","timestamp":"2026-07-01T10:05:00Z","message":{"content":[{"type":"tool_result","content":"total 48\ndrwxr-xr-x 1 x"}]}}'
w '{"type":"user","timestamp":"2026-07-01T10:06:00Z","message":{"content":"Authorization: Bearer aVeryLongLivedSecret0123456789abcdef"}}'
# A credential shape nothing above matches by name. The last-resort guard must DROP this
# whole line rather than store a partly-cleaned version of it.
w '{"type":"user","timestamp":"2026-07-01T10:07:00Z","message":{"content":"use this value Xq7ZmP2vLd8RtY4wNb1CfH6jGk3sVe9AuQ5oIrTzB0xM as the credential"}}'
printf 'Umbrella Consolidated\n' > "$W/home/.godspeed/redact.txt"

( export HOME="$W/home" GODSPEED_HOME="$W/home"; cd "$W" && "$PY" "$ARC" --godspeed "$W" archive ) >"$W/arc.out" 2>&1
A="$(cat "$W/prompts/archive/"*.jsonl 2>/dev/null)"

# 11. The ordinary prompt is kept. An archive that keeps nothing is safe and useless.
echo "$A" | grep -q "less salesy" && ok "11 an ordinary prompt is archived" || bad "11 nothing was archived" "$(cat "$W/arc.out")"

# 12. Key-shaped text never reaches the repo, in any of its shapes.
LEAK=""
for pat in 'sk-abcdefghijklmnop' 'ghp_ABCDEFGHIJKLMNOP' 'someone@example.com' 'aVeryLongLivedSecret'; do
  echo "$A" | grep -q "$pat" && LEAK="$LEAK $pat"
done
[ -z "$LEAK" ] && ok "12 no key, token, bearer or email survived into the repo" \
                || bad "12 A SECRET REACHED THE REPOSITORY:$LEAK"

# 13. Half-cleaning is the dangerous outcome, so a still-risky line is dropped whole.
grep -q "dropped" "$W/arc.out" && ok "13 a line that still looked like a credential was dropped, not patched" \
                              || bad "13 nothing was dropped, so the last-resort guard never fired" "$(cat "$W/arc.out")"

# 14. The name list is what protects his employer and clients, and it is kept OUTSIDE the repo.
echo "$A" | grep -qi "Umbrella Consolidated" && bad "14 a named party reached the repository" \
  || ok "14 a name from the local list was stripped"

# 15. A tool result is not a prompt. This is the 24,590 that made the archive look impossible.
echo "$A" | grep -q "drwxr-xr-x" && bad "15 a tool result was archived as if he had typed it" \
  || ok "15 tool results are not mistaken for prompts"

# 16. Harvesting again must add nothing, because this runs on a schedule.
B1=$(cat "$W/prompts/archive/"*.jsonl | wc -l)
( export HOME="$W/home" GODSPEED_HOME="$W/home"; cd "$W" && "$PY" "$ARC" --godspeed "$W" archive ) >/dev/null 2>&1
B2=$(cat "$W/prompts/archive/"*.jsonl | wc -l)
[ "$B1" = "$B2" ] && ok "16 harvesting twice adds nothing" || bad "16 the archive duplicated itself" "$B1 -> $B2"

# 17. Search has to find it, from any machine, or the whole archive is write-only.
( export HOME="$W/home" GODSPEED_HOME="$W/home"; "$PY" "$ARC" --godspeed "$W" search salesy ) 2>&1 | grep -q "less salesy" \
  && ok "17 search finds an archived prompt" || bad "17 search could not find what was archived"

# 18. A miss is a checked absence, said out loud, never silence.
( export HOME="$W/home" GODSPEED_HOME="$W/home"; "$PY" "$ARC" --godspeed "$W" search zzzznotpresent ) 2>&1 | grep -qi "checked absence" \
  && ok "18 a search miss says it is a checked absence" || bad "18 a miss said nothing useful"

# --- 19 to 21: what he types on his PHONE, and the drawer's own front door -------------
#
# WHY THESE THREE EXIST. On 2026-08-09 the Telegram drawer was empty and looked fine. The
# reader filtered on a "role" field; the live transcript on the server has no role field, it
# has {"dir": "in"|"out"}. So the filter matched nothing, on every line, for as long as it had
# existed: 155 prompts typed from a phone, skipped in silence. The path was
# compiled into the code, so no test could ever have reached it. It is an env var now, and
# these are the tests that were impossible before.
TG="$W/transcript.jsonl"
cat > "$TG" <<'EOF'
{"ts": "2026-08-01T09:00:00", "dir": "in", "text": "remind me to book the dentist tomorrow morning"}
{"ts": "2026-08-01T09:00:30", "dir": "out", "text": "the bot answering him about the dentist"}
{"ts": "2026-08-01T09:01:00", "role": "user", "text": "and add milk to the shopping list"}
EOF
( export HOME="$W/home" GODSPEED_HOME="$W/home" GODSPEED_TELEGRAM_TRANSCRIPT="$TG"; cd "$W" && "$PY" "$ARC" --godspeed "$W" archive ) >"$W/tg.out" 2>&1
T="$(cat "$W/prompts/archive/"*.jsonl 2>/dev/null)"

# 19. The shape the real file actually has. This is the bug itself, held shut.
echo "$T" | grep -q "book the dentist" && ok "19 a Telegram line marked dir:in is archived" \
  || bad "19 the Telegram transcript was skipped again" "$(cat "$W/tg.out")"

# 20. His side only AS PROMPTS. Since 2026-08-11 the bot's reply is kept, but only in the
#     "answer" field of the turn it followed - a drawer whose PROMPTS were our own words
#     would make every search return the answer instead of the question he asked.
echo "$T" | grep -q '"text": "the bot answering him' && bad "20 the bot's own reply was archived as a prompt" \
  || ok "20 the bot's side of the chat is never a prompt"
echo "$T" | grep '"text": "remind me to book the dentist' | grep -q '"answer": "the bot answering him' \
  && ok "20b the bot's reply rides as the answer of the turn it followed" \
  || bad "20b the reply was not kept as the turn's answer" "$T"

# 21. The other shape still works, so a future transcript format cannot silently drop his words.
echo "$T" | grep -q "add milk" && ok "21 a line marked role:user is still archived" \
  || bad "21 the role-shaped line stopped being read"

# 22. The drawer's own README explains the drawer to a human. It is not a prompt, and counting
#     it as one would put the explanation in every search result.
mkdir -p "$W/prompts/library"
saved_count() { ( export HOME="$W/home" GODSPEED_HOME="$W/home"; "$PY" "$ARC" --godspeed "$W" stats ) 2>&1 \
  | sed -n 's/^saved prompts *\([0-9]*\).*/\1/p'; }
S1=$(saved_count)
printf '# The shelf\n\nAn explanation, not a prompt. It mentions salesy on purpose.\n' > "$W/prompts/library/README.md"
S2=$(saved_count)
[ -n "$S1" ] && [ "$S1" = "$S2" ] && ok "22 a drawer README is not counted as a saved prompt" \
  || bad "22 the README was counted as a prompt" "before=$S1 after=$S2"

# 22b. And it must not turn up as a search hit either, or the explanation of the drawer starts
#      answering questions about its contents.
( export HOME="$W/home" GODSPEED_HOME="$W/home"; "$PY" "$ARC" --godspeed "$W" search salesy ) 2>&1 | grep -q "README" \
  && bad "22b the drawer README came back as a search hit" \
  || ok "22b the drawer README is not a search hit"

# 23. Rescrub is what makes the name list useful, because a name is always added too late.
printf 'Umbrella Consolidated\n' > "$W/home/.godspeed/redact.txt" 2>/dev/null || { mkdir -p "$W/home/.godspeed"; printf 'Umbrella Consolidated\n' > "$W/home/.godspeed/redact.txt"; }
printf '{"id":"deadbeefdeadbeef","at":"2026-07-01T10:00:00","machine":"test","tool":"claude-code","project":"","text":"a note about Umbrella Consolidated and its billing"}\n' >> "$W/prompts/archive/test-2026-07.jsonl"
( export HOME="$W/home" GODSPEED_HOME="$W/home"; "$PY" "$ARC" --godspeed "$W" rescrub ) >"$W/rs.out" 2>&1
grep -qi "Umbrella Consolidated" "$W/prompts/archive/test-2026-07.jsonl" \
  && bad "23 rescrub left a named party in a prompt that was already stored" "$(cat "$W/rs.out")" \
  || ok "23 rescrub cleans a name out of what was already archived"

# --- 24 to 28: EVERY bot he talks to, not the one bot somebody plumbed ------------------
#
# WHY THESE FIVE EXIST. On 2026-08-10 the drawer held what he had typed to one bot, the mission control
# bot, and to none of the other eight running beside it on the same server. A company board's
# bot, a health advisor, three desks of another company: 281 prompts, thrown away,
# with every guard green, because the guards counted machines and the server was contributing.
# The cause was that the one bot was reached through a file a separate nightly job wrote for
# it, so covering a bot was a thing somebody had to remember to do, once per bot, for ever.
# The reader now goes to the store the bots write themselves. These cases hold that shut.
HH="$W/hermes"; mkdir -p "$HH/profiles/nova" "$HH/profiles/quiet-desk"
"$PY" - "$HH" <<'PYEOF'
import sqlite3, sys, os
hh = sys.argv[1]
def bot(name, rows):
    con = sqlite3.connect(os.path.join(hh, "profiles", name, "state.db"))
    con.execute("CREATE TABLE sessions (id TEXT, source TEXT)")
    con.execute("CREATE TABLE messages (session_id TEXT, role TEXT, content TEXT, timestamp REAL)")
    for sid, src in {(r[0], r[1]) for r in rows}:
        con.execute("INSERT INTO sessions VALUES (?,?)", (sid, src))
    for sid, _src, role, txt in rows:
        con.execute("INSERT INTO messages VALUES (?,?,?,?)", (sid, role, txt, 1785875150.0))
    con.commit(); con.close()

bot("nova", [
    ("s1", "telegram",   "user",      "what is the board deciding about the video script"),
    ("s1", "telegram",   "assistant", "Nova replying about the video script"),
    ("s1", "telegram",   "user",      "[Sam] and show me the actual script this time"),
    ("s1", "telegram",   "user",      "[WORK ORDER from the company - this is NOT a message from the founder.] do the thing"),
    ("s2", "api_server", "user",      "You are board desk, an AI agent employee in a company"),
])
bot("quiet-desk", [
    ("s3", "telegram",   "user",      "a prompt typed to a desk nobody ever plumbed"),
])
PYEOF

( export HOME="$W/home" GODSPEED_HOME="$W/home" GODSPEED_HERMES_HOME="$HH" GODSPEED_TELEGRAM_TRANSCRIPT="$W/none.jsonl"
  cd "$W" && "$PY" "$ARC" --godspeed "$W" archive ) >"$W/bots.out" 2>&1
B="$(cat "$W/prompts/archive/"*.jsonl 2>/dev/null)"

# 24. The bug itself: a bot with no file of its own is read anyway.
echo "$B" | grep -q "what is the board deciding" \
  && ok "24 what you typed to a bot with no transcript file is archived" \
  || bad "24 a bot's chat was skipped again" "$(cat "$W/bots.out")"

# 25. And it says WHICH bot, because "telegram" alone cannot answer "what did I ask Nova".
echo "$B" | grep -q '"project": *"nova"' \
  && ok "25 the archived prompt names the bot you said it to" \
  || bad "25 the bot's name was not recorded"

# 26. A courier work order wears his role in the same table. It is our own machinery talking,
#     and archiving it would make every search return our words instead of his.
echo "$B" | grep -q "WORK ORDER" && bad "26 a work order from our own machinery was archived as his prompt" \
  || ok "26 a message our machinery injected is not archived"

# 27. The bot's reply is never a PROMPT, and the sessions where the mission control gives the bot work
#     stay out entirely - their "user" turns are a program talking, and so are their replies.
if echo "$B" | grep -q '"text": "Nova replying' || echo "$B" | grep -q "You are board desk"; then
  bad "27 the bot's replies or its work sessions were archived as prompts"
else
  ok "27 only his side of a real chat becomes a prompt"
fi
echo "$B" | grep '"text": "what is the board deciding' | grep -q "Nova replying about the video script" \
  && ok "27b the bot's reply is kept as the answer of his question" \
  || bad "27b the reply was not attached as the answer"

# 28. The guard that would have caught all of this: a source with prompts in it and none of
#     them archived must FAIL, by name. Counting machines could never see this.
rm -f "$W/prompts/archive/"*.jsonl
( export HOME="$W/home" GODSPEED_HOME="$W/home" GODSPEED_HERMES_HOME="$HH" GODSPEED_TELEGRAM_TRANSCRIPT="$W/none.jsonl"
  "$PY" "$ARC" --godspeed "$W" sources ) >"$W/src.out" 2>&1
SRC_RC=$?
[ "$SRC_RC" -ne 0 ] && grep -q "hermes/nova" "$W/src.out" \
  && ok "28 sources fails and names the bot whose prompts reach none of the archive" \
  || bad "28 an entirely unarchived source was reported as healthy" "rc=$SRC_RC $(cat "$W/src.out")"

# --- 29 to 31: the person's choice of OLDER chats is obeyed ------------------------------
#
# WHY THESE EXIST. Until 2026-08-11 this collector read every source it knew, on every
# machine, with nothing anywhere asking the person. The installer then recorded a choice as
# GODSPEED_PROMPT_SOURCES (environment, or ~/.godspeed/device.env for a scheduled run). Since
# 2026-10-12 that choice is about one thing only: whether a tool's chats from BEFORE this
# computer began saving are brought in. New chats are always saved (74 onward). A tool whose
# older chats stay out must keep them out, and that must read as the person's choice, never
# as a leak. The fixtures below are dated July and August 2026, long before any start time a
# run here records, so they are "older chats".

# 29. Codex logs exist on the machine, but only claude is enabled.
mkdir -p "$W/home/.codex/sessions"
printf '{"timestamp":"2026-08-02T10:00:00Z","payload":{"role":"user","content":"a codex prompt that must stay out"}}\n' \
  > "$W/home/.codex/sessions/s.jsonl"
rm -f "$W/prompts/archive/"*.jsonl
( export HOME="$W/home" GODSPEED_HOME="$W/home" GODSPEED_PROMPT_SOURCES="claude"
  cd "$W" && "$PY" "$ARC" --godspeed "$W" archive ) >"$W/pick.out" 2>&1
P="$(cat "$W/prompts/archive/"*.jsonl 2>/dev/null)"
echo "$P" | grep -q "stay out" && bad "29 a switched-off source was read anyway" \
  || ok "29 a source switched off is not read at all"
echo "$P" | grep -q "less salesy" && ok "29b the source that stayed on is still read" \
  || bad "29b switching one source off silenced another" "$(cat "$W/pick.out")"
grep -q "not brought in, by your choice: codex, hermes, opencode (new ones are saved)" "$W/pick.out" \
  && ok "29c the harvest says which older chats it left out, and that new ones are saved" \
  || bad "29c the restriction happened in silence" "$(cat "$W/pick.out")"

# 30. `sources` treats off as a decision: exit 0, and the off list is printed so the
#     morning selftest reads silence as a choice instead of alarming on it.
( export HOME="$W/home" GODSPEED_HOME="$W/home" GODSPEED_PROMPT_SOURCES="claude"
  "$PY" "$ARC" --godspeed "$W" sources ) >"$W/pick2.out" 2>&1
PICK_RC=$?
[ "$PICK_RC" -eq 0 ] && grep -q "older chats left out by your choice" "$W/pick2.out" \
  && ok "30 sources calls an off source a choice, not a leak" \
  || bad "30 an off source alarmed or went unmentioned" "rc=$PICK_RC $(cat "$W/pick2.out")"

# 31. The choice also arrives from ~/.godspeed/device.env, because the scheduled run that
#     does most harvesting starts with almost no environment.
#     The variable is taken OUT of this run first. On a computer whose owner has made the
#     choice for real, it is in the environment of whoever runs these tests, the environment
#     wins over the file, and this check failed there while the program was right.
printf 'GODSPEED_PROMPT_SOURCES=claude\n' >> "$W/home/.godspeed/device.env"
( unset GODSPEED_PROMPT_SOURCES
  export HOME="$W/home" GODSPEED_HOME="$W/home"
  cd "$W" && "$PY" "$ARC" --godspeed "$W" --dry-run archive ) >"$W/pick3.out" 2>&1
grep -q "not brought in, by your choice: codex, hermes, opencode" "$W/pick3.out" \
  && ok "31 the choice recorded on the device is obeyed with no environment" \
  || bad "31 device.env was ignored" "$(cat "$W/pick3.out")"

# --- 32 to 41: the ANSWER rides with the prompt -----------------------------------------
#
# WHY THESE EXIST. Since 2026-08-11 each row also keeps what the AI showed back, in an
# "answer" field, because half the time what a person half-remembers is the reply, not the
# prompt. The dangers are exact mirrors of the prompt-side ones: machinery (thinking, tool
# calls, tool output) leaking in as if the person saw it; a reply attached to the wrong
# question; a whole reply lost for one credential-shaped line; and a reply that arrived
# after the harvest staying lost for ever. Note: check 31 wrote GODSPEED_PROMPT_SOURCES=claude
# into the fixture device.env, so every run below says its sources out loud.

mkdir -p "$W/home/.claude/projects/pairproj"
J2="$W/home/.claude/projects/pairproj/s.jsonl"
w2() { printf '%s\n' "$1" >> "$J2"; }
w2 '{"type":"user","uuid":"u1","timestamp":"2026-07-02T10:00:00Z","message":{"content":"pair test question about the moon"}}'
w2 '{"type":"assistant","uuid":"a1","parentUuid":"u1","message":{"content":[{"type":"thinking","thinking":"hidden reasoning about a moonbase"}]}}'
w2 '{"type":"assistant","uuid":"a2","parentUuid":"a1","message":{"content":[{"type":"text","text":"first visible note about the moon"}]}}'
w2 '{"type":"assistant","uuid":"a3","parentUuid":"a2","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"echo mooncmd"}}]}}'
w2 '{"type":"user","uuid":"t1","parentUuid":"a3","message":{"content":[{"type":"tool_result","content":"mooncmd output line"}]}}'
w2 '{"type":"assistant","uuid":"a4","parentUuid":"t1","message":{"content":[{"type":"text","text":"final answer: the moon is threehundredthousand km away"}]}}'
w2 '{"type":"user","uuid":"u2","timestamp":"2026-07-02T10:05:00Z","message":{"content":"second question about tides"}}'
w2 '{"type":"assistant","uuid":"a5","parentUuid":"u2","message":{"content":[{"type":"text","text":"tides reply text"}]}}'
w2 '{"type":"user","uuid":"u3","timestamp":"2026-07-02T10:10:00Z","message":{"content":"third question about keys"}}'
w2 '{"type":"assistant","uuid":"a6","parentUuid":"u3","message":{"content":[{"type":"text","text":"here is your key sk-abcdefghijklmnop1234567890 keep it\nrisky line Xq7ZmP2vLd8RtY4wNb1CfH6jGk3sVe9AuQ5oIrTzB0xM sits here\nbut the prose survives"}]}}'
"$PY" - "$W/home/.claude/projects/capproj" <<'PYEOF'
import json, os, sys
d = sys.argv[1]; os.makedirs(d, exist_ok=True)
big = "many words of a very long reply " * 1000  # ~32,000 chars, over the cap
with open(os.path.join(d, "s.jsonl"), "w") as fh:
    fh.write(json.dumps({"type": "user", "uuid": "cu1", "timestamp": "2026-07-03T09:00:00Z",
                         "message": {"content": "cap test question"}}) + "\n")
    fh.write(json.dumps({"type": "assistant", "uuid": "ca1", "parentUuid": "cu1",
                         "message": {"content": [{"type": "text", "text": big}]}}) + "\n")
PYEOF
( export HOME="$W/home" GODSPEED_HOME="$W/home" GODSPEED_PROMPT_SOURCES="claude"
  cd "$W" && "$PY" "$ARC" --godspeed "$W" archive ) >"$W/ans.out" 2>&1
AN="$(cat "$W/prompts/archive/"*.jsonl 2>/dev/null)"

# 32. The answer holds every piece of text the person SAW during the turn, and nothing of
#     the machinery: no internal thinking, no tool call, no tool output.
ROW1="$(echo "$AN" | grep '"text": "pair test question')"
if echo "$ROW1" | grep -q "first visible note" && echo "$ROW1" | grep -q "threehundredthousand" \
   && ! echo "$AN" | grep -qE "hidden reasoning|mooncmd"; then
  ok "32 an answer keeps the visible text and none of the machinery"
else
  bad "32 the answer lost visible text or leaked machinery" "$ROW1"
fi

# 32b. Attribution: a reply belongs to ITS question. A reply glued onto the wrong prompt is
#      worse than a lost one, because search would present it as fact.
if echo "$ROW1" | grep -q "tides reply text"; then
  bad "32b the second turn's reply leaked into the first turn"
else
  echo "$AN" | grep '"text": "second question about tides' | grep -q "tides reply text" \
    && ok "32b each reply is attached to its own question" \
    || bad "32b the second turn's reply was not attached to it"
fi

# 33. A key inside an answer is redacted in place; the reply itself survives.
ROW3="$(echo "$AN" | grep '"text": "third question about keys')"
if echo "$ROW3" | grep -q "sk-abcdefghijklmnop"; then
  bad "33 A SECRET REACHED THE REPOSITORY inside an answer"
elif echo "$ROW3" | grep -q "key removed"; then
  ok "33 a key inside an answer is redacted, and the answer is kept"
else
  bad "33 the answer with the key vanished instead of being cleaned" "$ROW3"
fi

# 34. The last-resort guard drops only the credential-shaped LINE of an answer, never the
#     whole reply - while check 13 above proves a PROMPT is still dropped whole. Both rules,
#     side by side.
if echo "$ROW3" | grep -q "Xq7ZmP2vLd8RtY4wNb1C"; then
  bad "34 a credential-shaped line survived inside an answer"
elif echo "$ROW3" | grep -q "line removed: still looked like a credential" \
     && echo "$ROW3" | grep -q "but the prose survives"; then
  ok "34 a risky line is cut out alone and the rest of the answer stays"
else
  bad "34 the whole answer was lost for one risky line" "$ROW3"
fi

# 35. A reply longer than the cap is cut, and says so. An archive is for finding things
#     again, not for storing every file a reply ever pasted.
echo "$AN" | grep '"text": "cap test question' | grep -q "answer truncated by mc-prompt-archive" \
  && ok "35 an oversized answer is capped with a marker saying so" \
  || bad "35 an oversized answer was stored whole or lost"

# 36. Search finds a thing said only in an ANSWER, and marks which side matched, because
#     "what was that answer again" is the question this whole field exists for.
SRCH="$(export HOME="$W/home" GODSPEED_HOME="$W/home"; "$PY" "$ARC" --godspeed "$W" search threehundredthousand 2>&1)"
if echo "$SRCH" | grep -q "Q: pair test question" && echo "$SRCH" | grep -q "A: .*threehundredthousand"; then
  ok "36 search finds text that only ever appeared in a reply, marked A:"
else
  bad "36 a reply's content is invisible to search" "$SRCH"
fi

# 37. Backfill: a row archived before answers existed gets its answer from a transcript that
#     still exists - and running it AGAIN changes nothing, because it will run on machines
#     on a schedule of habit, not once under supervision.
mkdir -p "$W/home/.claude/projects/bfproj"
printf '%s\n%s\n' \
  '{"type":"user","uuid":"b1","timestamp":"2026-07-04T09:00:00Z","message":{"content":"backfill test question"}}' \
  '{"type":"assistant","uuid":"b2","parentUuid":"b1","message":{"content":[{"type":"text","text":"backfilled reply text"}]}}' \
  > "$W/home/.claude/projects/bfproj/s.jsonl"
"$PY" - "$W" <<'PYEOF'
import hashlib, json, os, sys
w = sys.argv[1]
rid = hashlib.sha256("claude-code|backfill test question".encode()).hexdigest()[:16]
with open(os.path.join(w, "prompts", "archive", "test-2026-07.jsonl"), "a", newline="\n") as fh:
    fh.write(json.dumps({"id": rid, "at": "2026-07-04T09:00:00", "machine": "test",
                         "tool": "claude-code", "project": "bfproj",
                         "text": "backfill test question"}) + "\n")
PYEOF
( export HOME="$W/home" GODSPEED_HOME="$W/home" GODSPEED_PROMPT_SOURCES="claude"
  cd "$W" && "$PY" "$ARC" --godspeed "$W" backfill ) >"$W/bf.out" 2>&1
grep '"text": "backfill test question' "$W/prompts/archive/test-2026-07.jsonl" | grep -q "backfilled reply text" \
  && ok "37 backfill attaches an answer to a row archived before answers existed" \
  || bad "37 backfill did not fill the old row" "$(cat "$W/bf.out")"
cat "$W/prompts/archive/"*.jsonl > "$W/snap1"
( export HOME="$W/home" GODSPEED_HOME="$W/home" GODSPEED_PROMPT_SOURCES="claude"
  cd "$W" && "$PY" "$ARC" --godspeed "$W" backfill ) >/dev/null 2>&1
cat "$W/prompts/archive/"*.jsonl > "$W/snap2"
cmp -s "$W/snap1" "$W/snap2" && ok "37b a second backfill changes nothing" \
  || bad "37b backfill is not idempotent"

# 38. The harvest heals itself: a prompt archived while its reply was still being written
#     must get that reply on the NEXT harvest, or the daily schedule guarantees the last
#     turn of every day stays answer-less for ever.
mkdir -p "$W/home/.claude/projects/healproj"
H2="$W/home/.claude/projects/healproj/s.jsonl"
printf '%s\n' '{"type":"user","uuid":"h1","timestamp":"2026-07-05T09:00:00Z","message":{"content":"self heal test question"}}' > "$H2"
( export HOME="$W/home" GODSPEED_HOME="$W/home" GODSPEED_PROMPT_SOURCES="claude"
  cd "$W" && "$PY" "$ARC" --godspeed "$W" archive ) >/dev/null 2>&1
C1=$(cat "$W/prompts/archive/"*.jsonl | wc -l)
printf '%s\n' '{"type":"assistant","uuid":"h2","parentUuid":"h1","message":{"content":[{"type":"text","text":"the late healed reply"}]}}' >> "$H2"
( export HOME="$W/home" GODSPEED_HOME="$W/home" GODSPEED_PROMPT_SOURCES="claude"
  cd "$W" && "$PY" "$ARC" --godspeed "$W" archive ) >"$W/heal.out" 2>&1
C2=$(cat "$W/prompts/archive/"*.jsonl | wc -l)
if [ "$C1" = "$C2" ] && cat "$W/prompts/archive/"*.jsonl | grep '"text": "self heal test question' | grep -q "the late healed reply"; then
  ok "38 a reply that arrived after the harvest is attached by the next one"
else
  bad "38 the late reply stayed lost" "rows $C1 -> $C2; $(cat "$W/heal.out")"
fi

# 39. Codex tool traffic wears the assistant role. It is machinery, never answer, and one
#     duplicated user event must not split a turn in two.
mkdir -p "$W/home/.codex/sessions"
printf '%s\n%s\n%s\n%s\n' \
  '{"timestamp":"2026-08-02T11:00:00Z","type":"response_item","payload":{"type":"message","role":"user","content":"codex answer test question"}}' \
  '{"timestamp":"2026-08-02T11:00:01Z","type":"event_msg","payload":{"type":"user_message","message":"codex answer test question"}}' \
  '{"timestamp":"2026-08-02T11:00:05Z","type":"response_item","payload":{"type":"message","role":"assistant","content":"[external_agent_tool_call: run the tests]"}}' \
  '{"timestamp":"2026-08-02T11:00:10Z","type":"response_item","payload":{"type":"message","role":"assistant","content":"the codex visible reply"}}' \
  > "$W/home/.codex/sessions/s2.jsonl"
( export HOME="$W/home" GODSPEED_HOME="$W/home" GODSPEED_PROMPT_SOURCES="codex"
  cd "$W" && "$PY" "$ARC" --godspeed "$W" archive ) >"$W/cx.out" 2>&1
CX="$(cat "$W/prompts/archive/"*.jsonl 2>/dev/null)"
CXROWS=$(echo "$CX" | grep -c '"text": "codex answer test question')
CXROW="$(echo "$CX" | grep '"text": "codex answer test question')"
if [ "$CXROWS" = "1" ] && echo "$CXROW" | grep -q "the codex visible reply" \
   && ! echo "$CXROW" | grep -q "external_agent_tool_call"; then
  ok "39 codex replies are kept, tool traffic and duplicate events are not"
else
  bad "39 codex answer capture leaked machinery or split the turn" "rows=$CXROWS $CXROW"
fi

# 40. A busy bot writes several messages within the same second, so insertion order is the
#     only truth about who answered what. And a reply to our own machinery's work order must
#     vanish with it, never leak backward onto the person's previous question.
# The Windows shape, since the Hermes switch (2026-09-02): HERMES_HOME names the store, the
# DEFAULT profile keeps its state.db at the ROOT of that folder (no profiles/ dir at all), and a
# person's conversations arrive with source 'desktop' or 'cli', not only 'telegram'. Before
# this case the tool looked only under profiles/ and only at telegram, so a reader on Windows
# had nothing filed and nothing said.
HH3="$W/hermes3"; mkdir -p "$HH3"
"$PY" - "$HH3" <<'PYEOF'
import sqlite3, sys, os
hh = sys.argv[1]
con = sqlite3.connect(os.path.join(hh, "state.db"))
con.execute("CREATE TABLE sessions (id TEXT, source TEXT)")
con.execute("CREATE TABLE messages (session_id TEXT, role TEXT, content TEXT, timestamp REAL)")
for sid, src in (("d1", "desktop"), ("c1", "cli"), ("x1", "cron")):
    con.execute("INSERT INTO sessions VALUES (?,?)", (sid, src))
for sid, role, txt in (("d1", "user", "typed into the desktop app about the garden fence"),
                       ("d1", "assistant", "a reply about the fence"),
                       ("c1", "user", "typed in a terminal about the fence quote"),
                       ("x1", "user", "a cron job's own prompt that is not a person")):
    con.execute("INSERT INTO messages VALUES (?,?,?,?)", (sid, role, txt, 1785875150.0))
con.commit(); con.close()
PYEOF
( export HOME="$W/home3" GODSPEED_HOME="$W/home3" GODSPEED_PROMPT_SOURCES="hermes" GODSPEED_TELEGRAM_TRANSCRIPT="$W/none.jsonl"
  # The server-wide places stay out (2026-10-11): every home is read now, not the first, so on
  # a server this case would otherwise read that server's real chats into the fixture.
  unset GODSPEED_HERMES_HOME; export HERMES_HOME="$HH3" GODSPEED_HERMES_NO_SYSTEM=1
  mkdir -p "$W/home3" "$W/godspeed3/prompts/archive" && cd "$W/godspeed3" && "$PY" "$ARC" --godspeed "$W/godspeed3" archive ) >"$W/win.out" 2>&1
B3="$(cat "$W/godspeed3/prompts/archive/"*.jsonl 2>/dev/null)"
echo "$B3" | grep -q "garden fence"   && ok "51 HERMES_HOME with the default profile's state.db at its root is read (the Windows shape)"   || bad "51 the Windows-shaped store was not read" "$(cat "$W/win.out")"
echo "$B3" | grep -q "terminal about the fence quote"   && ok "52 a terminal (cli) conversation counts as the person's"   || bad "52 the cli session was skipped" "$(cat "$W/win.out")"
echo "$B3" | grep -q "cron job's own prompt"   && bad "53 a cron job's prompt was filed as if a person typed it" "$B3"   || ok "53 a cron session's prompt is not a person's and stays out"
echo "$B3" | grep -q '"tool": *"hermes"' && echo "$B3" | grep -q '"channel": *"desktop"'   && ok "54 the entry says it was said to Hermes, through the desktop door, not 'telegram'"   || bad "54 the entry's tool or channel label is wrong" "$B3"

HH2="$W/hermes2"; mkdir -p "$HH2/profiles/orderbot"
"$PY" - "$HH2" <<'PYEOF'
import sqlite3, sys, os
hh = sys.argv[1]
con = sqlite3.connect(os.path.join(hh, "profiles", "orderbot", "state.db"))
con.execute("CREATE TABLE sessions (id TEXT, source TEXT)")
con.execute("CREATE TABLE messages (session_id TEXT, role TEXT, content TEXT, timestamp REAL)")
con.execute("INSERT INTO sessions VALUES ('s9','telegram')")
for role, txt in [
    ("user", "order test question one"),
    ("assistant", "reply to question one"),
    ("user", "[WORK ORDER FROM MACHINERY] do things"),
    ("assistant", "reply meant for the machinery"),
    ("user", "order test question two"),
    ("assistant", "reply to question two"),
]:
    con.execute("INSERT INTO messages VALUES ('s9',?,?,1785875150.0)", (role, txt))
con.commit(); con.close()
PYEOF
( export HOME="$W/home" GODSPEED_HOME="$W/home" GODSPEED_PROMPT_SOURCES="hermes" \
         GODSPEED_HERMES_HOME="$HH2" GODSPEED_TELEGRAM_TRANSCRIPT="$W/none.jsonl"
  cd "$W" && "$PY" "$ARC" --godspeed "$W" archive ) >"$W/ord.out" 2>&1
OD="$(cat "$W/prompts/archive/"*.jsonl 2>/dev/null)"
OD1="$(echo "$OD" | grep '"text": "order test question one')"
if echo "$OD1" | grep -q "reply to question one" && ! echo "$OD1" | grep -q "reply meant for the machinery" \
   && ! echo "$OD" | grep -q "reply meant for the machinery" \
   && echo "$OD" | grep '"text": "order test question two' | grep -q "reply to question two"; then
  ok "40 same-second replies attach to their own questions; a work order swallows its reply"
else
  bad "40 answer attribution in the bot store went wrong" "$OD1"
fi

# 41. Rescrub reaches into answers too, because a name is always added to the list AFTER
#     prompts and answers carrying it are already stored.
"$PY" - "$W" <<'PYEOF'
import json, os, sys
w = sys.argv[1]
with open(os.path.join(w, "prompts", "archive", "test-2026-07.jsonl"), "a", newline="\n") as fh:
    fh.write(json.dumps({"id": "feedfacefeedface", "at": "2026-07-06T09:00:00", "machine": "test",
                         "tool": "claude-code", "project": "", "text": "a question about the client",
                         "answer": "the client Umbrella Consolidated pays late, keep that in mind"}) + "\n")
PYEOF
( export HOME="$W/home" GODSPEED_HOME="$W/home"; "$PY" "$ARC" --godspeed "$W" rescrub ) >"$W/rs2.out" 2>&1
RSROW="$(grep '"id": "feedfacefeedface"' "$W/prompts/archive/test-2026-07.jsonl")"
if echo "$RSROW" | grep -qi "Umbrella Consolidated"; then
  bad "41 rescrub left a named party inside a stored answer" "$(cat "$W/rs2.out")"
elif echo "$RSROW" | grep -q "pays late"; then
  ok "41 rescrub cleans a name out of a stored answer and keeps the answer"
else
  bad "41 rescrub destroyed the answer instead of cleaning it" "$RSROW"
fi

# 42-45. CAN THE PAIR STILL FIND A GODSPEED? (2026-08-29)
#
# Everything above this line tests what the archive does once it knows where the mission control is. For
# eight days the answer was that it never got that far: prompt-harvest.js decided a folder was
# a mission control only if it held `memory/`, the mission control renamed that folder on 2026-08-21, and all three of
# the developer's machines went quiet the same day with no error anyone would see. The starter godspeed
# this kit installs has never had a `memory/`, so the tool shipped broken for every new reader.
# These four cases are the ones that would have caught it on the day.
HARV="$HERE/prompt-harvest.js"
if command -v node >/dev/null 2>&1 && [ -f "$HARV" ]; then
  mkdir -p "$W/godspeedcheck/new" "$W/godspeedcheck/new/observations" \
           "$W/godspeedcheck/old" "$W/godspeedcheck/old/memory" \
           "$W/godspeedcheck/declared/scripts/config" "$W/godspeedcheck/notagodspeed"
  : > "$W/godspeedcheck/declared/scripts/config/mc-layout.json"
  # `--where` prints the mission control it resolved and touches nothing, so mc-finding can be tested
  # without starting a real harvest inside a throwaway folder.
  findable() {
    GODSPEED_DIR="$1" HOME="$W/home" USERPROFILE="$W/home" node "$HARV" --where >"$W/hc.out" 2>"$W/hc.err" || true
    [ -s "$W/hc.out" ] && ! grep -q "could not find your mission control" "$W/hc.err"
  }
  findable "$W/godspeedcheck/new" \
    && ok "42 a mission control with observations/ and no memory/ is found - the layout this kit ships" \
    || bad "42 the mission control this kit installs is not recognised as a mission control" "$(cat "$W/hc.err")"
  findable "$W/godspeedcheck/old" \
    && ok "43 a mission control still carrying the old memory/ is found - an older reader keeps working" \
    || bad "43 an older memory/ godspeed stopped being recognised" "$(cat "$W/hc.err")"
  findable "$W/godspeedcheck/declared" \
    && ok "44 a mission control is recognised by the layout file it declares, whatever it named its folders" \
    || bad "44 mc-layout.json was not accepted as proof of a mission control" "$(cat "$W/hc.err")"
  # An explicitly set GODSPEED_DIR is believed. One PC had it set correctly the whole time and
  # was overruled on the strength of a missing folder, so "they told us" has to beat "it looks odd".
  findable "$W/godspeedcheck/notagodspeed" \
    && ok "45 a GODSPEED_DIR someone set by hand is believed, not second-guessed" \
    || bad "45 an explicitly set GODSPEED_DIR was overruled" "$(cat "$W/hc.err")"

  # 46-49. DOES EVERY RUN LEAVE A RECEIPT? (2026-08-29)
  # The eight-day outage was not a missing error message. The harvester printed a correct and
  # specific sentence on every machine, ninety times, into logs nothing read. What was missing
  # was any way for one machine to see that another had stopped, and the archive cannot carry
  # that: a run that finds nothing writes nothing, and so does a run that never happened.
  # Every path out of this program now files prompts/archive/status/<machine>.json.
  R="$W/receipts"; mkdir -p "$R/home"
  mkdir -p "$R/godspeed/prompts/archive" "$R/godspeed/observations"
  rcpt() { cat "$R/godspeed/prompts/archive/status/testbox.json" 2>/dev/null; }

  # A run that cannot find a mission control has nowhere to file a receipt - unless it remembers the mission control
  # it used last, which is exactly the run where one is worth having. So: succeed once so the
  # machine remembers, then break mc-finding and check it still reports.
  GODSPEED_MACHINE=testbox HOME="$R/home" USERPROFILE="$R/home" GODSPEED_DIR="$R/godspeed" node "$HARV" --no-push >/dev/null 2>&1
  rcpt | grep -q '"ok": true' \
    && ok "46 a successful run says so in the mission control, in its own file" \
    || bad "46 no receipt after a good run" "$(rcpt)"
  rcpt | grep -q '"tool_version"' \
    && ok "47 the receipt names which copy of the pair this machine is running" \
    || bad "47 no tool_version, so a machine on a stale harvester stays invisible"

  # A FAILING RUN MUST REPORT TOO, and that is the whole point. Forced by putting this program
  # somewhere its collector is not, which is a real state a machine reaches: the pair is
  # installed together and one half can be replaced, moved or half-updated on its own.
  # (Godspeed-finding itself cannot be broken from a test on a machine that HAS a mission control at one of the
  # well-known paths, and a test-only way to blind it would be a hole in the shipped program.)
  mkdir -p "$R/lonely"
  cp "$HARV" "$R/lonely/prompt-harvest.js"
  GODSPEED_MACHINE=testbox HOME="$R/home" USERPROFILE="$R/home" GODSPEED_DIR="$R/godspeed" \
    node "$R/lonely/prompt-harvest.js" --no-push >/dev/null 2>&1
  rcpt | grep -q '"ok": false' \
    && ok "48 a run that CANNOT do its job still files a receipt saying so" \
    || bad "48 a failed harvest left no trace in the repo - the outage shape" "$(rcpt)"
  rcpt | grep -qi 'collector' \
    && ok "49 and the receipt carries the machine's own sentence, to be quoted back" \
    || bad "49 the receipt records no reason, so the alert has to guess again" "$(rcpt)"

  # 50. The one failure a test cannot force is the one that happened: no mission control anywhere. There
  # is no repository to write into then, so the machine remembers the mission control it used last and
  # files the bad news there. Without this, the run that most needs to report cannot.
  [ -s "$R/home/.godspeed/prompt-harvest-godspeed" ] \
    && ok "50 a good run remembers its mission control, so a later blind run still has somewhere to report" \
    || bad "50 nothing remembered, so a mc-finding failure would be silent again"

  # 50b-50c. AN EMPTY RUN COMMITS NOTHING ONCE TODAY'S RECEIPT IS SAVED (2026-10-11). The server
  # harvests every hour now, and each run rewrote the receipt's time, so each made a commit that
  # archived nothing. The day's first run still commits the receipt; later empty ones do not.
  G="$W/emptyruns"; mkdir -p "$G/home" "$G/godspeed/observations" "$G/godspeed/prompts/archive"
  ( cd "$G/godspeed" && git init -q && git config user.email t@t && git config user.name t \
      && git add -A >/dev/null 2>&1; git commit -q --allow-empty -m start ) >/dev/null 2>&1
  harv() { GODSPEED_MACHINE=testbox HOME="$G/home" USERPROFILE="$G/home" GODSPEED_DIR="$G/godspeed" node "$HARV" --no-push --verbose 2>&1; }
  harv >/dev/null
  n1="$(git -C "$G/godspeed" rev-list --count HEAD)"
  [ "$n1" = "2" ] \
    && ok "50b the day's first run commits its receipt" \
    || bad "50b the first run made $n1 commits, expected the start and one receipt" "$(git -C "$G/godspeed" log --oneline)"
  sleep 1   # a receipt rewritten within the same second is byte-identical and proves nothing
  out2="$(harv)"
  n2="$(git -C "$G/godspeed" rev-list --count HEAD)"
  [ "$n2" = "$n1" ] && [ -z "$(git -C "$G/godspeed" status --porcelain)" ] \
    && ok "50c a second empty run the same day commits nothing and leaves the folder clean" \
    || bad "50c an empty run made a commit or left a change behind" "$out2 / $(git -C "$G/godspeed" status --porcelain)"
else
  echo "  --   42-50 skipped: node or prompt-harvest.js not on this machine"
fi

# --- 55 to 60: OpenCode, the fourth source (2026-09-21) -----------------------------------
#
# WHY THESE EXIST. The installer used to show OpenCode greyed out as "cannot sync", while the
# book teaches using it with the mission control. Its conversations sit in one sqlite database, so it is
# read now. The dangers are the Claude ones in a new shape: OpenCode pastes files and tool
# results into YOUR turn as "synthetic" text, starts helper sessions whose "user" turns the
# assistant wrote, and stores its reasoning as text-like parts. None of that is yours. And a
# source added later must never be read on a machine whose owner was never asked about it.
OC="$W/oc/opencode.db"; mkdir -p "$W/oc"
"$PY" - "$OC" <<'PYEOF'
import sqlite3, sys, json
con = sqlite3.connect(sys.argv[1])
con.execute("CREATE TABLE session (id TEXT, parent_id TEXT, directory TEXT)")
con.execute("CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT)")
con.execute("CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT)")
con.execute("INSERT INTO session VALUES ('s1', NULL, 'C:/Users/x/projects/garden')")
con.execute("INSERT INTO session VALUES ('s2', 's1', 'C:/Users/x/projects/garden')")
M = [("m1", "s1", 1788330000000, "user"), ("m2", "s1", 1788330001000, "assistant"),
     ("m3", "s1", 1788330002000, "user"), ("m4", "s1", 1788330003000, "assistant"),
     ("m5", "s2", 1788330004000, "user")]
for mid, sid, t, role in M:
    con.execute("INSERT INTO message VALUES (?,?,?,?)", (mid, sid, t, json.dumps({"role": role})))
P = [("p1", "m1", {"type": "text", "text": "opencode question about the hedge height"}),
     ("p2", "m1", {"type": "text", "synthetic": True, "text": "Called the Read tool with a pasted file body"}),
     ("p3", "m2", {"type": "reasoning", "text": "hidden opencode reasoning"}),
     ("p4", "m2", {"type": "tool", "tool": "read", "state": {"output": "tool output text"}}),
     ("p5", "m2", {"type": "text", "text": "the hedge may be two metres"}),
     ("p6", "m3", {"type": "text", "text": "second opencode question about compost"}),
     ("p7", "m4", {"type": "text", "text": "compost reply"}),
     ("p8", "m5", {"type": "text", "text": "a helper session prompt the assistant wrote"})]
for i, (pid, mid, d) in enumerate(P):
    sid = "s2" if mid == "m5" else "s1"
    con.execute("INSERT INTO part VALUES (?,?,?,?,?)", (pid, mid, sid, i, json.dumps(d)))
con.commit(); con.close()
PYEOF
rm -f "$W/prompts/archive/"*.jsonl
( export HOME="$W/home" GODSPEED_HOME="$W/home" GODSPEED_PROMPT_SOURCES="opencode" GODSPEED_OPENCODE_DB="$OC"
  cd "$W" && "$PY" "$ARC" --godspeed "$W" archive ) >"$W/oc.out" 2>&1
OCA="$(cat "$W/prompts/archive/"*.jsonl 2>/dev/null)"
OC1="$(echo "$OCA" | grep 'hedge height')"
[ -n "$OC1" ] && echo "$OC1" | grep -q '"tool": *"opencode"' && echo "$OC1" | grep -q '"project": *"garden"' \
  && ok "55 what you typed to OpenCode is filed, as opencode, under its project folder" \
  || bad "55 the OpenCode turn is missing or mislabelled" "$(cat "$W/oc.out") $OCA"
echo "$OCA" | grep -q "pasted file body" \
  && bad "56 a file OpenCode pasted into the turn was filed as if you typed it" "$OCA" \
  || ok "56 synthetic text (a pasted file, a tool result) stays out"
echo "$OCA" | grep -q "helper session prompt" \
  && bad "57 a helper session's prompt, written by the assistant, was filed as yours" "$OCA" \
  || ok "57 a helper session OpenCode started itself stays out"
if echo "$OC1" | grep -q "two metres" && ! echo "$OCA" | grep -q "hidden opencode reasoning\|tool output text" \
   && echo "$OCA" | grep 'about compost' | grep -q "compost reply"; then
  ok "58 each answer is the visible text only, attached to its own question"
else
  bad "58 OpenCode answers leaked machinery or landed on the wrong question" "$OCA"
fi
# 59. Not ticked: OpenCode's older chats stay out.
rm -f "$W/prompts/archive/"*.jsonl
( export HOME="$W/home" GODSPEED_HOME="$W/home" GODSPEED_PROMPT_SOURCES="claude" GODSPEED_OPENCODE_DB="$OC"
  cd "$W" && "$PY" "$ARC" --godspeed "$W" archive ) >/dev/null 2>&1
cat "$W/prompts/archive/"*.jsonl 2>/dev/null | grep -q "hedge height" \
  && bad "59 OpenCode was read on a machine where it was switched off" \
  || ok "59 OpenCode's older chats stay out where they were not brought in"
# 60. A machine that never recorded a choice keeps reading what it always read, and does NOT
#     start reading OpenCode behind its owner's back just because this program learned how.
rm -f "$W/prompts/archive/"*.jsonl
mkdir -p "$W/home60"
( unset GODSPEED_PROMPT_SOURCES
  export HOME="$W/home60" GODSPEED_HOME="$W/home60" USERPROFILE="$W/home60" GODSPEED_OPENCODE_DB="$OC"
  cd "$W" && "$PY" "$ARC" --godspeed "$W" archive ) >/dev/null 2>&1
cat "$W/prompts/archive/"*.jsonl 2>/dev/null | grep -q "hedge height" \
  && bad "60 a machine with no recorded choice started reading a newly supported tool" \
  || ok "60 no recorded choice never switches on a tool added later"

# 61. A password said in a sentence is removed, in German too, and prose about passwords is not.
#     The real case: "Dein Passwort ist das folgende:  <32 characters>" sat in the archive from
#     2026-05-01 to 2026-09-24, because the old pattern wanted the colon right after the word.
P61="$("$PY" - "$ARC" <<'PYEOF'
import importlib.machinery, importlib.util, sys
l = importlib.machinery.SourceFileLoader("pa", sys.argv[1])
s = importlib.util.spec_from_loader("pa", l); m = importlib.util.module_from_spec(s); l.exec_module(m)
cases = [("Dein Passwort ist das folgende:  Xq7vRt2LmP9wKd4Zb8Nc", False),
         ("my password is hunter22x", False),
         ("I forgot which password manager I use, is it good?", True),
         ("the password field is empty", True)]
for text, keep in cases:
    out = m.scrub(text, [])[0]
    if (out == text) != keep:
        print("FAIL", text, "->", out)
PYEOF
)"
[ -z "$P61" ] && ok "61 a password in a sentence is removed, prose about passwords is kept" \
  || bad "61 the sentence-password scrub is wrong" "$P61"

# 62. A session a scheduled job started in print mode is the job's words, not the person's.
#     Found 2026-09-29: a third of one server's monthly file was the morning note writer's prompt.
#     A row already moved out to prompts/machine-runs/ is not archived a second time either.
rm -f "$W/prompts/archive/"*.jsonl
mkdir -p "$W/home62/.claude/projects/p62" "$W/prompts/machine-runs"
cat > "$W/home62/.claude/projects/p62/s.jsonl" <<'EOF'
{"type":"user","entrypoint":"sdk-cli","timestamp":"2026-09-29T05:16:00Z","message":{"content":"You are Mission Control writing the morning note"}}
{"type":"user","entrypoint":"cli","timestamp":"2026-09-29T09:00:00Z","message":{"content":"plan my garden shed build"}}
{"type":"user","timestamp":"2026-09-29T09:05:00Z","message":{"content":"older transcript without a marker"}}
{"type":"user","entrypoint":"cli","timestamp":"2026-09-29T09:10:00Z","message":{"content":"already moved to the other drawer"}}
EOF
MID="$("$PY" -c 'import hashlib;print(hashlib.sha256(b"claude-code|already moved to the other drawer").hexdigest()[:16])')"
echo "{\"id\":\"$MID\",\"text\":\"already moved to the other drawer\"}" > "$W/prompts/machine-runs/x-2026-09.jsonl"
( export HOME="$W/home62" GODSPEED_HOME="$W/home62" USERPROFILE="$W/home62" GODSPEED_PROMPT_SOURCES="claude"
  cd "$W" && "$PY" "$ARC" --godspeed "$W" archive ) >/dev/null 2>&1
A62="$(cat "$W/prompts/archive/"*.jsonl 2>/dev/null)"
if echo "$A62" | grep -q "garden shed" && echo "$A62" | grep -q "without a marker" \
   && ! echo "$A62" | grep -q "morning note" && ! echo "$A62" | grep -q "already moved"; then
  ok "62 a print-mode session and a row moved to machine-runs stay out; typed turns stay in"
else
  bad "62 a scheduled job's prompt reached the typed-prompt drawer, or a typed one was lost" "$A62"
fi
rm -rf "$W/prompts/machine-runs"

# 63. A Telegram bot token, and the other common token shapes, are removed by shape.
#     The real case: a bot token sat in prompts/archive and prompts/machine-runs from July to
#     7 October 2026, because its 35 characters after the colon are under STILL_RISKY's 40 and
#     "bot<digits>" in a URL has no word boundary before the digits. The fixtures are glued
#     together at run time, so this file holds no token-shaped string for a scanner to flag,
#     and rescrub must clean the machine-runs drawer as well as the archive.
P63="$("$PY" - "$ARC" "$W" <<'PYEOF'
import importlib.machinery, importlib.util, io, json, os, subprocess, sys
l = importlib.machinery.SourceFileLoader("pa", sys.argv[1])
s = importlib.util.spec_from_loader("pa", l); m = importlib.util.module_from_spec(s); l.exec_module(m)
r = lambda n, a="Ab3": (a * 40)[:n]
tg = "8123456789" + ":" + "AA" + r(33)
cases = [  # (what was typed, the part that must not survive)
    ("the bot token is " + tg, tg),
    ("curl https://api.telegram.org/bot" + tg + "/sendMessage", tg),
    ("pat " + "github" + "_pat_" + r(40), r(40)),
    ("gitlab " + "gl" + "pat-" + r(20), r(20)),
    ("stripe " + "sk" + "_live_" + r(24), r(24)),
    ("hook " + "wh" + "sec_" + r(24), r(24)),
    ("npm " + "npm" + "_" + r(36), r(36)),
    ("hugging " + "hf" + "_" + r(34), r(34)),
    ("groq " + "gsk" + "_" + r(32), r(32)),
    ("xai " + "xai" + "-" + r(32), r(32)),
    ("tailscale " + "tskey" + "-auth-" + r(30), r(30)),
    ("aws " + "AS" + "IA" + "QWERTYUIOPASDFGH", "QWERTYUIOPASDFGH"),
    ("sendgrid " + "SG" + "." + r(22) + "." + r(30), r(30)),
    ("google " + "ya" + "29." + r(30), r(30)),
    ("discord " + "M" + r(25) + "." + r(6) + "." + r(30), r(30)),
    ("post to https://hooks.slack.com/services/" + "T0" + r(8) + "/B0" + r(8) + "/" + r(24), r(24)),
    ("post to https://discord.com/api/webhooks/" + "123456789012345678/" + r(30), r(30)),
    ("db postgres://admin:" + "Sup3rSecretPw" + "@db.example.org/app", "Sup3rSecretPw"),
]
for text, secret in cases:
    out = m.scrub(text, [])[0] or ""
    if secret in out:
        print("FAIL kept:", text[:24], "->", out[:60])
prose = ["the meeting is at 10:30 and ends at 11:15", "issue 12345678: AA batteries are low",
         "read docs at https://example.com:8080/path", "the bot answers at https://t.me/some_example_bot"]
for text in prose:
    if m.scrub(text, [])[0] != text:
        print("FAIL prose changed:", text, "->", m.scrub(text, [])[0])
# rescrub reaches prompts/machine-runs/ too, not only prompts/archive/
w = sys.argv[2]
os.makedirs(os.path.join(w, "prompts", "machine-runs"), exist_ok=True)
p = os.path.join(w, "prompts", "machine-runs", "vps-2026-09.jsonl")
with io.open(p, "w", encoding="utf-8") as fh:
    fh.write(json.dumps({"id": "x63", "text": "token " + tg + " for the bot"}) + "\n")
env = dict(os.environ, HOME=os.path.join(w, "home63"), GODSPEED_HOME=os.path.join(w, "home63"))
subprocess.run([sys.executable, sys.argv[1], "--godspeed", w, "rescrub"], env=env,
               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
if tg in io.open(p, encoding="utf-8").read():
    print("FAIL rescrub left a bot token in prompts/machine-runs")
PYEOF
)"
rm -rf "$W/prompts/machine-runs"
[ -z "$P63" ] && ok "63 bot tokens and other token shapes are removed, in both drawers, and prose is kept" \
  || bad "63 a token shape survived the scrubber, or prose was eaten" "$P63"

# 64. The product's OWN key formats must be redacted, not stored in cleartext. All reached the
#     committed archive before 2026-10-07: the prefixed keys (godspeed_<64 hex>, mnr_<48 hex>)
#     are under STILL_RISKY's 40; a bare 32- or 64-char lowercase-hex blob (session cookie,
#     login-link code, pairing key) is pure lowercase, which _looks_credential never fired on;
#     and a "_SECRET"/"_KEY" suffix had no word boundary before it so the assignment pattern
#     missed GODSPEED_NOTEBOOK_KEY= and WEBHOOK_SECRET=. Glued at run time so this file holds no
#     key-shaped literal, and a 40-char commit SHA must still survive untouched.
P64="$("$PY" - "$ARC" <<'PYEOF'
import importlib.machinery, importlib.util, sys
l = importlib.machinery.SourceFileLoader("pa", sys.argv[1])
s = importlib.util.spec_from_loader("pa", l); m = importlib.util.module_from_spec(s); l.exec_module(m)
hx = lambda n: ("0123456789abcdef" * 8)[:n]
gkey = "godspeed" + "_" + hx(64)
mkey = "mnr" + "_" + hx(48)
sess = hx(64)
cook = hx(32)
cases = [  # (what was typed, the part that must not survive) in prompt AND answer
    ("my notebook key is " + gkey + " please connect it", gkey),
    ("export GODSPEED_NOTEBOOK_KEY=" + gkey, gkey),
    ("MENERIO_API_KEY=" + mkey + " comes up empty", mkey),
    ("use key " + mkey, mkey),
    ("WEBHOOK_SECRET=" + hx(64), hx(64)),
    ("the pairing code is " + sess, sess),
    ("here is the session cookie " + cook + " paste it", cook),
    ("FOO_SECRET=" + "Sup3r" + "SecretVal99", "Sup3rSecretVal99"),
]
for text, secret in cases:
    out = m.scrub(text, [])[0] or ""
    if secret in out:
        print("FAIL prompt kept:", text[:30], "->", out[:70])
    aout = m.scrub_answer(text, [])
    if secret in aout:
        print("FAIL answer kept:", text[:30], "->", aout[:70])
# An ordinary 40-char git commit SHA is neither 32 nor 64 hex, so it must survive untouched.
sha = hx(16) + hx(16) + hx(8)
keep = "the commit " + sha + " broke the build"
if m.scrub(keep, [])[0] != keep:
    print("FAIL a 40-char commit SHA was redacted:", str(m.scrub(keep, [])[0])[:70])
PYEOF
)"
[ -z "$P64" ] && ok "64 the product's own key formats are redacted, and a 40-char commit SHA is kept" \
  || bad "64 an own-format key survived scrubbing, or a commit SHA was eaten" "$P64"

# 65. The archive `project` field is the working-directory basename for Claude Code and
#     OpenCode, so a path like C--work-AcmeCorp-migration carried a client name straight into
#     the one file whose job is to keep such names out (the no-confidential-names rule). Until
#     2026-10-07 it was stored with no scrub and no redact pass at all. The prompt body here is
#     clean, so only the folder name can leak: it must be redacted before the row is written.
rm -f "$W/prompts/archive/"*.jsonl
mkdir -p "$W/home65/.claude/projects/C--work-AcmeCorp-migration"
printf '%s\n' '{"type":"user","entrypoint":"cli","timestamp":"2026-10-05T09:00:00Z","message":{"content":"plan the data migration for next week"}}' \
  > "$W/home65/.claude/projects/C--work-AcmeCorp-migration/m.jsonl"
( export HOME="$W/home65" GODSPEED_HOME="$W/home65" USERPROFILE="$W/home65" \
         GODSPEED_PROMPT_SOURCES="claude" GODSPEED_REDACT_TERMS="AcmeCorp"
  cd "$W" && "$PY" "$ARC" --godspeed "$W" archive ) >"$W/p65.out" 2>&1
A65="$(cat "$W/prompts/archive/"*.jsonl 2>/dev/null)"
if echo "$A65" | grep -q "AcmeCorp"; then
  bad "65 a client name in the project field reached the repository" "$A65"
elif echo "$A65" | grep -qF '"project": "C--work-[name removed]-migration"'; then
  ok "65 the project field is scrubbed through the redact list before it is stored"
else
  bad "65 the project field was not cleaned as expected" "$A65"
fi

# 66. Rescrub cleans the project field of rows ALREADY stored, for the day a name is added to
#     the list too late, the same promise it keeps for the text and the answer beside it.
printf '%s\n' '{"id":"cafef00dcafef00d","at":"2026-10-05T09:00:00","machine":"test","tool":"claude-code","project":"C--work-AcmeCorp-migration","text":"an already-stored prompt with a clean body"}' \
  >> "$W/prompts/archive/test-2026-10.jsonl"
( export HOME="$W/home66" GODSPEED_HOME="$W/home66" USERPROFILE="$W/home66" GODSPEED_REDACT_TERMS="AcmeCorp"
  cd "$W" && "$PY" "$ARC" --godspeed "$W" rescrub ) >"$W/p66.out" 2>&1
A66="$(cat "$W/prompts/archive/"*.jsonl 2>/dev/null)"
echo "$A66" | grep -q "AcmeCorp" \
  && bad "66 rescrub left a client name in a stored project field" "$A66" \
  || ok "66 rescrub cleans the project field of already-stored rows"
rm -f "$W/prompts/archive/"*.jsonl

# 67. The last-resort guard dropped a WHOLE prompt when it saw a 40+ character run that still
#     looked like a credential, but its character class included "/", so an ordinary GitHub
#     commit URL or a deep repo path (mixed case, digits, slashes) was read as one blob and the
#     prompt was lost with the line it sat in (2026-10-07). A URL or path must be kept whole;
#     a real unbroken secret must still be dropped.
P67="$("$PY" - "$ARC" <<'PYEOF'
import importlib.machinery, importlib.util, sys
l = importlib.machinery.SourceFileLoader("pa", sys.argv[1])
s = importlib.util.spec_from_loader("pa", l); m = importlib.util.module_from_spec(s); l.exec_module(m)
keep = [
    "Look at https://github.com/MichaelZelbel/godspeed-mission-control/commit/79bf27f and tell me",
    "the file is at C:/Users/Besitzer/AppData/Local/Temp/claude/c--godspeed/2d972171-1ea6-403b/notes.md ok",
    "see /home/sam/projects/MissionControl/notebook/core/goal-loop.mjs line 80",
]
for text in keep:
    if m.scrub(text, [])[0] != text:
        print("FAIL a URL/path prompt was changed or dropped:", text[:46], "->", str(m.scrub(text, [])[0])[:60])
    if m.scrub_answer(text, []) != text:
        print("FAIL a URL/path line was cut from an answer:", text[:46])
# A real long secret is one unbroken token, so it must still be dropped whole.
secret = "Xq7" + "ZmP2vLd8RtY4wNb1CfH6jGk3sVe9AuQ5oIrTzB0xM"
if m.scrub("use this value " + secret + " now", [])[0] is not None:
    print("FAIL a real long secret was no longer dropped")
PYEOF
)"
[ -z "$P67" ] && ok "67 a GitHub URL or deep path is kept whole, and a real long secret still drops" \
  || bad "67 the still-risky guard mis-fired on a URL/path, or stopped catching a secret" "$P67"

# --- 68 to 73: TWO Hermes installs on one machine, both read, nothing twice (2026-10-11) ------
#
# WHY THESE EXIST. The reader took the FIRST Hermes home it found. On 2026-10-07 the server's
# Mission Control chat moved to a second Hermes whose home is inside the mission control
# (.godspeed/integrated-runtime/hermes), while the company desks stayed in the old home. The old
# one was found first, so four days of Telegram chat reached no archive, and every daily run said
# "ok, 0 added". The new store also carries copies of conversations the old one already gave the
# archive, so reading both must not file anything twice. And `sources`, the morning guard, said
# nothing: it never opened the new store, and a store that is partly archived looked healthy.
HOLD="$W/hermes-old"; G4="$W/godspeed4"; HNEW="$G4/.godspeed/integrated-runtime/hermes"
mkdir -p "$HOLD/profiles/godspeed" "$HNEW" "$G4/prompts/archive" "$W/home4"
"$PY" - "$HOLD" "$HNEW" <<'PYEOF'
import sqlite3, sys, os
from datetime import datetime, timezone
old_home, new_home = sys.argv[1], sys.argv[2]
def ts(day, hour):
    return datetime(2026, 10, day, hour, 0, tzinfo=timezone.utc).timestamp()
def store(path, rows):
    con = sqlite3.connect(path)
    con.execute("CREATE TABLE sessions (id TEXT, source TEXT)")
    con.execute("CREATE TABLE messages (session_id TEXT, role TEXT, content TEXT, timestamp REAL)")
    for sid, src in sorted({(r[0], r[1]) for r in rows}):
        con.execute("INSERT INTO sessions VALUES (?,?)", (sid, src))
    for sid, _src, role, txt, t in rows:
        con.execute("INSERT INTO messages VALUES (?,?,?,?)", (sid, role, txt, t))
    con.commit(); con.close()
before = [
    ("o1", "telegram", "user",      "before the move: what colour is the shed door", ts(5, 9)),
    ("o1", "telegram", "assistant", "the shed door is blue", ts(5, 9)),
]
store(os.path.join(old_home, "profiles", "godspeed", "state.db"), before)
# The new home holds a copy of that old conversation, as the real one does, and the new chat.
store(os.path.join(new_home, "state.db"), [(("n0",) + r[1:]) for r in before] + [
    ("n1", "telegram", "user",      "after the move: remind me to oil the shed hinge", ts(10, 18)),
    ("n1", "telegram", "assistant", "noted, the hinge on Saturday", ts(10, 18)),
    ("n2", "cron",     "user",      "a scheduled job's prompt in the new home", ts(10, 19)),
    # What a scheduled job sends INTO the chat arrives in his role; his reply to it is his.
    ("n1", "telegram", "user",      "[Cron delivery: coach-tick]\nFrom your coach: neck exercise", ts(10, 20)),
    ("n1", "telegram", "assistant", "the coach's own follow-up line", ts(10, 20)),
    ("n1", "telegram", "user",      "done, ten head lifts", ts(10, 21)),
    ("n1", "telegram", "user",      "[Webhook delivery: mc-notice]\nI found three new posts", ts(10, 22)),
])
PYEOF
# The day before the fix: only the old home is read, so only the old chat reaches the archive.
( export HOME="$W/home4" GODSPEED_HOME="$W/home4" GODSPEED_PROMPT_SOURCES="hermes" \
         GODSPEED_HERMES_HOME="$HOLD" GODSPEED_TELEGRAM_TRANSCRIPT="$W/none.jsonl"
  cd "$G4" && "$PY" "$ARC" --godspeed "$G4" archive ) >"$W/two0.out" 2>&1
# 68. The guard must now see the second home on its own and fail, although the store it finds
#     there is partly archived (its copy of the old chat is in the archive).
( export HOME="$W/home4" GODSPEED_HOME="$W/home4" GODSPEED_PROMPT_SOURCES="hermes" \
         GODSPEED_HERMES_NO_SYSTEM=1 HERMES_HOME="$HOLD" GODSPEED_TELEGRAM_TRANSCRIPT="$W/none.jsonl"
  unset GODSPEED_HERMES_HOME; "$PY" "$ARC" --godspeed "$G4" sources ) >"$W/two-src0.out" 2>&1
TS0=$?
[ "$TS0" -ne 0 ] && grep -q "^PROMPT SOURCE LOST:.*hermes/godspeed.*stopped reaching the archive" "$W/two-src0.out" \
  && ok "68 sources finds the mission control's own Hermes and fails: its newest chat reaches no archive" \
  || bad "68 a second Hermes home whose new chat is unarchived was reported as healthy" "rc=$TS0 $(cat "$W/two-src0.out")"
# Now the real harvest, finding both homes by itself (HERMES_HOME names the old one, the new one is
# found inside the mission control), with the server-wide places switched off so this test never
# reads a real server's chats.
two_run() {
  ( export HOME="$W/home4" GODSPEED_HOME="$W/home4" GODSPEED_PROMPT_SOURCES="hermes" \
           GODSPEED_HERMES_NO_SYSTEM=1 HERMES_HOME="$HOLD" GODSPEED_TELEGRAM_TRANSCRIPT="$W/none.jsonl"
    unset GODSPEED_HERMES_HOME; cd "$G4" && "$PY" "$ARC" --godspeed "$G4" "$@" )
}
two_run archive >"$W/two1.out" 2>&1
B4="$(cat "$G4/prompts/archive/"*.jsonl 2>/dev/null)"
# 69. The bug itself: the chat in the second home is archived, with its answer and its door.
R4="$(echo "$B4" | grep '"text": "after the move: remind me to oil the shed hinge"')"
if echo "$R4" | grep -q '"channel": *"telegram"' && echo "$R4" | grep -q '"answer": *"noted, the hinge on Saturday"' \
   && echo "$R4" | grep -q '"project": *"godspeed"'; then
  ok "69 a chat in the second Hermes home is archived, with its answer, as the mission control's chat"
else
  bad "69 the second Hermes home was not read, or its row is wrong" "$(cat "$W/two1.out") | $R4"
fi
# 70. The copy of the old conversation in the new store is the same prompt, so it is not filed again.
N_OLD="$(echo "$B4" | grep -c '"text": "before the move: what colour is the shed door"')"
[ "$N_OLD" = "1" ] && ok "70 a conversation present in both homes is archived once" \
  || bad "70 a conversation present in both homes was archived $N_OLD times" "$B4"
# 71. The source filter still holds in the new home: a scheduled job is not a person.
echo "$B4" | grep -q "a scheduled job's prompt in the new home" \
  && bad "71 a cron session in the second home was filed as a person's prompt" \
  || ok "71 the second home's scheduled jobs stay out, as in the first"
# 71b. A job's delivery into the chat is the machine's words, his reply to it is his.
if echo "$B4" | grep -q "Cron delivery\|Webhook delivery\|coach's own follow-up"; then
  bad "71b a scheduled job's or webhook's delivery into the chat was filed as his prompt" "$B4"
elif echo "$B4" | grep -q '"text": "done, ten head lifts"'; then
  ok "71b a job's delivery into the chat stays out, and his reply to it is kept"
else
  bad "71b his reply to a delivery was lost with it" "$B4"
fi
# 72. A second run adds nothing, and the guard is quiet once both homes are archived.
L1="$(cat "$G4/prompts/archive/"*.jsonl | wc -l)"
two_run archive >"$W/two2.out" 2>&1
L2="$(cat "$G4/prompts/archive/"*.jsonl | wc -l)"
two_run sources >"$W/two-src1.out" 2>&1; TS1=$?
[ "$L1" = "$L2" ] && [ "$TS1" -eq 0 ] \
  && ok "72 a second harvest of both homes adds nothing, and sources is green" \
  || bad "72 a rerun added rows ($L1 -> $L2) or sources still fails (rc=$TS1)" "$(cat "$W/two-src1.out")"
# 73. One store reached through two homes (a gateway whose HERMES_HOME is one profile's folder,
#     like the server's watchdog) is read once, under that profile's name.
N73="$("$PY" - "$ARC" "$HOLD" <<'PYEOF'
import importlib.machinery, importlib.util, os, sys
l = importlib.machinery.SourceFileLoader("pa", sys.argv[1])
s = importlib.util.spec_from_loader("pa", l); m = importlib.util.module_from_spec(s); l.exec_module(m)
old = sys.argv[2]
st = m.hermes_stores([old, os.path.join(old, "profiles", "godspeed")])
print(len(st), ",".join(lbl for lbl, _ in st))
PYEOF
)"
[ "$N73" = "1 godspeed" ] && ok "73 a store reached through two homes is read once, under its profile's name" \
  || bad "73 a store reached through two homes was listed wrong" "$N73"

# --- 74 to 90: every NEW chat is saved, on every reader's computer (2026-10-12) ---------------
#
# WHY THESE EXIST. The book tells every reader to leave the installer's "Your conversations"
# boxes unticked, or to pass --sources "" on a Mac or Linux, because those boxes read as being
# about old chats. Until 2026-10-12 an unticked box meant the tool was never read at all, so no
# reader ever had a single conversation saved, and their assistant had nothing to look back at.
# Fresh test installs of each reader route found it: "It is a bug, right? So fix the
# bug." Now a new chat is always saved, the boxes decide only whether OLDER chats come in too,
# and the commands the assistant is told to use work where readers are.
echo "== every new chat is saved; the boxes only decide about older ones"
H7="$W/home74"; G7="$W/mc74"
mkdir -p "$H7/.godspeed" "$H7/.claude/projects/p74" "$H7/.codex/sessions" "$G7/observations" "$G7/prompts/archive"
J7="$H7/.claude/projects/p74/s.jsonl"
printf '%s\n' \
  '{"type":"user","timestamp":"2026-08-01T09:00:00Z","message":{"content":"an old claude chat about the hazel hedge"}}' \
  '{"type":"user","timestamp":"2026-09-01T09:00:00Z","message":{"content":"a new claude chat about the Larkspur invoice"}}' \
  '{"type":"assistant","timestamp":"2026-09-01T09:00:05Z","message":{"content":[{"type":"text","text":"The Larkspur invoice is number 112."}]}}' > "$J7"
printf '%s\n' \
  '{"timestamp":"2026-08-02T10:00:00Z","payload":{"role":"user","content":"an old codex chat about the rowan tree"}}' \
  '{"timestamp":"2026-09-02T10:00:00+02:00","payload":{"role":"user","content":"a new codex chat about the Quince report"}}' \
  > "$H7/.codex/sessions/s.jsonl"
run74() { ( unset GODSPEED_PROMPT_SOURCES GODSPEED_PROMPT_SINCE GODSPEED_PROMPT_ARCHIVE
  export HOME="$H7" GODSPEED_HOME="$H7" USERPROFILE="$H7" "$@"
  cd "$W" && "$PY" "$ARC" --godspeed "$G7" archive ); }
A74() { cat "$G7/prompts/archive/"*.jsonl 2>/dev/null; }

# 74. The book's line (--sources "" or every box unticked): new chats from every tool are saved,
#     with their answers; older ones stay out.
printf 'GODSPEED_PROMPT_SOURCES=\nGODSPEED_PROMPT_SINCE=2026-08-15T00:00:00Z\n' > "$H7/.godspeed/device.env"
run74 >"$W/r74.out" 2>&1
A74 | grep 'Larkspur' | grep -q '"answer": "The Larkspur invoice is number 112."' \
  && ok "74 with every box unticked, a new Claude Code chat is saved with its answer" \
  || bad "74 a new chat was not saved where the book's setup leaves every box unticked" "$(cat "$W/r74.out")"
A74 | grep -q 'Quince report' && ok "74b a new Codex chat is saved too (its time written with an offset)" \
  || bad "74b the new Codex chat was not saved" "$(cat "$W/r74.out")"
A74 | grep -q 'hazel hedge\|rowan tree' && bad "74c a chat from before the computer began saving came in unticked" "$(A74)" \
  || ok "74c chats from before the computer began saving stay out when their box was unticked"

# 75. A ticked tool brings its older chats in as well; the others still only their new ones.
rm -f "$G7/prompts/archive/"*.jsonl
printf 'GODSPEED_PROMPT_SOURCES=claude\nGODSPEED_PROMPT_SINCE=2026-08-15T00:00:00Z\n' > "$H7/.godspeed/device.env"
run74 >"$W/r75.out" 2>&1
A74 | grep -q 'hazel hedge' && A74 | grep -q 'Larkspur' && A74 | grep -q 'Quince' && ! A74 | grep -q 'rowan tree' \
  && ok "75 a ticked tool brings its older chats in; an unticked one only its new ones" \
  || bad "75 ticked and unticked tools were not told apart" "$(cat "$W/r75.out") $(A74)"

# 76. A computer with no start time on record (an update the harvester arrived by, the one-click
#     server) records the time of its first real run, and a dry run records nothing.
rm -f "$G7/prompts/archive/"*.jsonl
printf 'GODSPEED_PROMPT_SOURCES=\n' > "$H7/.godspeed/device.env"
( unset GODSPEED_PROMPT_SOURCES GODSPEED_PROMPT_SINCE; export HOME="$H7" GODSPEED_HOME="$H7" USERPROFILE="$H7"
  cd "$W" && "$PY" "$ARC" --godspeed "$G7" --dry-run archive ) >/dev/null 2>&1
grep -q '^GODSPEED_PROMPT_SINCE=' "$H7/.godspeed/device.env" && bad "76 a dry run wrote a start time" \
  || ok "76 a dry run records no start time"
run74 >"$W/r76.out" 2>&1
grep -Eq '^GODSPEED_PROMPT_SINCE=20[0-9]{2}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z$' "$H7/.godspeed/device.env" \
  && ok "76b the first real run records when this computer began saving" \
  || bad "76b no start time was recorded" "$(cat "$H7/.godspeed/device.env")"
[ -z "$(A74)" ] && ok "76c everything typed before that first run stays out" \
  || bad "76c older chats came in on the first run of an unticked computer" "$(A74)"
NOW="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
sleep 1
printf '%s\n' "{\"type\":\"user\",\"timestamp\":\"$(date -u -d '+1 minute' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v+1M +%Y-%m-%dT%H:%M:%SZ)\",\"message\":{\"content\":\"typed after the start about the Mallow budget\"}}" >> "$J7"
run74 >/dev/null 2>&1
A74 | grep -q 'Mallow budget' && ok "76d a chat typed after the first run is saved by the next" \
  || bad "76d a chat after the recorded start was not saved" "$(cat "$H7/.godspeed/device.env") $(A74)"

# 77. The switch for someone who insists: nothing is read.
rm -f "$G7/prompts/archive/"*.jsonl
printf 'GODSPEED_PROMPT_SOURCES=claude\nGODSPEED_PROMPT_ARCHIVE=off\n' > "$H7/.godspeed/device.env"
run74 >"$W/r77.out" 2>&1
[ -z "$(A74)" ] && grep -q 'switched off on this computer' "$W/r77.out" \
  && ok "77 GODSPEED_PROMPT_ARCHIVE=off saves nothing and says so" \
  || bad "77 the off switch did not stop the archive" "$(cat "$W/r77.out") $(A74)"

# 78 to 80. Search finds the right folder: the one you stand in, then the one the device file
#     names. A reader's folder is ~/godspeed-v2, and search used to look only in ~/godspeed.
rm -f "$G7/prompts/archive/"*.jsonl
printf 'GODSPEED_PROMPT_SOURCES=claude\n' > "$H7/.godspeed/device.env"
run74 >/dev/null 2>&1
mkdir -p "$G7/notes/deep"
S78="$( unset GODSPEED_DIR GODSPEED_WORKSPACE; export HOME="$H7" GODSPEED_HOME="$H7" USERPROFILE="$H7"
  cd "$G7/notes/deep" && "$PY" "$ARC" search Larkspur 2>&1 )"
echo "$S78" | grep -q 'new claude chat about the Larkspur' && ok "78 search from a folder inside the mission control finds it" \
  || bad "78 search ignored the mission control it was standing in" "$S78"
printf 'GODSPEED_DIR=%s\n' "$( (command -v cygpath >/dev/null && cygpath -m "$G7") || echo "$G7")" >> "$H7/.godspeed/device.env"
E79="$(dirname "$W")/elsewhere"; mkdir -p "$E79"
S79="$( unset GODSPEED_DIR GODSPEED_WORKSPACE; export HOME="$H7" GODSPEED_HOME="$H7" USERPROFILE="$H7"
  cd "$E79" && "$PY" "$ARC" search Larkspur 2>&1 )"
echo "$S79" | grep -q 'new claude chat about the Larkspur' && ok "79 search from anywhere else finds the folder ~/.godspeed/device.env names" \
  || bad "79 search did not read GODSPEED_DIR from the device file" "$S79"
S80="$( unset GODSPEED_DIR GODSPEED_WORKSPACE; export HOME="$H7" GODSPEED_HOME="$H7" USERPROFILE="$H7"
  cd "$E79" && "$PY" "$ARC" search nothing-like-this-anywhere 2>&1 )"
echo "$S80" | grep -q 'mc-prompt-archive archive' && ! echo "$S80" | grep -q 'godspeed prompts' \
  && ok "80 a miss names a command readers have (mc-prompt-archive), never the author's own" \
  || bad "80 the miss named a command readers do not have" "$S80"

# 81 and 82. The reader's own Godspeed assistant on Windows keeps its chats in a Hermes home of its
#     own, in the setup's state folder: "Godspeed Mission Control State" since 2.0.0-beta.11, and
#     "... Full Alpha State" on an install made before (81b); and any home an assistant.json names.
#     All are read without being told.
H81="$W/home81"; L81="$W/lad81"; HP81="$L81/Godspeed Mission Control State/hermes-profile"
HP81B="$L81/Godspeed Mission Control Full Alpha State/hermes-profile"
mkdir -p "$H81/.godspeed" "$HP81" "$HP81B" "$W/mc81/prompts/archive"
echo 'model: {}' > "$HP81/config.yaml"; echo 'model: {}' > "$HP81B/config.yaml"
"$PY" - "$HP81/state.db" "$W/assist82/state.db" "$HP81B/state.db" <<'PYEOF'
import sqlite3, sys, os
for db, words in ((sys.argv[1], "the Calathea plant food"), (sys.argv[2], "the Lupin seed order"), (sys.argv[3], "the Hosta division")):
    os.makedirs(os.path.dirname(db), exist_ok=True)
    con = sqlite3.connect(db)
    con.execute("CREATE TABLE sessions (id TEXT, source TEXT)")
    con.execute("CREATE TABLE messages (session_id TEXT, role TEXT, content TEXT, timestamp REAL)")
    con.execute("INSERT INTO sessions VALUES ('s1','desktop')")
    con.execute("INSERT INTO messages VALUES ('s1','user','Which was " + words + "?',1790000000)")
    con.execute("INSERT INTO messages VALUES ('s1','assistant','It was the one you picked.',1790000005)")
    con.commit()
PYEOF
mkdir -p "$W/mc81/.godspeed"
printf '{"verified":true,"home":"%s"}\n' "$( (command -v cygpath >/dev/null && cygpath -m "$W/assist82") || echo "$W/assist82")" > "$W/mc81/.godspeed/assistant.json"
printf 'GODSPEED_PROMPT_SOURCES=-\nGODSPEED_PROMPT_SINCE=2026-08-15T00:00:00Z\n' > "$H81/.godspeed/device.env"
( unset GODSPEED_HERMES_HOME HERMES_HOME GODSPEED_PROMPT_SOURCES
  export HOME="$H81" GODSPEED_HOME="$H81" USERPROFILE="$H81" GODSPEED_HERMES_NO_SYSTEM=1 \
         LOCALAPPDATA="$( (command -v cygpath >/dev/null && cygpath -w "$L81") || echo "$L81")" \
         GODSPEED_TELEGRAM_TRANSCRIPT="$W/none.jsonl"
  cd "$W" && "$PY" "$ARC" --godspeed "$W/mc81" archive ) >"$W/r81.out" 2>&1
A81="$(cat "$W/mc81/prompts/archive/"*.jsonl 2>/dev/null)"
echo "$A81" | grep 'Calathea' | grep -q '"project": "godspeed"' \
  && ok "81 the Windows assistant's own Hermes (\"Open the Windows assistant\") is read, as the mission control's assistant" \
  || bad "81 the Windows assistant's chats were not saved" "$(cat "$W/r81.out") $A81"
echo "$A81" | grep 'Hosta' | grep -q '"project": "godspeed"' \
  && ok "81b and so is the one of an install made before 2.0.0-beta.11, under the state folder's old name" \
  || bad "81b the Windows assistant under the state folder's old name was not read" "$(cat "$W/r81.out") $A81"
echo "$A81" | grep -q 'Lupin seed' && ok "82 a Hermes home named in .godspeed/assistant.json is read" \
  || bad "82 the home assistant.json names was not read" "$(cat "$W/r81.out") $A81"

# 83 to 85. The command runs where a reader is: by name through the harvester (which finds a Python
#     that works, Hermes' own included), and on Windows through its .cmd.
if command -v node >/dev/null 2>&1; then
  B83="$W/bin83"; mkdir -p "$B83"; cp "$ARC" "$HERE/prompt-harvest.js" "$HERE/mc-prompt-archive.cmd" "$B83/"; chmod +x "$B83/mc-prompt-archive"
  NODE_DIR83="$(dirname "$(command -v node)")"
  S83="$( unset GODSPEED_DIR GODSPEED_WORKSPACE; export HOME="$H7" GODSPEED_HOME="$H7" USERPROFILE="$H7"
    cd "$G7" && MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' "$B83/mc-prompt-archive" search Larkspur 2>&1 )"
  echo "$S83" | grep -q 'new claude chat about the Larkspur' && ok "83 mc-prompt-archive runs by name, the way the assistant's terminal runs it" \
    || bad "83 mc-prompt-archive by name did not search" "$S83"
  # A computer whose only Python is Hermes' own: a real venv where the Windows setup's Hermes keeps
  # it, and a PATH with node and none of the usual Pythons. The setup's state folder is "Godspeed
  # Mission Control State" since 2.0.0-beta.11 (84) and "... Full Alpha State" on an install made
  # before (84b).
  for C84 in "84:Godspeed Mission Control State" "84b:Godspeed Mission Control Full Alpha State"; do
  N84="${C84%%:*}"; L84="$W/lad$N84"
  V84="$L84/${C84#*:}/hermes-runtime/hermes-agent/venv"
  if "$PY" -m venv --without-pip "$V84" >/dev/null 2>&1; then
    S84="$( unset GODSPEED_DIR GODSPEED_WORKSPACE GODSPEED_PYTHON; export HOME="$H7" GODSPEED_HOME="$H7" USERPROFILE="$H7"
      export LOCALAPPDATA="$( (command -v cygpath >/dev/null && cygpath -w "$L84") || echo "$L84")"
      cd "$G7" && PATH="$NODE_DIR83" "$(command -v node)" "$B83/prompt-harvest.js" --collector search Larkspur 2>&1 )"
    VPY84="$V84/bin/python3"; [ -x "$VPY84" ] || VPY84="$V84/Scripts/python.exe"
    if PATH="$NODE_DIR83" command -v python3 >/dev/null 2>&1 || PATH="$NODE_DIR83" command -v python >/dev/null 2>&1; then
      echo "  --   $N84 skipped: node shares its folder with a Python here, so 'Hermes' Python only' cannot be staged"
    elif ! ( export LOCALAPPDATA="$( (command -v cygpath >/dev/null && cygpath -w "$L84") || echo "$L84")"; "$VPY84" -c 1 ) >/dev/null 2>&1; then
      echo "  --   $N84 skipped: a venv of this Python does not run once LOCALAPPDATA moves (the Microsoft Store Python)"
    else
      echo "$S84" | grep -q 'new claude chat about the Larkspur' && ok "$N84 with no Python on the PATH, Hermes' own Python runs it (${C84#*:})" \
        || bad "$N84 Hermes' own Python was not found (${C84#*:})" "$S84"
    fi
  else
    echo "  --   $N84 skipped: this Python cannot make a venv"
  fi
  done
  if command -v cmd >/dev/null 2>&1 && command -v cygpath >/dev/null 2>&1; then
    S85="$( unset GODSPEED_DIR GODSPEED_WORKSPACE; export HOME="$H7" GODSPEED_HOME="$H7" USERPROFILE="$(cygpath -w "$H7")"
      cd "$G7" && cmd //c "$(cygpath -w "$B83/mc-prompt-archive.cmd")" search Larkspur 2>&1 )"
    echo "$S85" | grep -q 'new claude chat about the Larkspur' && ok "85 mc-prompt-archive.cmd runs it from cmd and PowerShell" \
      || bad "85 mc-prompt-archive.cmd did not search" "$S85"
  else
    grep -q 'prompt-harvest.js" --collector' "$HERE/mc-prompt-archive.cmd" && ok "85 mc-prompt-archive.cmd hands over to the harvester (checked as text; no cmd here)" \
      || bad "85 mc-prompt-archive.cmd is missing or wrong"
  fi

  # 86 to 88. The harvest on a reader's new computer: a git folder with no first commit and no git
  #     name. It must succeed quietly, keep the archive, and touch nothing in git; and once there is
  #     a first commit it commits under the notebook's name and sends it to the backup, where a
  #     second machine's copy finds it.
  R86="$W/fresh86"; mkdir -p "$R86/home/.godspeed" "$R86/home/.claude/projects/p" "$R86/mc/prompts/archive" "$R86/mc/observations"
  cp "$J7" "$R86/home/.claude/projects/p/s.jsonl"
  printf 'GODSPEED_PROMPT_SOURCES=claude\n' > "$R86/home/.godspeed/device.env"
  git -C "$R86/mc" init -q
  : > "$R86/empty.gitconfig"
  harv86() { ( export HOME="$R86/home" USERPROFILE="$R86/home" GODSPEED_HOME="$R86/home" GODSPEED_DIR="$R86/mc" \
      GODSPEED_MACHINE=newpc GIT_CONFIG_GLOBAL="$R86/empty.gitconfig" GIT_CONFIG_NOSYSTEM=1
      unset GIT_AUTHOR_NAME GIT_COMMITTER_NAME GIT_AUTHOR_EMAIL GIT_COMMITTER_EMAIL EMAIL
      node "$HERE/prompt-harvest.js" --verbose "$@" 2>&1 ); }
  O86="$(harv86)"; RC86=$?
  [ "$RC86" -eq 0 ] && ! echo "$O86" | grep -qi 'identity unknown\|commit failed' && grep -rqs Larkspur "$R86/mc/prompts/archive/" \
    && ok "86 on a new computer with no backup yet the harvest succeeds quietly and the archive is kept" \
    || bad "86 the harvest failed or complained on a folder with no first commit" "rc=$RC86 $O86"
  [ -z "$(git -C "$R86/mc" status --porcelain --untracked-files=no 2>/dev/null)" ] \
    && ok "86b and it stages nothing in git" || bad "86b it staged files in a folder with no first commit" "$(git -C "$R86/mc" status --short)"
  git init -q --bare "$R86/backup.git"
  git -C "$R86/mc" -c user.name=T -c user.email=t@example.com commit -q --allow-empty -m "Save Godspeed Mission Control records"
  git -C "$R86/mc" remote add origin "$R86/backup.git"
  git -C "$R86/mc" push -q origin HEAD:main 2>/dev/null
  rm -f "$R86/home/.godspeed/prompt-harvest-last"
  O87="$(harv86)"; RC87=$?
  [ "$RC87" -eq 0 ] && git -C "$R86/mc" log -1 --format='%an|%s' | grep -q '^Godspeed Mission Control|Archive the prompts typed on newpc$' \
    && ok "87 with a first commit and still no git name, it commits under the notebook's name" \
    || bad "87 the commit failed or came out wrong" "rc=$RC87 $O87 $(git -C "$R86/mc" log -2 --format='%an %s')"
  git -C "$R86/backup.git" log main --format=%s 2>/dev/null | grep -q 'Archive the prompts typed on newpc' \
    && ok "87b and sends it to the backup" || bad "87b nothing reached the backup" "$O87"
  git clone -q -b main "$R86/backup.git" "$R86/second" 2>/dev/null
  S88="$( unset GODSPEED_DIR GODSPEED_WORKSPACE; export HOME="$W/home-second" GODSPEED_HOME="$W/home-second" USERPROFILE="$W/home-second"
    cd "$R86/second" && "$PY" "$ARC" search Larkspur 2>&1 )"
  echo "$S88" | grep -q 'new claude chat about the Larkspur' && echo "$S88" | grep -q 'newpc/claude-code' \
    && ok "88 a second machine's copy of the backup finds the chat, by the folder it stands in" \
    || bad "88 the second machine could not find the chat" "$S88"
else
  echo "  --   83-88 skipped: node is not on this machine"
fi

# 89. The starter tells the reader's assistant to look before saying it does not remember.
grep -qF -- '- When you cannot recall an earlier conversation, run `mc-prompt-archive search <words>` before saying you don'"'"'t know.' "$HERE/../starter-godspeed/AGENTS.md" \
  && ok "89 the starter AGENTS.md tells the assistant to search the archive when it cannot recall a conversation" \
  || bad "89 the starter AGENTS.md lacks the archive line"

echo
echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
