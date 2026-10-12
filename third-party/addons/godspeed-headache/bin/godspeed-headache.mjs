#!/usr/bin/env node
// godspeed-headache: a headache tracker you talk to. Say when it started, how bad, where, what you took,
// and later that it is over; the log keeps it and finds the pattern. This file only parses
// arguments and prints. What gets decided lives in lib/, where the tests can reach it.
import fs from "node:fs";
import { findMissionControl } from "../lib/paths.mjs";
import { now, localParts } from "../lib/clock.mjs";
import { resolveTime } from "../lib/when.mjs";
import { loadSettings, setSetting, DEFAULTS } from "../lib/settings.mjs";
import { openDiary } from "../lib/diary.mjs";
import { resolveFrom, newEpisodeId, normSide, normQuality, parsePain, parseMed } from "../lib/episodes.mjs";
import { describe, dailyRollup, patterns, renderPatterns, dayOf } from "../lib/report.mjs";
import { contextBlock } from "../lib/context.mjs";
import { commitHeadache, syncInBackground } from "../lib/sync.mjs";
import { addDays } from "../lib/when.mjs";
import { decodeArgv, readWordsFile, restoreShellEnv, startedFromGitBash, gitBashPath, LAUNCHER_ENV, CMDLINE_ENV } from "../lib/argv.mjs";

const REPEATABLE = new Set(["symptom", "trigger", "med"]);
// The values that name a file or folder. From Git Bash these are turned into Windows paths;
// the person's words never are (lib/argv.mjs).
const PATH_FLAGS = ["godspeed", "words-file", "extra-skills-dir"];
const FLAGS = new Set(["json", "csv", "yes", "no-hermes", "no-claude", "dry-run"]);
function parseArgs(argv) {
  const pos = []; const f = { symptom: [], trigger: [], med: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { pos.push(a); continue; }
    const k = a.slice(2);
    let v = true;
    if (!FLAGS.has(k)) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) return { pos, f, error: `--${k} needs a value.` };
      v = next; i++;
    }
    if (REPEATABLE.has(k)) f[k].push(v); else f[k] = v;
  }
  return { pos, f };
}

// The launchers say how they handed the arguments over (lib/argv.mjs). The markers are read once
// and taken out of the environment, so a program this one starts (the background sync) never
// mistakes itself for something the .cmd launcher started.
const launched = decodeArgv(process.argv.slice(2), process.env);
const fromGitBash = startedFromGitBash(process.env);
delete process.env[LAUNCHER_ENV]; delete process.env[CMDLINE_ENV];
restoreShellEnv(process.env);
const [cmd = "help", ...rest] = launched.argv;
const { pos, f, error: argError } = parseArgs(rest);
const QUIET = cmd === "context";
function die(msg) { if (QUIET) process.exit(0); console.error(msg); process.exit(1); }
if (launched.error) die(launched.error);
if (argError) die(argError);
if (fromGitBash) for (const k of PATH_FLAGS) if (typeof f[k] === "string") f[k] = gitBashPath(f[k]);
// Words that hold a line break or a quote travel safest in a file: no shell reads a file's
// contents, so nothing on the way can cut or change them.
if (f["words-file"] !== undefined) {
  if (f.words !== undefined) die("Give the words once: either --words or --words-file, not both.");
  try { f.words = readWordsFile(f["words-file"]); } catch (e) { die(e.message); }
}

const mcDir = findMissionControl({ arg: f.godspeed });
if (!mcDir && !["help", "setup"].includes(cmd)) die("Could not find your mission control folder. Run this from inside it, or add --godspeed <folder>.");
const s = mcDir ? loadSettings(mcDir) : { ...DEFAULTS };
const rawSync = process.env.GODSPEED_HEADACHE_GIT_SYNC;
const syncMode = ["auto", "commit", "off"].includes(rawSync) ? rawSync : s.git_sync;
const tz = s.timezone;
// Which diary this mission control keeps: the notebook's Headaches tracker or the entry files
// (lib/diary.mjs). In the notebook a time said as "now" is kept to the minute, as he says times.
const diary = mcDir && !["help", "setup", "_sync"].includes(cmd) ? openDiary(mcDir, s) : null;
const at = diary?.kind === "notebook" ? new Date(Math.floor(now().getTime() / 60000) * 60000) : now();
const out = (human, json) => console.log(f.json ? JSON.stringify(json) : human);
const when = (spec, opts = {}) => { try { return resolveTime(spec, { tz, now: at, ...opts }); } catch (e) { die(e.message); } };

// Everything one command writes is saved first and synced once, in the background, so the
// person's words are safe before anything slow happens.
// The notebook's rows reach the other machines with the notebook's own sync.
function saveAll(list, label) {
  try { diary.save(list.map((entry) => ({ source: f.source || "cli", ...entry, at: at.toISOString() })), at); }
  catch (e) { die(`godspeed-headache: ${e.message}`); }
  if (diary.kind === "files") syncInBackground(mcDir, `headache: ${label}`, syncMode);
}
const log = () => diary.log();

function details() {
  const d = {};
  if (f.pain !== undefined) { try { d.pain = parsePain(f.pain); } catch (e) { die(e.message); } }
  if (f.side) d.side = normSide(f.side);
  if (f.quality) d.quality = normQuality(f.quality);
  if (f.symptom.length) d.symptoms = f.symptom.map((x) => String(x).trim().toLowerCase());
  if (f.trigger.length) d.triggers = f.trigger.map((x) => String(x).trim().toLowerCase());
  return d;
}

// A pill said without a time is kept without one ("untimed"): it still counts on its day (see the
// caller for which moment stands for that day), but nothing says or reckons with a time nobody gave.
// Until 0.3.1 it was stamped with the moment of the message, and "took one ibuprofen" came back as
// "took ibuprofen 1 at 06:41" (the book's capture run of 12 October 2026). "--taken now" is a time.
function medEntries(episode, defaultTaken) {
  const taken = (f.taken ? when(f.taken) : defaultTaken || at).toISOString();
  return f.med.map(parseMed).filter(Boolean).map((m) => ({ kind: "med", episode, med: m.med, dose: m.dose || f.dose || "", taken, ...(f.taken ? {} : { untimed: true }) }));
}

function needEpisode(opts) {
  const ep = resolveFrom(log().episodes, f.episode, opts);
  if (!ep) die(f.episode ? `No headache called ${f.episode}.` : "No headache is open. Start one first, or log a finished one with: godspeed-headache log --from 06:30 --to 09:30");
  return ep;
}

const show = (id) => log().episodes.find((e) => e.id === id);

const commands = {
  start() {
    const start = when(f.at || f.from || "now");
    if (start > at) die("That start time is in the future.");
    const p = localParts(start, tz);
    const id = newEpisodeId(p.date, p.hm, log().episodes.map((e) => ({ episode: e.id })));
    const list = [{ kind: "start", episode: id, start: start.toISOString(), ...details(), words: f.words || "" }];
    // A pill said with a headache that is still going was taken now ("just took two"); with a
    // finished one logged afterwards, at its start unless a time was said.
    list.push(...medEntries(id, f.to ? start : at));
    if (f.to) {
      const end = when(f.to, { after: start });
      if (end > new Date(at.getTime() + 5 * 60000)) die("That end time is in the future.");
      list.push({ kind: "end", episode: id, end: end.toISOString() });
    }
    saveAll(list, `start ${id}`);
    const ep = show(id);
    out(`Saved: ${describe(ep, tz, at)} (${id})`, { ok: true, episode: ep });
  },
  log() {
    if (!f.from || !f.to) die("A finished headache needs --from and --to, for example --from 06:30 --to 09:30.");
    return commands.start();
  },
  set() {
    const ep = needEpisode({ includeClosed: true });
    const d = details();
    if (f.from || f.at) d.start = when(f.from || f.at).toISOString();
    if (f.to) d.end = when(f.to, { after: new Date(d.start || ep.start) }).toISOString();
    const meds = medEntries(ep.id, null);
    if (!Object.keys(d).length && !meds.length && !f.words) die("Nothing to add. Give a --pain, --side, --quality, --symptom, --trigger, --med or --words.");
    const list = Object.keys(d).length || f.words ? [{ kind: "set", episode: ep.id, ...d, words: f.words || "" }] : [];
    saveAll([...list, ...meds], `update ${ep.id}`);
    out(`Saved: ${describe(show(ep.id), tz, at)}`, { ok: true, episode: show(ep.id) });
  },
  med() {
    const name = pos.join(" ").trim();
    if (name) f.med.unshift(name);
    if (!f.med.length) die('Say what you took: godspeed-headache med "Thomapyrin Intensiv" --dose "2 tablets"');
    const eps = log().episodes;
    const ep = f.episode ? resolveFrom(eps, f.episode) : eps.filter((e) => e.open).at(-1);
    if (f.episode && !ep) die(`No headache called ${f.episode}.`);
    // A pill with no headache open is still saved: it is a painkiller day, which is what the
    // overuse count needs. The person's words go with the first pill, once, as said.
    const meds = medEntries(ep?.id, null);
    if (f.words && meds.length) meds[0].words = f.words;
    saveAll(meds, `med ${f.med.join(", ")}`);
    out(ep ? `Saved: ${describe(show(ep.id), tz, at)}` : `Saved: ${f.med.join(", ")}${f.taken ? ` at ${localParts(when(f.taken), tz).hm}` : ""}, no headache open.`, { ok: true, episode: ep ? show(ep.id) : null });
  },
  end() {
    const ep = needEpisode();
    const end = when(f.at || f.to || "now", { after: new Date(ep.start) });
    if (end > new Date(at.getTime() + 5 * 60000)) die("That end time is in the future.");
    const e = { kind: "end", episode: ep.id, end: end.toISOString(), words: f.words || "" };
    if (f.pain !== undefined) { try { e.pain = parsePain(f.pain); } catch (x) { die(x.message); } }
    saveAll([e], `end ${ep.id}`);
    out(`Saved: ${describe(show(ep.id), tz, at)}`, { ok: true, episode: show(ep.id) });
  },
  cancel() {
    const ep = needEpisode({ includeClosed: true });
    saveAll([{ kind: "cancel", episode: ep.id, words: f.words || "" }], `cancel ${ep.id}`);
    out(`Removed from the log: ${describe(ep, tz, at)}`, { ok: true, cancelled: ep.id });
  },
  open() {
    const eps = log().episodes.filter((e) => e.open);
    out(eps.map((e) => `${e.id}: ${describe(e, tz, at)}`).join("\n") || "No headache open.", eps);
  },
  list() {
    const days = Number(f.days || 30);
    const from = addDays(localParts(at, tz).date, -(days - 1));
    const eps = log().episodes.filter((e) => dayOf(e.start, tz) >= from);
    out(eps.map((e) => describe(e, tz, at)).join("\n") || `No headache tracked in the last ${days} days.`, eps);
  },
  patterns() {
    const r = patterns(log(), s, at, { days: Number(f.days || 90) });
    out(renderPatterns(r), r);
  },
  daily() {
    const days = Number(f.days || 3650);
    const to = localParts(at, tz).date;
    const rows = dailyRollup(log(), tz, at, { from: f.from || addDays(to, -(days - 1)), to: f.to || to });
    if (f.csv) {
      const cols = ["date", "headache_min", "headache_max_pain", "headache_episodes", "painkiller_doses"];
      return console.log([cols.join(","), ...rows.map((r) => cols.map((c) => r[c] ?? "").join(","))].join("\n"));
    }
    out(rows.map((r) => `${r.date}: ${r.headache_min} min, pain ${r.headache_max_pain ?? "-"}, ${r.painkiller_doses} doses`).join("\n") || "Nothing logged.", rows);
  },
  context() {
    const c = contextBlock(log().episodes, s, at);
    if (!c) return;
    if (f.hook === "claude") return console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: c } }));
    process.stdout.write(c + "\n");
  },
  config() {
    const [sub = "show", key, ...v] = pos;
    if (sub === "show") return console.log(JSON.stringify(loadSettings(mcDir), null, 2));
    if (sub === "set") {
      if (!key) die("godspeed-headache config set <key> <value>");
      try { setSetting(mcDir, key, v.join(" ")); } catch (e) { die(e.message); }
      syncInBackground(mcDir, `headache: setting ${key}`, syncMode);
      return console.log(`Changed: ${key} = ${v.join(" ")}`);
    }
    die("godspeed-headache config [show | set <key> <value>]");
  },
  // Moves the entry files into the notebook's Headaches tracker, checks every headache and every
  // day before and after, and only then puts the old files away (lib/migrate.mjs).
  async migrate() {
    const { migrate, renderMigration } = await import("../lib/migrate.mjs");
    const r = migrate(mcDir, s, at, { dryRun: !!f["dry-run"] });
    out(renderMigration(r), r);
    if (!r.ok) process.exitCode = 1;
  },
  async setup() { const { setup } = await import("../lib/setup.mjs"); process.exitCode = await setup(f); },
  async check() { const { check } = await import("../lib/setup.mjs"); process.exitCode = await check(mcDir, f); },
  _sync() { commitHeadache(mcDir, pos.join(" ") || "headache: entries", syncMode); },
  help() {
    console.log(fs.readFileSync(new URL("../README.md", import.meta.url), "utf8").split("## Use")[1]?.split("\n## ")[0] || "See README.md");
  },
};

try {
  if (!commands[cmd]) die(`Unknown command "${cmd}". Try: godspeed-headache help`);
  await commands[cmd]();
} catch (e) {
  die(`godspeed-headache: ${e.message}`);
}
