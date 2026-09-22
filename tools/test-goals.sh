#!/usr/bin/env bash
# The gate for mc-goals: the register of what you want and the choice of attention.
# The cases are the ones this register was built for: competing goals with a protected commitment,
# a provisional idea that never becomes work by itself, a change to an adopted goal that reaches
# the plans under it, a bottleneck diagnosis that turns out wrong, the easy-to-count not crowding
# out the meaningful, and a question you never answered not becoming a yes.
#
# Runs entirely inside a throwaway godspeed root. It never reads or writes the real goals/.
# Usage: bash tools/test-goals.sh   (from a checkout of this kit)
set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
NODE=""
for c in node nodejs /usr/local/bin/node /usr/bin/node; do
  "$c" -e '' >/dev/null 2>&1 && { NODE="$c"; break; }
done
[ -n "$NODE" ] || { echo "FAIL: no node on this box"; exit 1; }

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/rules" "$TMP/bin"
: > "$TMP/AGENTS.md"
cp "$HERE/goals.js" "$HERE/work.js" "$HERE/forecast.js" "$TMP/bin/"
cp "$HERE/mc-cards.js" "$TMP/bin/"
export GODSPEED_ROOT="$TMP"
export GODSPEED_TODAY="2026-09-13"
hg() { "$NODE" "$TMP/bin/goals.js" "$@"; }
hw() { "$NODE" "$TMP/bin/work.js" "$@"; }
hf() { "$NODE" "$TMP/bin/forecast.js" "$@"; }

PASS=0; FAIL=0
ok()   { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad()  { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
check() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (wanted [$3], got [$2])"; fi; }
contains() { case "$2" in *"$3"*) ok "$1";; *) bad "$1 (missing [$3] in: $(printf '%s' "$2" | head -5))";; esac; }
missing()  { case "$2" in *"$3"*) bad "$1 (should not contain [$3])";; *) ok "$1";; esac; }

echo "mc-goals gate"

# --- filing --------------------------------------------------------------------------------
OUT="$(hg file --kind outcome --title "Age healthy, strong in my 90s" --id health --area health --status adopted --importance core --source "said it on 2026-09-06" 2>&1)"
contains "an adopted outcome files" "$OUT" "health: adopted outcome filed"
OUT="$(hg file --kind outcome --title "No source" 2>&1)"; check "a goal without a source is refused (never a goal the mission control invented)" "$?" "1"
contains "  and says why" "$OUT" "source is required"
OUT="$(hg file --kind outcome --title "Weighted" --source x --importance 7 2>&1)"; check "a numeric importance is refused" "$?" "1"
contains "  your word for it, never a number" "$OUT" "never a number"
OUT="$(hg file --kind outcome --title "Enough saved to stop worrying about money" --id money --area money --source "said it in a chat on 2026-09-13" 2>&1)"
contains "a provisional idea files as provisional by default" "$OUT" "money: provisional outcome filed"
contains "  and says it is never acted on until adopted" "$OUT" "never acted on as a goal until adopted"
OUT="$(hg file --kind strategy --title "Known for one thing in my field" --id lead --serves money --status adopted --source "said it on 2026-08-30" --deadline 2026-11-30 2>&1)"
contains "an adopted strategy may serve a provisional outcome" "$OUT" "lead: adopted strategy filed"
OUT="$(hg file --kind strategy --title "Orphan" --serves nowhere --source x 2>&1)"; check "serving a goal that is not on the register is refused" "$?" "1"
OUT="$(hg file --kind commitment --title "Client work, booked until the end of September" --id client --area work --status adopted --source "said it on 2026-09-04" --cadence "weekdays" 2>&1)"
contains "a commitment files protected" "$OUT" "client: adopted commitment filed"
check "  PROTECTED yes by default for a commitment" "$(grep -c '^PROTECTED: yes' "$TMP/goals/client.md")" "1"
OUT="$(hg file --kind outcome --title "Five people I call friends" --id friends --area relationships --deadline unresolved --source "chat 2026-09-13" 2>&1)"
contains "an unresolved deadline is allowed as the word unresolved" "$OUT" "friends: provisional outcome filed"
OUT="$(hg file --kind outcome --title "Bad date" --deadline "next year" --source x 2>&1)"; check "a vague deadline is refused" "$?" "1"
OUT="$(hg file --kind outcome --title "Age healthy" --id health --source x --status adopted 2>&1)"; check "the same id twice is refused" "$?" "1"

# --- attention: competing goals, a protected commitment, provisional never active ------------
hg file --kind outcome --title "The mission control as a real working system" --id godspeed --area godspeed --status adopted --importance high --source "priorities 2026-06-15" --deadline 2026-09-15 >/dev/null
hg file --kind outcome --title "Ship the kits with a first market signal" --id kits --area money --status adopted --importance high --source "priorities 2026-06-15" --deadline 2026-09-15 >/dev/null
hg file --kind outcome --title "Keep the friendships I have" --id keep-friends --area relationships --status adopted --source "chat" >/dev/null
OUT="$(hg attention 2>&1)"
contains "the protected commitment keeps its slot" "$OUT" "protected:"
contains "  and is named" "$OUT" "client"
contains "active outcomes are at most three" "$OUT" "at most 3 outcomes active"
contains "a deadline within seven days earns a seat with the reason" "$OUT" "deadline in 2 day(s)"
contains "the strategy under a provisional outcome stands on its own and says so" "$OUT" "serves money, which is provisional: stands on its own"
contains "a provisional idea is listed as provisional, never active" "$OUT" "provisional (never acted on)"
missing  "  and money is not in the active rows" "$(printf '%s' "$OUT" | sed -n '/^active:/,/^quiet today:/p')" "money "
contains "the quiet ones carry the reason they are quiet" "$OUT" "quiet today:"
contains "  naming who took the seats" "$OUT" "outcomes already active"
contains "one clarifying question a day at most, and it names the goal" "$OUT" "one question today may go to:"
J="$(hg attention --json 2>&1)"
ACTIVE_N="$(printf '%s' "$J" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);console.log(p.active.length)})')"
check "  json: exactly three active" "$ACTIVE_N" "3"
ASK="$(printf '%s' "$J" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);console.log(p.ask?p.ask.id:"none")})')"
check "  json: the question goes to the oldest provisional idea" "$ASK" "friends"
# a goal without a measure is not pushed down for that reason: neglect counts from the last look
OUT="$(hg attention --active 1 2>&1)"
contains "with one seat the red deadline wins" "$(printf '%s' "$OUT" | sed -n '/^active:/,/^quiet/p')" "deadline in 2 day(s)"

# --- neglect guard: the easy-to-count cannot crowd out the meaningful ----------------------------
hg attention --record --why "day one" >/dev/null 2>&1
# Give the deadline goals progress every day; the relationships outcome gets none and is never looked at.
for D in 2026-09-14 2026-09-15 2026-09-16 2026-09-17 2026-09-18 2026-09-19 2026-09-20; do
  GODSPEED_TODAY=$D hg progress godspeed --evidence "another commit landed" >/dev/null
  GODSPEED_TODAY=$D hg progress kits --evidence "another listing draft" >/dev/null
  GODSPEED_TODAY=$D hg attention --record --active 2 >/dev/null 2>&1
done
check "within the week the never-looked-at outcome was rotated in at least once" "$(grep -c '^- 2026-09-1[4-9] ATTENTION' "$TMP/goals/keep-friends.md" | awk '{print ($1>=1)?"yes":"no"}')" "yes"
contains "  with neglect as the stated reason" "$(grep 'ATTENTION' "$TMP/goals/keep-friends.md")" "looked at"
OUT="$(GODSPEED_TODAY=2026-09-30 hg attention --active 2 2>&1)"
contains "a passed deadline is a re-set flag, not urgency" "$OUT" "deadline passed"
missing  "  and does not by itself hold a seat over a neglected outcome" "$(printf '%s' "$OUT" | sed -n '/^active:/,/^quiet/p' | head -2)" "kits"

# --- a change to an adopted goal keeps its reason and reaches the plan under it ----------------
hw file --what "Draft three lines for the mission-control position" --done-when "a card with the lines exists" --goal lead --source test >/dev/null
hf file --question "One of the drafted lines is posted by 2026-09-26" --resolves-when "a post card carries OUTCOME posted with a link" --deadline 2026-09-26 --p 0.2 --reference-class "nine post cards shown in 14 days, none posted" --evidence "the outcomes table" --goal lead >/dev/null
OUT="$(hg change lead --set "DEADLINE=2026-12-31" 2>&1)"; check "a change without a reason is refused" "$?" "1"
OUT="$(hg change lead --set "DEADLINE=2026-12-31" --why "you moved the checkpoint on 2026-09-13" 2>&1)"
contains "a change is recorded" "$OUT" "lead: changed DEADLINE"
check "  the old value stays in the log" "$(grep -c 'CHANGED DEADLINE "2026-11-30" -> "2026-12-31" because you moved' "$TMP/goals/lead.md")" "1"
contains "  the work under it is marked stale, not deleted" "$OUT" "marked stale"
check "  (in the work file)" "$(grep -c '^STATUS: stale' "$TMP/work/"W-*.md)" "1"
contains "  the open forecast under it gets a review line" "$OUT" "review line written on 1 open forecast"
OUT="$(hg change lead --set "SERVES=nowhere" --why x 2>&1)"; check "serving a missing goal is refused on change too" "$?" "1"
hg file --kind project --title "Write the book" --id book --serves lead --status adopted --source x >/dev/null
OUT="$(hg change lead --set "STATUS=paused" --why "you said stop for two weeks" 2>&1)"
contains "pausing a goal cancels the work under it" "$OUT" "work:"
check "  the project serving it got a REVIEW line" "$(grep -c '^- 2026-09-13 REVIEW lead changed STATUS' "$TMP/goals/book.md")" "1"
OUT="$(hg attention 2>&1)"; missing "a paused goal is out of the active rows" "$(printf '%s' "$OUT" | sed -n '/^active:/,/^provisional/p')" "  lead "
hg adopt money --why "you said on 2026-09-20: yes, make it a goal" >/dev/null 2>&1
check "adopting a provisional idea writes the ADOPTED line with your words" "$(grep -c '^- 2026-09-13 ADOPTED you said on 2026-09-20' "$TMP/goals/money.md")" "1"

# --- questions: one in seven days, silence is never a yes --------------------------------------
OUT="$(hg question friends --text "Is five friends by the end of 2027 a goal you want the mission control to work on?" 2>&1)"
contains "a question is recorded" "$OUT" "friends: question recorded"
OUT="$(hg question friends --text "again" 2>&1)"; check "a second question while one is open is refused" "$?" "1"
contains "  and says to record the answer first" "$OUT" "record the answer first"
OUT="$(hg attention 2>&1)"
contains "an open question shows on the provisional row" "$OUT" "question open since 2026-09-13"
OUT="$(GODSPEED_TODAY=2026-09-30 hg attention 2>&1)"
missing "silence for 17 days does not adopt the goal" "$(printf '%s' "$OUT" | sed -n '/^active:/,/^provisional/p')" "  friends "
hg answer friends --text "not now, ask me in December" >/dev/null
check "your answer is stored word for word" "$(grep -c 'ANSWER "not now, ask me in December"' "$TMP/goals/friends.md")" "1"
hg file --kind outcome --title "Reassess me" --id reassess --status adopted --source x >/dev/null
hg question reassess --text "still wanted?" --date 2026-09-01 >/dev/null
OUT="$(GODSPEED_TODAY=2026-09-20 hg attention 2>&1)"
contains "an adopted goal with a question unanswered for two weeks says reassess, not yes" "$OUT" "unanswered for 19 days: reassess"

# --- diagnosis: a wrong bottleneck is recorded as wrong, never quietly kept -----------------------
P="$(hg diagnose kits 2>&1)"
contains "diagnose writes a template with the honest sections" "$P" "goals/diagnoses/kits-2026-09-13.md"
for H in "## Competing explanations" "## Verified" "## Inferred" "## Open questions" "## Disconfirmed if" "## Method"; do
  check "  section $H present" "$(grep -c "^$H" "$TMP/$P")" "1"
done
# fill a diagnosis that claims a constraint but forgets what would disprove it
"$NODE" -e '
const fs=require("fs");const p=process.argv[1];let t=fs.readFileSync(p,"utf8");
t=t.replace(/STATUS: draft/,"STATUS: current").replace(/## Constraint claimed\n\(.*?\)\n/s,"## Constraint claimed\nno buyer sees the kit\n").replace(/## Disconfirmed if\n\(.*?\)\n/s,"## Disconfirmed if\n\n");
fs.writeFileSync(p,t)' "$TMP/$P"
OUT="$(hg check 2>&1)"; check "check fails on a constraint with no disconfirming condition" "$?" "1"
contains "  and names it" "$OUT" "without saying what would disprove it"
"$NODE" -e '
const fs=require("fs");const p=process.argv[1];let t=fs.readFileSync(p,"utf8");
t=t.replace(/## Disconfirmed if\n\n/,"## Disconfirmed if\nthe kit page gets 50 human views in a week and still no sale\n");
fs.writeFileSync(p,t)' "$TMP/$P"
OUT="$(hg check 2>&1)"; check "check passes once the disconfirming condition is written" "$?" "0"
OUT="$(hg diagnose kits --refute "$P" --evidence "the page had 80 human views this week and no sale, so visibility was not the constraint" 2>&1)"
contains "refuting a diagnosis is recorded" "$OUT" "diagnosis refuted"
check "  the diagnosis file says refuted with the date" "$(grep -c '^STATUS: refuted 2026-09-13' "$TMP/$P")" "1"
check "  the goal log carries REFUTED with the evidence" "$(grep -c 'REFUTED goals/diagnoses/kits-2026-09-13.md: the page had 80' "$TMP/goals/kits.md")" "1"
OUT="$(hg attention 2>&1)"
contains "the next plan asks for a new diagnosis before acting" "$OUT" "diagnosis was refuted: diagnose again before acting"

# --- lists, tree, check ----------------------------------------------------------------------------
OUT="$(hg tree 2>&1)"
contains "tree shows what serves what" "$OUT" "  book [project, adopted]"
OUT="$(hg list 2>&1)"
contains "list shows provisional and adopted, not paused" "$OUT" "provisional outcome     friends"
missing  "  paused is out of the default list" "$OUT" "paused      strategy    lead"
OUT="$(hg list --all 2>&1)"; contains "  --all shows it" "$OUT" "lead"
sed -i 's/^STATUS: adopted/STATUS: bogus/' "$TMP/goals/reassess.md"
OUT="$(hg check 2>&1)"; check "check refuses an unknown status" "$?" "1"

# --- playbook: how a goal is won is researched from people who won it, never assumed ------------
sed -i 's/^STATUS: bogus/STATUS: adopted/' "$TMP/goals/reassess.md"
hg file --kind outcome --title "Twenty paying readers of the newsletter" --id zz-readers --status adopted --source "chat 2026-09-13" >/dev/null
hg file --kind outcome --title "A talk accepted at one conference" --id aa-talk --status adopted --source "chat 2026-09-13" >/dev/null
P="$(hg playbook aa-talk 2>&1)"
check "playbook writes goals/playbooks/<id>.md and prints the path" "$P" "goals/playbooks/aa-talk.md"
for H in "## Who we model" "## What they do" "## In what order" "## What they track" "## Where it fails" "## Godspeed steps" "## Person steps" "## Unknown" "## Sources"; do
  check "  section $H present" "$(grep -c "^$H" "$TMP/$P")" "1"
done
check "  it starts as a draft with a review date 30 days on" "$(grep -c '^REVIEW BY: 2026-10-13' "$TMP/$P")$(grep -c '^STATUS: draft' "$TMP/$P")" "11"
check "  the card carries the PLAYBOOK line" "$(grep -c '^- 2026-09-13 PLAYBOOK goals/playbooks/aa-talk.md' "$TMP/goals/aa-talk.md")" "1"
P2="$(hg playbook aa-talk 2>&1)"; check "a second call prints the path" "$P2" "$P"
check "  and makes no second file" "$(ls "$TMP/goals/playbooks" | wc -l | tr -d ' ')" "1"
check "  and no second PLAYBOOK line" "$(grep -c ' PLAYBOOK ' "$TMP/goals/aa-talk.md")" "1"
OUT="$(hg attention --json 2>&1)"
DRAFT="$(printf '%s' "$OUT" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);console.log(p.active.concat(p.quiet).find(r=>r.id==="aa-talk").playbook)})')"
check "the plan sees the draft" "$DRAFT" "draft"
contains "  and says it is not filled in" "$(hg attention 2>&1)" "playbook is a draft, not yet filled in"
OUT="$(hg playbook aa-talk --current 2>&1)"; check "--current is refused while a placeholder remains" "$?" "1"
contains "  and names the section" "$OUT" "still carries the template placeholder under: Who we model"
"$NODE" -e '
const fs=require("fs");const p=process.argv[1];let t=fs.readFileSync(p,"utf8");
t=t.split("\n").map(l=>l.startsWith("(")?"filled in from the sources below":l).join("\n");
fs.writeFileSync(p,t)' "$TMP/$P"
OUT="$(hg playbook aa-talk --current 2>&1)"; check "--current succeeds once every section is written" "$?" "0"
check "  STATUS reads current" "$(grep -c '^STATUS: current' "$TMP/$P")" "1"
check "  REVIEW BY is 30 days on" "$(grep -c '^REVIEW BY: 2026-10-13' "$TMP/$P")" "1"
OUT="$(hg attention 2>&1)"
contains "an adopted outcome without a playbook says so on its row" "$OUT" "no playbook: how this goal is won has not been researched"
J="$(hg attention --json 2>&1)"
ORDER="$(printf '%s' "$J" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);const ids=p.active.concat(p.quiet).map(r=>r.id);console.log(ids.indexOf("zz-readers")<ids.indexOf("aa-talk")?"no-playbook-first":"playbook-first")})')"
check "  and it outranks an otherwise-equal outcome that has a current playbook" "$ORDER" "no-playbook-first"
PB="$(printf '%s' "$J" | "$NODE" -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const p=JSON.parse(s);const r=p.active.concat(p.quiet);console.log(r.find(x=>x.id==="aa-talk").playbook+" "+r.find(x=>x.id==="zz-readers").playbook)})')"
check "  json carries the playbook state on both rows" "$PB" "current none"
OUT="$(GODSPEED_TODAY=2026-10-20 hg attention 2>&1)"
contains "past its review date the playbook counts as stale" "$OUT" "playbook past its review date"
OUT="$(hg playbook aa-talk --refute 2>&1)"; check "--refute without evidence is refused" "$?" "1"
contains "  and says why" "$OUT" "evidence is required"
check "  and the file is untouched" "$(grep -c '^STATUS: current' "$TMP/$P")" "1"
OUT="$(hg playbook aa-talk --refute --evidence "two of the three speakers modelled were invited, none came through a cold submission" 2>&1)"
contains "refuting a playbook is recorded" "$OUT" "playbook refuted"
check "  the file says refuted with the date" "$(grep -c '^STATUS: refuted 2026-09-13' "$TMP/$P")" "1"
check "  and carries the evidence" "$(grep -c '^- 2026-09-13 two of the three speakers' "$TMP/$P")" "1"
check "  the card carries PLAYBOOK-REFUTED with the evidence" "$(grep -c 'PLAYBOOK-REFUTED goals/playbooks/aa-talk.md: two of the three' "$TMP/goals/aa-talk.md")" "1"
OUT="$(hg attention 2>&1)"
contains "  the next plan asks for new research before acting" "$OUT" "its playbook was refuted: research it again before acting"
OUT="$(hg check 2>&1)"; check "check notes a missing playbook and still passes" "$?" "0"
contains "  naming the command that writes one" "$OUT" "note zz-readers: no playbook yet (mc-goals playbook zz-readers)"
contains "  and the refuted one" "$OUT" "note aa-talk: playbook refuted, research again"
missing  "  neither is a PROBLEM" "$OUT" "PROBLEM"
rm "$TMP/$P"
OUT="$(hg check 2>&1)"; check "a playbook file deleted after filing is a PROBLEM" "$?" "1"
contains "  and names it" "$OUT" "PROBLEM aa-talk: PLAYBOOK line names a file that is gone"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
