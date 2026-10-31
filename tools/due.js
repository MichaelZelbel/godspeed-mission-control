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
 *   mc-due --godspeed PATH         work on a mission control somewhere else (without it: the one
 *                                  your assistant was started in, else the one you are standing in;
 *                                  see "where is the mission control" below)
 *
 * DONE IS SOMETHING THAT HAPPENED, SO IT LIVES WITH THE THINGS THAT HAPPENED. A reminder's page
 * under notebook/Deadlines/ is the plan: what, the window, what finished means. Whether a window is
 * finished is never written on it. It is a moment on the notebook's timeline that names the
 * reminder, says which window it closes, and carries an `evidence:` line saying what shows it, and
 * every reader works "open" out from those moments. Why: in the mission control this kit comes from, a post was
 * approved and published in a working session and the memory recorded it that day, while the
 * deadline file kept its own "open" word, so the morning brief told its owner for five mornings
 * that the finished work was waiting. Two copies of one fact drift; one copy cannot. An older plan
 * file that still says `done <date>` on a STRIP line keeps working, and the run that takes it in
 * turns that word into a closing moment (its own log line is the evidence).
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
// The old files a reminder lives in - due/<slug>.md and the closing events in world/events/ - are
// read and written in one place since 30 October 2026, because the notebook's copy of them into
// its own records (notebook/core/due-copy.mjs) has to read exactly what this program reads. Plain
// CommonJS and nothing of the notebook at load time: these tools run on Node 20 in the suite.
const {
  createDueFiles, isDate, addDays, daysBetween, addMonths, repeatOf, aimOf, endOf,
  readText, slugify, fileOf, windowWords,
} = require("./due-files.js");

// ---------------------------------------------------------------- where is the mission control
// The order mc-goals, mc-work and mc-forecast use (mc-cards.js), so every command a chat types reads
// and writes the same mission control:
//   1. --godspeed PATH, said out loud
//   2. the mission control your assistant was started in (GODSPEED_ROOT, GODSPEED_WORKSPACE: the
//      notebook sets both for its assistant)
//   3. the mission control you are standing in, or the first one above it
//   4. GODSPEED_DIR
//   5. the mission control this computer was joined to, in ~/.godspeed/device.env, for a job the
//      schedule starts with almost no environment
// Until 9 October 2026 device.env came FIRST. On a computer joined to one mission control, the chat of
// another (it stands in its own folder and the notebook names it in the environment) listed the
// first one's deadlines, and `mc-due add` filed the new one there.
const looksLikeGodspeed = (d) => !!d && ["AGENTS.md", "profile", "rules", "observations"].some((n) => fs.existsSync(path.join(d, n)));
const isFolder = (d) => { try { return !!d && fs.statSync(d).isDirectory(); } catch (e) { return false; } };
function readDeviceEnv(name) {
  const f = path.join(os.homedir(), ".godspeed", "device.env");
  try {
    for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = line.match(new RegExp("^\\s*(?:export\\s+)?" + name + "=(.*)$"));
      if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch (e) { /* no device.env is normal on a mission control somebody made by hand */ }
  return "";
}
function findGodspeed() {
  for (const d of [process.env.GODSPEED_ROOT, process.env.GODSPEED_WORKSPACE]) if (looksLikeGodspeed(d)) return path.resolve(d);
  // Walk up from here. Somebody sitting in their own folder should not have to say where it is.
  let d = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (looksLikeGodspeed(d)) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  for (const d of [process.env.GODSPEED_DIR, readDeviceEnv("GODSPEED_DIR")]) if (isFolder(d)) return path.resolve(d);
  return "";
}

// `store` is the notebook of this mission control when the caller has one open already (the
// notebook runs every obligation command inside its workspace lock); `files: true` asks for the
// old files as the storage instead of the notebook's records, which is what ticket 02's own check
// holds the records against (notebook/core/due-copy.mjs, sameThroughRecords) and what nothing else
// uses. `copy: false` says the caller has already taken in what an older version left in due/.
function createDueCommands({root,commandArgs=process.argv.slice(2),date,copy=true,store:given=null,files:onFiles=false}={}) {
// --godspeed and its value are pulled OUT of the list before anything else looks at it. Left in, the
// very first thing a person types (mc-due --godspeed /somewhere check) reads "--godspeed" as the command
// and quietly runs the list instead, which looks like it worked.
const raw = root ? ['--godspeed',root,...commandArgs] : commandArgs;
const args = [];
let godspeed = "";
for (let i = 0; i < raw.length; i++) {
  if (raw[i] === "--godspeed") { godspeed = raw[i + 1] || ""; i += 1; continue; }
  if (raw[i] === "-h" || raw[i] === "--help") { help(); process.exit(0); }
  args.push(raw[i]);
}
if (!godspeed) godspeed = findGodspeed();
if (!godspeed || !fs.existsSync(godspeed)) {
  console.log("I could not find your mission control folder.");
  console.log("Run this from inside it, or say where it is:  mc-due --godspeed /path/to/your/godspeed");
  process.exit(1);
}
// ---------------------------------------------------------------- where a reminder is kept
//
// A REMINDER AND ITS CLOSING ARE RECORDS IN THE NOTEBOOK (30 October 2026, #90). Until then this
// program kept an obligation as a file due/<slug>.md and its closing as a second file in
// world/events/, and on a mission control that is its own repository the notebook's sync carries
// only notebook/, so neither file travelled unless a session committed it: on 19 October only the
// first of the two was committed, and the morning brief asked its owner for nine mornings about
// something he had finished. Now the reminder is a page under notebook/Deadlines/ and its closing a
// moment under notebook/Timeline/ (notebook/core/due-records.mjs), which the notebook's sync
// carries the way it carries every note.
//
// NOTHING ELSE ABOUT THIS PROGRAM CHANGED. The storage is one object with one surface - slugs,
// parseFile, worldEvents, applyEvents, writeEvent, save - and everything below reads and writes
// through it without knowing which one it is. due-files.js is still the one reader and writer of
// the old files, and it is still the storage when `files: true` says so.
const oldFiles = createDueFiles({ root: godspeed });
// Chosen in `inTheNotebook` below, before any command runs.
let keep = onFiles ? oldFiles : null;
const filePath = (...a) => keep.filePath(...a);
const exists = (...a) => keep.exists(...a);
const slugs = (...a) => keep.slugs(...a);
const parseFile = (...a) => keep.parseFile(...a);
const unreadable = (...a) => keep.unreadable(...a);
const worldEvents = (...a) => keep.worldEvents(...a);
const applyEvents = (...a) => keep.applyEvents(...a);
const writeEvent = (...a) => keep.writeEvent(...a);
const save = (...a) => keep.save(...a);
// The list of when each key runs out stays exactly where it is, and is read as it always was.
const EXPIRES = path.join(godspeed, "secrets", "expires.txt");
// What the old files and the notebook still disagree about, if anything: while they do, nothing in
// due/ is moved aside and the list and the brief say so in one plain sentence (notebook/core/due-retire.mjs).
let OUT_OF_STEP = [];

// ---------------------------------------------------------------- dates
// Everything is YYYY-MM-DD and UTC. A date that means two different days on two of your computers
// is how a monthly job runs twice, or never. The arithmetic itself is in due-files.js.
function today() {
  if(date)return date;
  const o = (process.env.GODSPEED_TODAY || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(o)) return o;
  return new Date().toISOString().slice(0, 10);
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
  unreadable: "NEEDS A LOOK",
};
// What is said about a file that needs a look, in the list, in the brief and in the notebook.
const lookSentence = (r) => fileOf(r) + (r.title !== r.slug ? " (" + r.title + ")" : "") + ": " + r.problem +
  ". Its dates are not being watched until it is fixed.";

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

// AN OLDER FILE THAT STILL SAYS `done <date>` on a window line is turned into a closing by the one
// thing that still reads those files: ticket 02's converter (tools/due-files.js, recordsOf) makes
// the closing a moment on the notebook's timeline, with the file's own log line of that day as the
// evidence, as this program used to make it an event in world/events/. So nothing here has a word
// to move any more: no window of a record ever carries one.

// ---------------------------------------------------------------- add-on deadlines
// AN ADD-ON MAKES A DEADLINE, AND FROM THE MOMENT THE PERSON TOUCHES IT, IT IS THEIRS (23 October
// 2026). A documents add-on reads a letter that says "pay by 20 November" and makes a deadline here,
// through the notebook. It is an ordinary file in due/, so the reminders, the morning brief and the
// deadline list treat it like any other. Three lines say whose it is: ADDON (the add-on's name),
// ADDON-KEY (the add-on's own name for it, e.g. the letter and which request in it) and ADDON-STATE
// (a fingerprint of the title and the windows as the add-on last wrote them). One add-on makes one
// deadline per key, whatever it loses or however often it asks. Once the person changed the title or
// a date, or closed or dropped it, the fingerprint no longer matches, and the add-on can never
// change it again. The fingerprint is made from what the lines say, not how they are laid out, so
// another reader writing the file back in its own shape (another heading, its SAID lines) is no
// change.
const ADDON_NAME = /^[a-z0-9][a-z0-9-]{0,39}$/;
const ADDON_KEY = /^[A-Za-z0-9][A-Za-z0-9._:#/-]{0,119}$/;
function addonState(o) {
  const what = [String(o.head["TITLE"] || "").trim(), o.strips.map((s) => [s.from, s.to || "", s.target || "", s.moved || ""])];
  return require("crypto").createHash("sha256").update(JSON.stringify(what)).digest("hex").slice(0, 16);
}
function addonTouched(o) {
  if (!o || o.problem || o.dropped) return true;
  if (o.strips.some((s) => s.state !== "open")) return true;
  return addonState(o) !== String(o.head["ADDON-STATE"] || "").trim();
}
function addonOf(o) {
  if (!o || !o.head || !String(o.head["ADDON"] || "").trim()) return null;
  const s = o.strips[0] || {};
  return { name: o.head["ADDON"].trim(), key: String(o.head["ADDON-KEY"] || "").trim(), touched: addonTouched(o),
           due: s.to || "", from: s.from || "", link: String(o.head["LINK"] || "").trim() };
}
function findAddon(name, key) {
  for (const slug of slugs()) {
    const o = parseFile(slug);
    if (o && String(o.head["ADDON"] || "").trim() === name && String(o.head["ADDON-KEY"] || "").trim() === key) return o;
  }
  return null;
}
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
    if (!o || !o.strips.length || o.dropped || o.problem) continue;
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
      if ((o.head['CALENDAR-MARKER'] || '').trim()) {
        logLine(o, day, 'the prior calendar entry stays as a record of its window; this window needs its own');
        o.head['CALENDAR-MARKER'] = '';
      }
      applyEvents(o);
      logLine(o, day, "the next window opened: " + windowWords(newest));
      save(o);
      notes.push(slug + ": next window " + windowWords(newest));
    }
  }
}
// ---------------------------------------------------------------- the deadlines text
// Until 30 October 2026 this program also kept a README in the old folder up to date whenever it
// was still exactly a copy the kit once shipped, because an update replaces the program but never
// a file in somebody's mission control. It writes nothing there at all now: a reminder is a page
// in the notebook, and in folder mode - where the mission control is the owner's own Git
// repository - a program that rewrote a tracked file would leave them uncommitted changes they
// never asked for. The words themselves now live in the notebook's own due recipe
// (notebook/reusable-recipes/due/reference/due-room.md, packaged as notebook/recipes/due/...), and
// a copy of that text is kept beside this program as the README constant below, which
// tools/test-due.sh holds against the recipe byte for byte, so the two can never drift apart.

function roll(day) { const notes = []; adoptKeys(day, notes); growWindows(day, notes); return notes; }

function load(day,mutate=true) {
  if(mutate)roll(day);
  const rows = [];
  for (const slug of slugs()) {
    const o = parseFile(slug) || unreadable(slug);
    if (o.problem && !o.dropped) {
      rows.push({ o, slug, title: o.head["TITLE"] || slug, band: "unreadable", strip: null, left: null, missed: 0,
                  lastSaid: null, problem: o.problem });
      continue;
    }
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
  // PAST ITS LAST DAY: TWICE MORE, THREE DAYS APART, THEN QUIET UNTIL YOU ANSWER. A deadline that
  // stayed loud every morning after it passed nagged about work that was often already done and
  // simply not marked, which is the reminder app this replaces (the same rule the mission control
  // this kit comes from has used since 2026-09-24). It stays open and in the full list.
  if (day > r.strip.to) {
    const after = r.o.said.filter((x) => x.date > r.strip.to).map((x) => x.date).sort();
    if (after.length >= 2) return false;
    if (after.length === 1) return daysBetween(after[0], day) >= 3;
    return true;
  }
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
  mc-due done <name> [--evidence "..."]   you did it (written down as a moment on your timeline)
  mc-due drop <name> --yes       call it off; nothing is deleted
  mc-due check                   run the self checks, close what is provably done
  mc-due state [--json]          open or not, for every one, and what closed it
  mc-due --godspeed PATH              a mission control somewhere else

An add-on makes its deadlines through the notebook (add --addon NAME --addon-key KEY, and
addon-update NAME --addon NAME --to/--title). Once you change or close one, it is yours and the
add-on can no longer change it.

Without --godspeed it works on the mission control your assistant was started in, else the one
you are standing in, else GODSPEED_DIR, else the one this computer was joined to.

How loud a deadline gets comes from how much of the window is left, and from nothing else:
quiet through the first half, then a quarter, then a tenth, then every day. One rule, whether
the window is a week or a year. Nothing to tune. A target alone is quiet until its day, says
so that day, asks once after it, then comes back about once a week and never gets louder.`);
}

// What is said while the old files and the notebook are not level yet: one plain sentence, in the
// place a file that needs a look has always had, every morning until it is fixed. Nothing in due/
// is moved aside while it stands (notebook/core/due-retire.mjs).
function sayOutOfStep() {
  if (!OUT_OF_STEP.length) return;
  console.log(WORDS.unreadable.padEnd(15) + "due/ and your notebook do not agree yet, so nothing in due/ has been moved aside: " +
    OUT_OF_STEP[0] + (OUT_OF_STEP.length > 1 ? " (and " + (OUT_OF_STEP.length - 1) + " more)" : "") + ".");
}

function cmdList(day, capped) {
  const rows = load(day);
  sayOutOfStep();
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
    // A file that needs a look is said every morning until it is fixed, after the three, and is
    // never written to: there is no window in it to say anything about.
    show = show.concat(rows.filter((r) => r.problem));
  }
  if (!show.length) { console.log("Nothing needs saying today."); return 0; }
  for (const r of show) {
    if (r.problem) {
      console.log(WORDS.unreadable.padEnd(15) + lookSentence(r));
      if (!capped) console.log("               to fix it, move the file out of due/, then:  mc-due add " + (/^[a-z0-9][a-z0-9-]{0,59}$/.test(r.slug) ? r.slug : "<name>") +
        " --title \"...\" --target YYYY-MM-DD (or --to YYYY-MM-DD) --done-when \"...\"");
      continue;
    }
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
  // Made by an add-on: its name and its own key for it, both or neither. A key it used before is
  // the deadline it already has, never a second one (see "add-on deadlines" above).
  const addon = argOf("--addon", ""), addonKey = argOf("--addon-key", "");
  if (addon || addonKey || has("--addon") || has("--addon-key")) {
    if (!ADDON_NAME.test(addon)) { console.log("--addon is the add-on's name: small letters, digits and dashes, at most 40."); return 1; }
    if (!ADDON_KEY.test(addonKey)) { console.log("--addon-key is the add-on's own name for this deadline: letters, digits and . _ : # / -, no spaces, at most 120."); return 1; }
    const mine = findAddon(addon, addonKey);
    if (mine) { console.log("Kept " + mine.slug + ": " + addon + " made it before."); return 0; }
  }
  // Say how to change the one that exists. A practice run met the bare refusal by adding a second
  // tax return beside the wrong one, which left two things reminding about one date.
  if (exists(slug)) {
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
      "REPEATS": repeats, "LINK": argOf("--link", ""), "SOURCE": (addon ? addon : "you") + ", " + day,
    } };
  if (addon) {
    o.head["ADDON"] = addon;
    o.head["ADDON-KEY"] = addonKey;
    o.head["ADDON-STATE"] = addonState(o);
  }
  logLine(o, day, "created" + (addon ? " by " + addon : "") + ", window " + windowWords(o.strips[0]));
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
  if (o.problem) { console.log("due/" + slug + ".md needs a look: " + o.problem + ". Nothing was changed."); return 1; }
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
  if (o.problem) { console.log("due/" + slug + ".md needs a look: " + o.problem + ". Nothing was changed."); return 1; }
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
  const marker = (o.head["CALENDAR-MARKER"] || "").trim();
  if (marker && old !== what) {
    console.log("CALENDAR: " + (old && old > day ? "take out the entry " : "the past entry stays as a record: ") + marker + "; the new day needs one entry after your approval.");
    o.head["CALENDAR-MARKER"] = "";
  }
  save(o);
  console.log("Moved " + slug + ": you would like it done by " + what + (s.to ? ", and the last day is still " + s.to : "") + ".");
  return 0;
}

// ADDON-UPDATE. The add-on's own deadline, while nobody else touched it: a new last day (a letter's
// date was corrected) and/or a new title. Exit 4 when the person changed or closed it: it is theirs.
function cmdAddonUpdate(day) {
  const slug = args[1], addon = argOf("--addon", ""), to = argOf("--to", ""), title = argOf("--title", "");
  if (!slug || !addon) { console.log("Which one, and whose?  mc-due addon-update <name> --addon <add-on> [--to YYYY-MM-DD] [--title \"...\"]"); return 1; }
  roll(day);
  const o = parseFile(slug);
  if (!o) { console.log("You have nothing called " + slug + "."); return 1; }
  if (String(o.head["ADDON"] || "").trim() !== addon) { console.log(slug + " was not made by " + addon + ", so " + addon + " cannot change it."); return 1; }
  if (addonTouched(o)) { console.log("Left as it is: " + slug + " was changed or closed by you, so it is yours now."); return 4; }
  if (!to && !title) { console.log("Say what changes: --to YYYY-MM-DD, --title \"...\", or both."); return 1; }
  if (to && !isDate(to)) { console.log("Every date is written year first, like 2027-03-14."); return 1; }
  if (title && (/[\r\n]/.test(title) || title.trim().length > 300)) { console.log("Give the title in one line."); return 1; }
  const s = o.strips[0];
  if (to && to !== s.to) {
    const old = s.to;
    s.to = to;
    if (s.from > to) s.from = to;
    logLine(o, day, "moved by " + addon + ": the last day " + (old || "-") + " is now " + to);
  }
  if (title && title.trim() !== String(o.head["TITLE"] || "").trim()) {
    o.head["TITLE"] = title.trim();
    logLine(o, day, "renamed by " + addon);
  }
  o.head["ADDON-STATE"] = addonState(o);
  if (!save(o)) return 1;
  console.log("Updated " + slug + ": " + (o.head["TITLE"] || slug) + ", window " + windowWords(s) + ".");
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
  // A file that needs a look is not rewritten: the event alone calls it off.
  if (!o.problem) { logLine(o, today(), "dropped (" + rel + ")"); save(o); }
  console.log("Dropped " + slug + ". Nothing will mention it again; the file stays as history.");
  return 0;
}

function cmdCheck(day) {
  const notes = roll(day);
  for (const n of notes) notes.length && console.log("  " + n);
  let closed = 0, problems = 0, looks = 0;
  for (const slug of slugs()) {
    const o = parseFile(slug) || unreadable(slug);
    if (o.problem && !o.dropped) { console.log("  due/" + slug + ".md needs a look: " + o.problem + "."); looks++; continue; }
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
  for (const f of keep.unproven) { console.log("  " + f + " says it closes something but not what shows it, so it closes nothing."); problems++; }
  const n = slugs().length;
  console.log("Looked at " + n + " thing" + (n === 1 ? "" : "s") + " with a last day. " +
    closed + " closed " + (closed === 1 ? "itself" : "themselves") + ", " + (problems + looks) + " need a look.");
  // 3 when the only thing wrong is files that need a look: they are said in the list, the morning
  // and the notebook, so whatever runs the check before its reminders carries on and says them.
  return problems ? 1 : looks ? 3 : 0;
}

function stateRows(day=today(),mutate=false) {
  return load(day,mutate).map((r) => {
    // Never closed and never open: nothing about it can be known until it is fixed.
    // A deadline an add-on made says whose it is, its key, and whether the person touched it.
    const addon = addonOf(r.o);
    if (r.problem) return { slug: r.slug, title: r.title, band: r.band, attention: true, sentence: lookSentence(r),
      state: "needs-a-look", problem: r.problem, file: fileOf(r), firstDay: "", lastDay: "", doneWhen: "", closedOn: "",
      closedBy: "", selfCheck: "none", ...(addon ? { addon } : {}) };
    const last = r.o.strips.filter((s) => s.state !== "open").sort((a, b) => (a.closed < b.closed ? -1 : 1)).pop();
    return {
      slug: r.slug, title: r.title, band:r.band, attention:!!r.strip&&sayable(r,day), sentence:r.strip?sentence(r,day):null, state: r.band === "unopened" ? "unopened" : r.strip ? "open" : r.band,
      firstDay: r.strip ? r.strip.from : "", lastDay: r.strip ? r.strip.to : "",
      ...(r.strip && aimOf(r.strip) ? { targetDay: aimOf(r.strip) } : {}),
      doneWhen: (r.o.head["DONE-WHEN"] || "").trim(), closedOn: last ? last.closed : "", closedBy: last ? last.by : "",
      // Anything but "none" closes itself in `mc-due check`, so the stop check never guesses at it.
      selfCheck: (r.o.head["SELF-CHECK"] || "").trim().toLowerCase() || "none",
      ...(addon ? { addon } : {}),
    };
  });
  }
function cmdState(day) {
  const rows=stateRows(day,true);
  if (has("--json")) { console.log(JSON.stringify(rows)); return 0; }
  for (const r of rows) console.log((r.state.toUpperCase() + " ").padEnd(9) + r.slug + (r.closedBy && r.state !== "open" ? "  (" + r.closedBy + ")" : "") + (r.problem ? "  (" + r.problem + ")" : ""));
  return 0;
}

// readme:begin (a copy of notebook/recipes/due/reference/due-room.md; tools/test-due.sh checks it byte for byte)
const README = "# Deadlines - the things with a day\n\n**You start with none of these, and none of them costs you anything.** Your mission control keeps\nits first one the moment you tell it about something with a day attached: a day you would like it\ndone by, or a last day before it costs you. If you never do, there is nothing to keep and you have\nlost nothing.\n\n## Why this is not a reminder\n\nA calendar reminder fires on a date and knows nothing else. It cannot tell whether you already did\nthe thing, so it goes off afterwards, and after that happens a few times you stop reading\nreminders. Then one of them stops on its last occurrence whether or not the job got done, and that\nis the one that mattered.\n\nEverything below is built to fix both halves of that.\n\n## Three dates, and you usually need only one\n\nEvery one of these can carry up to three dates:\n\n- **The day you can start.** Optional. If you leave it out, it is the day you add the thing.\n- **The day you would like it done.** A target, soft, like a date in a calendar. Missing it costs\n  you nothing.\n- **The day it starts costing you.** A deadline, hard: after it there is a fee, a fine, a lost\n  chance.\n\nIt needs at least a target or a deadline. Many people only ever need the target.\n\n| What it has | What your mission control does |\n|---|---|\n| **A deadline only** | The window below: quiet at first, louder as the last day comes. After the last day your brief mentions it twice more, three days apart, then waits for your word; it stays open until you close it or drop it. |\n| **A target only** | Nothing until that day. One mention on the day. Once it has passed it never gets louder: the next morning it asks you once, \"A new date, or as soon as you can?\" A new date becomes the new target. \"As soon as you can\", or no answer at all, keeps it open with a gentle line in your brief about once a week, until you finish it or drop it. |\n| **Both** (a tax return: aim for the end of January, must by the end of February) | The deadline's window, plus one mention on the target day. After the target it says you are past it and names the deadline. It does not ask for a new date, because the deadline decides. |\n| **Repeating** | A new window each time. The target sits at the same place inside every window. |\n\nIn your morning's three places, a target you have passed comes after every deadline, and it never\ngets louder than that one line. It is a wish you gave yourself, not a bill.\n\n## The window, for a deadline\n\nA deadline holds **the first day you can do the thing, and the last day you still can.** Not a due\ndate. A window.\n\nHow loud your mission control gets follows how much of the window is left, as a fraction:\n\n| Left of the window | Your mission control |\n|---|---|\n| more than half | says it once when the window opens, then at most monthly |\n| half to a quarter | a line in your brief about every fortnight |\n| a quarter to a tenth | its own line, near the top, about weekly |\n| the loud days at the end: a tenth of the window, never fewer than three days and never more than fourteen | every morning |\n\n**One rule, whether the window is a week or a year.** That is the whole reason you can have a\nhundred of these. There is nothing to tune per item, and if a thing feels like it needs its own\nsetting, the window is wrong rather than the rule. A target adds no setting either: every target\nbehaves the same way.\n\n## Where one lives, and what it looks like\n\n**Each one is a page in your notebook**, under `Deadlines/`, named after its own title:\n\n```\nDeadlines/Car service before the warranty runs out.md\n\n---\ntitle: Car service before the warranty runs out\ndone_when: The car has been serviced at a garage the warranty accepts.\ncost_if_missed: The warranty ends. A gearbox after that is mine to pay for.\nself_check: none\nrepeats: yearly\nlink: https://example.com/book-a-service\nsource: me, 2026-08-29\nwindows:\n  - start: 2026-09-01\n    deadline: 2027-02-28\n---\n- 2026-08-29 created, window 2026-09-01 to 2027-02-28\n```\n\nThe page carries a few more lines your notebook keeps for every page of every kind: when it was\nmade, when it last changed, and the name by which all your computers know it is this same page.\n\nA target is one more line in the window, and a window may carry `target`, `moved` and an\n`extra` list as well, each left empty when it has nothing to say. A present to buy before a\nbirthday, with no deadline at all, has `start: 2026-04-20`, `target: 2026-05-10` and an empty\n`deadline:`: from the 20th of April, aiming for the 10th of May, and no last day. With both, the\nwindow carries a start, a deadline and a target together. When you give a new day after missing\none, it is written beside the old one as `moved: 2027-02-10`.\n\nPlain Markdown. Read it, edit it in Obsidian or any editor, and the next command reads what you\nwrote. Your notebook carries it to your other computers the way it carries every note, so one you\nadd on one computer is there on the next, with nobody running Git.\n\n**A repeating thing is ONE page that grows a new window each time**, never one page per occurrence.\nThat is what keeps a hundred of these at a hundred pages instead of thousands.\n\n## The four questions, asked once\n\nWhen you add one, answer four things and never be asked again:\n\n1. What is true when this is finished?\n2. Is there a day after which this costs you something, or is it a day you would like to have it\n   done by? (Or both. And if you cannot start yet, from when.)\n3. What does it cost you if it slips? Only asked when there is a deadline: a target costs nothing.\n4. **How could your mission control tell you did it, without asking you?**\n\nThe fourth is the one that matters and the one everybody skips. Some things can answer it. A key is\nreplaced when the date in `secrets/expires.txt` moves. A backup happened if the file is newer than\nthe window. Those close themselves and never nag you again after you act, which is exactly the\nfailure that kills every reminder app.\n\nMost things cannot answer it, and **that is a fine answer**. Nobody can tell your mission control that you\nsubmitted a timesheet into somebody else's website. Those say so and wait for you to say the word.\nAsk the question anyway, every time, because knowing which kind a thing is changes what you build\naround it.\n\n## No date, not eligible\n\n`mc-due add` refuses anything that has neither a target nor a deadline, in those words. That\nrefusal is the only thing between these and a to-do app you stop maintaining. \"Someday\" is\nnot a target; \"by the 10th of May\" is.\n\n## Three states, and only three\n\n**open, done, dropped.** Done can happen by itself when there is a self check. **Dropped only ever\ncomes from you**, which is why the command makes you type `--yes`.\n\n**Done is never written on the page.** The page is the plan. When a thing is finished, that is\nsomething that happened, so it goes where the things that happened go: a moment on your notebook's\ntimeline, `Timeline/<the day> Done: <its title>`, which names the reminder and carries, on an\n`evidence:` line, what shows it (your words, a receipt, a commit). A drop is the same moment with\n\"Dropped\". Everything that asks \"is this still open\" works it out from those moments, so there is\nonly one place the answer can live and nothing can disagree with it. Why: in the mission control\nthis kit comes from, a post was approved and published in a working session, the memory wrote that\ndown the same day, and the plan kept saying open, so the morning brief told its owner for five\nmornings that the finished work was waiting. `mc-due done` and `mc-due drop` write the moment for\nyou, and when your assistant finishes one of these with you in a session it closes it before the\nsession ends.\n\nA closing is a moment like any other, so it travels with your notebook. Close one on the computer\nin your kitchen and the computer in your office knows it the next time the two talk, with nothing\nto save by hand and nothing for you to settle if you closed the same one on both.\n\nSomething whose window closed without being done **stays open**. Nothing tidies it away, because\nfor a deadline \"nobody got to it\" is the failure, not a quiet success. It does stop shouting:\nyour brief mentions it twice more, three days apart, and then waits for your word, because the\nlikeliest reason is that you did it and forgot to say so. The full list keeps showing it.\n\n## Your keys are already among them\n\nIf you have `secrets/expires.txt`, the list of when each key runs out, `mc-due` reads it and treats each key as one of\nthese. You never write a date in two places, and there is one thing nagging you rather than two\nthat disagree. Moving the date in that file is still the off switch, and it is now also the proof:\nmoving it forward is what replacing a key looks like from outside, so the reminder closes itself.\n\n## You do not need a calendar\n\nNot for any of this. If you do have one, your assistant can add **one entry per thing**, and one is\nthe whole rule. For a deadline it goes on the day your mission control starts being loud, not on the day the thing dies, and\nthe death date goes in the title so the single entry says both. For a target it goes on the target\nday, and a thing with both gets the target-day entry with the deadline in its title. Never two\nentries about one date: the day they disagree with each other you stop believing either.\n\nIt comes out again when you finish, as long as the day has not passed yet. That is the part that\nmakes one entry safe, because otherwise an entry you already acted on sits there being wrong. A day\nthat has already gone by is left alone: it is a record of what happened.\n\nYou can also go the other way and add one from your phone, by writing an event that says\n`mission control: from 1 Feb`. **The calendar never decides when you get nagged and never knows whether you\nacted.**\n\n## The commands\n\n```\nmc-due                     everything, loudest first\nmc-due today               at most three, which is what your morning brief reads\nmc-due add <name> ...      make one: --target, --to (the deadline), or both\nmc-due target <name> D     a new day you would like it done (or: asap, as soon as you can)\nmc-due done <name>         you did it (a moment on your notebook's timeline says so)\nmc-due drop <name> --yes   call it off; nothing is deleted\nmc-due check               run the self checks, close what is provably done\nmc-due state               which are open, and what closed the others\n```\n\nThe card is `procedures/what-runs-out-and-when.md` in the kit. The guide: https://godspeedmissioncontrol.com/guide/deadlines\n";
// readme:end

function entryDay(strip) {
  const target = aimOf(strip);if (target) return target;
  if (!isDate(strip.from) || !isDate(strip.to)) return null;
  return addDays(strip.to, -(loudDays(daysBetween(strip.from, strip.to) + 1) - 1));
}
function cmdMarker(day) {
 const slug=args[1];
 if(slug==='--needed'){
  for(const row of load(day,false)){
   if(!row.strip||(row.o.head['CALENDAR-MARKER']||'').trim())continue;
   const date=entryDay(row.strip);if(!date)continue;
   console.log([row.slug,date,row.strip.to||'-',row.o.head.LINK||'-',row.o.head.TITLE||row.slug,...(aimOf(row.strip)?[aimOf(row.strip)]:[])].join('\t'));
  }return 0;
 }
 if(slug==='--stale'){
  for(const name of slugs()){
   const plan=parseFile(name),id=(plan?.head['CALENDAR-MARKER']||'').trim();
   if(!id||currentWindow(plan,day))continue;
   const last=plan.strips.at(-1),date=last&&entryDay(last);
   if(date&&date>day)console.log([name,id,date].join('\t'));
  }return 0;
 }
 const plan=parseFile(slug);if(!plan){console.log('No obligation with that slug.');return 1;}
 if(plan.problem){console.log('due/'+slug+'.md needs a look: '+plan.problem+'. Nothing was changed.');return 1;}
 const id=has('--clear')?'':argOf('--set','');
 if(!has('--clear')&&(!id||/[\r\n\t]/.test(id))){console.log('Calendar event identity must be a single line.');return 1;}
 plan.head['CALENDAR-MARKER']=id;if(!save(plan))return 1;
 console.log('Marker for '+slug+' is now: '+(id||'(none)'));return 0;
}
function run() {
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
  case "marker": rc = cmdMarker(day); break;
  case "addon-update": rc = cmdAddonUpdate(day); break;
  // The notebook's due recipe tells the assistant `mc-due help` shows the installed contract.
  case "help": help(); break;
  default: console.log("I do not know \"" + cmd + "\"."); help(); rc = 1;
}
return rc;
}
function recordSaid(selected,day=today()) {for(const r of load(day,false).filter(r=>selected.includes(r.slug)&&!r.problem)){if(r.o.said.some(x=>x.date===day&&x.channel==='brief'))continue;r.o.said.push({date:day,channel:'brief'});logLine(r.o,day,'SAID brief');save(r.o);}}

// ---------------------------------------------------------------- the notebook is where this is kept
//
// A REMINDER AND ITS CLOSING ARE RECORDS IN THE NOTEBOOK (30 October 2026, #90). Every command
// below runs inside `inTheNotebook`: the notebook is opened, what an older version of this program
// left in due/ is taken in FIRST (notebook/core/due-copy.mjs, so a computer still on the old
// version can never be lost), the workspace lock is held once for the whole command, and the old
// files are then retired where that is safe (notebook/core/due-retire.mjs).
//
// WHY THE LOCK IS TAKEN HERE AND NOT AROUND THIS PROGRAM. The lock is one writer at a time and is
// never re-entered, so the notebook, which runs these commands inside its own lock, hands its open
// store down (`store`) and this program works under the lock it already holds.
//
// THE BRIDGE, AND WHY IT IS THIS ONE: the notebook's store is an ES module and this is CommonJS.
// `require` of an ES module is on by default from Node 20.19 and from 22.12, and nothing in
// notebook/core waits at the top level, so the tools keep running on the Node the product's suite
// uses for them (20). A copy of this program with no notebook beside it cannot keep a reminder at
// all and says so in one plain sentence rather than pretending.
//
// WHERE THAT CODE IS, when this program is not standing in the kit. The installer copies every
// file in tools/ into the assistant's command folder as well, and there is no notebook folder
// beside it there (found in review, 30 October 2026). The mission control itself says where its
// installed version is: a computer keeps each one in
// <root>/.godspeed/integrated-runtime/versions/<commit>, and the start.mjs beside them names the
// one it runs (notebook/scripts/install-native-notebook.sh). The kit's own notebook comes first, so
// a developer's checkout and the Windows kit need nothing of this.
//
// AND THE KIT ITSELF, WHEREVER IT STANDS (#112, 31 October 2026). An install with no integrated
// notebook has neither of the two places above: the Docker image - what a Hostinger reader and the
// one-line server installer give you - installs no notebook, and the copied tools have none beside
// them. For two weeks 2.0.0-beta.12 therefore left that whole edition with no reminders at all.
// But the kit is there: the image carries the repository it was built from at /opt/godspeed/kit and
// names it in KB_KIT_DIR, and the installer puts the kit in KB_KIT_DIR or else $HOME/teach-it-once-kit
// (server/install.sh). So the kit is the last place looked at, named the way the installer names it.
// NOTHING IS COPIED AND NOTHING IS INSTALLED TWICE: the kit on that edition is the very commit the
// tools came from, and a notebook/core only works with the kit's own tools/ above it anyway
// (notebook/core/due-copy.mjs requires ../../tools/due-files.js), which is why a copy of the
// notebook code beside the copied tools would be half a kit that can drift.
// THE KIT COMES LAST on purpose: an install that has a notebook keeps using exactly the notebook it
// runs, as it did before this, and only a copy that would otherwise refuse ever reaches the kit.
// A place counts only when due-records.mjs is in it, so a wrong KB_KIT_DIR is passed over and a
// copy with the code nowhere still says so in one plain sentence.
function notebookCore() {
  const tries = [path.join(__dirname, "..", "notebook", "core")];
  const state = path.join(godspeed, ".godspeed", "integrated-runtime");
  const under = (name) => path.join(state, "versions", name, "notebook", "core");
  const running = readText(path.join(state, "start.mjs")).match(/versions[/\\]+([0-9a-f]{40})/);
  if (running) tries.push(under(running[1]));
  try {
    const versions = fs.readdirSync(state + path.sep + "versions", { withFileTypes: true })
      .filter((e) => e.isDirectory() && /^[0-9a-f]{40}$/.test(e.name)).map((e) => under(e.name))
      .filter((d) => fs.existsSync(path.join(d, "due-records.mjs")))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
    tries.push(...versions);
  } catch (e) { /* no installed version beside the mission control: nothing more to try */ }
  // The kit, named as the installer names it: KB_KIT_DIR (the image sets it), else the folder the
  // installer uses when nothing names another. GODSPEED_KIT_DIR is this program's own name for it,
  // for an install that keeps the kit somewhere else.
  const home = process.env.HOME || process.env.USERPROFILE || "";
  for (const kit of [process.env.GODSPEED_KIT_DIR, process.env.KB_KIT_DIR,
                     home && path.join(home, "teach-it-once-kit")]) {
    const named = (kit || "").trim();
    if (named) tries.push(path.join(named, "notebook", "core"));
  }
  for (const dir of tries) if (fs.existsSync(path.join(dir, "due-records.mjs"))) return dir;
  return "";
}
const say = () => (process.env.GODSPEED_DUE_COPY || "").trim();
function inTheNotebook(work, writes) {
  const dir = notebookCore();
  if (!dir) {
    console.log("I could not find the notebook that keeps your reminders, so I did not read or change anything.");
    console.log("Your reminders are pages in notebook/Deadlines/. Run this through your mission control (godspeed due ...).");
    return { rc: 1 };
  }
  const { createDueRecords } = require(path.join(dir, "due-records.mjs"));
  const { copyIfFilesChanged, writable } = require(path.join(dir, "due-copy.mjs"));
  const { retireOldFiles } = require(path.join(dir, "due-retire.mjs"));
  const store = given || new (require(path.join(dir, "records", "store.mjs")).Store)(godspeed);
  // A staged view of a transaction and the read-only copy a backup looks at are only read, and
  // neither may be locked at all (records/store.mjs, Store.inspect).
  const mayWrite = writable(store) && copy !== false;
  // A screen is waiting for a list, so it waits only a moment for the lock; a command that is
  // changing something waits as long as any other writer does.
  const timeoutMs = writes ? 30000 : 2000;
  const underLock = (fn) => store.holding ? fn() : store.withLockSoon(fn, { timeoutMs });
  let report = { unproven: [] };
  // Ticket 02 first, every run: a file an older version on another machine wrote is a reminder here
  // before anything is read. It costs nothing when no file in due/ or world/events/ has changed.
  // Then what is left of the old files, once ticket 02's check agrees for the whole set; a
  // difference moves nothing and is said with the reminders, which is why this comes before the
  // answer. Neither is ever the reason an answer fails: work left undone is done by the next run,
  // which is safe because both are the same twice over.
  if (mayWrite) try {
    underLock(() => {
      report = copyIfFilesChanged(godspeed, { day: today(), store }) || report;
      const retired = retireOldFiles(store, { day: today() });
      OUT_OF_STEP = retired.differences || [];
      if (say() === "say") console.error("due-retire: " + JSON.stringify(retired));
    });
  } catch (e) { if (say() === "say") console.error("due-copy: not this time: " + e.message); }
  keep = createDueRecords({ store, files: oldFiles, unproven: report.unproven || [] });
  // ONLY A COMMAND THAT CHANGES SOMETHING TAKES THE LOCK. Reading needs none, and a list that took
  // the one writer lock would be refused on a workspace somebody else is writing this moment - and
  // the 08:00 reminders, the morning brief, Settings and the cards are all reads.
  return writes && mayWrite ? underLock(() => ({ rc: work() })) : { rc: work() };
}
// The old files as the storage, for ticket 02's own check and for nothing else.
const onTheFiles = (work) => { keep = oldFiles; return { rc: work() }; };
const through = onFiles ? onTheFiles : inTheNotebook;
return {
  run: () => through(run, true).rc,
  // stateRows() with nothing to roll is a read, and every screen reads it that way.
  stateRows: (...a) => { let rows = []; through(() => { rows = stateRows(...a); }, !!a[1]); return rows; },
  recordSaid: (...a) => { let done; through(() => { done = recordSaid(...a); }, true); return done; },
};
}
module.exports={createDueCommands};
if(require.main===module)process.exit(createDueCommands().run());