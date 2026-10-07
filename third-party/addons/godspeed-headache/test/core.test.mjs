import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveTime, localToInstant } from "../lib/when.mjs";
import { episodesFrom, normSide, normQuality, parsePain, parseMed, newEpisodeId } from "../lib/episodes.mjs";
import { dailyRollup, patterns, minutesByDay } from "../lib/report.mjs";
import { contextBlock } from "../lib/context.mjs";
import { validateSettings, DEFAULTS } from "../lib/settings.mjs";
import { claudeHookMerge } from "../lib/setup.mjs";

const TZ = "Europe/Berlin";
const NOW = new Date("2026-09-27T07:10:00Z"); // 09:10 in Berlin
const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "godspeed-headache.mjs");

test("a bare time is today, or yesterday when it lies in the future", () => {
  assert.equal(resolveTime("06:30", { tz: TZ, now: NOW }).toISOString(), "2026-09-27T04:30:00.000Z");
  assert.equal(resolveTime("23:30", { tz: TZ, now: NOW }).toISOString(), "2026-09-26T21:30:00.000Z");
  assert.equal(resolveTime("yesterday 22:00", { tz: TZ, now: NOW }).toISOString(), "2026-09-26T20:00:00.000Z");
  assert.equal(resolveTime("gestern 22.00", { tz: TZ, now: NOW }).toISOString(), "2026-09-26T20:00:00.000Z");
});

test("an end before its start is the next day", () => {
  const start = new Date("2026-09-26T20:00:00Z");
  assert.equal(resolveTime("01:15", { tz: TZ, now: NOW, after: start }).toISOString(), "2026-09-26T23:15:00.000Z");
});

test("relative times need no clock sums", () => {
  assert.equal(resolveTime("-30m", { tz: TZ, now: NOW }).toISOString(), "2026-09-27T06:40:00.000Z");
  assert.equal(resolveTime("2 h ago", { tz: TZ, now: NOW }).toISOString(), "2026-09-27T05:10:00.000Z");
  assert.equal(resolveTime("vor 90 min", { tz: TZ, now: NOW }).toISOString(), "2026-09-27T05:40:00.000Z");
});

test("winter time is handled", () => {
  assert.equal(localToInstant("2026-12-01", "06:30", TZ).toISOString(), "2026-12-01T05:30:00.000Z");
});

test("nonsense times are refused", () => {
  assert.throws(() => resolveTime("25:00", { tz: TZ, now: NOW }));
  assert.throws(() => resolveTime("sometime", { tz: TZ, now: NOW }));
});

test("words are normalised so a pattern counts one side once", () => {
  assert.equal(normSide("Rechts"), "right");
  assert.equal(normSide("links"), "left");
  assert.equal(normQuality("pochend"), "pounding");
  assert.equal(normQuality("stinging"), "stabbing");
  assert.equal(normQuality("like a helmet"), "like a helmet");
  assert.equal(parsePain("3"), 3);
  assert.equal(parsePain("6,5"), 6.5);
  assert.throws(() => parsePain("11"));
  assert.deepEqual(parseMed("Thomapyrin Intensiv: 2 tablets"), { med: "Thomapyrin Intensiv", dose: "2 tablets" });
});

const E = (at, o) => ({ at, ...o });
const LOG = [
  E("2026-09-27T07:10:00.000Z", { kind: "med", episode: "h-a", med: "Thomapyrin", dose: "2", taken: "2026-09-27T04:45:00.000Z" }),
  E("2026-09-27T07:10:00.000Z", { kind: "start", episode: "h-a", start: "2026-09-27T04:30:00.000Z", pain: 3, side: "right" }),
  E("2026-09-27T08:00:00.000Z", { kind: "set", episode: "h-a", pain: 5 }),
  E("2026-09-27T08:00:00.000Z", { kind: "end", episode: "h-a", end: "2026-09-27T07:30:00.000Z" }),
  E("2026-09-27T08:01:00.000Z", { kind: "start", episode: "h-b", start: "2026-09-27T08:00:00.000Z" }),
  E("2026-09-27T08:02:00.000Z", { kind: "cancel", episode: "h-b" }),
  E("2026-09-27T09:00:00.000Z", { kind: "med", med: "Ibuprofen", taken: "2026-09-27T09:00:00.000Z" }),
];

test("an episode is computed from its entries, in any file order", () => {
  const { episodes, loose } = episodesFrom(LOG);
  assert.equal(episodes.length, 1, "the cancelled one is gone");
  const ep = episodes[0];
  assert.equal(ep.open, false);
  assert.equal(ep.minutes, 180);
  assert.equal(ep.pain_first, 3);
  assert.equal(ep.pain_max, 5);
  assert.equal(ep.meds.length, 1, "the pill saved in the same second as the start is kept");
  assert.equal(loose.length, 1);
});

test("a new id never collides", () => {
  assert.equal(newEpisodeId("2026-09-27", "06:30", [{ episode: "h-20260927-0630" }]), "h-20260927-0630-2");
});

test("minutes are split at local midnight", () => {
  const ep = { start: "2026-09-26T20:00:00.000Z", end: "2026-09-26T23:15:00.000Z" };
  assert.deepEqual(minutesByDay(ep, TZ, NOW), { "2026-09-26": 120, "2026-09-27": 75 });
});

test("the daily rollup counts minutes, strongest pain and doses", () => {
  const rows = dailyRollup(episodesFrom(LOG), TZ, NOW, {});
  assert.deepEqual(rows, [{ date: "2026-09-27", headache_min: 180, headache_max_pain: 5, headache_episodes: 1, painkiller_doses: 2 }]);
});

test("painkiller days are counted against the limit inside any 30 days", () => {
  const log = { episodes: [], loose: [] };
  for (let i = 0; i < 12; i++) log.loose.push({ med: "Thomapyrin", taken: new Date(Date.UTC(2026, 8, 1 + i * 2, 10)).toISOString() });
  const r = patterns(log, { ...DEFAULTS, timezone: TZ }, NOW, { days: 90 });
  assert.equal(r.painkiller_days, 12);
  assert.equal(r.painkiller_days_worst_30, 12);
});

test("the pattern report compares headache days with a daily table only when there is one", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-"));
  const csv = path.join(dir, "daily.csv");
  const lines = ["date,sleep_total_h"];
  for (let i = 1; i <= 20; i++) lines.push(`2026-09-${String(i).padStart(2, "0")},${i <= 6 ? 5 : 8}`);
  fs.writeFileSync(csv, lines.join("\n"));
  const episodes = [];
  for (let i = 1; i <= 6; i++) episodes.push({ id: `h${i}`, start: `2026-09-0${i}T06:00:00.000Z`, end: `2026-09-0${i}T08:00:00.000Z`, open: false, minutes: 120, pain_max: 3, side: null, quality: null, symptoms: [], triggers: [], meds: [] });
  const r = patterns({ episodes, loose: [] }, { ...DEFAULTS, timezone: TZ, daily_table: csv, daily_columns: ["sleep_total_h"] }, new Date("2026-09-20T12:00:00Z"), { days: 30 });
  assert.deepEqual(r.compare[0], { column: "sleep_total_h", headache_days: 6, free_days: 14, mean_on: 5, mean_off: 8, enough: true });
  const none = patterns({ episodes, loose: [] }, { ...DEFAULTS, timezone: TZ }, NOW, { days: 30 });
  assert.equal(none.compare, null);
});

test("the context block is empty when nothing is open, and names the open headache", () => {
  const s = { ...DEFAULTS, timezone: TZ };
  assert.equal(contextBlock(episodesFrom(LOG).episodes, s, NOW), "");
  const open = episodesFrom(LOG.slice(0, 3)).episodes;
  const c = contextBlock(open, s, NOW);
  assert.match(c, /\[godspeed-headache\] Open headache/);
  assert.match(c, /h-a: 2026-09-27: since 06:30/);
  assert.match(c, /Thomapyrin 2 at 06:45/);
  const stale = contextBlock(open, s, new Date("2026-09-28T07:10:00Z"));
  assert.match(stale, /more than 20 hours/);
});

test("settings are checked", () => {
  assert.deepEqual(validateSettings({ ...DEFAULTS, timezone: TZ }), []);
  assert.equal(validateSettings({ ...DEFAULTS, timezone: "Mars/Olympus" }).length, 1);
  assert.equal(validateSettings({ ...DEFAULTS, overuse_days: 0 }).length, 1);
});

test("the Claude hook is added once", () => {
  const once = claudeHookMerge("", "godspeed-headache context --hook claude");
  assert.match(once, /UserPromptSubmit/);
  assert.equal(claudeHookMerge(once, "godspeed-headache context --hook claude"), null);
});

function mc() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-mc-"));
  fs.writeFileSync(path.join(dir, "AGENTS.md"), "# test\n");
  fs.mkdirSync(path.join(dir, "routines", "headache"), { recursive: true });
  fs.writeFileSync(path.join(dir, "routines", "headache", "settings.json"), JSON.stringify({ timezone: TZ, git_sync: "off" }));
  return dir;
}
const cli = (dir, now, ...args) => spawnSync(process.execPath, [BIN, ...args, "--godspeed", dir], { encoding: "utf8", env: { ...process.env, GODSPEED_NOW: now } });

test("the command: start with a pill, a detail, the end, then a finished one", () => {
  const dir = mc();
  let r = cli(dir, "2026-09-27T07:10:00Z", "start", "--at", "06:30", "--pain", "3", "--side", "rechts", "--quality", "pochend", "--med", "Thomapyrin Intensiv: 2 tablets", "--taken", "06:45", "--words", "Kopfschmerz rechts");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /since 06:30.*pain 3; right; pounding; took Thomapyrin Intensiv 2 tablets at 06:45/);
  r = cli(dir, "2026-09-27T07:20:00Z", "context");
  assert.match(r.stdout, /Open headache/);
  r = cli(dir, "2026-09-27T08:00:00Z", "set", "--pain", "5");
  assert.match(r.stdout, /pain 3 to 5/);
  r = cli(dir, "2026-09-27T08:00:00Z", "end", "--at", "09:30");
  assert.match(r.stdout, /06:30-09:30, 3 h/);
  r = cli(dir, "2026-09-27T08:00:00Z", "end");
  assert.notEqual(r.status, 0, "nothing open to end");
  r = cli(dir, "2026-09-27T08:05:00Z", "log", "--from", "yesterday 22:00", "--to", "01:15", "--pain", "2");
  assert.match(r.stdout, /22:00-01:15 \(2026-09-27\), 3 h 15 min/);
  r = cli(dir, "2026-09-27T08:05:00Z", "context");
  assert.equal(r.stdout, "", "nothing open, nothing said");
  r = cli(dir, "2026-09-27T08:06:00Z", "daily", "--csv");
  assert.match(r.stdout, /2026-09-26,120,2,1,0/);
  assert.match(r.stdout, /2026-09-27,255,5,1,1/);
  r = cli(dir, "2026-09-27T08:06:00Z", "patterns", "--json");
  assert.equal(JSON.parse(r.stdout).episodes, 2);
});

test("the command refuses a start in the future and an unreadable time", () => {
  const dir = mc();
  assert.notEqual(cli(dir, "2026-09-27T07:10:00Z", "start", "--at", "2026-09-28 06:30").status, 0);
  assert.notEqual(cli(dir, "2026-09-27T07:10:00Z", "start", "--at", "soon").status, 0);
  assert.notEqual(cli(dir, "2026-09-27T07:10:00Z", "start", "--pain", "12").status, 0);
});

test("a pill said with a headache still going was taken now, with a finished one at its start", () => {
  const dir = mc();
  let r = cli(dir, "2026-09-27T18:57:00Z", "start", "--at", "18:30", "--med", "Thomapyrin Intensiv: 2 tablets", "--json");
  assert.equal(JSON.parse(r.stdout).episode.meds[0].taken, "2026-09-27T18:57:00.000Z");
  r = cli(dir, "2026-09-27T18:58:00Z", "log", "--from", "06:30", "--to", "09:30", "--med", "Thomapyrin Intensiv", "--json");
  assert.equal(JSON.parse(r.stdout).episode.meds[0].taken, "2026-09-27T04:30:00.000Z");
});

test("a pill with no headache open is still saved", () => {
  const dir = mc();
  const r = cli(dir, "2026-09-27T07:10:00Z", "med", "Thomapyrin Intensiv", "--dose", "1 tablet");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /no headache open/);
  assert.match(cli(dir, "2026-09-27T07:10:00Z", "daily", "--csv").stdout, /2026-09-27,0,,0,1/);
});
