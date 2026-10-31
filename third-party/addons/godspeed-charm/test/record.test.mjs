import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendEvent, readEvents, localDate } from "../lib/record.mjs";
import { loadSettings, saveSettings, settingsFile, setSetting } from "../lib/settings.mjs";
import { findTracker, readItems } from "../lib/notebook.mjs";
import { now } from "../lib/clock.mjs";

function mission() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "charm-record-"));
  fs.writeFileSync(path.join(dir, "AGENTS.md"), "# test\n");
  fs.mkdirSync(path.join(dir, "notebook"));
  fs.mkdirSync(path.join(dir, ".godspeed"));
  return dir;
}
const collections = (dir) => { try { return fs.readdirSync(path.join(dir, "notebook", "Collections")).filter((n) => n.endsWith(".md")); } catch { return []; } };
const gone = (dir) => fs.rmSync(dir, { recursive: true, force: true });

test("the first event creates exactly one charm tracker and one row", () => {
  const dir = mission();
  const e = appendEvent(dir, { kind: "start", when: "2026-10-21T08:00:00Z" });
  assert.deepEqual(e, { kind: "start", when: "2026-10-21T08:00:00Z", date: "2026-10-21" });
  assert.equal(collections(dir).length, 1);
  const tracker = findTracker(dir);
  assert.equal(tracker.tracker.specialist, "charm");
  assert.equal(tracker.tracker.talk, null);
  assert.equal(tracker.name, "Charm Challenge");
  assert.equal(readItems(dir, tracker).length, 1);
  assert.deepEqual(readEvents(dir), [e]);
  appendEvent(dir, { kind: "reset", when: "2026-10-22T08:00:00Z", words: "I slipped" });
  assert.equal(collections(dir).length, 1);
  assert.equal(readItems(dir, findTracker(dir)).length, 2);
  gone(dir);
});

test("row title and schema", () => {
  const dir = mission();
  appendEvent(dir, { kind: "reset", when: "2026-10-22T08:00:00Z" });
  const [item] = readItems(dir, findTracker(dir));
  assert.equal(item.title, "Reset 2026-10-22");
  assert.deepEqual(findTracker(dir).field_schema.map((f) => f.key), ["when", "kind", "date", "words", "conversation", "at"]);
  assert.deepEqual(findTracker(dir).field_schema.filter((f) => f.primary).map((f) => f.key), ["when"]);
  gone(dir);
});

// The record page (the collection's own page, "See the record" on the card) names each row by its
// primary field, `when`. Until 21 October 2026 that was the exact UTC moment, so every row read
// "2026-10-12T08:00:00.000Z". Now `when` is the person's own clock, as the headache's rows are, and
// the exact moment is kept beside it in `at`, so events within one minute still read in order.
test("a row reads as the time on the person's clock; the exact moment keeps the order", () => {
  const dir = mission();
  saveSettings(dir, { version: 1, timezone: "Europe/Berlin", language: "en" });
  const e = appendEvent(dir, { kind: "reset", when: "2026-10-12T08:00:40.412Z", words: "yes" });
  appendEvent(dir, { kind: "asked", when: "2026-10-12T08:00:05.000Z", words: "garbage", conversation: "c1" });
  assert.deepEqual(e, { kind: "reset", when: "2026-10-12T08:00:40.412Z", date: "2026-10-12", words: "yes" });
  const rows = readItems(dir, findTracker(dir)).map((i) => i.data).sort((a, b) => a.at.localeCompare(b.at));
  assert.deepEqual(rows.map((d) => [d.kind, d.when, d.at, d.date]), [
    ["asked", "2026-10-12 10:00", "2026-10-12T08:00:05.000Z", "2026-10-12"],
    ["reset", "2026-10-12 10:00", "2026-10-12T08:00:40.412Z", "2026-10-12"],
  ]);
  const events = readEvents(dir);
  assert.deepEqual(events.map((x) => [x.kind, x.when]), [["asked", "2026-10-12T08:00:05.000Z"], ["reset", "2026-10-12T08:00:40.412Z"]]);
  // Late in the evening in Berlin is already the next day in the title, as on the person's clock.
  appendEvent(dir, { kind: "kept", when: "2026-10-12T22:30:00.000Z", conversation: "c1" });
  assert.ok(readItems(dir, findTracker(dir)).some((i) => i.data.when === "2026-10-13 00:30" && i.data.date === "2026-10-13"));
  gone(dir);
});

test("rows from before keep reading, and a time changed in the notebook counts", async () => {
  const { eventsFromItems } = await import("../lib/record.mjs");
  const berlin = "Europe/Berlin";
  // Written before 21 October 2026: `when` is the exact moment itself.
  assert.deepEqual(eventsFromItems([{ data: { kind: "start", when: "2026-10-21T08:00:00Z", date: "2026-10-21" } }], berlin), [{ kind: "start", when: "2026-10-21T08:00:00Z", date: "2026-10-21" }]);
  // `at` agrees with `when` to the minute: the exact moment.
  const at = "2026-10-12T08:00:40.412Z";
  assert.equal(eventsFromItems([{ data: { kind: "reset", when: "2026-10-12 10:00", at, date: "2026-10-12" } }], berlin)[0].when, at);
  // He changed the time in the notebook (its editor writes "2026-10-12T09:15"): his time counts.
  for (const when of ["2026-10-12 09:15", "2026-10-12T09:15"]) assert.equal(eventsFromItems([{ data: { kind: "reset", when, at, date: "2026-10-12" } }], berlin)[0].when, "2026-10-12T07:15:00.000Z", when);
  // A row he added by hand, with no exact moment: his time, on his clock.
  assert.equal(eventsFromItems([{ data: { kind: "kept", when: "2026-10-12 23:30" } }], berlin)[0].when, "2026-10-12T21:30:00.000Z");
  assert.equal(eventsFromItems([{ data: { kind: "kept", when: "2026-10-12 23:30" } }], berlin)[0].date, "2026-10-12");
  // Old and new rows together still read in time order.
  const mixed = eventsFromItems([
    { data: { kind: "reset", when: "2026-10-12 10:00", at, date: "2026-10-12" } },
    { data: { kind: "start", when: "2026-10-03T08:00:00Z", date: "2026-10-03" } },
    { data: { kind: "asked", when: "2026-10-12 09:59", at: "2026-10-12T07:59:59.000Z", date: "2026-10-12" } },
  ], berlin);
  assert.deepEqual(mixed.map((x) => x.kind), ["start", "asked", "reset"]);
  // Nothing readable as a time is skipped, as before.
  assert.deepEqual(eventsFromItems([{ data: { kind: "start", when: "soon" } }, { data: { kind: "start", when: "2026-10-12 25:00" } }], berlin), []);
});

test("the day is the local day in the settings timezone", () => {
  const dir = mission();
  saveSettings(dir, { version: 1, timezone: "Europe/Berlin", language: "en" });
  const e = appendEvent(dir, { kind: "reset", when: "2026-10-24T22:30:00Z" });
  assert.equal(e.date, "2026-10-25");
  assert.equal(readEvents(dir)[0].date, "2026-10-25");
  assert.equal(localDate(new Date("2026-10-24T22:30:00Z"), "UTC"), "2026-10-24");
  gone(dir);
});

test("events come back sorted by when, with words and conversation", () => {
  const dir = mission();
  appendEvent(dir, { kind: "reset", when: "2026-10-23T08:00:00Z" });
  appendEvent(dir, { kind: "asked", when: "2026-10-22T08:00:00Z", words: "oops", conversation: "c1" });
  appendEvent(dir, { kind: "start", when: "2026-10-21T08:00:00Z" });
  const events = readEvents(dir);
  assert.deepEqual(events.map((e) => e.kind), ["start", "asked", "reset"]);
  assert.equal(events[1].words, "oops");
  assert.equal(events[1].conversation, "c1");
  gone(dir);
});

test("no tracker gives an empty list; unreadable rows are skipped, not thrown", () => {
  const dir = mission();
  assert.deepEqual(readEvents(dir), []);
  appendEvent(dir, { kind: "start", when: "2026-10-21T08:00:00Z" });
  const [item] = readItems(dir, findTracker(dir));
  const folder = path.dirname(item._file);
  fs.writeFileSync(path.join(folder, "broken.md"), "---\nthis: [is not\n---\n");
  fs.writeFileSync(path.join(folder, "garbage.md"), "no front matter at all");
  // A row that parses but whose data lacks a kind.
  const text = fs.readFileSync(item._file, "utf8");
  const noKind = text.replace(/uid: .*/, "uid: empty-uid").replace(/^id: .*/m, "id: collection-items-empty").replace(/kind: start/, "kind: ''");
  assert.notEqual(noKind, text);
  fs.writeFileSync(path.join(folder, "empty.md"), noKind);
  const events = readEvents(dir);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "start");
  gone(dir);
});

test("settings: missing file gives defaults, a corrupt file throws", () => {
  const dir = mission();
  assert.deepEqual(loadSettings(dir), { version: 1, timezone: "UTC", language: "en" });
  fs.mkdirSync(path.dirname(settingsFile(dir)), { recursive: true });
  fs.writeFileSync(settingsFile(dir), "{ not json");
  assert.throws(() => loadSettings(dir), /not valid JSON/);
  assert.throws(() => appendEvent(dir, { kind: "start", when: "2026-10-21T08:00:00Z" }), /not valid JSON/);
  assert.equal(collections(dir).length, 0);
  fs.writeFileSync(settingsFile(dir), "[]");
  assert.throws(() => loadSettings(dir), /one JSON object/);
  gone(dir);
});

test("setSetting changes timezone and language only, and validates", () => {
  const dir = mission();
  assert.equal(setSetting(dir, "timezone", "Europe/Berlin").timezone, "Europe/Berlin");
  assert.equal(setSetting(dir, "language", "de").language, "de");
  assert.deepEqual(loadSettings(dir), { version: 1, timezone: "Europe/Berlin", language: "de" });
  assert.throws(() => setSetting(dir, "language", "fr"), /en or de/);
  assert.throws(() => setSetting(dir, "timezone", "Mars/Base"), /time zone/);
  assert.throws(() => setSetting(dir, "version", "2"), /no setting/);
  gone(dir);
});

test("clock: GODSPEED_CHARM_NOW wins over GODSPEED_NOW, then real time", () => {
  const keep = { c: process.env.GODSPEED_CHARM_NOW, n: process.env.GODSPEED_NOW };
  try {
    delete process.env.GODSPEED_CHARM_NOW; delete process.env.GODSPEED_NOW;
    assert.ok(Math.abs(now().getTime() - Date.now()) < 5000);
    process.env.GODSPEED_NOW = "2026-01-02T03:04:05Z";
    assert.equal(now().toISOString(), "2026-01-02T03:04:05.000Z");
    process.env.GODSPEED_CHARM_NOW = "2026-05-06T07:08:09Z";
    assert.equal(now().toISOString(), "2026-05-06T07:08:09.000Z");
  } finally {
    if (keep.c === undefined) delete process.env.GODSPEED_CHARM_NOW; else process.env.GODSPEED_CHARM_NOW = keep.c;
    if (keep.n === undefined) delete process.env.GODSPEED_NOW; else process.env.GODSPEED_NOW = keep.n;
  }
});

test("saveSettings writes through a temporary file and leaves none behind", () => {
  const dir = mission();
  saveSettings(dir, { version: 1, timezone: "Europe/Berlin", language: "de" });
  saveSettings(dir, { version: 1, timezone: "Europe/Berlin", language: "en" });
  assert.deepEqual(loadSettings(dir), { version: 1, timezone: "Europe/Berlin", language: "en" });
  assert.deepEqual(fs.readdirSync(path.dirname(settingsFile(dir))), ["settings.json"]);
  const src = fs.readFileSync(new URL("../lib/settings.mjs", import.meta.url), "utf8");
  assert.match(src, /renameSync|atomic/);
  gone(dir);
});

test("appendEvent gives up on a busy notebook after lockTimeoutMs, writing nothing", () => {
  const dir = mission();
  const lock = path.join(dir, ".godspeed", "workspace.lock");
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, thread: 0, token: "held", at: new Date().toISOString() }));
  const started = Date.now();
  assert.throws(() => appendEvent(dir, { kind: "start", when: "2026-10-21T08:00:00Z" }, new Date(), { lockTimeoutMs: 300 }), /busy/);
  assert.ok(Date.now() - started < 3000);
  assert.equal(collections(dir).length, 0);
  fs.rmSync(lock);
  appendEvent(dir, { kind: "start", when: "2026-10-21T08:00:00Z" }, new Date(), { lockTimeoutMs: 300 });
  assert.equal(readEvents(dir).length, 1);
  gone(dir);
});

// The notebook reads the same rows through its own records (chat-context.mjs): the same events,
// in the same order, from the items it already holds.
test("eventsFromItems reads rows the way readEvents does", async () => {
  const { eventsFromItems } = await import("../lib/record.mjs");
  const dir = mission();
  appendEvent(dir, { kind: "start", when: "2026-10-21T08:00:00Z" });
  appendEvent(dir, { kind: "asked", when: "2026-10-22T08:00:00Z", words: "garbage", conversation: "notebook:c1" });
  const items = readItems(dir, findTracker(dir)).reverse();
  assert.deepEqual(eventsFromItems(items), readEvents(dir));
  assert.deepEqual(eventsFromItems([{ data: null }, { data: { kind: "start" } }, {}]), []);
  gone(dir);
});
