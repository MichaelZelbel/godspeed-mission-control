#!/usr/bin/env node
// godspeed-journal: interstitial journaling for Godspeed Mission Control. Say what you start and what done means; say
// when you finish; the recipe compares the two. This file only parses arguments and prints.
// What gets decided lives in lib/, where the tests can reach it.
import fs from "node:fs";
import { findMissionControl } from "../lib/paths.mjs";
import { now, localParts, sinceLabel, parseWhen, whenSaid, spanSaid } from "../lib/clock.mjs";
import { loadSettings, setSetting, DEFAULTS } from "../lib/settings.mjs";
import { writeEntry, readEntries, taskId } from "../lib/store.mjs";
import { tasksFrom, openTasks, resolveTask, resolveClosed, resolveLooseEnd, resolveDone, matchItem, impactLevel } from "../lib/tasks.mjs";
import { dueMessages } from "../lib/tick.mjs";
import { T } from "../lib/text.mjs";
import { contextBlock } from "../lib/context.mjs";
import { checkRecord, recordNeeds } from "../lib/evidence.mjs";
import { dayReport, weekReport, renderWeek, wordsReport, renderWords } from "../lib/report.mjs";
import { commitJournal, syncInBackground, syncQueued, pullQuietly } from "../lib/sync.mjs";
import { decodeArgv, readWordsFile, restoreShellEnv, startedFromGitBash, gitBashPath, LAUNCHER_ENV, CMDLINE_ENV } from "../lib/argv.mjs";

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

// The launchers say how they handed the arguments over (lib/argv.mjs). The marker is read once
// and taken out of the environment, so a program this one starts (the background sync) never
// mistakes itself for something the .cmd launcher started.
const launched = decodeArgv(process.argv.slice(2), process.env);
const fromGitBash = startedFromGitBash(process.env);
delete process.env[LAUNCHER_ENV]; delete process.env[CMDLINE_ENV];
restoreShellEnv(process.env);
const [cmd = "help", ...rest] = launched.argv;
const { pos, f, error: argError } = parseArgs(rest);
const QUIET = cmd === "context" || cmd === "tick";

function die(msg) { if (QUIET) process.exit(0); console.error(msg); process.exit(1); }
// The time words need the person to say more. Nothing is saved, and the exit status (2, not 1)
// tells whoever runs the command that this is a question to relay, not an error.
function ask(question) {
  if (f.json) console.log(JSON.stringify({ ok: false, ask: question }));
  else console.error(`Nothing was saved. Ask them: ${question}`);
  process.exit(2);
}

if (launched.error) die(launched.error);
if (argError) die(argError);
// The flags whose values are paths. From Git Bash they can arrive the Git Bash way (/c/...,
// /tmp/...), which the launcher no longer rewrites, so they are turned into Windows paths here.
const PATH_FLAGS = ["godspeed", "words-file", "extra-skills-dir"];
if (fromGitBash) for (const k of PATH_FLAGS) if (typeof f[k] === "string") f[k] = gitBashPath(f[k]);
// Words that hold a line break or a quote travel safest in a file: no shell reads a file's
// contents, so nothing on the way can cut or change them.
if (f["words-file"] !== undefined) {
  if (f.words !== undefined) die("Give the words once: either --words or --words-file, not both.");
  try { f.words = readWordsFile(f["words-file"]); } catch (e) { die(e.message); }
}

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

// An entry told with a time of its own is filed at that time, and keeps when it was written.
function save(entry, label, happened = null) {
  const full = { source: f.source || "cli", ...entry, ...(happened ? { written: at.toISOString() } : {}) };
  const { file, entry: e } = writeEntry(mcDir, s, full, happened || at);
  syncInBackground(mcDir, `journal: ${label}`, syncMode);
  return { file, e };
}

const said = (date) => whenSaid(new Date(date).toISOString(), at, s.timezone, s.language);

// --when: the person's own words for when it happened, or null when they gave none. `after` is
// the earliest time the move can have (a finish not before its start), so a question never offers
// a time the answer would only bring back as a second question.
function when(after = null) {
  if (f.when === undefined) return null;
  const r = parseWhen(String(f.when), at, s.timezone, { after });
  const t = T(s);
  if (r.ask === "unknown") ask(t.askWhen());
  if (r.ask === "which" && r.spans) ask(t.askWhich(...r.spans.map(([a, b]) => spanSaid(a, b, at, s.timezone, s.language))));
  if (r.ask === "which") ask(t.askWhich(said(r.options[0]), said(r.options[1])));
  if (r.ask === "future") ask(t.askFuture(said(r.at)));
  if (r.ask === "order") ask(t.askOrder());
  return r;
}

function oneTime(after = null) {
  const r = when(after);
  if (r?.start) die('This takes one time, for example --when "an hour ago". A span such as "from 9 to 10:30" goes on start.');
  return r?.at || null;
}

const recorded = (time) => time ? { recorded: { at: time.toISOString(), said: said(time) } } : {};
const saidAt = (time) => time ? `, ${said(time)}` : "";

function needTask(ref, opts) {
  const t = resolveTask(entries(), ref, opts);
  if (!t) die(ref ? `No task matches "${ref}". Open tasks: ${openTasks(entries()).map((x) => x.title).join(", ") || "none"}.` : "No open task. Start one first.");
  if (t.ambiguous) die(`Several open tasks match "${ref}": ${t.ambiguous.join(" / ")}. Say which one.`);
  return t;
}

// A finish read before its start, or before the reopen that made the task open again, would be
// dropped or undone, so such a time asks instead, in the words of the move: a drop is asked when
// it was dropped, not when it was finished.
function finishTime(t, dropped = false) {
  const time = oneTime(new Date(Math.max(Date.parse(t.started), t.reopened ? Date.parse(t.reopened) : 0)));
  if (time && time < new Date(t.started)) ask(T(s).askBeforeStart(t.title, said(t.started), dropped));
  if (time && t.reopened && time < new Date(t.reopened)) ask(T(s).askBeforeReopen(t.title, said(t.reopened), dropped));
  return time;
}

const IMPACT_NAMES = { 1: "everyday", 2: "short-term", 3: "lasting", 4: "life-defining" };
function impactFlag(value) {
  const level = impactLevel(value);
  if (!level || !/^\d$/.test(String(value).trim())) die("Impact is 1 (everyday), 2 (short-term), 3 (lasting) or 4 (life-defining).");
  return level;
}

const commands = {
  start() {
    const title = pos.join(" ").trim();
    if (!title) die('Say what you are starting: godspeed-journal start "Edit the video"');
    const impact = f.impact === undefined ? undefined : impactFlag(f.impact);
    const r = when();
    if (impact && !r?.end) die('--impact goes with a finish: on done, or on a start told with a span such as "from 9 to 10".');
    const started = r?.start || r?.at || null;
    const id = taskId(started || at, s.timezone, title);
    save({ kind: "start", task: id, title, done_means: f["done-means"], words: f.words || title }, `start ${title}`, started);
    // A whole task told after the fact ("wrote the report from 9 to 10:30") is a start and a finish.
    if (r?.end) {
      save({ kind: "done", task: id, met: f.met, missed: f.missed, impact, words: f.words || title }, `done ${title}`, r.end);
      const task = tasksFrom(entries()).find((t) => t.id === id);
      return out(`Saved: "${title}" from ${said(r.start)} to ${said(r.end)} (${id})`,
        { ok: true, task, recorded: { start: r.start.toISOString(), end: r.end.toISOString(), said: `${said(r.start)} - ${said(r.end)}` } });
    }
    const task = tasksFrom(entries()).find((t) => t.id === id);
    out(`Saved: start "${title}" (${id})${saidAt(started)}`, { ok: true, task, ...recorded(started) });
  },
  define() {
    const t = needTask(pos.join(" "));
    if (!f["done-means"].length) die('Add what done means: --done-means "thumbnail made"');
    save({ kind: "define", task: t.id, done_means: f["done-means"], words: f.words || "" }, `define ${t.title}`);
    out(`Saved: done for "${t.title}" now means ${[...t.done_means, ...f["done-means"]].join("; ")}`, { ok: true, task: resolveTask(entries(), t.id) });
  },
  note() {
    const text = pos.join(" ").trim();
    if (text && f.words !== undefined) die("Give a note's words once: as text, or with --words or --words-file, not both.");
    const words = text || String(f.words || "").trim();
    if (!words) die("A note needs words.");
    const t = f.task ? needTask(f.task) : null;
    const time = oneTime();
    save({ kind: "note", task: t?.id, words }, "note", time);
    out(`Saved${saidAt(time)}.`, { ok: true, task: t?.id || null, ...recorded(time) });
  },
  done() {
    const impact = f.impact === undefined ? undefined : impactFlag(f.impact);
    const t = needTask(pos.join(" "));
    const time = finishTime(t);
    save({ kind: "done", task: t.id, met: f.met, missed: f.missed, impact, words: f.words || "" }, `done ${t.title}`, time);
    out(`Saved: done "${t.title}"${saidAt(time)}`, { ok: true, task: resolveTask(entries(), t.id, { includeClosed: true }), ...recorded(time) });
  },
  drop() {
    const t = needTask(pos.join(" "));
    const time = finishTime(t, true);
    save({ kind: "drop", task: t.id, words: f.words || "" }, `drop ${t.title}`, time);
    out(`Saved: dropped "${t.title}"${saidAt(time)}`, { ok: true, task: t.id, ...recorded(time) });
  },
  // How much a finished task mattered, when the person answers the one question after the finish.
  // The notebook's moment for that close takes the new level.
  impact() {
    const level = impactFlag(pos.at(-1));
    const ref = pos.slice(0, -1).join(" ").trim();
    const t = resolveDone(entries(), ref);
    if (!t) die(ref ? `No finished task matches "${ref}".` : "No finished task yet.");
    if (t.ambiguous) die(`Several finished tasks match "${ref}": ${t.ambiguous.join(" / ")}. Say which one.`);
    save({ kind: "impact", task: t.id, impact: level, words: f.words || "" }, `impact ${t.title}`);
    out(`Saved: "${t.title}" is ${IMPACT_NAMES[level]}.`, { ok: true, task: tasksFrom(entries()).find((x) => x.id === t.id) });
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
    const time = oneTime(new Date(t.ended));
    if (time && time < new Date(t.ended)) ask(T(s).askBeforeFinish(t.title, said(t.ended)));
    save({ kind: "met", task: t.id, met, words: f.words || "" }, `met ${t.title}`, time);
    out(`Saved: ${met.join("; ")} happened after all ("${t.title}")${saidAt(time)}.`, { ok: true, task: tasksFrom(entries()).find((x) => x.id === t.id), ...recorded(time) });
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
    if (s.capture_enabled === false) return;
    pullQuietly(mcDir, syncMode);
    if (loadSettings(mcDir).capture_enabled === false) return;
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
    if (s.capture_enabled === false) return;
    if (f.needs) {
      const n = recordNeeds(entries(), at);
      if (n) console.log(JSON.stringify(n));
      return;
    }
    pullQuietly(mcDir, syncMode);
    if (loadSettings(mcDir).capture_enabled === false) return;
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
  _sync() { syncQueued(mcDir); },
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
