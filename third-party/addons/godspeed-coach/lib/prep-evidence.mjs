// The writer cannot declare its own research complete. Configured areas require receipts
// collected from the execution transcript and a separate review bound to these exact bytes.
//
// The receipts and the review are written by the host that ran the preparation (in Godspeed Mission
// Control, tools/mc-coach-prep through lib/prep-receipts.mjs), never by the model: the evidence lists
// the source pages the run really opened, read from the run's own record (Claude Code's transcript
// or Hermes' session store), and the review is a second run that did not write the preparation.
import fs from "node:fs";
import crypto from "node:crypto";

const sha = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
const digest = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const nonempty = (value) => typeof value === "string" && Boolean(value.trim());
const instant = (value) => nonempty(value) && Number.isFinite(Date.parse(value)) ? Date.parse(value) : NaN;
const https = (value) => { try { return new URL(value).protocol === "https:"; } catch { return false; } };
const SKEW = 60_000;

// THE TOOLS THAT READ A SOURCE PAGE, one per assistant, listed here and nowhere else: a receipt
// counts only when the run opened the page with one of these. A search result (a snippet) is never
// a reading. Claude Code reads a page with WebFetch, Hermes with its page-extract tool.
export const READING_TOOLS = Object.freeze({ claude: "WebFetch", hermes: "web_extract" });
const READERS = new Set(Object.values(READING_TOOLS));

// The sections a researched preparation must fill. "Where they stand" is the coach-prep recipe's
// name for the section "Where he stands" (either is accepted); "Routes" holds every route the
// preparation weighed, with its source, so the reviewer can check it.
const REQUIRED = [["The opening"], ["Talk card"], ["Where he stands", "Where they stand"], ["What changed since the last talk"], ["The world this week"], ["Opportunities"], ["Routes"], ["What I think"], ["Gaps"], ["Cut, and why"], ["Research coverage"]];

// The goals the area serves (its SERVES line): the review judges each of them as well as each domain.
export function servedGoals(area) {
  return [...new Set((area?.serves || []).map((id) => String(id).trim()).filter(Boolean))];
}

// The two sidecars of a preparation: <date>.evidence.json and <date>.review.json beside it.
export const sidecars = (prepFile) => ({ evidence: prepFile.replace(/\.md$/i, ".evidence.json"), review: prepFile.replace(/\.md$/i, ".review.json") });

export function researchDomains(area) {
  return (area?.lists?.["RESEARCH DOMAIN"] || []).map((line) => line.split("|")[0].trim());
}

// Why this preparation's research cannot open the talk, or null. `files` names other sidecars to
// check (the candidates in the run folder, before the host moves them beside the preparation).
export function researchEvidenceProblem(prep, area, now = new Date(), files = null) {
  const domains = researchDomains(area);
  if (!domains.length) return null;
  if (domains.some((id) => !/^[a-z0-9][a-z0-9-]*$/.test(id)) || new Set(domains).size !== domains.length) return "its research domains are invalid or duplicated";
  for (const names of REQUIRED) {
    const filled = names.some((name) => {
      const key = Object.keys(prep.sections).find((k) => k.toLowerCase() === name.toLowerCase());
      return key && String(prep.sections[key]).trim();
    });
    if (!filled) return `its research section "${names[0]}" is empty`;
  }
  const paths = { ...sidecars(prep.file), ...(files || {}) };
  let evidence, evidenceBytes, review, prepBytes, areaBytes;
  try {
    prepBytes = fs.readFileSync(prep.file);
    areaBytes = fs.readFileSync(area.file);
    evidenceBytes = fs.readFileSync(paths.evidence);
    evidence = JSON.parse(evidenceBytes.toString("utf8"));
    review = JSON.parse(fs.readFileSync(paths.review, "utf8"));
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
    if (!READERS.has(source.tool) || !https(source.url) || !nonempty(source.call_id) || !nonempty(source.text) || !Number.isFinite(read) || read < started - SKEW || read > finished + SKEW) return "its source-page reading receipt is invalid";
  }
  if (review.verdict !== "pass") return "its independent research review did not pass";
  // Every research domain and every goal the area serves is judged, each once, and nothing else.
  const goals = servedGoals(area), wanted = new Set([...domains, ...goals]);
  const ids = Array.isArray(review.coverage) ? review.coverage.map((row) => row?.id) : null;
  if (!ids || new Set(ids).size !== ids.length || domains.some((id) => !ids.includes(id)) || ids.some((id) => !wanted.has(id))) return "its independent review omitted or duplicated a research domain";
  const unjudged = goals.find((id) => !ids.includes(id));
  if (unjudged) return `its independent review did not judge the goal "${unjudged}"`;
  const sources = new Set(evidence.sources.map((s) => s.url));
  for (const row of review.coverage) {
    const what = domains.includes(row.id) ? "research domain" : "goal";
    if (row.verdict !== "pass" || !nonempty(row.reason) || !Array.isArray(row.sources) || !row.sources.length || row.sources.some((url) => !sources.has(url))) return `its independent review does not substantiate ${what} "${row.id}"`;
  }
  return null;
}
