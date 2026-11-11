#!/usr/bin/env node
/*
 * test-promise-hook.js - proof that starter-godspeed/.claude/hooks/promise-needs-a-file.js asks once
 * when a turn promises something on a clock without writing it down, and lets every other turn end.
 *
 * Case 1 is the kind of sentence the hook exists for: a weekly talk promised in a chat that nothing
 * ever ran. Every case runs against a throwaway mission control (CLAUDE_PROJECT_DIR), so the mtimes
 * of real files never decide anything and nothing real is touched.
 *
 * Run: node tools/test-promise-hook.js
 */
"use strict";
require("./test-guard.cjs"); // never a real mission control (test-guard.bash says why)
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const KIT = path.dirname(__dirname);
const STARTER = path.join(KIT, "starter-godspeed");
const HOOK = path.join(STARTER, ".claude", "hooks", "promise-needs-a-file.js");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "kit-pnf-"));
process.on("exit", () => fs.rmSync(TMP, { recursive: true, force: true }));

function run(text, opts) {
  opts = opts || {};
  const root = fs.mkdtempSync(path.join(TMP, "mc-"));
  const dir = path.join(root, "work", "promises");
  if (!opts.noFolder) {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "README.md"), "# not a promise\n");
  }
  if (opts.freshFile) fs.writeFileSync(path.join(dir, "sunday-talk.md"), "PROMISE: x\n");
  if (opts.staleFile) {
    const p = path.join(dir, "old-promise.md");
    fs.writeFileSync(p, "PROMISE: old\n");
    const old = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    fs.utimesSync(p, old, old);
  }
  let payload = Object.assign({ hook_event_name: "Stop", stop_hook_active: false, last_assistant_message: text }, opts.payload || {});
  if (opts.transcript) {
    const tp = path.join(root, "session.jsonl");
    fs.writeFileSync(tp, [
      JSON.stringify({ type: "user", message: { content: "Can we talk about my training?" } }),
      JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: opts.transcript }] } }),
    ].join("\n") + "\n");
    payload = { hook_event_name: "Stop", stop_hook_active: false, transcript_path: tp };
  }
  const env = Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: root }, opts.env || {});
  const r = spawnSync(process.execPath, [HOOK], {
    input: opts.rawInput !== undefined ? opts.rawInput : JSON.stringify(payload),
    encoding: "utf8", cwd: root, env,
  });
  if (r.status !== 0) return { got: "crash " + r.status };
  if (!r.stdout) return { got: "pass" };
  let out = null;
  try { out = JSON.parse(r.stdout); } catch (_) { return { got: "garbage on stdout" }; }
  return out && out.decision === "block" ? { got: "block", reason: out.reason } : { got: "unexpected " + r.stdout };
}

const PROMISE = "Yes. I will ping you every Sunday evening so we can talk about your training, and in the meantime I'll do the research.";
const cases = [
  // ---- a promise on a clock, nothing written: asked once ----
  { name: "a Sunday promise with no promise file", text: PROMISE, want: "block" },
  { name: "every morning, first person", text: "I will check your sleep each morning and tell you what changed.", want: "block" },
  { name: "the clock first, the future second", text: "Every Monday your mission control will build the idea page and you will get the link.", want: "block" },
  { name: "a curly apostrophe", text: "From now on I’ll send you a short summary once a week.", want: "block" },
  { name: "the last message only in the transcript", text: "", opts: { transcript: PROMISE }, want: "block" },
  { name: "the camelCase field other assistants send", text: "", opts: { payload: { last_assistant_message: undefined, lastAssistantMessage: PROMISE } }, want: "block" },
  { name: "only a three-day-old promise file", text: "From now on I will check your supplements once a month.", opts: { staleFile: true }, want: "block" },
  // ---- the promise is written down, or the turn already was asked ----
  { name: "a promise file written this session", text: PROMISE, opts: { freshFile: true }, want: "pass" },
  { name: "the message names the promise file", text: "Every Sunday at 19:00 you will get the message; it is written in work/promises/sunday-talk.md.", want: "pass" },
  { name: "the stop after a block goes through", text: PROMISE, opts: { payload: { stop_hook_active: true } }, want: "pass" },
  // ---- not a promise ----
  { name: "describing something that already runs", text: "The brief goes out every morning at 05:35 and the research runs every night. Nothing changed there.", want: "pass" },
  { name: "it already runs, said with it will", text: "It will run every morning as before, nothing changed.", want: "pass" },
  { name: "a one-off future", text: "I'll send it tomorrow morning, once the draft is checked.", want: "pass" },
  { name: "a report of the past", text: "I sent it every Sunday last month.", want: "pass" },
  // ---- any error lets the turn end ----
  { name: "empty stdin", opts: { rawInput: "" }, want: "pass" },
  { name: "garbage on stdin", opts: { rawInput: "{not json" }, want: "pass" },
  { name: "JSON null", opts: { rawInput: "null" }, want: "pass" },
  { name: "a payload with no fields", opts: { rawInput: "{}" }, want: "pass" },
  { name: "a Stop payload with no message and no transcript", opts: { rawInput: JSON.stringify({ hook_event_name: "Stop" }) }, want: "pass" },
  { name: "a transcript that is not there", opts: { rawInput: JSON.stringify({ hook_event_name: "Stop", transcript_path: "/nonexistent/x.jsonl" }) }, want: "pass" },
  { name: "a mission control without a promises folder", text: PROMISE, opts: { noFolder: true }, want: "pass" },
  { name: "a scheduled routine's run", text: PROMISE, opts: { env: { GODSPEED_SCHEDULED_RUN: "1" } }, want: "pass" },
  { name: "a PreToolUse payload is not this hook's business", text: PROMISE, opts: { payload: { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "ls" } } }, want: "pass" },
];

let failed = 0;
console.log("promise-needs-a-file.js");
let reason = "";
for (const c of cases) {
  const r = run(c.text, c.opts);
  if (r.reason) reason = r.reason;
  const ok = r.got === c.want;
  if (!ok) failed++;
  console.log((ok ? "  ok   " : "  FAIL ") + c.name + (ok ? "" : "  (wanted " + c.want + ", got " + r.got + ")"));
}

function claim(name, ok) {
  if (!ok) failed++;
  console.log((ok ? "  ok   " : "  FAIL ") + name);
}
claim("the reason names the promises README and mc-due today", reason.includes("work/promises/README.md") && reason.includes("mc-due today"));
claim("the reason names nobody, no home folder and no host", !/michael|zelbel|\/home\/|\/Users\/|[a-z0-9-]+\.(?:com|de|net|io)\b|—/i.test(reason));
claim("the hook names nobody, no home folder and no host", !/michael|zelbel|\/home\/|\/Users\/|hetzner|\btelegram\b/i.test(fs.readFileSync(HOOK, "utf8")));

// ---- registered once, as its own Stop group, in both assistants' settings ----
for (const rel of [".claude/settings.json", ".codex/hooks.json"]) {
  let groups = [];
  try { groups = JSON.parse(fs.readFileSync(path.join(STARTER, rel), "utf8")).hooks.Stop; } catch (_) { groups = null; }
  const commands = (groups || []).flatMap((g) => (g.hooks || []).map((h) => h.command));
  claim(rel + " names the hook exactly once, in a Stop group", commands.filter((c) => /promise-needs-a-file\.js/.test(c)).length === 1);
}

console.log(failed ? failed + " checks failed" : "all checks pass");
process.exit(failed ? 1 : 0);
