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
W="$HERE/.tmp-archive-test.$$"; rm -rf "$W"; mkdir -p "$W/observations" "$W/home"
trap 'rm -rf "$W"' EXIT
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
# bot, and to none of the other eight running beside it on the same server. Claire on the
# Pattern Lab board, the health advisor, three Ownward Studio desks: 281 prompts, thrown away,
# with every guard green, because the guards counted machines and the server was contributing.
# The cause was that the one bot was reached through a file a separate nightly job wrote for
# it, so covering a bot was a thing somebody had to remember to do, once per bot, for ever.
# The reader now goes to the store the bots write themselves. These cases hold that shut.
HH="$W/hermes"; mkdir -p "$HH/profiles/claire" "$HH/profiles/quiet-desk"
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

bot("claire", [
    ("s1", "telegram",   "user",      "what is the board deciding about the video script"),
    ("s1", "telegram",   "assistant", "Claire replying about the video script"),
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

# 25. And it says WHICH bot, because "telegram" alone cannot answer "what did I ask Claire".
echo "$B" | grep -q '"project": *"claire"' \
  && ok "25 the archived prompt names the bot you said it to" \
  || bad "25 the bot's name was not recorded"

# 26. A courier work order wears his role in the same table. It is our own machinery talking,
#     and archiving it would make every search return our words instead of his.
echo "$B" | grep -q "WORK ORDER" && bad "26 a work order from our own machinery was archived as his prompt" \
  || ok "26 a message our machinery injected is not archived"

# 27. The bot's reply is never a PROMPT, and the sessions where the mission control gives the bot work
#     stay out entirely - their "user" turns are a program talking, and so are their replies.
if echo "$B" | grep -q '"text": "Claire replying' || echo "$B" | grep -q "You are board desk"; then
  bad "27 the bot's replies or its work sessions were archived as prompts"
else
  ok "27 only his side of a real chat becomes a prompt"
fi
echo "$B" | grep '"text": "what is the board deciding' | grep -q "Claire replying about the video script" \
  && ok "27b the bot's reply is kept as the answer of his question" \
  || bad "27b the reply was not attached as the answer"

# 28. The guard that would have caught all of this: a source with prompts in it and none of
#     them archived must FAIL, by name. Counting machines could never see this.
rm -f "$W/prompts/archive/"*.jsonl
( export HOME="$W/home" GODSPEED_HOME="$W/home" GODSPEED_HERMES_HOME="$HH" GODSPEED_TELEGRAM_TRANSCRIPT="$W/none.jsonl"
  "$PY" "$ARC" --godspeed "$W" sources ) >"$W/src.out" 2>&1
SRC_RC=$?
[ "$SRC_RC" -ne 0 ] && grep -q "hermes/claire" "$W/src.out" \
  && ok "28 sources fails and names the bot whose prompts reach none of the archive" \
  || bad "28 an entirely unarchived source was reported as healthy" "rc=$SRC_RC $(cat "$W/src.out")"

# --- 29 to 31: the person's choice of sources is OBEYED ---------------------------------
#
# WHY THESE EXIST. Until 2026-08-11 this collector read every source it knew, on every
# machine, with nothing anywhere asking the person. The installer now shows what it found
# and records the choice as GODSPEED_PROMPT_SOURCES (environment, or ~/.godspeed/device.env for a
# scheduled run that has no environment). A source switched off must not be READ at all,
# and its silence must read as the person's choice, never as a leak.

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
grep -q "not read, by your choice: codex, hermes, opencode" "$W/pick.out" \
  && ok "29c the harvest says out loud what it left alone" \
  || bad "29c the restriction happened in silence" "$(cat "$W/pick.out")"

# 30. `sources` treats off as a decision: exit 0, and the off list is printed so the
#     morning selftest reads silence as a choice instead of alarming on it.
( export HOME="$W/home" GODSPEED_HOME="$W/home" GODSPEED_PROMPT_SOURCES="claude"
  "$PY" "$ARC" --godspeed "$W" sources ) >"$W/pick2.out" 2>&1
PICK_RC=$?
[ "$PICK_RC" -eq 0 ] && grep -q "switched off by your choice" "$W/pick2.out" \
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
grep -q "not read, by your choice: codex, hermes, opencode" "$W/pick3.out" \
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
  unset GODSPEED_HERMES_HOME; export HERMES_HOME="$HH3"
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
# Michael's machines went quiet the same day with no error anyone would see. The starter godspeed
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
  # An explicitly set GODSPEED_DIR is believed. Michael's PC had it set correctly the whole time and
  # was overruled on the strength of a missing folder, so "he told us" has to beat "it looks odd".
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
# 59. Not ticked means not opened.
rm -f "$W/prompts/archive/"*.jsonl
( export HOME="$W/home" GODSPEED_HOME="$W/home" GODSPEED_PROMPT_SOURCES="claude" GODSPEED_OPENCODE_DB="$OC"
  cd "$W" && "$PY" "$ARC" --godspeed "$W" archive ) >/dev/null 2>&1
cat "$W/prompts/archive/"*.jsonl 2>/dev/null | grep -q "hedge height" \
  && bad "59 OpenCode was read on a machine where it was switched off" \
  || ok "59 OpenCode switched off is not read"
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

echo
echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
