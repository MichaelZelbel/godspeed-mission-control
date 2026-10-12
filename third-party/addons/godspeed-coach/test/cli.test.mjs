import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { tmpMission, area } from "./helpers.mjs";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "godspeed-coach.mjs");

function cli(mc, nowIso, ...args) {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), "coach-app-"));
  const r = spawnSync(process.execPath, [BIN, ...args, "--godspeed", mc], {
    encoding: "utf8", env: { ...process.env, GODSPEED_NOW: nowIso, GODSPEED_COACH_GIT_SYNC: "off", GODSPEED_COACH_APP: process.env.COACH_APP || app },
  });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
}

const mission = () => tmpMission({
  "coach/settings.json": JSON.stringify({ timezone: "Europe/Berlin", git_sync: "off" }),
  "coach/health/area.md": area(),
});

test("habits: add, track by loose words, answer tonight's check, list", () => {
  const mc = mission();
  const T = "2026-09-29T10:00:00Z";
  assert.match(cli(mc, T, "habit", "add", "health", "head-lifts", "--title", "Face-down head lifts", "--done-means", "a few holds", "--days", "daily").out, /^Started: Face-down head lifts \(head-lifts\), daily, from 2026-09-29\./);
  assert.equal(cli(mc, T, "habit", "track", "did head lifts", "--source", "telegram-voice").out, "Tracked: Face-down head lifts, 2026-09-29, done.");
  assert.equal(cli(mc, T, "habit", "track", "head lifts", "--answer", "no", "--date", "yesterday").out, "Tracked: Face-down head lifts, 2026-09-28, no.");
  const bad = cli(mc, T, "habit", "track", "bought milk");
  assert.equal(bad.code, 1); assert.match(bad.err, /No habit matches "bought milk"\. Active habits: Face-down head lifts\./);
  assert.equal(cli(mc, "2026-09-30T19:00:00Z", "tick").out, [
    "From your coach: Face-down head lifts today? You planned this habit for every day, and nothing is tracked for today yet. You said it counts as done when: a few holds.",
    `Reply "yes" if you did it, "no" if you didn't, or "skip" if today shouldn't count, for example because you were ill. No reply is fine: the day stays blank and I won't ask about it again.`,
  ].join("\n"));
  assert.match(cli(mc, "2026-09-30T19:05:00Z", "context").out, /Habit check sent tonight/);
  assert.equal(cli(mc, "2026-09-30T19:06:00Z", "habit", "answer", "yes").out, "Tracked: Face-down head lifts done.");
  assert.match(cli(mc, T, "habit", "list").out, /^head-lifts: Face-down head lifts \(health, daily, active\)/);
  assert.match(cli(mc, "2026-09-30T19:10:00Z", "habits", "week").out, /last 7 days, 2 planned: done 2, no 0, unknown 0$/, "the no before it started does not count");
});

test("talks: the gate, opening, his words, held", () => {
  const mc = mission();
  process.env.COACH_APP = fs.mkdtempSync(path.join(os.tmpdir(), "coach-app-"));
  try {
    assert.equal(cli(mc, "2026-10-04T16:50:00Z", "gate").out, '{"wakeAgent": false}');
    assert.match(cli(mc, "2026-10-04T17:00:00Z", "gate").out, /^COACH TALK DUE: Health and fitness/);
    assert.equal(cli(mc, "2026-10-04T17:02:00Z", "talk", "open", "health", "--opening", "When does the tiredness come?").out, "Opened: coach/health/talks/2026-10-04.md");
    assert.equal(cli(mc, "2026-10-04T18:05:00Z", "gate").out, '{"wakeAgent": false}');
    assert.match(cli(mc, "2026-10-04T17:10:00Z", "context").out, /Open talk: Health and fitness \(id for commands: health\), opened today at 19:02/);
    assert.equal(cli(mc, "2026-10-04T17:20:00Z", "talk", "said", "health", "--words", "most evenings, about an hour").out, "Saved.");
    assert.equal(cli(mc, "2026-10-04T17:40:00Z", "talk", "held", "health").out, "Recorded: the Health and fitness talk of 2026-10-04 is held.");
    const rec = fs.readFileSync(path.join(mc, "coach", "health", "talks", "2026-10-04.md"), "utf8");
    assert.match(rec, /STATE: held/); assert.match(rec, /## What you said\n- 19:20 most evenings, about an hour/);
    assert.equal(cli(mc, "2026-10-04T17:45:00Z", "context").out, "");
  } finally { delete process.env.COACH_APP; }
});

test("areas: add the first one in an empty mission control, change it, pause it", () => {
  const mc = tmpMission({ "coach/settings.json": JSON.stringify({ timezone: "Europe/Berlin", git_sync: "off" }) });
  const T = "2026-10-04T16:00:00Z"; // a Sunday, 18:00 Berlin
  assert.equal(cli(mc, T, "area", "add", "health", "--title", "Health", "--rhythm", "weekly sunday", "--time", "19:00", "--style", "review").out,
    "Added: Health (health), weekly sunday at 19:00, review, gentle. First talk: 2026-10-11.");
  const text = fs.readFileSync(path.join(mc, "coach", "health", "area.md"), "utf8");
  assert.match(text, /^AREA: health\nTITLE: Health\nRHYTHM: weekly sunday\nTIME: 19:00\nSTARTS: 2026-10-05\nSTATUS: on\nSTYLE: review\nTONE: gentle/);
  assert.match(text, /## Preparation\n\nRead the last talk of this area/);
  assert.equal(cli(mc, "2026-10-11T17:00:00Z", "gate").out.split("\n")[0], "COACH TALK DUE: Health (id for commands: health), 2026-10-11, 19:00 Europe/Berlin");
  const bad = cli(mc, T, "area", "add", "work", "--rhythm", "sometimes");
  assert.equal(bad.code, 1); assert.match(bad.err, /"sometimes" is not a rhythm/);
  assert.equal(cli(mc, T, "area", "add", "health", "--rhythm", "daily").code, 1, "no second health area");
  assert.equal(cli(mc, T, "area", "set", "health", "rhythm", "weekly", "Wednesday").out, "Changed: Health RHYTHM = weekly Wednesday. Next talk: 2026-10-07.");
  assert.equal(cli(mc, T, "area", "set", "health", "tone", "direct").out, "Changed: Health TONE = direct. Next talk: 2026-10-07.");
  assert.equal(cli(mc, T, "area", "set", "health", "status", "paused").out, "Changed: Health STATUS = paused. Paused: no talks until it is on again.");
  assert.match(cli(mc, T, "area", "set", "health", "colour", "blue").err, /settings are TITLE, RHYTHM, TIME, STARTS, STATUS, STYLE, TONE, SERVES/);
  assert.match(cli(mc, T, "areas").out, /^health: Health, weekly wednesday 19:00, review, direct, paused$/);
});

test("the gate and context never fail loudly, even without a mission control", () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), "no-mc-"));
  const g = cli(empty, "2026-10-04T17:00:00Z", "gate");
  assert.equal(g.code, 0); assert.equal(g.out, '{"wakeAgent": false}');
  const c = cli(empty, "2026-10-04T17:00:00Z", "context");
  assert.equal(c.code, 0); assert.equal(c.out, "");
});

// "Delete the last head lifts", "undo that": the newest tracked day goes, so the habit file is as it
// was; another day with --date. Nothing tracked yet is said plainly, and nothing changes.
test("habits: a tracked day is taken back with untrack", () => {
  const mc = mission();
  const T = "2026-09-29T10:00:00Z";
  cli(mc, T, "habit", "add", "health", "head-lifts", "--title", "Face-down head lifts", "--days", "daily");
  const file = path.join(mc, "coach", "health", "habits", "head-lifts.md");
  const before = fs.readFileSync(file, "utf8");
  const none = cli(mc, T, "habit", "untrack", "head lifts");
  assert.equal(none.code, 1); assert.match(none.err, /Nothing is tracked for Face-down head lifts yet\./);
  cli(mc, T, "habit", "track", "head lifts", "--answer", "no", "--date", "yesterday");
  cli(mc, T, "habit", "track", "did head lifts");
  assert.equal(cli(mc, T, "habit", "untrack", "head lifts").out, "Taken back: Face-down head lifts, 2026-09-29.");
  assert.equal(cli(mc, T, "habit", "untrack", "head lifts", "--date", "yesterday").out, "Taken back: Face-down head lifts, 2026-09-28.");
  assert.equal(fs.readFileSync(file, "utf8"), before);
});

// The book's capture run of 12 October 2026 (Mission Control's D-321): on a brand-new mission
// control, "New habit for my health: ten minutes of stretching every evening" started nothing,
// because there was no area called health, and the assistant asked for a talk instead.
test("a habit starts on day one: its area is made with no talk, and nothing schedules one", () => {
  const mc = tmpMission({ "coach/settings.json": JSON.stringify({ timezone: "Europe/Berlin", git_sync: "off" }) });
  const T = "2026-10-12T04:46:00Z"; // a Monday, 06:46 Berlin
  assert.equal(cli(mc, T, "areas").out, "No areas yet.");
  const started = cli(mc, T, "habit", "add", "health", "stretching", "--title", "Stretching", "--done-means", "ten minutes on the mat", "--days", "daily");
  assert.equal(started.code, 0, started.err);
  assert.equal(started.out, "Started: Stretching (stretching), daily, from 2026-10-12. New area: Health (health), with no talk.");
  assert.match(fs.readFileSync(path.join(mc, "coach", "health", "area.md"), "utf8"), /^AREA: health\nTITLE: Health\nRHYTHM: none\nSTATUS: on\n/);
  assert.equal(cli(mc, T, "areas").out, "health: Health, no talk");
  // No talk is ever due, followed up or opened for it, on any day.
  for (const day of ["2026-10-13", "2026-10-18", "2026-10-25"]) for (const hm of ["06:00", "17:00", "19:00"]) assert.equal(cli(mc, `${day}T${hm}:00Z`, "gate").out, '{"wakeAgent": false}', `${day} ${hm}`);
  assert.equal(fs.existsSync(path.join(mc, "coach", "health", "talks")), false, "no talk record");
  // The habit is tracked, taken back and answered, and the evening check asks about it at 21:00.
  assert.equal(cli(mc, T, "habit", "track", "track stretching").out, "Tracked: Stretching, 2026-10-12, done.");
  assert.equal(cli(mc, T, "habit", "track", "stretching", "--date", "yesterday").out, "Tracked: Stretching, 2026-10-11, done.", "a day before it started is still kept as said");
  assert.equal(cli(mc, T, "habit", "untrack", "stretching").out, "Taken back: Stretching, 2026-10-11.");
  assert.equal(cli(mc, T, "habit", "track", "stretching", "--answer", "no").out, "Tracked: Stretching, 2026-10-12, no.");
  assert.equal(cli(mc, "2026-10-13T19:00:00Z", "tick").out, [
    "From your coach: Stretching today? You planned this habit for every day, and nothing is tracked for today yet. You said it counts as done when: ten minutes on the mat.",
    `Reply "yes" if you did it, "no" if you didn't, or "skip" if today shouldn't count, for example because you were ill. No reply is fine: the day stays blank and I won't ask about it again.`,
  ].join("\n"));
  assert.equal(cli(mc, "2026-10-13T19:05:00Z", "habit", "answer", "yes").out, "Tracked: Stretching done.");
  // A second habit in the same area uses it; another part of life gets its own.
  assert.match(cli(mc, T, "habit", "add", "health", "water", "--title", "Water", "--days", "daily").out, /^Started: Water \(water\), daily, from 2026-10-12\.$/);
  assert.match(cli(mc, T, "habit", "add", "work", "inbox-zero", "--title", "Inbox zero", "--days", "mon,fri").out, /New area: Work \(work\), with no talk\.$/);
  // Asked for a talk later, the same area gets one, and keeps its habits.
  assert.equal(cli(mc, T, "area", "add", "health", "--title", "Health", "--rhythm", "weekly sunday", "--time", "19:00", "--style", "review").out,
    "Added: Health (health), weekly sunday at 19:00, review, gentle. First talk: 2026-10-18.");
  assert.match(cli(mc, T, "areas").out, /^health: Health, weekly sunday 19:00, review, gentle, next talk 2026-10-18$/m);
  assert.equal(cli(mc, "2026-10-18T17:00:00Z", "gate").out.split("\n")[0], "COACH TALK DUE: Health (id for commands: health), 2026-10-18, 19:00 Europe/Berlin");
  assert.match(cli(mc, T, "habit", "list").out, /stretching: Stretching \(health, daily, active\)/);
  // Or a rhythm set on an area with no talk: the talk starts tomorrow.
  assert.equal(cli(mc, T, "area", "set", "work", "RHYTHM", "weekly", "friday").out, "Changed: Work RHYTHM = weekly friday. Next talk: 2026-10-16.");
});

test("a refused habit leaves no area behind, and the cap of five is unchanged", () => {
  const mc = mission(), T = "2026-10-12T10:00:00Z";
  for (const n of ["a", "b", "c", "d", "e"]) assert.equal(cli(mc, T, "habit", "add", "health", `habit-${n}`, "--title", `Habit ${n}`).code, 0);
  const sixth = cli(mc, T, "habit", "add", "sleep", "lights-out", "--title", "Lights out");
  assert.equal(sixth.code, 1);
  assert.match(sixth.err, /^Already 5 active habits: Habit a, Habit b, Habit c, Habit d, Habit e\. Pause or graduate one first\.$/);
  assert.equal(fs.existsSync(path.join(mc, "coach", "sleep")), false, "no area was left behind");
  assert.equal(cli(mc, T, "habit", "add", "health", "x", "--days", "someday").code, 1);
  // An area that has a talk is used as it is: nothing about it changes.
  const before = fs.readFileSync(path.join(mc, "coach", "health", "area.md"), "utf8");
  assert.equal(cli(mc, T, "habit", "status", "habit-a", "paused").code, 0);
  assert.match(cli(mc, T, "habit", "add", "health", "f", "--title", "F").out, /^Started: F \(f\), daily, from 2026-10-12\.$/);
  assert.equal(fs.readFileSync(path.join(mc, "coach", "health", "area.md"), "utf8"), before);
});

// "The health talk may also look at my sleep tracker", "The health talk must never suggest buying
// anything", and taking one back, for a talk that already exists (until 12 October 2026 only area
// add took them, and later the assistant had to edit area.md by hand).
test("areas: what a talk may look at and must never do, added and taken back after it exists", () => {
  const mc = mission(), T = "2026-10-12T10:00:00Z";
  const file = path.join(mc, "coach", "health", "area.md");
  const before = fs.readFileSync(file, "utf8");
  const read = cli(mc, T, "area", "read", "health", "my sleep tracker");
  assert.equal(read.code, 0, read.err);
  assert.equal(read.out, "Added: the Health and fitness talk may look at my sleep tracker.");
  assert.equal(cli(mc, T, "area", "limit", "health", "never suggest buying anything").out, "Added a limit to the Health and fitness talk: never suggest buying anything.");
  assert.equal(fs.readFileSync(file, "utf8"), before.replace("LIMIT: never diagnose\n", "MAY READ: my sleep tracker\nLIMIT: never diagnose\nLIMIT: never suggest buying anything\n"), "only the two lines changed");
  assert.equal(cli(mc, T, "area", "read", "health", "My sleep tracker").out, "Already there: the Health and fitness talk may look at my sleep tracker. Nothing changed.");
  assert.equal(cli(mc, T, "area", "read", "health").out, "The Health and fitness talk may look at: my sleep tracker.");
  assert.equal(cli(mc, T, "area", "limit", "health").out, "The Health and fitness talk's limits: never diagnose; never suggest buying anything.");
  assert.deepEqual(JSON.parse(cli(mc, T, "area", "read", "health", "--json").out), { ok: true, area: "health", may_read: ["my sleep tracker"], limits: ["never diagnose", "never suggest buying anything"] });
  // The talk's brief carries both, so the next talk reads the one and keeps the other.
  const b = cli(mc, "2026-10-18T17:00:00Z", "brief", "health", "--date", "2026-10-18").out;
  assert.match(b, /Limits, binding:\n- never diagnose\n- never suggest buying anything\nMay read:\n- my sleep tracker\n/);
  // "The health talk no longer needs my sleep tracker."
  assert.equal(cli(mc, T, "area", "read", "health", "sleep tracker", "--remove").out, "Taken away: the Health and fitness talk no longer looks at my sleep tracker.");
  assert.equal(cli(mc, T, "area", "read", "health").out, "Nothing is named for the Health and fitness talk to look at.");
  const none = cli(mc, T, "area", "read", "health", "my calendar", "--remove");
  assert.equal(none.code, 1); assert.match(none.err, /^Nothing the Health and fitness talk may look at matches "my calendar"\. Nothing is named for it to look at\.$/);
  assert.equal(cli(mc, T, "area", "limit", "health", "never suggest buying anything", "--remove").out, 'Taken away: the Health and fitness talk\'s limit "never suggest buying anything".');
  assert.equal(fs.readFileSync(file, "utf8"), before, "back to the file it was");
  // An area that does not exist is refused plainly, and nothing is made for it.
  const unknown = cli(mc, T, "area", "read", "garden", "my calendar");
  assert.equal(unknown.code, 1);
  assert.equal(unknown.err, 'There is no coach area called "garden". Areas: health.');
  assert.equal(fs.existsSync(path.join(mc, "coach", "garden")), false);
  assert.equal(cli(mc, T, "area", "limit", "health", "").code, 1);
});

test("areas: an area with no talk takes what it may read and its limits, and keeps them when it gets a talk", () => {
  const mc = tmpMission({ "coach/settings.json": JSON.stringify({ timezone: "Europe/Berlin", git_sync: "off" }) }), T = "2026-10-12T10:00:00Z";
  assert.equal(cli(mc, T, "habit", "add", "sleep", "lights-out", "--title", "Lights out").code, 0);
  assert.equal(cli(mc, T, "area", "read", "sleep", "my sleep tracker").out, "Added: the Sleep talk may look at my sleep tracker. It has no talk yet; the talk it gets later keeps this.");
  assert.equal(cli(mc, T, "area", "limit", "sleep", "never suggest sleeping pills").out, "Added a limit to the Sleep talk: never suggest sleeping pills. It has no talk yet; the talk it gets later keeps this.");
  assert.equal(cli(mc, T, "area", "add", "sleep", "--rhythm", "weekly sunday", "--time", "19:00").code, 0);
  const text = fs.readFileSync(path.join(mc, "coach", "sleep", "area.md"), "utf8");
  assert.match(text, /\nMAY READ: my sleep tracker\nLIMIT: never suggest sleeping pills\n/);
  assert.match(text, /^RHYTHM: weekly sunday$/m);
});
