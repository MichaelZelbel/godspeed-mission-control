// The receipts and the seal of a researched preparation (lib/prep-receipts.mjs): what the host
// captures from a fixture Claude Code transcript and a fixture Hermes session store, and what the
// coach's gate then says about the sealed review.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readArea } from "../lib/areas.mjs";
import { readPrep, prepProblem } from "../lib/prep.mjs";
import { captureRun, writeEvidence, sealReview, parseReview, newMarker } from "../lib/prep-receipts.mjs";

const BIN = fileURLToPath(new URL("../bin/godspeed-coach.mjs", import.meta.url));
const START = Date.parse("2026-10-21T10:00:00Z"), END = Date.parse("2026-10-21T10:31:00Z");
const NOW = new Date("2026-10-21T12:00:00Z");
const roots = new Set();
test.after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });
const tmp = (name) => { const r = fs.mkdtempSync(path.join(os.tmpdir(), name)); roots.add(r); return r; };
const SECTIONS = ["The opening", "Talk card", "Where they stand", "What changed since the last talk", "The world this week", "Opportunities", "Routes", "Rejected routes", "What I think", "Gaps", "Cut, and why", "Research coverage"];

// A mission control with one researched area (two domains, one goal) and its ready preparation.
function mission() {
  const root = tmp("coach-receipts-");
  const dir = path.join(root, "coach", "work");
  fs.mkdirSync(path.join(dir, "prep"), { recursive: true });
  fs.writeFileSync(path.join(root, "coach", "settings.json"), JSON.stringify({ timezone: "Europe/Berlin", git_sync: "off" }));
  fs.mkdirSync(path.join(root, "rules")); fs.writeFileSync(path.join(root, "AGENTS.md"), "");
  fs.writeFileSync(path.join(dir, "area.md"), "AREA: work\nTITLE: Work and money\nRHYTHM: weekly wednesday\nTIME: 19:00\nSTARTS: 2026-10-14\nSTATUS: on\nSERVES: buffer\nRESEARCH DOMAIN: income | new earning paths\nRESEARCH DOMAIN: market | market changes\n");
  const file = path.join(dir, "prep", "2026-10-21.md");
  fs.writeFileSync(file, "AREA: work\nTALK: 2026-10-21 19:00\nPREPARED: 2026-10-21T10:30:00Z\nSTATE: ready\n\n" + SECTIONS.map((t) => `## ${t}\nA substantive line for ${t}.\n`).join("\n"));
  return { root, dir, file, area: () => readArea(dir) };
}

const at = (ms) => new Date(ms).toISOString();
const digest = (b) => crypto.createHash("sha256").update(b).digest("hex");
// A Claude Code transcript as `claude -p` keeps it: the prompt, tool calls, their results.
function claudeTranscript(home, marker, session = "claude-session-1") {
  const dir = path.join(home, "projects", "-tmp-mission");
  fs.mkdirSync(dir, { recursive: true });
  const use = (id, name, input, t) => ({ type: "assistant", sessionId: session, timestamp: at(t), message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } });
  const result = (id, content, t, extra = {}) => ({ type: "user", sessionId: session, timestamp: at(t), message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, ...extra }] } });
  const lines = [
    { type: "user", sessionId: session, timestamp: at(START + 1000), message: { role: "user", content: `# Coaching talk preparation\n\nRUN MARKER: ${marker}\nToday is 2026-10-21.` } },
    use("toolu_search", "WebSearch", { query: "earning paths 2026" }, START + 60_000), result("toolu_search", "Snippets only.", START + 61_000),
    use("toolu_ok", "WebFetch", { url: "https://example.org/report", prompt: "read" }, START + 120_000),
    { ...result("toolu_ok", "The report says freelance rates rose 12 percent in 2026.", START + 125_000), toolUseResult: { code: 200, url: "https://example.org/report" } },
    use("toolu_err", "WebFetch", { url: "https://example.org/gone", prompt: "read" }, START + 200_000), result("toolu_err", "Request failed with status code 404", START + 201_000, { is_error: true }),
    use("toolu_404", "WebFetch", { url: "https://example.org/missing", prompt: "read" }, START + 210_000),
    { ...result("toolu_404", "Not Found", START + 211_000), toolUseResult: { code: 404 } },
    use("toolu_http", "WebFetch", { url: "http://example.org/plain", prompt: "read" }, START + 220_000), result("toolu_http", "A page over plain http.", START + 221_000),
    use("toolu_late", "WebFetch", { url: "https://example.org/late", prompt: "read" }, END + 60_000), result("toolu_late", "Read after the run ended.", END + 61_000),
    { type: "assistant", sessionId: session, timestamp: at(END - 1000), message: { role: "assistant", content: [{ type: "text", text: "Prepared." }] } },
  ];
  const file = path.join(dir, `${session}.jsonl`);
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
  return file;
}

// A Hermes session store (state.db) with the columns Hermes keeps.
async function hermesStore(home, marker, session = "hermes-session-1", { profile = null, other = false } = {}) {
  const { DatabaseSync } = await import("node:sqlite");
  const dir = profile ? path.join(home, "profiles", profile) : home;
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, "state.db"));
  db.exec("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, source TEXT NOT NULL, parent_session_id TEXT, started_at REAL NOT NULL); CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT, tool_call_id TEXT, tool_calls TEXT, tool_name TEXT, timestamp REAL NOT NULL)");
  const s = (ms) => ms / 1000;
  db.prepare("INSERT INTO sessions VALUES (?, 'cli', NULL, ?)").run(session, s(START));
  const add = (role, content, t, extra = {}) => db.prepare("INSERT INTO messages (session_id, role, content, tool_call_id, tool_calls, tool_name, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(extra.session || session, role, content, extra.call || null, extra.calls ? JSON.stringify(extra.calls) : null, extra.name || null, s(t));
  add("user", other ? `RUN MARKER: gs-review-another\nThe evidence: {"run":{"token":"${marker}"}}` : `# Coaching talk preparation\n\nRUN MARKER: ${marker}\n`, START + 1000);
  if (other) { db.close(); return; }
  const call = (id, name, args) => ({ id, type: "function", function: { name, arguments: JSON.stringify(args) } });
  add("assistant", "", START + 50_000, { calls: [call("call_search", "web_search", { query: "market 2026" })] });
  add("tool", JSON.stringify({ results: [{ title: "x", url: "https://example.net/a", description: "snippet" }] }), START + 51_000, { call: "call_search", name: "web_search" });
  add("assistant", "", START + 100_000, { calls: [call("call_read", "web_extract", { urls: ["https://example.net/study", "https://example.net/broken"] })] });
  add("tool", JSON.stringify({ results: [
    { url: "https://example.net/study", title: "Study", content: "The study followed 400 people for a year.", error: null },
    { url: "https://example.net/broken", title: "", content: "", error: "Failed to fetch" },
  ] }, null, 2), START + 110_000, { call: "call_read", name: "web_extract" });
  // A result whose tool name Hermes left empty is known from the assistant's call.
  add("assistant", "", START + 300_000, { calls: [call("call_named", "web_extract", { urls: ["https://example.net/second"] })] });
  add("tool", JSON.stringify({ results: [{ url: "https://example.net/second", title: "Second", content: "A second page, read in full.", error: null }] }), START + 301_000, { call: "call_named" });
  add("assistant", "", START + 400_000, { calls: [call("call_refused", "web_extract", { urls: ["https://example.net/secret?token=x"] })] });
  add("tool", JSON.stringify({ success: false, error: "URL carries a secret" }), START + 401_000, { call: "call_refused", name: "web_extract" });
  add("assistant", "", END + 30_000, { calls: [call("call_late", "web_extract", { urls: ["https://example.net/late"] })] });
  add("tool", JSON.stringify({ results: [{ url: "https://example.net/late", title: "Late", content: "After the end.", error: null }] }), END + 31_000, { call: "call_late", name: "web_extract" });
  add("assistant", "Prepared.", END - 1000);
  db.close();
}

test("from a Claude Code transcript, only successful page reads inside the run's time are kept", async () => {
  const home = tmp("claude-home-"), marker = newMarker();
  claudeTranscript(home, "gs-prep-someone-else", "other-session");
  const file = claudeTranscript(home, marker);
  const run = await captureRun({ marker, startedMs: START, finishedMs: END, claude: [home], hermes: [] });
    assert.equal(run.problem, undefined);
    assert.equal(run.assistant, "claude");
    assert.equal(run.session_id, "claude-session-1");
    assert.match(run.record_sha256, /^[a-f0-9]{64}$/);
    assert.equal(run.record_sha256, digest(fs.readFileSync(file)));
    assert.deepEqual(run.sources, [{ url: "https://example.org/report", tool: "WebFetch", call_id: "toolu_ok", read_at: at(START + 125_000), text: "The report says freelance rates rose 12 percent in 2026." }]);
    assert.deepEqual(run.searches.map((s) => s.query), ["earning paths 2026"]);
    assert.equal(run.dropped, 4, "the error, the 404, the plain-http page and the late page are left out");
});

test("from a Hermes session store, only successful page reads inside the run's time are kept", async () => {
  const home = tmp("hermes-home-"), marker = newMarker();
  await hermesStore(home, marker);
  // Another profile's store, whose conversation only quotes the marker, is not the run.
  await hermesStore(home, marker, "quoting-session", { profile: "other", other: true });
  const run = await captureRun({ marker, startedMs: START, finishedMs: END, claude: [], hermes: [path.join(home, "profiles", "other", "state.db"), path.join(home, "state.db")] });
  assert.equal(run.problem, undefined);
  assert.equal(run.assistant, "hermes");
  assert.equal(run.session_id, "hermes-session-1");
  assert.match(run.record_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(run.sources.map((s) => [s.url, s.tool, s.call_id]), [["https://example.net/study", "web_extract", "call_read"], ["https://example.net/second", "web_extract", "call_named"]]);
  assert.equal(run.sources[0].text, "The study followed 400 people for a year.");
  assert.equal(run.sources[0].read_at, at(START + 110_000));
  assert.deepEqual(run.searches.map((s) => s.query), ["market 2026"]);
  assert.equal(run.dropped, 3, "the failed page, the refused call and the late page are left out");
});

test("a run whose marker no record holds has no receipts", async () => {
  const home = tmp("claude-home-");
  claudeTranscript(home, newMarker());
  const run = await captureRun({ marker: newMarker(), startedMs: START, finishedMs: END, claude: [home], hermes: [] });
  assert.match(run.problem, /no record of the run was found/);
});

// The writer's evidence and the reviewer's run, as mc-coach-prep makes them, then sealed.
async function sealed({ answer, reviewerSession = "review-session", reviewedAt = at(END + 600_000), modelSidecar = false } = {}) {
  const m = mission(), area = m.area();
  const home = tmp("claude-home-"), marker = newMarker();
  claudeTranscript(home, marker, "writer-session");
  const run = await captureRun({ marker, startedMs: START, finishedMs: END, claude: [home], hermes: [] });
  const rundir = path.join(m.root, "routines", "coach-prep", "2026-10-21");
  const evidenceFile = path.join(rundir, "work-2026-10-21.evidence.json");
  if (modelSidecar) fs.writeFileSync(evidenceFile.replace(rundir, path.dirname(m.file)).replace("work-", ""), '{"version":1,"sources":[{"url":"https://made.up/"}]}');
  writeEvidence({ prepFile: m.file, area, run: { ...run, marker }, out: evidenceFile });
  const reviewFile = path.join(rundir, "work-2026-10-21.review.json");
  const coverage = (ids, url = "https://example.org/report") => ids.map((id) => ({ id, verdict: "pass", reason: "The read report supports it; the contrary finding is weighed.", sources: [url] }));
  const text = typeof answer === "function" ? answer(coverage) : answer ?? JSON.stringify({ verdict: "pass", coverage: coverage(["income", "market", "buffer"]), issues: [] });
  const r = sealReview({ prepFile: m.file, area, evidenceFile, answer: text, out: reviewFile, now: NOW, reviewedAt,
    reviewer: { marker: newMarker("review"), session_id: reviewerSession, record_sha256: "b".repeat(64), assistant: "claude" } });
  const place = () => { for (const [from, to] of [[evidenceFile, m.file.replace(/\.md$/, ".evidence.json")], [reviewFile, m.file.replace(/\.md$/, ".review.json")]]) fs.copyFileSync(from, to); };
  return { ...m, r, run, place, gate: () => prepProblem(readPrep(m.file), readArea(m.dir), NOW) };
}

test("a passing review, sealed and placed beside the preparation, opens the talk", async () => {
  const s = await sealed();
  assert.equal(s.r.problem, null);
  assert.equal(s.gate(), "its research evidence or independent review is missing or unreadable", "candidates in the run folder open nothing yet");
  s.place();
  assert.equal(s.gate(), null);
  const ev = JSON.parse(fs.readFileSync(s.file.replace(/\.md$/, ".evidence.json"), "utf8"));
  assert.equal(ev.run.session_id, "writer-session");
  assert.match(ev.run.token, /^gs-prep-/);
});

test("a sidecar the model wrote is overwritten by the host's", async () => {
  const s = await sealed({ modelSidecar: true });
  const beside = s.file.replace(/\.md$/, ".evidence.json");
  assert.match(fs.readFileSync(beside, "utf8"), /made\.up/);
  s.place();
  assert.doesNotMatch(fs.readFileSync(beside, "utf8"), /made\.up/);
  assert.equal(s.gate(), null);
});

test("a review that omits a goal or a domain, cites an unread page, shares the writer's session or post-dates now is refused with its sentence", async () => {
  const goal = await sealed({ answer: (c) => JSON.stringify({ verdict: "pass", coverage: c(["income", "market"]), issues: [] }) });
  assert.equal(goal.r.problem, 'its independent review did not judge the goal "buffer"');
  const domain = await sealed({ answer: (c) => JSON.stringify({ verdict: "pass", coverage: c(["income", "buffer"]), issues: [] }) });
  assert.equal(domain.r.problem, "its independent review omitted or duplicated a research domain");
  const unread = await sealed({ answer: (c) => JSON.stringify({ verdict: "pass", coverage: c(["income", "market", "buffer"], "https://never.read/page"), issues: [] }) });
  assert.equal(unread.r.problem, 'its independent review does not substantiate research domain "income"');
  const same = await sealed({ reviewerSession: "writer-session" });
  assert.equal(same.r.problem, "its review was not recorded as an independent execution");
  const future = await sealed({ reviewedAt: at(NOW.getTime() + 3_600_000) });
  assert.equal(future.r.problem, "its research or review timestamps are invalid or in the future");
});

test("a failed review hands its issues to the next try", async () => {
  const s = await sealed({ answer: (c) => "Here is my review:\n```json\n" + JSON.stringify({ verdict: "fail", coverage: [...c(["income", "market"]), { id: "buffer", verdict: "fail", reason: "No route for the buffer goal was weighed.", sources: [] }], issues: ["The 12 percent rise is not in the source text.", { issue: "A cheaper route was missed", link: "https://example.com/route" }] }) + "\n```" });
  assert.equal(s.r.problem, "its independent research review did not pass");
  assert.deepEqual(s.r.issues, ["The 12 percent rise is not in the source text.", "A cheaper route was missed: https://example.com/route", "buffer: No route for the buffer goal was weighed."]);
  const none = await sealed({ answer: "I think it is fine." });
  assert.match(none.r.problem, /did not answer with the JSON/);
  assert.equal(none.r.review.verdict, "fail");
});

test("one byte changed in the preparation after the seal is refused", async () => {
  const s = await sealed(); s.place();
  assert.equal(s.gate(), null);
  fs.appendFileSync(s.file, " ");
  assert.equal(s.gate(), "its research evidence or review belongs to another preparation");
});

test("parseReview takes the JSON out of a fence or a sentence", () => {
  assert.deepEqual(parseReview('{"verdict":"pass"}'), { verdict: "pass" });
  assert.deepEqual(parseReview('Sure.\n```json\n{"verdict":"fail"}\n```'), { verdict: "fail" });
  assert.equal(parseReview("no json"), null);
});

test("the coach's prep-receipts and prep-seal commands write the candidates and the gate passes them", async () => {
  const m = mission(), claude = tmp("claude-config-"), hermes = tmp("hermes-home-");
  const marker = newMarker(), review = newMarker("review");
  claudeTranscript(claude, marker, "writer-session");
  await hermesStore(hermes, review, "review-session");
  const env = { ...process.env, CLAUDE_CONFIG_DIR: claude, HERMES_HOME: hermes, HOME: tmp("home-"), GODSPEED_NOW: NOW.toISOString(), GODSPEED_COACH_GIT_SYNC: "off" };
  const coach = (...args) => spawnSync(process.execPath, [BIN, ...args, "--godspeed", m.root], { env, encoding: "utf8" });
  const rundir = path.join(m.root, "routines", "coach-prep", "2026-10-21"), ev = path.join(rundir, "e.json"), rv = path.join(rundir, "r.json"), ans = path.join(rundir, "answer.txt");
  const r1 = coach("prep-receipts", "work", "--date", "2026-10-21", "--marker", marker, "--started", at(START), "--finished", at(END), "--out", ev);
  assert.equal(r1.status, 0, r1.stdout + r1.stderr);
  assert.match(r1.stdout, /^receipts: claude session writer-session: 1 source page read, 4 readings left out/);
  fs.writeFileSync(ans, JSON.stringify({ verdict: "pass", coverage: ["income", "market", "buffer"].map((id) => ({ id, verdict: "pass", reason: "Supported by the report.", sources: ["https://example.org/report"] })), issues: [] }));
  const r2 = coach("prep-seal", "work", "--date", "2026-10-21", "--evidence", ev, "--answer", ans, "--marker", review, "--started", at(START), "--finished", at(END + 60_000), "--out", rv, "--json");
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  assert.equal(JSON.parse(r2.stdout).ok, true);
  const sealedReview = JSON.parse(fs.readFileSync(rv, "utf8"));
  assert.equal(sealedReview.reviewer.session_id, "review-session");
  assert.equal(sealedReview.reviewer.assistant, "hermes");
  // A review run that is the writer's own is refused, its issues written for the next try.
  const issues = path.join(rundir, "issues.txt");
  const r3 = coach("prep-seal", "work", "--date", "2026-10-21", "--evidence", ev, "--answer", ans, "--marker", marker, "--started", at(START), "--finished", at(END), "--out", rv, "--issues-out", issues);
  assert.equal(r3.status, 1);
  assert.match(r3.stdout, /^not sealed: its review was not recorded as an independent execution/);
  assert.match(fs.readFileSync(issues, "utf8"), /^- /);
});
