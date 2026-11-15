#!/usr/bin/env node
/*
 * promises.js - did your mission control keep the promises it made you on a clock?
 *
 * One file per promise in work/promises/ (the format is in work/promises/README.md of your mission
 * control). For each one it works out when the promise was last due, looks for the proof the work
 * leaves behind, and gives it one state: kept, due now, missed, never run or not yet due. A file it
 * cannot read is reported as such, never skipped.
 *
 * WHY IT EXISTS. An assistant that says "I'll send you this every Sunday" has made a promise that
 * nothing checks. The first Sunday passes in silence and nobody notices, because a quiet job and a
 * job that never ran look the same from outside. So a promise is a file, and every morning this
 * reads every one: a missed one is said at the top of `mc-due today` and of the morning brief.
 *
 * IT ONLY READS. It never writes, moves or touches a file, and it never moves a missed date: a
 * promise stays missed every morning until a later one is kept.
 *
 *   node promises.js [--godspeed DIR] [--now ISO] [--json]
 *       one line per promise; exit 1 when one is missed, never run or cannot be read
 */
"use strict";
const fs = require("fs");
const path = require("path");

const FOLDER = path.join("work", "promises");
const WEEKDAYS = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const REQUIRED = ["PROMISE", "WHAT YOU GET", "CADENCE", "DUE", "STARTED", "RUNS IT", "PROOF"];
const KNOWN = REQUIRED.concat(["PROMISED ON", "YOUR WORDS", "GRACE", "ROUTINE"]);
const DATE = /\b(\d{4}-\d\d-\d\d)\b/g;
const SKIP = new Set([".git", "node_modules", ".godspeed"]);

// ---- reading a promise ----------------------------------------------------------------------
function zoneOk(tz) {
  if (/^utc$/i.test(tz)) return true;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch (_) { return false; }
}
function realDay(s) {
  if (!/^\d{4}-\d\d-\d\d$/.test(s)) return false;
  const d = new Date(s + "T00:00:00Z");
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}
function inside(rel) {
  return !!rel && !path.isAbsolute(rel) && !/^[A-Za-z]:/.test(rel) && !/^[\\/]/.test(rel) && !rel.split(/[\\/]/).includes("..");
}

function parsePromise(text) {
  const fields = {};
  for (const line of String(text).split(/\r?\n/)) {
    if (/^##\s/.test(line)) break; // the log below the header is the person's, never a field
    const m = line.match(/^([A-Z][A-Z ]*?):\s*(.*)$/);
    if (m && KNOWN.includes(m[1]) && !(m[1] in fields)) fields[m[1]] = m[2].trim();
  }
  const errors = [];
  for (const k of REQUIRED) if (!fields[k]) errors.push("no " + k);
  const cadence = fields.CADENCE || "";
  if (fields.CADENCE && !["daily", "weekly", "monthly"].includes(cadence)) errors.push("CADENCE must be daily, weekly or monthly");
  if (fields.DUE) {
    const [when, hhmm, zone, extra] = fields.DUE.split(/\s+/);
    const kind = when === "daily" ? "daily" : when in WEEKDAYS ? "weekly" : /^([1-9]|1\d|2[0-8])$/.test(when || "") ? "monthly" : null;
    if (!kind || !/^([01]\d|2[0-3]):[0-5]\d$/.test(hhmm || "") || !zone || extra !== undefined) {
      errors.push("DUE must read daily HH:MM <zone>, <weekday> HH:MM <zone> or <1-28> HH:MM <zone>");
    } else if (!zoneOk(zone)) errors.push("the time zone " + zone + " is not known");
    else if (kind !== cadence && ["daily", "weekly", "monthly"].includes(cadence)) errors.push("DUE and CADENCE disagree");
  }
  if (fields.STARTED && !realDay(fields.STARTED)) errors.push("STARTED must be a date written YYYY-MM-DD");
  if (fields.GRACE !== undefined && !/^\d+(\.\d+)?$/.test(fields.GRACE)) errors.push("GRACE must be a number of hours");
  if (fields.PROOF) {
    const [kind, ...rest] = fields.PROOF.split(/\s+/);
    const where = rest.join(" ").trim();
    if (!["files", "dates-in"].includes(kind) || !where) errors.push("PROOF must read files <pattern> or dates-in <file>");
    else if (!inside(where)) errors.push("PROOF must name a place inside your mission control");
  }
  return { fields, errors };
}

// ---- time: the due moments, in the promise's own time zone -------------------------------------
function parts(date, tz) { // wall-clock parts of an instant in a zone
  const o = {};
  for (const p of new Intl.DateTimeFormat("en-US", { timeZone: /^utc$/i.test(tz) ? "UTC" : tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(date)) o[p.type] = p.value;
  return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour, mi: +o.minute };
}
function instant(y, mo, d, h, mi, tz) { // the instant of a wall-clock time in a zone
  let t = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 3; i++) { // two corrections settle any zone offset, summer time included
    const p = parts(new Date(t), tz);
    t += Date.UTC(y, mo - 1, d, h, mi) - Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi);
  }
  return new Date(t);
}
// A calendar day is a UTC midnight Date; only its y-m-d is ever read.
const dayOf = (y, mo, d) => new Date(Date.UTC(y, mo - 1, d));
const ymd = (day) => day.toISOString().slice(0, 10);
const addDays = (day, n) => new Date(day.getTime() + n * 86400000);
function monthDay(day, months, n) { return dayOf(day.getUTCFullYear(), day.getUTCMonth() + 1 + months, n); }

function schedule(fields) {
  const [when, hhmm, zone] = fields.DUE.split(/\s+/);
  const [h, mi] = hhmm.split(":").map(Number);
  return { when, h, mi, zone, label: hhmm + " " + zone };
}
// The slot on or before a calendar day, and the one before a slot.
function slotOnOrBefore(s, day) {
  if (s.when === "daily") return day;
  if (s.when in WEEKDAYS) return addDays(day, -((day.getUTCDay() - WEEKDAYS[s.when] + 7) % 7));
  const n = Number(s.when);
  return day.getUTCDate() >= n ? monthDay(day, 0, n) : monthDay(day, -1, n);
}
function slotBefore(s, slot) {
  if (s.when === "daily") return addDays(slot, -1);
  if (s.when in WEEKDAYS) return addDays(slot, -7);
  return monthDay(slot, -1, Number(s.when));
}
function firstSlotFrom(s, day) {
  const slot = slotOnOrBefore(s, day);
  if (ymd(slot) === ymd(day)) return slot;
  if (s.when === "daily") return day;
  if (s.when in WEEKDAYS) return addDays(slot, 7);
  return monthDay(slot, 1, Number(s.when));
}
const at = (s, day) => instant(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), s.h, s.mi, s.zone);

// ---- proof: the newest date the work left behind ------------------------------------------------
function globToRe(g) {
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*") {
      if (g[i + 1] === "*") { i++; if (g[i + 1] === "/") { i++; re += "(?:.*/)?"; } else re += ".*"; } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp("^" + re + "$");
}
function walk(dir, base, out) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return out; }
  for (const e of entries) {
    if (SKIP.has(e.name)) continue;
    const rel = base ? base + "/" + e.name : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), rel, out); else out.push(rel);
  }
  return out;
}
function matching(root, pattern) {
  const pat = pattern.replace(/\\/g, "/");
  if (!/[*?]/.test(pat)) return fs.existsSync(path.join(root, pat)) ? [pat] : [];
  const fixed = [];
  for (const s of pat.split("/")) { if (/[*?]/.test(s)) break; fixed.push(s); }
  const start = fixed.join("/");
  const re = globToRe(pat);
  return walk(start ? path.join(root, start) : root, start, []).filter((rel) => re.test(rel));
}
function proofDate(root, fields, today) {
  const [kind, ...rest] = fields.PROOF.split(/\s+/);
  const where = rest.join(" ").trim();
  let dates = [];
  if (kind === "files") {
    for (const rel of matching(root, where)) {
      // The date in the file's own name, else in one of its folders.
      const found = path.posix.basename(rel).match(DATE) || rel.match(DATE);
      if (found) dates.push(found[0]);
    }
  } else {
    try { dates = fs.readFileSync(path.join(root, where), "utf8").match(DATE) || []; } catch (_) { dates = []; }
  }
  // A file may name a day still to come; that is not proof of anything done.
  dates = dates.filter((d) => realDay(d) && d <= today).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

// ---- the state of one promise -----------------------------------------------------------------
function judge(root, fields, now) {
  const s = schedule(fields);
  const local = parts(now, s.zone);
  const today = ymd(dayOf(local.y, local.mo, local.d));
  let d0 = slotOnOrBefore(s, dayOf(local.y, local.mo, local.d));
  if (at(s, d0) > now) d0 = slotBefore(s, d0);
  const d1 = slotBefore(s, d0);
  const started = fields.STARTED;
  const grace = Number(fields.GRACE || 12) * 3600000;
  const proof = proofDate(root, fields, today);
  const first = ymd(firstSlotFrom(s, new Date(started + "T00:00:00Z")));
  const base = { lastKept: proof, firstDue: first };
  if (ymd(d0) < started) return { ...base, state: "not yet due", due: first + " " + s.label };
  if (proof && proof >= ymd(d0)) return { ...base, state: "kept", due: ymd(d0) + " " + s.label };
  // The brief runs inside its own slot's grace, so the slot before it is judged then: yesterday's
  // missed morning is said this morning, not shown as "due now" and forgotten.
  const inGrace = now < new Date(at(s, d0).getTime() + grace);
  if (inGrace && (ymd(d1) < started || (proof && proof >= ymd(d1)))) return { ...base, state: "due now", due: ymd(d0) + " " + s.label };
  const judged = inGrace ? d1 : d0;
  return { ...base, state: proof ? "missed" : "never run", due: ymd(judged) + " " + s.label };
}

function checkPromises(root, { now = new Date() } = {}) {
  const dir = path.join(root, FOLDER);
  const result = { promises: [], unreadable: [] };
  if (!fs.existsSync(dir)) return result;
  const names = fs.readdirSync(dir).filter((n) => n.endsWith(".md") && n !== "README.md").sort();
  for (const file of names) {
    try {
      const full = path.join(dir, file);
      if (!fs.statSync(full).isFile()) { result.unreadable.push({ file, why: "it is a folder, not a file" }); continue; }
      const { fields, errors } = parsePromise(fs.readFileSync(full, "utf8"));
      if (errors.length) { result.unreadable.push({ file, why: errors.join("; ") }); continue; }
      result.promises.push({ file, name: fields.PROMISE, what: fields["WHAT YOU GET"], ...judge(root, fields, now) });
    } catch (_) {
      result.unreadable.push({ file, why: "it could not be read" });
    }
  }
  return result;
}

// ---- what a person reads ----------------------------------------------------------------------
function plainWhat(what) {
  return String(what).replace(/\s*\u2014\s*/g, ", ").trim().slice(0, 140).trim().replace(/[.\s]+$/, "");
}
// Each line with its fallback, the same line without the promise's own words, for a brief whose
// writing rules those words break.
function promiseSayings(result) {
  const out = [];
  for (const p of result.promises.filter((x) => x.state === "missed")) {
    out.push({ line: "A promise was not kept: " + plainWhat(p.what) + ". Last kept " + p.lastKept + ".",
      fallback: "A promise was not kept. Last kept " + p.lastKept + "." });
  }
  for (const p of result.promises.filter((x) => x.state === "never run")) {
    out.push({ line: "A promise has never been kept: " + plainWhat(p.what) + ". It was first due " + p.firstDue + ".",
      fallback: "A promise has never been kept. It was first due " + p.firstDue + "." });
  }
  for (const u of result.unreadable) {
    out.push({ line: "A promise file cannot be read: " + u.file + " (" + u.why + ").", fallback: "A promise file cannot be read." });
  }
  return out;
}
const promiseLines = (result) => promiseSayings(result).map((s) => s.line);

function main(argv) {
  let root = process.env.GODSPEED_ROOT || process.cwd();
  let now = new Date();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--godspeed") root = argv[++i] || "";
    else if (argv[i] === "--now") now = new Date(argv[++i]);
  }
  if (isNaN(now)) { console.log("--now must be a moment such as 2026-11-08T09:00:00Z."); return 2; }
  const result = checkPromises(root, { now });
  if (argv.includes("--json")) console.log(JSON.stringify(result, null, 1));
  else {
    if (!result.promises.length && !result.unreadable.length) console.log("No promises written down yet (" + FOLDER.replace(/\\/g, "/") + "/).");
    for (const p of result.promises) console.log(p.state.padEnd(12) + " " + p.name + "  due " + p.due + ", last kept " + (p.lastKept || "never"));
    for (const u of result.unreadable) console.log("cannot read".padEnd(12) + " " + u.file + ": " + u.why);
  }
  const bad = result.unreadable.length + result.promises.filter((p) => p.state === "missed" || p.state === "never run").length;
  return bad ? 1 : 0;
}

module.exports = { parsePromise, checkPromises, promiseSayings, promiseLines };
if (require.main === module) process.exit(main(process.argv.slice(2)));
