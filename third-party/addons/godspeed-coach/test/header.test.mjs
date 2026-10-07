import assert from "node:assert/strict";
import test from "node:test";
import { parseDoc, setHead, appendToSection, formatDoc } from "../lib/header.mjs";
import { zonedToUtc, addDays, weekdayOf, daysBetween } from "../lib/clock.mjs";

const AREA = `AREA: health
RHYTHM: weekly sunday
MAY READ: the daily table
MAY READ: godspeed-headache patterns --days 30
LIMIT: never diagnose

## Preparation
Search the three sources.
Then pick one thing.

## Notes
none`;

test("parseDoc reads the header, repeated keys and sections", () => {
  const d = parseDoc(AREA);
  assert.equal(d.head.RHYTHM, "weekly sunday");
  assert.equal(d.head["MAY READ"], "the daily table");
  assert.deepEqual(d.lists["MAY READ"], ["the daily table", "godspeed-headache patterns --days 30"]);
  assert.equal(d.sections.Preparation, "Search the three sources.\nThen pick one thing.");
  assert.equal(d.sections.Notes, "none");
  assert.deepEqual(parseDoc("").head, {});
});

test("setHead replaces a key or inserts it at the end of the header", () => {
  const a = setHead(AREA, "RHYTHM", "weekly wednesday");
  assert.equal(parseDoc(a).head.RHYTHM, "weekly wednesday");
  assert.equal(parseDoc(a).sections.Preparation, parseDoc(AREA).sections.Preparation);
  const b = setHead(AREA, "STATUS", "paused");
  assert.equal(parseDoc(b).head.STATUS, "paused");
  assert.match(b, /LIMIT: never diagnose\nSTATUS: paused\n\n## Preparation/);
});

test("appendToSection adds a line at the end of a section or creates it", () => {
  const a = appendToSection("HABIT: x\n\n## Days\n- 2026-09-29 done (cli) \"\"\n", "Days", "- 2026-09-30 no (cli) \"\"");
  assert.deepEqual(parseDoc(a).sections.Days.split("\n"), ["- 2026-09-29 done (cli) \"\"", "- 2026-09-30 no (cli) \"\""]);
  const b = appendToSection("HABIT: x\n", "Days", "- 2026-09-29 done (cli) \"\"");
  assert.equal(parseDoc(b).sections.Days, "- 2026-09-29 done (cli) \"\"");
  const c = appendToSection(AREA, "Preparation", "Third line.");
  assert.equal(parseDoc(c).sections.Preparation.split("\n").at(-1), "Third line.");
  assert.equal(parseDoc(c).sections.Notes, "none");
});

test("formatDoc writes a header and sections parseDoc reads back", () => {
  const t = formatDoc({ TALK: "health", "FOLLOW-UP": "" }, { "What was read": "", "The opening": "Hello." });
  const d = parseDoc(t);
  assert.equal(d.head.TALK, "health"); assert.equal(d.head["FOLLOW-UP"], "");
  assert.equal(d.sections["The opening"], "Hello.");
});

test("zonedToUtc follows Berlin across the October clock change", () => {
  assert.equal(zonedToUtc("2026-10-04", "19:00", "Europe/Berlin").toISOString(), "2026-10-04T17:00:00.000Z");
  assert.equal(zonedToUtc("2026-10-25", "19:00", "Europe/Berlin").toISOString(), "2026-10-25T18:00:00.000Z");
  assert.equal(zonedToUtc("2026-11-01", "19:00", "Europe/Berlin").toISOString(), "2026-11-01T18:00:00.000Z");
  assert.equal(zonedToUtc("2026-10-04", "19:00", "UTC").toISOString(), "2026-10-04T19:00:00.000Z");
});

test("date helpers", () => {
  assert.equal(addDays("2026-09-30", 1), "2026-10-01");
  assert.equal(weekdayOf("2026-10-04"), "sun");
  assert.equal(daysBetween("2026-09-29", "2026-10-04"), 5);
});
