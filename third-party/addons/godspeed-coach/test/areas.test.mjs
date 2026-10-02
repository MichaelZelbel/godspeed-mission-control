import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { listAreas, findArea, isTalkDay, talkMoment, parseRhythm, readArea, rhythmWords } from "../lib/areas.mjs";
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
