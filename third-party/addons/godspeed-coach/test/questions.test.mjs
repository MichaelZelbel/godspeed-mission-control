// A talk's live questions (lib/questions.mjs): written when the talk closes, from the goals the area
// serves, what the talk said and promised, the person's corrections and their data; refined only by
// the coach's own command; never duplicated; nothing for an area that serves no goal.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readArea } from "../lib/areas.mjs";
import { dueTick } from "../lib/tick.mjs";
import { brief } from "../lib/brief.mjs";
import { writeQuestions, readQuestions, questionsFile } from "../lib/questions.mjs";
import { tmpMission, area, S } from "./helpers.mjs";

const BIN = fileURLToPath(new URL("../bin/godspeed-coach.mjs", import.meta.url));
const goals = {
  "goals/longevity.md": "ID: longevity\nTITLE: Longevity\nMEASURE: VO2max 50\n",
  "goals/abs.md": "ID: abs\nTITLE: Visible abs\nMEASURE: waist 80 cm\n",
};
const talk = (said, changed, extra = "") => `TALK: health\nDATE: 2026-11-01\nSTATE: opened\nOPENED: 2026-11-01T18:00:00Z\nFOLLOW-UP: \n\n## What was read\nthe week\n\n## The opening\nHow was the week?\n\n## What you said\n${said}\n\n## What changed\n${changed}\n${extra}`;
const SAID = "- 19:05 No, that's wrong: I already walk 10000 steps every day.\n- 19:06 Please look into a broader search for new abs studies.\n- 19:07 Fine otherwise.";
const mission = (over = {}, t = talk(SAID, "- Try creatine 5 g a day for four weeks.")) =>
  tmpMission({ "coach/health/area.md": area({ SERVES: "longevity, abs", ...over }), "coach/health/talks/2026-11-01.md": t, ...goals });
const load = (mc) => readArea(path.join(mc, "coach", "health"));
const items = (mc, d = "2026-11-08") => readQuestions(questionsFile(load(mc), d)).items;
const coach = (mc, ...args) => execFileSync("node", [BIN, ...args, "--godspeed", mc], { encoding: "utf8", env: { ...process.env, GODSPEED_COACH_GIT_SYNC: "off", GODSPEED_NOW: process.env.TEST_NOW || "2026-11-01T19:30:00Z" } });

test("closing a talk writes the next talk's questions: goals, a promise, a correction, an ask, each with why", () => {
  const mc = mission();
  assert.match(coach(mc, "talk", "held", "health", "--json"), /"questions":"coach\/health\/questions\/2026-11-08\.md"/);
  const qs = items(mc);
  const all = qs.map((q) => q.text).join("\n");
  assert.match(all, /"Longevity" \(measure: VO2max 50\)/);
  assert.match(all, /"Visible abs"/);
  assert.match(all, /creatine 5 g/);
  assert.match(all, /corrected this: "No, that's wrong: I already walk 10000 steps every day"/);
  assert.match(all, /broader search for new abs studies/);
  assert.doesNotMatch(all, /Fine otherwise/);
  assert.deepEqual(qs.map((q) => q.origin), ["goal longevity", "goal abs", "changed", "corrected", "asked"]);
  assert.ok(qs.every((q) => q.why.length > 10), "every question says why it is open");
});

test("a second close for the same next date updates the file and never duplicates", () => {
  const mc = mission();
  coach(mc, "talk", "held", "health");
  coach(mc, "questions", "health", "add", "Is zone 2 worth it?", "--why", "they asked after", "--date", "2026-11-08");
  fs.appendFileSync(path.join(mc, "coach/health/talks/2026-11-01.md"), "\n## Corrections\n- I do not drink coffee after noon.\n");
  coach(mc, "talk", "held", "health");
  coach(mc, "talk", "held", "health");
  const qs = items(mc);
  assert.equal(new Set(qs.map((q) => q.text.toLowerCase())).size, qs.length, "no question twice");
  assert.equal(qs.filter((q) => /creatine/.test(q.text)).length, 1);
  assert.equal(qs.filter((q) => q.origin === "added").length, 1, "an added question survives");
  assert.ok(qs.some((q) => /coffee after noon/.test(q.text)), "the new correction is in");
  assert.deepEqual(fs.readdirSync(path.join(mc, "coach/health/questions")), ["2026-11-08.md"]);
});

test("the model refines the file only through the command: drop stays dropped, a drop is exact", () => {
  const mc = mission();
  coach(mc, "talk", "held", "health");
  assert.match(coach(mc, "questions", "health", "drop", "creatine", "--date", "2026-11-08"), /Dropped/);
  coach(mc, "talk", "held", "health");
  assert.ok(!items(mc).some((q) => /creatine/.test(q.text)), "a dropped question does not come back");
  assert.throws(() => coach(mc, "questions", "health", "drop", "what is the newest", "--date", "2026-11-08"), /Several questions match|Command failed/);
  assert.match(coach(mc, "questions", "health", "--date", "2026-11-08"), /Longevity/);
});

test("an area that serves no goal, or has no talk, gets no questions", () => {
  const mc = mission({ SERVES: "" });
  assert.equal(writeQuestions(mc, load(mc), "2026-11-01"), null);
  assert.doesNotMatch(coach(mc, "talk", "held", "health", "--json"), /questions/);
  assert.ok(!fs.existsSync(path.join(mc, "coach/health/questions")));
});

test("a talk that ends without a closing turn gets its questions at the next tick, silently; an unanswered one does not", () => {
  const mc = mission();
  const now = new Date("2026-11-02T09:00:00Z");
  const t = dueTick(mc, S, now);
  assert.deepEqual(t.messages, []);
  const w = t.writes.filter((x) => x.kind === "questions");
  assert.equal(w.length, 1);
  assert.equal(w[0].ymd, "2026-11-01");
  process.env.TEST_NOW = "2026-11-02T09:00:00Z";
  try { assert.equal(coach(mc, "tick"), ""); } finally { delete process.env.TEST_NOW; }
  assert.ok(fs.existsSync(path.join(mc, "coach/health/questions/2026-11-08.md")));
  assert.equal(dueTick(mc, S, now).writes.filter((x) => x.kind === "questions").length, 0, "once written, not again");
  const quiet = mission({}, talk("", "")); 
  assert.equal(dueTick(quiet, S, now).writes.filter((x) => x.kind === "questions").length, 0, "no word from them, no talk happened");
});

test("brief is unchanged without a questions file and carries the questions and sources with one", () => {
  const mc = mission({}, talk(SAID, "- Try creatine 5 g a day for four weeks."));
  const a = load(mc);
  const plain = brief(mc, S, a, "2026-11-08");
  assert.doesNotMatch(plain, /Live questions/);
  writeQuestions(mc, a, "2026-11-01");
  fs.writeFileSync(a.file, fs.readFileSync(a.file, "utf8").replace("\n\n## Preparation", "\nSOURCE: Peter Attia, The Drive\n\n## Preparation"));
  const withQ = brief(mc, S, load(mc), "2026-11-08");
  assert.match(withQ, /## Live questions for this talk \(coach\/health\/questions\/2026-11-08\.md\)/);
  assert.match(withQ, /creatine 5 g/);
  assert.match(withQ, /Sources this area reads first:\n- Peter Attia, The Drive/);
  assert.equal(brief(mc, S, load(mc), "2026-11-15"), brief(mc, S, load(mc), "2026-11-15"));
  assert.doesNotMatch(brief(mc, S, load(mc), "2026-11-15"), /Live questions/, "another talk day has none");
});

test("SOURCE lines: a new health area starts with some, the person changes them by asking", () => {
  const mc = tmpMission({});
  coach(mc, "area", "add", "health", "--rhythm", "weekly sunday", "--serves", "longevity");
  const a = load(mc);
  assert.ok(a.sources.length >= 3 && a.sources.some((x) => /community: leads to check, never proof/.test(x)));
  assert.match(coach(mc, "area", "source", "health", "Example Longevity Letter"), /reads Example Longevity Letter first/);
  assert.ok(load(mc).sources.includes("Example Longevity Letter"));
  assert.match(coach(mc, "area", "source", "health", "Example Longevity Letter", "--remove"), /no longer reads/);
  assert.ok(!load(mc).sources.includes("Example Longevity Letter"));
  const unknown = tmpMission({});
  coach(unknown, "area", "add", "gardening", "--rhythm", "weekly sunday");
  assert.deepEqual(readArea(path.join(unknown, "coach", "gardening")).sources, [], "an area of no known kind starts with none");
});
