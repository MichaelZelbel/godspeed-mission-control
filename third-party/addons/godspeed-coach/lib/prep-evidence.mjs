// The writer cannot declare its own research complete. Configured areas require receipts
// collected from the execution transcript and a separate review bound to these exact bytes.
import fs from "node:fs";
import crypto from "node:crypto";

const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const nonempty = (value) => typeof value === "string" && Boolean(value.trim());
const instant = (value) => nonempty(value) && Number.isFinite(Date.parse(value)) ? Date.parse(value) : NaN;
const https = (value) => { try { return new URL(value).protocol === "https:"; } catch { return false; } };
const SKEW = 60_000;

export function researchDomains(area) {
  return (area?.lists?.["RESEARCH DOMAIN"] || []).map((line) => line.split("|")[0].trim());
}

export function researchEvidenceProblem(prep, area, now = new Date()) {
  const domains = researchDomains(area);
  if (!domains.length) return null;
  if (domains.some((id) => !/^[a-z0-9][a-z0-9-]*$/.test(id)) || new Set(domains).size !== domains.length) return "its research domains are invalid or duplicated";
  const required = ["The opening", "Talk card", "Where he stands", "What changed since the last talk", "The world this week", "Opportunities", "What I think", "Gaps", "Cut, and why", "Research coverage"];
  for (const name of required) {
    const key = Object.keys(prep.sections).find((k) => k.toLowerCase() === name.toLowerCase());
    if (!key || !String(prep.sections[key]).trim()) return `its research section "${name}" is empty`;
  }
  let evidence, evidenceBytes, review, prepBytes, areaBytes;
  try {
    prepBytes = fs.readFileSync(prep.file);
    areaBytes = fs.readFileSync(area.file);
    evidenceBytes = fs.readFileSync(prep.file.replace(/\.md$/i, ".evidence.json"));
    evidence = JSON.parse(evidenceBytes.toString("utf8"));
    review = JSON.parse(fs.readFileSync(prep.file.replace(/\.md$/i, ".review.json"), "utf8"));
  } catch { return "its research evidence or independent review is missing or unreadable"; }
  const prepHash = sha(prepBytes), areaHash = sha(areaBytes);
  if (evidence.version !== 1 || review.version !== 1) return "its research evidence version is unsupported";
  if (evidence.prep_sha256 !== prepHash || review.prep_sha256 !== prepHash) return "its research evidence or review belongs to another preparation";
  if (evidence.area_sha256 !== areaHash || review.area_sha256 !== areaHash) return "its research scope changed after preparation";
  if (review.evidence_sha256 !== sha(evidenceBytes)) return "its research evidence changed after review";
  const sameIds = (ids) => Array.isArray(ids) && ids.length === domains.length && new Set(ids).size === ids.length && domains.every((id) => ids.includes(id));
  if (!sameIds(evidence.coverage_domains)) return "its research evidence does not cover the configured domains";
  const run = evidence.run || {}, reviewer = review.reviewer || {};
  if (!nonempty(run.token) || !nonempty(run.session_id) || !digest(run.transcript_sha256)) return "its research execution receipt is incomplete";
  if (!nonempty(reviewer.token) || !nonempty(reviewer.session_id) || !digest(reviewer.transcript_sha256) || reviewer.session_id === run.session_id || reviewer.token === run.token) return "its review was not recorded as an independent execution";
  const started = instant(run.started_at), finished = instant(run.finished_at), reviewed = instant(review.reviewed_at), current = now.getTime();
  if (![started, finished, reviewed, current].every(Number.isFinite) || finished < started || reviewed < finished || reviewed > current + SKEW) return "its research or review timestamps are invalid or in the future";
  const prepared = instant(prep.head.PREPARED);
  if (!Number.isFinite(prepared) || prepared < started - SKEW || prepared > finished + SKEW) return "its PREPARED time does not match its research execution";
  if (!Array.isArray(evidence.sources) || !evidence.sources.length) return "its research has no source-page reading receipts";
  for (const source of evidence.sources) {
    const read = instant(source.read_at);
    if (source.tool !== "WebFetch" || !https(source.url) || !nonempty(source.call_id) || !nonempty(source.text) || !Number.isFinite(read) || read < started - SKEW || read > finished + SKEW) return "its source-page reading receipt is invalid";
  }
  if (review.verdict !== "pass") return "its independent research review did not pass";
  if (!Array.isArray(review.coverage) || !sameIds(review.coverage.map((row) => row?.id))) return "its independent review omitted or duplicated a research domain";
  const sources = new Set(evidence.sources.map((s) => s.url));
  for (const row of review.coverage) {
    if (row.verdict !== "pass" || !nonempty(row.reason) || !Array.isArray(row.sources) || !row.sources.length || row.sources.some((url) => !sources.has(url))) return `its independent review does not substantiate research domain "${row.id}"`;
  }
  return null;
}
