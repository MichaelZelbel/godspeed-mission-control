import assert from "node:assert/strict";
import test from "node:test";
import { localParts, minutesBetween, inQuietHours, now, whenSaid, parseWhen, spanSaid } from "../lib/clock.mjs";

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

// Every option a question offers, said back word for word, settles it: the person answers with
// the journal's own words, and a second question about the same time would be a loop.
test("parseWhen settles each option its own question offers, for 11 and 12 o'clock, in English and German", () => {
  const late = new Date("2026-11-11T22:30:00Z"); // 23:30 in Berlin
  for (const words of ["at 11", "um 11", "at 12", "um 12", "um halb zwölf"]) {
    const r = parseWhen(words, late, BERLIN);
    assert.equal(r.ask, "which", words);
    for (const lang of ["en", "de"]) {
      for (const option of r.options) {
        const said = whenSaid(option.toISOString(), late, BERLIN, lang);
        assert.deepEqual(parseWhen(said, late, BERLIN), { at: option }, `${words} -> ${said}`);
        const time = said.slice(-5);
        assert.deepEqual(parseWhen(time, late, BERLIN), { at: option }, `${words} -> ${time}`);
      }
    }
  }
});

test("a span question offers spans, and each one said back settles it", () => {
  const late = new Date("2026-11-11T22:30:00Z"); // 23:30 in Berlin
  const r = parseWhen("from 9 to 10", late, BERLIN);
  assert.equal(r.ask, "which");
  const offered = r.spans.map(([a, b]) => [spanSaid(a, b, late, BERLIN), spanSaid(a, b, late, BERLIN, "de")]);
  assert.deepEqual(offered, [["today from 09:00 to 10:00", "heute von 09:00 bis 10:00"], ["today from 21:00 to 22:00", "heute von 21:00 bis 22:00"]]);
  r.spans.forEach(([start, end], i) => {
    for (const said of offered[i]) assert.deepEqual(parseWhen(said, late, BERLIN), { start, end }, said);
  });
});

test("a span question names the real problem, and an end that fixes the half of the day fixes the start", () => {
  const afternoon = new Date("2026-11-11T14:00:00Z"); // 15:00 in Berlin
  assert.deepEqual(at("from 9 to 23:59", afternoon), { ask: "future", at: "2026-11-11T22:59:00.000Z" });
  assert.deepEqual(at("from 10 to 9", afternoon), { ask: "order" });
  assert.deepEqual(at("from 14:00 to 13:00", afternoon), { ask: "order" });
  assert.deepEqual(at("von 12 bis 13 Uhr", afternoon), { start: "2026-11-11T11:00:00.000Z", end: "2026-11-11T12:00:00.000Z" });
  assert.deepEqual(at("from 11 to 1", afternoon), { start: "2026-11-11T10:00:00.000Z", end: "2026-11-11T12:00:00.000Z" });
  assert.deepEqual(at("from 9 to 5", afternoon), { ask: "future", at: "2026-11-11T16:00:00.000Z" });
  assert.deepEqual(at("from 08:00 to 14:30", afternoon), { start: "2026-11-11T07:00:00.000Z", end: "2026-11-11T13:30:00.000Z" });
  assert.deepEqual(at("from 23:00 to 01:00", new Date("2026-11-12T08:00:00Z")), { start: "2026-11-11T22:00:00.000Z", end: "2026-11-12T00:00:00.000Z" });
});

test("a time before the move's earliest possible moment is never offered", () => {
  const afternoon = new Date("2026-11-11T14:00:00Z"); // 15:00 in Berlin
  const started = new Date("2026-11-11T12:00:00Z"); // 13:00 in Berlin
  // 00:00 and 12:00 are both before the start: no choice is offered, the latest comes back for
  // the caller's before-start question.
  assert.deepEqual(iso(parseWhen("at 12", afternoon, BERLIN, { after: started })), { at: "2026-11-11T11:00:00.000Z" });
  // 02:00 is before the start, 14:00 is not: that settles it.
  assert.deepEqual(iso(parseWhen("at 2", afternoon, BERLIN, { after: started })), { at: "2026-11-11T13:00:00.000Z" });
  assert.deepEqual(iso(parseWhen("at 2", afternoon, BERLIN)), { ask: "which", options: ["2026-11-11T01:00:00.000Z", "2026-11-11T13:00:00.000Z"] });
});
