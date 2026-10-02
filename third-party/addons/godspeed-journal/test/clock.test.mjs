import assert from "node:assert/strict";
import test from "node:test";
import { localParts, minutesBetween, inQuietHours, now, whenSaid } from "../lib/clock.mjs";

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
