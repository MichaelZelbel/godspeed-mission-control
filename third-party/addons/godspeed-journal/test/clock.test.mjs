import assert from "node:assert/strict";
import test from "node:test";
import { localParts, minutesBetween, inQuietHours, now, whenSaid, parseWhen } from "../lib/clock.mjs";

test("localParts converts to the configured zone", () => {
  const p = localParts(new Date("2026-09-22T08:40:12Z"), "Europe/Berlin");
  assert.equal(p.date, "2026-09-22"); assert.equal(p.hm, "10:40"); assert.equal(p.hms, "104012"); assert.equal(p.weekday, "tue");
});

test("minutesBetween rounds", () => {
  assert.equal(minutesBetween(new Date("2026-09-22T08:00:00Z"), new Date("2026-09-22T11:00:29Z")), 180);
});

test("quiet hours work across midnight and inside a day", () => {
  assert.equal(inQuietHours("23:10", "21:00-08:00"), true);
  assert.equal(inQuietHours("07:59", "21:00-08:00"), true);
  assert.equal(inQuietHours("08:00", "21:00-08:00"), false);
  assert.equal(inQuietHours("13:00", "12:00-14:00"), true);
  assert.equal(inQuietHours("13:00", ""), false);
});

test("whenSaid writes the moment the way a person says it", () => {
  const now = new Date("2026-09-30T16:00:00Z"); // Wed 18:00 Berlin
  const tz = "Europe/Berlin";
  assert.equal(whenSaid("2026-09-30T10:59:00Z", now, tz), "today at 12:59");
  assert.equal(whenSaid("2026-09-29T20:09:00Z", now, tz), "yesterday at 22:09");
  assert.equal(whenSaid("2026-09-28T12:20:00Z", now, tz), "on Monday at 14:20");
  assert.equal(whenSaid("2026-09-20T12:20:00Z", now, tz), "on 20 September at 14:20");
  assert.equal(whenSaid("2026-09-30T10:59:00Z", now, tz, "de"), "heute um 12:59");
  assert.equal(whenSaid("2026-09-29T20:09:00Z", now, tz, "de"), "gestern um 22:09");
  assert.equal(whenSaid("2026-09-28T12:20:00Z", now, tz, "de"), "am Montag um 14:20");
  assert.equal(whenSaid("2026-09-20T12:20:00Z", now, tz, "de"), "am 20. September um 14:20");
  // Midnight in Berlin, not in UTC, decides what "yesterday" is.
  assert.equal(whenSaid("2026-09-29T22:30:00Z", now, tz), "today at 00:30");
});

test("GODSPEED_NOW fixes the clock", () => {
  process.env.GODSPEED_NOW = "2026-09-22T08:00:00.000Z";
  assert.equal(now().toISOString(), "2026-09-22T08:00:00.000Z");
  delete process.env.GODSPEED_NOW;
});

// Wed 11 November 2026, 15:00 in Berlin (standard time, UTC+1).
const NOW = new Date("2026-11-11T14:00:00Z");
const BERLIN = "Europe/Berlin";
const iso = (r) => JSON.parse(JSON.stringify(r));
const at = (words, now = NOW, tz = BERLIN) => iso(parseWhen(words, now, tz));

test("parseWhen reads the times people say, in English and in German, as the same instants", () => {
  const pairs = [
    ["an hour ago", "vor einer Stunde", { at: "2026-11-11T13:00:00.000Z" }],
    ["20 minutes ago", "vor 20 Minuten", { at: "2026-11-11T13:40:00.000Z" }],
    ["half an hour ago", "vor einer halben Stunde", { at: "2026-11-11T13:30:00.000Z" }],
    ["an hour and a half ago", "vor anderthalb Stunden", { at: "2026-11-11T12:30:00.000Z" }],
    ["at 11", "um 11", { at: "2026-11-11T10:00:00.000Z" }],
    ["at 11 o'clock", "um 11 Uhr", { at: "2026-11-11T10:00:00.000Z" }],
    ["at half past nine", "um halb zehn", { at: "2026-11-11T08:30:00.000Z" }],
    ["quarter to ten", "viertel vor zehn", { at: "2026-11-11T08:45:00.000Z" }],
    ["this morning", "heute Morgen", { at: "2026-11-11T08:00:00.000Z" }],
    ["yesterday afternoon", "gestern Nachmittag", { at: "2026-11-10T14:00:00.000Z" }],
    ["last night", "gestern Abend um 10", { at: "2026-11-10T21:00:00.000Z" }],
    ["from 9 to 10:30", "von 9 bis 10:30", { start: "2026-11-11T08:00:00.000Z", end: "2026-11-11T09:30:00.000Z" }],
    ["between 9 and 10:30", "zwischen 9 und 10:30", { start: "2026-11-11T08:00:00.000Z", end: "2026-11-11T09:30:00.000Z" }],
  ];
  for (const [en, de, want] of pairs) {
    assert.deepEqual(at(en), want, en);
    assert.deepEqual(at(de), want, de);
  }
  assert.deepEqual(at("11:30"), { at: "2026-11-11T10:30:00.000Z" });
  assert.deepEqual(at("2 pm"), { at: "2026-11-11T13:00:00.000Z" });
  assert.deepEqual(at("nachmittags um 2"), { at: "2026-11-11T13:00:00.000Z" });
});

test("parseWhen asks which time when the words fit two, and takes the one an explicit hour names", () => {
  const evening = new Date("2026-11-11T21:00:00Z"); // 22:00 in Berlin
  const both = { ask: "which", options: ["2026-11-11T08:00:00.000Z", "2026-11-11T20:00:00.000Z"] };
  assert.deepEqual(at("at 9", evening), both);
  assert.deepEqual(at("um 9", evening), both);
  assert.deepEqual(at("09:00", evening), { at: "2026-11-11T08:00:00.000Z" });
  assert.deepEqual(at("21:00", evening), { at: "2026-11-11T20:00:00.000Z" });
});

test("parseWhen never records a time still ahead, a span that ends before it starts, or words it cannot read", () => {
  assert.deepEqual(at("at 17:00"), { ask: "future", at: "2026-11-11T16:00:00.000Z" });
  assert.deepEqual(at("um 17 Uhr"), { ask: "future", at: "2026-11-11T16:00:00.000Z" });
  assert.equal(at("from 10:30 to 09:00").ask, "order");
  for (const words of ["a while ago", "irgendwann", "100 hours ago", "morgen", "tonight", "on Monday"]) assert.deepEqual(at(words), { ask: "unknown" }, words);
});

test("parseWhen reads the time in the configured zone, across daylight saving and midnight", () => {
  assert.deepEqual(at("at 8"), { at: "2026-11-11T07:00:00.000Z" });
  assert.deepEqual(at("at 8", NOW, "America/New_York"), { at: "2026-11-11T13:00:00.000Z" });
  assert.deepEqual(at("um halb zehn", new Date("2026-03-29T10:00:00Z")), { at: "2026-03-29T07:30:00.000Z" });
  // 00:30 on 12 November in Berlin: "23:00" is the evening before.
  assert.deepEqual(at("23:00", new Date("2026-11-11T23:30:00Z")), { at: "2026-11-11T22:00:00.000Z" });
});
