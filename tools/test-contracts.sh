#!/usr/bin/env bash
# test-contracts.sh - the gate for contracts.js: three Germany contracts (electricity with no
# service, car insurance, statutory health insurance) and what the watcher says about each, once.
# Runs inside a throwaway mission control with a fixed date. Needs node only.
# Usage: bash tools/test-contracts.sh
set -uo pipefail
. "$(dirname "$0")/test-guard.bash"
HERE="$(cd "$(dirname "$0")" && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP" "$TEST_GUARD_HOME"' EXIT
G="$TMP/godspeed"; mkdir -p "$G"; : > "$G/AGENTS.md"
c() { GODSPEED_ROOT="$G" node "$HERE/contracts.js" --godspeed "$G" "$@"; }
on() { local d="$1"; shift; c "$@" --date "$d"; }
PASS=0; FAIL=0
ok() { PASS=$((PASS+1)); echo "ok   $1"; }
bad() { FAIL=$((FAIL+1)); echo "FAIL $1"; echo "$2" | sed 's/^/     /'; }
has() { if printf '%s' "$3" | grep -qF -- "$2"; then ok "$1"; else bad "$1" "wanted: $2
got: $3"; fi; }
lacks() { if printf '%s' "$3" | grep -qF -- "$2"; then bad "$1" "did not want: $2
got: $3"; else ok "$1"; fi; }
count() { printf '%s' "$1" | grep -c "$2" || true; }

c add strom --kind electricity --country DE --provider "Stadtwerke" --looked-after nobody --source chat --seen 2026-09-01 >/dev/null
c add kfz --kind car-insurance --country DE --provider "Versicherer" --price-per-year 600 --source letter --seen 2026-09-01 >/dev/null
c add tk --kind health-insurance --country DE --provider "Krankenkasse" --source pay-slip --seen 2026-09-01 >/dev/null
c add abo --kind internet --country DE --provider "Netz" --source chat >/dev/null

# (a) the acceptance outcomes, one each
out="$(on 2026-11-03 watch)"
has "electricity: a service is offered" "strom offer-service" "$out"
has "car insurance: the window is open in early November" "kfz window-open:2026 by 2026-11-30" "$out"
lacks "health insurance: nothing without an event" "tk " "$out"
has "no playbook: no advice, and it says so" "no valid playbook for DE/internet" "$out"
lacks "no playbook: no trigger" "abo " "$out"
c mark-notified strom offer-service --date 2026-11-03 >/dev/null; c mark-notified kfz window-open:2026 --date 2026-11-03 >/dev/null
out="$(on 2026-11-04 watch)"
has "nothing repeats on a second watch" "note: abo" "$out"
lacks "offer-service once" "offer-service" "$out"
lacks "window once" "window-open" "$out"

c event tk --type contribution-rise --date 2026-11-05 --effective 2026-12-01 --old 20 --new 45 --source pay-slip >/dev/null
out="$(on 2026-11-06 watch --json)"
has "health: one special right with its deadline" '"deadline": "2026-12-31"' "$out"
has "health: yearly extra cost from the person's numbers" '"yearly_cost": 300' "$out"
c event kfz --type price-rise --date 2026-03-10 --old 600 --new 700 --source letter >/dev/null
out="$(on 2026-03-12 watch)"
has "car: a price rise letter opens the four-week route" "kfz special-right:price-rise:2026-03-10 by 2026-04-07" "$out"
out="$(on 2026-04-08 watch)"
lacks "car: after the four weeks, silent" "special-right:price-rise" "$out"

# (a) electricity: speaks once after a year without a confirmation
c add strom --kind electricity --country DE --looked-after switching-service --service-since 2025-09-01 --source notebook >/dev/null
out="$(on 2026-10-01 watch)"; lacks "electricity: not before a year and the grace" "yearly-check" "$out"
out="$(on 2026-11-10 watch)"; has "electricity: speaks after a year without a switch confirmation" "strom yearly-check:2025-09-01" "$out"
c mark-notified strom yearly-check:2025-09-01 --date 2026-11-10 >/dev/null
lacks "electricity: only once" "yearly-check" "$(on 2026-12-20 watch)"

# (b) expired playbook
out="$(on 2027-06-01 watch)"
has "expired playbook: no advice" "no valid playbook for DE/electricity" "$out"
has "playbooks lists it as expired" "de/electricity: de-electricity@1 expired" "$(on 2027-06-01 playbooks)"

# (c) threshold
c add tk2 --kind health-insurance --country DE --source letter >/dev/null
c event tk2 --type contribution-rise --date 2026-11-05 --effective 2026-12-01 --old 20 --new 22 --source letter >/dev/null
lacks "a small saving is silent" "tk2 " "$(on 2026-11-06 watch)"
c add tk3 --kind health-insurance --country DE --source letter >/dev/null
c event tk3 --type contribution-rise --date 2026-11-05 --effective 2026-12-01 --source letter >/dev/null
out="$(on 2026-11-06 watch)"; has "an unknown cost still speaks" "tk3 special-right" "$out"

# (d) a rule that changes: one correction, then silent; an unchanged deadline is silent
c mark-notified tk special-right:contribution-rise:2026-11-05 --date 2026-11-06 >/dev/null
PB="$TMP/tools"; mkdir -p "$PB"; cp -r "$HERE/contracts.js" "$PB/"; cp -r "$HERE/playbooks" "$PB/"
node -e '
const fs=require("fs"),f=process.argv[1];const p=JSON.parse(fs.readFileSync(f));p.version=2;p.dates.special_right.until=null;p.dates.special_right.days_after_event=28;fs.writeFileSync(f,JSON.stringify(p));' "$PB/playbooks/de/health-insurance.json"
c2() { GODSPEED_ROOT="$G" node "$PB/contracts.js" --godspeed "$G" "$@"; }
out="$(c2 watch --date 2026-11-10 --json)"
has "a changed rule gives one correction" 'correction:special-right:contribution-rise:2026-11-05@2' "$out"
has "…naming the old deadline" '"was_deadline": "2026-12-31"' "$out"
c2 mark-notified tk correction:special-right:contribution-rise:2026-11-05@2 --date 2026-11-10 >/dev/null
lacks "…and only one" "correction" "$(c2 watch --date 2026-11-11)"
sed -i 's/"days_after_event":28/"days_after_event":56/' "$PB/playbooks/de/health-insurance.json"
node -e 'const fs=require("fs"),f=process.argv[1];const p=JSON.parse(fs.readFileSync(f));p.version=3;p.dates.special_right.days_after_event=null;p.dates.special_right.until="end-of-month-of-effect";fs.writeFileSync(f,JSON.stringify(p));' "$PB/playbooks/de/health-insurance.json"
lacks "a new version with the same deadline is silent" "correction" "$(c2 watch --date 2026-11-12)"

# (e) a fact without a source is refused
out="$(c add x --kind electricity --country DE --price-per-year 10 2>&1)"; has "no source, no fact" "every fact needs a source" "$out"
out="$(c event tk --type price-rise --date 2026-11-01 2>&1)"; has "no source, no event" "every fact needs a source" "$out"
has "prepare waits for the question" "ask first" "$(c prepare kfz special-right:price-rise:2026-03-10 2>&1)"

# (f) prepare writes only under contracts/
before="$(cd "$G" && find . -type f | sort)"
c prepare kfz window-open:2026 --date 2026-11-04 >/dev/null
after="$(cd "$G" && find . -type f | sort)"
added="$(diff <(echo "$before") <(echo "$after") | grep '^>' | sed 's/^> //')"
if [ "$added" = "./contracts/kfz/prepared/window-open_2026.md" ]; then ok "prepare adds one page under contracts/<slug>/prepared/"; else bad "prepare adds one page under contracts/<slug>/prepared/" "$added"; fi
has "the page carries the person's facts and the route" "price per year: 600 (letter, 2026-09-01)" "$(cat "$G/contracts/kfz/prepared/window-open_2026.md")"
has "the page says nothing was sent" "Nothing has been sent, cancelled or signed" "$(cat "$G/contracts/kfz/prepared/window-open_2026.md")"
if grep -qE "require\(.(https?|net|child_process)" "$HERE/contracts.js"; then bad "no network or process code" ""; else ok "no network or process code"; fi

# follow-up: prepared, no confirmation by the date, said once
out="$(on 2026-12-30 watch)"; has "follow-up after the grace days" "kfz follow-up:window-open:2026" "$out"
c mark-notified kfz follow-up:window-open:2026 --date 2026-12-30 >/dev/null
lacks "follow-up only once" "follow-up" "$(on 2026-12-31 watch)"
c event kfz --type switch-confirmed --date 2026-11-20 --source mail >/dev/null
echo "$PASS passed, $FAIL failed"; [ "$FAIL" -eq 0 ]
