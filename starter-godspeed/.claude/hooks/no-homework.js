#!/usr/bin/env node
/**
 * no-homework.js  -  PreToolUse + Stop hook (Claude Code and Codex)
 *
 * Purpose: an assistant working in your mission control cannot hand you a worksheet.
 *
 * Why it exists. An assistant that is unsure of some facts is tempted to finish by publishing a
 * page with an empty "True answer" column and telling you: "open the link, write the answer next
 * to each, and tell me." That fails twice. A published page is a read-only web page, so there is
 * nothing to write in and the request cannot be done. And most of those answers are usually
 * already in your mission control: its memory, its notes, earlier conversations, the git history.
 * The assistant was meant to look there first. A line in the instructions saying "finish the work
 * yourself" does not stop this, because "I need you to confirm the ground truth" sounds careful in
 * the moment. A hook cannot be talked past.
 *
 * TWO HALVES, because the failure has two.
 *
 *  1. PreToolUse, the page. Refuses to publish or upload a document that carries blanks for the
 *     person: an answer column with empty cells, or a sentence telling them to write into the
 *     page. If the page cannot carry homework, no message can point at homework. Publishing means
 *     the Artifact tool, `scp <file> user@host:...`, and any command named in no-homework.json
 *     next to this file:
 *         {"publish_commands": ["site publish", "mysite-upload"]}
 *     A missing or unreadable no-homework.json means only the built-in ones are checked.
 *
 *  2. Stop, the message. Refuses to end a turn whose last message tells the person to open a link
 *     and fill something in. It asks ONCE per turn, then the next stop goes through.
 *
 * WHAT THIS IS NOT. It does not ban asking the person questions. A fact only they hold (what they
 * want, what they decide, a number that exists only on their phone) is theirs to give, and asking
 * for it in the chat, in one plain sentence they can answer by typing a reply, is the right thing
 * to do. What is refused is the worksheet: a batch of blanks, parked in a document, that they are
 * told to go and complete.
 *
 * A document or message that mentions "no-homework" is talking ABOUT this check (a write-up of it,
 * for example) and may quote its wording. It may still not carry a real empty answer column.
 *
 * On any error it allows, so it can never trap a session. Turning it off is the person's call:
 * delete its entries in .claude/settings.json and .codex/hooks.json.
 *
 * Output:
 *   PreToolUse deny:  exit 2, the reason on stderr (goes back to the model; Claude Code and Codex)
 *   Stop block:       stdout {"decision":"block","reason":"..."}, exit 0 (Claude Code and Codex)
 *   allow:            exit 0, nothing on stdout
 * Tests: tools/test-no-homework-hook.js. See docs/harness-parity.md for which assistants run it.
 */

"use strict";

const fs = require("fs");
const path = require("path");

// The mission control is the folder that holds .claude/hooks/ (this file's own folder, two up).
const ROOT = path.resolve(__dirname, "..", "..");
const SETTINGS = path.join(__dirname, "no-homework.json");

/* ------------------------------------------------------------------ *
 * Patterns
 * ------------------------------------------------------------------ */

const NUMBER_WORDS =
  "(?:\\d+|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty)";

// Sentences that hand the person a task inside a document or a message. Deliberately narrow:
// each one is an instruction to SUPPLY something, not a mention of them.
//
// "add" pairs only with answers, never with value: "this will add real value to the brief" is
// ordinary English. And "confirm all 12" after "I" or "we" is a report on tests, not a request.
// Not when the assistant says it will do the writing itself ("I'll write the answers in").
const NOT_MINE = "(?<!\\b(?:i|we|i'll|we'll|i\\s+will|we\\s+will|i\\s+can|we\\s+can|i've|we've|i\\s+have|we\\s+have)\\s+)";
const TO_PERSON = "\\b(write|fill|enter|put|type)\\b";

const HOMEWORK_SENTENCES = [
  // "... into this page", "... on the sheet": the person is to write into the document itself.
  new RegExp(NOT_MINE + TO_PERSON + "[^.\\n]{0,50}\\b(into|in|on)\\s+(this|the)\\s+(page|document|doc|sheet|form|table)\\b", "i"),
  // "... in the right-hand column", "... into the last column".
  new RegExp(NOT_MINE + TO_PERSON + "[^.\\n]{0,50}\\b(in|into)\\s+the\\s+[a-z -]{0,30}\\bcolumn\\b", "i"),
  // The verb before "next to each": "write your answers next to each item".
  new RegExp(NOT_MINE + "\\b(write|fill|answer|put|tell)\\b[^.\\n]{0,50}\\bnext to each\\b", "i"),
  /\b(write|fill|enter|put|type)\s+(in\s+)?(the\s+|your\s+)?(true\s+|right\s+|correct\s+|real\s+)?(answer|answers|value|values)\b/i,
  /\badd\s+(in\s+)?(the\s+|your\s+)?(true\s+|right\s+|correct\s+|real\s+)?(answer|answers)\b/i,
  /\bfill\s+(in|out)\s+(the|this|each|every|these)\b/i,
  /\b(the\s+)?(right-?hand\s+|last\s+|final\s+|empty\s+)?column\s+is\s+(the\s+)?only\s+thing\s+missing\b/i,
  /\bis\s+the\s+only\s+thing\s+missing\b/i,
  /\b(open|click|follow)\s+the\s+link[^.\n]{0,80}\b(and|then)\b[^.\n]{0,60}\b(write|fill|answer|complete|tell me)\b/i,
  /\bthe moment the (right-?hand )?column is filled\b/i,
  new RegExp(
    "(?<!\\b(?:i|we|i can|we can)\\s+)\\b(answer|complete|confirm)\\s+(each|all|every)\\s+(of\\s+)?(the\\s+)?" +
      NUMBER_WORDS +
      "\\b",
    "i"
  ),
  /\bnext to each\b[^.\n]{0,40}\b(write|answer|put|tell)\b/i,
];

// The same shape written as a heading inside a document.
//
// An answer COLUMN header is deliberately not listed here. A table with a filled-in "True answer"
// column is a finished report and must publish normally; it is the EMPTY cell that is the
// homework, and findBlankAnswerColumn below catches that. Matching the header itself would refuse
// the corrected report along with the worksheet, and teach the next assistant to route around
// the check.
const HOMEWORK_HEADINGS = [
  /^\s*#{1,6}\s*(what|anything)\s+(is|I)\s+need(ed)?\s+from\s+(you|the\s+person|the\s+user)\b/im,
  /^\s*#{1,6}[^\n]*\bfor\s+(you|the\s+person|the\s+user)\s+to\s+(fill|answer|complete)\b/im,
];

// Last-message shapes that hand the turn back with a worksheet attached.
const STOP_HOMEWORK = HOMEWORK_SENTENCES.concat([
  /\b(waiting|blocked|gated)\s+on\s+(your|the\s+person'?s|the\s+user'?s)\s+(answers?|input|confirmation)\b/i,
]);

/* ------------------------------------------------------------------ *
 * Shared helpers
 * ------------------------------------------------------------------ */

function allow() {
  process.exit(0);
}

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch (_) {
    return "";
  }
}

function mentionsThisCheck(text) {
  return /no-homework/i.test(text);
}

// Extra publish commands from no-homework.json next to this file. Missing or broken: none.
function configuredPublishCommands() {
  try {
    const cfg = JSON.parse(fs.readFileSync(SETTINGS, "utf8"));
    const list = cfg && Array.isArray(cfg.publish_commands) ? cfg.publish_commands : [];
    return list.filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim());
  } catch (_) {
    return [];
  }
}

function escapeRx(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * A markdown or HTML table holding an answer-shaped column with empty cells.
 * This is the strongest signal there is: a blank someone is meant to fill.
 * Returns a short description, or null.
 */
function findBlankAnswerColumn(text) {
  // Markdown
  const lines = text.split(/\r?\n/);
  let headerCols = null;
  for (const line of lines) {
    if (!/^\s*\|/.test(line)) {
      // Any line that is not a table row ends the table (a separator row is a table row). Ending
      // it only on a blank line carried one table's header into the next table after a line of
      // prose, and an empty "Notes" cell there was read as an empty "Answer" cell.
      headerCols = null;
      continue;
    }
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (!cells.length) continue;

    // A separator row (---) means the row before it was the header.
    if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue;

    if (!headerCols) {
      headerCols = cells.map((c) => c.toLowerCase());
      continue;
    }

    // Body row. Is any cell empty under an answer-shaped header?
    for (let c = 0; c < cells.length && c < headerCols.length; c++) {
      const head = headerCols[c] || "";
      const isAnswerCol =
        /\b(answer|value|response|reply|correct|truth|true)\b/.test(head) || /\byour\b/.test(head);
      if (isAnswerCol && cells[c] === "") {
        return 'a markdown table with an empty "' + head.trim() + '" cell';
      }
    }
  }

  // HTML
  const htmlHead = /<th[^>]*>\s*(?:true|correct|real|your)\s+answer\s*<\/th>/i;
  if (htmlHead.test(text) && /<td[^>]*>\s*(?:&nbsp;|\s)*<\/td>/i.test(text)) {
    return "an HTML table with an empty answer column";
  }

  return null;
}

/**
 * Every local file path this tool call is about to send somewhere:
 * the Artifact tool, `scp <file> user@host:...`, and each configured publish command.
 */
function publishedPaths(tool, input, publishCommands) {
  const out = [];

  if (tool === "Artifact" && typeof input.file_path === "string") {
    out.push(input.file_path);
  }

  const cmd =
    (typeof input.command === "string" && input.command) ||
    (typeof input.script === "string" && input.script) ||
    "";

  if (cmd) {
    let m;
    // <publish command> [flags] <file> ...   every non-flag word up to the end of that command
    // is a candidate; only the ones that are real files get read.
    for (const pc of publishCommands) {
      const words = pc.split(/\s+/).map(escapeRx).join("\\s+");
      const rx = new RegExp("(?:^|[\\s;&|(])" + words + "(?=\\s|$)([^\\n;&|]*)", "g");
      while ((m = rx.exec(cmd))) {
        const tok = /"([^"]+)"|'([^']+)'|(\S+)/g;
        let t;
        while ((t = tok.exec(m[1]))) {
          const word = t[1] || t[2] || t[3];
          if (word && !word.startsWith("-") && !/^[<>]/.test(word)) out.push(word);
        }
      }
    }

    // scp [flags] <src> user@host:...
    const scp = /\bscp\b[^\n]*?\s(?:"([^"]+)"|'([^']+)'|([^\s]+))\s+[\w.-]+@[\w.-]+:/g;
    while ((m = scp.exec(cmd))) out.push(m[1] || m[2] || m[3]);
  }

  return out.filter((p) => typeof p === "string" && p);
}

// Relative paths are read against the session's folder first, then the mission control.
function readCandidate(p, cwd) {
  const tries = path.isAbsolute(p) ? [p] : [];
  if (!path.isAbsolute(p)) {
    if (typeof cwd === "string" && cwd) tries.push(path.resolve(cwd, p));
    tries.push(path.join(ROOT, p));
  }
  for (const t of tries) {
    try {
      if (fs.statSync(t).isFile()) return fs.readFileSync(t, "utf8");
    } catch (_) {
      /* keep trying */
    }
  }
  return "";
}

/* ------------------------------------------------------------------ *
 * Mode 1 - PreToolUse: refuse to publish a worksheet
 * ------------------------------------------------------------------ */

function denyTool(what, detail) {
  process.stderr.write(
    "BLOCKED by the no-homework check: " +
      what +
      "\n" +
      (detail ? "  " + detail + "\n" : "") +
      "\n" +
      "A published page is a read-only web page. The person cannot type into it, so a page " +
      "with blanks for them to fill asks for something they cannot do, and most of those " +
      "blanks are usually already answered somewhere in the mission control.\n\n" +
      "Do this instead, in order:\n" +
      "  1. LOOK UP THE ANSWERS IN THE MISSION CONTROL FIRST. Search before you ask: its memory " +
      "and notes, earlier conversations, the git log, any connected notebook or memory service, " +
      "and the page itself.\n" +
      "  2. If two recorded values disagree, check where each one came from. A value a " +
      "program or an assistant wrote is yours to correct on evidence. Only a value the " +
      "person typed themselves is theirs, and even that can be replaced by a newer, dated " +
      "record so nothing is lost.\n" +
      "  3. Ask only what remains, as a plain question in the chat: one sentence that says what " +
      "it is about and that the person can answer by typing a reply. Never a batch. Never a " +
      "blank parked in a document. Never a link they have to go and edit.\n\n" +
      "Publish the page once the blanks are gone. If you believe this check is wrong, say so " +
      "and stop. Do not route around it, and do not edit or delete it.\n"
  );
  process.exit(2); // exit 2 = refuse the tool call; stderr goes back to the model
}

function runPreToolUse(payload) {
  const tool = payload.tool_name;
  const input = payload.tool_input && typeof payload.tool_input === "object" ? payload.tool_input : {};

  let paths = [];
  try {
    paths = publishedPaths(tool, input, configuredPublishCommands());
  } catch (_) {
    allow();
  }
  if (!paths.length) allow();

  for (const p of paths) {
    let body = "";
    let blank = null;
    let hit = null;
    try {
      body = readCandidate(p, payload.cwd);
      if (!body) continue;

      // A real blank is checked ALWAYS, whether or not the page names this check. A page
      // explaining this check has every reason to quote its sentences and no reason at all to
      // carry an empty answer column, so the exemption stops here.
      blank = findBlankAnswerColumn(body);
      if (!blank && !mentionsThisCheck(body)) {
        // The wording checks below are the ones a write-up legitimately trips by quoting.
        if (HOMEWORK_HEADINGS.some((rx) => rx.test(body))) {
          hit = { what: "publishing a page that carries a blank for the person to fill", detail: p };
        } else {
          for (const rx of HOMEWORK_SENTENCES) {
            const m = body.match(rx);
            if (m) {
              hit = {
                what: "publishing a page that tells the person to write their answers into it",
                detail: 'it says: "' + String(m[0]).trim().slice(0, 90) + '"',
              };
              break;
            }
          }
        }
      }
    } catch (_) {
      continue;
    }
    if (blank) denyTool("publishing a worksheet, " + blank, p);
    if (hit) denyTool(hit.what, hit.detail);
  }

  allow();
}

/* ------------------------------------------------------------------ *
 * Mode 2 - Stop: refuse to end the turn by handing over a worksheet
 * ------------------------------------------------------------------ */

const STOP_CHALLENGE =
  "NO-HOMEWORK CHECK: your last message hands the person a worksheet instead of a finished " +
  "piece of work.\n\n" +
  "It asks them to open a page or link and fill something in. A published page is a web page, " +
  "not an editor, so they cannot write in it, and the answers are usually already somewhere in " +
  "the mission control.\n\n" +
  "Before you stop, do this:\n" +
  "1. Find the answers yourself: take every blank you just handed over and look it up in the " +
  "mission control's memory and notes, earlier conversations, the git log, any connected " +
  "notebook or memory service, and the person's own accounts or websites if you can reach " +
  "them. They have usually told you already.\n" +
  "2. For a disagreement between two recorded values, check where each came from before " +
  "calling it theirs to settle. A value a program or an assistant wrote is yours to correct " +
  "on evidence; only a value they typed themselves is theirs.\n" +
  "3. Whatever is truly left (a fact that exists only in their head, or a decision that is " +
  "only theirs) becomes ONE plain sentence in the chat that they can answer by typing a " +
  "reply. Not a batch, not a table, not a link to go and edit. If there is more than one, " +
  "pick the one that actually blocks the work and carry the rest yourself.\n\n" +
  "Then say what you did, and stop. This check asks once per turn, so a finished answer " +
  "goes straight through.";

function transcriptText(transcriptPath) {
  if (typeof transcriptPath !== "string" || !transcriptPath) return "";
  const lines = fs.readFileSync(transcriptPath, "utf8").split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (_) {
      continue;
    }
    if (obj && obj.type === "assistant" && obj.message && Array.isArray(obj.message.content)) {
      const t = obj.message.content
        .filter((b) => b && b.type === "text" && typeof b.text === "string")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (t) return t;
    }
  }
  return "";
}

function textOf(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b && typeof b.text === "string")
    .map((b) => b.text)
    .join("\n");
}

// True when this check's challenge already appears in the transcript since the person's last
// message: it asked in this turn already. A transcript that cannot be read says no.
function askedThisTurn(transcriptPath) {
  if (typeof transcriptPath !== "string" || !transcriptPath) return false;
  let lines;
  try {
    lines = fs.readFileSync(transcriptPath, "utf8").split(/\r?\n/);
  } catch (_) {
    return false;
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    if (line.includes("NO-HOMEWORK CHECK")) return true;
    let e;
    try {
      e = JSON.parse(line);
    } catch (_) {
      continue;
    }
    if (!e || e.type !== "user" || e.isMeta || !e.message) continue;
    const c = e.message.content;
    if (Array.isArray(c) && c.some((b) => b && b.type === "tool_result")) continue;
    const t = textOf(c).trim();
    if (t && !/^stop hook feedback/i.test(t)) return false; // the person's own message: turn start
  }
  return false;
}

function runStop(payload) {
  // Once per turn: a stop that follows this (or any) stop hook's block always passes, and so
  // does any stop in a turn where this check already asked.
  if ((payload.stop_hook_active ?? payload.stopHookActive) === true) allow();
  if (askedThisTurn(payload.transcript_path ?? payload.transcriptPath)) allow();

  // Claude Code and Codex send last_assistant_message; older builds lastAssistantMessage.
  let text = "";
  for (const k of ["last_assistant_message", "lastAssistantMessage"]) {
    if (typeof payload[k] === "string" && payload[k].trim()) {
      text = payload[k].trim();
      break;
    }
  }
  if (!text) {
    try {
      text = transcriptText(payload.transcript_path ?? payload.transcriptPath);
    } catch (_) {
      allow();
    }
  }

  if (!text) allow();
  if (mentionsThisCheck(text)) allow();
  if (!STOP_HOMEWORK.some((rx) => rx.test(text))) allow();

  process.stdout.write(JSON.stringify({ decision: "block", reason: STOP_CHALLENGE }));
  process.exit(0);
}

/* ------------------------------------------------------------------ *
 * Dispatch
 * ------------------------------------------------------------------ */

let payload;
try {
  payload = JSON.parse(readStdin() || "{}");
} catch (_) {
  allow();
}

try {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) allow();
  const event = payload.hook_event_name || payload.hookEventName;
  const looksLikeStop =
    !payload.tool_name &&
    ("stop_hook_active" in payload ||
      "transcript_path" in payload ||
      "last_assistant_message" in payload ||
      "lastAssistantMessage" in payload);
  if (event === "Stop" || (!event && looksLikeStop)) {
    runStop(payload);
  } else if ((event === "PreToolUse" || !event) && typeof payload.tool_name === "string") {
    runPreToolUse(payload);
  }
} catch (_) {
  allow();
}

allow();
