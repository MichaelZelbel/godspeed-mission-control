import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { readArea } from "../lib/areas.mjs";
import { readPrep, prepProblem, prepForBrief, prepDue } from "../lib/prep.mjs";

const hash = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const NOW = new Date("2026-10-21T12:00:00Z");
const settings = { timezone: "Europe/Berlin" };
const fixtures = new Set();
test.after(() => { for (const root of fixtures) fs.rmSync(root, { recursive: true, force: true }); });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "coach-research-")); fixtures.add(root);
  const dir = path.join(root, "coach", "work"), prepDir = path.join(dir, "prep");
  fs.mkdirSync(prepDir, { recursive: true });
  fs.writeFileSync(path.join(dir, "area.md"), "AREA: work\nTITLE: Work and money\nRHYTHM: weekly wednesday\nTIME: 19:00\nSTARTS: 2026-10-14\nSTATUS: on\nRESEARCH DOMAIN: income | new earning paths\nRESEARCH DOMAIN: market | market changes\n");
  const file = path.join(prepDir, "2026-10-21.md");
  const sections = ["The opening", "Talk card", "Where he stands", "What changed since the last talk", "The world this week", "Opportunities", "What I think", "Gaps", "Cut, and why", "Research coverage"];
  fs.writeFileSync(file, "AREA: work\nTALK: 2026-10-21 19:00\nPREPARED: 2026-10-21T10:30:00Z\nSTATE: ready\n\n" + sections.map((title) => `## ${title}\n${title === "Research coverage" ? "income and market: considered current source evidence." : "A substantive section for the review fixture."}\n`).join("\n"));
  const area = readArea(dir);
  const evidence = {
    version: 1, prep_sha256: hash(fs.readFileSync(file)), area_sha256: hash(fs.readFileSync(area.file)),
    run: { token: "writer-execution", session_id: "writer-session", transcript_sha256: "a".repeat(64), started_at: "2026-10-21T10:00:00Z", finished_at: "2026-10-21T10:31:00Z" },
    sources: [{ url: "https://example.org/report", tool: "WebFetch", call_id: "read-report", read_at: "2026-10-21T10:15:00Z", text: "The source content that the separate reviewer actually receives." }], searches: [], coverage_domains: ["income", "market"],
  };
  const review = {
    version: 1, verdict: "pass", prep_sha256: evidence.prep_sha256, evidence_sha256: "", area_sha256: evidence.area_sha256, reviewed_at: "2026-10-21T11:00:00Z",
    reviewer: { token: "review-execution", session_id: "review-session", transcript_sha256: "b".repeat(64) },
    coverage: ["income", "market"].map((id) => ({ id, verdict: "pass", reason: "Source supports the conclusion and the domain's material counterarguments are addressed.", sources: ["https://example.org/report"] })),
  };
  const efile = file.replace(/\.md$/, ".evidence.json"), rfile = file.replace(/\.md$/, ".review.json");
  const save = () => { fs.writeFileSync(efile, JSON.stringify(evidence)); review.evidence_sha256 = hash(fs.readFileSync(efile)); fs.writeFileSync(rfile, JSON.stringify(review)); };
  save();
  return { root, area, file, evidence, review, efile, rfile, save, problem: () => prepProblem(readPrep(file), readArea(dir), NOW) };
}

test("a separate review tied to unchanged preparation, scope and page receipts passes", () => {
  const f = fixture(); assert.equal(f.problem(), null);
  assert.deepEqual(prepDue(f.root, settings, NOW, 24), []);
});

test("legacy self-declared ready work preparation is rejected and becomes due again", () => {
  const f = fixture(); fs.unlinkSync(f.efile); fs.unlinkSync(f.rfile);
  assert.match(f.problem(), /missing or unreadable/);
  assert.deepEqual(prepDue(f.root, settings, NOW, 24).map((x) => x.area), ["work"]);
  assert.equal(prepForBrief(f.area, "2026-10-21"), null);
});

test("searches without successful page readings cannot qualify", () => {
  const f = fixture(); f.evidence.sources = []; f.evidence.searches = [{ query: "earning opportunities" }]; f.save();
  assert.match(f.problem(), /no source-page reading receipts/);
});

test("a changed preparation, scope or evidence invalidates its review", () => {
  const p = fixture(); fs.appendFileSync(p.file, "\nA new recommendation."); assert.match(p.problem(), /another preparation/);
  const a = fixture(); fs.appendFileSync(a.area.file, "\n## Limits\nNew scope"); assert.match(a.problem(), /scope changed/);
  const e = fixture(); e.evidence.sources[0].text = "Changed evidence"; fs.writeFileSync(e.efile, JSON.stringify(e.evidence)); assert.match(e.problem(), /evidence changed/);
});

test("the writer cannot serve as its own reviewer", () => {
  const f = fixture(); f.review.reviewer.session_id = f.evidence.run.session_id; f.save();
  assert.match(f.problem(), /independent execution/);
});

test("coverage must account for every configured domain using read sources", () => {
  const missing = fixture(); missing.review.coverage.pop(); missing.save(); assert.match(missing.problem(), /omitted or duplicated/);
  const noProof = fixture(); noProof.review.coverage[0].sources = ["https://never-read.example/report"]; noProof.save(); assert.match(noProof.problem(), /does not substantiate/);
  const failed = fixture(); failed.review.coverage[0].verdict = "fail"; failed.save(); assert.match(failed.problem(), /does not substantiate/);
});

test("future preparation and review timestamps are rejected", () => {
  const p = fixture(); fs.writeFileSync(p.file, fs.readFileSync(p.file, "utf8").replace("2026-10-21T10:30:00Z", "2026-10-21T13:00:00Z")); assert.match(p.problem(), /PREPARED time is in the future/);
  const r = fixture(); r.review.reviewed_at = "2026-10-21T13:00:00Z"; r.save(); assert.match(r.problem(), /timestamps are invalid or in the future/);
});

test("failed fetches and empty page receipts cannot qualify", () => {
  const f = fixture(); f.evidence.sources[0].text = ""; f.save(); assert.match(f.problem(), /receipt is invalid/);
  const s = fixture(); s.evidence.sources[0].tool = "WebSearch"; s.save(); assert.match(s.problem(), /receipt is invalid/);
});

test("an area without research-domain requirements retains existing preparation compatibility", () => {
  const f = fixture(); fs.writeFileSync(f.area.file, fs.readFileSync(f.area.file, "utf8").replace(/^RESEARCH DOMAIN:.*\n/gm, ""));
  fs.unlinkSync(f.efile); fs.unlinkSync(f.rfile); assert.equal(f.problem(), null);
});
