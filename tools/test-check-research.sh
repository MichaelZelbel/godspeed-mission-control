#!/usr/bin/env bash
# The gate for mc-check-research: a night of goal research a reader can trust, or the exact gaps.
set -uo pipefail
. "$(dirname "$0")/test-guard.bash"
HERE="$(cd "$(dirname "$0")" && pwd)"
NODE=""; for c in node nodejs /usr/local/bin/node /usr/bin/node; do "$c" -e '' >/dev/null 2>&1 && { NODE="$c"; break; }; done
[ -n "$NODE" ] || { echo "FAIL: no node on this box"; exit 1; }
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP" "$TEST_GUARD_HOME"; [ -n "${SRV:-}" ] && kill "$SRV" 2>/dev/null' EXIT
G="$TMP/g"; R="$G/goals/research/money"; mkdir -p "$G/rules" "$R/days"
PASS=0; FAIL=0
ok()  { PASS=$((PASS+1)); printf '  ok   %s\n' "$1"; }
bad() { FAIL=$((FAIL+1)); printf '  FAIL %s\n' "$1"; }
check()    { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 (wanted [$3], got [$2])"; fi; }
contains() { case "$2" in *"$3"*) ok "$1";; *) bad "$1 (missing [$3] in: $(printf '%s' "$2" | head -5))";; esac; }
missing()  { case "$2" in *"$3"*) bad "$1 (should not contain [$3])";; *) ok "$1";; esac; }
D=2026-10-12
run() { "$NODE" "$HERE/check-research.js" --godspeed "$G" --goal money --date "$D" "$@" 2>&1; }
words() { "$NODE" -e 'console.log(Array(160).fill("word").join(" "))'; }
good_day() { printf '# %s\n\n## Searched\n%s\n\n## Found\nthings\n\n## Changed in the files\npeople.md\n' "$D" "$(words)" > "$R/days/$D.md"; }
printf 'GOAL: money\nUPDATED: %s\nSTATUS: current\n\n## The limit now\nLIMIT: almost nobody sees the kits\n\n## Challenges to the playbook\nnone\n' "$D" > "$R/brief.md"
printf 'PERSON: Ann Example\nLINK: https://example.org/ann\nWHY: sells kits\nLAST: never read\nOFFER: a review\nSTATUS: verified 2026-10-12\nHOT: no\n\n' > "$R/people.md"
printf 'CASE: Bo\nSTART: salaried, 50\nDID: priced early\nRESULT: 2k a month\nSOURCE: https://example.org/bo (read 2026-10-12)\n\n' > "$R/cases.md"
printf 'CLAIM: Early pricing beats free\nSTATUS: supported 2026-10-12\nSOURCE: https://example.org/c (read 2026-10-12)\nQUOTE: "charge from day one"\nMEANS: price the kits\n\n' > "$R/claims.md"
printf 'OPENING: A call for talks\nUNTIL: 2026-10-30\nSOURCE: https://example.org/o (read 2026-10-12)\nMOVE: submit a talk\nIDEA: ideas/talk.md\n\n' > "$R/openings.md"

echo "mc-check-research gate"
OUT="$(run)"; check "no day file fails" "$?" "1"
contains "  and says a night with no day file did not run" "$OUT" "days/$D.md is missing"
good_day
OUT="$(run)"; check "a complete night passes" "$?" "0"
contains "  and says OK" "$OUT" "OK money $D"
printf 'GOAL: money\nUPDATED: 2026-10-11\n' > "$R/brief.md"
contains "a brief not rewritten today fails" "$(run)" "brief.md does not say UPDATED: $D"
printf 'GOAL: money\r\nUPDATED: %s\r\nSTATUS: current\r\n\r\n## The limit now\r\nLIMIT: almost nobody sees the kits\r\n' "$D" > "$R/brief.md"
OUT="$(run)"; check "a CRLF brief passes" "$?" "0"

# the limit: a current brief names the one thing that limits the goal now
printf 'GOAL: money\nUPDATED: %s\nSTATUS: current\n\n## The limit now\nnothing named\n\n## Challenges to the playbook\nnone\n' "$D" > "$R/brief.md"
contains "a current brief without a LIMIT line fails" "$(run)" "brief.md has no LIMIT: line under ## The limit now"
printf 'GOAL: money\nUPDATED: %s\nSTATUS: founding\n\n## The limit now\nnothing named\n' "$D" > "$R/brief.md"
OUT="$(run)"; check "  a founding brief may lack it" "$?" "0"
printf 'GOAL: money\nUPDATED: %s\nSTATUS: current\n\n## The limit now\nLIMIT: almost nobody sees the kits: 178 visitors a fortnight on the one page with traffic\n\n## Challenges to the playbook\nnone\n' "$D" > "$R/brief.md"
OUT="$(run)"; check "  a current brief with a LIMIT passes" "$?" "0"

printf 'PERSON: No Link\nWHY: x\nOFFER: y\nSTATUS: unverified\n\n' >> "$R/people.md"
contains "a person without a link fails" "$(run)" "people.md: \"No Link\" has no LINK"
printf 'PERSON: Ann Example\nLINK: https://example.org/ann2\nWHY: x\nOFFER: y\nSTATUS: unverified\n\n' >> "$R/people.md"
contains "the same person twice in one file fails" "$(run)" "people.md: \"Ann Example\" is listed twice"
printf 'PERSON: Ann Example\nLINK: https://example.org/ann\nWHY: sells kits\nLAST: never read\nOFFER: a review\nSTATUS: verified 2026-10-12\nHOT: no\n\n' > "$R/people.md"
printf 'CLAIM: No quote\nSTATUS: supported 2026-10-12\nSOURCE: https://example.org/n (read 2026-10-12)\nMEANS: x\n\n' >> "$R/claims.md"
contains "a claim without its quote fails" "$(run)" "claims.md: \"No quote\" has no QUOTE"
printf 'CLAIM: Early pricing beats free\nSTATUS: supported 2026-10-12\nSOURCE: https://example.org/c (read 2026-10-12)\nQUOTE: "charge from day one"\nMEANS: price the kits\n\n' > "$R/claims.md"
printf 'CLAIM: Bad status\nSTATUS: true\nSOURCE: https://example.org/b (read 2026-10-12)\nQUOTE: "x"\nMEANS: x\n\n' >> "$R/claims.md"
contains "a claim status outside supported/contested/refuted fails" "$(run)" "claims.md: \"Bad status\" STATUS"
printf 'CLAIM: Early pricing beats free\nSTATUS: supported 2026-10-12\nSOURCE: https://example.org/c (read 2026-10-12)\nQUOTE: "charge from day one"\nMEANS: price the kits\n\n' > "$R/claims.md"
rm "$R/cases.md"
contains "a deleted file is named, not a crash" "$(run)" "cases.md is missing"
printf 'CASE: Bo\nSTART: salaried, 50\nDID: priced early\nRESULT: 2k a month\nSOURCE: https://example.org/bo (read 2026-10-12)\n\n' > "$R/cases.md"
contains "a daily night under 100 people that added fewer than 5 fails" "$(run --mode daily --before-people 1)" "added 0 people"
OUT="$(run --mode daily --before-people 120)"; check "  but not once the list holds 100" "$?" "0"

# --fetch: a served page must carry the quote; a page that cannot be fetched is only a note
PORT_FILE="$TMP/port"
"$NODE" -e '
const http=require("http");
const s=http.createServer((q,r)=>{
  if(q.url==="/has"){r.writeHead(200,{"content-type":"text/html"});r.end("<p>We say: charge   from day one, always.</p>");return;}
  if(q.url==="/lacks"){r.writeHead(200,{"content-type":"text/html"});r.end("<p>Give it away. "+"word ".repeat(150)+"</p>");return;}
  if(q.url==="/js"){r.writeHead(200,{"content-type":"text/html"});r.end("<html><head><script>var a=1;"+"x();".repeat(300)+"</script></head><body><noscript>Please enable JavaScript to view this page.</noscript></body></html>");return;}
  r.writeHead(403);r.end("no");
});
s.listen(0,"127.0.0.1",()=>require("fs").writeFileSync(process.argv[1],String(s.address().port)));' "$PORT_FILE" & SRV=$!
for i in 1 2 3 4 5 6 7 8 9 10; do [ -s "$PORT_FILE" ] && break; sleep 0.3; done
P="$(cat "$PORT_FILE")"
printf 'CLAIM: Early pricing beats free\nSTATUS: supported %s\nSOURCE: http://127.0.0.1:%s/has (read %s)\nQUOTE: "charge from day one"\nMEANS: price\n\n' "$D" "$P" "$D" > "$R/claims.md"
OUT="$(run --fetch)"; check "a quote that is on its page passes" "$?" "0"
printf 'CLAIM: Free wins\nSTATUS: supported %s\nSOURCE: http://127.0.0.1:%s/lacks (read %s)\nQUOTE: "free always wins"\nMEANS: x\n\n' "$D" "$P" "$D" >> "$R/claims.md"
contains "a quote missing from a page that served text fails" "$(run --fetch)" "quote not found on its page"
printf 'CLAIM: Early pricing beats free\nSTATUS: supported %s\nSOURCE: http://127.0.0.1:%s/has (read %s)\nQUOTE: "charge from day one"\nMEANS: price\n\n' "$D" "$P" "$D" > "$R/claims.md"
printf 'CLAIM: Paywalled\nSTATUS: supported %s\nSOURCE: http://127.0.0.1:%s/blocked (read %s)\nQUOTE: "anything"\nMEANS: x\n\n' "$D" "$P" "$D" >> "$R/claims.md"
OUT="$(run --fetch)"; check "a page that refuses us is not a failed quote" "$?" "0"
contains "  but it is noted" "$OUT" "NOTE claims.md: \"Paywalled\" page could not be read"
printf 'CLAIM: Old one\nSTATUS: supported 2026-01-01\nSOURCE: http://127.0.0.1:%s/lacks (read 2026-01-01)\nQUOTE: "never there"\nMEANS: x\n\n' "$P" >> "$R/claims.md"
OUT="$(run --fetch)"; check "only quotes read tonight are fetched" "$?" "0"

# a script shell or login wall that answers 200 with no readable text is a note, not a failed quote
printf 'CLAIM: Early pricing beats free\nSTATUS: supported %s\nSOURCE: http://127.0.0.1:%s/has (read %s)\nQUOTE: "charge from day one"\nMEANS: price\n\n' "$D" "$P" "$D" > "$R/claims.md"
printf 'CLAIM: Script only\nSTATUS: supported %s\nSOURCE: http://127.0.0.1:%s/js (read %s)\nQUOTE: "a sentence the shell never shows"\nMEANS: x\n\n' "$D" "$P" "$D" >> "$R/claims.md"
OUT="$(run --fetch)"; check "a page with only a script shell is not a failed quote" "$?" "0"
contains "  but it is noted" "$OUT" "NOTE claims.md: \"Script only\" page served no readable text"

echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
