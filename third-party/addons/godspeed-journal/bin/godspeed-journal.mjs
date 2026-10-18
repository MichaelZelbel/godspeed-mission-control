#!/usr/bin/env node
// godspeed-journal: interstitial journaling for Godspeed Mission Control. Say what you start and what done means; say
// when you finish; the recipe compares the two. This file only parses arguments and prints.
// What gets decided lives in lib/, where the tests can reach it.
import fs from "node:fs";
import { findMissionControl } from "../lib/paths.mjs";
import { now, localParts, sinceLabel } from "../lib/clock.mjs";
import { loadSettings, setSetting, DEFAULTS } from "../lib/settings.mjs";
import { writeEntry, readEntries, taskId } from "../lib/store.mjs";
import { tasksFrom, openTasks, resolveTask, resolveClosed, resolveLooseEnd, matchItem } from "../lib/tasks.mjs";
import { dueMessages } from "../lib/tick.mjs";
import { contextBlock } from "../lib/context.mjs";
import { checkRecord, recordNeeds } from "../lib/evidence.mjs";
import { dayReport, weekReport, renderWeek, wordsReport, renderWords } from "../lib/report.mjs";
import { commitJournal, syncInBackground, pullQuietly } from "../lib/sync.mjs";

const REPEATABLE = new Set(["done-means", "met", "missed"]);
function parseArgs(argv) {
  const pos = []; const f = { "done-means": [], met: [], missed: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { pos.push(a); continue; }
    const k = a.slice(2);
    const takes = !["json", "yes", "no-hermes", "no-claude", "needs"].includes(k);
    let v = true;
    if (takes) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) return { pos, f, error: `--${k} needs a value.` };
      v = next; i++;
    }
    if (REPEATABLE.has(k)) f[k].push(v); else f[k] = v;
  }
  return { pos, f };
}

const [cmd = "help", ...rest] = process.argv.slice(2);
const { pos, f, error: argError } = parseArgs(rest);
const QUIET = cmd === "context" || cmd === "tick";

function die(msg) { if (QUIET) process.exit(0); console.error(msg); process.exit(1); }

if (argError) die(argError);

const mcDir = findMissionControl({ arg: f.godspeed });
if (!mcDir && cmd !== "help" && cmd !== "setup") die("Could not find your mission control folder. Run this from inside it, or add --godspeed <folder>.");
const s = mcDir ? loadSettings(mcDir) : { ...DEFAULTS };
// A machine can override how entries sync without changing the shared settings file, for a
// computer whose pushes are slow (set GODSPEED_JOURNAL_GIT_SYNC=commit in ~/.godspeed/device.env).
// A value that is not one of the three known ones is ignored rather than trusted, since git
// mode controls whether other machines ever see an entry at all.
const rawSync = process.env.GODSPEED_JOURNAL_GIT_SYNC;
const SYNC_MODES = ["auto", "commit", "off"];
let syncMode = s.git_sync;
if (rawSync) {
  if (SYNC_MODES.includes(rawSync)) syncMode = rawSync;
  else if (!QUIET) console.error(`GODSPEED_JOURNAL_GIT_SYNC is "${rawSync}", expected auto, commit or off; using settings.`);
}
const at = now();
const entries = () => readEntries(mcDir, s, { days: 8, until: at });
const out = (human, json) => console.log(f.json ? JSON.stringify(json) : human);

function save(entry, label) {
  const { file, entry: e } = writeEntry(mcDir, s, { source: f.source || "cli", ...entry }, at);
  syncInBackground(mcDir, `journal: ${label}`, syncMode);
  return { file, e };
}

function needTask(ref, opts) {
  const t = resolveTask(entries(), ref, opts);
  if (!t) die(ref ? `No task matches "${ref}". Open tasks: ${openTasks(entries()).map((x) => x.title).join(", ") || "none"}.` : "No open task. Start one first.");
  if (t.ambiguous) die(`Several open tasks match "${ref}": ${t.ambiguous.join(" / ")}. Say which one.`);
  return t;
}

const commands = {
  start() {
    const title = pos.join(" ").trim();
    if (!title) die('Say what you are starting: godspeed-journal start "Edit the video"');
    const id = taskId(at, s.timezone, title);
    save({ kind: "start", task: id, title, done_means: f["done-means"], words: f.words || title }, `start ${title}`);
    const task = tasksFrom(entries()).find((t) => t.id === id);
    out(`Saved: start "${title}" (${id})`, { ok: true, task });
  },
  define() {
    const t = needTask(pos.join(" "));
    if (!f["done-means"].length) die('Add what done means: --done-means "thumbnail made"');
    save({ kind: "define", task: t.id, done_means: f["done-means"], words: f.words || "" }, `define ${t.title}`);
    out(`Saved: done for "${t.title}" now means ${[...t.done_means, ...f["done-means"]].join("; ")}`, { ok: true, task: resolveTask(entries(), t.id) });
  },
  note() {
    const words = pos.join(" ").trim();
    if (!words) die("A note needs words.");
    const t = f.task ? needTask(f.task) : null;
    save({ kind: "note", task: t?.id, words }, "note");
    out("Saved.", { ok: true, task: t?.id || null });
  },
  done() {
    const t = needTask(pos.join(" "));
    save({ kind: "done", task: t.id, met: f.met, missed: f.missed, words: f.words || "" }, `done ${t.title}`);
    out(`Saved: done "${t.title}"`, { ok: true, task: resolveTask(entries(), t.id, { includeClosed: true }) });
  },
  drop() {
    const t = needTask(pos.join(" "));
    save({ kind: "drop", task: t.id, words: f.words || "" }, `drop ${t.title}`);
    out(`Saved: dropped "${t.title}"`, { ok: true, task: t.id });
  },
  // Undoes a close, most often one the record made that the person says is wrong. The proof it
  // used is remembered for this task, so the next look at the record does not close it again.
  reopen() {
    const ref = pos.join(" ").trim();
    const t = resolveClosed(entries(), ref);
    if (!t) die(ref ? `No closed task matches "${ref}".` : "No task was closed from the record. Say which one: godspeed-journal reopen <task>");
    if (t.ambiguous) die(`Several closed tasks match "${ref}": ${t.ambiguous.join(" / ")}. Say which one.`);
    save({ kind: "reopen", task: t.id, words: f.words || "" }, `reopen ${t.title}`);
    out(`Reopened "${t.title}"${t.evidence ? `; ${t.evidence.url || "that proof"} will not close it again` : ""}.`, { ok: true, task: resolveTask(entries(), t.id) });
  },
  // Something a finish left out happened after all ("the letter's signed now", or "done" to an
  // item in the evening list). It stops being a loose end; the finish keeps its time.
  met() {
    if (!f.met.length) die('Say which item happened: godspeed-journal met <task> --met "letter scanned"');
    const ref = pos.join(" ").trim();
    const t = resolveLooseEnd(entries(), ref);
    if (!t) die(ref ? `No finished task matching "${ref}" has anything left out.` : "No finished task has anything left out.");
    if (t.ambiguous) die(`Several finished tasks match "${ref}": ${t.ambiguous.join(" / ")}. Say which one.`);
    const items = f.met.map((said) => ({ said, item: matchItem(t.missed, said) }));
    const unknown = items.find((x) => !x.item);
    if (unknown) die(`"${unknown.said}" is not one of the things "${t.title}" finished without: ${t.missed.join("; ")}.`);
    const met = [...new Set(items.map((x) => x.item))];
    save({ kind: "met", task: t.id, met, words: f.words || "" }, `met ${t.title}`);
    out(`Saved: ${met.join("; ")} happened after all ("${t.title}").`, { ok: true, task: tasksFrom(entries()).find((x) => x.id === t.id) });
  },
  mark() {
    const [ref, flag] = pos;
    if (!ref || !flag) die("godspeed-journal mark <task> <flag>");
    const t = needTask(ref, { includeClosed: true });
    save({ kind: "mark", task: t.id, words: flag }, `mark ${flag}`);
    out("Saved.", { ok: true });
  },
  open() {
    const list = openTasks(entries());
    out(list.map((t) => `${t.title} (since ${sinceLabel(t.started, at, s.timezone)})`).join("\n") || "Nothing open.", list);
  },
  // Only what is already known, fast: this runs on every message the person sends. Reading the
  // record and closing what it shows finished is the tick's job, every 15 minutes.
  context() {
    const c = contextBlock(entries(), s, at);
    if (c) process.stdout.write(c + "\n");
  },
  tick() {
    pullQuietly(mcDir, syncMode);
    let es = entries();
    const { verdicts, closes } = checkRecord(mcDir, s, es, at);
    for (const c of closes) writeEntry(mcDir, s, c, at);
    if (closes.length) es = entries();
    const { messages, records } = dueMessages(es, s, at, verdicts);
    for (const r of records) writeEntry(mcDir, s, { source: "tick", ...r }, at);
    const kinds = [...(closes.length ? ["closed from the record"] : []), ...records.map((r) => r.kind)];
    commitJournal(mcDir, kinds.length ? `journal: ${kinds.join(", ")}` : "journal: pending entries", syncMode);
    if (messages.length) process.stdout.write(messages.join("\n\n") + "\n");
  },
  // Closes what the record shows finished, now, without waiting for the next check-in: run by
  // whatever just produced proof (a posting job). --needs only prints what the record has to
  // cover, for a job that keeps a copy of it for a machine that cannot read it live.
  evidence() {
    if (f.needs) {
      const n = recordNeeds(entries(), at);
      if (n) console.log(JSON.stringify(n));
      return;
    }
    pullQuietly(mcDir, syncMode);
    const es = entries();
    const { closes } = checkRecord(mcDir, s, es, at);
    for (const c of closes) writeEntry(mcDir, s, c, at);
    if (closes.length) commitJournal(mcDir, "journal: closed from the record", syncMode);
    const titleOf = (id) => tasksFrom(es).find((t) => t.id === id)?.title || id;
    const closed = closes.map((c) => ({ task: c.task, title: titleOf(c.task), evidence: c.evidence, words: c.words }));
    if (f.json) console.log(JSON.stringify({ closed }));
    else for (const c of closed) console.log(`Closed from the record: "${c.title}". ${c.words}`);
  },
  day() {
    const arg = pos[0];
    if (arg !== undefined && (!/^\d{4}-\d{2}-\d{2}$/.test(arg) || isNaN(Date.parse(arg)))) die("Give the day as YYYY-MM-DD, for example 2026-09-22.");
    const date = arg || localParts(at, s.timezone).date;
    // A named day can be long past "now", so it is read on its own window (the day itself, the
    // day before, and the two days before that) instead of the fixed 8-day window entries()
    // keeps for "today", which would miss anything outside it.
    const es = arg ? readEntries(mcDir, s, { days: 4, until: new Date(Date.parse(date + "T00:00:00Z") + 2 * 86400000) }) : entries();
    const r = dayReport(es, s, date, at);
    const time = (t) => t.minutes == null ? "" : t.at_least && !t.minutes ? ", time unknown (open through a long silence)" : `, ${t.at_least ? "at least " : ""}${t.minutes} min`;
    out(r.tasks.map((t) => `${t.title}: ${t.state}${time(t)}${t.missed.length ? `, missed: ${t.missed.join("; ")}` : ""}`).join("\n") || "Nothing that day.", r);
  },
  week() {
    const r = weekReport(entries(), s, at);
    out(renderWeek(r, s), r);
  },
  // What they said, in their own words, day by day: what a weekly talk reads besides the hours.
  words() {
    const days = f.days === undefined ? 7 : Number(f.days);
    if (!Number.isInteger(days) || days < 1 || days > 31) die("--days is a whole number from 1 to 31.");
    const list = wordsReport(readEntries(mcDir, s, { days: days + 1, until: at }), s, at, days);
    out(renderWords(list, s), list);
  },
  config() {
    const [sub = "show", key, ...v] = pos;
    if (sub === "show") return console.log(JSON.stringify(s, null, 2));
    if (sub === "get") {
      if (!key) die("godspeed-journal config get <key>");
      const val = key.split(".").reduce((o, k) => o?.[k], s); if (val === undefined) die(`There is no setting called "${key}".`); return console.log(typeof val === "object" ? JSON.stringify(val) : String(val));
    }
    if (sub === "set") {
      if (!key || !v.length) die("godspeed-journal config set <key> <value>");
      try { setSetting(mcDir, key, v.join(" ")); } catch (e) { die(e.message); }
      syncInBackground(mcDir, `journal: setting ${key}`, syncMode);
      return console.log(`Changed: ${key} = ${v.join(" ")}`);
    }
    die("godspeed-journal config [show | get <key> | set <key> <value>]");
  },
  async setup() { const { setup } = await import("../lib/setup.mjs"); process.exitCode = await setup(f); },
  async check() { const { check } = await import("../lib/setup.mjs"); process.exitCode = await check(mcDir, f); },
  _sync() { commitJournal(mcDir, pos.join(" ") || "journal: entries", syncMode); },
  help() {
    console.log(fs.readFileSync(new URL("../README.md", import.meta.url), "utf8").split("## Use")[1]?.split("\n## ")[0] || "See README.md");
  },
};

try {
  if (!commands[cmd]) die(`Unknown command "${cmd}". Try: godspeed-journal help`);
  await commands[cmd]();
} catch (e) {
  die(`godspeed-journal: ${e.message}`);
}
