import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { gate, NO_WAKE } from "../lib/gate.mjs";
import { brief, queuedQuestions } from "../lib/brief.mjs";
import { readArea } from "../lib/areas.mjs";
import { openTalk, setTalkState } from "../lib/talks.mjs";
import { addHabit, track } from "../lib/habits.mjs";
import { tmpMission, area, S } from "./helpers.mjs";

const at = (iso) => new Date(iso);
const QUESTIONS = `# Questions

### 2026-10-04: tired after washing up

"When it happens: how often, how long?"

### 2026-09-27: an old one

ASKED: 2026-09-27

### 2026-10-11: next week's

Later.
`;
const GOAL = "ID: age-healthy\nTITLE: Age healthy\nMEASURE: sleep and runs\n\n## Log\n- 2026-09-20 FILED x\n- 2026-09-28 ATTENTION long noise\n- 2026-09-28 PROGRESS head lifts adopted\n";

function mission() {
  const mc = tmpMission({ "coach/health/area.md": area(), "coach/health/questions.md": QUESTIONS, "goals/age-healthy.md": GOAL });
  return { mc, statePath: path.join(fs.mkdtempSync(path.join(os.tmpdir(), "coach-state-")), "state.json") };
}

test("the gate stays shut until the talk is due, then wakes once, retries an hour later, three times at most", () => {
  const { mc, statePath } = mission();
  assert.deepEqual(gate(mc, S, at("2026-10-04T16:45:00Z"), statePath), { wake: false, output: NO_WAKE });
  const g1 = gate(mc, S, at("2026-10-04T17:00:00Z"), statePath);
  assert.equal(g1.wake, true); assert.equal(g1.attempt, 1);
  assert.match(g1.output, /^COACH TALK DUE: Health and fitness \(id for commands: health\), 2026-10-04, 19:00 Europe\/Berlin\n/);
  assert.match(g1.output, /\nStyle: review\. Tone: gentle\. Rhythm: every Sunday at 19:00\.\n/, "the rhythm in words, not as the setting");
  assert.match(g1.output, /do not run godspeed sync or git pull/);
  assert.match(g1.output, /## How to open it \(the coach recipe, section "Opening a talk"\)\nThe talk job wakes you/);
  assert.match(g1.output, /answer exactly `\[SILENT\]`/);
  assert.doesNotMatch(g1.output, /## Continuing a talk/, "only the opening section travels");
  assert.equal(gate(mc, S, at("2026-10-04T17:10:00Z"), statePath).wake, false, "not within the hour");
  assert.equal(gate(mc, S, at("2026-10-04T18:01:00Z"), statePath).attempt, 2);
  assert.equal(gate(mc, S, at("2026-10-04T19:02:00Z"), statePath).attempt, 3);
  assert.equal(gate(mc, S, at("2026-10-04T20:03:00Z"), statePath).wake, false, "never a fourth time");
});

test("once the record exists the gate stays shut", () => {
  const { mc, statePath } = mission();
  assert.equal(gate(mc, S, at("2026-10-04T17:00:00Z"), statePath).wake, true);
  openTalk(readArea(path.join(mc, "coach", "health")), "2026-10-04", { opening: "Hi." }, at("2026-10-04T17:02:00Z"));
  assert.equal(gate(mc, S, at("2026-10-04T18:05:00Z"), statePath).wake, false);
});

test("a broken state file does not stop a talk", () => {
  const { mc, statePath } = mission();
  fs.writeFileSync(statePath, "{not json");
  assert.equal(gate(mc, S, at("2026-10-04T17:00:00Z"), statePath).wake, true);
});

test("the brief carries today's queued question, the last talk, habits and goals", () => {
  const { mc } = mission();
  const a = readArea(path.join(mc, "coach", "health"));
  assert.deepEqual(queuedQuestions(a, "2026-10-04").map((q) => q.date), ["2026-10-04"]);
  openTalk(a, "2026-09-27", { opening: "Did you do the head lifts?" }, at("2026-09-27T17:00:00Z"));
  setTalkState(a, "2026-09-27", "held");
  let h = addHabit(mc, { area: "health", slug: "head-lifts", title: "Face-down head lifts", days: "daily" }, "2026-09-29");
  h = track(h, "2026-10-01", "done", "telegram", "did head lifts");
  const b = brief(mc, S, a, "2026-10-04");
  assert.match(b, /### 2026-10-04: tired after washing up/);
  assert.doesNotMatch(b, /an old one/);
  assert.doesNotMatch(b, /next week's/);
  assert.match(b, /coach\/health\/talks\/2026-09-27\.md \(held\)/);
  assert.match(b, /Did you do the head lifts\?/);
  assert.match(b, /Face-down head lifts \(every day\): last 7 days done 1, no 0, skip 0, unknown 5/);
  assert.match(b, /- age-healthy: Age healthy \(measure: sleep and runs\)/);
  assert.match(b, /PROGRESS head lifts adopted/);
  assert.doesNotMatch(b, /ATTENTION long noise/);
  assert.match(b, /Limits, binding:\n- never diagnose/);
  assert.ok(b.includes(`talk open health --godspeed "${mc.replace(/\\/g, "/")}" --opening`), "the command names its folder");
});

test("three unanswered talks in a row: the brief asks about the rhythm", () => {
  const { mc } = mission();
  const a = readArea(path.join(mc, "coach", "health"));
  for (const d of ["2026-10-04", "2026-10-11", "2026-10-18"]) { openTalk(a, d, {}, at(d + "T17:00:00Z")); setTalkState(a, d, "not-held"); }
  assert.ok(brief(mc, S, a, "2026-10-25").includes("\n## Rhythm\nThe last 3 Health and fitness talks got no answer. Instead of pushing on, this opening asks whether the rhythm still suits them, in one or two short sentences that make sense on their own: that the last 3 talks went unanswered, that the talk comes every Sunday at 19:00, and whether to keep it, move it to another day or time, have it less often, or pause it.\n"));
  assert.match(brief(mc, S, a, "2026-10-25"), /### 2026-10-04: tired after washing up/, "an unasked question moves to the next talk");
});
