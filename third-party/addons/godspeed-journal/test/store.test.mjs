import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { slugify, taskId, serialize, parse, writeEntry, readEntries } from "../lib/store.mjs";
import { DEFAULTS } from "../lib/settings.mjs";

const S = { ...DEFAULTS, timezone: "Europe/Berlin" };
const mcDir = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), "hj-store-")); fs.writeFileSync(path.join(d, "AGENTS.md"), ""); return d; };

test("slugify folds German and punctuation", () => {
  assert.equal(slugify("Größe prüfen: Ko-fi Seite!"), "groesse-pruefen-ko-fi-seite");
  assert.equal(slugify("x".repeat(80)).length, 40);
  assert.equal(slugify("!!!"), "task");
});

test("taskId uses local start time", () => {
  assert.equal(taskId(new Date("2026-09-22T08:40:00Z"), "Europe/Berlin", "Edit video"), "t-20260922-1040-edit-video");
});

test("serialize and parse round-trip, arrays and multi-line words", () => {
  const e = { at: "2026-09-22T08:40:12.000Z", kind: "start", task: "t-1", title: "A\nB", done_means: ["one", "two, three"], source: "cli", words: "line 1\nline 2" };
  const back = parse(serialize(e));
  assert.equal(back.title, "A B"); assert.deepEqual(back.done_means, ["one", "two, three"]); assert.equal(back.words, "line 1\nline 2");
});

test("writeEntry files by local date and never overwrites", () => {
  const h = mcDir(); const at = new Date("2026-09-22T08:40:12Z");
  const a = writeEntry(h, S, { kind: "note", words: "x" }, at);
  const b = writeEntry(h, S, { kind: "note", words: "y" }, at);
  assert.equal(a.file, "routines/journal/entries/2026/09/22/104012-note-x.md");
  assert.equal(b.file, "routines/journal/entries/2026/09/22/104012-note-y.md");
  const c = writeEntry(h, S, { kind: "note", words: "y" }, at);
  assert.equal(c.file, "routines/journal/entries/2026/09/22/104012-note-y-2.md");
});

test("readEntries returns the last N local days, oldest first", () => {
  const h = mcDir();
  writeEntry(h, S, { kind: "note", words: "old" }, new Date("2026-09-10T08:00:00Z"));
  writeEntry(h, S, { kind: "note", words: "b" }, new Date("2026-09-22T09:00:00Z"));
  writeEntry(h, S, { kind: "note", words: "a" }, new Date("2026-09-21T09:00:00Z"));
  const got = readEntries(h, S, { days: 3, until: new Date("2026-09-22T12:00:00Z") }).map((e) => e.words);
  assert.deepEqual(got, ["a", "b"]);
});
