import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "godspeed-journal.mjs");
function mcDir() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hj-cli-")); fs.writeFileSync(path.join(d, "AGENTS.md"), "");
  fs.mkdirSync(path.join(d, "routines", "journal"), { recursive: true });
  fs.writeFileSync(path.join(d, "routines", "journal", "settings.json"), JSON.stringify({ timezone: "Europe/Berlin", git_sync: "off", nudge: { enabled: true } }));
  return d;
}
const run = (h, now, ...a) => spawnSync(process.execPath, [BIN, ...a, "--godspeed", h], { encoding: "utf8", env: { ...process.env, GODSPEED_NOW: now } });

test("start, define, done round trip with the definition handed back", () => {
  const h = mcDir();
  const s = run(h, "2026-09-22T08:40:00Z", "start", "Edit video", "--done-means", "thumbnail", "--words", "starting the video", "--json");
  assert.equal(s.status, 0, s.stderr);
  const id = JSON.parse(s.stdout).task.id; assert.equal(id, "t-20260922-1040-edit-video");
  run(h, "2026-09-22T09:00:00Z", "define", "--done-means", "description");
  const d = JSON.parse(run(h, "2026-09-22T11:00:00Z", "done", "video", "--met", "thumbnail", "--missed", "description", "--json").stdout);
  assert.deepEqual(d.task.done_means, ["thumbnail", "description"]); assert.equal(d.task.state, "done");
  assert.equal(JSON.parse(run(h, "2026-09-22T11:01:00Z", "open", "--json").stdout).length, 0);
});

test("done with no open task is a sentence and exit 1", () => {
  const r = run(mcDir(), "2026-09-22T08:40:00Z", "done");
  assert.equal(r.status, 1); assert.match(r.stderr, /No open task/);
});

test("tick prints the nudge once and writes the record", () => {
  const h = mcDir();
  run(h, "2026-09-22T08:40:00Z", "start", "Edit video");
  assert.equal(run(h, "2026-09-22T09:00:00Z", "tick").stdout, "");
  assert.match(run(h, "2026-09-22T11:45:00Z", "tick").stdout, /^From your journal: today at 10:40 you started "Edit video"\./);
  assert.equal(run(h, "2026-09-22T11:50:00Z", "tick").stdout, "");
});

test("context and tick never fail, even with no mission control folder", () => {
  const r = spawnSync(process.execPath, [BIN, "context", "--godspeed", os.tmpdir()], { encoding: "utf8" });
  assert.equal(r.status, 0); assert.equal(r.stdout, "");
  const t = spawnSync(process.execPath, [BIN, "tick", "--godspeed", os.tmpdir()], { encoding: "utf8" });
  assert.equal(t.status, 0); assert.equal(t.stdout, "");
});

test("a flag with no value dies instead of writing null to disk", () => {
  const h = mcDir();
  const r = run(h, "2026-09-22T08:40:00Z", "start", "X", "--done-means");
  assert.equal(r.status, 1); assert.match(r.stderr, /--done-means needs a value/);
  const entriesDir = path.join(h, "routines", "journal", "entries");
  const days = fs.existsSync(entriesDir) ? fs.readdirSync(entriesDir).flatMap((y) => fs.readdirSync(path.join(entriesDir, y))) : [];
  assert.equal(days.length, 0);
});

test("config get with no key is a sentence and exit 1", () => {
  const r = run(mcDir(), "2026-09-22T08:00:00Z", "config", "get");
  assert.equal(r.status, 1); assert.match(r.stderr, /config get <key>/);
});

test("day <date> reaches outside the fixed recent window, and a word instead of a date dies", () => {
  const h = mcDir();
  run(h, "2026-09-01T08:40:00Z", "start", "Old task");
  const r = run(h, "2026-09-22T08:00:00Z", "day", "2026-09-01");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Old task: open/);

  const y = run(h, "2026-09-22T08:00:00Z", "day", "yesterday");
  assert.equal(y.status, 1);
  assert.match(y.stderr, /Give the day as YYYY-MM-DD, for example 2026-09-22\./);
});

test("done with an ambiguous word dies naming both matches", () => {
  const h = mcDir();
  run(h, "2026-09-22T08:00:00Z", "start", "Edit video A");
  run(h, "2026-09-22T08:05:00Z", "start", "Edit video B");
  const r = run(h, "2026-09-22T08:10:00Z", "done", "video");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Several open tasks match "video": Edit video A \/ Edit video B\. Say which one\./);
});

test("an unrecognised GODSPEED_JOURNAL_GIT_SYNC value is ignored, with one warning, and settings still apply", () => {
  const h = mcDir();
  fs.writeFileSync(path.join(h, "routines", "journal", "settings.json"), JSON.stringify({ timezone: "Europe/Berlin", git_sync: "off" }));
  const r = spawnSync(process.execPath, [BIN, "note", "still on it", "--godspeed", h], {
    encoding: "utf8", env: { ...process.env, GODSPEED_NOW: "2026-09-22T08:40:00Z", GODSPEED_JOURNAL_GIT_SYNC: "comit" },
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stderr, /GODSPEED_JOURNAL_GIT_SYNC is "comit", expected auto, commit or off; using settings\./);
});

test("config set and show", () => {
  const h = mcDir();
  assert.equal(run(h, "2026-09-22T08:00:00Z", "config", "set", "length", "long").status, 0);
  assert.match(run(h, "2026-09-22T08:00:00Z", "config", "get", "length").stdout.trim(), /^long$/);
  const bad = run(h, "2026-09-22T08:00:00Z", "config", "set", "feedback", "loud");
  assert.equal(bad.status, 1); assert.match(bad.stderr, /off, check or coach/);
});

test("met settles one item a finish left out, by the words the person used, and refuses one it was not", () => {
  const h = mcDir();
  run(h, "2026-09-29T15:20:00Z", "start", "Chimney cleaner letter", "--done-means", "letter signed", "--done-means", "letter scanned");
  run(h, "2026-09-29T16:17:00Z", "done", "chimney", "--missed", "letter signed", "--missed", "letter scanned", "--words", "okay, that took longer");
  const wrong = run(h, "2026-09-29T19:00:00Z", "met", "chimney", "--met", "envelope posted");
  assert.equal(wrong.status, 1); assert.match(wrong.stderr, /finished without: letter signed; letter scanned/);
  const ok = run(h, "2026-09-29T19:00:00Z", "met", "--met", "signed", "--words", "the letter's signed now", "--json");
  assert.equal(ok.status, 0, ok.stderr);
  const t = JSON.parse(ok.stdout).task;
  assert.deepEqual(t.missed, ["letter scanned"]); assert.ok(t.met.includes("letter signed"));
  assert.match(run(h, "2026-09-29T19:01:00Z", "day", "2026-09-29").stdout, /Chimney cleaner letter: done, 57 min, missed: letter scanned/);
});

test("a start and its done at the same instant close the task, whatever the file names sort as", () => {
  const h = mcDir();
  run(h, "2026-09-22T08:40:00.000Z", "start", "Chimney cleaner letter", "--done-means", "letter signed");
  run(h, "2026-09-22T08:40:00.000Z", "done", "chimney", "--missed", "letter signed");
  assert.equal(JSON.parse(run(h, "2026-09-22T08:45:00Z", "open", "--json").stdout).length, 0);
  assert.match(run(h, "2026-09-22T08:45:00Z", "context").stdout, /Finished without/);
});

test("words prints what was said, day by day, and refuses a silly window", () => {
  const h = mcDir();
  run(h, "2026-09-29T14:07:00Z", "note", "Since the morning I have been putting out fires.");
  run(h, "2026-09-29T15:20:00Z", "start", "Letter", "--words", "Now the letter, finally.");
  const r = run(h, "2026-09-30T08:00:00Z", "words");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Tue 2026-09-29\n16:07 note: Since the morning/);
  assert.match(r.stdout, /17:20 start "Letter": Now the letter, finally\./);
  assert.equal(run(h, "2026-09-30T08:00:00Z", "words", "--days", "90").status, 1);
  assert.match(run(h, "2026-10-12T08:00:00Z", "words").stdout, /Nothing said/);
});
