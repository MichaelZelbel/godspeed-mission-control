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
 * THE PART THAT MAKES IT NOT A TO-DO LIST. Every obligation says how your hub could tell it was
 * done WITHOUT asking you. The ones that can, close themselves the moment you act. The ones that
 * cannot say so and wait for your word, which is most of them, and that is fine. Asking the
 * question is what matters.
 *
 * NO DATE, NOT ELIGIBLE. This refuses anything without both dates, on purpose. Let undated wishes
 * in and within a month it is a to-do app you do not maintain.
 *
 *   hub-due                    everything, loudest first
 *   hub-due today              at most three, for your morning brief to read
 *   hub-due add <name> --title "..." --from YYYY-MM-DD --to YYYY-MM-DD
 *          --done-when "..." --cost "..." [--repeats monthly|yearly|"every N days"]
 *          [--self-check none|file-newer] [--self-check-arg PATH] [--link URL]
 *   hub-due done <name>        you did it
 *   hub-due drop <name> --yes  delete it, history and all
 *   hub-due check              run the self checks, close what is provably done
 *   hub-due --hub PATH         work on a hub somewhere else
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

// ---------------------------------------------------------------- where is the hub
function readDeviceEnv(name) {
  const f = path.join(os.homedir(), ".hub", "device.env");
  try {
    for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = line.match(new RegExp("^\\s*" + name + "=(.*)$"));
      if (m) return m[1].trim();
    }
  } catch (e) { /* no device.env is normal on a hub somebody made by hand */ }
  return "";
}

// --hub and its value are pulled OUT of the list before anything else looks at it. Left in, the
// very first thing a person types (hub-due --hub /somewhere check) reads "--hub" as the command
// and quietly runs the list instead, which looks like it worked.
const raw = process.argv.slice(2);
const args = [];
let hub = "";
for (let i = 0; i < raw.length; i++) {
  if (raw[i] === "--hub") { hub = raw[i + 1] || ""; i += 1; continue; }
  if (raw[i] === "-h" || raw[i] === "--help") { help(); process.exit(0); }
  args.push(raw[i]);
}
if (!hub) hub = readDeviceEnv("HUB_DIR");
if (!hub) hub = process.env.HUB_DIR || "";
if (!hub) {
  // Walk up from here. Somebody sitting in their own folder should not have to say where it is.
  let d = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(d, "AGENTS.md")) || fs.existsSync(path.join(d, "profile"))) { hub = d; break; }
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
}
if (!hub || !fs.existsSync(hub)) {
  console.log("I could not find your hub folder.");
  console.log("Run this from inside it, or say where it is:  hub-due --hub /path/to/your/hub");
  process.exit(1);
}
const DUE = path.join(hub, "due");
const EXPIRES = path.join(hub, "secrets", "expires.txt");

// ---------------------------------------------------------------- dates
// Everything is YYYY-MM-DD and UTC. A date that means two different days on two of your computers
// is how a monthly job runs twice, or never.
function today() {
  const o = (process.env.HUB_TODAY || "").trim();
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
const RANK = { red: 0, orange: 1, yellow: 2, green: 3, unopened: 4 };
// How many days must pass before the same thing may be mentioned again.
const GAP = { red: 1, orange: 7, yellow: 14, green: 30 };
const WORDS = {
  red: "RUNNING OUT", orange: "SOON", yellow: "ON THE WAY", green: "PLENTY OF TIME",
  unopened: "NOT YET",
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
function parseFile(slug) {
  const p = filePath(slug);
  const text = readText(p);
  if (!text) return null;
  const head = {}, strips = [], log = [], said = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    let m = line.match(/^STRIP:\s*(\S+)\s+(\S+)\s+(\S+)(?:\s+(\S+))?\s*$/);
    if (m) { strips.push({ from: m[1], to: m[2], state: m[3].toLowerCase(), closed: m[4] || "" }); continue; }
    m = line.match(/^-\s*(\d{4}-\d{2}-\d{2})\s+SAID\s+(\S+)\s*$/);
    if (m) { said.push({ date: m[1], channel: m[2] }); log.push(line); continue; }
    if (/^-\s/.test(line)) { log.push(line); continue; }
    m = line.match(/^([A-Z][A-Z0-9-]{1,30}):\s?(.*)$/);
    if (m && !(m[1] in head)) head[m[1]] = m[2].trim();
  }
  return { slug, path: p, head, strips, log, said };
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
  for (const s of o.strips) out.push(["STRIP:", s.from, s.to, s.state, s.closed].filter(Boolean).join(" "));
  out.push("", "## Log", "");
  for (const l of o.log) out.push(l);
  out.push("");
  return out.join("\n");
}
const save = (o) => writeText(o.path, render(o));
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
    const b = bandOf(s.from, s.to, day);
    return b ? { strip: s, band: b, missed: open.filter((x) => x !== s && x.to < day).length } : null;
  }
  let best = null, bestRank = Infinity;
  for (const s of open) {
    const b = bandOf(s.from, s.to, day);
    if (!b) continue;
    const r = RANK[b] * 1000000 + daysBetween(day, s.to) + 50000;
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
      o = { slug, path: filePath(slug), strips: [{ from: day, to: when, state: "open", closed: "" }], log: [], said: [],
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
      cur.state = "done"; cur.closed = day;
      o.strips.push({ from: day, to: when, state: "open", closed: "" });
      logLine(o, day, "closed itself: the date in secrets/expires.txt moved to " + when + ", so you replaced the key");
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
    if (!o || !o.strips.length) continue;
    const rep = repeatOf(o.head["REPEATS"]);
    if (!rep) continue;
    // COUNTED FROM THE FIRST WINDOW, NEVER FROM THE ONE BEFORE. Stepping from the previous one is
    // how a job ending on the 31st gets clamped to the 28th in February and then stays there.
    const anchor = o.strips[0];
    let newest = o.strips[o.strips.length - 1], added = 0;
    while (newest.to < day && added < 240) {
      const k = o.strips.length;
      const step = rep.kind === "months" ? (a) => addMonths(a, rep.n * k) : (a) => addDays(a, rep.n * k);
      const from = step(anchor.from), to = step(anchor.to);
      if (!from || !to || to <= newest.to) break;
      o.strips.push({ from, to, state: "open", closed: "" });
      newest = o.strips[o.strips.length - 1];
      added += 1;
    }
    if (added) {
      logLine(o, day, "the next window opened: " + newest.from + " to " + newest.to);
      save(o);
      notes.push(slug + ": next window " + newest.from + " to " + newest.to);
    }
  }
}
function roll(day) { const notes = []; adoptKeys(day, notes); growWindows(day, notes); return notes; }

function load(day) {
  roll(day);
  const rows = [];
  for (const slug of slugs()) {
    const o = parseFile(slug);
    if (!o) continue;
    const cur = currentWindow(o, day);
    rows.push({
      o, slug, title: o.head["TITLE"] || slug,
      band: cur ? cur.band : "closed",
      strip: cur ? cur.strip : null,
      left: cur ? daysBetween(day, cur.strip.to) + 1 : null,
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

function sentence(r, day) {
  const to = r.strip.to, left = r.left;
  const also = r.missed
    ? " And " + r.missed + " earlier one" + (r.missed === 1 ? "" : "s") + " closed without you saying it was done."
    : "";
  if (r.band === "unopened") {
    const wait = daysBetween(day, r.strip.from);
    return r.title + ": you cannot start yet. It opens on " + r.strip.from + ", in " + wait +
      " day" + (wait === 1 ? "" : "s") + ", and the last day is " + to + ".";
  }
  if (left < 0) return r.title + ": the last day was " + to + ", " + (-left) + " day" + (left === -1 ? "" : "s") + " ago." + also;
  if (left === 0) return r.title + ": the last day was yesterday, " + to + "." + also;
  if (left === 1) return r.title + ": today is the last day, " + to + "." + also;
  return r.title + ": " + left + " days left, and the last one is " + to + "." + also;
}

// ---------------------------------------------------------------- the self checks
// How your hub could tell this was done WITHOUT asking you. Only one is possible without help from
// somebody else's website, and it is the cheapest thing there is: did a file change inside the
// window. `none` is the honest answer for most obligations and it is not second best.
function selfCheck(o, strip) {
  const kind = (o.head["SELF-CHECK"] || "none").trim().toLowerCase();
  if (kind === "file-newer") {
    const rel = (o.head["SELF-CHECK-ARG"] || "").trim();
    if (!rel) return { error: "it says to look at a file but does not say which one" };
    const p = path.isAbsolute(rel) ? rel : path.join(hub, rel);
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
  console.log(`hub-due - the things with a last day, and how loud to be about them

  hub-due                         everything, loudest first
  hub-due today                   at most three, for your morning brief
  hub-due add <name> --title "..." --from YYYY-MM-DD --to YYYY-MM-DD
          --done-when "..." --cost "..."
          [--repeats monthly|yearly|"every N days"]
          [--self-check none|file-newer] [--self-check-arg PATH] [--link URL]
  hub-due done <name>             you did it
  hub-due drop <name> --yes       delete it, history and all
  hub-due check                   run the self checks, close what is provably done
  hub-due --hub PATH              a hub somewhere else

How loud it gets comes from how much of the window is left, and from nothing else: quiet
through the first half, then a quarter, then a tenth, then every day. One rule, whether the
window is a week or a year. Nothing to tune.`);
}

function cmdList(day, capped) {
  const rows = load(day);
  if (!rows.length) {
    console.log("Nothing with a last day yet.");
    console.log("Add one:  hub-due add tax --title \"My tax return\" --from 2027-01-01 --to 2027-07-31 \\");
    console.log("            --done-when \"it is filed\" --cost \"a late fee, and they estimate my income themselves\"");
    return 0;
  }
  const live = rows.filter((r) => r.strip && r.band !== "closed" && r.band !== "unopened");
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
    const fresh = live.filter((r) => {
      if (saidToday.includes(r)) return false;
      const gap = gapFor(r.strip, r.band);
      if (!gap) return false;
      return !r.lastSaid || daysBetween(r.lastSaid, day) >= gap;
    }).slice(0, room);
    show = saidToday.concat(fresh);
    for (const r of fresh) {
      r.o.said.push({ date: day, channel: "brief" });
      logLine(r.o, day, "SAID brief");
      save(r.o);
    }
  }
  if (!show.length) { console.log("Nothing needs saying today."); return 0; }
  for (const r of show) {
    if (!r.strip) { console.log("DONE      " + r.title); continue; }
    console.log(WORDS[r.band].padEnd(15) + sentence(r, day));
    if (!capped) {
      const c = (r.o.head["SELF-CHECK"] || "none").toLowerCase();
      console.log("               " + (c === "none"
        ? "only your word closes this one:  hub-due done " + r.slug
        : "closes itself when " + (r.o.head["SELF-CHECK"] || "")));
    }
  }
  return 0;
}

function cmdAdd(day) {
  const slug = slugify(args[1] || "");
  if (!slug) { console.log("Give it a short name:  hub-due add tax --title ..."); return 1; }
  if (fs.existsSync(filePath(slug))) { console.log("You already have one called " + slug + "."); return 1; }
  const from = argOf("--from", ""), to = argOf("--to", "");
  if (!isDate(from) || !isDate(to)) {
    console.log("This needs BOTH dates: --from (the first day you can do it) and --to (the last day you still can),");
    console.log("each written year first, like 2027-03-14.");
    console.log("");
    console.log("No date, not eligible. Something with no last day is a wish, and this is not a to-do list.");
    return 1;
  }
  if (to < from) { console.log("The last day (" + to + ") is before the first day (" + from + ")."); return 1; }
  const doneWhen = argOf("--done-when", ""), cost = argOf("--cost", "");
  if (!doneWhen || !cost) {
    console.log("It also needs --done-when (what is true when this is finished) and --cost (what it costs you if it slips).");
    console.log("Those two are what let your hub write you a line worth reading instead of a nag.");
    return 1;
  }
  const repeats = argOf("--repeats", "no");
  if (repeatOf(repeats) === undefined) {
    console.log("--repeats must be no, weekly, fortnightly, monthly, quarterly, yearly, or \"every N days\".");
    return 1;
  }
  const sc = (argOf("--self-check", "none") || "none").toLowerCase();
  if (sc !== "none" && sc !== "file-newer") { console.log("--self-check must be none or file-newer."); return 1; }
  const o = { slug, path: filePath(slug), strips: [{ from, to, state: "open", closed: "" }], log: [], said: [],
    head: {
      "TITLE": argOf("--title", slug), "DONE-WHEN": doneWhen, "COST-IF-MISSED": cost,
      "SELF-CHECK": sc, "SELF-CHECK-ARG": argOf("--self-check-arg", ""),
      "REPEATS": repeats, "LINK": argOf("--link", ""), "SOURCE": "you, " + day,
    } };
  logLine(o, day, "created, window " + from + " to " + to);
  if (!save(o)) return 1;
  const b0 = bandOf(from, to, day);
  console.log(b0 === "unopened"
    ? "Made " + slug + ". You cannot start it until " + from + ", and the last day is " + to + "."
    : "Made " + slug + ". Window " + from + " to " + to + ", and today there is " + WORDS[b0].toLowerCase() + ".");
  console.log(sc === "none"
    ? "It cannot tell by itself that you did it, so it waits for your word:  hub-due done " + slug
    : "It closes itself when " + argOf("--self-check-arg", "that file") + " changes inside the window.");
  return 0;
}

function cmdDone(day) {
  const slug = args[1];
  if (!slug) { console.log("Which one?  hub-due done <name>"); return 1; }
  roll(day);
  const o = parseFile(slug);
  if (!o) { console.log("You have nothing called " + slug + ". Type hub-due to see the list."); return 1; }
  const cur = currentWindow(o, day);
  if (!cur) { console.log("Nothing was open on " + slug + "."); return 0; }
  cur.strip.state = "done"; cur.strip.closed = day;
  logLine(o, day, "you said it was done");
  save(o);
  console.log("Closed " + slug + " (" + cur.strip.from + " to " + cur.strip.to + ").");
  if (repeatOf(o.head["REPEATS"])) console.log("It repeats, so the next window opens when this one ends.");
  return 0;
}

function cmdDrop() {
  const slug = args[1];
  if (!slug) { console.log("Which one?  hub-due drop <name> --yes"); return 1; }
  if (!has("--yes")) {
    console.log("Dropping deletes it and everything it remembers. Add --yes if that is what you mean.");
    return 1;
  }
  const p = filePath(slug);
  if (!fs.existsSync(p)) { console.log("You have nothing called " + slug + "."); return 1; }
  try { fs.unlinkSync(p); } catch (e) { console.log("Could not delete it: " + e.message); return 1; }
  console.log("Dropped " + slug + ". It is gone, and nothing will mention it again.");
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
      cur.strip.state = "done"; cur.strip.closed = day;
      logLine(o, day, "closed itself: " + r.why);
      save(o);
      console.log("  closed itself: " + (o.head["TITLE"] || slug) + " (" + r.why + ")");
      closed++;
    }
  }
  const n = slugs().length;
  console.log("Looked at " + n + " thing" + (n === 1 ? "" : "s") + " with a last day. " +
    closed + " closed " + (closed === 1 ? "itself" : "themselves") + ", " + problems + " need a look.");
  return problems ? 1 : 0;
}

const day = today();
const cmd = args[0] && !args[0].startsWith("-") ? args[0] : "";
let rc = 0;
switch (cmd) {
  case "export": {
    // Read only. Neither roll nor a self-check runs while a message is being selected.
    const crypto = require('crypto');
    const rows = slugs().map(slug => {
      const o = parseFile(slug);
      if (!o || !o.strips.length) throw new Error('Unreadable obligation: ' + slug);
      const cur = currentWindow(o, day);
      const strip = cur ? cur.strip : o.strips[o.strips.length - 1];
      const status = cur ? 'open' : (o.strips.every(s => ['done','dropped','closed'].includes(s.state)) ? 'done' : 'unknown');
      return {item_id:'due:' + slug + ':' + strip.from,source:'reader-due',
        revision:crypto.createHash('sha256').update(JSON.stringify([o.head,strip])).digest('hex'),
        status,checked_at:new Date().toISOString(),kind:'task',subject:o.head.TITLE || slug,
        consequence:o.head['COST-IF-MISSED'] || '',
        next_action:cur && ['red','orange'].includes(cur.band) ? o.head['DONE-WHEN'] || '' : '',
        link:/^https:\/\//.test(o.head.LINK || '') ? o.head.LINK : null,deadline:strip.to};
    });
    console.log(JSON.stringify(rows));
    break;
  }
  case "": case "list": rc = cmdList(day, false); break;
  case "today": rc = cmdList(day, true); break;
  case "add": rc = cmdAdd(day); break;
  case "done": rc = cmdDone(day); break;
  case "drop": rc = cmdDrop(); break;
  case "check": rc = cmdCheck(day); break;
  default: console.log("I do not know \"" + cmd + "\"."); help(); rc = 1;
}
process.exit(rc);
