#!/usr/bin/env node
/**
 * obligation-close-check.js  —  Stop hook (Claude Code)
 *
 * Purpose: a session that finishes one of your deadlines' work WITH you closes it before it ends,
 * so the next morning's brief does not hand you back work you already did.
 *
 * Why it exists. In the mission control this kit comes from, its owner approved and published a
 * post in a working session. The session committed the texts and the memory recorded the post as
 * published that day, but nobody ran `mc-due done`, so for five mornings the brief said the
 * finished work was waiting. Done is now an event in world/events/ (see due/README.md), and this
 * hook is the moment every session passes: it asks `mc-due state` which deadlines are not closed
 * yet, compares their names with what THIS session did (your own messages, the files it wrote,
 * its commit messages), and when enough of a deadline's words appear it stops the session once
 * and names it. The assistant then closes it with what shows it
 * (`mc-due done <name> --evidence "..."`) or says in one line why it is not finished. Your
 * approving or doing the work in the session is your word; you are never asked to confirm it.
 *
 * Never twice: each deadline is raised at most once per session, and a stop that follows a block
 * always passes. On any error it lets the session end: it must never trap you.
 *
 * Assistants with no stop boundary (Hermes, Codex, OpenClaw) close it in the same turn instead,
 * as the recipe in procedures/what-runs-out-and-when.md says; see docs/harness-parity.md.
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

// Words that carry no subject here: every obligation and every session is full of them.
const COMMON = new Set((
  "about after again also back been before being both check could date days does done down each " +
  "every first from have here into just last like made make many more most much must need needs next " +
  "once only other over said same should since some still such take than that them then there these " +
  "they this those through under until very want week what when where which while will with within " +
  "would your yours mission control godspeed today tomorrow yesterday file files " +
  "please thanks thank okay good work working session change changes update updated"
).split(/\s+/));

function words(s) {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !COMMON.has(w) && !/^\d+$/.test(w));
}

function projectDir() {
  const here = path.dirname(path.dirname(path.dirname(fs.realpathSync(__filename))));
  for (const d of [process.env.CLAUDE_PROJECT_DIR, here]) {
    if (d && fs.existsSync(path.join(d, "due"))) return d;
  }
  return "";
}

// The kit's deadline program. The installer puts due.js next to its `mc-due` launcher, in a folder
// on PATH; GODSPEED_DUE_JS names it outright (the tests use that).
function dueTool() {
  const cands = [process.env.GODSPEED_DUE_JS, path.join(os.homedir(), ".local", "bin", "due.js")];
  for (const d of String(process.env.PATH || "").split(path.delimiter)) if (d) cands.push(path.join(d, "due.js"));
  return cands.find((p) => p && fs.existsSync(p)) || "";
}

function stillOpen(root) {
  const tool = dueTool();
  if (!tool) return [];
  const r = spawnSync(process.execPath, [tool, "--godspeed", root, "state", "--json"], {
    encoding: "utf8", timeout: 8000, env: Object.assign({}, process.env, { GODSPEED_ROOT: root }),
  });
  if (r.status !== 0) return [];
  const rows = JSON.parse(r.stdout || "[]");
  return Array.isArray(rows) ? rows.filter((x) => x && (x.state === "open" || x.state === "unopened")) : [];
}

// Never the assistant's own prose, which quotes the brief and would match every deadline it names.
function sessionText(payload) {
  const tp = payload.transcript_path ?? payload.transcriptPath;
  if (!tp || !fs.existsSync(tp)) return "";
  const out = [];
  for (const line of fs.readFileSync(tp, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch (_) { continue; }
    const c = o.message && o.message.content;
    if (o.type === "user") {
      const texts = typeof c === "string" ? [c] : Array.isArray(c) ? c.filter((x) => x && x.type === "text").map((x) => x.text) : [];
      for (const t of texts) {
        const clean = String(t).replace(/<([a-z-]+)[^>]*>[\s\S]*?<\/\1>/gi, " ").trim();
        if (clean && !clean.startsWith("<")) out.push(clean);
      }
    } else if (o.type === "assistant" && Array.isArray(c)) {
      for (const x of c) {
        if (!x || x.type !== "tool_use" || !x.input) continue;
        if (x.input.file_path) out.push(String(x.input.file_path).replace(/[\\/]/g, " "));
        if (x.input.notebook_path) out.push(String(x.input.notebook_path).replace(/[\\/]/g, " "));
        const cmd = String(x.input.command || "");
        if (/\bgit\b[^\n]*\bcommit\b/.test(cmd)) out.push(cmd);
      }
    }
  }
  return out.join("\n");
}

function need(n) { return n <= 2 ? n : n <= 4 ? 2 : 3; }

function matches(obligations, text) {
  const seen = new Set(words(text));
  const hits = [];
  for (const o of obligations) {
    const terms = [...new Set(words(o.title).concat(words(String(o.slug).replace(/-/g, " "))))];
    if (!terms.length) continue;
    const found = terms.filter((w) => seen.has(w));
    if (found.length >= need(terms.length)) hits.push(Object.assign({ found }, o));
  }
  return hits;
}

function raisedFile(sessionId) {
  const dir = path.join(os.tmpdir(), "mc-obligation-close");
  return path.join(dir, String(sessionId || "no-session").replace(/[^A-Za-z0-9_-]/g, "_") + ".json");
}

function main() {
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch (_) {
    process.exit(0);
  }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) process.exit(0);
  try {
    if (payload.tool_name) process.exit(0);
    const isStop = payload.hook_event_name === "Stop" || "stop_hook_active" in payload || "transcript_path" in payload;
    if (!isStop) process.exit(0);
    if (payload.stop_hook_active ?? payload.stopHookActive) process.exit(0);
    const root = projectDir();
    if (!root) process.exit(0);
    const text = sessionText(payload);
    if (!text) process.exit(0);
    const open = stillOpen(root);
    if (!open.length) process.exit(0);
    const f = raisedFile(payload.session_id ?? payload.sessionId);
    let raised = [];
    try { raised = JSON.parse(fs.readFileSync(f, "utf8")); } catch (_) { raised = []; }
    const hits = matches(open, text).filter((o) => !raised.includes(o.slug)).slice(0, 3);
    if (!hits.length) process.exit(0);
    try {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify(raised.concat(hits.map((o) => o.slug))));
    } catch (_) {
      process.exit(0); // cannot remember that it asked, so it does not ask: never twice
    }
    const lines = hits.map((o) => `- ${o.slug}: ${o.title}. Finished when: ${o.doneWhen || "(not written)"}` +
      ` (this session touched: ${o.found.join(", ")})`);
    const reason =
      "Before ending: this session's work overlaps " + (hits.length === 1 ? "a deadline" : "deadlines") +
      " still open in due/, which the morning brief will keep showing the person until an event closes it:\n" +
      lines.join("\n") + "\n" +
      "For each one: if this session's work, or what the person said or approved in it, meets 'finished when', " +
      "close it now with the evidence: mc-due done <name> --evidence \"<a commit, or their words>\". " +
      "If it is not finished, say in one line why. Do not ask the person to confirm it: their approval in this " +
      "session is their word. This check runs once per deadline per session.";
    process.stdout.write(JSON.stringify({ decision: "block", reason }));
    process.exit(0);
  } catch (_) {
    process.exit(0);
  }
}

if (require.main === module) main();
module.exports = { words, matches, need };
