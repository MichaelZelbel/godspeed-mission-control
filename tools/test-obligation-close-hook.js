#!/usr/bin/env node
/*
 * test-obligation-close-hook.js - proof that starter-godspeed/.claude/hooks/obligation-close-check.js
 * works with this kit's own due.js.
 *
 * Case 1 is the incident behind it: a post approved and published in a working session, and the
 * two deadlines about it left open because nothing closed them. The session must be stopped once
 * and named them; a second stop in the same session must pass; a deadline an event already closed
 * must never be raised. Everything runs in a throwaway mission control.
 *
 * Run: node tools/test-obligation-close-hook.js
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const KIT = path.dirname(__dirname);
const HOOK = path.join(KIT, "starter-godspeed", ".claude", "hooks", "obligation-close-check.js");
const DUE = path.join(KIT, "tools", "due.js");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "kit-occ-"));

function deadline(root, name, title, doneWhen, window, selfCheck) {
  fs.writeFileSync(path.join(root, "due", name + ".md"),
    `# ${title}\n\nTITLE: ${title}\nDONE-WHEN: ${doneWhen}\nCOST-IF-MISSED: It slips.\nSELF-CHECK: ${selfCheck || "none"}\nREPEATS: no\n\n` +
    `## Windows\n\nSTRIP: ${window}\n\n## Log\n\n- 2026-09-16 created\n`);
}
function fixture() {
  const root = fs.mkdtempSync(path.join(TMP, "mc-"));
  for (const d of ["due", "world/events", "rules"]) fs.mkdirSync(path.join(root, d), { recursive: true });
  fs.writeFileSync(path.join(root, "AGENTS.md"), "");
  deadline(root, "post-approve", "Read the newsletter post and welcome email and say yes", "You have said yes or what to change", "2026-09-23 2026-09-25");
  deadline(root, "post-publish", "Say publish for the newsletter post", "You have said publish", "2026-09-28 2026-09-30");
  deadline(root, "timesheet", "Your monthly timesheet", "It is submitted", "2026-09-01 2026-09-28");
  return root;
}
function transcript(entries) {
  const p = path.join(fs.mkdtempSync(path.join(TMP, "t-")), "s.jsonl");
  fs.writeFileSync(p, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return p;
}
const said = (text) => ({ type: "user", message: { content: text } });
const ran = (command) => ({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command } }] } });
const spoke = (text) => ({ type: "assistant", message: { content: [{ type: "text", text }] } });

function run(root, payload, raw) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: raw !== undefined ? raw : JSON.stringify(Object.assign({ hook_event_name: "Stop", stop_hook_active: false }, payload)),
    encoding: "utf8",
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: root, GODSPEED_DUE_JS: DUE, GODSPEED_TODAY: "2026-09-24", TMPDIR: TMP, TMP: TMP, TEMP: TMP }),
  });
  if (r.status !== 0) return { verdict: "crash", reason: r.stderr };
  let out = null;
  try { out = JSON.parse(r.stdout || "null"); } catch (_) { out = null; }
  return { verdict: out && out.decision === "block" ? "block" : "pass", reason: out ? out.reason : "" };
}

let failures = 0;
const check = (name, cond, detail) => {
  console.log((cond ? "PASS  " : "FAIL  ") + name + (cond ? "" : "  (" + String(detail || "").slice(0, 300) + ")"));
  if (!cond) failures++;
};

const incident = [
  said("I like your draft of the newsletter post, so please publish that. The welcome email is fine too."),
  ran("git commit -m \"Newsletter post and welcome email approved\""),
];
let root = fixture();
let r = run(root, { session_id: "a", transcript_path: transcript(incident) });
check("incident: the session that did the work is stopped", r.verdict === "block", r.verdict + " " + r.reason);
check("it names the publish, whose window had not opened yet", /post-publish/.test(r.reason), r.reason);
check("it names the approval", /post-approve/.test(r.reason), r.reason);
check("it does not name a deadline the session never touched", !/timesheet/.test(r.reason), r.reason);
check("it tells the assistant how to close it with evidence", /mc-due done <name> --evidence/.test(r.reason), r.reason);
check("it never asks the person a question", !/\?/.test(r.reason), r.reason);
check("never twice in one session", run(root, { session_id: "a", transcript_path: transcript(incident) }).verdict === "pass");
check("a stop after a block passes", run(root, { session_id: "b", stop_hook_active: true, transcript_path: transcript(incident) }).verdict === "pass");

root = fixture();
spawnSync(process.execPath, [DUE, "--godspeed", root, "done", "post-approve", "--evidence", "said yes in the session"],
  { env: Object.assign({}, process.env, { GODSPEED_TODAY: "2026-09-23" }) });
spawnSync(process.execPath, [DUE, "--godspeed", root, "done", "post-publish", "--evidence", "said publish in the session"],
  { env: Object.assign({}, process.env, { GODSPEED_TODAY: "2026-09-23" }) });
check("once closed by an event, nothing is raised", run(root, { session_id: "c", transcript_path: transcript(incident) }).verdict === "pass");

root = fixture();
check("the assistant's own words never count", run(root, { session_id: "d", transcript_path: transcript([said("What is on today?"), spoke("Your newsletter post and welcome email are waiting.")]) }).verdict === "pass");
check("an unrelated session passes", run(root, { session_id: "e", transcript_path: transcript([said("Help me plan the week.")]) }).verdict === "pass");
check("a broken payload passes", run(root, null, "{nope").verdict === "pass");
check("no due.js anywhere passes", spawnSync(process.execPath, [HOOK], {
  input: JSON.stringify({ hook_event_name: "Stop", session_id: "f", transcript_path: transcript(incident) }), encoding: "utf8",
  // Windows finds home in USERPROFILE and temp in TEMP/TMP, not HOME/TMPDIR: without them this
  // found a real installed due.js and left its once-per-session file in the real temp folder.
  env: { PATH: "", CLAUDE_PROJECT_DIR: root, HOME: TMP, USERPROFILE: TMP, TMPDIR: TMP, TMP, TEMP: TMP } }).stdout.trim() === "");

// A deadline the session did not finish is never mentioned: no "why not" line.
root = fixture();
r = run(root, { session_id: "g", transcript_path: transcript(incident) });
check("it never asks for a line about what is not finished", !/say in one line why/i.test(r.reason) && /do not mention it/.test(r.reason), r.reason);

// A key with a self check is never raised on words; words are a guess, the check is proof.
deadline(root, "key-planino-supabase-access-token", "Renew the key that lets your machines read and deploy the Planino database",
  "The date in secrets/expires.txt says the new one", "2026-09-15 2026-10-20", "the date in secrets/expires.txt moves forward");
const menerio = [said("Deploy the edge functions to Supabase from this machine; I renewed the Planino key for the machines."),
  ran("git commit -m \"Edge functions deployed: renew and read the Planino database from both machines\"")];
check("a deadline with a self check is never raised on words", run(root, { session_id: "h", transcript_path: transcript(menerio) }).verdict === "pass");
const rows = JSON.parse(spawnSync(process.execPath, [DUE, "--godspeed", root, "state", "--json"], { encoding: "utf8",
  env: Object.assign({}, process.env, { GODSPEED_TODAY: "2026-09-24" }) }).stdout || "[]");
check("mc-due state --json names each deadline's self check",
  rows.some((x) => x.slug === "timesheet" && x.selfCheck === "none") &&
  rows.some((x) => x.slug === "key-planino-supabase-access-token" && x.selfCheck !== "none"), JSON.stringify(rows.map((x) => [x.slug, x.selfCheck])));

// Without a self check: common words alone never match; the word that names it does.
root = fixture();
deadline(root, "planino-key", "Renew the key that lets your machines read and deploy the Planino database", "Renewed", "2026-09-15 2026-10-20");
check("common words alone are never enough", run(root, { session_id: "i", transcript_path: transcript([
  said("Lets renew the database login so the machines can read it and deploy again.")]) }).verdict === "pass");
r = run(root, { session_id: "j", transcript_path: transcript(menerio) });
check("with the word that names it, it is raised", r.verdict === "block" && /planino-key/.test(r.reason), r.reason);
check("file paths are not what the session talked about", run(root, { session_id: "k", transcript_path: transcript([said("Tidy up."),
  { type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "/x/newsletter-post/welcome-email-publish.md" } }] } }]) }).verdict === "pass");
check("a script that merely quotes a commit is not a commit message", run(root, { session_id: "l", transcript_path: transcript([
  ran("cat > t.py <<'X'\nprint('git commit is quoted here')\nX\npython3 t.py 'Your monthly timesheet'")]) }).verdict === "pass");

// A key renewed in the session closes itself now: the hook runs `mc-due check` and never blocks.
const stub = path.join(TMP, "due-stub.js"), calls = path.join(TMP, "calls.txt");
fs.writeFileSync(stub, "require('fs').appendFileSync(" + JSON.stringify(calls) + ", process.argv.slice(2).join(' ') + '\\n');\n" +
  "if (process.argv.includes('check')) process.exit(0);\n" +
  "const r = require('child_process').spawnSync(process.execPath, [" + JSON.stringify(DUE) + "].concat(process.argv.slice(2)), { stdio: 'inherit' });\n" +
  "process.exit(r.status);\n");
const viaStub = (payload) => spawnSync(process.execPath, [HOOK], {
  input: JSON.stringify(Object.assign({ hook_event_name: "Stop" }, payload)), encoding: "utf8",
  env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: root, GODSPEED_DUE_JS: stub, GODSPEED_TODAY: "2026-09-24", TMPDIR: TMP, TMP, TEMP: TMP }) });
const out = viaStub({ session_id: "m", transcript_path: transcript([said("New key made."),
  { type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "C:\\me\\godspeed\\secrets\\expires.txt" } }] } }]) });
const seen = fs.existsSync(calls) ? fs.readFileSync(calls, "utf8") : "";
check("editing secrets/expires.txt runs mc-due check, and does not block", /\bcheck\b/.test(seen) && !/block/.test(out.stdout), seen + out.stdout);

const settings = fs.readFileSync(path.join(KIT, "starter-godspeed", ".claude", "settings.json"), "utf8");
check("the starter registers it as a Stop hook", /obligation-close-check\.js/.test(settings) && /"Stop"/.test(settings));

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
