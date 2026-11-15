#!/usr/bin/env node
/*
 * test-promises.js - proof that tools/promises.js gives every promise file one honest state, never
 * changes a file, and that `mc-due today` says a missed promise first.
 *
 * Every case is a throwaway mission control with a fixed moment, so the answer never depends on the
 * clock of the computer the test runs on.
 *
 * Run: node tools/test-promises.js
 */
"use strict";
require("./test-guard.cjs"); // never a real mission control (test-guard.bash says why)
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const { parsePromise, checkPromises, promiseLines, promiseSayings } = require("./promises.js");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "kit-promises-"));
process.on("exit", () => fs.rmSync(TMP, { recursive: true, force: true }));
let failed = 0, count = 0;
function check(name, got, want) {
  count++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) failed++;
  console.log((ok ? "  ok   " : "  FAIL ") + name + (ok ? "" : "\n         want " + JSON.stringify(want) + "\n         got  " + JSON.stringify(got)));
}

function promise(fields) {
  const f = Object.assign({
    PROMISE: "the-brief", "WHAT YOU GET": "your morning brief, every morning", CADENCE: "daily",
    DUE: "daily 07:00 Europe/Berlin", STARTED: "2026-11-01", "RUNS IT": "the routine Morning brief",
    PROOF: "dates-in routines/ran/brief.txt",
  }, fields);
  return "# A promise\n\n" + Object.entries(f).filter(([, v]) => v !== null).map(([k, v]) => k + ": " + v).join("\n") + "\n\n## Log\n- 2026-11-01 written\nPROOF: not a field, it is in the log\n";
}
function mission(files, proofs) {
  const root = fs.mkdtempSync(path.join(TMP, "mc-"));
  fs.mkdirSync(path.join(root, "work", "promises"), { recursive: true });
  fs.writeFileSync(path.join(root, "work", "promises", "README.md"), "# not a promise\n");
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(root, "work", "promises", name), text);
  for (const [rel, text] of Object.entries(proofs || {})) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}
const stateOf = (root, now) => checkPromises(root, { now: new Date(now) }).promises.map((p) => p.state);

console.log("promises.js");

// ---- the five states, daily: due 07:00 Berlin (06:00 UTC in November), 12 hours of grace ----
check("kept: proof on the due day",
  stateOf(mission({ "a.md": promise() }, { "routines/ran/brief.txt": "2026-11-10\n" }), "2026-11-10T09:00:00Z"), ["kept"]);
check("due now: inside the grace hours, yesterday kept",
  stateOf(mission({ "a.md": promise() }, { "routines/ran/brief.txt": "2026-11-09\n" }), "2026-11-10T09:00:00Z"), ["due now"]);
check("missed: past the grace hours, last kept the day before",
  stateOf(mission({ "a.md": promise() }, { "routines/ran/brief.txt": "2026-11-09\n" }), "2026-11-10T19:00:00Z"), ["missed"]);
check("never run: past the grace hours and no proof at all",
  stateOf(mission({ "a.md": promise() }), "2026-11-10T19:00:00Z"), ["never run"]);
check("not yet due: its first day has not come",
  stateOf(mission({ "a.md": promise({ STARTED: "2026-11-11" }) }), "2026-11-10T19:00:00Z"), ["not yet due"]);
check("due now: the first day, inside its grace",
  stateOf(mission({ "a.md": promise({ STARTED: "2026-11-10" }) }), "2026-11-10T09:00:00Z"), ["due now"]);

// ---- a missed date is never moved forward: yesterday missed, today still in grace ----
const moved = mission({ "a.md": promise() }, { "routines/ran/brief.txt": "2026-11-08\n" });
check("a missed day is still missed while today's slot is in its grace", stateOf(moved, "2026-11-10T09:00:00Z"), ["missed"]);
check("and the next morning, still missed", stateOf(moved, "2026-11-11T09:00:00Z"), ["missed"]);
check("its line names the last day it was kept", promiseLines(checkPromises(moved, { now: new Date("2026-11-11T09:00:00Z") })),
  ["A promise was not kept: your morning brief, every morning. Last kept 2026-11-08."]);

// ---- weekly, Sunday 19:00 UTC, proof in file names ----
const weekly = { PROMISE: "summary", "WHAT YOU GET": "a summary of the week — every Sunday.", CADENCE: "weekly", DUE: "sunday 19:00 UTC", PROOF: "files notes/weekly/*.md" };
check("weekly kept: a file dated that Sunday",
  stateOf(mission({ "w.md": promise(weekly) }, { "notes/weekly/2026-11-08.md": "x" }), "2026-11-10T12:00:00Z"), ["kept"]);
check("weekly missed: last file a week earlier",
  stateOf(mission({ "w.md": promise(weekly) }, { "notes/weekly/2026-11-01.md": "x" }), "2026-11-10T12:00:00Z"), ["missed"]);
check("weekly: a date in a folder name counts, a future date does not",
  stateOf(mission({ "w.md": promise({ ...weekly, PROOF: "files notes/**/*.md" }) }, { "notes/2026-11-08/a.md": "x", "notes/weekly/2026-12-01.md": "x" }), "2026-11-10T12:00:00Z"), ["kept"]);
check("weekly never run: its line has the first due day, no em dash and no final period",
  promiseLines(checkPromises(mission({ "w.md": promise(weekly) }), { now: new Date("2026-11-10T12:00:00Z") })),
  ["A promise has never been kept: a summary of the week, every Sunday. It was first due 2026-11-01."]);

// ---- monthly, the 1st ----
check("monthly missed on the 1st",
  stateOf(mission({ "m.md": promise({ CADENCE: "monthly", DUE: "1 09:00 UTC", STARTED: "2026-09-01" }) }, { "routines/ran/brief.txt": "2026-10-01" }), "2026-11-10T12:00:00Z"), ["missed"]);

// ---- files that cannot be read are reported, never skipped ----
const broken = mission({
  "bad-due.md": promise({ DUE: "sometimes" }),
  "bad-zone.md": promise({ DUE: "daily 07:00 Mars/Olympus" }),
  "outside.md": promise({ PROOF: "dates-in ../elsewhere.txt" }),
  "no-proof.md": promise({ PROOF: null }),
});
fs.mkdirSync(path.join(broken, "work", "promises", "folder.md"));
const unreadable = checkPromises(broken, { now: new Date("2026-11-10T12:00:00Z") }).unreadable;
check("every unreadable file is named", unreadable.map((u) => u.file), ["bad-due.md", "bad-zone.md", "folder.md", "no-proof.md", "outside.md"]);
check("and says why", unreadable.map((u) => u.why), [
  "DUE must read daily HH:MM <zone>, <weekday> HH:MM <zone> or <1-28> HH:MM <zone>",
  "the time zone Mars/Olympus is not known",
  "it is a folder, not a file",
  "no PROOF",
  "PROOF must name a place inside your mission control",
]);
check("an unreadable file's line", promiseLines({ promises: [], unreadable: [unreadable[1]] }),
  ["A promise file cannot be read: bad-zone.md (the time zone Mars/Olympus is not known)."]);
check("a cadence the DUE does not match", parsePromise(promise({ CADENCE: "weekly" })).errors, ["DUE and CADENCE disagree"]);
check("the log is not read as fields", parsePromise(promise()).fields.PROOF, "dates-in routines/ran/brief.txt");

// ---- quiet days say nothing ----
check("no promises folder: nothing to say", promiseLines(checkPromises(fs.mkdtempSync(path.join(TMP, "empty-")))), []);
check("kept, due now and not yet due add nothing", promiseLines(checkPromises(mission({
  "a.md": promise(), "b.md": promise({ STARTED: "2026-12-01" }), "c.md": promise({ PROOF: "dates-in other.txt" }),
}, { "routines/ran/brief.txt": "2026-11-10", "other.txt": "2026-11-09" }), { now: new Date("2026-11-10T09:00:00Z") })), []);
check("the fallback drops the promise's own words", promiseSayings({ promises: [{ state: "missed", what: "x", lastKept: "2026-11-01" }], unreadable: [] })[0].fallback,
  "A promise was not kept. Last kept 2026-11-01.");

// ---- it only reads ----
const touched = mission({ "a.md": promise(), "w.md": promise(weekly), "z.md": promise({ DUE: "never" }) }, { "routines/ran/brief.txt": "2026-11-01" });
const old = new Date("2026-01-01T00:00:00Z");
const files = fs.readdirSync(path.join(touched, "work", "promises")).map((n) => path.join(touched, "work", "promises", n));
files.forEach((f) => fs.utimesSync(f, old, old));
const before = files.map((f) => [fs.readFileSync(f, "utf8"), fs.statSync(f).mtimeMs]);
checkPromises(touched, { now: new Date("2026-11-10T19:00:00Z") });
check("no promise file's bytes or time change", files.map((f) => [fs.readFileSync(f, "utf8"), fs.statSync(f).mtimeMs]), before);

// ---- mc-due today: the promise first, and no "nothing to say" after it ----
const DUE = path.join(__dirname, "due.js");
const listed = mission({ "never.md": promise({ STARTED: "2020-01-01", "WHAT YOU GET": "a weekly letter", CADENCE: "weekly", DUE: "monday 09:00 UTC" }) });
const r = spawnSync(process.execPath, [DUE, "--godspeed", listed, "today"], { encoding: "utf8" });
const lines = (r.stdout || "").split("\n").filter(Boolean);
check("mc-due today ran", r.status, 0);
check("mc-due today puts the never-run promise first", lines[0], "A promise has never been kept: a weekly letter. It was first due 2020-01-06.");
check("and says no 'Nothing needs saying today' or 'Nothing with a last day yet'", lines.filter((l) => /^Nothing /.test(l)), []);
const quiet = spawnSync(process.execPath, [DUE, "--godspeed", fs.mkdtempSync(path.join(TMP, "quiet-")), "today"], { encoding: "utf8" });
check("without promises, mc-due today reads as before", (quiet.stdout || "").split("\n")[0], "Nothing with a last day yet.");
const cannot = mission({});
fs.rmSync(path.join(cannot, "work", "promises"), { recursive: true });
fs.writeFileSync(path.join(cannot, "work", "promises"), "a file where the folder should be\n");
check("promises that cannot be checked are said, and the list goes on",
  spawnSync(process.execPath, [DUE, "--godspeed", cannot, "today"], { encoding: "utf8" }).stdout.split("\n")[0], "Your promises could not be checked today.");

console.log(failed ? failed + " of " + count + " checks failed" : "all " + count + " checks pass");
process.exit(failed ? 1 : 0);
