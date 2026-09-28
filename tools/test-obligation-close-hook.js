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

function deadline(root, name, title, doneWhen, window) {
  fs.writeFileSync(path.join(root, "due", name + ".md"),
    `# ${title}\n\nTITLE: ${title}\nDONE-WHEN: ${doneWhen}\nCOST-IF-MISSED: It slips.\nSELF-CHECK: none\nREPEATS: no\n\n` +
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
  env: { PATH: "", CLAUDE_PROJECT_DIR: root, HOME: TMP, TMPDIR: TMP } }).stdout.trim() === "");

const settings = fs.readFileSync(path.join(KIT, "starter-godspeed", ".claude", "settings.json"), "utf8");
check("the starter registers it as a Stop hook", /obligation-close-check\.js/.test(settings) && /"Stop"/.test(settings));

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
