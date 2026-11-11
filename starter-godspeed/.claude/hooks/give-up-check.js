#!/usr/bin/env node
/**
 * give-up-check.js  -  Stop hook (Claude Code and Codex)
 *
 * Purpose: before your assistant ends a turn by giving up ("I can't do this", "this is blocked")
 * or by handing the work back to you ("you'll need to do this yourself"), it is asked once whether
 * it is really finished. If it stopped early, it carries on. Finished work passes straight through.
 *
 * Why a check and not a line in the instructions: a sentence saying "don't give up early" is
 * advice the model can talk itself past at the very moment of stopping. A program at the end of
 * the turn cannot be talked past.
 *
 * What it reads: only the assistant's last message. Claude Code and Codex both send it to a stop
 * hook as `last_assistant_message`; when it is missing, the last assistant text in the
 * session's transcript is used. Code blocks and quoted output are taken out first, so a log line
 * that says "cannot" is not the assistant giving up. The phrases it looks for are in
 * give-up-check.patterns.json beside this file.
 *
 * What it never does: it never tells the assistant to say the work is done, and never tells it to
 * skip asking you before a step that cannot be undone (sending, paying, deleting, publishing).
 * Asking you first is always a finished ending: a message that ends by asking for your yes passes.
 *
 * Never twice: it asks at most once per turn. A stop that follows its own block always passes
 * (`stop_hook_active`), and it remembers the turns it asked in. On any error, a missing patterns
 * file, or input it does not understand, it lets the turn end: it must never trap you.
 */

"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const PATTERNS = path.join(__dirname, "give-up-check.patterns.json");

function loadPatterns(file) {
  const raw = JSON.parse(fs.readFileSync(file || PATTERNS, "utf8"));
  const list = (k) => {
    if (!Array.isArray(raw[k]) || !raw[k].length) throw new Error("patterns file has no " + k);
    return raw[k].map((s) => new RegExp(s, "i"));
  };
  return { givesUp: list("givesUp"), handsBack: list("handsBack"), notGivingUp: list("notGivingUp"), asksFirst: list("asksFirst") };
}

// The prose of a message, without what it quotes: fenced code, inline code, quoted lines.
function prose(text) {
  return String(text || "")
    .replace(/[‘’ʼ]/g, "'")
    .replace(/```[\s\S]*?(?:```|$)/g, "\n")
    .replace(/`[^`\n]*`/g, " ")
    .split(/\r?\n/).filter((l) => !/^\s*>/.test(l)).join("\n");
}

function sentences(text) {
  return prose(text).split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);
}

// What a message says about stopping: the sentence that gives up or hands back, or "" when it
// reads as finished.
function verdict(text, p) {
  const all = sentences(text);
  if (!all.length) return "";
  // Asking the person before an irreversible step is the right way to end a turn, never early.
  const last = all[all.length - 1];
  if (/\?\s*$/.test(last) && p.asksFirst.some((r) => r.test(last))) return "";
  for (const s of all) {
    if (p.notGivingUp.some((r) => r.test(s))) continue;
    if (p.givesUp.some((r) => r.test(s)) || p.handsBack.some((r) => r.test(s))) return s;
  }
  return "";
}

// The assistant's last text in a Claude Code or Codex transcript, for a payload that did not send it.
function lastFromTranscript(tp) {
  if (!tp || !fs.existsSync(tp)) return "";
  let last = "";
  for (const line of fs.readFileSync(tp, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    let o;
    try { o = JSON.parse(line); } catch (_) { continue; }
    const m = (o && (o.message || (o.payload && o.payload.type === "message" && o.payload))) || null;
    if (!m) continue;
    const role = o.type === "assistant" ? "assistant" : m.role;
    if (role !== "assistant") continue;
    const c = m.content;
    const texts = typeof c === "string" ? [c] : Array.isArray(c)
      ? c.filter((x) => x && (x.type === "text" || x.type === "output_text") && x.text).map((x) => x.text) : [];
    if (texts.length) last = texts.join("\n");
  }
  return last;
}

// Which turn this is. Codex names it (turn_id); Claude Code does not, so the turn is the last
// thing the person typed in the transcript. With neither, `stop_hook_active` alone keeps it to once.
function turnKey(payload) {
  const turn = payload.turn_id ?? payload.turnId;
  if (turn) return String(turn);
  const tp = payload.transcript_path ?? payload.transcriptPath;
  if (!tp || !fs.existsSync(tp)) return "";
  let key = "";
  for (const line of fs.readFileSync(tp, "utf8").split(/\r?\n/)) {
    if (!line.includes('"user"')) continue;
    let o;
    try { o = JSON.parse(line); } catch (_) { continue; }
    if (!o || o.type !== "user" || !o.message) continue;
    const c = o.message.content;
    const typed = typeof c === "string" || (Array.isArray(c) && c.some((x) => x && x.type === "text"));
    if (typed) key = String(o.uuid || o.timestamp || JSON.stringify(c).slice(0, 400));
  }
  return key;
}

function askedFile(sessionId) {
  const dir = path.join(os.tmpdir(), "mc-give-up-check");
  return path.join(dir, String(sessionId || "no-session").replace(/[^A-Za-z0-9_-]/g, "_") + ".json");
}

function reasonFor(sentence) {
  const quote = sentence.length > 200 ? sentence.slice(0, 197) + "..." : sentence;
  return "Before you end this turn: your last message reads like stopping early or handing the work back (\"" +
    quote + "\"). Check it honestly. If the work is done, show what shows it is done. If it is truly " +
    "impossible from here, show why: what you tried and what stands in the way. Otherwise, continue the " +
    "work now. Do not say anything is done that is not. If the next step needs the person's yes first " +
    "(sending, paying, deleting, publishing, anything that cannot be undone), ask them for it: that is a " +
    "right way to end the turn. This check asks once per turn.";
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
    if (payload.hook_event_name && payload.hook_event_name !== "Stop") process.exit(0);
    if (payload.stop_hook_active ?? payload.stopHookActive) process.exit(0);
    let text = payload.last_assistant_message ?? payload.lastAssistantMessage;
    if (typeof text !== "string" || !text.trim()) text = lastFromTranscript(payload.transcript_path ?? payload.transcriptPath);
    if (!text) process.exit(0);
    const said = verdict(text, loadPatterns());
    if (!said) process.exit(0);

    // Once per turn, remembered: a turn it already asked in passes, and a turn it cannot write
    // down is not asked at all, so it can never ask twice.
    const turn = turnKey(payload);
    if (turn) {
      const f = askedFile(payload.session_id ?? payload.sessionId);
      const id = crypto.createHash("sha256").update(turn).digest("hex").slice(0, 16);
      let asked = [];
      try { asked = JSON.parse(fs.readFileSync(f, "utf8")); } catch (_) { asked = []; }
      if (!Array.isArray(asked)) asked = [];
      if (asked.includes(id)) process.exit(0);
      try {
        fs.mkdirSync(path.dirname(f), { recursive: true });
        fs.writeFileSync(f, JSON.stringify(asked.concat(id).slice(-200)));
      } catch (_) {
        process.exit(0);
      }
    }
    process.stdout.write(JSON.stringify({ decision: "block", reason: reasonFor(said) }));
    process.exit(0);
  } catch (_) {
    process.exit(0);
  }
}

if (require.main === module) main();
module.exports = { verdict, loadPatterns, prose, sentences, reasonFor };
