#!/usr/bin/env node
/**
 * promise-needs-a-file.js  -  Stop hook (Claude Code and Codex)
 *
 * Purpose: your mission control never promises you something on a clock without writing the
 * promise down where the morning check can see it.
 *
 * Why it exists. An assistant that says "I'll send you this every Sunday" in a chat has made a
 * promise that no file records, nothing runs and nothing checks. The first Sunday passes in
 * silence and nobody notices, because a quiet job and a job that never ran look the same from
 * outside. In the mission control this kit comes from, a weekly talk promised twice in a chat never
 * happened once. A promise in work/promises/ is checked every morning (tools/promises.js), and a
 * missed one is said at the top of the morning brief and of `mc-due today`. This hook is the front
 * door: a turn whose last message makes such a promise is asked once to write the file.
 *
 * Why a hook and not only a rule. A rule in the prompt can be talked past: the promise feels kept
 * because the plan was good. The end of a turn is a moment a program can check.
 *
 * WHAT COUNTS AS A PROMISE. A future in the first person, or with your mission control or you as
 * the one who gets something ("I will", "I'll", "we will", "your mission control will", "you will
 * get"), in the same sentence as a clock ("every Sunday", "each week", "every morning", "from now
 * on", "once a month"). Describing something that already runs ("the brief goes out every
 * morning") has no such future in it and passes.
 *
 * WHAT MAKES IT PASS. A file in work/promises/ other than README.md written or touched in the last
 * twelve hours; the message naming a promises/<name>.md file; a stop that follows a block
 * (stop_hook_active); a scheduled routine's own run (GODSPEED_SCHEDULED_RUN=1), which promises
 * nobody anything; and a mission control without a work/promises/ folder.
 *
 * On ANY error it lets the turn end. It guards one known failure and must never trap a session.
 */

"use strict";

const fs = require("fs");
const path = require("path");

const CADENCE =
  "(?:every|each)\\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday|weekday|day|week|weekend|morning|evening|night|month|fortnight)|" +
  "from\\s+now\\s+on|" +
  "(?:once|twice)\\s+(?:a|per)\\s+(?:day|week|month)|" +
  "(?:daily|weekly|nightly|monthly)\\s+(?:i|we|you)\\b";
const FUTURE =
  "(?:i|we)(?:'ll|\\u2019ll|\\s+will|\\s+am\\s+going\\s+to|\\s+are\\s+going\\s+to)|" +
  "your\\s+mission\\s+control\\s+will|" +
  "you(?:'ll|\\u2019ll|\\s+will)\\s+(?:get|receive|hear|have)";

// A promise is FUTURE and CADENCE inside one sentence, in either order.
const PROMISE = [
  new RegExp("\\b(?:" + FUTURE + ")\\b[^.!?\\n]{0,140}?\\b(?:" + CADENCE + ")\\b", "i"),
  new RegExp("\\b(?:" + CADENCE + ")\\b[^.!?\\n]{0,140}?\\b(?:" + FUTURE + ")\\b", "i"),
];

const NAMES_A_PROMISE = /\bpromises\/[a-z0-9][a-z0-9-]*\.md\b/i;
const FRESH_MS = 12 * 60 * 60 * 1000;

function promisesFolder() {
  const root = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");
  return path.join(root, "work", "promises");
}

function writtenRecently(dir) {
  const now = Date.now();
  for (const n of fs.readdirSync(dir)) {
    if (!/\.md$/i.test(n) || /^readme\.md$/i.test(n)) continue;
    try {
      if (now - fs.statSync(path.join(dir, n)).mtimeMs < FRESH_MS) return true;
    } catch (_) {
      /* gone since it was listed */
    }
  }
  return false;
}

function lastAssistantText(payload) {
  // Claude Code and Codex send last_assistant_message; other assistants lastAssistantMessage.
  const given = payload.last_assistant_message ?? payload.lastAssistantMessage;
  if (typeof given === "string" && given.trim()) return given.trim();
  const tp = payload.transcript_path ?? payload.transcriptPath;
  if (!tp || !fs.existsSync(tp)) return "";
  const lines = fs.readFileSync(tp, "utf8").split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let o;
    try {
      o = JSON.parse(line);
    } catch (_) {
      continue;
    }
    if (!o || o.type !== "assistant") continue;
    const c = o.message && o.message.content;
    if (typeof c === "string") return c.trim();
    if (Array.isArray(c)) {
      const t = c
        .filter((x) => x && x.type === "text" && typeof x.text === "string")
        .map((x) => x.text)
        .join("\n")
        .trim();
      if (t) return t;
    }
  }
  return "";
}

const REASON =
  "This turn's last message promises the person something on a clock, and no promise file in " +
  "work/promises/ was written or touched in the last twelve hours. A promise that is not a file " +
  "there is never checked, and nothing says when it is missed. Before ending: write " +
  "work/promises/<name>.md in the format of work/promises/README.md (what they get, the cadence, " +
  "when it is due, what runs it and the proof it leaves), make sure what runs it really exists, " +
  "and run mc-due today, which names a promise file it cannot read at its top. If the sentence " +
  "only describes something that already runs, reword it so it does not read as a new promise.";

function main() {
  let payload;
  try {
    payload = JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch (_) {
    return;
  }
  if (!payload || typeof payload !== "object") return;
  if (payload.tool_name) return; // a tool call, never this hook's business
  const isStop =
    payload.hook_event_name === "Stop" ||
    "stop_hook_active" in payload || "transcript_path" in payload ||
    "last_assistant_message" in payload || "lastAssistantMessage" in payload;
  if (!isStop) return;
  if (payload.stop_hook_active ?? payload.stopHookActive) return;
  if (process.env.GODSPEED_SCHEDULED_RUN === "1") return;
  const dir = promisesFolder();
  if (!fs.existsSync(dir)) return;
  const text = lastAssistantText(payload);
  if (!text || NAMES_A_PROMISE.test(text)) return;
  if (!PROMISE.some((re) => re.test(text))) return;
  if (writtenRecently(dir)) return;
  process.stdout.write(JSON.stringify({ decision: "block", reason: REASON }));
}

try {
  main();
} catch (_) {
  /* let the turn end */
}
process.exit(0);
