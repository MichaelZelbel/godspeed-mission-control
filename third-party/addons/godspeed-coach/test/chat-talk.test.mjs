// Without a messenger a talk still opens at its time and waits in the chat: the [godspeed-coach]
// block brings it up the first time the person writes, once. Until 8 October 2026 setup refused
// talks on a computer without Telegram ("Talks need your assistant on a messenger (Chapter 32)").
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { tmpMission, area, S } from "./helpers.mjs";
import { contextBlock, waitingTalks } from "../lib/context.mjs";
import { listAreas } from "../lib/areas.mjs";
import { openTalk, readTalk } from "../lib/talks.mjs";
import { saveSettings, validateSettings } from "../lib/settings.mjs";
import { hasTalkJob, hasTickJob, NO_MESSENGER } from "../lib/setup.mjs";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "godspeed-coach.mjs");
const AT = new Date("2026-10-11T16:05:00Z"); // Sunday 18:05 in Berlin, five minutes after the talk opened

function opened(delivery) {
  const mc = tmpMission({ "coach/weekly-check-in/area.md": area({ AREA: "weekly-check-in", TITLE: "Weekly check-in", TIME: "18:00" }) });
  saveSettings(mc, { ...S, talk_delivery: delivery });
  const [a] = listAreas(mc);
  openTalk(a, "2026-10-11", { opening: "From your coach, your weekly check-in: three runs this week. What made Thursday hard?" }, new Date("2026-10-11T16:00:00Z"));
  return { mc, a };
}
const context = (mc, ...extra) => spawnSync(process.execPath, [BIN, "context", "--godspeed", mc, ...extra], {
  encoding: "utf8", env: { ...process.env, GODSPEED_NOW: AT.toISOString(), GODSPEED_COACH_GIT_SYNC: "off", GODSPEED_SCHEDULED_RUN: "" },
});

test("talk delivery is a setting with two values", () => {
  assert.deepEqual(validateSettings({ ...S, talk_delivery: "chat" }), []);
  assert.equal(validateSettings({ ...S, talk_delivery: "phone" }).length, 1);
  assert.doesNotMatch(NO_MESSENGER, /Chapter/);
  assert.equal(hasTalkJob("Weekly check-in  every 15m"), true);
  assert.equal(hasTalkJob("coach-talks"), true);
  assert.equal(hasTickJob("Coach reminders and habit check"), true);
  assert.equal(hasTalkJob("Deadline reminders"), false);
});

test("without a messenger the opened talk waits for the chat and is brought up once", () => {
  const { mc, a } = opened("chat");
  const block = contextBlock(mc, { ...S, talk_delivery: "chat" }, AT);
  assert.match(block, /Waiting talk: Weekly check-in/);
  assert.match(block, /What made Thursday hard\?/);
  assert.match(block, /except a talk marked waiting below/);
  // A scheduled run reads the block too, and is no conversation with them.
  const scheduled = context(mc, "--scheduled");
  assert.equal(scheduled.status, 0, scheduled.stderr);
  assert.match(scheduled.stdout, /Open talk: Weekly check-in/);
  assert.equal(readTalk(a, "2026-10-11").shown, "", "a routine never uses up the once");
  // The first message they write.
  const first = context(mc);
  assert.match(first.stdout, /Waiting talk: Weekly check-in/);
  assert.equal(readTalk(a, "2026-10-11").shown, "2026-10-11T16:05:00Z");
  // From then on it is an open talk like any other: their answer continues it.
  const second = context(mc);
  assert.doesNotMatch(second.stdout, /Waiting talk/);
  assert.match(second.stdout, /Open talk: Weekly check-in/);
  assert.equal(waitingTalks(mc, { ...S, talk_delivery: "chat" }, AT).length, 0);
});

test("with a messenger nothing changes: the talk went to the phone", () => {
  const { mc, a } = opened("messenger");
  const out = context(mc).stdout;
  assert.doesNotMatch(out, /Waiting talk/);
  assert.match(out, /Open talk: Weekly check-in/);
  assert.equal(readTalk(a, "2026-10-11").shown, "");
});
