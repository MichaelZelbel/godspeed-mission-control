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
 * yet, compares their titles with what THIS session said (your own messages and its commit
 * messages, never file paths), and when at least half of a title's words appear, one of them
 * specific to that deadline, it stops the session once and names it. The assistant then closes it
 * with what shows it (`mc-due done <name> --evidence "..."`) and may say in plain words what is now settled. If it is
 * not finished, the assistant does nothing and says nothing: you never hear about a deadline a
 * session did not finish. Your approving or doing the work in the session is your word; you are
 * never asked to confirm it.
 *
 * A deadline with a self check (a key whose date lives in secrets/expires.txt, a backup file) is
 * never raised on words: `mc-due check` proves it closed by itself, and this hook runs that check
 * quietly when the session edited secrets/expires.txt. Words are a guess; a self check is proof.
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

// Words that count toward a match but can never be its anchor: they describe how half the
// deadlines are done (a key, a deploy, a login, a post), or name an assistant that comes up in
// nearly every session, so a session full of them has not done any one.
const GENERIC = new Set((
  "deploy database server machine machines token login access cron claude code supabase renew " +
  "replace replacing read lets email account page link store hermes openclaw codex post posts free"
).split(/\s+/));

// Each word, and each hyphenated name joined as well ("Ko-fi" is kofi), because the part that
// names a thing is often too short to count on its own. A part of a hyphenated name counts toward
// a match but is never an anchor: "self" is not "Self-Ops".
function tokens(s) {
  const out = [];
  const flat = String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  for (const g of flat.match(/[a-z0-9]+(?:-[a-z0-9]+)*/g) || []) {
    const parts = g.split("-");
    if (parts.length > 1) out.push({ w: parts.join(""), anchor: true });
    for (const p of parts) out.push({ w: p, anchor: parts.length === 1 });
  }
  return out.filter((t) => t.w.length >= 4 && !COMMON.has(t.w) && !/^\d+$/.test(t.w));
}

function words(s) { return tokens(s).map((t) => t.w); }

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

function due(root, args) {
  const tool = dueTool();
  if (!tool) return null;
  return spawnSync(process.execPath, [tool, "--godspeed", root].concat(args), {
    encoding: "utf8", timeout: 8000, env: Object.assign({}, process.env, { GODSPEED_ROOT: root }),
  });
}

function stillOpen(root) {
  const r = due(root, ["state", "--json"]);
  if (!r || r.status !== 0) return [];
  const rows = JSON.parse(r.stdout || "[]");
  return Array.isArray(rows) ? rows.filter((x) => x && (x.state === "open" || x.state === "unopened")) : [];
}

// An older due.js has no selfCheck in its rows, so the head is read from the file.
function selfCheck(root, o) {
  if (typeof o.selfCheck === "string") return o.selfCheck || "none";
  try {
    const m = fs.readFileSync(path.join(root, "due", o.slug + ".md"), "utf8").match(/^SELF-CHECK:[ \t]*(.*)$/m);
    return (m && m[1].trim().toLowerCase()) || "none";
  } catch (_) {
    return "none";
  }
}

// What this session said: the person's messages and the commit messages. Never the assistant's
// own prose, which quotes the brief and would match every deadline it names, and never file
// paths, whose folder names are where the work sat, not what it was. Also whether it touched a
// key's date, for `mc-due check`.
function readSession(payload) {
  const tp = payload.transcript_path ?? payload.transcriptPath;
  if (!tp || !fs.existsSync(tp)) return { text: "", touchedSecrets: false };
  const out = [];
  let touchedSecrets = false;
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
        const cmd = String(x.input.command || "");
        if (/secrets[\\/]+expires\.txt$/i.test(String(x.input.file_path || "")) ||
            /secrets-(edit|set)\b|secrets[\\/]+expires\.txt/i.test(cmd)) touchedSecrets = true;
        const message = commitMessage(cmd);
        if (message) out.push(message);
      }
    }
  }
  return { text: out.join("\n"), touchedSecrets };
}

// Only the `git commit` itself and its message, never the edits chained in front of it (a command
// that rewrites five files and then commits is not five subjects of the work) and never a script
// that merely quotes a commit somewhere in its middle. The commit runs to the first line break
// outside quotes; a heredoc it reads its message from is added.
function commitMessage(cmd) {
  // A command that starts with git (after a line break, ;, &&, || or a pipe), options allowed.
  const m = /(?:^|[\n;&|(])[ \t]*(git\b(?:[ \t]+-[^\s]+(?:[ \t]+[^\s-][^\s]*)?)*?[ \t]+commit\b)/.exec(cmd);
  if (!m) return "";
  const rest = cmd.slice(m.index + m[0].length - m[1].length);
  let q = null, i = 0;
  for (; i < rest.length; i++) {
    const c = rest[i];
    if (c === "\\") { i++; continue; }
    if (q) { if (c === q) q = null; } else if (c === '"' || c === "'") q = c; else if (c === "\n") break;
  }
  const line = rest.slice(0, i);
  const hd = line.match(/<<-?\s*['"]?(\w+)['"]?/);
  if (!hd || new RegExp("\\n\\s*" + hd[1] + "\\b").test(line)) return line; // -m "$(cat <<EOF ...)" is all quoted
  const body = rest.slice(i).match(new RegExp("\\n([\\s\\S]*?)\\n\\s*" + hd[1] + "\\s*(?:\\n|$)"));
  return line + (body ? "\n" + body[1] : "");
}

// At least half the title's words, never fewer than two: a one-word title is never matched.
function need(n) { return Math.max(2, Math.ceil(n / 2)); }

function matches(obligations, text) {
  const seen = new Set(words(text));
  const termsOf = new Map(obligations.map((o) => [o.slug, [...new Set(words(o.title))]]));
  const hits = [];
  for (const o of obligations) {
    const terms = termsOf.get(o.slug);
    const found = terms.filter((w) => seen.has(w));
    if (found.length < need(terms.length)) continue;
    // The anchor: a word that names THIS deadline and no other one. Two deadlines about the same
    // newsletter post share "newsletter", so each is told apart by its own word (welcome, publish).
    const whole = new Set(tokens(o.title).filter((t) => t.anchor).map((t) => t.w));
    const anchors = found.filter((w) => whole.has(w) && !GENERIC.has(w) &&
      !obligations.some((x) => x.slug !== o.slug && termsOf.get(x.slug).includes(w)));
    if (anchors.length) hits.push(Object.assign({ found }, o));
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
    const { text, touchedSecrets } = readSession(payload);
    // A renewed key closes itself by its own proof; this only makes that happen now instead of at
    // the next morning run. Quiet, bounded, and whatever it says, it never blocks.
    if (touchedSecrets) { try { due(root, ["check"]); } catch (_) { /* fail open */ } }
    if (!text) process.exit(0);
    const open = stillOpen(root).filter((o) => selfCheck(root, o) === "none");
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
      ` (words it shares with this session: ${o.found.join(", ")})`);
    const reason =
      "This session may have finished " + (hits.length === 1 ? "an open deadline" : "open deadlines") + ":\n" +
      lines.join("\n") + "\n" +
      "For each one: if this session's work, or what the person said or approved in it, meets 'finished when', " +
      "close it now: mc-due done <name> --evidence \"<a commit, or their words>\". If you mention it in your " +
      "final message, say in plain words what is now settled and why, never its name, the command or the " +
      "matched words. If it does not, do nothing and do not mention it: end the turn without any " +
      "text about it. Do not ask the person to confirm it: their approval in this session is their word. " +
      "This check runs once per deadline per session.";
    process.stdout.write(JSON.stringify({ decision: "block", reason }));
    process.exit(0);
  } catch (_) {
    process.exit(0);
  }
}

if (require.main === module) main();
module.exports = { words, matches, need, commitMessage };
