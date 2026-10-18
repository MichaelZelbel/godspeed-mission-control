import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { readArea } from "../lib/areas.mjs";
import { talkDue, followUpDue, notHeldDue, missedInARow, openTalk, readTalk, setTalkState, setFollowUp, addSaid, openTalks, lastTalk } from "../lib/talks.mjs";
import { tmpMission, area } from "./helpers.mjs";

const TZ = "Europe/Berlin";
const at = (iso) => new Date(iso);
const setup = (over) => { const mc = tmpMission({ "coach/health/area.md": area(over) }); return { mc, a: readArea(path.join(mc, "coach", "health")) }; };

test("a talk is due from its local moment for six hours, once, in summer and winter time", () => {
  const { a } = setup();
  assert.equal(talkDue(a, at("2026-10-04T16:59:00Z"), TZ), null);
  assert.equal(talkDue(a, at("2026-10-04T17:00:00Z"), TZ), "2026-10-04");
  assert.equal(talkDue(a, at("2026-10-04T21:30:00Z"), TZ), "2026-10-04");
  assert.equal(talkDue(a, at("2026-10-04T23:30:00Z"), TZ), null, "not after six hours");
  assert.equal(talkDue(a, at("2026-11-01T17:30:00Z"), TZ), null, "winter: 19:00 Berlin is 18:00 UTC");
  assert.equal(talkDue(a, at("2026-11-01T18:00:00Z"), TZ), "2026-11-01");
  openTalk(a, "2026-10-04", { opening: "Hi." }, at("2026-10-04T17:01:00Z"));
  assert.equal(talkDue(a, at("2026-10-04T17:20:00Z"), TZ), null, "not when the record exists");
});

test("opening twice keeps the first record", () => {
  const { a } = setup();
  const r1 = openTalk(a, "2026-10-04", { opening: "First." }, at("2026-10-04T17:01:00Z"));
  const r2 = openTalk(a, "2026-10-04", { opening: "Second." }, at("2026-10-04T18:01:00Z"));
  assert.equal(r1.created, true); assert.equal(r2.created, false);
  assert.equal(readTalk(a, "2026-10-04").sections["The opening"], "First.");
  assert.equal(readTalk(a, "2026-10-04").opened, "2026-10-04T17:01:00Z");
});

test("no answer: follow-up the next evening, not-held twenty hours later", () => {
  const { a } = setup();
  openTalk(a, "2026-10-04", { opening: "Hi." }, at("2026-10-04T17:01:00Z"));
  assert.equal(followUpDue(a, at("2026-10-05T16:59:00Z"), TZ), null);
  assert.equal(followUpDue(a, at("2026-10-05T17:00:00Z"), TZ), "2026-10-04");
  setFollowUp(a, "2026-10-04", "2026-10-05T17:00:00Z");
  assert.equal(followUpDue(a, at("2026-10-05T17:15:00Z"), TZ), null, "only once");
  assert.deepEqual(notHeldDue(a, at("2026-10-06T12:59:00Z"), TZ), []);
  assert.deepEqual(notHeldDue(a, at("2026-10-06T13:00:00Z"), TZ), ["2026-10-04"]);
});

test("an answered talk is never followed up or recorded not-held", () => {
  const { a } = setup();
  openTalk(a, "2026-10-04", { opening: "Hi." }, at("2026-10-04T17:01:00Z"));
  addSaid(a, "2026-10-04", "- 19:20 most evenings, about an hour");
  assert.equal(readTalk(a, "2026-10-04").answered, true);
  assert.equal(followUpDue(a, at("2026-10-05T17:00:00Z"), TZ), null);
  assert.deepEqual(notHeldDue(a, at("2026-10-12T13:00:00Z"), TZ), []);
});

test("a daily area: the next talk replaces the follow-up and supersedes the silent one", () => {
  const { a } = setup({ RHYTHM: "daily" });
  openTalk(a, "2026-10-04", { opening: "Hi." }, at("2026-10-04T17:01:00Z"));
  assert.equal(followUpDue(a, at("2026-10-05T17:00:00Z"), TZ), null);
  openTalk(a, "2026-10-05", { opening: "Hi again." }, at("2026-10-05T17:01:00Z"));
  assert.deepEqual(notHeldDue(a, at("2026-10-05T17:15:00Z"), TZ), ["2026-10-04"]);
});

test("missed in a row counts the trailing not-held talks; open talks are listed", () => {
  const { mc, a } = setup();
  for (const d of ["2026-10-04", "2026-10-11", "2026-10-18", "2026-10-25"]) openTalk(a, d, {}, at(d + "T17:00:00Z"));
  setTalkState(a, "2026-10-04", "held");
  for (const d of ["2026-10-11", "2026-10-18", "2026-10-25"]) setTalkState(a, d, "not-held");
  assert.equal(missedInARow(a), 3);
  assert.equal(lastTalk(a, "2026-10-25").ymd, "2026-10-18");
  setTalkState(a, "2026-10-25", "opened");
  assert.equal(missedInARow(a), 0);
  assert.deepEqual(openTalks(mc, at("2026-10-26T08:00:00Z")).map((o) => o.ymd), ["2026-10-25"]);
  assert.deepEqual(openTalks(mc, at("2026-10-30T08:00:00Z")), []);
  assert.ok(fs.existsSync(path.join(mc, "coach", "health", "talks", "2026-10-25.md")));
});
