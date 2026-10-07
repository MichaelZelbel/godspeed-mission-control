// The incident replayed through the command itself, with files on disk: the Substack task
// opened at 22:09 on 2026-09-28, the post went out at 22:35, and the next afternoon's check-in
// asked "still on it?". A stand-in record program prints the post the way a real one would.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "godspeed-journal.mjs");
const POST = { kind: "post", platform: "substack", at: "2026-09-28T20:35:25.534Z", id: "b7d5bd04",
  url: "https://michaelzelbel.substack.com/p/my-ai-spent-75-days-on-sap-customer", title: "My AI Spent 75 Days on SAP Customer Support. I Wrote Nothing." };

// record: "post" prints the post, "empty" prints nothing, "broken" fails.
function mcDir(record = "post") {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hj-ev-")); fs.writeFileSync(path.join(d, "AGENTS.md"), "");
  fs.mkdirSync(path.join(d, "routines", "journal"), { recursive: true });
  fs.writeFileSync(path.join(d, "routines", "journal", "settings.json"), JSON.stringify({
    timezone: "Europe/Berlin", git_sync: "off", nudge: { enabled: true }, evidence: { script: "record.mjs" },
  }));
  const body = {
    // Asked about Substack, from the Substack task's start: an older task that names no platform
    // must not stretch the window, or a copy of the record kept for exactly this is refused.
    post: `if (!(process.env.GODSPEED_JOURNAL_PLATFORMS || "").split(",").includes("substack")) process.exit(2);\n` +
      `if (process.env.GODSPEED_JOURNAL_SINCE !== "2026-09-28T20:09:27.000Z") { console.error("asked from " + process.env.GODSPEED_JOURNAL_SINCE); process.exit(3); }\n` +
      `console.log(${JSON.stringify(JSON.stringify(POST))});\n`,
    empty: "",
    broken: 'console.error("Planino did not answer"); process.exit(1);\n',
  }[record];
  fs.writeFileSync(path.join(d, "record.mjs"), body);
  return d;
}
const run = (h, now, ...a) => spawnSync(process.execPath, [BIN, ...a, "--godspeed", h], { encoding: "utf8", env: { ...process.env, GODSPEED_NOW: now } });
const startSubstack = (h) => run(h, "2026-09-28T20:09:27Z", "start", "Substack post for yesterday's video",
  "--done-means", "all Substack texts in the Planino Studio project", "--done-means", "post page open, ready to post tomorrow morning");
const ASKED = "2026-09-29T14:15:06Z";
const entryFiles = (h) => {
  const out = []; const walk = (d) => { for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else out.push(fs.readFileSync(p, "utf8")); } };
  walk(path.join(h, "routines", "journal", "entries")); return out;
};

test("replay: the check-in closes the task with the post's link and sends nothing", () => {
  const h = mcDir("post"); startSubstack(h);
  const tick = run(h, ASKED, "tick");
  assert.equal(tick.status, 0, tick.stderr);
  assert.equal(tick.stdout, "");
  assert.deepEqual(JSON.parse(run(h, ASKED, "open", "--json").stdout), []);
  const done = entryFiles(h).find((t) => /kind: done/.test(t));
  assert.match(done, /source: evidence/);
  assert.match(done, /evidence: https:\/\/michaelzelbel\.substack\.com\/p\/my-ai-spent-75-days-on-sap-customer/);
  assert.match(run(h, ASKED, "day", "2026-09-28").stdout, /Substack post for yesterday's video: done, 26 min/);
  // The next prompt: the block names it as done and suggests asking about nothing.
  const ctx = run(h, "2026-09-29T15:00:00Z", "context").stdout;
  assert.match(ctx, /Closed from the record/);
  assert.doesNotMatch(ctx, /side-asked/);
});

test("replay: an older open task that names no platform does not stretch what the record is asked for", () => {
  const h = mcDir("post");
  run(h, "2026-09-28T12:20:41Z", "start", "Interstitial journaling trial");
  startSubstack(h);
  assert.equal(run(h, ASKED, "tick").stdout, "");
  assert.deepEqual(JSON.parse(run(h, ASKED, "open", "--json").stdout).map((t) => t.title), ["Interstitial journaling trial"]);
});

test("the prompt block only reads what is known and asks nothing; closing from the record is the check-in's job", () => {
  const h = mcDir("post"); startSubstack(h);
  const ctx = run(h, "2026-09-29T08:00:00Z", "context");
  assert.equal(ctx.status, 0, ctx.stderr);
  assert.match(ctx.stdout, /"Substack post for yesterday's video" since Mon/);
  assert.doesNotMatch(ctx.stdout, /paused|side-asked|end your answer/i);
  assert.equal(run(h, "2026-09-29T08:05:00Z", "tick").stdout, ""); // the tick closes it, silently
  const after = run(h, "2026-09-29T08:06:00Z", "context").stdout;
  assert.match(after, /Closed from the record/);
});

test("after the check-in closes one task, the block names it done and still asks about nothing else", () => {
  const h = mcDir("post");
  run(h, "2026-09-28T12:20:41Z", "start", "Interstitial journaling trial", "--done-means", "decided: in Teach It Once or not");
  startSubstack(h);
  fs.mkdirSync(path.join(h, "world", "events"), { recursive: true });
  fs.writeFileSync(path.join(h, "world", "events", "2026-09-29-interstitial-journaling-trial-verdict-closed.md"),
    "---\ndate: 2026-09-29\n---\n\nInterstitial journaling trial verdict: done. Keep.\n");
  run(h, "2026-09-29T22:10:00Z", "tick");
  const ctx = run(h, "2026-09-29T22:15:00Z", "context").stdout;
  assert.match(ctx, /Closed from the record/);
  assert.match(ctx, /"Interstitial journaling trial" since Mon/);
  assert.doesNotMatch(ctx, /paused|side-asked|end your answer/i);
});

test("with nothing on record the check-in still goes out, saying what was looked at", () => {
  const h = mcDir("empty"); startSubstack(h);
  const out = run(h, ASKED, "tick").stdout;
  assert.match(out, /^From your journal: yesterday at 22:09 you started "Substack post for yesterday's video"\. You said it is done when: all Substack texts in the Planino Studio project; post page open, ready to post tomorrow morning\. Nothing has gone out on Substack since\. Nothing about it has been noted since\.\n/);
});

test("a record that cannot be read holds the check-in, and check says why", () => {
  const h = mcDir("broken"); startSubstack(h);
  assert.equal(run(h, ASKED, "tick").stdout, "");
  assert.equal(JSON.parse(run(h, ASKED, "open", "--json").stdout).length, 1);
  assert.match(run(h, "2026-09-29T08:00:00Z", "context").stdout, /Substack post/);
  assert.doesNotMatch(run(h, "2026-09-29T08:00:00Z", "context").stdout, /side-asked/);
  assert.match(run(h, ASKED, "check", "--no-hermes").stdout, /✗ the record \(record\.mjs\) for substack: Planino did not answer; until it answers, check-ins about those tasks wait/);
});

test("evidence --needs says what the record must cover; evidence closes now; reopen undoes it", () => {
  const h = mcDir("post"); startSubstack(h);
  run(h, "2026-09-28T20:10:00Z", "start", "Tofu");
  assert.deepEqual(JSON.parse(run(h, "2026-09-28T20:40:00Z", "evidence", "--needs").stdout),
    { since: "2026-09-28T20:09:27.000Z", platforms: ["substack"] });
  const ev = run(h, "2026-09-28T20:40:00Z", "evidence", "--json");
  assert.equal(ev.status, 0, ev.stderr);
  const { closed } = JSON.parse(ev.stdout);
  assert.equal(closed.length, 1); assert.equal(closed[0].title, "Substack post for yesterday's video"); assert.equal(closed[0].evidence, POST.url);
  assert.equal(run(h, "2026-09-28T20:41:00Z", "evidence", "--needs").stdout, "");
  // "That one is not done": it opens again, and the same post never closes it a second time.
  const r = run(h, "2026-09-28T20:50:00Z", "reopen", "--words", "that was the other post");
  assert.match(r.stdout, /Reopened "Substack post for yesterday's video"; https:\/\/michaelzelbel\.substack\.com\/p\/my-ai-spent-75-days-on-sap-customer will not close it again\./);
  assert.equal(JSON.parse(run(h, "2026-09-28T20:51:00Z", "evidence", "--json").stdout).closed.length, 0);
  assert.equal(JSON.parse(run(h, "2026-09-28T20:51:00Z", "open", "--json").stdout).length, 2);
});

test("world/events: an event that the task finished holds the question; an event that it started does not", () => {
  const h = mcDir("empty");
  run(h, "2026-09-22T08:00:00Z", "start", "September invoice paperwork");
  fs.mkdirSync(path.join(h, "world", "events"), { recursive: true });
  fs.writeFileSync(path.join(h, "world", "events", "2026-09-22-michael-started-preparing-his-september-invoice-paperwork.md"), "---\ndate: 2026-09-22\n---\n\nMichael started the September invoice paperwork.\n");
  assert.match(run(h, "2026-09-22T11:15:00Z", "tick").stdout, /you started "September invoice paperwork"/);

  const h2 = mcDir("empty");
  run(h2, "2026-09-22T08:00:00Z", "start", "September invoice paperwork");
  fs.mkdirSync(path.join(h2, "world", "events"), { recursive: true });
  fs.writeFileSync(path.join(h2, "world", "events", "2026-09-22-september-invoice-paperwork-sent-to-the-tax-advisor.md"), "---\ndate: 2026-09-22\n---\n\nThe September invoice paperwork went to the tax advisor.\n");
  assert.equal(run(h2, "2026-09-22T11:15:00Z", "tick").stdout, "");
  assert.equal(JSON.parse(run(h2, "2026-09-22T11:16:00Z", "open", "--json").stdout).length, 1); // held, never closed
});
