import assert from "node:assert/strict";
import test from "node:test";
import { addHabit, listHabits, findHabit, track, answerOn, askedOn, dueOn, stats, verdict, setStatus, readHabit, parseDays, daysWords } from "../lib/habits.mjs";
import { addDays } from "../lib/clock.mjs";
import { tmpMission, area } from "./helpers.mjs";

const mission = () => tmpMission({ "coach/health/area.md": area(), "coach/work/area.md": area({ AREA: "work" }) });
const lifts = (mc, over = {}) => addHabit(mc, { area: "health", slug: "head-lifts", title: "Face-down head lifts", doneMeans: "a few 10-second holds", days: "daily", ...over }, over.today || "2026-09-29");

test("days words", () => {
  assert.equal(parseDays("daily"), "daily");
  assert.deepEqual(parseDays("Mon, Wed, Friday"), ["mon", "wed", "fri"]);
  assert.equal(parseDays("whenever"), null);
  assert.equal(daysWords("daily"), "every day");
  assert.equal(daysWords(["fri", "mon", "wed"]), "every Monday, Wednesday and Friday");
  assert.equal(daysWords(["tue", "thu"], "de"), "jeden Dienstag und Donnerstag");
});

test("tracking twice counts once; a later no replaces done; asked never replaces an answer", () => {
  const mc = mission();
  let h = lifts(mc);
  h = track(h, "2026-09-29", "done", "telegram-voice", "did head lifts");
  h = track(h, "2026-09-29", "done", "journal", "finished the head lifts");
  assert.equal(stats(h, "2026-09-29", 1).done, 1);
  h = track(h, "2026-09-30", "done", "telegram", "yes");
  h = track(h, "2026-09-30", "no", "telegram", "actually no, forgot");
  assert.equal(answerOn(h, "2026-09-30"), "no");
  h = track(h, "2026-10-01", "done", "telegram", "done");
  h = track(h, "2026-10-01", "asked", "tick", "");
  assert.equal(answerOn(h, "2026-10-01"), "done");
  assert.equal(askedOn(h, "2026-10-01"), true);
  assert.equal(readHabit(h.file).log["2026-09-29"].words, "finished the head lifts");
  assert.throws(() => track(h, "2026-10-02", "maybe"), /done, no or skip/);
});

test("quotes in his words do not break the line", () => {
  const mc = mission();
  let h = lifts(mc);
  h = track(h, "2026-09-29", "done", "telegram", 'he said "done" twice');
  assert.equal(answerOn(h, "2026-09-29"), "done");
});

test("the cap of five active habits, and one name only once", () => {
  const mc = mission();
  for (const t of ["Reading", "Walk", "Stretch", "Water"]) addHabit(mc, { area: "work", title: t, days: "daily" }, "2026-09-29");
  lifts(mc);
  assert.throws(() => addHabit(mc, { area: "work", title: "Journal", days: "daily" }, "2026-09-29"), /Already 5 active habits: Face-down head lifts, Reading, Stretch, Walk, Water. Pause or graduate one first./);
  assert.throws(() => lifts(mc), /already an active habit/);
  setStatus(findHabit(mc, "walk"), "graduated");
  assert.doesNotThrow(() => addHabit(mc, { area: "work", title: "Journal", days: "daily" }, "2026-09-29"));
  assert.throws(() => addHabit(mc, { area: "nowhere", title: "X", days: "daily" }, "2026-09-29"), /no coach area/);
  assert.equal(listHabits(mc, { status: "active" }).length, 5);
});

test("finding a habit from what he said", () => {
  const mc = mission();
  lifts(mc);
  addHabit(mc, { area: "work", slug: "evening-walk", title: "Evening walk", days: "daily" }, "2026-09-29");
  assert.equal(findHabit(mc, "did head lifts").slug, "head-lifts");
  assert.equal(findHabit(mc, "track head-lifts").slug, "head-lifts");
  assert.equal(findHabit(mc, "went for my evening walk").slug, "evening-walk");
  assert.equal(findHabit(mc, "bought milk"), null);
  addHabit(mc, { area: "work", slug: "evening-read", title: "Evening reading", days: "daily" }, "2026-09-29");
  assert.deepEqual(findHabit(mc, "evening done").ambiguous.sort(), ["Evening reading", "Evening walk"]);
});

test("which days a habit is due", () => {
  const mc = mission();
  const h = addHabit(mc, { area: "work", title: "Gym", days: "mon,wed,fri" }, "2026-09-29");
  assert.equal(dueOn(h, "2026-09-29"), false, "a Tuesday");
  assert.equal(dueOn(h, "2026-09-30"), true);
  assert.equal(dueOn(h, "2026-09-28"), false, "before it started");
  assert.equal(dueOn(setStatus(h, "paused"), "2026-09-30"), false);
});

function fill(h, from, n, pattern) {
  for (let i = 0; i < n; i++) { const a = pattern(i); if (a) h = track(h, addDays(from, i), a, "test", ""); }
  return h;
}

test("graduate after six weeks of mostly done, not a day before", () => {
  const mc = mission();
  let h = lifts(mc, { today: "2026-09-01" });
  h = fill(h, "2026-09-01", 43, (i) => (i % 5 === 4 ? "no" : "done"));
  assert.equal(verdict(h, "2026-10-12"), "fine", "day 41");
  assert.equal(verdict(h, "2026-10-13"), "graduate", "day 42");
});

test("struggling: under half of at least five answered days in the last two weeks", () => {
  const mc = mission();
  let h = lifts(mc, { today: "2026-09-29" });
  h = fill(h, "2026-09-29", 4, (i) => (i < 1 ? "done" : "no"));
  assert.equal(verdict(h, "2026-10-02"), "fine", "only 4 answered");
  h = fill(h, "2026-10-03", 2, () => "no");
  assert.equal(verdict(h, "2026-10-04"), "struggling");
  const s = stats(h, "2026-10-04", 14);
  assert.equal(s.applicable, 6); assert.equal(s.done, 1); assert.equal(s.no, 5);
});
