#!/usr/bin/env node
/*
 * test-give-up-hook.js - proof that starter-godspeed/.claude/hooks/give-up-check.js asks the
 * assistant once whether it is really finished when its last message gives up or hands the work
 * back, lets finished messages through, never asks twice in a turn, and never traps a session.
 *
 * Every case runs the hook as Claude Code and Codex run it: a stop payload on stdin, the answer on
 * stdout. Both a Claude Code payload and a Codex payload (which names its turn) are tried.
 *
 * Run: node tools/test-give-up-hook.js
 */
"use strict";
require("./test-guard.cjs"); // never a real mission control (test-guard.bash says why)
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const KIT = path.dirname(__dirname);
const STARTER = path.join(KIT, "starter-godspeed");
const HOOK = path.join(STARTER, ".claude", "hooks", "give-up-check.js");
const PATTERNS = path.join(STARTER, ".claude", "hooks", "give-up-check.patterns.json");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "kit-guc-"));
const ENV = Object.assign({}, process.env, { TMPDIR: TMP, TMP: TMP, TEMP: TMP });

let n = 0;
const claude = (msg, extra) => Object.assign({ hook_event_name: "Stop", stop_hook_active: false,
  session_id: "claude-" + (++n), transcript_path: "", last_assistant_message: msg }, extra);
const codex = (msg, extra) => Object.assign({ hook_event_name: "Stop", stop_hook_active: false,
  session_id: "codex-" + (++n), turn_id: "turn-1", cwd: TMP, model: "gpt", permission_mode: "default",
  transcript_path: null, last_assistant_message: msg }, extra);

function run(payload, opts) {
  opts = opts || {};
  const r = spawnSync(opts.node || process.execPath, opts.args || [opts.hook || HOOK], {
    input: opts.raw !== undefined ? opts.raw : JSON.stringify(payload),
    encoding: "utf8", env: ENV, cwd: opts.cwd, shell: opts.shell || false, timeout: 15000,
  });
  let out = null;
  try { out = JSON.parse(r.stdout || "null"); } catch (_) { out = null; }
  return { code: r.status, stdout: r.stdout, verdict: out && out.decision === "block" ? "block" : "pass",
    reason: out ? out.reason || "" : "", stderr: r.stderr };
}

let failures = 0;
const check = (name, cond, detail) => {
  console.log((cond ? "PASS  " : "FAIL  ") + name + (cond ? "" : "  (" + String(detail || "").slice(0, 300) + ")"));
  if (!cond) failures++;
};

// 2. Giving up or handing back: the first stop in a turn is blocked, with the right reason.
const GIVES_UP = [
  "I can't do this from here.",
  "I tried the upload twice. You'll need to do this yourself.",
  "This is blocked until the server is back.",
  "I wasn't able to get the export to run, so I'll stop here.",
  "The login needs a code from your phone, so you will need to finish it on your own.",
  "I don\u2019t have access to your calendar.",
  "I've set up the folder. The rest is over to you.",
  "Updated the draft.\n\nUnfortunately I cannot reach the mail server, so please send it manually.",
];
for (const msg of GIVES_UP) {
  for (const [kind, make] of [["Claude Code", claude], ["Codex", codex]]) {
    const r = run(make(msg));
    check(`${kind}: gives up -> asked once: ${JSON.stringify(msg).slice(0, 60)}`, r.verdict === "block" && r.code === 0, r.stdout + r.stderr);
  }
}
{
  const r = run(claude("You'll need to do this yourself."));
  const reason = r.reason.toLowerCase();
  check("reason: show it is done, or truly impossible, or continue",
    /show what shows it is done/.test(reason) && /truly impossible/.test(reason) && /continue the work/.test(reason), r.reason);
  check("reason: never tells it to claim success", /do not say anything is done that is not/.test(reason) &&
    !/(say|claim|report|tell)[^.]*(it is|it's|that it is) (done|finished|complete)/.test(reason.replace(/do not say anything is done that is not/, "")), r.reason);
  check("reason: never tells it to skip asking before an irreversible step",
    /ask them for it/.test(reason) && !/(don't|do not|never|without) ask/.test(reason) && !/skip/.test(reason), r.reason);
  check("reason: quotes the sentence it read", r.reason.includes("You'll need to do this yourself."), r.reason);
}

// 3. Finished messages pass.
const FINISHED = [
  "Done. I added the three people to your notebook and checked each page.",
  "The tests pass: 42 of 42. I committed the fix as a1b2c3d.",
  "Your next free afternoon is Thursday from 2 to 5.",
  "The draft to Sam is ready below. Shall I send it?",
  "I've prepared the deletion of the 12 old files. Do you want me to delete them now?",
  "I couldn't find any errors in the log, and the backup from last night is complete.",
  "The import was blocked by a missing key, so I added it and the import now runs. Nothing is blocked.",
  "Here is the output:\n```\nError: cannot open file; you will need to rerun\n```\nThat was the old run; the new run finished cleanly.",
  "",
];
for (const msg of FINISHED) {
  for (const [kind, make] of [["Claude Code", claude], ["Codex", codex]]) {
    const r = run(make(msg));
    check(`${kind}: finished -> passes: ${JSON.stringify(msg).slice(0, 60)}`, r.verdict === "pass" && r.code === 0 && !r.stdout.trim(), r.stdout);
  }
}

// 4. At most once per turn.
for (const [kind, make] of [["Claude Code", claude], ["Codex", codex]]) {
  const r = run(make("I can't do this.", { stop_hook_active: true }));
  check(`${kind}: stop_hook_active -> passes`, r.verdict === "pass" && r.code === 0, r.stdout);
}
{
  const p = codex("I can't do this.", { session_id: "codex-turns", turn_id: "t-7" });
  const first = run(p);
  const again = run(Object.assign({}, p, { last_assistant_message: "This is blocked." }));
  const next = run(Object.assign({}, p, { turn_id: "t-8" }));
  check("Codex: first stop in a turn is asked", first.verdict === "block", first.stdout);
  check("Codex: a second give-up in the same turn passes, even without stop_hook_active", again.verdict === "pass", again.stdout);
  check("Codex: the next turn is asked again", next.verdict === "block", next.stdout);
}
{
  // Claude Code names no turn: the turn is the last thing the person typed in the transcript.
  const tp = path.join(TMP, "claude-session.jsonl");
  const line = (o) => JSON.stringify(o) + "\n";
  fs.writeFileSync(tp, line({ type: "user", uuid: "u1", message: { role: "user", content: "Please upload the report." } }) +
    line({ type: "assistant", uuid: "a1", message: { role: "assistant", content: [{ type: "text", text: "I can't upload it." }] } }));
  const p = { hook_event_name: "Stop", stop_hook_active: false, session_id: "claude-turns", transcript_path: tp };
  const first = run(p);
  check("Claude Code: last message read from the transcript when the payload has none -> asked", first.verdict === "block", first.stdout);
  const again = run(p);
  check("Claude Code: a second stop in the same turn passes, even without stop_hook_active", again.verdict === "pass", again.stdout);
  fs.appendFileSync(tp, line({ type: "user", uuid: "u2", message: { role: "user", content: "Try again with the other login." } }) +
    line({ type: "user", uuid: "u3", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "ok" }] } }) +
    line({ type: "assistant", uuid: "a2", message: { role: "assistant", content: [{ type: "text", text: "This is still blocked." }] } }));
  const next = run(p);
  check("Claude Code: a new message from the person is a new turn -> asked again", next.verdict === "block", next.stdout);
  const done = run(Object.assign({}, p, { session_id: "claude-turns-2", last_assistant_message: "Uploaded. The report is in the shared folder." }));
  check("Claude Code: the payload's own last message wins over the transcript", done.verdict === "pass", done.stdout);
}

// 5. Any error lets the stop through: exit 0, no block decision.
const quiet = (r) => r.code === 0 && !/"decision"\s*:\s*"block"/.test(r.stdout || "");
check("empty stdin -> passes", quiet(run(null, { raw: "" })));
check("malformed stdin -> passes", quiet(run(null, { raw: "{not json" })));
check("a JSON array -> passes", quiet(run(null, { raw: "[1,2]" })));
check("a JSON string -> passes", quiet(run(null, { raw: "\"I can't do this\"" })));
check("missing fields -> passes", quiet(run({})));
check("no last message and no transcript -> passes", quiet(run({ hook_event_name: "Stop" })));
check("transcript path that does not exist -> passes", quiet(run({ hook_event_name: "Stop", transcript_path: path.join(TMP, "nope.jsonl") })));
check("last message of the wrong type -> passes", quiet(run({ hook_event_name: "Stop", last_assistant_message: { text: "I can't" } })));
check("another event -> passes", quiet(run({ hook_event_name: "PreToolUse", tool_name: "Bash", last_assistant_message: "I can't do this." })));
{
  const dir = fs.mkdtempSync(path.join(TMP, "nopatterns-"));
  fs.copyFileSync(HOOK, path.join(dir, "give-up-check.js"));
  check("missing patterns file -> passes", quiet(run(claude("I can't do this."), { hook: path.join(dir, "give-up-check.js") })));
  fs.writeFileSync(path.join(dir, "give-up-check.patterns.json"), "{ broken");
  check("unreadable patterns file -> passes", quiet(run(claude("I can't do this."), { hook: path.join(dir, "give-up-check.js") })));
  fs.writeFileSync(path.join(dir, "give-up-check.patterns.json"), JSON.stringify({ givesUp: ["(unclosed"], handsBack: ["x"], notGivingUp: ["x"], asksFirst: ["x"] }));
  check("a pattern that throws -> passes", quiet(run(claude("I can't do this."), { hook: path.join(dir, "give-up-check.js") })));
}
{
  // The place it remembers asked turns cannot be written: it does not ask rather than risk asking twice.
  const blocker = path.join(TMP, "a-file-not-a-folder");
  fs.writeFileSync(blocker, "");
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(codex("I can't do this.")), encoding: "utf8",
    env: Object.assign({}, ENV, { TMPDIR: blocker, TMP: blocker, TEMP: blocker }), timeout: 15000 });
  check("cannot remember the turn -> passes", r.status === 0 && !/block/.test(r.stdout), r.stdout + r.stderr);
}

// 1 and 6. Registered for Claude Code and Codex, each running the same hook from its own wiring.
{
  const s = JSON.parse(fs.readFileSync(path.join(STARTER, ".claude", "settings.json"), "utf8"));
  const cmds = (s.hooks.Stop || []).flatMap((e) => (e.hooks || []).map((h) => h.command));
  check("Claude Code: a Stop hook in .claude/settings.json runs give-up-check.js", cmds.some((c) => /give-up-check\.js/.test(c)), cmds.join(" | "));
  check("Claude Code: the obligation-close Stop hook is still registered", cmds.some((c) => /obligation-close-check\.js/.test(c)), cmds.join(" | "));
  const x = JSON.parse(fs.readFileSync(path.join(STARTER, ".codex", "hooks.json"), "utf8"));
  const xcmds = (x.hooks.Stop || []).flatMap((e) => (e.hooks || []).map((h) => h.command));
  check("Codex: a Stop hook in .codex/hooks.json runs give-up-check.js", xcmds.some((c) => /give-up-check\.js/.test(c)), xcmds.join(" | "));

  // Run each wiring's own command line from a copy of the starter, the way each assistant would.
  const mc = fs.mkdtempSync(path.join(TMP, "mc-"));
  fs.cpSync(STARTER, mc, { recursive: true });
  const viaShell = (cmd, env, payload) => spawnSync("bash", ["-c", cmd], { cwd: mc, input: JSON.stringify(payload), encoding: "utf8",
    env: Object.assign({}, ENV, env), timeout: 15000 });
  const claudeCmd = cmds.find((c) => /give-up-check\.js/.test(c));
  const a = viaShell(claudeCmd, { CLAUDE_PROJECT_DIR: mc }, claude("You'll need to do this yourself."));
  check("Claude Code: its settings' command blocks a give-up in a starter install", a.status === 0 && /"decision":"block"/.test(a.stdout), a.stdout + a.stderr);
  const codexCmd = xcmds.find((c) => /give-up-check\.js/.test(c));
  const b = viaShell(codexCmd, {}, codex("You'll need to do this yourself.", { cwd: mc }));
  check("Codex: its hooks.json command blocks a give-up in a starter install", b.status === 0 && /"decision":"block"/.test(b.stdout), b.stdout + b.stderr);
  const c = viaShell(codexCmd, {}, codex("Done: the report is uploaded.", { cwd: mc }));
  check("Codex: its hooks.json command lets a finished message through", c.status === 0 && !c.stdout.trim(), c.stdout + c.stderr);
}

// 7. Generalised: no owner name, personal path or host in what ships.
{
  const texts = [HOOK, PATTERNS, __filename, path.join(STARTER, ".codex", "hooks.json")].map((f) => [f, fs.readFileSync(f, "utf8")]);
  // Spelled in pieces so this file does not match itself.
  const owner = ["mich" + "ael", "zel" + "bel", "godspeed-" + "forge"].join("|");
  const personal = new RegExp(owner + "|/home/[a-z]|C:\\\\Users\\\\|/Users/[a-z]|\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b", "i");
  for (const [f, t] of texts) check("no owner name, personal path or host in " + path.basename(f), !personal.test(t), (t.match(personal) || [])[0]);
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n${failures} failed` : "\nall passed");
process.exit(failures ? 1 : 0);
