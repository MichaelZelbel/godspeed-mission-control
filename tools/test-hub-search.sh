#!/usr/bin/env bash
# The gate for hub-search: ask the notebook first, and never need it.
#
# WHY THIS FILE IS HERE. hub-search is what AGENTS.md tells an assistant to run before it
# says "that is not in your hub". So it has two promises, and both are about the bad day:
#
#   1. Whatever the notebook does (no key, no network, a 500, no answer at all, an answer
#      nobody can read), the reader still gets a search, from the files, with exit 0, and
#      is told in one line which of the two happened. Checks 5 to 10 are that.
#   2. What comes back is always a file that is really in the hub, and never AGENTS.md.
#      Checks 2 to 4 are that.
#
# The notebook here is a stand-in on this computer. Nothing in this file can reach a real
# account: every call is pointed at 127.0.0.1 and the key is the word "test-key".
#
# Usage: bash tools/test-hub-search.sh
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
NODE=""
for c in node nodejs /usr/local/bin/node /usr/bin/node; do
  "$c" -e '' >/dev/null 2>&1 && { NODE="$c"; break; }
done
[ -n "$NODE" ] || { echo "FAIL: no node on this box"; exit 1; }
PASS=0; FAIL=0
ok()  { echo "  ok   $1"; PASS=$((PASS+1)); }
bad() { echo "  FAIL $1"; FAIL=$((FAIL+1)); [ -n "${2:-}" ] && echo "       $2"; }
contains() { case "$2" in *"$3"*) ok "$1";; *) bad "$1" "missing [$3] in: $2";; esac; }
lacks()    { case "$2" in *"$3"*) bad "$1" "should not contain [$3]: $2";; *) ok "$1";; esac; }

# Inside tools/ on purpose: an mktemp path resolves to two different places for Git Bash
# and a Windows program, and .gitignore already covers tools/.tmp-*.
W="$HERE/.tmp-search-test.$$"; rm -rf "$W"; mkdir -p "$W/home/.hub"
STUB_PID=""
trap '[ -n "$STUB_PID" ] && kill "$STUB_PID" 2>/dev/null; rm -rf "$W"' EXIT

# A home with nothing in it, so the key on the computer running the tests is never found.
# USERPROFILE is what Node calls home on Windows; HOME is what it calls home everywhere else.
export HOME="$W/home" USERPROFILE="$W/home" HUB_DIR="" HUB_AGE_KEY="$W/home/.hub/no-such-key"

H="$W/hub"
mkdir -p "$H/profile" "$H/observations" "$H/goals" "$H/dev/project" "$H/world/claims" "$H/skills/plan"
printf '# Manual\n\nThe dentist, the budget, everything is mentioned here.\n' > "$H/AGENTS.md"
printf '# The dentist\n\nDr. Aydin, Tuesday at nine.\n'                        > "$H/profile/dentist.md"
printf 'You put off the dentist. dentist dentist dentist dentist dentist.\n'  > "$H/observations/teeth.md"
printf '# Health\n\nAge strong. See the dentist twice a year.\n'              > "$H/goals/health.md"
printf '# A project\n\ndentist app\n'                                         > "$H/dev/project/README.md"
printf -- '---\nsubject: me\norigin: menerio\nattribute: dentist\n---\nDr. Aydin is my dentist.\n' > "$H/world/claims/me--dentist--2026.md"
printf '# Plan my day\n'                                                      > "$H/skills/plan/SKILL.md"
printf '# Decisions\n\n- (2026-01-05) Changed dentist, because the old one retired.\n' > "$H/decisions.md"

hs() { "$NODE" "$HERE/search.js" --hub "$H" "$@" 2>&1; }

echo "== hub-search: the notebook first, the files always =="

# 1. The launcher is the two lines every other launcher here is.
if [ "$(sed -n 2p "$HERE/hub-search")" = 'exec node "$(dirname "$0")/search.js" "$@"' ] && sh -n "$HERE/hub-search"; then
  ok "the launcher starts search.js from the folder it sits in"
else
  bad "the hub-search launcher is not the usual two lines"
fi

# ---- the stand-in notebook -----------------------------------------------------------------
cat > "$W/stub.js" <<'STUBEOF'
const http = require("http"), fs = require("fs");
const seen = [];
const srv = http.createServer((req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname === "/__seen") { res.end(JSON.stringify(seen)); return; }
  const q = u.searchParams.get("q") || "";
  seen.push({ path: u.pathname, q: q, source_app: u.searchParams.get("source_app"),
    limit: u.searchParams.get("limit"), auth: req.headers.authorization || "" });
  const send = (code, body) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(body); };
  if (q.includes("fivehundred")) return send(500, '{"error":"boom"}');
  if (q.includes("refused")) return send(401, '{"error":"no"}');
  if (q.includes("garbage")) return send(200, "<html>not json</html>");
  if (q.includes("slow")) return;                       // never answers
  if (q.includes("nothinghere")) return send(200, JSON.stringify({ results: [], mode: "hybrid" }));
  if (q.includes("oldshape")) {
    return send(200, JSON.stringify({ notes: [
      { title: "AGENTS.md", folder_path: "hub", source_app: "hub", similarity: 0.9 },
      { title: "profile/dentist.md", folder_path: "hub/profile", source_app: "hub", similarity: 0.8 },
      { title: "2026-01-05 Changed dentist, because the old one retired.", folder_path: "hub", source_app: "hub" },
      { title: "A note I wrote on my phone", folder_path: "Health", source_app: "menerio" },
    ] }));
  }
  send(200, JSON.stringify({ mode: "hybrid", results: [
    { title: "AGENTS.md", folder_path: "hub", source_app: "hub", source_id: "AGENTS.md", similarity: 0.95, snippet: "The dentist, the budget" },
    { title: "profile/dentist.md", folder_path: "hub/profile", source_app: "hub", source_id: "profile/dentist.md", similarity: 0.91, snippet: "Dr. Aydin, Tuesday at nine." },
    { title: "profile/deleted-last-week.md", folder_path: "hub/profile", source_app: "hub", source_id: "profile/deleted-last-week.md", similarity: 0.9, snippet: "gone" },
    { title: "2026-01-05 Changed dentist, because the old one retired.", folder_path: "hub", source_app: "hub", source_id: "decisions.md#2026-01-05-changed-dentist", similarity: 0.7, snippet: "Changed dentist, because the old one retired." },
    { title: "escape", folder_path: "hub", source_app: "hub", source_id: "../outside.md", similarity: 0.6, snippet: "x" },
  ] }));
});
srv.listen(0, "127.0.0.1", () => fs.writeFileSync(process.argv[2], String(srv.address().port)));
STUBEOF
"$NODE" "$W/stub.js" "$W/stub.port" & STUB_PID=$!
for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do [ -s "$W/stub.port" ] && break; sleep 0.25; done
[ -s "$W/stub.port" ] || { bad "the stand-in notebook did not start"; echo; echo "  $PASS passed, $FAIL failed"; exit 1; }
export MENERIO_BASE_URL="http://127.0.0.1:$(cat "$W/stub.port")"
printf '# outside\n' > "$W/outside.md"

# 2 to 4. The good day.
out="$(MENERIO_API_KEY=test-key hs the dentist --limit 5)"; rc=$?
if [ "$rc" = "0" ] && [ "$(echo "$out" | sed -n 1p)" = "profile/dentist.md" ] \
   && [ "$(echo "$out" | sed -n 2p)" = "  The dentist" ] && [ "$(echo "$out" | sed -n 3p)" = "  Dr. Aydin, Tuesday at nine." ]; then
  ok "a hit is one block: the hub path, the title, the snippet"
else
  bad "the block is not path, title, snippet (exit $rc)" "$out"
fi
contains "the last line says Menerio answered, by meaning and by words" "$(echo "$out" | tail -1)" "source: Menerio (meaning and words)"
lacks "AGENTS.md is never a hit" "$out" "AGENTS.md"
lacks "a copy of a file that is gone is not an answer" "$out" "deleted-last-week"
lacks "a path that points outside the hub is not believed" "$out" "outside"
contains "a decision comes back as decisions.md, under its own title" "$out" "decisions.md
  2026-01-05 Changed dentist"
seen="$("$NODE" -e 'require("http").get(process.argv[1]+"/__seen",r=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>console.log(d))})' "$MENERIO_BASE_URL")"
contains "the call asks for hub copies only, with the limit and the key as a Bearer header" "$seen" '"path":"/hub-api-notes/search","q":"the dentist","source_app":"hub","limit":"5","auth":"Bearer test-key"'

# 5. An older Menerio: no source_id, no snippet, no mode, and it ignores source_app=hub.
out="$(MENERIO_API_KEY=test-key hs oldshape dentist)"
if [ "$(echo "$out" | sed -n 1p)" = "profile/dentist.md" ] && echo "$out" | grep -q "^decisions.md$"; then
  ok "the older answer still maps to files: the path from the title, a decision from its date"
else
  bad "the older answer shape was not understood" "$out"
fi
contains "  and its snippet comes from the file on disk" "$out" "Dr. Aydin, Tuesday at nine."
lacks "  and a note you wrote yourself is not passed off as a hub file" "$out" "on my phone"
lacks "  and AGENTS.md is dropped there too" "$out" "AGENTS.md"
contains "  and it does not claim a search by meaning nobody promised" "$(echo "$out" | tail -1)" "source: Menerio (words only)"

# 6 to 9. The bad days. Each one still answers from the files, exit 0, and says why.
out="$(MENERIO_API_KEY=test-key hs fivehundred dentist)"; rc=$?
[ "$rc" = "0" ] && contains "a 500 falls back to the files and says so" "$(echo "$out" | tail -1)" "source: local files (Menerio not reached: it answered 500)" || bad "a 500 broke the search (exit $rc)" "$out"
contains "  and the files still answer" "$out" "profile/dentist.md"
out="$(MENERIO_API_KEY=test-key hs refused dentist)"
contains "a refused key falls back and names it" "$(echo "$out" | tail -1)" "source: local files (Menerio not reached: it refused the key (401))"
out="$(MENERIO_API_KEY=test-key hs garbage dentist)"
contains "an answer nobody can read falls back" "$(echo "$out" | tail -1)" "source: local files (Menerio not reached: its answer could not be read)"
start=$(date +%s)
out="$(MENERIO_API_KEY=test-key HUB_SEARCH_TIMEOUT_MS=1200 hs slow dentist)"; rc=$?
took=$(( $(date +%s) - start ))
if [ "$rc" = "0" ] && [ "$took" -le 6 ] && echo "$out" | tail -1 | grep -q "^source: local files (Menerio not reached: no answer in 1 seconds)$"; then
  ok "a notebook that never answers is given up on, and the files answer"
else
  bad "the timeout did not hold (exit $rc, ${took}s)" "$out"
fi
out="$(MENERIO_API_KEY=test-key MENERIO_BASE_URL="http://127.0.0.1:1" hs dentist)"; rc=$?
[ "$rc" = "0" ] && contains "no network falls back to the files" "$(echo "$out" | tail -1)" "source: local files (Menerio not reached: no connection to it from here)" || bad "no network broke the search (exit $rc)" "$out"

# 10. No key is not a failure, it is most readers.
out="$(MENERIO_API_KEY="" hs dentist)"; rc=$?
[ "$rc" = "0" ] && contains "no key: the files answer, and nothing is called broken" "$(echo "$out" | tail -1)" "source: local files (no Menerio connected)" || bad "no key broke the search (exit $rc)" "$out"
lacks "  and the stand-in was never called for it" "$("$NODE" -e 'require("http").get(process.argv[1]+"/__seen",r=>{let d="";r.on("data",c=>d+=c);r.on("end",()=>console.log(d))})' "$MENERIO_BASE_URL")" '"q":"dentist"'

# 11. Menerio answers, and has nothing: look in the files too, and say so.
out="$(MENERIO_API_KEY=test-key hs nothinghere dentist)"
contains "zero hits from Menerio: the files are searched too, and the line says so" "$(echo "$out" | tail -1)" "source: local files (Menerio answered and had nothing for this, so I looked here too)"
contains "  and they find it" "$out" "profile/dentist.md"

# 12 to 15. The local search by itself.
out="$(MENERIO_API_KEY=test-key hs --local dentist)"
contains "--local never asks the notebook" "$(echo "$out" | tail -1)" "source: local files"
first="$(echo "$out" | sed -n 1p)"
[ "$first" = "profile/dentist.md" ] && ok "a file ABOUT the word (name and first heading) beats a file that repeats it" || bad "the title hit did not rank first" "$out"
pos_title="$(echo "$out" | grep -n "^profile/dentist.md$" | cut -d: -f1)"; pos_body="$(echo "$out" | grep -n "^observations/teeth.md$" | cut -d: -f1)"
[ -n "$pos_body" ] && [ "$pos_title" -lt "$pos_body" ] && ok "  and the body hit is still found, below it" || bad "the body hit is missing or above the title hit" "$out"
lacks "AGENTS.md is never a local hit either" "$out" "AGENTS.md"
lacks "dev/ is not searched" "$out" "dev/project"
contains "a fact that came down from the notebook is found on disk" "$out" "world/claims/me--dentist--2026.md"
contains "decisions.md is searched as the one file it is" "$out" "decisions.md"
out="$(MENERIO_API_KEY="" hs the of and)"
[ "$?" = "0" ] && ok "a question made only of small words still runs" || bad "small words broke it" "$out"
out="$(MENERIO_API_KEY="" hs zebra crossing)"; rc=$?
if [ "$rc" = "0" ] && [ "$(echo "$out" | sed -n 1p)" = 'Nothing found for "zebra crossing".' ]; then
  ok "nothing found is a plain line and exit 0"
else
  bad "nothing found was not plain (exit $rc)" "$out"
fi
out="$(MENERIO_API_KEY="" hs twice a year dentist)"
[ "$(echo "$out" | sed -n 1p)" = "goals/health.md" ] || [ "$(echo "$out" | sed -n 1p)" = "profile/dentist.md" ] \
  && ok "several words: a file holding all of them is near the top" || bad "the all-words bonus is not working" "$out"

# 16. --json is the same answer for a program.
out="$(MENERIO_API_KEY=test-key hs --json the dentist)"
if echo "$out" | "$NODE" -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);process.exit(j.source==="menerio"&&j.hits[0].path==="profile/dentist.md"&&j.hits.every(h=>h.path!=="AGENTS.md")?0:1)})'; then
  ok "--json carries the source and the same hits"
else
  bad "--json is not what a program can read" "$out"
fi

# 17. The list of files searched here IS the list the mirror sends. Two programs in two
# languages hold the same list of exceptions, and this is what stops them drifting.
PY="${PYTHON:-python3}"
command -v "$PY" >/dev/null 2>&1 && "$PY" -c "pass" >/dev/null 2>&1 || PY=python
if "$PY" -c "pass" >/dev/null 2>&1; then
  mkdir -p "$H/.claude/skills/plan" "$H/world/removed" "$H/prompts/archive" "$H/node_modules/x"
  printf '# Plan my day\n' > "$H/.claude/skills/plan/SKILL.md"
  printf '# gone\n'        > "$H/world/removed/2026-09-01-removed.md"
  printf 'index\n'         > "$H/observations/MEMORY.md"
  printf '# pkg\n'         > "$H/node_modules/x/README.md"
  "$NODE" -e 'require("fs").writeFileSync(process.argv[1], "# Log\n" + "x".repeat(320000))' "$H/prompts/archive/2025.md"
  js="$("$NODE" "$HERE/search.js" --hub "$H" --list-files | tr -d '\r')"
  py="$("$PY" - "$HERE/notebook-sync.py" "$H" <<'PARITYEOF' | tr -d '\r'
import importlib.util, pathlib, sys
spec = importlib.util.spec_from_file_location("ns", sys.argv[1])
ns = importlib.util.module_from_spec(spec); spec.loader.exec_module(ns)
print("\n".join(ns.hub_markdown_files(pathlib.Path(sys.argv[2]))))
PARITYEOF
)"
  if [ -n "$js" ] && [ "$js" = "$py" ]; then
    ok "the files searched are exactly the files mirrored ($(echo "$js" | wc -l | tr -d ' ') of them, walked)"
  else
    bad "search.js and notebook-sync.py disagree about which files count" "js: $js | py: $py"
  fi
  if command -v git >/dev/null 2>&1; then
    git -C "$H" init -q 2>/dev/null; printf 'goals/\n' > "$H/.gitignore"
    git -C "$H" add -A >/dev/null 2>&1
    git -C "$H" -c user.email=t@example.com -c user.name=t commit -qm one >/dev/null 2>&1
    printf '# not committed\n' > "$H/profile/fresh.md"
    js="$("$NODE" "$HERE/search.js" --hub "$H" --list-files | tr -d '\r')"
    py="$("$PY" - "$HERE/notebook-sync.py" "$H" <<'PARITYEOF' | tr -d '\r'
import importlib.util, pathlib, sys
spec = importlib.util.spec_from_file_location("ns", sys.argv[1])
ns = importlib.util.module_from_spec(spec); spec.loader.exec_module(ns)
print("\n".join(ns.hub_markdown_files(pathlib.Path(sys.argv[2]))))
PARITYEOF
)"
    if [ -n "$js" ] && [ "$js" = "$py" ] && ! echo "$js" | grep -q "goals/\|fresh.md\|node_modules"; then
      ok "and the same again when git is asked: ignored and uncommitted files are in neither"
    else
      bad "the two lists disagree in a git hub" "js: $js | py: $py"
    fi
  fi
else
  ok "no working python here, so the two lists were not compared (skipped)"
fi

echo
echo "  $PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ] || exit 1
