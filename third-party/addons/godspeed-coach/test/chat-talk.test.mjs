// Without a messenger a talk still opens at its time and waits in the chat: the [godspeed-coach]
// block brings it up the first time the person writes, once. Until 8 October 2026 setup refused
// talks on a computer without Telegram ("Talks need your assistant on a messenger (Chapter 32)").
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { tmpMission, area, S } from "./helpers.mjs";
import { contextBlock, waitingTalks } from "../lib/context.mjs";
import { listAreas } from "../lib/areas.mjs";
import { openTalk, readTalk } from "../lib/talks.mjs";
import { saveSettings, validateSettings } from "../lib/settings.mjs";
import { hasTalkJob, hasTickJob, NO_MESSENGER } from "../lib/setup.mjs";
import { brief } from "../lib/brief.mjs";
import { gate } from "../lib/gate.mjs";

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

// A talk they start themselves in the chat ("Can we do the health talk now?"): the opening is the reply
// they are reading, so it is seen already. Until 14 October 2026 its record got no SHOWN, and the next
// conversation brought it up again as a waiting talk, under the psychology talk's own opening. The
// command line `brief` prints for that path carries --shown; the scheduled talk's brief (the gate)
// never does, and a scheduled run never marks a talk seen.
const cli = (mc, env, ...args) => spawnSync(process.execPath, [BIN, ...args, "--godspeed", mc], {
  encoding: "utf8", env: { ...process.env, GODSPEED_NOW: AT.toISOString(), GODSPEED_COACH_GIT_SYNC: "off", GODSPEED_SCHEDULED_RUN: "", ...env },
});
function chatMission() {
  const mc = tmpMission({ "coach/health/area.md": area({ AREA: "health", TITLE: "Health", TIME: "19:00" }) });
  saveSettings(mc, { ...S, talk_delivery: "chat" });
  return { mc, a: listAreas(mc)[0] };
}

test("the brief they ask for in the chat prints the open command with --shown; the scheduled talk's brief does not", () => {
  const { mc, a } = chatMission();
  const asked = cli(mc, {}, "brief", "health");
  assert.equal(asked.status, 0, asked.stderr);
  const home = mc.replace(/\\/g, "/");
  assert.ok(asked.stdout.includes(`created by (run it exactly like this): godspeed-coach talk open health --godspeed "${home}" --opening "<the opening>" --read "<what you read>" --shown\n`), asked.stdout.split("\n")[1]);
  // The library's brief, which the gate prints for a talk due at its time, has no --shown.
  assert.doesNotMatch(brief(mc, { ...S, talk_delivery: "chat" }, a, "2026-10-11"), /--shown/);
  assert.match(brief(mc, { ...S, talk_delivery: "chat" }, a, "2026-10-11", { inChat: true }), /--read "<what you read>" --shown$/m);
  const statePath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "coach-state-")), "state.json");
  const due = gate(mc, { ...S, talk_delivery: "chat" }, new Date("2026-10-11T17:00:00Z"), statePath);
  assert.equal(due.wake, true);
  assert.match(due.output, /godspeed-coach talk open health --godspeed "[^"]+" --opening "<the opening>" --read "<what you read>"\n/);
  assert.doesNotMatch(due.output, /--shown/);
});

test("talk open --shown records the talk as seen, so it never waits for the chat; a scheduled run never does", () => {
  const { mc, a } = chatMission();
  const opening = "From your coach, your weekly health talk: on Monday you said the headaches came after short nights. What made Thursday's night short?";
  const r = cli(mc, {}, "talk", "open", "health", "--opening", opening, "--read", "headache tracker", "--shown");
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readTalk(a, "2026-10-11").shown, "2026-10-11T16:05:00Z", "SHOWN as setShown writes it");
  assert.equal(waitingTalks(mc, { ...S, talk_delivery: "chat" }, AT).length, 0);
  // The next conversation sees an open talk, not a waiting one: its opening is not brought up again.
  const next = context(mc);
  assert.doesNotMatch(next.stdout, /Waiting talk/);
  assert.match(next.stdout, /Open talk: Health/);
  assert.doesNotMatch(next.stdout, /headaches came after short nights/);
  // A scheduled run never marks a talk seen, with GODSPEED_SCHEDULED_RUN or --scheduled.
  for (const [env, extra] of [[{ GODSPEED_SCHEDULED_RUN: "1" }, []], [{}, ["--scheduled"]]]) {
    const other = chatMission();
    const s = cli(other.mc, env, "talk", "open", "health", "--opening", opening, "--shown", ...extra);
    assert.equal(s.status, 0, s.stderr);
    assert.equal(readTalk(other.a, "2026-10-11").shown, "");
    assert.equal(waitingTalks(other.mc, { ...S, talk_delivery: "chat" }, AT).length, 1, "it still waits for the chat");
  }
  // Without the flag nothing changes: the talk is brought up once more in the next conversation.
  const plain = chatMission();
  cli(plain.mc, {}, "talk", "open", "health", "--opening", opening);
  assert.equal(readTalk(plain.a, "2026-10-11").shown, "");
  assert.match(context(plain.mc).stdout, /Waiting talk: Health/);
});

// The capture of 14 October 2026 (99e85dc): the health talk was open, the person asked "Can we do the
// psychology talk now?", and the block's "Their reply continues it" made the model save that as an
// answer to the health talk, twice, and open no psychology talk. The block now names the other-talk
// case, for an open talk and a waiting one alike, and the other talk opens while this one stays open.
const OTHER = 'A message that asks for another talk ("can we do the work talk now?") starts that talk instead and leaves this one open: "A talk they start themselves".';
test("while one talk is open or waiting, the block says asking for another talk starts that one, and the open one is left as it is", () => {
  const mc = tmpMission({
    "coach/health/area.md": area({ AREA: "health", TITLE: "Health", TIME: "19:00" }),
    "coach/psychology/area.md": area({ AREA: "psychology", TITLE: "Psychology", RHYTHM: "weekly wednesday", TIME: "20:00", STYLE: "compass" }),
  });
  saveSettings(mc, { ...S, talk_delivery: "chat" });
  const [health] = listAreas(mc).filter((a) => a.slug === "health");
  openTalk(health, "2026-10-11", { opening: "From your coach, your weekly health talk: what did those three headache days have in common?" }, new Date("2026-10-11T16:00:00Z"));
  // Waiting for the chat, the first time.
  const waiting = context(mc).stdout.split("\n").find((l) => l.startsWith("- Waiting talk:"));
  assert.equal(waiting, `- Waiting talk: Health (id for commands: health), opened today at 18:00, record coach/health/talks/2026-10-11.md. There is no messenger, so they have not seen it yet: it waited for this chat. First answer their message; then bring the talk up in a short sentence or two that make sense on their own and end with its question. It opened with: "From your coach, your weekly health talk: what did those three headache days have in common?". Bring it up once, in this reply only. An answer to it continues it: follow the coach recipe, "Continuing a talk". ${OTHER}`);
  // From then on, an open talk.
  const open = context(mc).stdout.split("\n").find((l) => l.startsWith("- Open talk:"));
  assert.equal(open, `- Open talk: Health (id for commands: health), opened today at 18:00, record coach/health/talks/2026-10-11.md. A reply to it continues it: follow the coach recipe, "Continuing a talk". ${OTHER}`);
  // "Can we do the psychology talk now?": its brief, then its own record; the health talk is left as it was.
  const record = path.join(mc, "coach", "health", "talks", "2026-10-11.md"), before = fs.readFileSync(record, "utf8");
  const run = (...args) => spawnSync(process.execPath, [BIN, ...args, "--godspeed", mc], { encoding: "utf8", env: { ...process.env, GODSPEED_NOW: AT.toISOString(), GODSPEED_COACH_GIT_SYNC: "off", GODSPEED_SCHEDULED_RUN: "" } });
  assert.match(run("brief", "psychology").stdout, /^COACH TALK DUE: Psychology \(id for commands: psychology\), 2026-10-11/);
  assert.equal(run("talk", "open", "psychology", "--opening", "From your coach, your psychology talk: what is on your mind this week?", "--shown").stdout.trim(), "Opened: coach/psychology/talks/2026-10-11.md");
  assert.equal(fs.readFileSync(record, "utf8"), before, "nothing saved as an answer to the health talk");
  const both = context(mc).stdout;
  assert.match(both, /^- Open talk: Health \(id for commands: health\),/m);
  assert.match(both, /^- Open talk: Psychology \(id for commands: psychology\),/m);
  assert.doesNotMatch(both, /Waiting talk/);
});
