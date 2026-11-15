#!/usr/bin/env node
/**
 * no-new-top-folder.js  -  SessionStart + UserPromptSubmit + Stop hook (Claude Code and Codex)
 *
 * Purpose: the assistant does not invent new folders or files at the top of your mission control.
 * You can still have any folder you want there: naming it in one of your messages is the
 * permission.
 *
 * Why it exists. The mission control this kit comes from grew to three times as many entries at
 * its top as it was meant to have. Sessions had dropped scratch folders, screenshots, a file with a
 * broken name and a dozen feature folders there, each on its own initiative, and nothing had ever
 * said so. Another rule in the instructions would not have helped: an assistant in the middle of
 * a job does not reread them. So this is a check the assistant never reads, and it speaks only
 * when something appeared at the top that nobody asked for.
 *
 * How it decides:
 *   SessionStart      records the names at the top. Whatever exists is allowed, so your own
 *                     folders are never questioned. A resumed session keeps its first record.
 *   UserPromptSubmit  records each message you send (the transcript can lag behind).
 *   Stop              anything at the top that is new since the record, is not tracked by git at
 *                     HEAD (so a folder that arrived with `git pull` is never questioned), and that
 *                     none of your messages in this session named, sends the assistant back ONCE.
 *                     Hook feedback and harness preambles never count as you naming it.
 *                     An entry it raised is accepted from then on: the next stop passes, and the
 *                     same entry is never raised again in that session.
 *
 * It does nothing outside a mission control (a git repository with AGENTS.md at its root). On any
 * error it lets the session go on: it must never trap you. Turning it off is your call: delete its
 * entries in .claude/settings.json and .codex/hooks.json.
 *
 * Output (Claude Code and Codex):
 *   block: stdout {"decision":"block","reason":"..."}, exit 0      allow: exit 0, nothing on stdout
 * Tests: tools/test-no-new-top-folder-hook.js. See docs/harness-parity.md for which assistants run it.
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { execFileSync } = require("child_process");

const MARKER = "[top-level-guard]";
const STATE_DIR = process.env.NO_NEW_TOP_FOLDER_STATE_DIR || path.join(os.tmpdir(), "godspeed-no-new-top-folder");

function allow() { process.exit(0); }
function block(reason) { process.stdout.write(JSON.stringify({ decision: "block", reason })); process.exit(0); }

function readStdin() { try { return fs.readFileSync(0, "utf8"); } catch (_) { return ""; } }

function git(dir, args) {
  return execFileSync("git", ["-C", dir, ...args],
    { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] });
}

// The repository the session works in: Claude Code names it, Codex sends its working folder.
// No repository, or no git at all, means no mission control.
function findRoot(p) {
  const start = process.env.CLAUDE_PROJECT_DIR || (typeof p.cwd === "string" && p.cwd) || process.cwd();
  let top;
  try { top = git(path.resolve(start), ["rev-parse", "--show-toplevel"]).trim(); } catch (_) { return ""; }
  if (!top || !fs.existsSync(path.join(top, "AGENTS.md"))) return "";
  return path.resolve(top);
}

const topNames = (root) => fs.readdirSync(root).sort();

function trackedNames(root) {
  try { return new Set(git(root, ["ls-tree", "--name-only", "HEAD"]).split(/\r?\n/).filter(Boolean)); }
  catch (_) { return new Set(); } // no commit yet: nothing is tracked
}

function statePath(root, sid) {
  const key = crypto.createHash("sha1").update(root + "\n" + String(sid)).digest("hex").slice(0, 16);
  return path.join(STATE_DIR, key + ".json");
}
function loadState(file) {
  if (!fs.existsSync(file)) return null;
  const st = JSON.parse(fs.readFileSync(file, "utf8")); // unreadable state throws: the caller allows
  if (!st || !Array.isArray(st.baseline) || !Array.isArray(st.prompts)) throw new Error("bad state");
  return st;
}
function saveState(file, st) { fs.mkdirSync(STATE_DIR, { recursive: true }); fs.writeFileSync(file, JSON.stringify(st)); }

// Texts that are machinery, never the person: hook feedback, notifications, harness preambles.
const MACHINE_PREFIX = /^\s*(stop hook feedback|<task-notification>|<local-command-|<system-reminder>|\[request interrupted|<hook_prompt|<environment_context>|<recommended_plugins>|<user_instructions>|<permissions|<skill|# agents\.md instructions)/i;

function userTextsFromTranscript(tp) {
  const texts = [];
  if (!tp || typeof tp !== "string" || !fs.existsSync(tp)) return texts;
  for (const line of fs.readFileSync(tp, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    let o; try { o = JSON.parse(line); } catch (_) { continue; }
    if (!o || typeof o !== "object") continue;
    // Claude Code: {type:"user", isMeta?, message:{content: string | [{type:"text"|"tool_result"}]}}
    if (o.type === "user" && o.message && !o.isMeta && !o.isCompactSummary) {
      const c = o.message.content;
      if (typeof c === "string") texts.push(c);
      else if (Array.isArray(c) && !c.some((b) => b && b.type === "tool_result"))
        texts.push(c.filter((b) => b && b.type === "text").map((b) => b.text).join("\n"));
      continue;
    }
    // Codex rollout: {type:"response_item", payload:{type:"message", role:"user", content:[{type:"input_text", text}]}}
    const pl = o.payload;
    if (o.type === "response_item" && pl && pl.type === "message" && pl.role === "user" && Array.isArray(pl.content)) {
      for (const c of pl.content) if (c && typeof c.text === "string") texts.push(c.text);
      continue;
    }
    // Older Codex rollouts: {type:"event_msg", payload:{type:"user_message", message}}
    if (o.type === "event_msg" && pl && pl.type === "user_message" && typeof pl.message === "string") texts.push(pl.message);
  }
  return texts;
}

function personTexts(st, tp) {
  return [...st.prompts, ...userTextsFromTranscript(tp)]
    .filter((t) => typeof t === "string" && t && !MACHINE_PREFIX.test(t) && !t.includes(MARKER));
}

function escapeRx(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
// The whole name, as a word of its own: "tmp" is not named by "tmpfiles".
function named(name, texts) {
  const rx = new RegExp("(^|[^A-Za-z0-9_-])" + escapeRx(name) + "(?=$|[^A-Za-z0-9_-])", "i");
  return texts.some((t) => rx.test(t));
}

function main() {
  const p = JSON.parse(readStdin() || "null");
  if (!p || typeof p !== "object" || Array.isArray(p)) return allow();
  const ev = p.hook_event_name || p.hookEventName;
  const sid = p.session_id || p.sessionId;
  if (!sid || !ev) return allow();
  const root = findRoot(p);
  if (!root) return allow();
  const file = statePath(root, sid);
  let st = loadState(file);

  if (ev === "SessionStart") {
    if (!st) saveState(file, { baseline: topNames(root), prompts: [] });
    return allow();
  }
  // No record yet (the hook was added mid-session): what is there now is the record.
  if (!st) { saveState(file, { baseline: topNames(root), prompts: [] }); return allow(); }

  if (ev === "UserPromptSubmit") {
    if (typeof p.prompt === "string") { st.prompts.push(p.prompt); saveState(file, st); }
    return allow();
  }
  if (ev !== "Stop") return allow();
  // A scheduled job has nobody to ask, and its last message is its output.
  if (process.env.GODSPEED_MACHINE_RUN === "1") return allow();

  const base = new Set(st.baseline);
  const fresh = topNames(root).filter((n) => !base.has(n));
  if (!fresh.length) return allow();
  const tracked = trackedNames(root);
  const texts = personTexts(st, p.transcript_path || p.transcriptPath);
  const unasked = fresh.filter((n) => !tracked.has(n) && !named(n, texts));
  if (!unasked.length) return allow();

  // Whatever is raised (or still there after a stop already fired) joins the record now, so the
  // same entry is never raised twice. If that cannot be written, it does not ask at all.
  st.baseline = [...new Set([...st.baseline, ...unasked])];
  saveState(file, st);
  if (p.stop_hook_active === true || p.stopHookActive === true) return allow();

  const list = unasked.map((n) => '"' + n + '"').join(", ");
  return block(`${MARKER} New at the top of the mission control, and not asked for in this session: ${list}. ` +
    "Move it into an existing folder where it belongs, or remove it if nothing needs it. Only if you cannot tell, " +
    "ask the person, in a question that makes sense on its own: what the item is, what made it and when, " +
    "and what each answer does (for example: reply \"keep\" and it stays at the top, \"move\" and it goes " +
    "into <folder>). Then end the turn.");
}

if (require.main === module) { try { main(); } catch (_) { allow(); } }
else module.exports = { userTextsFromTranscript, personTexts, named };
