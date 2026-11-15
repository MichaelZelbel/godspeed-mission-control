#!/usr/bin/env bash
# goal-loop-inside.sh: the goal loop on a fresh install with a real AI, run INSIDE a fresh Ubuntu 24.04
# (goal-loop-wsl.sh makes the distro, runs this as root, keeps the log and removes the distro).
#
# WHY (18 October 2026). No install had ever gone the whole way round: a goal named, research, a
# decision, work done with tools and verified only by its own check, a reading told in the notebook,
# the verdict settled from the readings, and the next decision using it. This does exactly that, as a
# reader would, on the product commit under test, with the AI connected through the notebook's
# Settings form (POST /api/provider, what "Test and connect" sends), and Hermes, never Claude Code.
#
# THE DAY IS INJECTED, THE RECORDS ARE NOT. The first day (research, decision, work) runs dated eight
# days ago (GODSPEED_TODAY and --date, as the routines pass them), so that today falls inside the
# window settle judges in (seven to ten days after a step went live). No record is edited by hand:
# every line on the cards is written by the programs and the notebook.
#
# COST. Every AI step is preceded by a look at the key's remaining credit; below the floor the run
# stops and says which steps still need a real AI run.
#
# Usage (as root): goal-loop-inside.sh --commit <40 hex> --model <openrouter model> --key-file <file>
#                  --log <dir> [--floor <dollars>] [--research-minutes <n>]
# Ends with "ACCEPTANCE PASSED" (exit 0) or "ACCEPTANCE FAILED: ..." (exit 1); 2 = could not start.
set -uo pipefail
# THE WHOLE SCRIPT IS ONE FUNCTION, called on the last line (18 October 2026): bash reads a script
# while it runs, and the second run died with a syntax error when this file was edited beside it.
# A function is read whole before it starts.
main() {

COMMIT=""; MODEL=""; KEYFILE=""; LOG=""; FLOOR="0.05"; RESEARCH_MINUTES=45
while [ $# -gt 0 ]; do
  case "$1" in
    --commit) COMMIT="$2"; shift 2 ;;
    --model) MODEL="$2"; shift 2 ;;
    --key-file) KEYFILE="$2"; shift 2 ;;
    --log) LOG="$2"; shift 2 ;;
    --floor) FLOOR="$2"; shift 2 ;;
    --research-minutes) RESEARCH_MINUTES="$2"; shift 2 ;;
    *) echo "goal-loop-inside: I do not know $1" >&2; exit 2 ;;
  esac
done
[[ "$COMMIT" =~ ^[0-9a-f]{40}$ ]] || { echo "goal-loop-inside: --commit must be a full commit" >&2; exit 2; }
[ -n "$MODEL" ] && [ -s "$KEYFILE" ] && [ -n "$LOG" ] || { echo "goal-loop-inside: --model, --key-file and --log are needed" >&2; exit 2; }
[ "$(id -u)" = 0 ] || { echo "goal-loop-inside: run me as root" >&2; exit 2; }
mkdir -p "$LOG"; chmod 755 "$LOG"
# THE LAST LINE IS WRITTEN AFTER THE COPY TO run.log HAS ENDED (18 October 2026, third run). The
# verdict went through tee like everything else, and the run ended before tee wrote it: exit 0
# with no "ACCEPTANCE PASSED" line in run.log or on the screen. So the screen is kept on 3, and
# verdict() closes the copy, waits for tee to finish, then writes the line to both itself.
exec 3>&1
exec > >(tee -a "$LOG/run.log") 2>&1
TEE=$!
verdict() { exec 1>&3 2>&3; wait "$TEE" 2>/dev/null; echo "$1" | tee -a "$LOG/run.log"; exit "$2"; }

READER=reader; HOMEDIR=/home/$READER; MC=$HOMEDIR/godspeed-v2
# A PORT OF ITS OWN (18 October 2026, the first run). WSL 2 runs every distro in one machine with one
# network, so 127.0.0.1:47831 in a fresh distro can be another distro's notebook: the first run's
# install "answered" through someone else's notebook and its Settings request reached that one. This
# notebook gets a port nothing answers on, and every request below first checks it is this one.
PORT=""; NB=""
KIT=https://github.com/MichaelZelbel/godspeed-mission-control
TITLE="Write the first draft of my short story The Lighthouse Keeper"
DRAFT=drafts/lighthouse-keeper.md
D0="$(date -u -d '8 days ago' +%F)"; TODAY="$(date -u +%F)"
FAILS=(); STOPPED=""
step() { echo; echo "===== $(date -u +%H:%M:%S) $*"; }
ok() { echo "ok    $1"; }
fail() { FAILS+=("$1"); echo "FAIL  $1"; }
finish() {
  step "Evidence"
  cp -r "$MC/goals" "$LOG/goals" 2>/dev/null; cp -r "$MC/work" "$LOG/work" 2>/dev/null
  mkdir -p "$LOG/routines"; cp -r "$MC/routines/next-action" "$MC/routines/work" "$MC/routines/research" "$LOG/routines/" 2>/dev/null
  [ -f "$MC/$DRAFT" ] && cp "$MC/$DRAFT" "$LOG/draft.md"
  # What the work made, wherever its step put it in the mission control.
  for d in drafts templates; do [ -d "$MC/$d" ] && cp -r "$MC/$d" "$LOG/"; done
  curl -fsS "$NB/api/goals/overview" > "$LOG/goals-overview.json" 2>/dev/null
  curl -fsS "$NB/api/routine-ai" > "$LOG/routine-ai.json" 2>/dev/null
  mkdir -p "$LOG/hermes-cron-output"; cp -r "$HOMEDIR/.hermes/cron/output/." "$LOG/hermes-cron-output/" 2>/dev/null
  # Hermes' model section, without any key.
  sed -n '/^model:/,/^[^ ]/p' "$HOMEDIR/.hermes/config.yaml" 2>/dev/null | grep -v -i 'api_key' > "$LOG/hermes-model.txt"
  chmod -R a+rX "$LOG"
  ls -1 "$LOG"
  echo
  if [ -n "$STOPPED" ]; then verdict "ACCEPTANCE STOPPED: $STOPPED. Still needs a real AI run: ${*:-the steps after this point}" 1; fi
  if [ ${#FAILS[@]} -eq 0 ]; then verdict "ACCEPTANCE PASSED (commit $COMMIT, model $MODEL, first day $D0, today $TODAY, log $LOG/run.log)" 0; fi
  verdict "ACCEPTANCE FAILED: ${FAILS[*]}" 1
}
as_reader() { runuser -l "$READER" -c "export PATH=\"\$HOME/.local/bin:\$PATH\"; cd '$MC' 2>/dev/null; $1"; }
api() { # api GET|POST route [json]
  if [ "$1" = GET ]; then curl -sS -m 900 "$NB/api/$2"; else curl -sS -m 900 -X POST -H 'Content-Type: application/json' --data-binary "$3" "$NB/api/$2"; fi
}
json() { python3 -c "import json,sys; d=json.load(sys.stdin); exec(sys.argv[1])" "$1"; }
KEY="$(cat "$KEYFILE")"
# What is left on the test key, in dollars (OpenRouter's own account of it).
remaining() { curl -sS -m 30 -H "Authorization: Bearer $KEY" https://openrouter.ai/api/v1/key | json 'r=d["data"].get("limit_remaining"); print("unlimited" if r is None else round(r,4))'; }
budget() { # budget "<step>"
  local left; left="$(remaining)"; echo "credit left before $1: \$$left"
  if [ "$left" != unlimited ] && python3 -c "import sys; sys.exit(0 if float(sys.argv[1])<float(sys.argv[2]) else 1)" "$left" "$FLOOR"; then
    STOPPED="the test key has \$$left left, under the floor of \$$FLOOR, before $1"; finish "$1 and every step after it"
  fi
}

step "Goal loop acceptance: commit $COMMIT, model $MODEL, first day $D0, today $TODAY"
cat /etc/os-release | grep PRETTY_NAME
systemctl is-system-running 2>/dev/null | sed 's/^/systemd: /'

step "A reader on a fresh Ubuntu"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq >/dev/null && apt-get install -y -qq --no-install-recommends sudo curl git ca-certificates python3 jq xz-utils unzip locales >/dev/null || { fail "the base packages did not install"; finish; }
locale-gen en_US.UTF-8 >/dev/null 2>&1; update-locale LANG=en_US.UTF-8 >/dev/null 2>&1
id "$READER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$READER"
echo "$READER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/$READER; chmod 440 /etc/sudoers.d/$READER
loginctl enable-linger "$READER" >/dev/null 2>&1 || true
ok "user $READER, with sudo for the install only"
PORT=47931; while curl -fsS -m 3 "http://127.0.0.1:$PORT/health" >/dev/null 2>&1; do PORT=$((PORT + 1)); done
NB=http://127.0.0.1:$PORT
echo "this install's notebook will use port $PORT"

step "The installer of $COMMIT, as a release of it would pin it"
# install-godspeed.sh names the product commit it installs (and the URL of its notebook step); a
# release rewrites those pins to the commit it ships. Here they name the commit under test, which
# must be on GitHub. The kit-bootstrap pin stays as the commit wrote it.
# THE COMMANDS OF THE COMMIT, TOO (18 October 2026, third run). kit-bootstrap puts the commands
# (mc-research, mc-decide, mc-goals, mc-work, mc-work-run, ...) into ~/.local/bin from a shallow
# clone of the product's default branch, never from the pinned commit: after a release that branch
# is the release, but for a branch head under test it is the last release. The third run tested
# the branch's notebook and recipes with the last release's commands. So, as the engine's
# goal-day.sh does, the reader's git reads the product from a copy whose default branch is the
# commit under test, and the commands on the PATH are checked to be that commit's own.
KITCOPY=/opt/kit-under-test.git
rm -rf "$KITCOPY"; git init -q --bare "$KITCOPY" \
  && git -C "$KITCOPY" fetch -q --depth 1 "$KIT.git" "$COMMIT" \
  && git -C "$KITCOPY" update-ref refs/heads/main "$COMMIT" && git -C "$KITCOPY" symbolic-ref HEAD refs/heads/main \
  && chown -R "$READER:" "$KITCOPY" \
  || { fail "a copy of the product at $COMMIT could not be made"; finish; }
# Both spellings of the address lead to the copy (git takes the longest one that matches).
as_reader "git config --global --add url.$KITCOPY.insteadOf $KIT.git && git config --global --add url.$KITCOPY.insteadOf $KIT"
[ "$(as_reader "git ls-remote $KIT HEAD" | cut -f1)" = "$COMMIT" ] && [ "$(as_reader "git ls-remote $KIT.git HEAD" | cut -f1)" = "$COMMIT" ] \
  || { fail "the reader's git does not read the product from the copy"; finish; }
ok "the reader's git reads the product from a copy whose main is $COMMIT"
curl -fsSL "https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control/$COMMIT/install-godspeed.sh" -o /tmp/install-godspeed.sh || { fail "install-godspeed.sh could not be fetched at $COMMIT"; finish; }
OLD="$(sed -n 's/^export GODSPEED_PRODUCT_REF=//p' /tmp/install-godspeed.sh)"
[[ "$OLD" =~ ^[0-9a-f]{40}$ ]] || { fail "install-godspeed.sh names no product commit"; finish; }
sed "s/$OLD/$COMMIT/g" /tmp/install-godspeed.sh > "$HOMEDIR/install-godspeed.sh"; chown "$READER:" "$HOMEDIR/install-godspeed.sh"
grep -E '^(export GODSPEED_PRODUCT_REF|export GODSPEED_STARTER_REF|ENGINE)=' "$HOMEDIR/install-godspeed.sh"
T0=$(date +%s)
as_reader "GODSPEED_PORT=$PORT GODSPEED_FOOD_TABLE=off bash ~/install-godspeed.sh --sources '' < /dev/null > ~/install.out 2>&1"; IRC=$?
cp "$HOMEDIR/install.out" "$LOG/install.out"; tail -12 "$HOMEDIR/install.out"
echo "installer exit $IRC after $(( ($(date +%s) - T0) / 60 )) minutes"
[ "$IRC" = 0 ] && ok "the installer finished" || { fail "the installer ended with exit $IRC"; finish; }
rm -f /etc/sudoers.d/$READER; ok "sudo taken back: everything after this runs as an ordinary user"
for i in $(seq 1 60); do curl -fsS "$NB/health" >/dev/null 2>&1 && break; sleep 2; done
curl -fsS "$NB/health" | head -c 200; echo
echo "notebook version folder: $(cat "$MC/.godspeed/integrated-runtime/version" 2>/dev/null)"
case "$(cat "$MC/.godspeed/integrated-runtime/version" 2>/dev/null)" in *"${COMMIT:0:12}"*|*"$COMMIT"*) ok "the notebook runs commit $COMMIT" ;; *) fail "the notebook does not run commit $COMMIT" ;; esac
OWN="$(curl -fsS "$NB/api/about" 2>/dev/null | json 'print(d.get("folders",{}).get("workspace",""))')"
[ "$OWN" = "$MC" ] && ok "port $PORT is this install's notebook ($OWN)" || { fail "port $PORT answers for '$OWN', not for $MC"; finish; }
as_reader "command -v claude" >/dev/null 2>&1 && fail "Claude Code is on this computer; this test is for Hermes alone" || ok "no Claude Code here: the routines can only use Hermes"
STALE=""
for t in mc-research mc-decide mc-work-run goals.js work.js check-research.js; do
  # As root, on a copy the reader owns: git would refuse it as "dubious ownership" without safe.directory.
  git -c safe.directory="$KITCOPY" -C "$KITCOPY" show "$COMMIT:tools/$t" 2>/dev/null | cmp -s - "$HOMEDIR/.local/bin/$t" || STALE="$STALE $t"
done
[ -z "$STALE" ] && ok "the commands on the PATH are the commit's own (mc-research, mc-decide, mc-work-run, goals.js, work.js, check-research.js)" \
  || { fail "these commands on the PATH are not the commit's own:$STALE"; finish; }

step "The AI, connected the way Settings > Your AI does it"
BEFORE_AI="$(api GET routine-ai)"; echo "before: $BEFORE_AI"
budget "connecting the AI"
REQ="$(python3 -c 'import json,sys; print(json.dumps({"url":"https://openrouter.ai/api/v1/chat/completions","key":open(sys.argv[1]).read().strip(),"model":sys.argv[2],"routines":True}))' "$KEYFILE" "$MODEL")"
RES="$(api POST provider "$REQ")"
echo "$RES" | json 'r=d.get("routines") or {}; print({"connected":d.get("connected"),"provider":r.get("provider"),"model":r.get("model"),"source":r.get("source"),"key":r.get("key"),"check":r.get("check"),"error":d.get("error")})'
[ "$(echo "$RES" | json 'print((d.get("routines") or {}).get("check",{}).get("ok"))')" = True ] && ok "Settings says the routines reached the AI" || fail "the routines could not reach the AI after connecting it in Settings"
grep -q 'provider: "openrouter"' "$HOMEDIR/.hermes/config.yaml" && grep -q "default: \"$MODEL\"" "$HOMEDIR/.hermes/config.yaml" && ok "Hermes' own config names openrouter and $MODEL" || fail "Hermes' config does not name the connected AI"
[ ${#FAILS[@]} -eq 0 ] || finish

step "A goal, named in the notebook, with its weekly number"
RES="$(api POST setup "{\"goal\":\"$TITLE\",\"timezone\":\"UTC\",\"delivery\":\"notebook\"}")"; echo "$RES" | head -c 400; echo
GOAL="$(api GET goals/overview | json 'print(d["goals"][0]["id"] if d.get("goals") else "")')"
[ -n "$GOAL" ] && ok "goal $GOAL" || { fail "the goal was not filed"; finish; }
# The routines a first goal starts, paused at once so none fires on its own clock during the test
# (Settings > Routines, Pause); each one this test needs is resumed, run and paused again.
for i in $(seq 1 30); do N="$(api GET status | json 'print(len([j for j in d.get("schedules",[]) if j.get("native")]))')"; [ "${N:-0}" -ge 6 ] && break; sleep 2; done
api GET status | json 'print("\n".join("  "+j["id"]+"  "+str(j.get("title"))+"  next "+str(j.get("next_run")) for j in d.get("schedules",[]) if j.get("native")))'
[ "${N:-0}" -ge 6 ] && ok "$N routines started by the first goal" || fail "the first goal started ${N:-0} routines, not six or more"
for id in $(api GET status | json 'print(" ".join(j["id"] for j in d.get("schedules",[]) if j.get("native")))'); do api POST jobs/update "{\"id\":\"$id\",\"paused\":true}" >/dev/null; done
ok "routines paused until the test runs them"
DECIDE_JOB="$(api GET status | json 'print(next((j["id"] for j in d.get("schedules",[]) if j.get("native") and "choose" in str(j.get("title","")).lower()),""))')"
echo "the daily round's choice is Hermes job $DECIDE_JOB"
# What the reader says on the Goals page: the weekly number, and the count on the first day.
LEAD="words in $DRAFT | total | wc -w $DRAFT"
api POST functions/personal-operation "{\"type\":\"goal-change\",\"id\":\"$GOAL\",\"lead\":\"$LEAD\",\"reason\":\"Named on the Goals page\"}" | head -c 200; echo
api POST functions/personal-operation "{\"type\":\"goal-reading\",\"id\":\"$GOAL\",\"value\":0,\"where\":\"no draft yet, the day I started\",\"on\":\"$D0\"}" | json 'print("reading:",d.get("data",d).get("reading") if isinstance(d.get("data",d),dict) else d)'
grep -q "^LEAD: $LEAD" "$MC/goals/$GOAL.md" && ok "the weekly number is on the goal card" || fail "the weekly number is not on the goal card"
grep -q "^- $D0 READ 0 " "$MC/goals/$GOAL.md" && ok "the first day's reading, 0, is on the card" || fail "the first day's reading is not on the card"

step "Research, for real, dated $D0 (mc-research with Hermes, $RESEARCH_MINUTES minutes at most)"
budget "the research"
T0=$(date +%s)
as_reader "GODSPEED_RUNNER=hermes GODSPEED_TODAY=$D0 mc-research --only '$GOAL' --date $D0 --budget-minutes $RESEARCH_MINUTES --timeout-founding 900"; RRC=$?
echo "mc-research exit $RRC after $(( ($(date +%s) - T0) / 60 )) minutes; credit left \$$(remaining)"
as_reader "mc-goals research '$GOAL' --state --date $D0"
case "$RRC" in 0|1) ok "the research ran (exit $RRC; 1 is a night that fell short, which its gap file says)" ;; *) fail "the research could not run (exit $RRC)" ;; esac
[ -n "$(ls "$MC/goals/research/$GOAL/days/" 2>/dev/null)" ] && ok "the research wrote its day: $(ls "$MC/goals/research/$GOAL/days/" | tr '\n' ' ')" || fail "the research wrote no day record"

step "The decision, for real, dated $D0 (mc-decide with Hermes, as the 05:30 routine runs it)"
budget "the first decision"
T0=$(date +%s)
as_reader "GODSPEED_RUNNER=hermes GODSPEED_TODAY=$D0 mc-decide --date $D0"; DRC=$?
echo "mc-decide exit $DRC after $(( ($(date +%s) - T0) / 60 )) minutes; credit left \$$(remaining)"
DEC="$MC/routines/next-action/$D0/decision.md"
if [ -s "$DEC" ] && ! grep -q "did not finish and wrote no record of its own" "$DEC"; then ok "a real decision was written"; head -40 "$DEC"; else fail "no real decision for $D0"; fi
grep -q "Assistant: hermes" "$MC/routines/next-action/$D0/answer.txt" 2>/dev/null; grep -h "Assistant:" "$MC/routines/next-action/$D0/"*.stderr 2>/dev/null | head -2
grep " BET " "$MC/goals/$GOAL.md"
# The step followed is the first one with a bet that the mission control does itself (OWNER godspeed):
# a step that is the person's own (OWNER person) waits for them and can only go live when they act.
# The second run (18 October 2026) followed the first bet, a freewrite the person was to do, and
# called the work missing while the mission control's own two steps had been done and checked.
# THE SHIP LIST'S YES (18 October 2026, sixth run). The decision may put its own steps on the day's
# ship list (NEEDS authorization) instead of doing them unasked; then nothing runs until the person
# answers "ship all". The first step it can take on its own (NEEDS none) is followed; when every one
# waits on the ship list, the person answers it, and that answer reaches the register the way the
# next-action recipe says it does: mc-work unblock <id> --why "ship list answer" --approved-by
# "<their words>", for each step the list names that the mission control does.
BET=""; WAITING=()
for w in $(sed -n "s/^- [0-9-]* BET \([^ ]*\) .*/\1/p" "$MC/goals/$GOAL.md"); do
  grep -q '^OWNER: godspeed' "$MC/work/$w.md" 2>/dev/null || continue
  if grep -q '^NEEDS: none' "$MC/work/$w.md" || grep -q '^STATUS: verified' "$MC/work/$w.md"; then BET="$w"; break; fi
  grep -q '^NEEDS: authorization' "$MC/work/$w.md" && WAITING+=("$w")
done
if [ -z "$BET" ] && [ ${#WAITING[@]} -gt 0 ]; then
  step "The person answers the day's ship list: \"ship all\""
  for w in "${WAITING[@]}"; do as_reader "GODSPEED_TODAY=$D0 mc-work unblock $w --why 'ship list answer' --approved-by 'ship all' --date $D0"; done
  BET="${WAITING[0]}"
  grep -q '^APPROVED: .*ship all' "$MC/work/$BET.md" && ok "the answer is on the step: $(grep '^APPROVED:' "$MC/work/$BET.md")" || fail "the ship list's answer did not reach $BET"
fi
[ -n "$BET" ] && ok "the decision bet a step it does itself on the weekly number: $BET" || { fail "the decision made no step of its own with a bet on the weekly number"; finish; }

step "The work, for real, dated $D0 (mc-work-run with Hermes, the step the bet rides on)"
# A step the decision run already finished (a two-minute step, done and checked in the same run) is
# not run twice: what counts is that its own check verified it.
if grep -q "^STATUS: verified" "$MC/work/$BET.md"; then
  echo "the decision run already did $BET and its check verified it; the work run is not asked to do it again"
else
  budget "the work"
  T0=$(date +%s)
  as_reader "GODSPEED_RUNNER=hermes GODSPEED_TODAY=$D0 mc-work-run --date $D0 --only '$BET' --budget 1200"; WRC=$?
  echo "mc-work-run exit $WRC after $(( ($(date +%s) - T0) / 60 )) minutes; credit left \$$(remaining)"
fi
cat "$MC/work/$BET.md"
FILE="$(sed -n 's/^CHECK: test -f \(.*\)$/\1/p' "$MC/work/$BET.md")"
[ -n "$FILE" ] && [ -s "$MC/$FILE" ] && { echo "--- $FILE, first 15 lines"; head -15 "$MC/$FILE"; }
grep -q "^- $D0 VERIFIED check passed" "$MC/work/$BET.md" && ok "the step is verified by its own check" || fail "the step was not verified by its check"
as_reader "wc -w '$DRAFT'" && ok "the draft exists" || echo "note: no $DRAFT"

step "This week's number, told in the notebook today ($TODAY), as the Goals page sends it"
WORDS="$(as_reader "wc -w < '$DRAFT' 2>/dev/null || echo 0" | tr -d ' ')"
api POST functions/personal-operation "{\"type\":\"goal-reading\",\"id\":\"$GOAL\",\"value\":${WORDS:-0}}" | head -c 300; echo
grep -q "^- $TODAY READ ${WORDS:-0} (you entered it in the notebook)" "$MC/goals/$GOAL.md" && ok "the reading ${WORDS:-0} is on the card, dated today" || fail "the reading did not reach the goal card"

step "Settle: the verdict from the readings, today"
as_reader "mc-goals settle --date $TODAY"
RESULT="$(grep " RESULT $BET " "$MC/goals/$GOAL.md" | head -1)"
[ -n "$RESULT" ] && ok "verdict written by mc-goals: ${RESULT#* RESULT }" || fail "no verdict for $BET"

step "The next decision, for real, today, through Hermes' own routine (the 05:30 daily round)"
budget "the next decision"
api POST jobs/update "{\"id\":\"$DECIDE_JOB\",\"paused\":false}" >/dev/null
api POST jobs/run "{\"id\":\"$DECIDE_JOB\"}"; echo
T0=$(date +%s); NEXT="$MC/routines/next-action/$TODAY/decision.md"
# The run goes on in the background; it is done when Hermes wrote its output and the decision exists.
for i in $(seq 1 240); do
  OUT="$(ls -1t "$HOMEDIR/.hermes/cron/output/$DECIDE_JOB/" 2>/dev/null | head -1)"
  [ -n "$OUT" ] && [ -s "$NEXT" ] && ! pgrep -u "$READER" -f "mc-decide" >/dev/null && break
  sleep 15
done
api POST jobs/update "{\"id\":\"$DECIDE_JOB\",\"paused\":true}" >/dev/null
echo "the routine ran for $(( ($(date +%s) - T0) / 60 )) minutes; credit left \$$(remaining)"
[ -n "$OUT" ] && { echo "--- what the routine said (Hermes' record of the run)"; cat "$HOMEDIR/.hermes/cron/output/$DECIDE_JOB/$OUT"; } || fail "Hermes kept no record of the routine's run"
if [ -s "$NEXT" ] && ! grep -q "did not finish and wrote no record of its own" "$NEXT"; then ok "the next decision was written"; else fail "no real decision for $TODAY"; fi
echo "--- settle.txt"; cat "$MC/routines/next-action/$TODAY/settle.txt" 2>/dev/null
echo "--- the decision's first 50 lines"; head -50 "$NEXT" 2>/dev/null
VERDICT="$(printf '%s' "${RESULT#* RESULT $BET }" | cut -d: -f1)"
grep -q "$BET" "$MC/routines/next-action/$TODAY/settle.txt" 2>/dev/null && ok "the next decision was given the verdict (settle.txt)" || fail "settle.txt does not carry the verdict"
if grep -q -i -E "$BET|\\b$VERDICT\\b" "$NEXT" 2>/dev/null; then ok "the next decision uses the result: it names $( grep -o -i -E "$BET|\\b$VERDICT\\b" "$NEXT" | head -1)"; else fail "the next decision does not mention the verdict on $BET"; fi

step "The Goals page reads it back"
api GET goals/overview > "$LOG/goals-overview.json"
python3 - "$LOG/goals-overview.json" "$GOAL" "$BET" <<'PY'
import json,sys
d=json.load(open(sys.argv[1])); g=[x for x in d["goals"] if x["id"]==sys.argv[2]][0]
print("weekly number:", g["lead"]); print("readings:", [(r["date"],r["value"]) for r in g["readings"]])
print("bets:", [(b["work"],b["from"],b["to"],(b.get("result") or {}).get("verdict")) for b in g["bets"]])
print("work:", [(w["id"],w["status"],(w.get("verified") or {}).get("date")) for w in g["work"]])
print("decision today:", d["decision"] and d["decision"]["day"], "| for you:", d["decision"] and d["decision"]["for_you"][:200])
PY
python3 -c "import json,sys; d=json.load(open(sys.argv[1])); g=[x for x in d['goals'] if x['id']==sys.argv[2]][0]; b=[x for x in g['bets'] if x['work']==sys.argv[3]][0]; sys.exit(0 if b.get('result') and len(g['readings'])>=2 and d['decision'] and d['decision']['today'] else 1)" "$LOG/goals-overview.json" "$GOAL" "$BET" \
  && ok "the Goals page shows the readings, the verdict and today's decision" || fail "the Goals page misses the readings, the verdict or today's decision"

finish
}
main "$@"
