// Several talks may look at one habit (Michael's decision of 13 October 2026: his headache tracker
// matters to a health talk and a planned psychology talk alike). A habit names the OTHER areas whose
// talk may also look at it in one header line, "READ BY: psychology"; its own area always does. The
// worry that comes with it, two talks going over the same thing every week, is answered by focus:
// the brief lists what other talks raised in the last seven days, and the opening never starts there.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { addHabit, listHabits, readHabit, track, setHabitReader, habitReadersWords } from "../lib/habits.mjs";
import { readArea } from "../lib/areas.mjs";
import { openTalk, setTalkState } from "../lib/talks.mjs";
import { brief } from "../lib/brief.mjs";
import { addDays } from "../lib/clock.mjs";
import { tmpMission, area, S } from "./helpers.mjs";

const NO_TALK = (slug, title) => `AREA: ${slug}\nTITLE: ${title}\nRHYTHM: none\nSTATUS: on\n\n## Preparation\n\nHabits only.\n`;
const mission = () => tmpMission({
  "coach/health/area.md": area(),
  "coach/psychology/area.md": area({ AREA: "psychology", TITLE: "Psychology", STYLE: "compass" }),
  "coach/sleep/area.md": NO_TALK("sleep", "Sleep"),
});
const walk = (mc, over = {}) => addHabit(mc, { area: "health", slug: "walk-to-work", title: "Walk to work and back", doneMeans: "both ways on foot", days: "daily", ...over }, over.today || "2026-10-01");
const at = (iso) => new Date(iso);

test("a habit names other talks in one READ BY line; nothing else in the file changes", () => {
  const mc = mission();
  const h = walk(mc);
  assert.deepEqual(h.readBy, [], "no line, no readers");
  const before = fs.readFileSync(h.file, "utf8");
  const r = setHabitReader(mc, "walk-to-work", "psychology");
  assert.equal(r.changed, true);
  assert.deepEqual(r.readBy, ["psychology"]);
  assert.equal(r.reply, "The Psychology talk may now look at your habit Walk to work and back.");
  assert.equal(fs.readFileSync(h.file, "utf8"), before.replace("AREA: health\n", "AREA: health\nREAD BY: psychology\n"), "one line, under AREA");
  // A second one, by the area's title, joins the same line; an area with no talk keeps it for later.
  const sleep = setHabitReader(mc, readHabit(h.file), "Sleep");
  assert.equal(sleep.reply, "The Sleep talk may now look at your habit Walk to work and back. It has no talk yet; the talk it gets later keeps this.");
  assert.equal(fs.readFileSync(h.file, "utf8"), before.replace("AREA: health\n", "AREA: health\nREAD BY: psychology, sleep\n"));
  assert.deepEqual(readHabit(h.file).readBy, ["psychology", "sleep"]);
  assert.deepEqual(listHabits(mc).map((x) => [x.slug, x.area, x.readBy]), [["walk-to-work", "health", ["psychology", "sleep"]]]);
  // Said again: already there, nothing written.
  const again = setHabitReader(mc, "walk-to-work", "PSYCHOLOGY");
  assert.equal(again.changed, false);
  assert.equal(again.reply, "The Psychology talk may already look at your habit Walk to work and back. Nothing changed.");
  assert.equal(fs.readFileSync(h.file, "utf8"), before.replace("AREA: health\n", "AREA: health\nREAD BY: psychology, sleep\n"));
  // Taken back one at a time; the last one takes the line with it, so the file is as it was.
  const off = setHabitReader(mc, "walk-to-work", "psychology", { remove: true });
  assert.equal(off.changed, true);
  assert.equal(off.reply, "The Psychology talk no longer looks at your habit Walk to work and back.");
  assert.deepEqual(off.readBy, ["sleep"]);
  const notThere = setHabitReader(mc, "walk-to-work", "psychology", { remove: true });
  assert.equal(notThere.changed, false);
  assert.equal(notThere.reply, "The Psychology talk was not looking at your habit Walk to work and back. Nothing changed.");
  setHabitReader(mc, "walk-to-work", "sleep", { remove: true });
  assert.equal(fs.readFileSync(h.file, "utf8"), before, "back to the file it was");
  assert.deepEqual(readHabit(h.file).readBy, []);
});

test("the habit's own area always reads it and is never in READ BY; an unknown area is refused", () => {
  const mc = mission();
  const h = walk(mc);
  const before = fs.readFileSync(h.file, "utf8");
  assert.throws(() => setHabitReader(mc, "walk-to-work", "health"), { message: "Walk to work and back is a Health and fitness habit; the Health and fitness talk always looks at it." });
  assert.throws(() => setHabitReader(mc, "walk-to-work", "Health and fitness", { remove: true }), { message: "Walk to work and back is a Health and fitness habit; the Health and fitness talk always looks at it." });
  assert.throws(() => setHabitReader(mc, "walk-to-work", "garden"), { message: 'There is no coach area called "garden". Areas: health, psychology, sleep.' });
  assert.throws(() => setHabitReader(mc, "reading", "psychology"), { message: 'There is no habit called "reading".' });
  assert.equal(fs.readFileSync(h.file, "utf8"), before, "nothing written");
  assert.equal(fs.existsSync(path.join(mc, "coach", "garden")), false, "no area made for it");
  // "an" before a vowel.
  fs.mkdirSync(path.join(mc, "coach", "outdoors"));
  fs.writeFileSync(path.join(mc, "coach", "outdoors", "area.md"), NO_TALK("outdoors", "Outdoors"));
  addHabit(mc, { area: "outdoors", slug: "bike", title: "Bike ride", days: "sat" }, "2026-10-01");
  assert.throws(() => setHabitReader(mc, "bike", "outdoors"), { message: "Bike ride is an Outdoors habit; the Outdoors talk always looks at it." });
});

test("a READ BY line written by hand is read generously; the file's own line endings are kept", () => {
  const mc = mission();
  const h = walk(mc);
  const crlf = fs.readFileSync(h.file, "utf8").replace("AREA: health\n", "AREA: health\nREAD BY: Psychology,  health, psychology,sleep\n").replace(/\n/g, "\r\n");
  fs.writeFileSync(h.file, crlf);
  assert.deepEqual(readHabit(h.file).readBy, ["psychology", "sleep"], "lower case, once each, never its own area");
  setHabitReader(mc, "walk-to-work", "sleep", { remove: true });
  assert.equal(fs.readFileSync(h.file, "utf8"), crlf.replace("READ BY: Psychology,  health, psychology,sleep\r\n", "READ BY: psychology\r\n"), "only that line changed, CRLF kept");
  setHabitReader(mc, "walk-to-work", "psychology", { remove: true });
  assert.equal(fs.readFileSync(h.file, "utf8"), crlf.replace("READ BY: Psychology,  health, psychology,sleep\r\n", ""));
});

test("the readers in words, for listing them", () => {
  const mc = mission();
  const h = walk(mc);
  assert.equal(habitReadersWords(mc, h), "Your habit Walk to work and back belongs to the Health and fitness talk; no other talk looks at it.");
  setHabitReader(mc, "walk-to-work", "psychology");
  assert.equal(habitReadersWords(mc, readHabit(h.file)), "Your habit Walk to work and back belongs to the Health and fitness talk; the Psychology talk may also look at it.");
  setHabitReader(mc, "walk-to-work", "sleep");
  assert.equal(habitReadersWords(mc, readHabit(h.file)), "Your habit Walk to work and back belongs to the Health and fitness talk; the Psychology talk and the Sleep talk may also look at it.");
});

test("the talk brief lists another area's habit that names it, marked as that area's, with no graduate or struggle note", () => {
  const mc = mission();
  let h = walk(mc, { today: "2026-08-01" });
  // Six weeks of done: its own talk is told to offer graduating it.
  for (let d = "2026-08-01"; d <= "2026-10-11"; d = addDays(d, 1)) h = track(h, d, "done", "test", "");
  const own = addHabit(mc, { area: "psychology", slug: "journal", title: "Evening journal", days: "daily" }, "2026-10-05");
  const paused = addHabit(mc, { area: "health", slug: "stretch", title: "Stretching", days: "daily" }, "2026-10-01");
  setHabitReader(mc, "walk-to-work", "psychology");
  setHabitReader(mc, "stretch", "psychology");
  fs.writeFileSync(paused.file, fs.readFileSync(paused.file, "utf8").replace("STATUS: active", "STATUS: paused"));
  addHabit(mc, { area: "health", slug: "water", title: "Water", days: "daily" }, "2026-10-01");
  const psych = brief(mc, S, readArea(path.join(mc, "coach", "psychology")), "2026-10-11");
  const habits = psych.split("## Habits in this area\n")[1].split("\n\n")[0];
  assert.equal(habits, [
    "- Evening journal (every day): last 7 days, 7 planned: done 0, no 0, unknown 7",
    "- Walk to work and back (a Health and fitness habit, every day): last 7 days, 7 planned: done 7, no 0, unknown 0",
    "A habit marked as another area's belongs to that area's talk: look at it here, but only its own talk offers to graduate it, make it smaller or drop it.",
  ].join("\n"), "no Water (no READ BY), no paused Stretching, no graduate note");
  const health = brief(mc, S, readArea(path.join(mc, "coach", "health")), "2026-10-11");
  assert.match(health, /^- Walk to work and back \(every day\): last 7 days, 7 planned: done 7, no 0, unknown 0; six weeks of mostly done: offer to graduate it$/m, "its own talk still offers it");
  assert.doesNotMatch(health, /A habit marked as another area's/);
  // Another area's habit alone, with none of its own.
  fs.rmSync(own.file);
  const only = brief(mc, S, readArea(path.join(mc, "coach", "psychology")), "2026-10-11");
  assert.match(only, /## Habits in this area\n- Walk to work and back \(a Health and fitness habit, every day\)/);
});

test("the brief lists what other talks raised in the last seven days: day, opening, what changed", () => {
  const mc = mission();
  const health = readArea(path.join(mc, "coach", "health"));
  const psych = readArea(path.join(mc, "coach", "psychology"));
  const record = (a, ymd, opening, changed) => {
    openTalk(a, ymd, { opening }, at(ymd + "T17:00:00Z"));
    if (changed !== undefined) {
      const f = path.join(a.dir, "talks", `${ymd}.md`);
      fs.writeFileSync(f, fs.readFileSync(f, "utf8").replace("## What changed\n", `## What changed\n${changed}\n`));
      setTalkState(a, ymd, "held");
    }
  };
  record(health, "2026-10-03", "From your coach, your weekly health talk: too old to list.");
  record(health, "2026-10-04", "From your coach, your weekly health talk: on Monday you said the headaches come after long screen days. Which days were they this week?", "- a ten minute walk at lunch\n- habit started: Walk to work and back");
  record(health, "2026-10-10", "From your coach: " + "x".repeat(400));
  record(health, "2026-10-12", "From your coach: tomorrow's talk, after this brief's day.");
  record(psych, "2026-10-09", "From your coach, your psychology talk: its own talk, never listed in its own brief.");
  const b = brief(mc, S, psych, "2026-10-11");
  const section = b.split("## Raised in other talks this week\n")[1].split("\n\n")[0];
  assert.equal(section, [
    "Another talk already raised these with them. The opening never starts with any of them: pick another thing. If they bring one up themselves, talk about it from this talk's own subject.",
    '- The Health and fitness talk on 4 October opened with: "From your coach, your weekly health talk: on Monday you said the headaches come after long screen days. Which days were they this week?" What changed: a ten minute walk at lunch; habit started: Walk to work and back.',
    `- The Health and fitness talk yesterday opened with: "From your coach: ${"x".repeat(220)}..."`,
  ].join("\n"), "eight days back at most, nothing after the brief's day, never its own area's talks");
  // The health brief on the same day sees the psychology talk, and only it.
  const h = brief(mc, S, health, "2026-10-11");
  assert.match(h, /## Raised in other talks this week\n.*\n- The Psychology talk on Friday opened with: "From your coach, your psychology talk: its own talk, never listed in its own brief\."$/m);
  // A talk earlier the same day counts.
  record(psych, "2026-10-11", "From your coach, your psychology talk: earlier today.");
  assert.match(brief(mc, S, health, "2026-10-11"), /^- The Psychology talk today opened with: "From your coach, your psychology talk: earlier today\."$/m);
});

test("nothing raised elsewhere: the section says None.", () => {
  const mc = tmpMission({ "coach/health/area.md": area() });
  const b = brief(mc, S, readArea(path.join(mc, "coach", "health")), "2026-10-11");
  assert.match(b, /\n## Raised in other talks this week\nNone\.\n/);
  // It sits after the last talk and before the habits.
  assert.ok(b.indexOf("## The last talk") < b.indexOf("## Raised in other talks this week"));
  assert.ok(b.indexOf("## Raised in other talks this week") < b.indexOf("## Habits in this area"));
});

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8").replace(/\r/g, "").replace(/\s+/g, " ");

test("the recipe: the opening never starts with what another talk raised, and habit read-by in their words", () => {
  const text = read("skill/coach/SKILL.md");
  const opening = text.split("## Opening a talk")[1].split("## Continuing a talk")[0];
  assert.match(opening, /The one thing is never something the brief lists under "Raised in other talks this week": another talk already raised it, so pick another\. If they bring it up themselves in this talk, talk about it from this talk's own subject\./);
  assert.match(text, /"The psychology talk may also look at my walk to work habit"/);
  assert.match(text, /godspeed-coach habit read-by "<the habit>" <area>/);
  assert.match(text, /godspeed-coach habit read-by "<the habit>" <area> --remove/);
  assert.match(text, /"The psychology talk may now look at your walk to work habit\."/);
  assert.doesNotMatch(text, /—/, "no em dash in the recipe");
  assert.match(read("README.md"), /godspeed-coach habit read-by "walk to work" psychology/);
  assert.doesNotMatch(read("README.md"), /—/);
});
