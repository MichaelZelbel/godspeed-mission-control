// The receipts and the seal of a researched preparation, written by the host that ran it, never by
// the model (lib/prep-evidence.mjs says what the coach then checks).
//
// Until beta.16 the coach refused every preparation of an area with RESEARCH DOMAIN lines that had
// no <date>.evidence.json and <date>.review.json beside it, and nothing in Godspeed wrote either,
// so such a talk could never open prepared. Now the preparation job (in Godspeed Mission Control,
// tools/mc-coach-prep) gives each run a fresh marker, a line "RUN MARKER: <marker>" in its prompt,
// and after the run ends this file:
//
//   captureRun   finds the run's own record by that marker: Claude Code's transcript
//                (~/.claude/projects/<folder>/<session>.jsonl, or under CLAUDE_CONFIG_DIR) or
//                Hermes' session store (state.db under HERMES_HOME, the default profile's at its
//                root, the others in profiles/<name>/), and keeps every source page the run opened
//                successfully with a page-reading tool (READING_TOOLS) between its start and its end:
//                the URL, the time, the tool call's id and the text the run read.
//   writeEvidence  writes that as the evidence (format version 1), bound to the preparation's and
//                the area's bytes. A file the model wrote there is overwritten.
//   sealReview   turns the separate reviewer's JSON answer into the review, bound to the
//                preparation, the area and the evidence, with the reviewer's own marker, session and
//                record hash, and asks the coach's gate whether the pair opens the talk.
//
// The job writes both into its run folder first and moves them beside the preparation only when the
// gate passes them, so an older preparation that still opens its talk keeps its own proof.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { READING_TOOLS, researchDomains, researchEvidenceProblem } from "./prep-evidence.mjs";
import { readPrep } from "./prep.mjs";

const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const iso = (ms) => new Date(ms).toISOString();
const https = (value) => { try { return new URL(value).protocol === "https:"; } catch { return false; } };
const SEARCH_TOOLS = new Set(["WebSearch", "web_search"]);
const MARKER_LINE = /^[ \t]*RUN MARKER:[ \t]*(\S+)[ \t]*$/m;

// The marker the host gives a run: hard to guess, so no model can claim another run's record.
export const newMarker = (kind = "prep") => `gs-${kind}-${crypto.randomBytes(12).toString("hex")}`;

// The first RUN MARKER line of a prompt, or "". A prompt that quotes another run's marker elsewhere
// (the reviewer's prompt carries the writer's evidence) still names only its own on that line.
const markerOf = (text) => (String(text || "").match(MARKER_LINE) || [])[1] || "";

const textOf = (content) => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c) => (typeof c === "string" ? c : c?.type === "text" ? c.text || "" : "")).join("\n");
  return "";
};

// ---- Claude Code: one JSON object per line in the session's transcript ----------------------------

export function claudeHomes(env = process.env) {
  const list = [];
  if (env.CLAUDE_CONFIG_DIR) list.push(env.CLAUDE_CONFIG_DIR);
  list.push(path.join(env.HOME || env.USERPROFILE || os.homedir(), ".claude"));
  return [...new Set(list)];
}

function claudeTranscripts(homes, sinceMs) {
  const out = [];
  for (const home of homes) {
    const root = path.join(home, "projects");
    let dirs = [];
    try { dirs = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { continue; }
    for (const d of dirs) {
      let files = [];
      try { files = fs.readdirSync(path.join(root, d.name)).filter((f) => f.endsWith(".jsonl")); } catch { continue; }
      for (const f of files) {
        const file = path.join(root, d.name, f);
        try { if (fs.statSync(file).mtimeMs >= sinceMs) out.push(file); } catch { /* gone */ }
      }
    }
  }
  return out;
}

export function readClaudeRun(file, marker) {
  let bytes;
  try { bytes = fs.readFileSync(file); } catch { return null; }
  const lines = [];
  for (const raw of bytes.toString("utf8").split("\n")) { if (!raw.trim()) continue; try { lines.push(JSON.parse(raw)); } catch { /* a torn line */ } }
  // The run's prompt: the first message of the person (not a tool's result) that names a marker.
  const prompt = lines.find((l) => l?.type === "user" && !(Array.isArray(l.message?.content) && l.message.content.some((c) => c?.type === "tool_result")) && markerOf(textOf(l.message?.content)));
  if (!prompt || markerOf(textOf(prompt.message.content)) !== marker) return null;
  const session = String(prompt.sessionId || path.basename(file, ".jsonl"));
  const calls = new Map(), reads = [], searches = [];
  for (const l of lines) {
    if (l?.type !== "assistant" || !Array.isArray(l.message?.content)) continue;
    for (const c of l.message.content) if (c?.type === "tool_use" && c.id) calls.set(c.id, { name: c.name, input: c.input || {}, at: Date.parse(l.timestamp) });
  }
  for (const l of lines) {
    if (l?.type !== "user" || !Array.isArray(l.message?.content)) continue;
    for (const c of l.message.content) {
      if (c?.type !== "tool_result") continue;
      const call = calls.get(c.tool_use_id);
      if (!call) continue;
      const at = Date.parse(l.timestamp);
      if (SEARCH_TOOLS.has(call.name)) { searches.push({ tool: call.name, query: String(call.input.query || ""), at }); continue; }
      if (call.name !== READING_TOOLS.claude) continue;
      const code = Number(l.toolUseResult?.code);
      const failed = c.is_error === true || (Number.isFinite(code) && (code < 200 || code >= 400));
      reads.push({ url: String(call.input.url || l.toolUseResult?.url || ""), tool: call.name, call_id: c.tool_use_id, at, text: textOf(c.content), failed });
    }
  }
  return { assistant: "claude", session_id: session, record_sha256: sha(bytes), reads, searches };
}

// ---- Hermes: the session store, state.db (SQLite) ---------------------------------------------------

export function hermesStores(env = process.env) {
  const homes = [];
  if (env.HERMES_HOME) homes.push(env.HERMES_HOME);
  homes.push(path.join(env.HOME || env.USERPROFILE || os.homedir(), ".hermes"));
  const out = [];
  for (const home of [...new Set(homes)]) {
    const root = path.join(home, "state.db");
    if (fs.existsSync(root)) out.push(root);
    let profiles = [];
    try { profiles = fs.readdirSync(path.join(home, "profiles"), { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { /* none */ }
    for (const p of profiles) { const db = path.join(home, "profiles", p.name, "state.db"); if (fs.existsSync(db)) out.push(db); }
  }
  return [...new Set(out)];
}

let sqlite;
async function openStore(file) {
  if (sqlite === undefined) {
    // node:sqlite is in Node 22.13 and later (the notebook's Node); quiet its "experimental" notice.
    const emit = process.emitWarning;
    process.emitWarning = (w, ...rest) => (String(w?.message || w).includes("SQLite") ? undefined : emit.call(process, w, ...rest));
    try { sqlite = await import("node:sqlite"); } catch { sqlite = null; } finally { process.emitWarning = emit; }
  }
  if (!sqlite) throw new Error("this Node.js cannot read Hermes' session store (it needs Node.js 22.13 or later)");
  try { return new sqlite.DatabaseSync(file, { readOnly: true }); } catch {
    // A store whose write-ahead files cannot be opened read-only is read from a copy.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "coach-receipts-"));
    for (const ext of ["", "-wal", "-shm"]) if (fs.existsSync(file + ext)) fs.copyFileSync(file + ext, path.join(dir, "state.db" + ext));
    const db = new sqlite.DatabaseSync(path.join(dir, "state.db"));
    db._copy = dir;
    return db;
  }
}
const closeStore = (db) => { try { db.close(); } catch { /* closed */ } if (db._copy) fs.rmSync(db._copy, { recursive: true, force: true }); };

const KEEP = ["id", "session_id", "role", "content", "tool_call_id", "tool_calls", "tool_name", "timestamp"];
export async function readHermesRun(file, marker) {
  const db = await openStore(file);
  try {
    const found = db.prepare("SELECT session_id FROM messages WHERE role = 'user' AND content LIKE ? ORDER BY id").all(`%${marker}%`);
    let root = null;
    for (const { session_id } of found) {
      const first = db.prepare("SELECT content FROM messages WHERE session_id = ? AND role = 'user' ORDER BY id LIMIT 1").get(session_id);
      if (markerOf(first?.content) === marker) { root = session_id; break; }
    }
    if (!root) return null;
    // A conversation Hermes compressed goes on in a child session (parent_session_id).
    const ids = [root];
    try {
      for (let i = 0; i < ids.length && ids.length < 50; i++) for (const r of db.prepare("SELECT id FROM sessions WHERE parent_session_id = ?").all(ids[i])) if (!ids.includes(r.id)) ids.push(r.id);
    } catch { /* an older store without parent sessions */ }
    const rows = db.prepare(`SELECT * FROM messages WHERE session_id IN (${ids.map(() => "?").join(",")}) ORDER BY id`).all(...ids)
      .map((r) => Object.fromEntries(KEEP.filter((k) => k in r).map((k) => [k, r[k]])));
    const calls = new Map();
    for (const r of rows) {
      if (r.role !== "assistant" || !r.tool_calls) continue;
      let list = []; try { list = JSON.parse(r.tool_calls); } catch { /* unreadable */ }
      for (const c of Array.isArray(list) ? list : []) {
        const id = c?.id || c?.call_id; if (!id) continue;
        let args = c?.function?.arguments ?? c?.arguments ?? {};
        if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
        calls.set(id, { name: c?.function?.name || c?.name || "", args: args || {} });
      }
    }
    const reads = [], searches = [];
    for (const r of rows) {
      if (r.role !== "tool") continue;
      const name = r.tool_name || calls.get(r.tool_call_id)?.name || "";
      const at = Number(r.timestamp) * 1000;
      if (SEARCH_TOOLS.has(name)) { searches.push({ tool: name, query: String(calls.get(r.tool_call_id)?.args?.query || ""), at }); continue; }
      if (name !== READING_TOOLS.hermes) continue;
      let body = null; try { body = JSON.parse(r.content); } catch { /* not a result */ }
      const results = Array.isArray(body?.results) ? body.results : [];
      if (!results.length) { reads.push({ url: "", tool: name, call_id: r.tool_call_id || "", at, text: "", failed: true }); continue; }
      for (const x of results) reads.push({ url: String(x?.url || ""), tool: name, call_id: r.tool_call_id || "", at, text: String(x?.content || ""), failed: Boolean(x?.error) || Boolean(x?.blocked_by_policy) });
    }
    return { assistant: "hermes", session_id: String(root), record_sha256: sha(JSON.stringify(rows)), reads, searches };
  } finally { closeStore(db); }
}

// ---- One run, wherever its record is --------------------------------------------------------------

// The run's record and the pages it read successfully between start and end (both in ms), or a
// { problem } in words.
export async function captureRun({ marker, startedMs, finishedMs, env = process.env, claude = claudeHomes(env), hermes = hermesStores(env) }) {
  if (!marker || !Number.isFinite(startedMs) || !Number.isFinite(finishedMs) || finishedMs < startedMs) return { problem: "the run's marker or times are missing" };
  let run = null; const errors = [];
  // Only transcripts written since the run began are opened (a computer may keep thousands). The run
  // began by the coach's clock and by the computer's own: a rehearsal that froze the coach's clock
  // (GODSPEED_NOW) must not hide a transcript written a minute ago.
  const since = Math.min(startedMs, Date.now() - (finishedMs - startedMs)) - 10 * 60_000;
  for (const file of claudeTranscripts(claude, since)) { run = readClaudeRun(file, marker); if (run) break; }
  if (!run) for (const db of hermes) {
    try { run = await readHermesRun(db, marker); } catch (e) { errors.push(e.message); }
    if (run) break;
  }
  if (!run) return { problem: `no record of the run was found (neither a Claude Code transcript nor a Hermes session holds its marker${errors.length ? "; " + errors[0] : ""})` };
  const inside = (at) => Number.isFinite(at) && at >= startedMs && at <= finishedMs;
  const sources = run.reads.filter((r) => !r.failed && inside(r.at) && https(r.url) && r.call_id && r.text.trim())
    .map((r) => ({ url: r.url, tool: r.tool, call_id: r.call_id, read_at: iso(r.at), text: r.text }));
  return {
    ...run, started_at: iso(startedMs), finished_at: iso(finishedMs), sources,
    searches: run.searches.filter((s) => inside(s.at)).map((s) => ({ tool: s.tool, query: s.query, at: iso(s.at) })),
    dropped: run.reads.length - sources.length,
  };
}

// The evidence (version 1), bound to the preparation's and the area's bytes as they are now.
export function writeEvidence({ prepFile, area, run, out }) {
  const evidence = {
    version: 1, prep_sha256: sha(fs.readFileSync(prepFile)), area_sha256: sha(fs.readFileSync(area.file)),
    run: { token: run.marker, session_id: run.session_id, transcript_sha256: run.record_sha256, started_at: run.started_at, finished_at: run.finished_at, assistant: run.assistant },
    sources: run.sources, searches: run.searches, coverage_domains: researchDomains(area),
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(evidence, null, 2) + "\n");
  return evidence;
}

// The reviewer's answer is one JSON object; one wrapped in a code fence or a sentence is taken out of it.
export function parseReview(text) {
  const t = String(text || "").replace(/^﻿/, "");
  const tries = [t.trim()];
  const fence = t.match(/```(?:json)?\s*\n([\s\S]*?)```/);
  if (fence) tries.push(fence[1]);
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) tries.push(t.slice(a, b + 1));
  for (const x of tries) { try { const v = JSON.parse(x); if (v && typeof v === "object" && !Array.isArray(v)) return v; } catch { /* next */ } }
  return null;
}

const words = (v) => (typeof v === "string" ? v : v && typeof v === "object" ? Object.values(v).filter((x) => typeof x === "string").join(": ") : String(v ?? "")).replace(/\s+/g, " ").trim();

// The review, sealed by the host: written to `out` (a candidate in the run folder), and the gate's
// answer about it. Returns { review, problem, issues }: problem is null when the talk may open from
// the pair; issues are what the next try must resolve.
export function sealReview({ prepFile, area, evidenceFile, answer, reviewer, reviewedAt, out, now = new Date() }) {
  const parsed = parseReview(answer);
  const coverage = Array.isArray(parsed?.coverage) ? parsed.coverage.map((row) => ({
    id: String(row?.id ?? "").trim(), verdict: row?.verdict === "pass" ? "pass" : "fail", reason: words(row?.reason),
    sources: Array.isArray(row?.sources) ? row.sources.map((u) => String(u).trim()).filter(Boolean) : [],
  })) : [];
  const issues = (Array.isArray(parsed?.issues) ? parsed.issues : []).map(words).filter(Boolean);
  const review = {
    version: 1, verdict: parsed?.verdict === "pass" ? "pass" : "fail",
    prep_sha256: sha(fs.readFileSync(prepFile)), evidence_sha256: sha(fs.readFileSync(evidenceFile)), area_sha256: sha(fs.readFileSync(area.file)),
    reviewed_at: reviewedAt,
    reviewer: { token: reviewer.marker, session_id: reviewer.session_id, transcript_sha256: reviewer.record_sha256, assistant: reviewer.assistant },
    coverage, issues,
  };
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(review, null, 2) + "\n");
  const problem = parsed ? researchEvidenceProblem(readPrep(prepFile), area, now, { evidence: evidenceFile, review: out })
    : "its independent reviewer did not answer with the JSON the review recipe asks for";
  const next = [...issues, ...coverage.filter((r) => r.verdict !== "pass").map((r) => `${r.id}: ${r.reason || "not substantiated"}`)];
  if (problem && !next.length) next.push(problem.replace(/^its /, "The preparation's "));
  return { review, problem, issues: problem ? next : [] };
}
