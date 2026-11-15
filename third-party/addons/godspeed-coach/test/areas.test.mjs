import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { listAreas, findArea, isTalkDay, talkMoment, parseRhythm, readArea, rhythmWords, addAreaLine, removeAreaLine } from "../lib/areas.mjs";
import { tmpMission, area } from "./helpers.mjs";

test("rhythm words", () => {
  assert.deepEqual(parseRhythm("weekly Sunday"), { kind: "weeks", every: 1, day: "sun" });
  assert.deepEqual(parseRhythm("every 2 weeks wed"), { kind: "weeks", every: 2, day: "wed" });
  assert.deepEqual(parseRhythm("monthly 1"), { kind: "monthly", day: 1 });
  assert.deepEqual(parseRhythm("daily"), { kind: "daily" });
  assert.equal(parseRhythm("monthly 31"), null);
  assert.equal(parseRhythm("sometimes"), null);
  const said = (RHYTHM, time = "19:00") => rhythmWords({ rhythm: parseRhythm(RHYTHM), rhythmText: RHYTHM, time });
  assert.equal(said("weekly sunday"), "every Sunday at 19:00");
  assert.equal(said("every 2 weeks wed", "08:30"), "every 2 weeks on Wednesday at 08:30");
  assert.equal(said("monthly 1"), "on the 1st of every month at 19:00");
  assert.equal(said("monthly 12"), "on the 12th of every month at 19:00");
  assert.equal(said("daily"), "every day at 19:00");
});

test("areas are folders with an area.md, and nothing else", () => {
  const mc = tmpMission({ "coach/health/area.md": area(), "coach/work/area.md": area({ AREA: "work", TITLE: "Work and money" }), "coach/empty/notes.md": "x", "coach/settings.json": "{}" });
  assert.deepEqual(listAreas(mc).map((a) => a.slug), ["health", "work"]);
  assert.equal(findArea(mc, "Work and money").slug, "work");
  assert.deepEqual(findArea(mc, "health").serves, ["age-healthy", "six-pack"]);
  assert.equal(findArea(mc, "nope"), null);
});

test("talk days follow rhythm, start date and status", () => {
  const mc = tmpMission({ "coach/health/area.md": area(), "coach/b/area.md": area({ RHYTHM: "every 2 weeks sunday" }), "coach/m/area.md": area({ RHYTHM: "monthly 1" }), "coach/d/area.md": area({ RHYTHM: "daily" }), "coach/p/area.md": area({ STATUS: "paused" }) });
  const a = (s) => readArea(path.join(mc, "coach", s));
  assert.equal(isTalkDay(a("health"), "2026-10-04"), true);
  assert.equal(isTalkDay(a("health"), "2026-10-05"), false);
  assert.equal(isTalkDay(a("health"), "2026-09-27"), false, "nothing before STARTS");
  assert.equal(isTalkDay(a("b"), "2026-10-18"), true);
  assert.equal(isTalkDay(a("b"), "2026-10-11"), false);
  assert.equal(isTalkDay(a("m"), "2026-11-01"), true);
  assert.equal(isTalkDay(a("m"), "2026-11-02"), false);
  assert.equal(isTalkDay(a("d"), "2026-10-06"), true);
  assert.equal(isTalkDay(a("p"), "2026-10-04"), false);
  assert.equal(talkMoment(a("health"), "2026-10-04", "Europe/Berlin").toISOString(), "2026-10-04T17:00:00.000Z");
  assert.equal(talkMoment(a("health"), "2026-11-01", "Europe/Berlin").toISOString(), "2026-11-01T18:00:00.000Z");
  assert.equal(talkMoment(a("health"), "2026-10-05", "Europe/Berlin"), null);
});

// What a talk may look at and what it must never do, said after the talk exists ("The health talk
// may also look at my sleep tracker", "must never suggest buying anything"). One header line is
// added or taken away; every other byte of the file stays as it was.
test("a MAY READ or LIMIT line is added under the header, and nothing else changes", () => {
  const mc = tmpMission({ "coach/health/area.md": area() + "\n## After the talk\n\nWrite it down.\n" });
  const file = path.join(mc, "coach", "health", "area.md");
  const before = fs.readFileSync(file, "utf8");
  const r = addAreaLine(findArea(mc, "health"), "MAY READ", "  my sleep\ntracker ");
  assert.equal(r.changed, true); assert.equal(r.line, "my sleep tracker");
  // With no MAY READ line yet, it goes before the first LIMIT line, as area add writes them.
  assert.equal(fs.readFileSync(file, "utf8"), before.replace("LIMIT: never diagnose\n", "MAY READ: my sleep tracker\nLIMIT: never diagnose\n"));
  assert.deepEqual(r.area.lists["MAY READ"], ["my sleep tracker"]);
  addAreaLine(findArea(mc, "health"), "MAY READ", "my running app");
  const limited = addAreaLine(findArea(mc, "health"), "LIMIT", "never suggest buying anything");
  assert.deepEqual(limited.area.lists["MAY READ"], ["my sleep tracker", "my running app"]);
  assert.deepEqual(limited.area.lists.LIMIT, ["never diagnose", "never suggest buying anything"]);
  assert.equal(fs.readFileSync(file, "utf8"), before.replace("LIMIT: never diagnose\n", "MAY READ: my sleep tracker\nMAY READ: my running app\nLIMIT: never diagnose\nLIMIT: never suggest buying anything\n"));
  // The same thing again, in other case or with a full stop, is already there: nothing is written.
  const again = addAreaLine(findArea(mc, "health"), "MAY READ", "My sleep tracker.");
  assert.equal(again.changed, false); assert.equal(again.line, "my sleep tracker");
  assert.throws(() => addAreaLine(findArea(mc, "health"), "MAY READ", "  "), /Say what the talk may look at/);
  assert.throws(() => addAreaLine(findArea(mc, "health"), "LIMIT", ""), /Say what the talk must never do/);
  assert.throws(() => addAreaLine(findArea(mc, "health"), "TONE", "direct"), /MAY READ or LIMIT/);
});

test("a MAY READ or LIMIT line is taken away by their own words, and only that line", () => {
  const lines = "MAY READ: my sleep tracker\nMAY READ: my belly tracker\nMAY READ: the week's news\nLIMIT: never diagnose\nLIMIT: never suggest buying anything\n";
  const mc = tmpMission({ "coach/health/area.md": area().replace("LIMIT: never diagnose\n", lines) });
  const file = path.join(mc, "coach", "health", "area.md");
  const before = fs.readFileSync(file, "utf8");
  // Two lines fit: nothing is taken away, and both are named.
  assert.throws(() => removeAreaLine(findArea(mc, "health"), "MAY READ", "tracker"), /Several things the Health and fitness talk may look at match "tracker": my sleep tracker \/ my belly tracker\. Say which one\./);
  // "The health talk no longer needs my sleep tracker": the words need not be the line's own.
  const r = removeAreaLine(findArea(mc, "health"), "MAY READ", "the Sleep tracker");
  assert.deepEqual(r.removed, ["my sleep tracker"]);
  assert.deepEqual(r.area.lists["MAY READ"], ["my belly tracker", "the week's news"]);
  assert.equal(fs.readFileSync(file, "utf8"), before.replace("MAY READ: my sleep tracker\n", ""));
  assert.throws(() => removeAreaLine(findArea(mc, "health"), "MAY READ", "my calendar"), /Nothing the Health and fitness talk may look at matches "my calendar"\. It may look at: my belly tracker; the week's news\./);
  assert.deepEqual(removeAreaLine(findArea(mc, "health"), "LIMIT", "suggest buying anything").removed, ["never suggest buying anything"]);
  assert.throws(() => removeAreaLine(findArea(mc, "health"), "LIMIT", "never book anything"), /None of the Health and fitness talk's limits matches "never book anything"\. Its limits: never diagnose\./);
  assert.equal(fs.readFileSync(file, "utf8"), before.replace("MAY READ: my sleep tracker\n", "").replace("LIMIT: never suggest buying anything\n", ""));
});

test("an area's own line endings are kept, and an area with no talk takes the lines too", () => {
  const crlf = area().replace(/\n/g, "\r\n");
  const mc = tmpMission({ "coach/health/area.md": crlf, "coach/garden/area.md": "AREA: garden\nTITLE: Garden\nRHYTHM: none\nSTATUS: on\n\n## Preparation\n\nHabits only.\n" });
  addAreaLine(findArea(mc, "health"), "MAY READ", "my sleep tracker");
  assert.equal(fs.readFileSync(path.join(mc, "coach", "health", "area.md"), "utf8"), crlf.replace("LIMIT: never diagnose\r\n", "MAY READ: my sleep tracker\r\nLIMIT: never diagnose\r\n"));
  const g = addAreaLine(findArea(mc, "garden"), "LIMIT", "never suggest buying anything");
  assert.equal(g.area.noTalk, true);
  assert.equal(fs.readFileSync(path.join(mc, "coach", "garden", "area.md"), "utf8"), "AREA: garden\nTITLE: Garden\nRHYTHM: none\nSTATUS: on\nLIMIT: never suggest buying anything\n\n## Preparation\n\nHabits only.\n");
  assert.deepEqual(removeAreaLine(findArea(mc, "garden"), "LIMIT", "never suggest buying anything").removed, ["never suggest buying anything"]);
  assert.equal(fs.readFileSync(path.join(mc, "coach", "garden", "area.md"), "utf8"), "AREA: garden\nTITLE: Garden\nRHYTHM: none\nSTATUS: on\n\n## Preparation\n\nHabits only.\n");
});
