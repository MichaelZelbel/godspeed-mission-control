#!/usr/bin/env node
/*
 * test-no-new-top-folder-hook.js - proof that starter-godspeed/.claude/hooks/no-new-top-folder.js
 * sends the assistant back once for a new folder or file at the top of a mission control that the
 * person did not ask for, and never for anything else.
 *
 * Every case runs the hook as Claude Code and Codex run it: a payload on stdin, in a throwaway
 * mission control (a real git repository with AGENTS.md at its root). The Codex payloads have the
 * shape Codex sends (its working folder in `cwd`, a rollout file as the transcript).
 *
 * Run: node tools/test-no-new-top-folder-hook.js
 */
"use strict";
require("./test-guard.cjs"); // never a real mission control (test-guard.bash says why)
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync, execFileSync } = require("child_process");

const KIT = path.dirname(__dirname);
const STARTER = path.join(KIT, "starter-godspeed");
const HOOK = path.join(STARTER, ".claude", "hooks", "no-new-top-folder.js");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "kit-nntf-"));
const STATE = path.join(TMP, "state");

let failures = 0;
const check = (name, cond, detail) => {
  console.log((cond ? "PASS  " : "FAIL  ") + name + (cond ? "" : "  (" + String(detail || "").slice(0, 300) + ")"));
  if (!cond) failures++;
};

function run(payload, opts = {}) {
  const env = Object.assign({}, process.env, { NO_NEW_TOP_FOLDER_STATE_DIR: opts.state || STATE });
  delete env.CLAUDE_PROJECT_DIR;
  if (opts.projectDir) env.CLAUDE_PROJECT_DIR = opts.projectDir;
  if (opts.path !== undefined) env.PATH = opts.path;
  Object.assign(env, opts.env || {});
  const r = spawnSync(process.execPath, [HOOK], {
    input: opts.raw !== undefined ? opts.raw : JSON.stringify(payload),
    encoding: "utf8", env, cwd: opts.cwd || TMP,
  });
  let out = null;
  try { out = JSON.parse(r.stdout || "null"); } catch (_) { out = "unparsable: " + r.stdout; }
  const blocked = !!(out && out.decision === "block");
  return { code: r.status, blocked, reason: out && out.reason ? out.reason : "", out, stderr: r.stderr };
}
const allowed = (r) => r.code === 0 && !r.blocked;
const blocked = (r) => r.code === 0 && r.blocked;

let n = 0;
function godspeed(opts = {}) {
  const root = path.join(TMP, "mc-" + (++n));
  fs.mkdirSync(root);
  const g = (...a) => execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@example.com", ...a], { stdio: "ignore" });
  g("init", "-q");
  if (opts.agents !== false) fs.writeFileSync(path.join(root, "AGENTS.md"), "# operating manual\n");
  for (const d of ["rules", "profile", "work"]) { fs.mkdirSync(path.join(root, d)); fs.writeFileSync(path.join(root, d, "README.md"), "x\n"); }
  g("add", "."); g("commit", "-qm", "start");
  return { root, g };
}
function jsonl(rows) {
  const p = path.join(TMP, "t-" + (++n) + ".jsonl");
  fs.writeFileSync(p, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  return p;
}

// ---------- Claude Code ----------
const cUser = (text) => ({ type: "user", message: { role: "user", content: [{ type: "text", text }] } });
const cUserStr = (text) => ({ type: "user", message: { role: "user", content: text } });
const cAsst = (text) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
const cMeta = (text) => ({ type: "user", isMeta: true, message: { role: "user", content: text } });
const cTool = (text) => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: text }] } });

// A Claude Code session: start, then make what `make` makes, then stop with this transcript.
function claude(make, rows, opts = {}) {
  const mc = godspeed();
  const sid = "cc-" + (++n);
  const o = { projectDir: mc.root };
  const start = run({ hook_event_name: "SessionStart", session_id: sid, cwd: mc.root, source: "startup" }, o);
  for (const pr of opts.prompts || []) run({ hook_event_name: "UserPromptSubmit", session_id: sid, cwd: mc.root, prompt: pr }, o);
  make(mc.root, mc.g);
  const tp = jsonl(rows);
  const stop = (extra = {}) => run(Object.assign({ hook_event_name: "Stop", session_id: sid, cwd: mc.root,
    transcript_path: tp, stop_hook_active: false, last_assistant_message: "Done." }, extra), o);
  return { mc, sid, o, tp, start, stop, first: stop() };
}

// Criterion 2: allowed.
{
  const c = claude(() => {}, [cUser("tidy the rules")]);
  check("session start answers nothing and exits 0", c.start.code === 0 && c.start.out === null, JSON.stringify(c.start));
  check("claude: nothing new at the top passes", allowed(c.first), JSON.stringify(c.first));
}
{
  // An entry that existed at session start, even untracked, is never questioned.
  const mc = godspeed(); fs.mkdirSync(path.join(mc.root, "my-own-stuff"));
  const o = { projectDir: mc.root };
  run({ hook_event_name: "SessionStart", session_id: "pre", cwd: mc.root, source: "startup" }, o);
  const r = run({ hook_event_name: "Stop", session_id: "pre", cwd: mc.root, transcript_path: jsonl([cUser("hi")]), stop_hook_active: false }, o);
  check("claude: an untracked entry that existed at session start passes", allowed(r), JSON.stringify(r));
}
{
  const c = claude((root, g) => { fs.mkdirSync(path.join(root, "brief")); fs.writeFileSync(path.join(root, "brief", "x.md"), "x"); g("add", "."); g("commit", "-qm", "pulled"); },
    [cUser("pull the latest")]);
  check("claude: a new entry tracked by git at HEAD (arrived by pull) passes", allowed(c.first), JSON.stringify(c.first));
}
{
  const c = claude((root) => fs.mkdirSync(path.join(root, "garden")), [cUser("make a folder called `garden` at the top")]);
  check("claude: a new folder the person named in a message passes", allowed(c.first), JSON.stringify(c.first));
}
{
  const c = claude((root) => fs.mkdirSync(path.join(root, "garden")), [cUserStr("please put a garden/ folder next to rules")]);
  check("claude: named as garden/ in a plain-string message passes", allowed(c.first), JSON.stringify(c.first));
}
{
  // The transcript lags: the name is known only from UserPromptSubmit. Case does not matter.
  const c = claude((root) => fs.mkdirSync(path.join(root, "archive2")), [], { prompts: ["make a folder called Archive2"] });
  check("claude: named only through UserPromptSubmit, other case, passes", allowed(c.first), JSON.stringify(c.first));
}

// Criterion 3: sent back once, with a reason that names the entry and the three ways out.
{
  const c = claude((root) => fs.mkdirSync(path.join(root, "scratch")), [cUser("tidy the rules")]);
  check("claude: an untracked new folder nobody named blocks", blocked(c.first), JSON.stringify(c.first));
  check("the reason names the entry", /"scratch"/.test(c.first.reason), c.first.reason);
  check("the reason says move it into an existing folder", /move it into an existing folder/i.test(c.first.reason), c.first.reason);
  check("the reason says remove it", /remove it/i.test(c.first.reason), c.first.reason);
  check("the reason says ask the person", /ask the person/i.test(c.first.reason), c.first.reason);
  // Criterion 4: never twice.
  const second = c.stop({ stop_hook_active: true });
  check("claude: the next stop in the same turn (stop_hook_active) passes", allowed(second), JSON.stringify(second));
  const later = c.stop({ stop_hook_active: false });
  check("claude: the same entry is not raised again later in the session", allowed(later), JSON.stringify(later));
}
{
  const c = claude((root) => fs.mkdirSync(path.join(root, "scratch")), [cUser("tidy the rules")]);
  const second = c.stop({ stop_hook_active: false });
  check("claude: a second stop without stop_hook_active still passes for the raised entry", allowed(second), JSON.stringify(second));
  fs.mkdirSync(path.join(c.mc.root, "tmp2"));
  const third = c.stop();
  check("claude: a different new entry later in the session is raised on its own", blocked(third) && /"tmp2"/.test(third.reason) && !/"scratch"/.test(third.reason), third.reason);
}
{
  const c = claude((root) => fs.writeFileSync(path.join(root, "screenshot.png"), "x"), [cUser("take a screenshot of the notebook")]);
  check("claude: a stray new file at the top blocks", blocked(c.first) && /"screenshot\.png"/.test(c.first.reason), JSON.stringify(c.first));
}
{
  const c = claude((root) => fs.mkdirSync(path.join(root, "tmp")), [cUser("delete tmpfiles please")]);
  check("claude: part of a longer word does not name it (tmp vs tmpfiles)", blocked(c.first), JSON.stringify(c.first));
}
{
  const c = claude((root) => fs.mkdirSync(path.join(root, "tmp")), [cUser("tidy the rules"), cAsst("I will use tmp for scratch")]);
  check("claude: named only by the assistant blocks", blocked(c.first), JSON.stringify(c.first));
}
{
  const c = claude((root) => fs.mkdirSync(path.join(root, "tmp")),
    [cUser("tidy the rules"), cMeta('Stop hook feedback:\n[top-level-guard] New at the top: "tmp"')]);
  check("claude: named only in hook feedback blocks", blocked(c.first), JSON.stringify(c.first));
}
{
  const c = claude((root) => fs.mkdirSync(path.join(root, "tmp")),
    [cUser("tidy the rules"), cUserStr("Stop hook feedback:\n[top-level-guard] New at the top of the mission control: \"tmp\"")]);
  check("claude: named only in hook feedback sent as a user line blocks", blocked(c.first), JSON.stringify(c.first));
}
{
  const c = claude((root) => fs.mkdirSync(path.join(root, "tmp")),
    [cUserStr("<system-reminder>files: tmp</system-reminder>"), cUser("tidy the rules")]);
  check("claude: named only in a harness preamble blocks", blocked(c.first), JSON.stringify(c.first));
}
{
  const c = claude((root) => fs.mkdirSync(path.join(root, "tmp")), [cUser("tidy the rules"), cTool("created tmp")]);
  check("claude: named only in a tool result blocks", blocked(c.first), JSON.stringify(c.first));
}
{
  // A resumed session keeps its first record.
  const mc = godspeed(); const o = { projectDir: mc.root };
  run({ hook_event_name: "SessionStart", session_id: "res", cwd: mc.root, source: "startup" }, o);
  fs.mkdirSync(path.join(mc.root, "tmp"));
  run({ hook_event_name: "SessionStart", session_id: "res", cwd: mc.root, source: "resume" }, o);
  const r = run({ hook_event_name: "Stop", session_id: "res", cwd: mc.root, transcript_path: jsonl([cUser("x")]), stop_hook_active: false }, o);
  check("claude: a resume does not take a new record", blocked(r), JSON.stringify(r));
}

// Criterion 5: below the top is never raised.
{
  const c = claude((root) => { fs.mkdirSync(path.join(root, "work", "notes")); fs.writeFileSync(path.join(root, "work", "notes", "x.md"), "x"); },
    [cUser("add a note")]);
  check("claude: work/notes/x.md (below the top) passes", allowed(c.first), JSON.stringify(c.first));
}

// Criterion 6: outside a mission control every event passes.
{
  const mc = godspeed({ agents: false }); const o = { projectDir: mc.root };
  const before = fs.existsSync(STATE) ? fs.readdirSync(STATE).length : 0;
  run({ hook_event_name: "SessionStart", session_id: "noagents", cwd: mc.root }, o);
  fs.mkdirSync(path.join(mc.root, "scratch"));
  const r = run({ hook_event_name: "Stop", session_id: "noagents", cwd: mc.root, transcript_path: "", stop_hook_active: false }, o);
  check("no AGENTS.md at the repository root: passes", allowed(r) && r.out === null, JSON.stringify(r));
  check("no AGENTS.md: no record is written", (fs.existsSync(STATE) ? fs.readdirSync(STATE).length : 0) === before, "");
}
{
  // AGENTS.md in a subfolder of a repository is not a mission control at the root.
  const mc = godspeed({ agents: false }); const sub = path.join(mc.root, "rules");
  fs.writeFileSync(path.join(sub, "AGENTS.md"), "x");
  run({ hook_event_name: "SessionStart", session_id: "subagents", cwd: sub }, { projectDir: sub });
  fs.mkdirSync(path.join(mc.root, "scratch"));
  const r = run({ hook_event_name: "Stop", session_id: "subagents", cwd: sub, transcript_path: "", stop_hook_active: false }, { projectDir: sub });
  check("AGENTS.md only below the repository root: passes", allowed(r), JSON.stringify(r));
}
{
  // A folder with AGENTS.md that is no git repository.
  const d = path.join(TMP, "plain"); fs.mkdirSync(d); fs.writeFileSync(path.join(d, "AGENTS.md"), "x");
  run({ hook_event_name: "SessionStart", session_id: "plain", cwd: d }, { projectDir: d });
  fs.mkdirSync(path.join(d, "scratch"));
  const r = run({ hook_event_name: "Stop", session_id: "plain", cwd: d, transcript_path: "", stop_hook_active: false }, { projectDir: d });
  check("no repository: passes", allowed(r), JSON.stringify(r));
}

// Criterion 7: any error lets the stop through.
{
  const mc = godspeed(); const o = { projectDir: mc.root };
  fs.mkdirSync(path.join(mc.root, "scratch"));
  for (const [name, raw] of [["empty stdin", ""], ["malformed stdin", "not json {"], ["a JSON array", "[]"], ["null", "null"]]) {
    const r = run(null, Object.assign({ raw }, o));
    check("error: " + name + " passes", allowed(r) && r.out === null, JSON.stringify(r));
  }
  const noSid = run({ hook_event_name: "Stop", cwd: mc.root, stop_hook_active: false }, o);
  check("error: no session_id passes", allowed(noSid), JSON.stringify(noSid));
  const noEv = run({ session_id: "x", cwd: mc.root }, o);
  check("error: no hook_event_name passes", allowed(noEv), JSON.stringify(noEv));
}
{
  // Unreadable state: a record that is not JSON.
  const state = path.join(TMP, "bad-state"); fs.mkdirSync(state);
  const mc = godspeed(); const o = { projectDir: mc.root, state };
  run({ hook_event_name: "SessionStart", session_id: "bad", cwd: mc.root }, o);
  for (const f of fs.readdirSync(state)) fs.writeFileSync(path.join(state, f), "{ broken");
  fs.mkdirSync(path.join(mc.root, "scratch"));
  const r = run({ hook_event_name: "Stop", session_id: "bad", cwd: mc.root, transcript_path: "", stop_hook_active: false }, o);
  check("error: an unreadable record passes", allowed(r), JSON.stringify(r));
}
{
  // The record cannot be written: it cannot remember that it asked, so it does not ask.
  const blocker = path.join(TMP, "a-file-not-a-folder"); fs.writeFileSync(blocker, "x");
  const mc = godspeed(); const o = { projectDir: mc.root, state: path.join(blocker, "state") };
  run({ hook_event_name: "SessionStart", session_id: "nowrite", cwd: mc.root }, o);
  fs.mkdirSync(path.join(mc.root, "scratch"));
  const r = run({ hook_event_name: "Stop", session_id: "nowrite", cwd: mc.root, transcript_path: "", stop_hook_active: false }, o);
  check("error: a record that cannot be written passes", allowed(r), JSON.stringify(r));
}
{
  // No git on the PATH.
  const mc = godspeed(); const empty = path.join(TMP, "empty-bin"); fs.mkdirSync(empty);
  const o = { projectDir: mc.root, path: empty };
  run({ hook_event_name: "SessionStart", session_id: "nogit", cwd: mc.root }, o);
  fs.mkdirSync(path.join(mc.root, "scratch"));
  const r = run({ hook_event_name: "Stop", session_id: "nogit", cwd: mc.root, transcript_path: "", stop_hook_active: false }, o);
  check("error: no git passes", allowed(r), JSON.stringify(r));
}
{
  // A transcript path that is a folder (unreadable as a file).
  const mc = godspeed(); const o = { projectDir: mc.root };
  run({ hook_event_name: "SessionStart", session_id: "tpdir", cwd: mc.root }, o);
  fs.mkdirSync(path.join(mc.root, "scratch"));
  const r = run({ hook_event_name: "Stop", session_id: "tpdir", cwd: mc.root, transcript_path: TMP, stop_hook_active: false }, o);
  check("error: an unreadable transcript passes", allowed(r), JSON.stringify(r));
}
{
  // No record yet (the hook was added mid-session): the first stop takes the record and passes.
  const mc = godspeed(); fs.mkdirSync(path.join(mc.root, "scratch"));
  const r = run({ hook_event_name: "Stop", session_id: "nostart", cwd: mc.root, transcript_path: "", stop_hook_active: false }, { projectDir: mc.root });
  check("no session start seen: the first stop passes", allowed(r), JSON.stringify(r));
}

// ---------- Codex (its working folder in cwd, no CLAUDE_PROJECT_DIR, a rollout as the transcript) ----------
const xUser = (text) => ({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
const xAsst = (text) => ({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text }] } });
function codex(make, rows, prompts) {
  const mc = godspeed(); const cwd = path.join(mc.root, "rules");
  const sid = "019a0c5d-" + (++n);
  const base = { session_id: sid, cwd, model: "gpt-5-codex", permission_mode: "workspace-write" };
  const tp = path.join(TMP, sid + ".jsonl");
  run(Object.assign({ hook_event_name: "SessionStart", transcript_path: tp, source: "startup" }, base), { cwd });
  for (const pr of prompts) run(Object.assign({ hook_event_name: "UserPromptSubmit", turn_id: "t1", transcript_path: tp, prompt: pr }, base), { cwd });
  make(mc.root, mc.g);
  fs.writeFileSync(tp, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  const stop = (extra = {}) => run(Object.assign({ hook_event_name: "Stop", turn_id: "t1", transcript_path: tp,
    stop_hook_active: false, last_assistant_message: "Done." }, base, extra), { cwd });
  return { mc, stop, first: stop() };
}
{
  const c = codex((root) => fs.mkdirSync(path.join(root, "garden")), [xUser("make a folder called garden")], ["make a folder called garden"]);
  check("codex: a new folder the person named passes", allowed(c.first), JSON.stringify(c.first));
}
{
  const c = codex((root) => fs.mkdirSync(path.join(root, "notes")), [{ type: "event_msg", payload: { type: "user_message", message: "start a notes folder" } }], []);
  check("codex: named in the older rollout form passes", allowed(c.first), JSON.stringify(c.first));
}
{
  const c = codex((root, g) => { fs.mkdirSync(path.join(root, "brief")); fs.writeFileSync(path.join(root, "brief", "x.md"), "x"); g("add", "."); g("commit", "-qm", "pulled"); },
    [xUser("pull")], ["pull"]);
  check("codex: a new entry tracked by git at HEAD passes", allowed(c.first), JSON.stringify(c.first));
}
{
  const c = codex((root) => fs.mkdirSync(path.join(root, "scratch")),
    [xUser("<environment_context>\n  <cwd>scratch</cwd>"), xUser("tidy the rules"), xAsst("made scratch")], ["tidy the rules"]);
  check("codex: an unasked new folder blocks (cwd is a subfolder)", blocked(c.first) && /"scratch"/.test(c.first.reason), JSON.stringify(c.first));
  const second = c.stop({ stop_hook_active: true });
  check("codex: the next stop (stop_hook_active) passes", allowed(second), JSON.stringify(second));
  const later = c.stop();
  check("codex: the same entry is not raised again later", allowed(later), JSON.stringify(later));
}
{
  const c = codex((root) => fs.mkdirSync(path.join(root, "tmp")),
    [xUser("tidy"), xAsst("made tmp"), xUser('<hook_prompt hook_run_id="stop:1">[top-level-guard] New at the top: "tmp"</hook_prompt>')], ["tidy"]);
  check("codex: named only in the stop continuation blocks", blocked(c.first), JSON.stringify(c.first));
}

// ---------- Wiring ----------
{
  let settings = null;
  try { settings = JSON.parse(fs.readFileSync(path.join(STARTER, ".claude", "settings.json"), "utf8")); } catch (_) {}
  const has = (cfg, ev) => !!(cfg && cfg.hooks && Array.isArray(cfg.hooks[ev]) &&
    cfg.hooks[ev].some((m) => (m.hooks || []).some((h) => /no-new-top-folder\.js/.test(h.command || ""))));
  for (const ev of ["SessionStart", "UserPromptSubmit", "Stop"]) check("Claude Code settings register the hook for " + ev, has(settings, ev), "");
  check("Claude Code settings keep the obligation-close Stop hook",
    !!(settings && settings.hooks && (settings.hooks.Stop || []).some((m) => (m.hooks || []).some((h) => /obligation-close-check\.js/.test(h.command || "")))), "");
  let cx = null;
  try { cx = JSON.parse(fs.readFileSync(path.join(STARTER, ".codex", "hooks.json"), "utf8")); } catch (_) {}
  for (const ev of ["SessionStart", "UserPromptSubmit", "Stop"]) check("Codex hooks register the hook for " + ev, has(cx, ev), "");
  const parity = fs.readFileSync(path.join(KIT, "docs", "harness-parity.md"), "utf8");
  check("the parity document has a row for this check", /no-new-top-folder\.js/.test(parity), "");
}

// ---------- Generalised ----------
{
  const texts = [fs.readFileSync(HOOK, "utf8"), fs.readFileSync(__filename, "utf8")].join("\n");
  const banned = new RegExp(["mich" + "ael", "zel" + "bel", "C:\\\\\\\\godspeed", "work" + "/plans/"].join("|"), "i");
  check("no owner name, personal path or private plan in the hook or its tests", !banned.test(texts), (texts.match(banned) || [])[0]);
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
