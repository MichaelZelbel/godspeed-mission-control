#!/usr/bin/env node
// godspeed-coach: recurring coaching talks and daily habits for Godspeed Mission Control. This file only
// parses arguments and prints. What gets decided lives in lib/, where the tests can reach it.
import fs from "node:fs";
import path from "node:path";
import { findMissionControl, appHome } from "../lib/paths.mjs";
import { now, localParts, addDays } from "../lib/clock.mjs";
import { loadSettings, setSetting, DEFAULTS } from "../lib/settings.mjs";
import { listAreas, findArea, isTalkDay, addArea, setAreaField, nextTalkDay, AREA_FIELDS } from "../lib/areas.mjs";
import { openTalk, readTalk, setTalkState, setFollowUp, addSaid, talkDates, talkFile } from "../lib/talks.mjs";
import { addHabit, listHabits, findHabit, track, setStatus, stats, askedOn, answerOn } from "../lib/habits.mjs";
import { readTable } from "../lib/auto.mjs";
import { brief, habitLine } from "../lib/brief.mjs";
import { gate, NO_WAKE } from "../lib/gate.mjs";
import { dueTick } from "../lib/tick.mjs";
import { contextBlock } from "../lib/context.mjs";
import { commitCoach, syncInBackground, pullQuietly } from "../lib/sync.mjs";

const FLAGS = new Set(["json", "yes", "no-hermes", "no-claude", "all"]);
function parseArgs(argv) {
  const pos = []; const f = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { pos.push(a); continue; }
    const k = a.slice(2);
    if (FLAGS.has(k)) { f[k] = true; continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) return { pos, f, error: `--${k} needs a value.` };
    f[k] = next; i++;
  }
  return { pos, f };
}

const [cmd = "help", ...rest] = process.argv.slice(2);
const { pos, f, error: argError } = parseArgs(rest);
// These three run inside other programs (before every turn, and on the schedule). A broken coach
// never breaks the assistant and never sends an error into his chat.
const QUIET = ["context", "tick", "gate"].includes(cmd);

function die(msg) {
  if (cmd === "gate") { process.stdout.write(NO_WAKE + "\n"); process.exit(0); }
  if (QUIET) process.exit(0);
  console.error(msg); process.exit(1);
}
if (argError) die(argError);

const mcDir = findMissionControl({ arg: f.godspeed });
if (!mcDir && !["help", "setup"].includes(cmd)) die("Could not find your mission control folder. Run this from inside it, or add --godspeed <folder>.");
const s = mcDir ? loadSettings(mcDir) : { ...DEFAULTS };
const rawSync = process.env.GODSPEED_COACH_GIT_SYNC;
const syncMode = ["auto", "commit", "off"].includes(rawSync) ? rawSync : s.git_sync;
const at = now();
const today = localParts(at, s.timezone).date;
const out = (human, json) => console.log(f.json ? JSON.stringify(json) : human);
const saved = (label) => syncInBackground(mcDir, `coach: ${label}`, syncMode);

function dateArg(v) {
  if (!v || v === "today") return today;
  if (v === "yesterday") return addDays(today, -1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v))) die(`Give the day as YYYY-MM-DD, today or yesterday, not "${v}".`);
  return v;
}
function needArea(name) {
  const a = findArea(mcDir, name);
  if (!a) die(`There is no coach area called "${name || ""}". Areas: ${listAreas(mcDir).map((x) => x.slug).join(", ") || "none yet"}.`);
  return a;
}
function openTalkDate(a) {
  if (f.date) return dateArg(f.date);
  const open = talkDates(a).reverse().find((d) => readTalk(a, d).state === "opened");
  if (!open) die(`No ${a.title} talk is open. Give the day with --date.`);
  return open;
}
function needHabit(words, opts) {
  const h = findHabit(mcDir, words, opts);
  const names = listHabits(mcDir, { status: "active" }).map((x) => x.title).join(", ") || "none";
  if (!h) die(`No habit matches "${words}". Active habits: ${names}.`);
  if (h.ambiguous) die(`Several habits match "${words}": ${h.ambiguous.join(" / ")}. Say which one.`);
  return h;
}
const ANSWER_WORDS = { yes: "done", y: "done", ja: "done", done: "done", did: "done", erledigt: "done", no: "no", n: "no", nein: "no", not: "no", skip: "skip", skipped: "skip" };
function answerWord(v) {
  const a = ANSWER_WORDS[String(v || "done").toLowerCase()];
  if (!a) die(`An answer is yes, no or skip, not "${v}".`);
  return a;
}

const commands = {
  areas() {
    const as = listAreas(mcDir);
    const next = (a) => { for (let i = 0; i < 400; i++) { const d = addDays(today, i); if (isTalkDay(a, d)) return d; } return null; };
    out(as.map((a) => `${a.slug}: ${a.title}, ${a.rhythmText} ${a.time}, ${a.style}, ${a.tone}, ${a.on ? `next talk ${next(a) || "none"}` : "paused"}`).join("\n") || "No areas yet.", as.map((a) => ({ slug: a.slug, title: a.title, next: next(a) })));
  },
  show() { const a = needArea(pos[0]); console.log(fs.readFileSync(a.file, "utf8")); },
  area() {
    const [sub, name, key, ...v] = pos;
    if (sub === "add") {
      // A new area starts tomorrow unless a date is given, so creating "Sundays at seven" on a
      // Sunday evening never opens a talk fifteen minutes later by surprise.
      try {
        const a = addArea(mcDir, { slug: name, title: f.title, rhythm: f.rhythm, time: f.time || "19:00", starts: f.starts ? dateArg(f.starts) : addDays(today, 1), style: f.style || "compass", tone: f.tone || "gentle", serves: f.serves || "" });
        saved(`area ${a.slug} added`);
        const first = nextTalkDay(a, a.starts);
        return out(`Added: ${a.title} (${a.slug}), ${a.rhythmText} at ${a.time}, ${a.style}, ${a.tone}. First talk: ${first || "none"}.`, { ok: true, area: a.slug, first });
      } catch (e) { die(e.message); }
    }
    if (sub === "set") {
      const a = needArea(name);
      if (!key || !v.length) die(`godspeed-coach area set <area> <${AREA_FIELDS.join("|")}> <value>`);
      try {
        const b = setAreaField(a, key, v.join(" "));
        saved(`area ${b.slug} ${key.toUpperCase()}`);
        const first = nextTalkDay(b, today > (b.starts || today) ? today : b.starts || today);
        return out(`Changed: ${b.title} ${key.toUpperCase()} = ${v.join(" ")}. ${b.on ? `Next talk: ${first || "none"}.` : "Paused: no talks until it is on again."}`, { ok: true, next: first });
      } catch (e) { die(e.message); }
    }
    die("godspeed-coach area add <name> --title ... --rhythm ... | area set <area> <SETTING> <value>");
  },
  brief() { const a = needArea(pos[0]); console.log(brief(mcDir, s, a, dateArg(f.date))); },
  gate() {
    pullQuietly(mcDir, syncMode);
    const g = gate(mcDir, s, at, path.join(appHome(), "state.json"));
    process.stdout.write(g.output + "\n");
  },
  talk() {
    const [sub, name] = pos;
    const a = needArea(name);
    if (sub === "open") {
      const d = dateArg(f.date);
      if (!f.opening) die('Give the opening: --opening "<what you are sending them>"');
      const r = openTalk(a, d, { opening: f.opening, read: f.read || "" }, at);
      if (r.created) saved(`${a.slug} talk opened ${d}`);
      return out(r.created ? `Opened: ${path.relative(mcDir, r.file).replace(/\\/g, "/")}` : `Already open: ${path.relative(mcDir, r.file).replace(/\\/g, "/")} (kept the first opening)`, { ok: true, created: r.created, file: r.file });
    }
    if (sub === "said") {
      if (!f.words) die('Give their words: --words "<what they said>"');
      const d = openTalkDate(a);
      addSaid(a, d, `- ${localParts(at, s.timezone).hm} ${String(f.words).replace(/\s+/g, " ").trim()}`);
      saved(`${a.slug} talk ${d}`);
      return out("Saved.", { ok: true, date: d });
    }
    if (sub === "held" || sub === "not-held") {
      const d = f.date ? dateArg(f.date) : (talkDates(a).at(-1) || die(`No ${a.title} talk exists yet.`));
      setTalkState(a, d, sub);
      saved(`${a.slug} talk ${d} ${sub}`);
      return out(`Recorded: the ${a.title} talk of ${d} is ${sub}.`, { ok: true, date: d, state: sub });
    }
    if (sub === "state") {
      const ds = talkDates(a);
      return out(ds.slice(-5).map((d) => `${d}: ${readTalk(a, d).state}`).join("\n") || "No talks yet.", ds.map((d) => ({ date: d, state: readTalk(a, d).state })));
    }
    die("godspeed-coach talk open|said|held|not-held|state <area>");
  },
  habit() {
    const [sub, ...args] = pos;
    if (sub === "add") {
      const [area, slug] = args;
      if (!f.title && !slug) die('godspeed-coach habit add <area> <slug> --title "..." --done-means "..." --days daily');
      try {
        const h = addHabit(mcDir, { area, slug, title: f.title || slug, doneMeans: f["done-means"] || "", days: f.days || "daily", agreed: f.agreed || "", auto: f.auto || "" }, today, s.max_habits);
        saved(`habit ${h.slug} started`);
        return out(`Started: ${h.title} (${h.slug}), ${h.daysText}, from ${h.started}.`, { ok: true, habit: h.slug });
      } catch (e) { die(e.message); }
    }
    if (sub === "track") {
      const words = args.join(" ").trim() || f.words;
      if (!words) die('Say which habit: godspeed-coach habit track "head lifts"');
      const h = needHabit(words);
      const d = dateArg(f.date);
      const ans = answerWord(f.answer);
      track(h, d, ans, f.source || "cli", f.words || words);
      saved(`habit ${h.slug} ${d} ${ans}`);
      return out(`Tracked: ${h.title}, ${d}, ${ans}.`, { ok: true, habit: h.slug, date: d, answer: ans });
    }
    if (sub === "answer") {
      // "yes no" to tonight's check, in the order it asked.
      const d = dateArg(f.date);
      const asked = listHabits(mcDir, { status: "active" }).filter((h) => askedOn(h, d) && !answerOn(h, d));
      if (!asked.length) die("No habit check is waiting for an answer today.");
      const words = args.join(" ").split(/[\s,]+/).filter(Boolean);
      if (words.length !== asked.length && words.length !== 1) die(`The check asked about ${asked.length}: ${asked.map((h) => h.title).join(", ")}. Give one answer each, or one for all.`);
      const done = asked.map((h, i) => { const ans = answerWord(words[words.length === 1 ? 0 : i]); track(h, d, ans, f.source || "cli", f.words || words.join(" ")); return `${h.title} ${ans}`; });
      saved(`habits ${d}`);
      return out(`Tracked: ${done.join(", ")}.`, { ok: true, date: d, tracked: done });
    }
    if (sub === "list") {
      const hs = listHabits(mcDir).filter((h) => f.all || h.status === "active");
      return out(hs.map((h) => `${h.slug}: ${h.title} (${h.area}, ${h.daysText}, ${h.status}${h.auto ? `, from data: ${h.auto}` : ""})`).join("\n") || "No habits.", hs.map(({ log, ...h }) => h));
    }
    if (sub === "status") {
      const [ref, st] = args;
      const h = needHabit(ref, { includeInactive: true });
      try { setStatus(h, st); } catch (e) { die(e.message); }
      saved(`habit ${h.slug} ${st}`);
      return out(`${h.title} is now ${st}.`, { ok: true });
    }
    die("godspeed-coach habit add|track|answer|list|status");
  },
  habits() {
    if (pos[0] !== "week") die("godspeed-coach habits week [<area>]");
    const hs = listHabits(mcDir, { status: "active" }).filter((h) => !pos[1] || h.area === pos[1]);
    out(hs.map((h) => habitLine(h, today)).join("\n") || "No active habits.", hs.map((h) => ({ habit: h.slug, ...stats(h, today, 7) })));
  },
  context() {
    const c = contextBlock(mcDir, s, at);
    if (c) process.stdout.write(c + "\n");
  },
  tick() {
    pullQuietly(mcDir, syncMode);
    const table = s.daily_table ? readTable(path.isAbsolute(s.daily_table) ? s.daily_table : path.join(mcDir, s.daily_table)) : {};
    const { messages, writes } = dueTick(mcDir, s, at, table);
    for (const w of writes) {
      if (w.kind === "asked") track(w.habit, w.ymd, "asked", "tick", "");
      else if (w.kind === "auto") track(w.habit, w.ymd, "done", "data", w.words);
      else if (w.kind === "follow-up") setFollowUp(w.area, w.ymd, w.at);
      else if (w.kind === "not-held") setTalkState(w.area, w.ymd, "not-held");
    }
    commitCoach(mcDir, writes.length ? `coach: ${[...new Set(writes.map((w) => w.kind))].join(", ")}` : "coach: pending changes", syncMode);
    if (messages.length) process.stdout.write(messages.join("\n\n") + "\n");
  },
  config() {
    const [sub = "show", key, ...v] = pos;
    if (sub === "show") return console.log(JSON.stringify(s, null, 2));
    if (sub === "get") { if (!(key in s)) die(`There is no setting called "${key}".`); return console.log(String(s[key])); }
    if (sub === "set") {
      if (!key || !v.length) die("godspeed-coach config set <key> <value>");
      try { setSetting(mcDir, key, v.join(" ")); } catch (e) { die(e.message); }
      saved(`setting ${key}`);
      return console.log(`Changed: ${key} = ${v.join(" ")}`);
    }
    die("godspeed-coach config [show | get <key> | set <key> <value>]");
  },
  async setup() { const { setup } = await import("../lib/setup.mjs"); process.exitCode = await setup(f); },
  async check() { const { check } = await import("../lib/setup.mjs"); process.exitCode = await check(mcDir, f); },
  _sync() { commitCoach(mcDir, pos.join(" ") || "coach: changes", syncMode); },
  help() {
    console.log(fs.readFileSync(new URL("../README.md", import.meta.url), "utf8").split("## Use")[1]?.split("\n## ")[0] || "See README.md");
  },
};

try {
  if (!commands[cmd]) die(`Unknown command "${cmd}". Try: godspeed-coach help`);
  await commands[cmd]();
} catch (e) {
  die(`godspeed-coach: ${e.message}`);
}
