#!/usr/bin/env node
/*
 * test-no-homework-hook.js - proof that starter-godspeed/.claude/hooks/no-homework.js works.
 *
 * The hook stops an assistant from handing the person a worksheet: a published page with blanks
 * for them to fill, or a last message telling them to open a link and fill something in. Each case
 * runs the hook the way Claude Code and Codex do: a child process with the hook payload on stdin.
 * The hook runs from a copy inside a throwaway mission control, so its settings file
 * (no-homework.json next to it) can be present, missing or broken per case.
 *
 * Run: node tools/test-no-homework-hook.js
 */
"use strict";
require("./test-guard.cjs"); // never a real mission control (test-guard.bash says why)
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const KIT = path.dirname(__dirname);
const STARTER = path.join(KIT, "starter-godspeed");
const SOURCE = path.join(STARTER, ".claude", "hooks", "no-homework.js");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "kit-nhw-"));

// A throwaway mission control holding a copy of the hook, and (when given) its settings file.
function missionControl(settings) {
  const root = fs.mkdtempSync(path.join(TMP, "mc-"));
  const hooks = path.join(root, ".claude", "hooks");
  fs.mkdirSync(hooks, { recursive: true });
  fs.writeFileSync(path.join(root, "AGENTS.md"), "");
  fs.copyFileSync(SOURCE, path.join(hooks, "no-homework.js"));
  if (settings !== undefined) fs.writeFileSync(path.join(hooks, "no-homework.json"), settings);
  return root;
}
const DEFAULT = missionControl(fs.readFileSync(path.join(STARTER, ".claude", "hooks", "no-homework.json"), "utf8"));

function page(root, name, body) {
  const p = path.join(root, name);
  fs.writeFileSync(p, body);
  return p;
}
function transcript(entries) {
  const p = path.join(fs.mkdtempSync(path.join(TMP, "t-")), "s.jsonl");
  fs.writeFileSync(p, entries.map((e) => (typeof e === "string" ? e : JSON.stringify(e))).join("\n") + "\n");
  return p;
}

// verdict: "deny" (PreToolUse exit 2), "block" (Stop decision), "pass", or "crash <status>".
function run(payload, opts) {
  const o = opts || {};
  const root = o.root || DEFAULT;
  const r = spawnSync(process.execPath, [path.join(root, ".claude", "hooks", "no-homework.js")], {
    input: o.raw !== undefined ? o.raw : JSON.stringify(payload),
    encoding: "utf8",
    cwd: root,
    env: Object.assign({}, process.env, { CLAUDE_PROJECT_DIR: root }),
  });
  if (r.status === 2) return { verdict: "deny", reason: r.stderr, stdout: r.stdout };
  if (r.status !== 0) return { verdict: "crash " + r.status, reason: r.stderr, stdout: r.stdout };
  let out = null;
  try { out = JSON.parse(r.stdout || "null"); } catch (_) { out = null; }
  if (out && out.decision === "block") return { verdict: "block", reason: String(out.reason), stdout: r.stdout };
  return { verdict: "pass", reason: "", stdout: r.stdout };
}

let failures = 0;
const check = (name, cond, detail) => {
  console.log((cond ? "PASS  " : "FAIL  ") + name + (cond ? "" : "  (" + String(detail || "").slice(0, 300) + ")"));
  if (!cond) failures++;
};
const expect = (name, r, verdict) => check(name, r.verdict === verdict, r.verdict + " " + r.reason);

const pre = (tool, input, extra) => Object.assign({ hook_event_name: "PreToolUse", tool_name: tool, tool_input: input }, extra || {});
const stop = (text, extra) => Object.assign({ hook_event_name: "Stop", stop_hook_active: false, last_assistant_message: text }, extra || {});
const scpTo = (file) => "scp " + JSON.stringify(file) + " person@pages.example.com:/var/www/";

const WORKSHEET = [
  "# Does a doubt date make the answers better?",
  "",
  "| # | Question | True answer |",
  "|---|---|---|",
  "| 1 | Where do I live? | |",
  "| 2 | Who is my manager? | |",
].join("\n");
const FILLED = [
  "# Does a doubt date make the answers better?",
  "",
  "| # | Question | True answer |",
  "|---|---|---|",
  "| 1 | Where do I live? | Lisbon |",
  "| 2 | Who is my manager? | two, both now recorded |",
].join("\n");

/* ---- Criterion 2: the publish half ---- */
let r = run(pre("Bash", { command: scpTo(page(DEFAULT, "worksheet.md", WORKSHEET)) }));
expect("a page with an empty answer column is refused", r, "deny");
check("the refusal says to look the answers up in the mission control first",
  /LOOK UP THE ANSWERS IN THE MISSION CONTROL FIRST/.test(r.reason), r.reason);
check("the refusal says to ask only what remains, as a plain question",
  /Ask only what remains, as a plain question/.test(r.reason), r.reason);
check("the refusal prints no decision on stdout (exit 2 is the refusal)", r.stdout.trim() === "", r.stdout);
expect("the same page without the blanks publishes", run(pre("Bash", { command: scpTo(page(DEFAULT, "filled.md", FILLED)) })), "pass");
expect("a page telling the person to write into it is refused",
  run(pre("Bash", { command: scpTo(page(DEFAULT, "ask.md", "# Findings\n\nOpen the link and write the true answer next to each.\n")) })), "deny");
expect("the same page without that sentence publishes",
  run(pre("Bash", { command: scpTo(page(DEFAULT, "told.md", "# Findings\n\nEvery answer is now recorded.\n")) })), "pass");
// Owner's ruling on #231: only a sentence sending the person to write into THIS page is
// refused. Setup steps, other forms and paper-form how-tos publish (#421).
[
  ["setup.md", "Type the six-digit code into the form and click Verify."],
  ["script.md", "The script will write the totals in the last column."],
  ["key.md", "Put the key in the table under the window."],
  ["name.md", "Write your name on the sheet before handing it in."],
  ["paper.md", "Fill in the registration form at the desk and write your answers in block capitals."],
].forEach(([name, sentence]) => {
  expect('"' + sentence + '" on a page publishes',
    run(pre("Artifact", { file_path: page(DEFAULT, name, "# How to\n\n" + sentence + "\n\n- Step one\n- Step two\n") })), "pass");
});
[
  ["blanks.md", "Fill in the blanks below and send it back."],
  ["form-below.md", "Please fill in the form below."],
  ["fill-this.md", "Fill out this page and tell me when done."],
].forEach(([name, sentence]) => {
  expect('"' + sentence + '" on a page is refused',
    run(pre("Artifact", { file_path: page(DEFAULT, name, "# Open items\n\n" + sentence + "\n\n- Where do I live?\n") })), "deny");
});
expect('a "what is needed from you" heading is refused',
  run(pre("Bash", { command: scpTo(page(DEFAULT, "open.md", "# Open questions\n\n## What is needed from you\n\nOne line.\n")) })), "deny");
expect("the Artifact tool cannot publish an HTML worksheet",
  run(pre("Artifact", { file_path: page(DEFAULT, "art.html",
    "<table><tr><th>Question</th><th>True answer</th></tr><tr><td>Where do I live?</td><td></td></tr></table>") })), "deny");
expect("the Artifact tool publishes the filled HTML table",
  run(pre("Artifact", { file_path: page(DEFAULT, "art-done.html",
    "<table><tr><th>Question</th><th>True answer</th></tr><tr><td>Where do I live?</td><td>Lisbon</td></tr></table>") })), "pass");
expect("a relative path is read against the session's folder",
  run(pre("Bash", { command: "scp worksheet.md person@pages.example.com:/var/www/" }, { cwd: DEFAULT })), "deny");
expect("a write-up about this check may quote its wording",
  run(pre("Bash", { command: scpTo(page(DEFAULT, "about.md", "# The no-homework check\n\nIt refuses \"write the true answer next to each\".\n")) })), "pass");
expect("naming this check does not excuse a real blank",
  run(pre("Bash", { command: scpTo(page(DEFAULT, "about2.md", "# The no-homework check\n\n" + WORKSHEET)) })), "deny");
expect("an empty Notes cell in a second table is not an empty Answer cell",
  run(pre("Artifact", { file_path: page(DEFAULT, "two.md", [
    "| Question | Answer |", "|---|---|", "| Where | Lisbon |", "", "Then the notes.",
    "| Item | Notes |", "|---|---|", "| one | |"].join("\n")) })), "pass");
expect("any other tool call is allowed (Edit of a worksheet)",
  run(pre("Edit", { file_path: path.join(DEFAULT, "worksheet.md"), old_string: "a", new_string: "b" })), "pass");
expect("any other command is allowed (cat of a worksheet)",
  run(pre("Bash", { command: "cat " + JSON.stringify(path.join(DEFAULT, "worksheet.md")) })), "pass");
expect("a Codex shell payload is judged the same way",
  run(pre("Bash", { command: scpTo(path.join(DEFAULT, "worksheet.md")) }, { turn_id: "t1", model: "gpt", cwd: DEFAULT, session_id: "s" })), "deny");

/* ---- Criterion 3: extra publish commands from the settings file ---- */
const NAMED = missionControl(JSON.stringify({ publish_commands: ["site publish", "mysite-upload"] }));
const w = page(NAMED, "worksheet.md", WORKSHEET);
const f = page(NAMED, "filled.md", FILLED);
expect("a command named in the settings file is checked", run(pre("Bash", { command: "site publish --title X " + JSON.stringify(w) }), { root: NAMED }), "deny");
expect("a second named command, after another command", run(pre("Bash", { command: "cd /tmp && mysite-upload " + w }), { root: NAMED }), "deny");
expect("a named command publishes a page without blanks", run(pre("Bash", { command: "site publish " + f }), { root: NAMED }), "pass");
expect("a command that only starts like a named one is not it", run(pre("Bash", { command: "site publisher " + w }), { root: NAMED }), "pass");
expect("the built-in scp is still checked with a settings file", run(pre("Bash", { command: scpTo(w) }), { root: NAMED }), "deny");
for (const [label, settings] of [["a missing", undefined], ["an unreadable", "{not json"], ["a wrongly shaped", "[\"site publish\"]"]]) {
  const root = missionControl(settings);
  const wk = page(root, "worksheet.md", WORKSHEET);
  expect(label + " settings file: a named command is not checked", run(pre("Bash", { command: "site publish " + wk }), { root }), "pass");
  expect(label + " settings file: the built-in ones still are", run(pre("Bash", { command: scpTo(wk) }), { root }), "deny");
}

/* ---- Criterion 4: the message half ---- */
r = run(stop("The page is up: https://pages.example.com/audit. Open the link, write the true answer next to each, and tell me."));
expect("a message sending the person to fill in a page is blocked", r, "block");
check("the block says to find the answers or ask one plain sentence",
  /Find the answers yourself/.test(r.reason) && /ONE plain sentence in the chat/.test(r.reason), r.reason);
expect('"fill in the form at this link" is blocked', run(stop("I made a form for this. Please fill in the form at https://forms.example.com/x and I will carry on.")), "block");
expect('"add the answers" is blocked', run(stop("The page is up. Add the answers in the last column and ping me.")), "block");
expect('"could you confirm each of the 20 rows" is blocked', run(stop("Could you confirm each of the 20 rows?")), "block");
expect('"go there and complete the missing fields" is blocked',
  run(stop("The page is live at https://pages.example.com/x \u2014 go there and complete the missing fields, then tell me.")), "block");
expect("a finished report about a script writing a column passes",
  run(stop("Done. The new importer script will write the totals in the last column of the budget sheet each night.")), "pass");
expect("a finished report about a paper form passes",
  run(stop("Done. The how-to is published: fill in the registration form at the desk, then show your badge.")), "pass");
expect("one plain question passes", run(stop("I found everything except one thing: which month did you start at the new job?")), "pass");
expect("an ordinary finished report passes", run(stop("Done. I filed the three facts in your notebook and published the report at https://pages.example.com/audit.")), "pass");
expect('"this will add real value" is not homework', run(stop("Filed the summary. This will add real value to tomorrow's brief.")), "pass");
expect('"I can confirm all 12" is a report', run(stop("Ran the suite again. I can confirm all 12 cases pass.")), "pass");
expect("the last message is read from the transcript when the payload has none",
  run({ hook_event_name: "Stop", stop_hook_active: false, transcript_path: transcript([
    { type: "user", message: { content: "Check my facts." } },
    { type: "assistant", message: { content: [{ type: "text", text: "Open the link and fill in the answers, then tell me." }] } }]) }), "block");
expect("a Codex Stop payload is judged the same way",
  run({ hook_event_name: "Stop", session_id: "s", turn_id: "t", cwd: DEFAULT, model: "gpt", permission_mode: "default",
    transcript_path: null, stop_hook_active: false, last_assistant_message: "Open the link and write the answers next to each." }), "block");

/* ---- Criterion 5: at most once per turn ---- */
const HOMEWORK = "Open the link and write the true answer next to each, and tell me.";
expect("stop_hook_active: true passes", run(stop(HOMEWORK, { stop_hook_active: true })), "pass");
expect("stopHookActive: true passes", run({ hook_event_name: "Stop", stopHookActive: true, lastAssistantMessage: HOMEWORK }), "pass");
const asked = run(stop(HOMEWORK)).reason;
expect("once this check asked in the turn, the next stop passes",
  run(stop(HOMEWORK, { transcript_path: transcript([
    { type: "user", message: { content: "Check my facts." } },
    { type: "assistant", message: { content: [{ type: "text", text: HOMEWORK }] } },
    { type: "user", isMeta: true, message: { content: "Stop hook feedback:\n" + asked } },
    { type: "assistant", message: { content: [{ type: "text", text: HOMEWORK }] } }]) })), "pass");
expect("a challenge in an earlier turn does not count for this one",
  run(stop(HOMEWORK, { transcript_path: transcript([
    { type: "user", message: { content: "Check my facts." } },
    { type: "user", message: { content: "Stop hook feedback:\n" + asked } },
    { type: "user", message: { content: "Now the other list, please." } },
    { type: "assistant", message: { content: [{ type: "text", text: HOMEWORK }] } }]) })), "block");

/* ---- Criterion 6: any error lets the call or the stop through ---- */
for (const [label, raw] of [["empty stdin", ""], ["malformed stdin", "{nope"], ["a JSON null", "null"], ["a JSON array", "[1,2]"],
  ["a JSON string", "\"Stop\""]]) {
  const res = run(null, { raw });
  check(label + " lets it through: exit 0, no decision", res.verdict === "pass" && res.stdout.trim() === "", res.verdict + res.stdout);
}
expect("a Stop with no message and no transcript passes", run({ hook_event_name: "Stop" }), "pass");
expect("a Stop whose transcript is missing passes", run({ hook_event_name: "Stop", transcript_path: path.join(TMP, "gone.jsonl") }), "pass");
expect("a Stop whose transcript is a folder passes", run({ hook_event_name: "Stop", transcript_path: TMP }), "pass");
expect("a PreToolUse with no tool_input passes", run({ hook_event_name: "PreToolUse", tool_name: "Bash" }), "pass");
expect("a PreToolUse whose tool_input is a string passes", run({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: "scp x a@b:" }), "pass");
expect("a publish of a file that does not exist passes", run(pre("Bash", { command: scpTo(path.join(TMP, "nothing.md")) })), "pass");
expect("a publish of a folder passes", run(pre("Bash", { command: scpTo(TMP) })), "pass");
expect("a Stop whose message is not a string passes", run({ hook_event_name: "Stop", last_assistant_message: 42 }), "pass");

/* ---- Criteria 1, 7, 8: the wiring, and nothing personal in it ---- */
const settings = JSON.parse(fs.readFileSync(path.join(STARTER, ".claude", "settings.json"), "utf8"));
const cmds = (ev) => ((settings.hooks || {})[ev] || []).flatMap((g) => g.hooks || []).map((h) => h.command || "");
check("Claude Code: registered as a Stop hook", cmds("Stop").some((c) => /no-homework\.js/.test(c)), JSON.stringify(settings));
check("Claude Code: registered as a PreToolUse hook", cmds("PreToolUse").some((c) => /no-homework\.js/.test(c)), JSON.stringify(settings));
check("Claude Code: the obligation-close Stop hook is still registered", cmds("Stop").some((c) => /obligation-close-check\.js/.test(c)));
const codex = JSON.parse(fs.readFileSync(path.join(STARTER, ".codex", "hooks.json"), "utf8"));
const ccmds = (ev) => ((codex.hooks || {})[ev] || []).flatMap((g) => g.hooks || []).map((h) => h.command || "");
check("Codex: wired for the Stop half", ccmds("Stop").some((c) => /no-homework\.js/.test(c)), JSON.stringify(codex));
check("Codex: wired for the PreToolUse half", ccmds("PreToolUse").some((c) => /no-homework\.js/.test(c)), JSON.stringify(codex));
// Codex runs the command in the session's folder; from the mission control's root it must reach the hook.
const codexCmd = ccmds("Stop").find((c) => /no-homework\.js/.test(c)) || "";
const bash = spawnSync("bash", ["-c", codexCmd], { cwd: DEFAULT, input: JSON.stringify(stop(HOMEWORK)), encoding: "utf8" });
check("Codex: its command finds the hook from the mission control's folder and blocks",
  bash.error ? true : /"decision":"block"/.test(bash.stdout), (bash.stderr || "") + bash.stdout);
const personal = /michael|zelbel|\/home\/|C:\\\\Users|godspeedmissioncontrol\.com|\bhis\b|\bhim\b/i;
for (const file of [SOURCE, path.join(STARTER, ".claude", "hooks", "no-homework.json"), path.join(STARTER, ".codex", "hooks.json"), __filename]) {
  const text = fs.readFileSync(file, "utf8").replace(/const personal = .*\n/, "");
  const m = text.match(personal);
  check("nothing personal in " + path.relative(KIT, file), !m, m && m[0]);
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
