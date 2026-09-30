#!/usr/bin/env node
/*
 * due.js - the things in your life that have a last day, and how loud to be about them.
 *
 * WHY THIS EXISTS. A calendar reminder fires on a date and knows nothing else. It cannot tell
 * whether you already did the thing, so it nags you afterwards, and that is how a person learns to
 * ignore reminders. Then it stops on its last occurrence whether or not the job got done. Both
 * halves of that are why the reminder that mattered went past you.
 *
 * THE ONE IDEA: A WINDOW, NOT A DUE DATE. Every obligation stores the first day you can do it and
 * the last day you still can. How loud this gets follows how much of that window is left, as a
 * fraction, which is why ONE rule fits a job you have a week for and a tax return you have a year
 * for, with nothing to tune per item.
 *
 *   red     the last three to fourteen days: a tenth of the window, never fewer than three
 *           days and never more than fourteen, and always the last day
 *   orange  the last quarter
 *   yellow  the second half
 *   green   the first half
 *
 * THE PART THAT MAKES IT NOT A TO-DO LIST. Every obligation says how your mission control could tell it was
 * done WITHOUT asking you. The ones that can, close themselves the moment you act. The ones that
 * cannot say so and wait for your word, which is most of them, and that is fine. Asking the
 * question is what matters.
 *
 * THREE DATES, AND AT LEAST ONE OF THE LAST TWO. Every thing in here can carry the day you can
 * start (optional, today if you leave it out), the day you would like it done (a TARGET: soft,
 * missing it costs nothing) and the day it starts costing you (a DEADLINE: hard, the window
 * above). Many people only ever need the target.
 *
 *   deadline only        the window and its four steps, exactly as described above
 *   target only          quiet until the day, one mention on it, then ONE question the morning
 *                        after ("A new date, or as soon as you can?"), then a gentle line about
 *                        once a week in the brief, never louder
 *   target and deadline  the deadline's steps, plus one mention on the target day, and after it
 *                        the line says so and names the deadline; no question, the deadline rules
 *   repeating            the target sits at the same place inside every window
 *
 * One behaviour for every target, not a setting per thing. A window line reads
 * `STRIP: <start> <deadline, or - for none> [target <day>] [moved <day>]`, and every line written
 * before targets existed, `STRIP: <from> <to>`, is a start and a deadline and is never rewritten.
 *
 * NO DATE, NOT ELIGIBLE. This refuses anything with neither a target nor a deadline, on purpose.
 * Let undated wishes in and within a month it is a to-do app you do not maintain.
 *
 *   mc-due                    everything, loudest first
 *   mc-due today              at most three, for your morning brief to read
 *   mc-due add <name> --title "..." [--from YYYY-MM-DD] --target YYYY-MM-DD and/or --to YYYY-MM-DD
 *          --done-when "..." [--cost "..."] [--repeats monthly|yearly|"every N days"]
 *          [--self-check none|file-newer] [--self-check-arg PATH] [--link URL]
 *   mc-due target <name> YYYY-MM-DD|asap    a new day you would like it done, or as soon as you can
 *   mc-due done <name> [--evidence "..."]   you did it: writes the event that closes it
 *   mc-due drop <name> --yes  call it off: an event too, and nothing is deleted
 *   mc-due check              run the self checks, close what is provably done
 *   mc-due state [--json]     open or not, for every one, and what closed it
 *   mc-due --godspeed PATH         work on a mission control somewhere else
 *
 * DONE IS SOMETHING THAT HAPPENED, SO IT LIVES WITH THE THINGS THAT HAPPENED. A file in due/ is the
 * plan: what, the window, what finished means. Whether a window is finished is never written in it.
 * It is an event in world/events/ carrying `closes: [due/<name>]` (or `due/<name>#<first day>` for one
 * window of a repeating job) and an `evidence:` line saying what shows it, and every reader works
 * "open" out from those events. Why: in the mission control this kit comes from, a post was
 * approved and published in a working session and the memory recorded it that day, while the
 * deadline file kept its own "open" word, so the morning brief told its owner for five mornings
 * that the finished work was waiting. Two copies of one fact drift; one copy cannot. An older file
 * that still says `done <date>` on a STRIP line keeps working, and the first run turns that word
 * into an event (its own log line is the evidence) before removing it.
 *
 * It reads secrets/expires.txt too, if you have one, so the dates your keys die are obligations
 * like everything else and you never write a date in two places.
 *
 * Exit code 0 normally, 1 when something in your folder could not be read.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

// ---------------------------------------------------------------- where is the mission control
function readDeviceEnv(name) {
  const f = path.join(os.homedir(), ".godspeed", "device.env");
  try {
    for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = line.match(new RegExp("^\\s*" + name + "=(.*)$"));
      if (m) return m[1].trim();
    }
  } catch (e) { /* no device.env is normal on a mission control somebody made by hand */ }
  return "";
}

// --godspeed and its value are pulled OUT of the list before anything else looks at it. Left in, the
// very first thing a person types (mc-due --godspeed /somewhere check) reads "--godspeed" as the command
// and quietly runs the list instead, which looks like it worked.
const raw = process.argv.slice(2);
const args = [];
let godspeed = "";
for (let i = 0; i < raw.length; i++) {
  if (raw[i] === "--godspeed") { godspeed = raw[i + 1] || ""; i += 1; continue; }
  if (raw[i] === "-h" || raw[i] === "--help") { help(); process.exit(0); }
  args.push(raw[i]);
}
if (!godspeed) godspeed = readDeviceEnv("GODSPEED_DIR");
if (!godspeed) godspeed = process.env.GODSPEED_DIR || "";
if (!godspeed) {
  // Walk up from here. Somebody sitting in their own folder should not have to say where it is.
  let d = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(d, "AGENTS.md")) || fs.existsSync(path.join(d, "profile"))) { godspeed = d; break; }
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
}
if (!godspeed || !fs.existsSync(godspeed)) {
  console.log("I could not find your mission control folder.");
  console.log("Run this from inside it, or say where it is:  mc-due --godspeed /path/to/your/godspeed");
  process.exit(1);
}
const DUE = path.join(godspeed, "due");
const EXPIRES = path.join(godspeed, "secrets", "expires.txt");
const EVENTS_DIR = path.join(godspeed, "world", "events");

// ---------------------------------------------------------------- dates
// Everything is YYYY-MM-DD and UTC. A date that means two different days on two of your computers
// is how a monthly job runs twice, or never.
function today() {
  const o = (process.env.GODSPEED_TODAY || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(o)) return o;
  return new Date().toISOString().slice(0, 10);
}
function parseDate(s) {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(String(s).trim())) return null;
  const d = new Date(String(s).trim() + "T00:00:00Z");
  return isNaN(d.getTime()) ? null : d;
}
const isDate = (s) => !!parseDate(s);
function addDays(iso, n) {
  const d = parseDate(iso); if (!d) return null;
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a, b) {
  const x = parseDate(a), y = parseDate(b);
  if (!x || !y) return null;
  return Math.round((y - x) / 86400000);
}
// Adding months clamps to the end of the month. Without that, a window ending on the 31st walks
// into the next month every other period and the whole schedule slides.
function addMonths(iso, n) {
  const d = parseDate(iso); if (!d) return null;
  const day = d.getUTCDate();
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, last));
  return t.toISOString().slice(0, 10);
}
function repeatOf(text) {
  const t = String(text || "").trim().toLowerCase();
  if (!t || t === "no" || t === "none" || t === "once") return null;
  if (t === "weekly") return { kind: "days", n: 7 };
  if (t === "fortnightly" || t === "biweekly") return { kind: "days", n: 14 };
  if (t === "monthly") return { kind: "months", n: 1 };
  if (t === "quarterly") return { kind: "months", n: 3 };
  if (t === "yearly" || t === "annually") return { kind: "months", n: 12 };
  const m = t.match(/^every\s+(\d{1,4})\s*days?$/);
  if (m) return { kind: "days", n: parseInt(m[1], 10) };
  return undefined;                       // never guessed; `check` says so out loud
}

// ---------------------------------------------------------------- THE BAND RULE
// The only place that decides how loud something is, and the only reason this scales. Integer
// arithmetic on purpose: a tenth is not exactly representable, and a boundary decided by floating
// point is a bug nobody can reproduce.
// The last three belong to a target and never to a deadline: before its day, on it, and after it.
// Past a target ranks below every deadline step, so "as soon as you can" only ever takes a place in
// your morning that no deadline wanted. The target day sits just under "soon", because it is one
// day and would otherwise lose its only morning to a fortnightly line.
const RANK = { red: 0, orange: 1, target: 2, yellow: 3, green: 4, asap: 5, aiming: 6, unopened: 7 };
// How many days must pass before the same thing may be mentioned again.
const GAP = { red: 1, orange: 7, yellow: 14, green: 30 };
// After the one question, a target that passed comes back about once a week, and never louder.
const ASAP_GAP = 7;
const WORDS = {
  red: "RUNNING OUT", orange: "SOON", yellow: "ON THE WAY", green: "PLENTY OF TIME",
  unopened: "NOT YET", aiming: "AIMING FOR", target: "TARGET TODAY", asap: "WHEN YOU CAN",
};

// HOW LONG THE LOUD PHASE IS, in days, and it is the only place that decides.
//
// A pure tenth was wrong at both ends, and both were found on real dates (2026-08-29). A tenth of
// a fortnight is 1.4 days, so a two week parking fine got exactly ONE loud morning, which is no
// warning at all. A tenth of a year is 36 days, so a car service shouted every morning for over a
// month, which is how you teach someone to swipe. So the loud phase is a number of DAYS a person
// can picture, and the tenth only chooses inside it: never fewer than 3, so there is always time
// to act, and never more than 14, so it cannot become wallpaper. Never longer than the window
// itself either. Two constants and a clamp, not a dial: nothing here is ever set per thing.
const LOUD_MIN_DAYS = 3;
const LOUD_MAX_DAYS = 14;
function loudDays(L) {
  if (!(L >= 1)) return 1;
  return Math.min(L, Math.max(LOUD_MIN_DAYS, Math.min(LOUD_MAX_DAYS, Math.floor((L - 1) / 10))));
}

// How many days a band lasts on a window of L days, from the same integer arithmetic bandOf uses.
// A short window can leave a middle band empty, and that is correct rather than a bug: a fortnight
// has no room for four steps, so it gets three.
function bandDays(L, band) {
  if (!(L >= 1)) return 1;
  const redMax = loudDays(L);
  const q = Math.floor(L / 4), h = Math.floor(L / 2);
  if (band === "red") return redMax;
  if (band === "orange") return Math.max(0, q - redMax);
  if (band === "yellow") return Math.max(0, h - q);
  if (band === "green") return Math.max(0, L - h);
  return 0;
}

// The gap actually applied today: the ceiling for the band, but never longer than the band itself.
// A ceiling in absolute days on a band measured in fractions is the same bug as "a tenth of a week
// is not a day": on a 21 day window the orange band is three days long and wanted seven days of
// silence first, so it never spoke once. Long windows are untouched; short ones now speak in every
// band they pass through.
function gapFor(strip, band) {
  const ceiling = GAP[band];
  if (!ceiling) return ceiling;
  const L = daysBetween(strip.from, strip.to) + 1;
  const span = bandDays(L, band);
  if (!(span >= 1)) return 1;
  return Math.max(1, Math.min(ceiling, span));
}

function bandOf(from, to, day) {
  if (!isDate(from) || !isDate(to) || !isDate(day)) return null;
  if (day < from) return "unopened";
  const L = daysBetween(from, to) + 1;    // days in the whole window
  const R = daysBetween(day, to) + 1;     // days left, including today
  if (L < 1) return null;
  if (R <= loudDays(L)) return "red";
  if (R * 4 <= L) return "orange";
  if (R * 2 <= L) return "yellow";
  return "green";
}

// A window's target is the day you moved it to, if you did; the planned one stays on the line so a
// repeating thing's later windows keep their place. A window ends on its deadline, or with none, on
// its target.
const aimOf = (s) => (s && (s.moved || s.target)) || "";
const endOf = (s) => (s && (s.to || aimOf(s))) || "";
// The step of one window. A deadline decides whenever there is one, target or not, so every window
// written before targets existed gets exactly the answer it always got.
function bandFor(s, day) {
  if (!s) return null;
  if (s.to) return bandOf(s.from, s.to, day);
  const t = aimOf(s);
  if (!isDate(s.from) || !isDate(t) || !isDate(day) || t < s.from) return null;
  if (day < s.from) return "unopened";
  if (day < t) return "aiming";
  if (day === t) return "target";
  return "asap";
}
// The first day anything was said after the target: that mention is the one question.
function firstSaidAfter(o, t) {
  let first = "";
  for (const x of o.said) if (x.date > t && (!first || x.date < first)) first = x.date;
  return first;
}

// ---------------------------------------------------------------- the files
function readText(p) { try { return fs.readFileSync(p, "utf8"); } catch (e) { return ""; } }
function writeText(p, s) {
  try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); return true; }
  catch (e) { console.log("   I could not write " + p + ": " + e.message); return false; }
}
const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const filePath = (slug) => path.join(DUE, slug + ".md");
function slugs() {
  if (!fs.existsSync(DUE)) return [];
  return fs.readdirSync(DUE)
    .filter((f) => f.endsWith(".md") && f !== "README.md" && !f.startsWith("."))
    .map((f) => f.slice(0, -3)).sort();
}
const CACHE = new Map();
function parseFile(slug) {
  if (CACHE.has(slug)) return CACHE.get(slug);
  const p = filePath(slug);
  const text = readText(p);
  if (!text) return null;
  const head = {}, strips = [], log = [], said = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    // `STRIP: <from> <to>`. An older line may still say `open` or `done <date>`: kept as `legacy`
    // and honoured until it has been turned into an event. The deadline may be `-` (a target only),
    // and `target <day>` or `moved <day>` may follow. A word nothing here knows is kept, never eaten.
    let m = line.match(/^STRIP:\s*(\S+)\s+(\S+)((?:\s+\S+)*)\s*$/);
    if (m) {
      const st = { from: m[1], to: m[2] === "-" ? "" : m[2], target: "", moved: "", extra: [],
                   state: "open", closed: "", legacy: "" };
      const w = m[3].trim() ? m[3].trim().split(/\s+/) : [];
      for (let k = 0; k < w.length; k++) {
        const word = w[k].toLowerCase();
        if (word === "open") continue;
        if (word === "done") { st.legacy = isDate(w[k + 1]) ? w[++k] : (st.to || st.from); continue; }
        if ((word === "target" || word === "moved") && isDate(w[k + 1])) { st[word] = w[++k]; continue; }
        st.extra.push(w[k]);
      }
      strips.push(st);
      continue;
    }
    m = line.match(/^-\s*(\d{4}-\d{2}-\d{2})\s+SAID\s+(\S+)\s*$/);
    if (m) { said.push({ date: m[1], channel: m[2] }); log.push(line); continue; }
    if (/^-\s/.test(line)) { log.push(line); continue; }
    m = line.match(/^([A-Z][A-Z0-9-]{1,30}):\s?(.*)$/);
    if (m && !(m[1] in head)) head[m[1]] = m[2].trim();
  }
  const o = { slug, path: p, text, head, strips, log, said };
  applyEvents(o);
  CACHE.set(slug, o);
  return o;
}

// ---------------------------------------------------------------- the events: the only "is it done"
let EVENTS = null;
const UNPROVEN = [];
function frontmatter(text) {
  const m = String(text).replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const meta = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!kv) continue;
    const v = kv[2].trim();
    meta[kv[1]] = v.startsWith("[") && v.endsWith("]")
      ? v.slice(1, -1).split(",").map((x) => x.trim().replace(/^["']|["']$/g, "")).filter(Boolean)
      : v.replace(/^["']|["']$/g, "");
  }
  return meta;
}
function parseRef(r) {
  const m = String(r || "").trim().match(/^due\/([a-z0-9][a-z0-9-]*)(?:\.md)?(?:#(\d{4}-\d{2}-\d{2}))?$/);
  return m ? { slug: m[1], window: m[2] || "" } : null;
}
const listOf = (v) => (Array.isArray(v) ? v : v ? [v] : []);
function worldEvents() {
  if (EVENTS) return EVENTS;
  EVENTS = [];
  let files = [];
  try { files = fs.readdirSync(EVENTS_DIR).filter((f) => f.endsWith(".md")).sort(); } catch (e) { return EVENTS; }
  for (const f of files) {
    const text = readText(path.join(EVENTS_DIR, f));
    if (!/^(closes|drops):/m.test(text)) continue;
    const meta = frontmatter(text);
    if (!meta || !isDate(meta.date)) continue;
    const closes = listOf(meta.closes).map(parseRef).filter(Boolean);
    const drops = listOf(meta.drops).map(parseRef).filter(Boolean);
    if (!closes.length && !drops.length) continue;
    // No evidence, no closing: an event that says a thing is done without what shows it closes nothing.
    if (!String(meta.evidence || "").trim()) { UNPROVEN.push("world/events/" + f); continue; }
    EVENTS.push({ file: "world/events/" + f, date: meta.date, closes, drops });
  }
  return EVENTS;
}
// A named window closes that one; a bare name closes the window that was current on the event's day.
function targetStrip(o, ref, date) {
  const open = o.strips.filter((s) => s.state === "open");
  if (!open.length) return null;
  if (ref.window) return open.find((s) => s.from === ref.window) || null;
  const started = open.filter((s) => s.from <= date);
  return started.length ? started[started.length - 1] : open[0];
}
function applyEvents(o) {
  for (const s of o.strips) { s.state = "open"; s.closed = ""; s.by = ""; }
  o.dropped = null;
  const acts = [];
  for (const e of worldEvents()) {
    for (const r of e.closes) if (r.slug === o.slug) acts.push({ date: e.date, ref: r, by: e.file, legacy: false });
    for (const r of e.drops) if (r.slug === o.slug && (!o.dropped || e.date < o.dropped.date)) o.dropped = { date: e.date, by: e.file };
  }
  for (const s of o.strips) if (s.legacy) acts.push({ date: s.legacy, ref: { slug: o.slug, window: s.from }, by: "", legacy: true });
  acts.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.legacy === b.legacy ? 0 : a.legacy ? 1 : -1));
  for (const a of acts) {
    const s = targetStrip(o, a.ref, a.date);
    if (s) { s.state = "done"; s.closed = a.date; s.by = a.by || "legacy"; }
  }
  if (o.dropped) for (const s of o.strips) if (s.state === "open") { s.state = "dropped"; s.closed = o.dropped.date; s.by = o.dropped.by; }
}
// The one writer of a closing or a drop: one new file per event, never an edit of an old one.
function writeEvent(day, { closes = [], drops = [], evidence, source, text }) {
  if (!String(evidence || "").trim()) return null;
  const first = (closes[0] || drops[0] || "due/thing").replace(/^due\//, "").replace(/#.*/, "");
  const base = day + "-" + slugify(first + " " + (closes.length ? "closed" : "dropped"));
  let file = path.join(EVENTS_DIR, base + ".md");
  for (let n = 2; fs.existsSync(file); n++) file = path.join(EVENTS_DIR, base + "-" + n + ".md");
  const lines = ["---", "date: " + day, "participants: [me]"];
  if (closes.length) lines.push("closes: [" + closes.join(", ") + "]");
  if (drops.length) lines.push("drops: [" + drops.join(", ") + "]");
  lines.push("evidence: " + String(evidence).replace(/\s+/g, " ").trim(), "source: " + (source || "mc-due"),
             "written_by: mc-due", "origin: mission control", "---", "", String(text || "").trim(), "");
  if (!writeText(file, lines.join("\n"))) return null;
  const rel = "world/events/" + path.basename(file);
  worldEvents().push({ file: rel, date: day, closes: closes.map(parseRef).filter(Boolean), drops: drops.map(parseRef).filter(Boolean) });
  for (const x of CACHE.values()) applyEvents(x);
  return rel;
}
// An older file that still says `done <date>`: the closing becomes an event on its true date, with
// the file's own log line of that day as the evidence, and only then does the word go.
function migrateLegacy(notes) {
  for (const slug of slugs()) {
    const o = parseFile(slug);
    if (!o) continue;
    if (!o.strips.some((s) => s.legacy) && !/^STRIP:\s*\S+\s+\S+\s+open\b/m.test(o.text || "")) continue;
    let moved = true, wrote = 0;
    for (const s of o.strips) {
      if (!s.legacy || s.by !== "legacy") continue;
      const said = o.log.filter((l) => l.startsWith("- " + s.legacy + " ") && !/ SAID /.test(l)).map((l) => l.slice(13).trim());
      const rel = writeEvent(s.legacy, {
        closes: ["due/" + slug + "#" + s.from],
        evidence: "due/" + slug + ".md log, " + s.legacy + ": " + (said.length ? said[said.length - 1] : "the file said done").slice(0, 300),
        source: "moved out of the deadline file",
        text: (o.head["TITLE"] || slug) + ": finished (window " + windowWords(s) + ").",
      });
      if (!rel) moved = false; else wrote += 1;
    }
    if (!moved) continue;
    for (const s of o.strips) s.legacy = "";
    save(o);
    if (wrote) notes.push(slug + ": " + wrote + " closing(s) moved into world/events/");
  }
}
const ORDER = ["TITLE", "DONE-WHEN", "COST-IF-MISSED", "SELF-CHECK", "SELF-CHECK-ARG",
               "REPEATS", "LINK", "SOURCE"];
function render(o) {
  const H = (k) => (o.head[k] === undefined ? "" : o.head[k]);
  const out = ["# " + (H("TITLE") || o.slug), ""];
  for (const k of ORDER) out.push(k + ": " + H(k));
  // Anything you added by hand survives. A program that eats a line you wrote is a program you
  // stop editing by hand, and these are meant to be edited by hand.
  for (const k of Object.keys(o.head)) if (!ORDER.includes(k)) out.push(k + ": " + H(k));
  out.push("", "## Windows", "");
  // The window only. A state word survives only while it is still the one record of that closing.
  for (const s of o.strips) out.push(stripLine(s));
  out.push("", "## Log", "");
  for (const l of o.log) out.push(l);
  out.push("");
  return out.join("\n");
}
// A window with a deadline and no target is `STRIP: <from> <to>` and nothing else, byte for byte
// what it always was, so no file you already have changes when it is written back.
function stripLine(s) {
  return ["STRIP:", s.from, s.to || "-"]
    .concat(s.target ? ["target", s.target] : [], s.moved ? ["moved", s.moved] : [])
    .concat(s.legacy && s.by === "legacy" ? ["done", s.legacy] : [], s.extra || [])
    .join(" ");
}
// A window in words. A deadline window reads as it always has.
function windowWords(s) {
  const aim = aimOf(s);
  if (!aim) return s.from + " to " + s.to;
  return s.from + (s.to ? " to " + s.to + ", aiming for " + aim : ", aiming for " + aim);
}
const save = (o) => { CACHE.set(o.slug, o); return writeText(o.path, render(o)); };
const logLine = (o, day, t) => o.log.push("- " + day + " " + t);

function currentWindow(o, day) {
  const open = o.strips.filter((s) => s.state === "open");
  if (!open.length) return null;
  // A one-off that ran out stays the loudest thing about itself for ever, because for something
  // with a deadline "nobody got to it" is the failure and not a quiet success. But a REPEATING one
  // is judged on its current window: last September's timesheet is red for ever, and being red for
  // ever it would hide every month since, so the unclosed ones are counted on the same line.
  if (repeatOf(o.head["REPEATS"])) {
    const started = open.filter((s) => s.from <= day);
    const s = started.length ? started[started.length - 1] : open[0];
    const b = bandFor(s, day);
    return b ? { strip: s, band: b, missed: open.filter((x) => x !== s && endOf(x) < day).length } : null;
  }
  let best = null, bestRank = Infinity;
  for (const s of open) {
    const b = bandFor(s, day);
    if (!b) continue;
    const r = RANK[b] * 1000000 + daysBetween(day, endOf(s)) + 50000;
    if (r < bestRank) { bestRank = r; best = { strip: s, band: b, missed: 0 }; }
  }
  return best;
}

// ---------------------------------------------------------------- growing and adopting
// Both are pure arithmetic and both are safe to run as often as you like, so every command does
// them first and a run that gets interrupted heals itself on the next one.
function adoptKeys(day, notes) {
  const text = readText(EXPIRES);
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.replace(/\r$/, ""), note = "";
    const h = line.indexOf("#");
    if (h >= 0) { note = line.slice(h + 1).trim(); line = line.slice(0, h); }
    line = line.trim();
    if (!line) continue;
    const f = line.split(/\s+/);
    if (f.length < 3) continue;
    const [name, when, url] = f;
    if (when === "never" || !isDate(when)) continue;
    const slug = "key-" + slugify(name);
    let o = parseFile(slug);
    const plain = (note.split(".")[0] || "").trim() || "one of your keys";
    if (!o) {
      o = { slug, path: filePath(slug), strips: [{ from: day, to: when, state: "open", closed: "", legacy: "" }], log: [], said: [],
        head: {
          // Not "Get a new " + the sentence: half these notes start with "The key that..." and it
          // came out as "Get a new the key that...". Put the verb at the end and no case surgery
          // is needed for either shape.
          "TITLE": plain.replace(/[.\s]+$/, "") + " needs replacing",
          "DONE-WHEN": "A new key is made at that page, put in your locked folder, and the date in secrets/expires.txt says the new one.",
          "COST-IF-MISSED": "The morning after that date, everything using this key simply stops, with no warning at all. The error you get will blame something else.",
          "SELF-CHECK": "the date in secrets/expires.txt moves forward",
          "SELF-CHECK-ARG": name,
          "REPEATS": "no",
          "LINK": url && url !== "-" ? url : "",
          "SOURCE": "secrets/expires.txt (picked up automatically; the date lives there, never here)",
        } };
      logLine(o, day, "picked up from secrets/expires.txt, which says this key dies on " + when);
      save(o);
      notes.push("picked up " + slug + " from secrets/expires.txt (last day " + when + ")");
      continue;
    }
    const open = o.strips.filter((s) => s.state === "open");
    const cur = open.length ? open[open.length - 1] : null;
    if (cur && when > cur.to) {
      // The date moved forward, which is what getting a new key looks like from the outside. So
      // this one is finished, and the key's next life starts today. Nobody had to be asked.
      const rel = writeEvent(day, {
        closes: ["due/" + slug + "#" + cur.from],
        evidence: "the date in secrets/expires.txt moved from " + cur.to + " to " + when + ", so the key was replaced",
        source: "mc-due, secrets/expires.txt",
        text: (o.head["TITLE"] || slug) + ": the key was replaced; it now lasts until " + when + ".",
      });
      if (!rel) continue;
      o.strips.push({ from: day, to: when, state: "open", closed: "", legacy: "" });
      applyEvents(o);
      logLine(o, day, "closed itself (" + rel + "): the date in secrets/expires.txt moved to " + when + ", so you replaced the key");
      save(o);
      notes.push(slug + " closed itself: the date moved to " + when);
    } else if (cur && when < cur.to) {
      cur.to = when;
      logLine(o, day, "the date in secrets/expires.txt was brought forward to " + when);
      save(o);
    }
  }
}
function growWindows(day, notes) {
  for (const slug of slugs()) {
    const o = parseFile(slug);
    if (!o || !o.strips.length || o.dropped) continue;
    const rep = repeatOf(o.head["REPEATS"]);
    if (!rep) continue;
    // COUNTED FROM THE FIRST WINDOW, NEVER FROM THE ONE BEFORE. Stepping from the previous one is
    // how a job ending on the 31st gets clamped to the 28th in February and then stays there.
    // A window with no deadline ends on its target, and its target is stepped from the first
    // window's exactly like the dates around it.
    const anchor = o.strips[0];
    let newest = o.strips[o.strips.length - 1], added = 0;
    while (endOf(newest) && endOf(newest) < day && added < 240) {
      const k = o.strips.length;
      const step = rep.kind === "months" ? (a) => addMonths(a, rep.n * k) : (a) => addDays(a, rep.n * k);
      const from = step(anchor.from), to = anchor.to ? step(anchor.to) : "";
      const w = { from, to, target: anchor.target ? step(anchor.target) : "", moved: "", extra: [],
                  state: "open", closed: "", legacy: "" };
      if (!from || !endOf(w) || endOf(w) <= endOf(newest)) break;
      o.strips.push(w);
      newest = o.strips[o.strips.length - 1];
      added += 1;
    }
    if (added) {
      applyEvents(o);
      logLine(o, day, "the next window opened: " + windowWords(newest));
      save(o);
      notes.push(slug + ": next window " + windowWords(newest));
    }
  }
}
// ---------------------------------------------------------------- your due/ README, kept current
// An update replaces this program but never a file in your mission control: starter files are
// copied once and then they are yours. So somebody who installed before targets existed would keep
// a README describing two dates for ever, beside a program that knows three. This keeps the room's
// README current, but ONLY when it is exactly a copy this kit once shipped. One you changed by hand
// is yours and is never touched. Fingerprints: sha256 of each shipped version, line endings
// ignored, first 16 characters.
const SHIPPED_READMES = [
  "e1e1f8072396ad20", "4f75edcae9a8f66c", "b783ca077e858d36", "10afeedb162f4649",
  "53b028714c10f9c5", "d06b4543c3d443ba", "ee5bc45cc2b90854",
];
function keepReadmeCurrent(notes) {
  const p = path.join(DUE, "README.md");
  let text;
  try { text = fs.readFileSync(p, "utf8"); } catch (e) { return; }
  const plain = text.replace(/\r\n/g, "\n");
  if (plain === README) return;
  const h = require("crypto").createHash("sha256").update(plain).digest("hex").slice(0, 16);
  if (!SHIPPED_READMES.includes(h)) return;
  if (writeText(p, text.includes("\r\n") ? README.replace(/\n/g, "\r\n") : README)) {
    notes.push("due/README.md brought up to date (you had not changed it)");
  }
}

function roll(day) { const notes = []; keepReadmeCurrent(notes); migrateLegacy(notes); adoptKeys(day, notes); growWindows(day, notes); return notes; }

function load(day) {
  roll(day);
  const rows = [];
  for (const slug of slugs()) {
    const o = parseFile(slug);
    if (!o) continue;
    const cur = currentWindow(o, day);
    rows.push({
      o, slug, title: o.head["TITLE"] || slug,
      band: cur ? cur.band : (o.dropped ? "dropped" : "closed"),
      strip: cur ? cur.strip : null,
      left: cur ? daysBetween(day, endOf(cur.strip)) + 1 : null,
      missed: cur ? cur.missed : 0,
      lastSaid: o.said.reduce((b, s) => (s.date <= day && (!b || s.date > b) ? s.date : b), null),
    });
  }
  rows.sort((a, b) => {
    const ra = RANK[a.band] === undefined ? 9 : RANK[a.band], rb = RANK[b.band] === undefined ? 9 : RANK[b.band];
    if (ra !== rb) return ra - rb;
    if (a.left !== b.left) return (a.left === null ? 1e9 : a.left) - (b.left === null ? 1e9 : b.left);
    return a.slug < b.slug ? -1 : 1;
  });
  return rows;
}

// The one question is being asked: a target with no deadline has passed, and today is the first
// morning anything is said about it since, or nothing has been said yet. Asking again the same
// morning gives the same page.
function asking(r, day) {
  if (!r.strip || r.strip.to || r.band !== "asap") return false;
  const first = firstSaidAfter(r.o, aimOf(r.strip));
  return !first || first === day;
}

function sentence(r, day) {
  const to = r.strip.to, left = r.left, aim = aimOf(r.strip);
  const also = r.missed
    ? " And " + r.missed + " earlier one" + (r.missed === 1 ? "" : "s") + " closed without you saying it was done."
    : "";
  if (r.band === "unopened") {
    const wait = daysBetween(day, r.strip.from);
    const ends = !to ? "you would like it done by " + aim
      : (aim ? "you would like it done by " + aim + ", and the last day is " + to : "the last day is " + to);
    return r.title + ": you cannot start yet. It opens on " + r.strip.from + ", in " + wait +
      " day" + (wait === 1 ? "" : "s") + ", and " + ends + ".";
  }
  // A target with no deadline: the day you aimed for, then the one question, then a gentle line.
  if (!to) {
    if (r.band === "aiming") {
      const n = daysBetween(day, aim);
      return r.title + ": you would like it done by " + aim + (n === 1 ? ", tomorrow." : ", in " + n + " days.") + also;
    }
    if (r.band === "target") return r.title + ": today, " + aim + ", is the day you would like it done." + also;
    if (asking(r, day)) return r.title + ": you aimed for " + aim + ". A new date, or as soon as you can?" + also;
    return r.title + ": still open, as soon as you can. You aimed for " + aim + "." + also;
  }
  if (left < 0) return r.title + ": the last day was " + to + ", " + (-left) + " day" + (left === -1 ? "" : "s") + " ago." + also;
  if (left === 0) return r.title + ": the last day was yesterday, " + to + "." + also;
  // A target beside a deadline: said first, and not at all once the deadline has passed.
  const lead = !aim || day < aim ? "" : (day === aim ? " today is the day you aimed for (" + aim + ")." : " past the day you aimed for (" + aim + ").");
  const after = aim && day < aim ? " You would like it done by " + aim + "." : "";
  if (lead) {
    if (left === 1) return r.title + ":" + lead + " Today is the last day, " + to + "." + also;
    return r.title + ":" + lead + " " + left + " days left, and the last one is " + to + "." + also;
  }
  if (left === 1) return r.title + ": today is the last day, " + to + "." + after + also;
  return r.title + ": " + left + " days left, and the last one is " + to + "." + after + also;
}

// Whether a thing may be said this morning. A deadline follows its step's gap; a target follows
// the one rule every target follows: nothing before its day, one mention on it, one question the
// first morning after, then about once a week. A deadline with a target also speaks on that day.
function sayable(r, day) {
  const aim = aimOf(r.strip);
  if (!r.strip.to) {
    if (r.band === "aiming") return false;
    if (r.band === "target") return true;
    if (r.band !== "asap") return false;
    if (!firstSaidAfter(r.o, aim)) return true;
    return !r.lastSaid || daysBetween(r.lastSaid, day) >= ASAP_GAP;
  }
  if (aim && day === aim) return true;
  const gap = gapFor(r.strip, r.band);
  if (!gap) return false;
  return !r.lastSaid || daysBetween(r.lastSaid, day) >= gap;
}

// ---------------------------------------------------------------- the self checks
// How your mission control could tell this was done WITHOUT asking you. Only one is possible without help from
// somebody else's website, and it is the cheapest thing there is: did a file change inside the
// window. `none` is the honest answer for most obligations and it is not second best.
function selfCheck(o, strip) {
  const kind = (o.head["SELF-CHECK"] || "none").trim().toLowerCase();
  if (kind === "file-newer") {
    const rel = (o.head["SELF-CHECK-ARG"] || "").trim();
    if (!rel) return { error: "it says to look at a file but does not say which one" };
    const p = path.isAbsolute(rel) ? rel : path.join(godspeed, rel);
    let st;
    try { st = fs.statSync(p); } catch (e) { return { done: false }; }
    const when = new Date(st.mtimeMs).toISOString().slice(0, 10);
    return when >= strip.from
      ? { done: true, why: rel + " was written on " + when + ", inside this window" }
      : { done: false };
  }
  // Anything else, including the line the key obligations carry, is closed by the thing that wrote
  // it rather than here. Nothing to do, and nothing pretended.
  return { done: false };
}

// ---------------------------------------------------------------- commands
const argOf = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt; };
const has = (name) => args.indexOf(name) >= 0;
const CAP = 3;

function help() {
  console.log(`mc-due - the things with a last day, and how loud to be about them

  mc-due                         everything, loudest first
  mc-due today                   at most three, for your morning brief
  mc-due add <name> --title "..." [--from YYYY-MM-DD]
          --target YYYY-MM-DD and/or --to YYYY-MM-DD
          --done-when "..." [--cost "..."]
          [--repeats monthly|yearly|"every N days"]
          [--self-check none|file-newer] [--self-check-arg PATH] [--link URL]
          --from is the day you can start (today if you leave it out). --target is the day
          you would like it done. --to is the last day before it costs you, and needs --cost.
          At least one of --target and --to.
  mc-due target <name> YYYY-MM-DD   a new day you would like it done
  mc-due target <name> asap         as soon as you can (it stays, mentioned about weekly)
  mc-due done <name> [--evidence "..."]   you did it (written down as an event in world/events/)
  mc-due drop <name> --yes       call it off; nothing is deleted
  mc-due check                   run the self checks, close what is provably done
  mc-due state [--json]          open or not, for every one, and what closed it
  mc-due --godspeed PATH              a mission control somewhere else

How loud a deadline gets comes from how much of the window is left, and from nothing else:
quiet through the first half, then a quarter, then a tenth, then every day. One rule, whether
the window is a week or a year. Nothing to tune. A target alone is quiet until its day, says
so that day, asks once after it, then comes back about once a week and never gets louder.`);
}

function cmdList(day, capped) {
  const rows = load(day);
  if (!rows.length) {
    console.log("Nothing with a last day yet.");
    console.log("Add one:  mc-due add tax --title \"My tax return\" --from 2027-01-01 --to 2027-07-31 \\");
    console.log("            --done-when \"it is filed\" --cost \"a late fee, and they estimate my income themselves\"");
    return 0;
  }
  const live = rows.filter((r) => r.strip && r.band !== "closed" && r.band !== "dropped" && r.band !== "unopened");
  // MORE THAN THREE RUNNING OUT IN THE SAME WEEK BECOMES ONE LINE. Seven lines is a page nobody
  // reads, and "you have taken on too much this week" is the honest thing that week is about.
  const soon = live.filter((r) => {
    for (let i = 0; i <= 7; i++) if (bandOf(r.strip.from, r.strip.to, addDays(day, i)) === "red") return true;
    return false;
  });
  if (capped && soon.length > CAP) {
    console.log(soon.length + " things run out of time this week, which is more than one morning can carry.");
    console.log("Pick the two you will really do, and drop or move the rest:");
    for (const r of soon) console.log("  - " + r.title + " (last day " + r.strip.to + ")");
    return 0;
  }
  // AT MOST THREE A DAY, NOT THREE A CALL. Your brief gets re-run when a morning goes wrong, and a
  // per-call cap would quietly hand you six. Asking twice on the same day gives you the same page.
  // This is also the only place that writes down what was said, which is what keeps green quiet:
  // once when the window opens, then nothing for a month.
  let show = rows;
  if (capped) {
    const saidToday = live.filter((r) => r.o.said.some((x) => x.date === day && x.channel === "brief"));
    const room = Math.max(0, CAP - saidToday.length);
    const fresh = live.filter((r) => !saidToday.includes(r) && sayable(r, day)).slice(0, room);
    show = saidToday.concat(fresh);
    for (const r of fresh) {
      r.o.said.push({ date: day, channel: "brief" });
      logLine(r.o, day, "SAID brief");
      save(r.o);
    }
  }
  if (!show.length) { console.log("Nothing needs saying today."); return 0; }
  for (const r of show) {
    if (!r.strip) { console.log((r.o.dropped ? "CALLED OFF     " : "DONE      ") + r.title); continue; }
    console.log(WORDS[r.band].padEnd(15) + sentence(r, day));
    // In the full list the question comes with its two answers, so the assistant knows what to
    // run when you reply. Your brief (today) gets the question alone, in plain words.
    if (!capped && asking(r, day)) {
      console.log("               a new date:  mc-due target " + r.slug + " YYYY-MM-DD" +
                  "    as soon as you can:  mc-due target " + r.slug + " asap");
    }
    if (!capped) {
      const c = (r.o.head["SELF-CHECK"] || "none").toLowerCase();
      console.log("               " + (c === "none"
        ? "only your word closes this one:  mc-due done " + r.slug
        : "closes itself when " + (r.o.head["SELF-CHECK"] || "")));
    }
  }
  return 0;
}

function cmdAdd(day) {
  const slug = slugify(args[1] || "");
  if (!slug) { console.log("Give it a short name:  mc-due add tax --title ..."); return 1; }
  // Say how to change the one that exists. A practice run met the bare refusal by adding a second
  // tax return beside the wrong one, which left two things reminding about one date.
  if (fs.existsSync(filePath(slug))) {
    console.log("You already have one called " + slug + ". Never add a second one for the same thing.");
    console.log("To change its dates, edit the STRIP line in due/" + slug + ".md (for a new target: mc-due target " + slug + " YYYY-MM-DD).");
    return 1;
  }
  const given = argOf("--from", ""), to = argOf("--to", argOf("--deadline", "")), target = argOf("--target", "");
  if ((given && !isDate(given)) || (to && !isDate(to)) || (target && !isDate(target))) {
    console.log("Every date is written year first, like 2027-03-14.");
    return 1;
  }
  if (!to && !target) {
    console.log("This needs a day: --target (the day you would like it done), --to (the last day before it");
    console.log("costs you), or both. Each written year first, like 2027-03-14.");
    console.log("");
    console.log("No date, not eligible. Something with no day at all is a wish, and this is not a to-do list.");
    return 1;
  }
  // The day you can start is today unless you say otherwise, but never after the day it ends: a
  // target or a deadline already behind you opens its window on that day instead.
  // A name with a history keeps it: a closing or a drop in world/events/ names the thing by this
  // name, so a new thing under it would be born closed or called off (found in a practice run).
  const used = worldEvents().find((e) => e.closes.concat(e.drops).some((r) => r.slug === slug));
  if (used) { console.log("The name " + slug + " was used before (" + used.file + "), and its history would come with it. Pick another name."); return 1; }
  const from = given || [day, target, to].filter(Boolean).sort()[0];
  if (to && to < from) { console.log("The last day (" + to + ") is before the first day (" + from + ")."); return 1; }
  if (target && target < from) { console.log("The day you would like it done (" + target + ") is before the day you can start (" + from + ")."); return 1; }
  if (target && to && target > to) {
    console.log("The day you would like it done (" + target + ") is after the day it starts costing you (" + to + ").");
    console.log("A target sits on or before the deadline.");
    return 1;
  }
  const doneWhen = argOf("--done-when", ""), cost = argOf("--cost", "");
  // What slipping costs is only asked when there is a deadline. A target alone costs nothing when
  // you miss it, by definition, and you are not asked to invent a cost.
  if (!doneWhen || (to && !cost)) {
    console.log("It also needs --done-when (what is true when this is finished)" + (to ? " and --cost (what it costs you if it slips)" : "") + ".");
    console.log("That is what lets your mission control write you a line worth reading instead of a nag.");
    return 1;
  }
  const repeats = argOf("--repeats", "no");
  if (repeatOf(repeats) === undefined) {
    console.log("--repeats must be no, weekly, fortnightly, monthly, quarterly, yearly, or \"every N days\".");
    return 1;
  }
  const sc = (argOf("--self-check", "none") || "none").toLowerCase();
  if (sc !== "none" && sc !== "file-newer") { console.log("--self-check must be none or file-newer."); return 1; }
  const o = { slug, path: filePath(slug), strips: [{ from, to, target, moved: "", extra: [], state: "open", closed: "", legacy: "" }], log: [], said: [],
    head: {
      "TITLE": argOf("--title", slug), "DONE-WHEN": doneWhen, "COST-IF-MISSED": cost,
      "SELF-CHECK": sc, "SELF-CHECK-ARG": argOf("--self-check-arg", ""),
      "REPEATS": repeats, "LINK": argOf("--link", ""), "SOURCE": "you, " + day,
    } };
  logLine(o, day, "created, window " + windowWords(o.strips[0]));
  if (!save(o)) return 1;
  const b0 = bandFor(o.strips[0], day);
  if (to) {
    console.log(b0 === "unopened"
      ? "Made " + slug + ". You cannot start it until " + from + ", and the last day is " + to + "."
      : "Made " + slug + ". Window " + from + " to " + to + ", and today there is " + WORDS[b0].toLowerCase() + ".");
    if (target) console.log("You would like it done by " + target + ", and that day it is mentioned once.");
  } else if (b0 === "unopened") console.log("Made " + slug + ". You cannot start it until " + from + ", and you would like it done by " + target + ".");
  else if (b0 === "aiming") console.log("Made " + slug + ". You would like it done by " + target + ". Nothing is said about it before that day.");
  else if (b0 === "target") console.log("Made " + slug + ". You would like it done today, " + target + ".");
  else console.log("Made " + slug + ". The day you would like it done, " + target + ", has already passed, so your next brief asks: a new date, or as soon as you can?");
  // A day well behind you is usually the wrong year, which an assistant can write as easily as a
  // person (a practice run wrote 2024 for 2026). It is still accepted, because an overdue deadline
  // is real too, but it is said while it is easy to fix.
  for (const [label, d] of [["the day you would like it done", target], ["the last day", to]]) {
    const ago = d ? daysBetween(d, day) : 0;
    if (ago > 30) console.log("Careful: " + label + ", " + d + ", was " + ago + " days ago. If you meant a day still ahead, correct it in due/" + slug + ".md now.");
  }
  console.log(sc === "none"
    ? "It cannot tell by itself that you did it, so it waits for your word:  mc-due done " + slug
    : "It closes itself when " + argOf("--self-check-arg", "that file") + " changes inside the window.");
  return 0;
}

function cmdDone(day) {
  const slug = args[1];
  if (!slug) { console.log("Which one?  mc-due done <name>"); return 1; }
  roll(day);
  const o = parseFile(slug);
  if (!o) { console.log("You have nothing called " + slug + ". Type mc-due to see the list."); return 1; }
  const cur = currentWindow(o, day);
  if (!cur) { console.log("Nothing was open on " + slug + "."); return 0; }
  // Your word is the evidence, plus whatever you or your assistant name as showing it.
  const extra = String(argOf("--evidence", "") || "").trim();
  const rel = writeEvent(day, {
    closes: ["due/" + slug + "#" + cur.strip.from],
    evidence: "you said so" + (extra ? "; " + extra : ""),
    source: "mc-due done",
    text: (o.head["TITLE"] || slug) + ": done (window " + windowWords(cur.strip) + ").",
  });
  if (!rel) { console.log("I could not write it down, so nothing was closed."); return 1; }
  logLine(o, day, "you said it was done (" + rel + ")");
  save(o);
  console.log("Closed " + slug + " (" + windowWords(cur.strip) + "): " + rel);
  if (repeatOf(o.head["REPEATS"])) console.log("It repeats, so the next window opens when this one ends.");
  return 0;
}

// TARGET. Your answer after a target passed, or a target for something that has none yet.
//   mc-due target <name> YYYY-MM-DD   the new day you would like it done
//   mc-due target <name> asap         as soon as you can
// "As soon as you can" changes nothing but the log, because it behaves exactly like no answer. A new
// day is written as `moved` beside the planned one, so a repeating thing's next window is still
// planned from its first.
function cmdTarget(day) {
  const slug = args[1], what = String(args[2] || "").trim();
  if (!slug || !what) { console.log("Which one, and what day?  mc-due target <name> YYYY-MM-DD   or   mc-due target <name> asap"); return 1; }
  roll(day);
  const o = parseFile(slug);
  if (!o) { console.log("You have nothing called " + slug + ". Type mc-due to see the list."); return 1; }
  const cur = currentWindow(o, day);
  if (!cur) { console.log("Nothing is open on " + slug + ", so there is no day to move."); return 1; }
  const s = cur.strip, old = aimOf(s);
  if (/^(asap|as-soon-as-you-can)$/i.test(what)) {
    if (!old) { console.log(slug + " has no day you aimed for. As soon as you can is the answer to a target that passed."); return 1; }
    logLine(o, day, "you said as soon as you can, after aiming for " + old);
    save(o);
    console.log("Kept " + slug + " open, as soon as you can. Your brief mentions it about once a week until you say it is done.");
    return 0;
  }
  if (!isDate(what)) {
    // An assistant once wrote `mc-due target <name> --to <day>`: say the one right form.
    console.log("Give the new day on its own, year first:  mc-due target " + slug + " 2027-03-14   or:  mc-due target " + slug + " asap");
    if (/^--/.test(what)) console.log("(--to is a deadline, which this does not change.)");
    return 1;
  }
  if (what < s.from) { console.log("That day (" + what + ") is before the day you can start (" + s.from + ")."); return 1; }
  if (s.to && what > s.to) {
    console.log("That day (" + what + ") is after the day it starts costing you (" + s.to + "). A target sits on or before the deadline.");
    return 1;
  }
  if (s.target) s.moved = what === s.target ? "" : what;
  else {
    s.target = what;
    // A repeating thing gets the same place in every window, planned from the first one.
    const rep = repeatOf(o.head["REPEATS"]), anchor = o.strips[0];
    if (rep && anchor !== s && !anchor.target) {
      const t = addDays(anchor.from, daysBetween(s.from, what));
      anchor.target = anchor.to && t > anchor.to ? anchor.to : t;
    }
    if (rep && anchor.target) {
      o.strips.forEach((w, k) => {
        if (k === 0 || w === s || w.from <= s.from || w.target) return;
        const t = rep.kind === "months" ? addMonths(anchor.target, rep.n * k) : addDays(anchor.target, rep.n * k);
        w.target = w.to && t > w.to ? w.to : t;
      });
    }
  }
  logLine(o, day, old ? "you moved the day you would like it done from " + old + " to " + what : "you would like it done by " + what);
  save(o);
  console.log("Moved " + slug + ": you would like it done by " + what + (s.to ? ", and the last day is still " + s.to : "") + ".");
  return 0;
}

function cmdDrop() {
  const slug = args[1];
  if (!slug) { console.log("Which one?  mc-due drop <name> --yes"); return 1; }
  if (!has("--yes")) {
    console.log("Dropping calls it off for good. Add --yes if that is what you mean.");
    return 1;
  }
  const o = parseFile(slug);
  if (!o) { console.log("You have nothing called " + slug + "."); return 1; }
  if (o.dropped) { console.log(slug + " was already called off."); return 0; }
  const extra = String(argOf("--evidence", "") || "").trim();
  const rel = writeEvent(today(), {
    drops: ["due/" + slug], evidence: "you said so" + (extra ? "; " + extra : ""), source: "mc-due drop",
    text: (o.head["TITLE"] || slug) + ": called off.",
  });
  if (!rel) { console.log("I could not write it down, so nothing was dropped."); return 1; }
  logLine(o, today(), "dropped (" + rel + ")");
  save(o);
  console.log("Dropped " + slug + ". Nothing will mention it again; the file stays as history.");
  return 0;
}

function cmdCheck(day) {
  const notes = roll(day);
  for (const n of notes) notes.length && console.log("  " + n);
  let closed = 0, problems = 0;
  for (const slug of slugs()) {
    const o = parseFile(slug);
    if (!o) { console.log("  I could not read due/" + slug + ".md"); problems++; continue; }
    if (repeatOf(o.head["REPEATS"]) === undefined) {
      console.log("  due/" + slug + ".md says it repeats \"" + o.head["REPEATS"] + "\", which I cannot turn into a period.");
      problems++;
    }
    const cur = currentWindow(o, day);
    if (!cur) continue;
    const r = selfCheck(o, cur.strip);
    if (r.error) { console.log("  due/" + slug + ".md: " + r.error); problems++; continue; }
    if (r.done) {
      const rel = writeEvent(day, {
        closes: ["due/" + slug + "#" + cur.strip.from], evidence: "self check: " + r.why, source: "mc-due check",
        text: (o.head["TITLE"] || slug) + ": finished, seen by its self check.",
      });
      if (!rel) { console.log("  due/" + slug + ".md: could not write the closing down"); problems++; continue; }
      logLine(o, day, "closed itself (" + rel + "): " + r.why);
      save(o);
      console.log("  closed itself: " + (o.head["TITLE"] || slug) + " (" + r.why + ")");
      closed++;
    }
  }
  for (const f of UNPROVEN) { console.log("  " + f + " says it closes something but not what shows it, so it closes nothing."); problems++; }
  const n = slugs().length;
  console.log("Looked at " + n + " thing" + (n === 1 ? "" : "s") + " with a last day. " +
    closed + " closed " + (closed === 1 ? "itself" : "themselves") + ", " + problems + " need a look.");
  return problems ? 1 : 0;
}

function cmdState(day) {
  const rows = load(day).map((r) => {
    const last = r.o.strips.filter((s) => s.state !== "open").sort((a, b) => (a.closed < b.closed ? -1 : 1)).pop();
    return {
      slug: r.slug, title: r.title, state: r.band === "unopened" ? "unopened" : r.strip ? "open" : r.band,
      firstDay: r.strip ? r.strip.from : "", lastDay: r.strip ? r.strip.to : "",
      ...(r.strip && aimOf(r.strip) ? { targetDay: aimOf(r.strip) } : {}),
      doneWhen: (r.o.head["DONE-WHEN"] || "").trim(), closedOn: last ? last.closed : "", closedBy: last ? last.by : "",
      // Anything but "none" closes itself in `mc-due check`, so the stop check never guesses at it.
      selfCheck: (r.o.head["SELF-CHECK"] || "").trim().toLowerCase() || "none",
    };
  });
  if (has("--json")) { console.log(JSON.stringify(rows)); return 0; }
  for (const r of rows) console.log(r.state.toUpperCase().padEnd(9) + r.slug + (r.closedBy && r.state !== "open" ? "  (" + r.closedBy + ")" : ""));
  return 0;
}

// readme:begin (a copy of starter-godspeed/due/README.md; tools/test-due.sh checks it byte for byte)
const README = "# due - the things with a day\n\n**This room starts empty, and an empty one costs you nothing.** It fills the first time you tell\nyour mission control about something with a day attached: a day you would like it done by, or a\nlast day before it costs you (Chapter 27). If you never do, you have an empty folder and you have\nlost nothing.\n\n## Why this is not a reminder\n\nA calendar reminder fires on a date and knows nothing else. It cannot tell whether you already did\nthe thing, so it goes off afterwards, and after that happens a few times you stop reading\nreminders. Then one of them stops on its last occurrence whether or not the job got done, and that\nis the one that mattered.\n\nEverything in here is built to fix both halves of that.\n\n## Three dates, and you usually need only one\n\nEvery thing in here can carry up to three dates:\n\n- **The day you can start.** Optional. If you leave it out, it is the day you add the thing.\n- **The day you would like it done.** A target, soft, like a date in a calendar. Missing it costs\n  you nothing.\n- **The day it starts costing you.** A deadline, hard: after it there is a fee, a fine, a lost\n  chance.\n\nIt needs at least a target or a deadline. Many people only ever need the target.\n\n| What it has | What your mission control does |\n|---|---|\n| **A deadline only** | The window below: quiet at first, louder as the last day comes, and after the last day it stays until you close it or drop it. |\n| **A target only** | Nothing until that day. One mention on the day. Once it has passed it never gets louder: the next morning it asks you once, \"A new date, or as soon as you can?\" A new date becomes the new target. \"As soon as you can\", or no answer at all, keeps it open with a gentle line in your brief about once a week, until you finish it or drop it. |\n| **Both** (a tax return: aim for the end of January, must by the end of February) | The deadline's window, plus one mention on the target day. After the target it says you are past it and names the deadline. It does not ask for a new date, because the deadline decides. |\n| **Repeating** | A new window each time. The target sits at the same place inside every window. |\n\nIn your morning's three places, a target you have passed comes after every deadline, and it never\nreaches your phone as a push message. It is a wish you gave yourself, not a bill.\n\n## The window, for a deadline\n\nA deadline holds **the first day you can do the thing, and the last day you still can.** Not a due\ndate. A window.\n\nHow loud your mission control gets follows how much of the window is left, as a fraction:\n\n| Left of the window | Your mission control |\n|---|---|\n| more than half | says it once when the window opens, then at most monthly |\n| half to a quarter | a line in your brief about every fortnight |\n| a quarter to a tenth | its own line, near the top, about weekly |\n| the loud days at the end: a tenth of the window, never fewer than three days and never more than fourteen | every morning |\n\n**One rule, whether the window is a week or a year.** That is the whole reason you can have a\nhundred of these. There is nothing to tune per item, and if a thing feels like it needs its own\nsetting, the window is wrong rather than the rule. A target adds no setting either: every target\nbehaves the same way.\n\n## What a file looks like\n\nOne file per thing, named however you like:\n\n```\ndue/car-service.md\n\nTITLE:          Car service before the warranty runs out\nDONE-WHEN:      The car has been serviced at a garage the warranty accepts.\nCOST-IF-MISSED: The warranty ends. A gearbox after that is mine to pay for.\nSELF-CHECK:     none\nSELF-CHECK-ARG:\nREPEATS:        yearly\nLINK:           https://example.com/book-a-service\nSOURCE:         me, 2026-08-29\n\n## Windows\nSTRIP: 2026-09-01 2027-02-28\n\n## Log\n- 2026-08-29 created, window 2026-09-01 to 2027-02-28\n```\n\nA target is one more word on the window line. A present to buy before a birthday, with no\ndeadline at all, reads `STRIP: 2026-04-20 - target 2026-05-10`: from the 20th of April, aiming for\nthe 10th of May, and the `-` says there is no last day. With both, it is\n`STRIP: 2026-10-01 2027-02-28 target 2027-01-31`. When you give a new day after missing one, it is\nwritten beside the old one as `moved 2027-02-10`.\n\nPlain text. Read it, edit it, delete it. The program writes the same shape you would.\n\n**A repeating thing is ONE file that grows a new window each time**, never one file per occurrence.\nThat is what keeps a hundred of these at a hundred files instead of thousands.\n\n## The four questions, asked once\n\nWhen you add one, answer four things and never be asked again:\n\n1. What is true when this is finished?\n2. Is there a day after which this costs you something, or is it a day you would like to have it\n   done by? (Or both. And if you cannot start yet, from when.)\n3. What does it cost you if it slips? Only asked when there is a deadline: a target costs nothing.\n4. **How could your mission control tell you did it, without asking you?**\n\nThe fourth is the one that matters and the one everybody skips. Some things can answer it. A key is\nreplaced when the date in `secrets/expires.txt` moves. A backup happened if the file is newer than\nthe window. Those close themselves and never nag you again after you act, which is exactly the\nfailure that kills every reminder app.\n\nMost things cannot answer it, and **that is a fine answer**. Nobody can tell your mission control that you\nsubmitted a timesheet into somebody else's website. Those say so and wait for you to say the word.\nAsk the question anyway, every time, because knowing which kind a thing is changes what you build\naround it.\n\n## No date, not eligible\n\n`mc-due add` refuses anything that has neither a target nor a deadline, in those words. That\nrefusal is the only thing between this folder and a to-do app you stop maintaining. \"Someday\" is\nnot a target; \"by the 10th of May\" is.\n\n## Three states, and only three\n\n**open, done, dropped.** Done can happen by itself when there is a self check. **Dropped only ever\ncomes from you**, which is why the command makes you type `--yes`.\n\n**Done is never written in here.** A file in this room is the plan. When a thing is finished,\nthat is something that happened, so it goes where the things that happened go: a small file in\n`world/events/` that says `closes: [due/car-service]` and, on an `evidence:` line, what shows it\n(your words, a receipt, a commit). A drop is the same with `drops:`. Everything that asks \"is this\nstill open\" works it out from those, so there is only one place the answer can live and nothing\ncan disagree with it. Why: in the mission control this kit comes from, a post was approved and\npublished in a working session, the memory wrote that down the same day, and the deadline file\nkept saying open, so the morning brief told its owner for five mornings that the finished work was\nwaiting. `mc-due done` and `mc-due drop` write the event for you, and when your assistant finishes\none of these with you in a session it closes it before the session ends.\n\nSomething whose window closed without being done **stays open**. Nothing tidies it away, because\nfor a deadline \"nobody got to it\" is the failure, not a quiet success.\n\n## Your keys are already in here\n\nIf you have `secrets/expires.txt` from Chapter 31, `mc-due` reads it and treats each key as one of\nthese. You never write a date in two places, and there is one thing nagging you rather than two\nthat disagree. Moving the date in that file is still the off switch, and it is now also the proof:\nmoving it forward is what replacing a key looks like from outside, so the reminder closes itself.\n\n## You do not need a calendar\n\nNot for any of this. If you do have one, your assistant can add **one entry per thing**, and one is\nthe whole rule. For a deadline it goes on the day your mission control starts being loud, not on the day the thing dies, and\nthe death date goes in the title so the single entry says both. For a target it goes on the target\nday, and a thing with both gets the target-day entry with the deadline in its title. Never two\nentries about one date: the day they disagree with each other you stop believing either.\n\nIt comes out again when you finish, as long as the day has not passed yet. That is the part that\nmakes one entry safe, because otherwise an entry you already acted on sits there being wrong. A day\nthat has already gone by is left alone: it is a record of what happened.\n\nYou can also go the other way and add one from your phone, by writing an event that says\n`mission control: from 1 Feb`. **The calendar never decides when you get nagged and never knows whether you\nacted.**\n\n## The commands\n\n```\nmc-due                     everything, loudest first\nmc-due today               at most three, which is what your morning brief reads\nmc-due add <name> ...      make one: --target, --to (the deadline), or both\nmc-due target <name> D     a new day you would like it done (or: asap, as soon as you can)\nmc-due done <name>         you did it (an event in world/events/ says so)\nmc-due drop <name> --yes   call it off; nothing is deleted\nmc-due check               run the self checks, close what is provably done\nmc-due state               which are open, and what closed the others\n```\n\nThe card is `procedures/what-runs-out-and-when.md` in the kit. Chapter 27.\n";
// readme:end

const day = today();
const cmd = args[0] && !args[0].startsWith("-") ? args[0] : "";
let rc = 0;
switch (cmd) {
  case "": case "list": rc = cmdList(day, false); break;
  case "today": rc = cmdList(day, true); break;
  case "add": rc = cmdAdd(day); break;
  case "done": rc = cmdDone(day); break;
  case "target": rc = cmdTarget(day); break;
  case "drop": rc = cmdDrop(); break;
  case "check": rc = cmdCheck(day); break;
  case "state": rc = cmdState(day); break;
  default: console.log("I do not know \"" + cmd + "\"."); help(); rc = 1;
}
process.exit(rc);
