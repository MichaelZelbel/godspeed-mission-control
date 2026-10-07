import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { dueTick } from "../lib/tick.mjs";
import { contextBlock } from "../lib/context.mjs";
import { readArea } from "../lib/areas.mjs";
import { openTalk, setFollowUp } from "../lib/talks.mjs";
import { addHabit, track, findHabit } from "../lib/habits.mjs";
import { dayWords, whenSaid } from "../lib/clock.mjs";
import { tmpMission, area, S } from "./helpers.mjs";

const at = (iso) => new Date(iso);
const mission = () => tmpMission({ "coach/health/area.md": area(), "coach/work/area.md": area({ AREA: "work", TITLE: "Work and money", RHYTHM: "weekly wednesday", STARTS: "2026-10-14" }) });

// Applies writes the way the command does, so a second tick sees the first one's record.
function apply(mc, writes) {
  for (const w of writes) {
    if (w.kind === "asked") track(w.habit, w.ymd, "asked", "tick", "");
    if (w.kind === "auto") track(w.habit, w.ymd, "done", "data", w.words);
    if (w.kind === "follow-up") setFollowUp(w.area, w.ymd, w.at);
  }
}

test("the habit check: at 21:00 Berlin, once, only for what is not tracked", () => {
  const mc = mission();
  addHabit(mc, { area: "health", slug: "head-lifts", title: "Face-down head lifts", days: "daily" }, "2026-09-29");
  addHabit(mc, { area: "health", title: "Run", days: "daily", auto: "run_km > 0" }, "2026-09-29");
  assert.deepEqual(dueTick(mc, S, at("2026-09-29T18:59:00Z")).messages, [], "20:59 Berlin");
  const t1 = dueTick(mc, S, at("2026-09-29T19:00:00Z"));
  assert.deepEqual(t1.messages, [[
    "From your coach: Face-down head lifts today? You planned this habit for every day, and nothing is tracked for today yet.",
    `Reply "yes" if you did it, "no" if you didn't, or "skip" if today shouldn't count, for example because you were ill. No reply is fine: the day stays blank and I won't ask about it again.`,
  ].join("\n")]);
  apply(mc, t1.writes);
  assert.deepEqual(dueTick(mc, S, at("2026-09-29T19:15:00Z")).messages, [], "never a second message");
});

test("everything tracked means no habit message; several pending share one message", () => {
  const mc = mission();
  let h = addHabit(mc, { area: "health", slug: "head-lifts", title: "Face-down head lifts", days: "daily" }, "2026-09-29");
  track(h, "2026-09-29", "done", "telegram", "did head lifts");
  assert.deepEqual(dueTick(mc, S, at("2026-09-29T19:00:00Z")).messages, []);
  addHabit(mc, { area: "work", title: "Evening walk", days: "daily" }, "2026-09-30");
  addHabit(mc, { area: "work", title: "Reading", days: "daily" }, "2026-09-30");
  assert.deepEqual(dueTick(mc, S, at("2026-09-30T19:00:00Z")).messages, [[
    "From your coach: 3 of your habits have nothing tracked for today yet.",
    "• Face-down head lifts",
    "• Evening walk",
    "• Reading",
    `Did you do them? Reply yes, no or skip for each, in this order, for example "yes no yes", or one word for all of them. "skip" means today shouldn't count, for example because you were ill. No reply is fine: the day stays blank and I won't ask about it again.`,
  ].join("\n")]);
  assert.deepEqual(dueTick(mc, { ...S, language: "de" }, at("2026-10-01T19:00:00Z")).messages, [[
    "Von deinem Coach: Für 3 deiner Gewohnheiten ist heute noch nichts eingetragen.",
    "• Face-down head lifts",
    "• Evening walk",
    "• Reading",
    "Hast du sie gemacht? Antworte für jede mit ja, nein oder skip, in dieser Reihenfolge, zum Beispiel „ja nein ja“, oder mit einem Wort für alle. „skip“ heißt: Heute soll nicht zählen, zum Beispiel weil du krank warst. Keine Antwort ist auch in Ordnung: Der Tag bleibt leer, und ich frage nicht noch einmal danach.",
  ].join("\n")]);
});

test("the habit check names the days and what counts as done, in English and German", () => {
  const mc = mission();
  addHabit(mc, { area: "health", slug: "head-lifts", title: "Face-down head lifts", doneMeans: "a few 10-second holds.", days: "fri,mon,wed" }, "2026-09-28");
  assert.deepEqual(dueTick(mc, S, at("2026-09-30T19:00:00Z")).messages, [[
    "From your coach: Face-down head lifts today? You planned this habit for every Monday, Wednesday and Friday, and nothing is tracked for today yet. You said it counts as done when: a few 10-second holds.",
    `Reply "yes" if you did it, "no" if you didn't, or "skip" if today shouldn't count, for example because you were ill. No reply is fine: the day stays blank and I won't ask about it again.`,
  ].join("\n")]);
  assert.deepEqual(dueTick(mc, { ...S, language: "de" }, at("2026-10-02T19:00:00Z")).messages, [[
    "Von deinem Coach: Face-down head lifts heute? Du hast dir diese Gewohnheit für jeden Montag, Mittwoch und Freitag vorgenommen, und für heute ist noch nichts eingetragen. Erledigt ist sie laut dir, wenn: a few 10-second holds.",
    "Antworte „ja“, wenn du es gemacht hast, „nein“, wenn nicht, oder „skip“, wenn heute nicht zählen soll, zum Beispiel weil du krank warst. Keine Antwort ist auch in Ordnung: Der Tag bleibt leer, und ich frage nicht noch einmal danach.",
  ].join("\n")]);
  assert.deepEqual(dueTick(mc, S, at("2026-10-01T19:00:00Z")).messages, [], "Thursday is not one of its days");
});

test("days in words, seen from today", () => {
  assert.equal(dayWords("2026-10-04", "2026-10-04"), "today");
  assert.equal(dayWords("2026-10-05", "2026-10-04"), "tomorrow");
  assert.equal(dayWords("2026-10-03", "2026-10-04", "de"), "gestern");
  assert.equal(dayWords("2026-10-11", "2026-10-05"), "on Sunday");
  assert.equal(dayWords("2026-10-11", "2026-10-05", "de"), "am Sonntag");
  assert.equal(dayWords("2026-11-01", "2026-10-05"), "on 1 November");
  assert.equal(dayWords("2026-11-01", "2026-10-05", "de"), "am 1. November");
  assert.equal(whenSaid("2026-10-04T17:01:00Z", at("2026-10-05T17:00:00Z"), "Europe/Berlin"), "yesterday at 19:01");
});

test("a run in the table ticks itself and is never asked", () => {
  const mc = mission();
  addHabit(mc, { area: "health", title: "Run", days: "daily", auto: "run_km > 0" }, "2026-09-29");
  const t = dueTick(mc, S, at("2026-09-29T19:00:00Z"), { "2026-09-29": { date: "2026-09-29", run_km: "5.1" } });
  assert.deepEqual(t.messages, []);
  assert.deepEqual(t.writes.map((w) => `${w.kind} ${w.habit.slug} ${w.ymd}`), ["auto run 2026-09-29"]);
});

test("an unanswered talk: follow-up the next evening, not-held the day after, silently", () => {
  const mc = mission();
  const a = readArea(path.join(mc, "coach", "health"));
  openTalk(a, "2026-10-04", { opening: "Hi." }, at("2026-10-04T17:01:00Z"));
  const t1 = dueTick(mc, S, at("2026-10-05T17:00:00Z"));
  assert.deepEqual(t1.messages, [[
    "From your coach: yesterday at 19:01 I opened your health and fitness talk, and it is still waiting for your reply.",
    'It started with: "Hi."',
    "Still up for it? Just answer, a line is enough, and we carry on from there. No reply is fine: I won't bring it up again, and the next health and fitness talk is on Sunday at 19:00.",
  ].join("\n")]);
  const de = tmpMission({ "coach/health/area.md": area({ TITLE: "Gesundheit" }) });
  openTalk(readArea(path.join(de, "coach", "health")), "2026-10-04", { opening: "Wann kommt die Müdigkeit?" }, at("2026-10-04T17:01:00Z"));
  assert.deepEqual(dueTick(de, { ...S, language: "de" }, at("2026-10-05T17:00:00Z")).messages, [[
    "Von deinem Coach: Ich habe gestern um 19:01 dein Gespräch über Gesundheit begonnen, und es wartet noch auf deine Antwort.",
    "Es fing so an: „Wann kommt die Müdigkeit?“",
    "Noch Lust darauf? Antworte einfach, eine Zeile reicht, dann machen wir dort weiter. Keine Antwort ist auch in Ordnung: Ich spreche es nicht noch einmal an, und das nächste Gespräch über Gesundheit ist am Sonntag um 19:00.",
  ].join("\n")]);
  apply(mc, t1.writes);
  assert.deepEqual(dueTick(mc, S, at("2026-10-05T17:15:00Z")).messages, []);
  const t3 = dueTick(mc, S, at("2026-10-06T13:00:00Z"));
  assert.deepEqual(t3.messages, []);
  assert.deepEqual(t3.writes.map((w) => `${w.kind} ${w.area.slug} ${w.ymd}`), ["not-held health 2026-10-04"]);
});

test("context: an open talk and tonight's unanswered habit check both appear, each named", () => {
  const mc = mission();
  const a = readArea(path.join(mc, "coach", "health"));
  assert.equal(contextBlock(mc, S, at("2026-10-04T19:10:00Z")), "");
  openTalk(a, "2026-10-04", { opening: "Hi." }, at("2026-10-04T17:01:00Z"));
  addHabit(mc, { area: "health", slug: "head-lifts", title: "Face-down head lifts", days: "daily" }, "2026-09-29");
  apply(mc, dueTick(mc, S, at("2026-10-04T19:00:00Z")).writes);
  const head = "[godspeed-coach] For you, not to pass on (times in Europe/Berlin). The coach sends its own habit check and talk follow-up, so never raise a habit or a talk in a reply about something else.";
  const talk = `- Open talk: Health and fitness (id for commands: health), opened today at 19:01, record coach/health/talks/2026-10-04.md. Their reply continues it: follow the coach recipe, "Continuing a talk".`;
  assert.equal(contextBlock(mc, S, at("2026-10-04T19:10:00Z")), [
    head, talk,
    `- Habit check sent tonight, still unanswered, asking in this order: Face-down head lifts. A short yes / no / skip answers it: follow the coach recipe, "Tracking a habit".`,
    `- Active habits: Face-down head lifts (id for commands: head-lifts). "Track <habit>" or "did <habit>" tracks one.`,
  ].join("\n"));
  track(findHabit(mc, "head lifts"), "2026-10-04", "done", "telegram", "yes");
  assert.equal(contextBlock(mc, S, at("2026-10-04T19:20:00Z")), [
    head, talk,
    `- Active habits: Face-down head lifts (id for commands: head-lifts; today: done). "Track <habit>" or "did <habit>" tracks one.`,
  ].join("\n"));
});
