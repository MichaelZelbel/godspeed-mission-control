import { test } from "node:test";
import assert from "node:assert/strict";
import { LENGTH, addDays, daysBetween, charmState } from "../lib/count.mjs";

const ev = (kind, date, extra = {}) => ({ kind, date, when: `${date}T09:00:00Z`, ...extra });

test("date arithmetic is calendar based", () => {
  assert.equal(LENGTH, 21);
  assert.equal(addDays("2026-10-21", 21), "2026-11-11");
  assert.equal(addDays("2026-12-30", 3), "2027-01-02");
  assert.equal(daysBetween("2026-10-21", "2026-10-30"), 9);
  assert.equal(daysBetween("2026-10-30", "2026-10-21"), -9);
  assert.equal(daysBetween("2026-10-24", "2026-10-26"), 2); // across the DST change in Europe
});

test("running count: day 10, 12 to go", () => {
  const s = charmState([ev("start", "2026-10-21")], "2026-10-30");
  assert.equal(s.running, true);
  assert.equal(s.day, 10);
  assert.equal(s.daysToGo, 12);
  assert.equal(s.end, "2026-11-11");
  assert.equal(s.restarts, 0);
  assert.equal(s.started, "2026-10-21");
  assert.equal(s.challengeStarted, "2026-10-21");
});

test("a reset moves the run start and the end", () => {
  const s = charmState([ev("start", "2026-10-21"), ev("reset", "2026-10-22")], "2026-10-22");
  assert.equal(s.started, "2026-10-22");
  assert.equal(s.challengeStarted, "2026-10-21");
  assert.equal(s.end, "2026-11-12");
  assert.equal(s.restarts, 1);
  assert.equal(s.resetToday, true);
});

test("two resets on the same date count once", () => {
  const s = charmState([
    ev("start", "2026-10-21"),
    { kind: "reset", date: "2026-10-22", when: "2026-10-22T08:00:00Z" },
    { kind: "reset", date: "2026-10-22", when: "2026-10-22T09:30:00Z" },
  ], "2026-10-22");
  assert.equal(s.restarts, 1);
  assert.equal(s.started, "2026-10-22");
});

test("longest run covers earlier runs and the current one", () => {
  const events = [ev("start", "2026-10-21"), ev("reset", "2026-10-30")];
  assert.equal(charmState(events, "2026-11-02").longestRun, 9);
  assert.equal(charmState(events, "2026-11-30").longestRun, 21); // a run counts at most 21 days
  assert.equal(charmState(events, "2026-11-12").longestRun, 13);
});

test("past the end without a finish: needsFinish, clamped day and daysToGo", () => {
  const events = [ev("start", "2026-10-21")];
  const onEnd = charmState(events, "2026-11-11");
  assert.equal(onEnd.needsFinish, true);
  assert.equal(onEnd.running, true);
  assert.equal(onEnd.daysToGo, 0);
  assert.equal(onEnd.day, 21);
  const later = charmState(events, "2026-11-20");
  assert.equal(later.daysToGo, 0); // clamped, never negative
  assert.equal(later.day, 21);
  assert.equal(later.longestRun, 21);
  const done = charmState([...events, ev("finish", "2026-11-11")], "2026-11-11");
  assert.equal(done.running, false);
  assert.equal(done.needsFinish, false);
  assert.equal(done.finishedOn, "2026-11-11");
  assert.equal(done.day, null);
  assert.equal(done.daysToGo, null);
});

test("before the end needsFinish is false; no events means nothing running", () => {
  assert.equal(charmState([ev("start", "2026-10-21")], "2026-11-10").needsFinish, false);
  const none = charmState([], "2026-10-21");
  assert.equal(none.running, false);
  assert.equal(none.started, null);
  assert.equal(none.end, null);
  assert.equal(none.day, null);
  assert.deepEqual(none.open, []);
});

test("open question: today only, closed by reset or kept of the same conversation", () => {
  const start = ev("start", "2026-10-21");
  const asked = (date, conversation, hour = "10") => ({ kind: "asked", date, when: `${date}T${hour}:00:00Z`, conversation, words: "ugh" });
  const open = charmState([start, asked("2026-10-25", "A")], "2026-10-25").open;
  assert.deepEqual(open, [{ conversation: "A", words: "ugh", when: "2026-10-25T10:00:00Z" }]);
  const kept = charmState([start, asked("2026-10-25", "A"), { kind: "kept", date: "2026-10-25", when: "2026-10-25T11:00:00Z", conversation: "A" }], "2026-10-25");
  assert.deepEqual(kept.open, []);
  assert.equal(kept.kept, 1);
  assert.deepEqual(charmState([start, asked("2026-10-24", "A")], "2026-10-25").open, []);
  // kept in conversation A leaves B's question open
  const two = charmState([start, asked("2026-10-25", "A"), asked("2026-10-25", "B", "11"), { kind: "kept", date: "2026-10-25", when: "2026-10-25T12:00:00Z", conversation: "A" }], "2026-10-25");
  assert.deepEqual(two.open.map((o) => o.conversation), ["B"]);
  // any later reset closes every question
  const reset = charmState([start, asked("2026-10-25", "A"), asked("2026-10-25", "B", "11"), { kind: "reset", date: "2026-10-25", when: "2026-10-25T12:00:00Z" }], "2026-10-25");
  assert.deepEqual(reset.open, []);
});

test("a new start forgets everything before it", () => {
  const s = charmState([
    ev("start", "2026-10-21"), ev("reset", "2026-10-25"), ev("kept", "2026-10-26"), ev("stop", "2026-10-27"),
    ev("start", "2026-12-01"),
  ], "2026-12-01");
  assert.equal(s.restarts, 0);
  assert.equal(s.kept, 0);
  assert.equal(s.longestRun, 0);
  assert.equal(s.running, true);
  assert.equal(s.challengeStarted, "2026-12-01");
});

test("stop ends the run and keeps the record", () => {
  const s = charmState([ev("start", "2026-10-21"), ev("reset", "2026-10-25"), ev("stop", "2026-10-27")], "2026-10-30");
  assert.equal(s.running, false);
  assert.equal(s.restarts, 1);
  assert.equal(s.longestRun, 4);
  assert.equal(s.day, null);
  assert.equal(s.daysToGo, null);
});

test("events given out of order are read in time order", () => {
  const s = charmState([ev("reset", "2026-10-22"), ev("start", "2026-10-21")], "2026-10-22");
  assert.equal(s.restarts, 1);
  assert.equal(s.started, "2026-10-22");
});
