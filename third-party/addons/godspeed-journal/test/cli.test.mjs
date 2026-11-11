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

test("paused capture saves nothing and asks nothing until it is switched back on", () => {
  const h = mcDir();
  run(h, "2026-09-22T08:40:00Z", "start", "Edit video");
  assert.match(run(h, "2026-09-22T08:41:00Z", "config", "set", "capture_enabled", "off").stdout, /capture_enabled = off/);
  const files = () => fs.readdirSync(path.join(h, "routines", "journal", "entries"), { recursive: true }).filter((f) => f.endsWith(".md")).length;
  const before = files();
  const r = run(h, "2026-09-22T08:42:00Z", "note", "this must not be saved");
  assert.equal(r.status, 1); assert.match(r.stderr, /capture is paused/);
  assert.equal(files(), before);
  assert.equal(run(h, "2026-09-22T11:45:00Z", "tick").stdout, "");
  assert.match(run(h, "2026-09-22T11:46:00Z", "context").stdout, /Journal capture is paused/);
  run(h, "2026-09-22T11:47:00Z", "config", "set", "capture_enabled", "on");
  assert.equal(run(h, "2026-09-22T11:48:00Z", "note", "back again").status, 0);
  assert.equal(files(), before + 1);
});

const entryFiles = (h) => {
  const root = path.join(h, "routines", "journal", "entries");
  return fs.existsSync(root) ? fs.readdirSync(root, { recursive: true }).filter((f) => f.endsWith(".md")).map((f) => [f.replaceAll("\\", "/"), fs.readFileSync(path.join(root, f), "utf8")]) : [];
};

test("an entry without a time word is saved as now, exactly as before", () => {
  const h = mcDir();
  const r = run(h, "2026-11-11T09:30:00.000Z", "start", "Edit video");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, 'Saved: start "Edit video" (t-20261111-1030-edit-video)\n');
  const [[file, text]] = entryFiles(h);
  assert.match(file, /^2026\/11\/11\/103000-start-edit-video\.md$/);
  assert.match(text, /^---\nat: 2026-11-11T09:30:00\.000Z\nkind: start\n/);
  assert.doesNotMatch(text, /written:/);
});

test("several moves told late each get their own time, in the order told", () => {
  const h = mcDir();
  run(h, "2026-11-11T07:00:00Z", "start", "Weekly plan");
  // "I finished the weekly plan an hour ago, then had breakfast, and breakfast is done now."
  const done = run(h, "2026-11-11T10:00:00Z", "done", "weekly plan", "--when", "an hour ago");
  assert.equal(done.status, 0, done.stderr);
  assert.equal(done.stdout, 'Saved: done "Weekly plan", today at 10:00\n');
  assert.equal(run(h, "2026-11-11T10:00:00Z", "start", "Breakfast", "--when", "an hour ago").status, 0);
  assert.equal(run(h, "2026-11-11T10:00:00Z", "done", "breakfast").status, 0);
  const day = JSON.parse(run(h, "2026-11-11T10:01:00Z", "day", "--json").stdout);
  const plan = day.tasks.find((t) => t.title === "Weekly plan"), breakfast = day.tasks.find((t) => t.title === "Breakfast");
  assert.deepEqual([plan.ended, plan.minutes], ["2026-11-11T09:00:00.000Z", 120]);
  assert.deepEqual([breakfast.started, breakfast.ended, breakfast.minutes], ["2026-11-11T09:00:00.000Z", "2026-11-11T10:00:00.000Z", 60]);
  const backdated = entryFiles(h).filter(([, t]) => t.includes("at: 2026-11-11T09:00:00.000Z"));
  assert.equal(backdated.length, 2);
  for (const [, t] of backdated) assert.match(t, /\nwritten: 2026-11-11T10:00:00\.000Z\n/);
});

test("a whole task told after the fact with a span is saved as its start and its finish", () => {
  const h = mcDir();
  const r = run(h, "2026-11-11T14:00:00Z", "start", "Report", "--when", "from 9 to 10:30", "--met", "sent", "--json");
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(JSON.parse(r.stdout).recorded, { start: "2026-11-11T08:00:00.000Z", end: "2026-11-11T09:30:00.000Z", said: "today at 09:00 - today at 10:30" });
  assert.deepEqual(JSON.parse(run(h, "2026-11-11T14:01:00Z", "open", "--json").stdout), []);
  const [t] = JSON.parse(run(h, "2026-11-11T14:01:00Z", "day", "--json").stdout).tasks;
  assert.deepEqual([t.id, t.state, t.started, t.ended, t.minutes], ["t-20261111-0900-report", "done", "2026-11-11T08:00:00.000Z", "2026-11-11T09:30:00.000Z", 90]);
});

test("a finish before its start, a time still ahead, or a time that fits two asks once and saves nothing", () => {
  const h = mcDir();
  run(h, "2026-11-11T10:00:00Z", "start", "Invoice");
  const before = run(h, "2026-11-11T10:30:00Z", "done", "--when", "an hour ago");
  assert.equal(before.status, 2);
  assert.equal(before.stderr, 'Nothing was saved. Ask them: That is before "Invoice" started (today at 11:00). When did you finish it?\n');
  assert.equal(JSON.parse(run(h, "2026-11-11T10:31:00Z", "open", "--json").stdout).length, 1);

  const future = run(h, "2026-11-11T14:00:00Z", "note", "x", "--when", "at 23:00", "--json");
  assert.equal(future.status, 2);
  assert.deepEqual(JSON.parse(future.stdout), { ok: false, ask: "Today at 23:00 is still ahead. When did it happen?" });

  const which = run(h, "2026-11-11T21:00:00Z", "start", "Run", "--when", "at 9");
  assert.equal(which.status, 2);
  assert.match(which.stderr, /^Nothing was saved\. Ask them: Did you mean today at 09:00 or today at 21:00\?\n$/);
  assert.equal(entryFiles(h).length, 1);
});

test("a start backdated to yesterday is filed on that day and is still open", () => {
  const h = mcDir();
  const r = run(h, "2026-11-11T08:00:00Z", "start", "Taxes", "--when", "gestern Nachmittag");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /, yesterday at 15:00\n$/);
  assert.match(entryFiles(h)[0][0], /^2026\/11\/10\/150000-start-taxes\.md$/);
  assert.deepEqual(JSON.parse(run(h, "2026-11-11T08:01:00Z", "open", "--json").stdout).map((t) => t.started), ["2026-11-10T14:00:00.000Z"]);
});

test("an item settled before its finish asks, and a span on a finish is refused, both saving nothing", () => {
  const h = mcDir();
  run(h, "2026-11-11T08:00:00Z", "start", "Letter", "--done-means", "letter signed");
  run(h, "2026-11-11T10:00:00Z", "done", "letter", "--missed", "letter signed");
  const early = run(h, "2026-11-11T11:00:00Z", "met", "letter", "--met", "signed", "--when", "2 hours ago");
  assert.equal(early.status, 2);
  assert.equal(early.stderr, 'Nothing was saved. Ask them: That is before "Letter" was finished (today at 11:00). When did it happen?\n');
  const ok = run(h, "2026-11-11T11:00:00Z", "met", "letter", "--met", "signed", "--when", "vor einer halben Stunde", "--json");
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout).recorded, { at: "2026-11-11T10:30:00.000Z", said: "today at 11:30" });
  run(h, "2026-11-11T11:00:00Z", "start", "Call");
  const span = run(h, "2026-11-11T14:00:00Z", "done", "call", "--when", "from 13:00 to 13:30");
  assert.equal(span.status, 1); assert.match(span.stderr, /takes one time/);
  assert.equal(entryFiles(h).length, 4);
});

test("a finish told after the evening list but dated before it is named in the next one, and in the block meanwhile", () => {
  const h = mcDir();
  const settings = path.join(h, "routines", "journal", "settings.json");
  fs.writeFileSync(settings, JSON.stringify({ ...JSON.parse(fs.readFileSync(settings, "utf8")), nudge: { enabled: false }, evening: { enabled: true, at: "18:30" } }));
  run(h, "2026-11-11T08:00:00Z", "start", "Letter", "--done-means", "letter signed");
  assert.match(run(h, "2026-11-11T17:31:00Z", "tick").stdout, /still open:\n• Letter/);
  const late = run(h, "2026-11-11T20:00:00Z", "done", "letter", "--missed", "letter signed", "--when", "at 17:00");
  assert.equal(late.status, 0, late.stderr);
  assert.match(run(h, "2026-11-12T08:00:00Z", "context").stdout, /- t-20261111-0900-letter: "Letter", finished Wed 2026-11-11 17:00, without: letter signed/);
  assert.match(run(h, "2026-11-12T17:31:00Z", "tick").stdout, /• Letter, missing: letter signed/);
  assert.equal(run(h, "2026-11-13T17:31:00Z", "tick").stdout, "");
});

test("a finish dated before the task was reopened asks and saves nothing", () => {
  const h = mcDir();
  run(h, "2026-11-11T08:00:00Z", "start", "Invoice");
  run(h, "2026-11-11T09:00:00Z", "done", "invoice");
  run(h, "2026-11-11T10:00:00Z", "reopen", "invoice");
  for (const kind of ["done", "drop"]) {
    const r = run(h, "2026-11-11T11:00:00Z", kind, "invoice", "--when", "at 10:15");
    assert.equal(r.status, 2);
    assert.equal(r.stderr, 'Nothing was saved. Ask them: That is before "Invoice" was reopened (today at 11:00). When did you finish it?\n');
  }
  assert.equal(entryFiles(h).length, 3);
  assert.equal(run(h, "2026-11-11T11:00:00Z", "done", "invoice", "--when", "at 11:30").status, 0);
  assert.equal(JSON.parse(run(h, "2026-11-11T11:01:00Z", "open", "--json").stdout).length, 0);
});
