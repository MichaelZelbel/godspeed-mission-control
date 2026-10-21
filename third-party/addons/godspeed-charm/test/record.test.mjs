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
  assert.deepEqual(findTracker(dir).field_schema.map((f) => f.key), ["when", "kind", "date", "words", "conversation"]);
  gone(dir);
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
