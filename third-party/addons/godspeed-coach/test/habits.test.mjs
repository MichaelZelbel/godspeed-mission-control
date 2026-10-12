import assert from "node:assert/strict";
import test from "node:test";
import { addHabit, listHabits, findHabit, track, untrack, answerOn, askedOn, dueOn, stats, verdict, setStatus, readHabit, parseDays, daysWords } from "../lib/habits.mjs";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { addDays } from "../lib/clock.mjs";
import { tmpMission, area } from "./helpers.mjs";
import { habitLine } from "../lib/brief.mjs";

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

// The evening check says "skip" is for a day that "shouldn't count, for example because you were
// ill", and the notebook's habit page calls it "Does not count". So a skipped day is left out of the
// planned days altogether: it is never a planned day without an answer. A blank day still is one.
// The window stays the last six weeks (graduation) or two weeks (struggling) of calendar days.
const sixWeeks = (h, pattern) => fill(h, "2026-09-02", 42, pattern); // 2 September to 13 October
const sickSpell = (n, rest) => (i) => (i < n ? "skip" : rest(i - n));

test("a skipped day is not a planned day: 20 skipped, 18 done and 4 no out of 42 graduates", () => {
  const mc = mission();
  let h = lifts(mc, { today: "2026-09-01" });
  h = sixWeeks(h, sickSpell(20, (j) => (j < 18 ? "done" : "no")));
  const s = stats(h, "2026-10-13", 42);
  assert.deepEqual({ planned: s.applicable, skip: s.skip, done: s.done, no: s.no, blank: s.unknown, answered: s.answered }, { planned: 22, skip: 20, done: 18, no: 4, blank: 0, answered: 22 });
  assert.equal(Math.round(s.rate * 100), 82);
  assert.equal(verdict(h, "2026-10-13"), "graduate");
});

test("skipped days never keep a habit from graduating; the same days left blank do", () => {
  const mc = mission();
  // 22 skipped, 16 done, 4 no: 20 answered of 20 planned days, 80% done.
  let h = lifts(mc, { today: "2026-09-01" });
  h = sixWeeks(h, sickSpell(22, (j) => (j < 16 ? "done" : "no")));
  let s = stats(h, "2026-10-13", 42);
  assert.deepEqual([s.applicable, s.skip, s.answered, s.unknown], [20, 22, 20, 0]);
  assert.equal(verdict(h, "2026-10-13"), "graduate");
  // The same 22 days with no answer at all: 20 answered of 42 planned days, under half answered.
  const other = addHabit(mc, { area: "work", slug: "evening-walk", title: "Evening walk", days: "daily" }, "2026-09-01");
  const blank = sixWeeks(other, (i) => (i < 22 ? null : i - 22 < 16 ? "done" : "no"));
  s = stats(blank, "2026-10-13", 42);
  assert.deepEqual([s.applicable, s.skip, s.answered, s.unknown], [42, 0, 20, 22]);
  assert.equal(verdict(blank, "2026-10-13"), "fine");
});

test("a skipped day changes nothing in the struggling check either", () => {
  const mc = mission();
  // Two weeks: 8 skipped, 2 done, 4 no. Six planned days, under half done: struggling.
  let h = lifts(mc, { today: "2026-09-29" });
  h = fill(h, "2026-09-29", 14, sickSpell(8, (j) => (j < 2 ? "done" : "no")));
  const s = stats(h, "2026-10-12", 14);
  assert.deepEqual([s.applicable, s.skip, s.done, s.no, s.unknown], [6, 8, 2, 4, 0]);
  assert.equal(verdict(h, "2026-10-12"), "struggling");
  // 10 skipped, 1 done, 3 no: four answered days, and skipped days never make up the five.
  const other = addHabit(mc, { area: "work", slug: "evening-walk", title: "Evening walk", days: "daily" }, "2026-09-29");
  const few = fill(other, "2026-09-29", 14, sickSpell(10, (j) => (j < 1 ? "done" : "no")));
  assert.equal(stats(few, "2026-10-12", 14).applicable, 4);
  assert.equal(verdict(few, "2026-10-12"), "fine");
});

test("the talk brief's habit line counts the planned days without the skipped ones", () => {
  const mc = mission();
  let h = lifts(mc, { today: "2026-09-01" });
  // The last seven days, 7 to 13 October: done, skip, no, done, skip, blank, done.
  h = fill(h, "2026-10-07", 7, (i) => ["done", "skip", "no", "done", "skip", null, "done"][i]);
  assert.equal(habitLine(h, "2026-10-13"), "- Face-down head lifts (every day): last 7 days, 5 planned: done 3, no 1, unknown 1; 2 skipped, not counted");
  h = untrack(h, "2026-10-08"); h = untrack(h, "2026-10-11");
  assert.equal(habitLine(h, "2026-10-13"), "- Face-down head lifts (every day): last 7 days, 7 planned: done 3, no 1, unknown 3");
});

// "Delete the last walk to work" (D-321): a day tracked by mistake is taken back, line and all, so
// the file is exactly what it was. An older answer that day comes back; "asked" lines stay.
test("a tracked day is taken back: the newest answer goes, an older one and asked stay", () => {
  const mc = mission();
  let h = lifts(mc);
  h = track(h, "2026-09-29", "asked", "tick", "");
  const before = fs.readFileSync(h.file, "utf8");
  h = track(h, "2026-09-29", "done", "telegram", "did head lifts");
  h = untrack(h, "2026-09-29");
  assert.equal(fs.readFileSync(h.file, "utf8"), before, "the file is as it was");
  assert.equal(answerOn(h, "2026-09-29"), null);
  assert.equal(askedOn(h, "2026-09-29"), true);
  h = track(h, "2026-09-30", "done", "telegram", "yes");
  h = track(h, "2026-09-30", "no", "telegram", "actually no");
  h = untrack(h, "2026-09-30");
  assert.equal(answerOn(h, "2026-09-30"), "done");
  assert.throws(() => untrack(h, "2026-10-01"), /No answer is tracked for 2026-10-01/);
});

// One listener owns "track" (D-321): the tracker recipe takes a message that starts with it and
// records the habit itself, so the coach no longer names "track ..." among its own triggers.
test("the coach recipe no longer claims messages that start with track", () => {
  const text = fs.readFileSync(fileURLToPath(new URL("../skill/coach/SKILL.md", import.meta.url)), "utf8").replace(/\r/g, "");
  const description = text.match(/^description: (.*)$/m)[1];
  assert.doesNotMatch(description, /"track /i);
  assert.match(description, /"did head lifts", "head lifts done", "Kopfheben erledigt"/);
  assert.match(text, /"Track stretching" means "did stretching"/);
  assert.match(text, /godspeed-coach habit untrack/);
});

test("the coach recipe says a skipped day is never a missed one", () => {
  const text = fs.readFileSync(fileURLToPath(new URL("../skill/coach/SKILL.md", import.meta.url)), "utf8").replace(/\r/g, "").replace(/\s+/g, " ");
  assert.match(text, /A day answered "skip" does not count either way: the brief's habit lines, graduating and "make it smaller" leave it out of the planned days, and so do you; never call it a missed day\./);
});
