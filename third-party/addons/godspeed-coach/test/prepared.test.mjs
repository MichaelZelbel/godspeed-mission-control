// 0.3.0, from the work talk of 14 October 2026: the brief gave the talk the goals' bookkeeping
// ("BET W-20261014-10 150 -> 240") but not the nightly research lying next to the goal files, so it
// opened on a stale to-do title he no longer knew. Continued in Claude Code, the talk re-read its
// record, area, due list and journal on his screen, then ran `talk said` for every message.
//
// Ported from the upstream coach 0.3.0 (its --prepared-file and --words-file are not in this copy).
// Now: the brief carries what the research found, the record keeps what was prepared beyond the
// opening, the [godspeed-coach] block carries both, and `talk said` takes every message at once.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readArea } from "../lib/areas.mjs";
import { brief, goalResearch, RESEARCH_CAP } from "../lib/brief.mjs";
import { contextBlock, TALK_CHARS } from "../lib/context.mjs";
import { openTalk, readTalk } from "../lib/talks.mjs";
import { tmpMission, area, S } from "./helpers.mjs";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "godspeed-coach.mjs");
function cli(mc, nowIso, ...args) {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), "coach-app-"));
  const r = spawnSync(process.execPath, [BIN, ...args, "--godspeed", mc], {
    encoding: "utf8", env: { ...process.env, GODSPEED_NOW: nowIso, GODSPEED_COACH_GIT_SYNC: "off", GODSPEED_COACH_APP: app },
  });
  return { code: r.status, out: r.stdout.trim(), err: r.stderr.trim() };
}

const goal = (title, log = []) => [`TITLE: ${title}`, `MEASURE: ${title.toLowerCase()} in euro`, "", "## Log", ...log, ""].join("\n");
const research = (updated, sections) => [`GOAL: x`, `UPDATED: ${updated}`, "STATUS: current", "", ...Object.entries(sections).flatMap(([t, b]) => [`## ${t}`, b, ""])].join("\n");
const BUFFER = {
  "The limit now": "LIMIT: no money comes in besides salary.\n- About 18,000 euro on the private account.",
  "What works now": "- A small list pays when people know you ([Creator Science](https://example.org/a)).",
  "What changed this week": "- 2026-10-15: the central bank decides rates next on 29 October ([source](https://example.org/b)).",
  "Openings": "- 2026-11-03: an online hackathon, $9,000 in prizes ([lablab](https://example.org/c)).",
  "Experiments": "TEST: W-20261014-10, savings at a better rate\nRESULT: cancelled 2026-10-14.",
  "Worth asking for": "- May Mission Control change the newsletter's welcome page?",
};

const workMission = (extra = {}) => tmpMission({
  "coach/settings.json": JSON.stringify({ timezone: "Europe/Berlin", git_sync: "off" }),
  "coach/work/area.md": area({ AREA: "work", TITLE: "Work and money", RHYTHM: "weekly wednesday", SERVES: "buffer, sales, kits" }),
  "goals/buffer.md": goal("A savings buffer", ["- 2026-10-14 BET W-20261014-10 150 -> 240 interest over the period"]),
  "goals/research/buffer/brief.md": research("2026-10-14", BUFFER),
  "goals/sales.md": goal("Income from what I sell", ["- 2026-10-13 READ 0 (outside.txt line 'Ko-fi shop orders, ever')"]),
  "goals/research/sales/brief.md": research("2026-10-12", { "The limit now": "LIMIT: almost nobody reaches what he sells.", "Openings": "- A talk call in Dresden closes 2026-10-31." }),
  "goals/kits.md": goal("Three kits on a shelf", ["- 2026-10-01 PROGRESS kit two listed"]),
  ...extra,
});

test("the brief carries what the research found for each goal it serves, after the goals, without the experiments", () => {
  const mc = workMission();
  const b = brief(mc, S, readArea(path.join(mc, "coach", "work")), "2026-10-15");
  const buffer = b.indexOf("## What the research found for A savings buffer (updated 2026-10-14)\n");
  assert.ok(buffer > b.indexOf("## Goals it serves"), "after the goals it serves");
  assert.ok(b.indexOf("## What the research found for Income from what I sell") > buffer, "in the order the area serves them");
  // Its sections, one level down and in the file's order; the experiments and their codes never.
  assert.ok(b.includes([
    "## What the research found for A savings buffer (updated 2026-10-14)",
    "### The limit now", BUFFER["The limit now"], "",
    "### What works now", BUFFER["What works now"], "",
    "### What changed this week", BUFFER["What changed this week"], "",
    "### Openings", BUFFER.Openings, "",
    "### Worth asking for", BUFFER["Worth asking for"],
  ].join("\n")));
  assert.doesNotMatch(b, /Experiments|W-20261014-10/);
  // A goal with research keeps its title and measure and drops its log; one without keeps both.
  assert.match(b, /^- buffer: A savings buffer \(measure: a savings buffer in euro\)\n- sales:/m);
  assert.doesNotMatch(b, /READ 0 \(outside\.txt/);
  assert.match(b, /^- kits: Three kits on a shelf \(measure: three kits on a shelf in euro\)\n {4}- 2026-10-01 PROGRESS kit two listed$/m);
  assert.doesNotMatch(b, /What the research found for Three kits/);
  // Three days old is older than two days, and the heading says so.
  assert.match(b, /^## What the research found for Income from what I sell \(updated 2026-10-12, older than two days: say so if you use it\)$/m);
  assert.match(brief(mc, S, readArea(path.join(mc, "coach", "work")), "2026-10-14"), /^## What the research found for Income from what I sell \(updated 2026-10-12\)$/m, "two days old is not older than two days");
});

test("a mission control without goal research gets the brief it got before", () => {
  const mc = tmpMission({ "coach/work/area.md": area({ AREA: "work", TITLE: "Work and money", SERVES: "kits" }), "goals/kits.md": goal("Three kits on a shelf", ["- 2026-10-01 PROGRESS kit two listed"]) });
  const b = brief(mc, S, readArea(path.join(mc, "coach", "work")), "2026-10-15");
  assert.ok(b.endsWith("\n## Goals it serves\n- kits: Three kits on a shelf (measure: three kits on a shelf in euro)\n    - 2026-10-01 PROGRESS kit two listed"));
  assert.doesNotMatch(b, /research/i);
  assert.match(b, /--prepared "<two to four more things from what you read, one line each,/);
  assert.equal(goalResearch(mc, "kits", "2026-10-15"), null);
});

test("research longer than the cap leaves out whole sections, the least needed first, and says where the rest is", () => {
  const long = "- " + "a case that is long. ".repeat(40).trim();
  const mc = workMission({ "goals/research/buffer/brief.md": research("2026-10-15", { ...BUFFER, "What works now": long }) });
  const r = goalResearch(mc, "buffer", "2026-10-15", 400);
  assert.ok(r.length < 600);
  // Kept: what limits it, what changed and the openings; left out: the long cases and the ask, whole.
  for (const t of ["The limit now", "What changed this week", "Openings"]) assert.match(r, new RegExp(`^### ${t}$`, "m"));
  assert.doesNotMatch(r, /### What works now|a case that is long/);
  assert.match(r, /\nLeft out for length: What works now; Worth asking for\. All of it: goals\/research\/buffer\/brief\.md\.$/);
  assert.ok(r.indexOf("### What changed this week") < r.indexOf("### Openings"), "the file's order is kept");
  assert.equal(RESEARCH_CAP, 6000);
  // One section longer than the whole cap: its first whole lines.
  const huge = workMission({ "goals/research/buffer/brief.md": research("2026-10-15", { "The limit now": Array.from({ length: 30 }, (_, i) => `- line ${i} of the limit, said plainly`).join("\n") }) });
  const h = goalResearch(huge, "buffer", "2026-10-15", 300);
  assert.match(h, /### The limit now\n- line 0 of the limit, said plainly\n/);
  assert.match(h, /- line \d+ of the limit, said plainly\n\nLeft out for length: the rest of "The limit now"\. All of it: goals\/research\/buffer\/brief\.md\.$/);
  assert.ok(h.length < 450);
});

test("the brief's open command asks for what was prepared, and talk open keeps it right after the opening", () => {
  const mc = workMission();
  const b = cli(mc, "2026-10-15T17:00:00Z", "brief", "work").out;
  assert.ok(b.includes(`godspeed-coach talk open work --godspeed "${mc.replace(/\\/g, "/")}" --opening "<the opening>" --prepared "<two to four more things from the research, one line each, in plain words with their date and source link, ready for 'what else do you have?'>" --read "<what you read>"`));
  const prepared = "- 29 October: the central bank decides rates (https://example.org/b)\n- 3 November: an online hackathon, $9,000 in prizes (https://example.org/c)";
  assert.equal(cli(mc, "2026-10-15T17:02:00Z", "talk", "open", "work", "--opening", "From your coach, your weekly work and money talk: a talk call in Dresden closes on 31 October. Will you send one?", "--prepared", prepared, "--read", "the research").out, "Opened: coach/work/talks/2026-10-15.md");
  const rec = fs.readFileSync(path.join(mc, "coach", "work", "talks", "2026-10-15.md"), "utf8");
  assert.match(rec, /## The opening\nFrom your coach, your weekly work and money talk: a talk call in Dresden closes on 31 October\. Will you send one\?\n\n## Prepared\n- 29 October: the central bank decides rates \(https:\/\/example\.org\/b\)\n- 3 November: an online hackathon, \$9,000 in prizes \(https:\/\/example\.org\/c\)\n\n## What you said\n/);
  assert.equal(readTalk(readArea(path.join(mc, "coach", "work")), "2026-10-15").sections.Prepared, prepared);
  // A record without it has no such section.
  assert.equal(cli(mc, "2026-10-17T17:02:00Z", "talk", "open", "work", "--date", "2026-10-17", "--opening", "Hi.").code, 0);
  assert.doesNotMatch(fs.readFileSync(path.join(mc, "coach", "work", "talks", "2026-10-17.md"), "utf8"), /## Prepared/);
});

test("the block carries an open talk's opening and what was prepared, and says to answer from it", () => {
  const mc = workMission();
  const a = readArea(path.join(mc, "coach", "work"));
  openTalk(a, "2026-10-15", { opening: "From your coach, your weekly work and money talk:\na talk call closes on 31 October. Will you send one?", prepared: "- 29 October: rates decided (https://example.org/b)\n* 3 November: a hackathon, $9,000 (https://example.org/c)" }, new Date("2026-10-15T17:02:00Z"));
  const block = contextBlock(mc, S, new Date("2026-10-15T19:00:00Z")).split("\n");
  const at = block.findIndex((l) => l.startsWith("- Open talk: Work and money (id for commands: work), opened today at 19:02, record coach/work/talks/2026-10-15.md."));
  assert.ok(at > 0);
  assert.deepEqual(block.slice(at + 1, at + 8), [
    `  It opened with: "From your coach, your weekly work and money talk: a talk call closes on 31 October. Will you send one?"`,
    "  Prepared, for when they ask what else there is:",
    "  - 29 October: rates decided (https://example.org/b)",
    "  - 3 November: a hackathon, $9,000 (https://example.org/c)",
    "  Everything needed to continue this talk is here: answer from it without running commands or looking things up, unless they ask for something it lacks.",
    `  While this talk is open, a question like "what else do you have?", "what do you suggest?" or "what should I do?" is about this talk: answer from what was prepared.`,
    "  Every answer is one or two sentences, and a suggestion is one sentence.",
  ]);
  assert.match(block[0], /^\[godspeed-coach\] For you, not to pass on/);
});

test("the block stays compact: what was prepared is cut at about 1500 characters, by whole lines", () => {
  const mc = workMission();
  const a = readArea(path.join(mc, "coach", "work"));
  const many = Array.from({ length: 30 }, (_, i) => `- thing ${i}: ${"something worth saying, ".repeat(4)}(https://example.org/${i})`).join("\n");
  openTalk(a, "2026-10-15", { opening: "Will you send one?", prepared: many }, new Date("2026-10-15T17:02:00Z"));
  const block = contextBlock(mc, S, new Date("2026-10-15T19:00:00Z")).split("\n");
  const start = block.findIndex((l) => l.startsWith("  It opened with:"));
  const end = block.findIndex((l) => l.startsWith("  Everything needed"));
  const material = block.slice(start, end).join("\n");
  assert.equal(TALK_CHARS, 1500);
  assert.ok(material.length <= TALK_CHARS && material.length > 1200, `about 1500 characters, got ${material.length}`);
  for (const l of block.slice(start + 2, end)) assert.match(l, /^ {2}- thing \d+: .*\(https:\/\/example\.org\/\d+\)$/, "whole lines only");
});

test("talk said takes one --words per message, each on a line of its own", () => {
  const mc = workMission();
  assert.equal(cli(mc, "2026-10-15T17:02:00Z", "talk", "open", "work", "--opening", "Will you send one?").code, 0);
  assert.equal(cli(mc, "2026-10-15T17:30:00Z", "talk", "said", "work", "--words", "Which call do you mean?", "--words", "Ah, Dresden.\nYes, I will.", "--words", "  ", "--words", "What else do you have?").out, "Saved 3 messages.");
  assert.equal(cli(mc, "2026-10-15T17:31:00Z", "talk", "said", "work", "--words", "Thanks.", "--json").out, '{"ok":true,"date":"2026-10-15","saved":1}');
  const rec = fs.readFileSync(path.join(mc, "coach", "work", "talks", "2026-10-15.md"), "utf8");
  assert.match(rec, /## What you said\n- 19:30 Which call do you mean\?\n- 19:30 Ah, Dresden\. Yes, I will\.\n- 19:30 What else do you have\?\n- 19:31 Thanks\.\n\n## What changed/);
  const none = cli(mc, "2026-10-15T17:42:00Z", "talk", "said", "work", "--words", " ");
  assert.equal(none.code, 1); assert.match(none.err, /Give their words/);
});

const read = (rel) => fs.readFileSync(new URL(`../${rel}`, import.meta.url), "utf8").replace(/\r/g, "").replace(/\s+/g, " ");

test("the recipe: the research is the talk's material, things are said as what they are, and the talk runs nothing on a screen", () => {
  const text = read("skill/coach/SKILL.md");
  const opening = text.split("## Opening a talk")[1].split("## Continuing a talk")[0];
  assert.match(opening, /The brief's research sections \("What the research found for \.\.\."\) are the talk's main material\./);
  assert.match(opening, /never by a title from the obligations list, a work-item code or a goal id/);
  assert.match(opening, /if you cannot say in one sentence what it is and why it matters to them, leave it out/);
  assert.match(opening, /--prepared "<two to four more things from the research, one line each, in plain words with their date and source link, ready for 'what else do you have\?'>"/);
  const continuing = text.split("## Continuing a talk")[1].split("## Closing a talk")[0];
  assert.match(continuing, /On a chat app \(Telegram, WhatsApp\), save each message with `talk said` as it comes\./);
  assert.match(continuing, /run nothing while the talk goes on, and save all their messages at the close in one `talk said` with one `--words` per message/);
  assert.match(continuing, /The \[godspeed-coach\] block carries the opening and what was prepared: answer from it\./);
  assert.match(continuing, /something you notice is broken waits until the talk is over/);
  assert.match(continuing, /give the best prepared thing with its date, its source and what you recommend/);
  assert.doesNotMatch(text, /—/, "no em dash in the recipe");
});

// This copy only: without a messenger a talk waits in the chat, and its line already quotes the
// opening, so what was prepared follows it without the opening a second time.
test("a waiting talk carries what was prepared, and its opening once", () => {
  const mc = workMission();
  const a = readArea(path.join(mc, "coach", "work"));
  openTalk(a, "2026-10-15", { opening: "Will you send one?", prepared: "- 3 November: a hackathon (https://example.org/c)" }, new Date("2026-10-15T17:02:00Z"));
  const block = contextBlock(mc, { ...S, talk_delivery: "chat" }, new Date("2026-10-15T19:00:00Z")).split("\n");
  const at = block.findIndex((l) => l.startsWith("- Waiting talk: Work and money"));
  assert.ok(at > 0);
  assert.deepEqual(block.slice(at + 1, at + 6), [
    "  Prepared, for when they ask what else there is:",
    "  - 3 November: a hackathon (https://example.org/c)",
    "  Everything needed to continue this talk is here: answer from it without running commands or looking things up, unless they ask for something it lacks.",
    `  While this talk is open, a question like "what else do you have?", "what do you suggest?" or "what should I do?" is about this talk: answer from what was prepared.`,
    "  Every answer is one or two sentences, and a suggestion is one sentence.",
  ]);
  assert.equal(block.join("\n").split("Will you send one?").length, 2);
});
