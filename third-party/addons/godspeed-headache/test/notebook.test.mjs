// The notebook's Headaches tracker as the diary (0.3.0, Mission Control's D-321): one row per
// headache, read and written as the notebook's own record files, the old entry files kept until
// `migrate` has checked every headache and every day.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { findTracker, readItems, decodeRecord, encodeRecord, withNotebookLock } from "../lib/notebook.mjs";
import { localStamp, instantOf, parseMeds, formatMeds, logFromRows } from "../lib/rows.mjs";
import { writeEntry } from "../lib/store.mjs";
import { minutesByDay } from "../lib/report.mjs";

const TZ = "Europe/Berlin";
const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "godspeed-headache.mjs");
function mc({ notebook = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-nb-"));
  fs.writeFileSync(path.join(dir, "AGENTS.md"), "# test\n");
  fs.mkdirSync(path.join(dir, "routines", "headache"), { recursive: true });
  fs.writeFileSync(path.join(dir, "routines", "headache", "settings.json"), JSON.stringify({ timezone: TZ, git_sync: "off" }));
  if (notebook) addNotebook(dir);
  return dir;
}
const addNotebook = (dir) => { fs.mkdirSync(path.join(dir, "notebook"), { recursive: true }); fs.mkdirSync(path.join(dir, ".godspeed"), { recursive: true }); };
const cli = (dir, now, ...args) => spawnSync(process.execPath, [BIN, ...args, "--godspeed", dir], { encoding: "utf8", env: { ...process.env, GODSPEED_NOW: now, GODSPEED_DEVICE: "" } });
const ok = (r) => { assert.equal(r.status, 0, r.stderr); return r; };
const rows = (dir) => readItems(dir, findTracker(dir)).sort((a, b) => String(a.data.when).localeCompare(String(b.data.when)));

test("times are the wall clock of the diary's zone, exact to the millisecond only where they were", () => {
  assert.equal(localStamp("2026-09-28T06:38:34.924Z", TZ), "2026-09-28 08:38:34.924");
  assert.equal(localStamp("2026-10-12T04:30:00.000Z", TZ), "2026-10-12 06:30");
  assert.equal(localStamp("2026-12-01T05:30:07.000Z", TZ), "2026-12-01 06:30:07");
  for (const iso of ["2026-09-28T06:38:34.924Z", "2026-10-12T04:30:00.000Z", "2026-12-01T05:30:07.000Z"]) assert.equal(instantOf(localStamp(iso, TZ), TZ).toISOString(), iso);
  assert.equal(instantOf("2026-10-12T06:30", TZ).toISOString(), "2026-10-12T04:30:00.000Z", "what the notebook's table writes");
  assert.equal(instantOf("2026-10-12T06:30:00+02:00", TZ).toISOString(), "2026-10-12T04:30:00.000Z");
  assert.equal(instantOf("soon", TZ), null);
  // The night the clocks go back: 01:30 to 04:00 is three and a half hours on the clock, four and a half lived.
  const ep = { start: instantOf("2026-10-25 01:30", TZ).toISOString(), end: instantOf("2026-10-25 04:00", TZ).toISOString() };
  assert.deepEqual(minutesByDay(ep, TZ, new Date("2026-10-26T00:00:00Z")), { "2026-10-25": 210 });
});

test("pills are one readable line, with the day when it is not the start's", () => {
  const start = "2026-09-26T20:00:00.000Z"; // 22:00 in Berlin
  const meds = [{ med: "Thomapyrin Intensiv", dose: "2 tablets", taken: "2026-09-26T20:15:00.000Z" }, { med: "Ibuprofen", dose: "", taken: "2026-09-26T23:10:30.500Z" }];
  const text = formatMeds(meds, start, TZ);
  assert.equal(text, "Thomapyrin Intensiv: 2 tablets at 22:15; Ibuprofen at 2026-09-27 01:10:30.500");
  assert.deepEqual(parseMeds(text, new Date(start), TZ), meds);
  assert.deepEqual(parseMeds("Aspirin: 1 tablet at night", new Date(start), TZ), [{ med: "Aspirin", dose: "1 tablet at night", taken: start }]);
});

test("the health talk reads the new Headaches tracker only when there is a health talk", () => {
  const dir = mc(), area = path.join(dir, "coach", "health");
  fs.mkdirSync(area, { recursive: true });
  // An area made for a habit alone has no talk.
  fs.writeFileSync(path.join(area, "area.md"), "AREA: health\nTITLE: Health\nRHYTHM: none\nSTATUS: on\n\n## Preparation\n\nx\n");
  ok(cli(dir, "2026-10-12T04:41:00Z", "start", "--at", "06:30"));
  assert.equal(findTracker(dir).tracker.talk, null);
  const other = mc();
  fs.mkdirSync(path.join(other, "coach", "health"), { recursive: true });
  fs.writeFileSync(path.join(other, "coach", "health", "area.md"), "AREA: health\nTITLE: Health\nRHYTHM: weekly sunday\nTIME: 19:00\nSTARTS: 2026-10-01\nSTATUS: on\n\n## Preparation\n\nx\n");
  ok(cli(other, "2026-10-12T04:41:00Z", "start", "--at", "06:30"));
  assert.equal(findTracker(other).tracker.talk, "health");
});

test("a pill with no time said reads back without one, on its own day, in the headache's row", () => {
  const dir = mc();
  let r = ok(cli(dir, "2026-10-12T04:41:00Z", "start", "--at", "06:30", "--side", "right", "--med", "ibuprofen: 1", "--words", "took one ibuprofen"));
  assert.match(r.stdout, /right; took ibuprofen 1 \(h-20261012-0630\)$/m);
  assert.equal(rows(dir)[0].data.medication, "ibuprofen: 1 (time not given)");
  r = ok(cli(dir, "2026-10-12T04:42:00Z", "set", "--pain", "4"));
  assert.match(r.stdout, /pain 4; right; took ibuprofen 1$/m);
  assert.equal(rows(dir)[0].data.medication, "ibuprofen: 1 (time not given)", "it stays so through the next command");
  // A headache from last night, its pill this morning: the row names the pill's day.
  ok(cli(dir, "2026-10-12T04:50:00Z", "log", "--from", "yesterday 22:00", "--to", "23:30"));
  const late = rows(dir).find((i) => i.data.when.startsWith("2026-10-11"));
  const meds = parseMeds("Aspirin: 1 on 2026-10-12 (time not given)", instantOf(late.data.when, TZ), TZ);
  assert.deepEqual(meds, [{ med: "Aspirin", dose: "1", taken: instantOf("2026-10-12", TZ).toISOString(), untimed: true }]);
  assert.equal(formatMeds(meds, instantOf(late.data.when, TZ).toISOString(), TZ), "Aspirin: 1 on 2026-10-12 (time not given)");
});

test("a row he edited reads as the table says: strongest pain is the strongest", () => {
  const item = (data) => ({ id: "collection-items-x", data });
  const { episodes } = logFromRows([item({ when: "2026-10-01 08:00", end: "2026-10-01T10:00", pain: 3, pain_first: 5, side: "Links", triggers: "neck, Pillow" })], TZ);
  assert.equal(episodes[0].pain_max, 3);
  assert.equal(episodes[0].pain_first, 3, "never more than the strongest");
  assert.equal(episodes[0].minutes, 120);
  assert.equal(episodes[0].side, "left");
  assert.deepEqual(episodes[0].triggers, ["neck", "pillow"]);
  assert.equal(episodes[0].id, "collection-items-x", "a row made by hand is named by its row");
});

test("with a notebook and no diary, the first headache starts the Headaches tracker and every command uses it", () => {
  const dir = mc();
  let r = ok(cli(dir, "2026-09-27T07:10:00Z", "start", "--at", "06:30", "--pain", "3", "--side", "rechts", "--quality", "pochend", "--med", "Thomapyrin Intensiv: 2 tablets", "--taken", "06:45", "--words", "Kopfschmerz rechts"));
  assert.match(r.stdout, /since 06:30.*pain 3; right; pounding; took Thomapyrin Intensiv 2 tablets at 06:45/);
  const tracker = findTracker(dir);
  assert.equal(tracker.name, "Headaches");
  // This mission control has no health talk, so no talk reads the tracker (Mission Control's D-321).
  assert.deepEqual(tracker.tracker, { names: ["Headaches", "Headache", "Kopfschmerzen", "Kopfweh"], cadence: "any", talk: null, specialist: "headache" });
  assert.deepEqual(tracker.field_schema.map((f) => f.key), ["when", "end", "minutes", "pain", "pain_first", "side", "quality", "symptoms", "triggers", "medication", "words", "episode", "kind"]);
  assert.equal(fs.existsSync(path.join(dir, "routines", "headache", "entries")), false, "no entry file is written");
  assert.deepEqual(rows(dir).map((i) => i.data), [{ when: "2026-09-27 06:30", pain: 3, pain_first: 3, side: "right", quality: "pounding", medication: "Thomapyrin Intensiv: 2 tablets at 06:45", words: "Kopfschmerz rechts", episode: "h-20260927-0630", kind: "headache" }]);
  assert.match(fs.readFileSync(rows(dir)[0]._file, "utf8"), /^---\nid: collection-items-[0-9a-f]{8}\ntype: collection item\ntitle: 2026-09-27 06:30\ncollection_id: headaches-/);
  assert.match(ok(cli(dir, "2026-09-27T07:20:00Z", "context")).stdout, /Open headache/);
  assert.match(ok(cli(dir, "2026-09-27T08:00:00Z", "set", "--pain", "5")).stdout, /pain 3 to 5/);
  assert.match(ok(cli(dir, "2026-09-27T08:00:00Z", "end", "--at", "09:30")).stdout, /06:30-09:30, 3 h/);
  assert.equal(rows(dir)[0].data.minutes, 180);
  assert.equal(rows(dir)[0].data.pain, 5);
  assert.notEqual(cli(dir, "2026-09-27T08:00:00Z", "end").status, 0, "nothing open to end");
  assert.match(ok(cli(dir, "2026-09-27T08:05:00Z", "log", "--from", "yesterday 22:00", "--to", "01:15", "--pain", "2")).stdout, /22:00-01:15 \(2026-09-27\), 3 h 15 min/);
  assert.equal(ok(cli(dir, "2026-09-27T08:05:00Z", "context")).stdout, "");
  r = ok(cli(dir, "2026-09-27T08:06:00Z", "daily", "--csv"));
  assert.match(r.stdout, /2026-09-26,120,2,1,0/);
  assert.match(r.stdout, /2026-09-27,255,5,1,1/);
  assert.equal(JSON.parse(ok(cli(dir, "2026-09-27T08:06:00Z", "patterns", "--json")).stdout).episodes, 2);
  // A running notebook is told what changed, and the lock is gone again.
  assert.match(fs.readFileSync(path.join(dir, ".godspeed", "changes.log"), "utf8"), /\tCollections\/Headaches\/2026-09-27 0630\.md\n/);
  assert.equal(fs.existsSync(path.join(dir, ".godspeed", "workspace.lock")), false);
});

test("a pill with no headache going on is a row of its own; a cancel leaves a tombstone", () => {
  const dir = mc();
  ok(cli(dir, "2026-09-27T07:10:30Z", "med", "Thomapyrin Intensiv", "--dose", "1 tablet", "--words", "took one"));
  // No time was said, so the row keeps the day and says the time was not given (0.3.1).
  assert.deepEqual(rows(dir).map((i) => i.data), [{ when: "2026-09-27", medication: "Thomapyrin Intensiv: 1 tablet (time not given)", words: "took one", kind: "pill" }]);
  ok(cli(dir, "2026-09-27T07:11:30Z", "med", "Ibuprofen", "--taken", "now", "--words", "took an ibuprofen just now"));
  assert.equal(rows(dir).find((i) => i.data.medication.startsWith("Ibuprofen")).data.medication, "Ibuprofen at 09:11", "a time said is kept to the minute");
  assert.match(ok(cli(dir, "2026-09-27T07:12:00Z", "daily", "--csv")).stdout, /2026-09-27,0,,0,2/);
  ok(cli(dir, "2026-09-27T07:20:00Z", "start", "--at", "09:00"));
  const id = rows(dir).find((i) => i.data.kind === "headache").id;
  assert.match(ok(cli(dir, "2026-09-27T07:21:00Z", "cancel")).stdout, /^Removed from the log/);
  assert.deepEqual(rows(dir).map((i) => i.data.kind), ["pill", "pill"]);
  const tomb = decodeRecord(fs.readFileSync(path.join(dir, "notebook", "_system", "collection_items", id + ".md"), "utf8"));
  assert.ok(tomb.removed_at);
  assert.equal(tomb.revision, 2);
});

test("an edit made in the notebook's table is what the next command reads, and his own columns stay", () => {
  const dir = mc();
  ok(cli(dir, "2026-09-27T07:10:00Z", "log", "--from", "06:30", "--to", "08:00", "--pain", "2", "--side", "right"));
  const [row] = rows(dir), { _file, ...record } = row;
  // What the notebook writes when he changes the row in its table.
  fs.writeFileSync(_file, encodeRecord({ ...record, data: { ...record.data, end: "2026-09-27T10:00", pain: 4, side: "Links", weather: "rain" }, revision: 2 }));
  const [ep] = JSON.parse(ok(cli(dir, "2026-09-27T09:00:00Z", "list", "--json")).stdout);
  assert.equal(ep.minutes, 210);
  assert.equal(ep.pain_max, 4);
  assert.equal(ep.side, "left");
  assert.match(ok(cli(dir, "2026-09-27T09:00:00Z", "daily", "--csv")).stdout, /2026-09-27,210,4,1,0/);
  ok(cli(dir, "2026-09-27T09:00:00Z", "set", "--episode", ep.id, "--quality", "pochend"));
  const [after] = rows(dir);
  assert.equal(after.data.end, "2026-09-27 10:00");
  assert.equal(after.data.minutes, 210, "the minutes follow his end");
  assert.equal(after.data.weather, "rain", "a column he added is kept");
  assert.equal(after.data.quality, "pounding");
  assert.equal(after.revision, 3);
});

test("the notebook's writer lock is waited for, and a dead writer's lock is taken over", () => {
  const dir = mc(), lock = path.join(dir, ".godspeed", "workspace.lock");
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, thread: 0, token: "theirs", at: new Date().toISOString() }));
  assert.throws(() => withNotebookLock(dir, () => "ran", { timeoutMs: 200 }), /busy writing/);
  const gone = spawnSync(process.execPath, ["-e", "console.log(process.pid)"], { encoding: "utf8" }).stdout.trim();
  fs.writeFileSync(lock, JSON.stringify({ pid: Number(gone), thread: 0, token: "dead", at: new Date().toISOString() }));
  assert.equal(withNotebookLock(dir, () => "ran", { timeoutMs: 2000 }), "ran");
  assert.equal(fs.existsSync(lock), false);
});

// A history like his: a headache over midnight, a pain given twice, a pill on the next day, a
// pill with no headache, one cancelled, one still going.
function history(dir) {
  ok(cli(dir, "2026-09-27T08:05:00Z", "log", "--from", "yesterday 22:00", "--to", "01:15", "--pain", "2", "--med", "Ibuprofen: 400 mg", "--taken", "00:30", "--words", "Kopfweh die ganze Nacht"));
  ok(cli(dir, "2026-09-28T06:38:34.924Z", "start", "--pain", "3", "--side", "whole", "--trigger", "slept badly", "--med", "Thomapyrin: 1 tablet", "--words", "mild one"));
  ok(cli(dir, "2026-09-28T08:00:00Z", "set", "--pain", "5", "--symptom", "nausea"));
  ok(cli(dir, "2026-09-28T10:27:00Z", "end", "--words", "vorbei"));
  ok(cli(dir, "2026-09-29T07:00:00Z", "med", "Thomapyrin Intensiv", "--dose", "2 tablets", "--words", "just in case"));
  ok(cli(dir, "2026-09-30T07:00:00Z", "start", "--at", "08:00"));
  ok(cli(dir, "2026-09-30T07:01:00Z", "cancel"));
  ok(cli(dir, "2026-10-01T06:00:00Z", "start", "--at", "07:30", "--pain", "1"));
}

test("the entry files stay the diary until migrate, which checks every headache and day, then puts them away", () => {
  const dir = mc({ notebook: false });
  history(dir);
  addNotebook(dir);
  const now = "2026-10-01T07:00:00Z";
  const before = { daily: ok(cli(dir, now, "daily", "--csv")).stdout, list: JSON.parse(ok(cli(dir, now, "list", "--days", "3650", "--json")).stdout), patterns: JSON.parse(ok(cli(dir, now, "patterns", "--json")).stdout) };
  ok(cli(dir, "2026-10-01T06:59:00Z", "set", "--words", "still the old diary"));
  assert.equal(findTracker(dir), null, "an old diary keeps being used");
  const dry = JSON.parse(ok(cli(dir, now, "migrate", "--dry-run", "--json")).stdout);
  assert.equal(dry.ok, true); assert.equal(dry.same, true);
  assert.equal(findTracker(dir), null, "a dry run writes nothing");
  const r = JSON.parse(ok(cli(dir, now, "migrate", "--json")).stdout);
  assert.equal(r.ok, true);
  assert.deepEqual(r.moved, { headaches: 3, pills: 1 });
  assert.equal(r.episodes.length, 3); assert.ok(r.episodes.every((e) => e.same));
  assert.ok(r.days.length >= 4); assert.ok(r.days.every((d) => d.same));
  assert.deepEqual(r.days.find((d) => d.date === "2026-09-27").after, { headache_episodes: 0, headache_min: 75, headache_max_pain: 2, painkiller_doses: 1 });
  assert.equal(r.archive, "archives/2026-10-01-headache-diary");
  assert.ok(fs.statSync(path.join(dir, r.archive, "entries")).isDirectory());
  assert.ok(fs.statSync(path.join(dir, "routines", "headache", "entries")).isFile(), "the guard");
  assert.match(fs.readFileSync(path.join(dir, "routines", "headache", "README.md"), "utf8"), /Headaches tracker/);
  // Every reader gives what it gave before.
  assert.equal(ok(cli(dir, now, "daily", "--csv")).stdout, before.daily);
  const strip = (eps) => eps.map(({ item, pains, cancelled, end_pain, ...e }) => ({ ...e, words: e.words.join("\n") }));
  assert.deepEqual(strip(JSON.parse(ok(cli(dir, now, "list", "--days", "3650", "--json")).stdout)), strip(before.list).map((e) => e.id === "h-20261001-0730" ? { ...e, words: "still the old diary" } : e));
  assert.deepEqual(JSON.parse(ok(cli(dir, now, "patterns", "--json")).stdout), before.patterns);
  assert.match(fs.readFileSync(path.join(dir, r.archive, "MOVED.md"), "utf8"), /checked/);
  // An older godspeed-headache, which writes entry files, stops at the guard and saves nothing.
  assert.throws(() => writeEntry(dir, { timezone: TZ }, { kind: "start", episode: "h-x", start: now }, new Date(now)));
  assert.match(JSON.parse(cli(dir, now, "migrate", "--json").stdout).reason, /Nothing to move/);
  // And the next headache goes into the tracker.
  ok(cli(dir, "2026-10-01T07:05:00Z", "end"));
  assert.equal(rows(dir).find((i) => i.data.episode === "h-20261001-0730").data.end, "2026-10-01 09:05");
});

test("migrate takes its rows away again when a value would not survive, and the old diary stays", () => {
  const dir = mc({ notebook: false });
  ok(cli(dir, "2026-09-27T08:05:00Z", "log", "--from", "06:00", "--to", "07:00", "--trigger", "neck pain, bad pillow"));
  addNotebook(dir);
  const r = JSON.parse(cli(dir, "2026-09-27T09:00:00Z", "migrate", "--json").stdout);
  assert.equal(r.ok, false);
  assert.deepEqual(r.episodes[0].differences.map((d) => d.field), ["triggers"]);
  assert.equal(findTracker(dir), null);
  assert.deepEqual(fs.readdirSync(path.join(dir, "notebook", "Collections")).filter((n) => !fs.statSync(path.join(dir, "notebook", "Collections", n)).isDirectory()), []);
  assert.ok(fs.statSync(path.join(dir, "routines", "headache", "entries")).isDirectory());
});

// One listener owns "track" (D-321): the tracker recipe takes a message that starts with it and
// hands a headache here, so this recipe no longer names "track headache ..." among its triggers.
test("the recipe no longer claims messages that start with track", () => {
  const text = fs.readFileSync(path.join(path.dirname(BIN), "..", "skill", "headache-tracker", "SKILL.md"), "utf8").replace(/\r/g, "");
  const description = text.match(/^description: (.*)$/m)[1];
  assert.doesNotMatch(description, /"track /i);
  assert.match(description, /"headache since 6:30, right side, pounding, took two Thomapyrin"/);
  assert.match(text, /reaches you\nthrough the tracker recipe/);
  assert.match(text, /Headaches tracker/);
  assert.doesNotMatch(text, /Logged by mistake/);
});
