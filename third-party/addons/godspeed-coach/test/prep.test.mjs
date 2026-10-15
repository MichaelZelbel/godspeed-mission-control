// 0.4.0, from the work talks of 14 and 15 October 2026: the talk job's model wrote the opening in
// about a minute from the brief, and the talk opened unprepared. Now a job of its own prepares each
// talk ahead in coach/<area>/prep/<talk date>.md: the talk opens from that file
// (`talk open --from-prep`), the brief carries it whole, every interface carries its talk card while
// the talk is open, and `prep-due` says which coming talks still need one.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readArea } from "../lib/areas.mjs";
import { brief } from "../lib/brief.mjs";
import { gate } from "../lib/gate.mjs";
import { prepForBrief, prepDue } from "../lib/prep.mjs";
import { tmpMission, area, S } from "./helpers.mjs";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "godspeed-coach.mjs");
function cli(mc, nowIso, ...args) {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), "coach-app-"));
  const r = spawnSync(process.execPath, [BIN, ...args, "--godspeed", mc], {
    encoding: "utf8", env: { ...process.env, GODSPEED_NOW: nowIso, GODSPEED_COACH_GIT_SYNC: "off", GODSPEED_COACH_APP: app },
  });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
}

const OPENING = "From your coach, your weekly work and money talk: you want a buffer of six months and have about three. Keep the target, or move the date?";
const CARD = [
  OPENING,
  "My moves: 1. Put 400 euro a month aside from November. 2. Drop the second hosting plan.",
  "- Savings: about 18,000 euro (2026-10-12, his own words in the last talk)",
  "- Costs: about 3,000 euro a month (2026-10-01, the budget sheet)",
  "The question I most want his view on: is six months still the number?",
].join("\n");
const prep = ({ area: a = "work", talk = "2026-10-21 19:00", state = "ready", opening = OPENING, card = CARD } = {}) => [
  `AREA: ${a}`, `TALK: ${talk}`, "PREPARED: 2026-10-20T08:12:00Z", `STATE: ${state}`, "",
  "## The opening", opening, "",
  "## Talk card", card, "",
  "## Where he stands", "- Savings about 18,000 euro (2026-10-12, last talk)", "",
  "## What changed since the last talk", "- He paid the tax bill (2026-10-16, journal)", "",
  "## The world this week", "### Rates", "- The central bank decides on 29 October (https://example.org/b)", "",
  "## Opportunities", "- None strong enough this week.", "",
  "## What I think", "Keep the target and save 400 a month.", "",
  "## Gaps", "- His November costs.", "",
  "## Cut, and why", "- A newsletter swap: too small.", "",
].join("\n");

const research = ["GOAL: buffer", "UPDATED: 2026-10-20", "", "## The limit now", "LIMIT: no money comes in besides salary.", "", "## Openings", "- 2026-11-03: an online hackathon.", ""].join("\n");
const mission = (extra = {}) => tmpMission({
  "coach/settings.json": JSON.stringify({ timezone: "Europe/Berlin", git_sync: "off" }),
  "coach/work/area.md": area({ AREA: "work", TITLE: "Work and money", RHYTHM: "weekly wednesday", STARTS: "2026-10-14", SERVES: "buffer" }),
  "coach/work/questions.md": "### 2026-10-01: The buffer\nHow big should it be?\n",
  "goals/buffer.md": "TITLE: A savings buffer\nMEASURE: euro\n\n## Log\n- 2026-10-14 BET W-1 150 -> 240\n",
  "goals/research/buffer/brief.md": research,
  ...extra,
});
const work = (mc) => readArea(path.join(mc, "coach", "work"));
const record = (mc, d) => fs.readFileSync(path.join(mc, "coach", "work", "talks", `${d}.md`), "utf8");

test("talk open --from-prep opens with the prepared opening, keeps the talk card and prints the opening", () => {
  const mc = mission({ "coach/work/prep/2026-10-21.md": prep() });
  const r = cli(mc, "2026-10-21T17:00:00Z", "talk", "open", "work", "--from-prep", "coach/work/prep/2026-10-21.md");
  assert.equal(r.code, 0, r.err);
  assert.equal(r.out, `Opened: coach/work/talks/2026-10-21.md. The opening, to send exactly as it is:\n\n${OPENING}`);
  const rec = record(mc, "2026-10-21");
  assert.match(rec, /^PREP: coach\/work\/prep\/2026-10-21\.md$/m);
  assert.ok(rec.includes(`## What was read\nthe prepared talk coach/work/prep/2026-10-21.md\n\n## The opening\n${OPENING}\n\n## Prepared\n${CARD}\n\n## What you said\n`));
  // Opened again (a retry): the first record stays, and the opening is not printed a second time.
  const again = cli(mc, "2026-10-21T18:00:00Z", "talk", "open", "work", "--from-prep", "coach/work/prep/2026-10-21.md");
  assert.equal(again.out, "Already open: coach/work/talks/2026-10-21.md (kept the first opening)");
  // --read still says what was read; --json carries the opening; an absolute path works too.
  const mc2 = mission({ "coach/work/prep/2026-10-21.md": prep() });
  const j = cli(mc2, "2026-10-21T17:00:00Z", "talk", "open", "work", "--from-prep", path.join(mc2, "coach", "work", "prep", "2026-10-21.md"), "--read", "the dossier", "--json");
  assert.equal(JSON.parse(j.out).opening, OPENING);
  assert.match(record(mc2, "2026-10-21"), /## What was read\nthe dossier\n/);
  assert.match(record(mc2, "2026-10-21"), /^PREP: coach\/work\/prep\/2026-10-21\.md$/m);
});

test("talk open --from-prep refuses a preparation that is not ready, and opens nothing", () => {
  const cases = [
    [prep({ state: "draft" }), /its STATE is draft, not ready/],
    [prep({ opening: "" }), /its section "The opening" is empty/],
    [prep({ card: "" }), /its section "Talk card" is empty/],
    [prep({ opening: "", card: "" }), /its sections "The opening" and "Talk card" are empty/],
    [prep({ area: "health" }), /it is for the health talk, not the Work and money talk/],
    [prep().replace("STATE: ready\n", ""), /its STATE is missing, not ready/],
  ];
  for (const [text, why] of cases) {
    const mc = mission({ "coach/work/prep/2026-10-21.md": text });
    const r = cli(mc, "2026-10-21T17:00:00Z", "talk", "open", "work", "--from-prep", "coach/work/prep/2026-10-21.md");
    assert.equal(r.code, 1);
    assert.match(r.err, /^The prepared talk coach\/work\/prep\/2026-10-21\.md cannot open a talk: /);
    assert.match(r.err, why);
    assert.match(r.err, /Nothing was opened\.$/);
    assert.equal(fs.existsSync(path.join(mc, "coach", "work", "talks", "2026-10-21.md")), false);
  }
  const mc = mission();
  assert.match(cli(mc, "2026-10-21T17:00:00Z", "talk", "open", "work", "--from-prep", "coach/work/prep/2026-10-21.md").err, /cannot open a talk: there is no such file/);
  const both = cli(mission({ "coach/work/prep/2026-10-21.md": prep() }), "2026-10-21T17:00:00Z", "talk", "open", "work", "--from-prep", "coach/work/prep/2026-10-21.md", "--opening", "Hi.");
  assert.equal(both.code, 1);
  assert.match(both.err, /either from the prepared talk \(--from-prep\) or with --opening and --prepared, not both/);
});

test("the brief carries a ready preparation whole, before the queued question, and prints the --from-prep command", () => {
  const mc = mission({ "coach/work/prep/2026-10-21.md": prep() });
  const b = brief(mc, S, work(mc), "2026-10-21");
  const home = mc.replace(/\\/g, "/");
  assert.ok(b.includes(`Record: coach/work/talks/2026-10-21.md, created by (run it exactly like this): godspeed-coach talk open work --godspeed "${home}" --from-prep "coach/work/prep/2026-10-21.md". The opening is written: this command saves it with the talk card and prints it, and your final answer is that opening, exactly as printed.`));
  assert.doesNotMatch(b, /--opening "<the opening>"/);
  const at = b.indexOf("\n## The prepared talk (coach/work/prep/2026-10-21.md)\nAREA: work\nTALK: 2026-10-21 19:00\nPREPARED: 2026-10-20T08:12:00Z\nSTATE: ready\n\n### The opening\n");
  assert.ok(at > 0, "the whole file, its headings one level down");
  assert.ok(b.indexOf("## Question queued for this talk") > at, "before the queued question");
  assert.ok(b.includes(`### Talk card\n${CARD}\n`));
  assert.ok(b.includes("### The world this week\n#### Rates\n"));
  assert.ok(b.includes("### Cut, and why\n- A newsletter swap: too small."));
  // The preparation supersedes the goal research: its sections are left out, the goal's line stays.
  assert.doesNotMatch(b, /What the research found/);
  assert.match(b, /^## Goals it serves\n- buffer: A savings buffer \(measure: euro\)$/m);
});

test("without a ready preparation the brief is as before", () => {
  for (const extra of [{}, { "coach/work/prep/2026-10-21.md": prep({ state: "draft" }) }, { "coach/work/prep/2026-10-21.md": prep({ card: "" }) }]) {
    const mc = mission(extra);
    const b = brief(mc, S, work(mc), "2026-10-21");
    assert.doesNotMatch(b, /The prepared talk|--from-prep/);
    assert.match(b, /--opening "<the opening>" --prepared "<two to four more things from the research,/);
    assert.match(b, /^## What the research found for A savings buffer \(updated 2026-10-20\)$/m);
  }
});

test("a talk they start themselves uses the next scheduled talk's preparation within a week, else today's or yesterday's", () => {
  // Monday 2026-10-19: the next work talk is Wednesday the 21st.
  const next = mission({ "coach/work/prep/2026-10-21.md": prep(), "coach/work/prep/2026-10-19.md": prep({ talk: "2026-10-19 10:00", opening: "Today's." }) });
  assert.equal(prepForBrief(work(next), "2026-10-19").date, "2026-10-21");
  assert.match(cli(next, "2026-10-19T08:00:00Z", "brief", "work").out, /--from-prep "coach\/work\/prep\/2026-10-21\.md"/);
  assert.equal(prepForBrief(work(next), "2026-10-14"), null, "a talk day uses only its own preparation");
  const week = mission({ "coach/work/prep/2026-10-28.md": prep({ talk: "2026-10-28 19:00" }) });
  assert.equal(prepForBrief(work(week), "2026-10-22").date, "2026-10-28", "six days ahead is near enough");
  assert.equal(prepForBrief(work(week), "2026-10-20"), null, "only the next talk is looked at, not the one after");
  const today = mission({ "coach/work/prep/2026-10-19.md": prep({ talk: "2026-10-19 10:00" }) });
  assert.equal(prepForBrief(work(today), "2026-10-19").date, "2026-10-19");
  const yesterday = mission({ "coach/work/prep/2026-10-18.md": prep({ talk: "2026-10-18 21:00" }) });
  assert.equal(prepForBrief(work(yesterday), "2026-10-19").date, "2026-10-18");
  // Every two weeks: the next talk eight days away is not within the next seven.
  const biweekly = mission({ "coach/work/area.md": area({ AREA: "work", TITLE: "Work and money", RHYTHM: "every 2 weeks wednesday", STARTS: "2026-10-14", SERVES: "buffer" }), "coach/work/prep/2026-10-28.md": prep({ talk: "2026-10-28 19:00" }) });
  assert.equal(prepForBrief(work(biweekly), "2026-10-20"), null, "eight days ahead is too far");
  assert.equal(prepForBrief(work(biweekly), "2026-10-21").date, "2026-10-28", "seven days ahead is near enough");
});

test("a preparation one talk already opened with is not carried again, so the scheduled talk never repeats its opening", () => {
  const mc = mission({ "coach/work/prep/2026-10-21.md": prep() });
  // Monday they start the talk themselves, from Wednesday's preparation.
  assert.equal(cli(mc, "2026-10-19T08:00:00Z", "talk", "open", "work", "--from-prep", "coach/work/prep/2026-10-21.md").code, 0);
  assert.equal(prepForBrief(work(mc), "2026-10-21"), null);
  const g = gate(mc, S, new Date("2026-10-21T17:00:00Z"), path.join(fs.mkdtempSync(path.join(os.tmpdir(), "coach-gate-")), "state.json"));
  assert.ok(g.wake);
  assert.doesNotMatch(g.output, /--from-prep "|^## The prepared talk/m);
  assert.match(g.output, /--opening "<the opening>"/);
  // And the job that prepares talks is told Wednesday needs a fresh one.
  assert.deepEqual(prepDue(mc, S, new Date("2026-10-19T09:00:00Z"), 72).map((x) => x.date), ["2026-10-21"]);
  // A fresh preparation, with another opening, is carried.
  fs.writeFileSync(path.join(mc, "coach", "work", "prep", "2026-10-21.md"), prep({ opening: "From your coach, your weekly work and money talk: a new thing. Will you?" }));
  assert.equal(prepForBrief(work(mc), "2026-10-21").date, "2026-10-21");
});

test("the talk job's gate hands the model the preparation and the step that opens from it", () => {
  const mc = mission({ "coach/work/prep/2026-10-21.md": prep() });
  const g = gate(mc, S, new Date("2026-10-21T17:00:00Z"), path.join(fs.mkdtempSync(path.join(os.tmpdir(), "coach-gate-")), "state.json"));
  assert.ok(g.wake);
  assert.match(g.output, /--from-prep "coach\/work\/prep\/2026-10-21\.md"/);
  assert.match(g.output.replace(/\s+/g, " "), /1\. If the brief carries a prepared talk \(its section "The prepared talk"\), that is the preparation and the opening is written: skip steps 2 to 4, run the open command the brief prints \(with `--from-prep`\) as step 5 says, and your final answer is the opening it prints, exactly\./);
});

const threeAreas = (extra = {}) => tmpMission({
  "coach/settings.json": JSON.stringify({ timezone: "Europe/Berlin", git_sync: "off" }),
  "coach/health/area.md": area({ STARTS: "2026-10-04" }),
  "coach/work/area.md": area({ AREA: "work", TITLE: "Work and money", RHYTHM: "weekly wednesday", STARTS: "2026-10-14" }),
  "coach/relationships/area.md": area({ AREA: "relationships", TITLE: "Love and relationships", RHYTHM: "weekly friday", STARTS: "2026-10-23" }),
  "coach/reading/area.md": area({ AREA: "reading", TITLE: "Reading", RHYTHM: "none" }),
  "coach/psychology/area.md": area({ AREA: "psychology", TITLE: "Psychology", RHYTHM: "daily", STATUS: "paused" }),
  ...extra,
});

test("prep-due lists each area whose next talk starts within the hours given and has no ready preparation, soonest first", () => {
  const mc = threeAreas();
  // Thursday 2026-10-15, 23:00 in Berlin.
  const at = "2026-10-15T21:00:00Z";
  const j = cli(mc, at, "prep-due", "--within-hours", "200", "--json");
  assert.equal(j.code, 0, j.err);
  assert.deepEqual(JSON.parse(j.out), [
    { area: "health", title: "Health and fitness", date: "2026-10-18", time: "19:00", timezone: "Europe/Berlin", file: "coach/health/prep/2026-10-18.md" },
    { area: "work", title: "Work and money", date: "2026-10-21", time: "19:00", timezone: "Europe/Berlin", file: "coach/work/prep/2026-10-21.md" },
    { area: "relationships", title: "Love and relationships", date: "2026-10-23", time: "19:00", timezone: "Europe/Berlin", file: "coach/relationships/prep/2026-10-23.md" },
  ]);
  assert.equal(cli(mc, at, "prep-due", "--within-hours", "72").out, "health: Health and fitness, Sunday 2026-10-18 at 19:00 (Europe/Berlin), prepare coach/health/prep/2026-10-18.md");
  assert.equal(cli(mc, at, "prep-due", "--within-hours", "24").out, "Nothing to prepare.");
  assert.equal(cli(mc, at, "prep-due", "--within-hours", "24", "--json").out, "[]");
  // The window ends at the talk's start: 18:59 Sunday is not yet within it.
  assert.equal(cli(mc, "2026-10-15T17:00:00Z", "prep-due", "--within-hours", "71.9").out, "Nothing to prepare.");
  assert.match(cli(mc, "2026-10-15T17:00:00Z", "prep-due", "--within-hours", "72").out, /^health: /);
  for (const bad of [[], ["--within-hours", "0"], ["--within-hours", "soon"]]) {
    const r = cli(mc, at, "prep-due", ...bad);
    assert.equal(r.code, 1);
    assert.match(r.err, /godspeed-coach prep-due --within-hours <hours>/);
  }
});

test("prep-due leaves out a talk that is prepared or already open, and lists one whose preparation is a draft", () => {
  const mc = threeAreas({
    "coach/health/prep/2026-10-18.md": prep({ area: "health", talk: "2026-10-18 19:00" }),
    "coach/work/prep/2026-10-21.md": prep({ state: "draft" }),
    "coach/relationships/talks/2026-10-23.md": "TALK: relationships\nDATE: 2026-10-23\nSTATE: opened\n\n## The opening\nHi.\n",
  });
  assert.deepEqual(JSON.parse(cli(mc, "2026-10-15T21:00:00Z", "prep-due", "--within-hours", "200", "--json").out).map((x) => x.area), ["work"]);
  // Today's talk has started: the next one is a week on.
  const sunday = threeAreas();
  assert.deepEqual(prepDue(sunday, S, new Date("2026-10-18T17:30:00Z"), 24 * 8).map((x) => `${x.area} ${x.date}`), ["work 2026-10-21", "relationships 2026-10-23", "health 2026-10-25"]);
});

test("an open talk from a preparation carries its whole talk card and names the file that holds the depth", () => {
  const mc = mission({ "coach/work/prep/2026-10-21.md": prep() });
  assert.equal(cli(mc, "2026-10-21T17:00:00Z", "talk", "open", "work", "--from-prep", "coach/work/prep/2026-10-21.md").code, 0);
  const block = cli(mc, "2026-10-21T17:30:00Z", "context", "--hook", "claude").out.split("\n");
  const at = block.findIndex((l) => l.startsWith("- Open talk: Work and money (id for commands: work), opened today at 19:00, record coach/work/talks/2026-10-21.md."));
  assert.ok(at > 0, block.join("\n"));
  assert.deepEqual(block.slice(at + 1, at + 9), [
    `  It opened with: "${OPENING}"`,
    "  Talk card, prepared ahead (the short version; coach/work/prep/2026-10-21.md holds the depth):",
    ...CARD.split("\n").map((l) => `  ${l}`),
    "  Answer from this card without running commands. When it does not answer them, read coach/work/prep/2026-10-21.md once rather than searching anywhere else.",
  ]);
  // A card longer than about 1600 characters is cut by whole lines.
  const long = Array.from({ length: 40 }, (_, i) => `- line ${i}: ${"a number with its date and source, ".repeat(2)}`).join("\n");
  const mc2 = mission({ "coach/work/prep/2026-10-21.md": prep({ card: long }) });
  cli(mc2, "2026-10-21T17:00:00Z", "talk", "open", "work", "--from-prep", "coach/work/prep/2026-10-21.md");
  const lines = cli(mc2, "2026-10-21T17:30:00Z", "context").out.split("\n");
  const start = lines.findIndex((l) => l.startsWith("  Talk card, prepared ahead"));
  const end = lines.findIndex((l) => l.startsWith("  Answer from this card"));
  const card = lines.slice(start + 1, end);
  assert.equal(card.at(-1), "  ...");
  assert.ok(card.slice(0, -1).join("\n").length <= 1600 && card.length >= 15, `${card.length} lines`);
  for (const l of card.slice(0, -1)) assert.match(l, /^ {2}- line \d+: .*source,$/);
});

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8").replace(/\r/g, "").replace(/\s+/g, " ");

test("the recipe: a prepared talk opens as written, and the talk goes on like two people deciding something", () => {
  const text = read("skill/coach/SKILL.md");
  const opening = text.split("## Opening a talk")[1].split("## Continuing a talk")[0];
  assert.match(opening, /^ The talk job wakes you/);
  assert.match(opening, / 1\. If the brief carries a prepared talk \(its section "The prepared talk"\), that is the preparation and the opening is written: skip steps 2 to 4, run the open command the brief prints \(with `--from-prep`\) as step 5 says, and your final answer is the opening it prints, exactly\. 2\. Do what the brief's \*\*Preparation\*\* says/);
  assert.match(opening, / 5\. Create the record BEFORE you answer, with the command line exactly as the brief prints it/);
  assert.match(opening, / 7\. Your final answer is the opening and nothing else\./);
  const continuing = text.split("## Continuing a talk")[1].split("## Closing a talk")[0];
  assert.match(continuing, /3\. Talk like two people deciding something together, in the area's tone\. A question gets one or two sentences; a suggestion is one sentence\. When they ask what you think, say it and why in two sentences, then ask how they see it; disagree when the evidence does\. The talk card in the block is the short version; the prepared talk file \(`coach\/<area>\/prep\/<date>\.md`\) holds the depth, so when the card does not answer them, read that file once rather than searching anywhere else\./);
  assert.doesNotMatch(continuing, /Answer like a person across the table/);
  assert.doesNotMatch(text, /[–—]/, "no long dash in the recipe");
});

// This copy's own parts: a talk asked for in the chat is opened as seen (--shown), and without a
// messenger a talk that waits for the chat carries its talk card after its line.
test("in the chat: the --from-prep command ends with --shown, and a waiting talk carries its talk card", () => {
  const mc = mission({ "coach/work/prep/2026-10-21.md": prep(), "coach/settings.json": JSON.stringify({ timezone: "Europe/Berlin", git_sync: "off", talk_delivery: "chat" }) });
  assert.match(cli(mc, "2026-10-21T08:00:00Z", "brief", "work").out, /--from-prep "coach\/work\/prep\/2026-10-21\.md" --shown\. The opening is written/);
  const g = gate(mc, { ...S, talk_delivery: "chat" }, new Date("2026-10-21T17:00:00Z"), path.join(fs.mkdtempSync(path.join(os.tmpdir(), "coach-gate-")), "state.json"));
  assert.match(g.output, /--from-prep "coach\/work\/prep\/2026-10-21\.md"\. The opening is written/, "the scheduled talk's brief has no --shown");
  assert.equal(cli(mc, "2026-10-21T17:00:00Z", "talk", "open", "work", "--from-prep", "coach/work/prep/2026-10-21.md").code, 0);
  const block = cli(mc, "2026-10-21T17:30:00Z", "context").out.split("\n");
  const at = block.findIndex((l) => l.startsWith("- Waiting talk: Work and money"));
  assert.ok(at > 0, block.join("\n"));
  assert.equal(block[at + 1], "  Talk card, prepared ahead (the short version; coach/work/prep/2026-10-21.md holds the depth):");
  assert.equal(block[at + 2], `  ${OPENING}`);
});
