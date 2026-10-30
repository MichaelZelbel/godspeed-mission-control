/*
 * due-files.js - the old files a reminder lives in: read, written and converted in ONE place.
 *
 * WHY THIS EXISTS (2026-10-30, #90). A reminder with a day attached has been a file due/<slug>.md
 * written by due.js, and its closing or its drop a second file in world/events/ carrying
 * closes:/drops: (D-258: done is something that happened, never a word in the plan). The notebook
 * keeps both inside notebook/ now, where its sync carries them (notebook/core/deadline-records.mjs),
 * and the copy that fills those records has to read exactly what due.js reads: the same STRIP
 * lines, the same head lines, the same events, the same "which window did this close". Two readers
 * of one format drift - one of them learns about a word the other eats - so there is one reader,
 * and this is it. due.js uses it for every file it touches, and the notebook's copy
 * (notebook/core/due-copy.mjs) uses the same functions plus `recordsOf` below.
 *
 * COMMONJS, AND NOTHING OF THE NOTEBOOK AT LOAD TIME. due.js is CommonJS and its tests run on the
 * Node the product's suite uses for the tools (20), which cannot `require` an ES module at all.
 * So the notebook's deadline-records.mjs is required INSIDE `recordsOf` and `writeFilesFrom`,
 * which only the copy calls, and never while this file is being loaded.
 */
const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------- dates
// Everything is YYYY-MM-DD and UTC. A date that means two different days on two of your computers
// is how a monthly job runs twice, or never.
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

// A window's target is the day you moved it to, if you did; the planned one stays on the line so a
// repeating thing's later windows keep their place. A window ends on its deadline, or with none, on
// its target.
const aimOf = (s) => (s && (s.moved || s.target)) || "";
const endOf = (s) => (s && (s.to || aimOf(s))) || "";

// ---------------------------------------------------------------- the files
function readText(p) { try { return fs.readFileSync(p, "utf8"); } catch (e) { return ""; } }
function writeText(p, s) {
  try { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); return true; }
  catch (e) { console.log("   I could not write " + p + ": " + e.message); return false; }
}
const slugify = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
// A name this program can use for a file in due/, and so for a reminder.
const SLUG = /^[a-z0-9][a-z0-9-]{0,59}$/;
// A window this program can place in time: a start, and a deadline or a target after it.
function readableStrip(s) {
  if (!isDate(s.from)) return false;
  if (s.to) return isDate(s.to) && s.to >= s.from;
  const aim = aimOf(s);
  return isDate(aim) && aim >= s.from;
}
const fileOf = (r) => "due/" + r.slug + ".md";

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

// ---------------------------------------------------------------- one mission control's files
// Everything above is the format; everything below is one folder of it. `root` is the mission
// control. One of these per folder, with its own cache, so the copy's scratch folder and the real
// one never see each other's reminders.
function createDueFiles({ root }) {
const DUE = path.join(root, "due");
const EVENTS_DIR = path.join(root, "world", "events");
const filePath = (slug) => path.join(DUE, slug + ".md");
function slugs() {
  if (!fs.existsSync(DUE)) return [];
  return fs.readdirSync(DUE)
    .filter((f) => f.endsWith(".md") && f !== "README.md" && !f.startsWith("."))
    .map((f) => f.slice(0, -3)).sort();
}
const CACHE = new Map();
function parseFile(slug) {
  if (!SLUG.test(slug || "")) return null;
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
  o.problem = strips.some(readableStrip) ? "" : strips.length
    ? "its STRIP line does not hold dates I can read"
    : "it has no STRIP line, so I cannot tell its dates";
  applyEvents(o);
  CACHE.set(slug, o);
  return o;
}
// A FILE I CANNOT READ NEEDS A LOOK, AND IS NEVER DONE (2026-10-09). An assistant wrote a deadline
// by hand with lines of its own invention (KIND:, TARGET-DATE:) and no STRIP line. With no window
// to be open, it was listed as DONE, and the notebook showed it as closed: a birthday present
// nobody had bought, quietly finished. A file with no window I can read, an empty one, or one
// whose name I cannot use is now listed as needing a look, by its file name, and nothing here
// ever writes to it.
function unreadable(slug) {
  const p = filePath(slug);
  const problem = !SLUG.test(slug || "")
    ? "its file name is not one I can use (small letters, digits and dashes only)"
    : !readText(p).trim() ? "it is empty" : "I could not read it";
  return { slug, path: p, text: "", head: {}, strips: [], log: [], said: [], dropped: null, problem };
}

// ---------------------------------------------------------------- the events: the only "is it done"
let EVENTS = null;
const UNPROVEN = [];
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
    EVENTS.push({ file: "world/events/" + f, date: meta.date, closes, drops,
                  evidence: String(meta.evidence).replace(/\s+/g, " ").trim(), source: String(meta.source || "").trim() });
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
// What one closing or drop looks like as a file in world/events/. One place, so the copy's own
// check writes exactly the file this program writes.
function eventText(day, { closes = [], drops = [], evidence, source, text }) {
  const lines = ["---", "date: " + day, "participants: [me]"];
  if (closes.length) lines.push("closes: [" + closes.join(", ") + "]");
  if (drops.length) lines.push("drops: [" + drops.join(", ") + "]");
  lines.push("evidence: " + String(evidence).replace(/\s+/g, " ").trim(), "source: " + (source || "mc-due"),
             "written_by: mc-due", "origin: mission control", "---", "", String(text || "").trim(), "");
  return lines.join("\n");
}
// The one writer of a closing or a drop: one new file per event, never an edit of an old one.
function writeEvent(day, { closes = [], drops = [], evidence, source, text }) {
  if (!String(evidence || "").trim()) return null;
  const first = (closes[0] || drops[0] || "due/thing").replace(/^due\//, "").replace(/#.*/, "");
  const base = day + "-" + slugify(first + " " + (closes.length ? "closed" : "dropped"));
  let file = path.join(EVENTS_DIR, base + ".md");
  for (let n = 2; fs.existsSync(file); n++) file = path.join(EVENTS_DIR, base + "-" + n + ".md");
  if (!writeText(file, eventText(day, { closes, drops, evidence, source, text }))) return null;
  const rel = "world/events/" + path.basename(file);
  worldEvents().push({ file: rel, date: day, closes: closes.map(parseRef).filter(Boolean), drops: drops.map(parseRef).filter(Boolean),
                       evidence: String(evidence).replace(/\s+/g, " ").trim(), source: source || "mc-due" });
  for (const x of CACHE.values()) applyEvents(x);
  return rel;
}
const save = (o) => { CACHE.set(o.slug, o); return writeText(o.path, render(o)); };

// ---------------------------------------------------------------- one old file, as records
//
// WHAT THIS IS FOR. The notebook's copy (notebook/core/due-copy.mjs) needs due/<slug>.md and the
// closing events naming it as the records of ticket 01: one `deadlines` page and one `moments`
// closing per closing. It is here, beside the reader, so there is one place that knows both
// shapes, and `writeFilesFrom` below goes back the other way, which is how the copy proves it
// lost nothing (`sameThroughRecords`).
//
// EVERY FIELD COMES OUT OF THE FILE, never from this computer's clock, name or random numbers.
// Two machines copy the same mission control before either syncs (and that is the normal case:
// Michael's server takes every merge by itself), and the notebook merges two versions of one
// record field by field: a field that differs on both sides with no older version between them is
// a conflict for its owner to settle. So the uid is derived (deadlineUid/closingUid), the id is
// `due-<slug>`, the one dueRows has always given, `created_at` is the first window's first day and
// `updated_at` the last day the log speaks of. The copy writes the record with those and with a
// device of its own rather than through store.prepare(), which would stamp this computer's name
// and this moment on it (notebook/core/due-copy.mjs, `converted`), so the two machines write one
// record, byte for byte, and the merge has nothing to decide.
const records = () => require("../notebook/core/deadline-records.mjs");

// `extra` is whatever the window line carried that nothing here knows. It is kept, never eaten.
const windowOf = (s) => ({ start: s.from, deadline: s.to || "", target: s.target || "", moved: s.moved || "", extra: [...(s.extra || [])] });
// The first day of the first window, else the first day its log mentions: the day this reminder
// began, as far as the file can say.
function beganOn(o) {
  const first = o.strips.map((s) => s.from).filter(isDate).sort()[0];
  if (first) return first;
  return logDays(o)[0] || "";
}
// The days this reminder's log speaks of, in order. Every change tools/due.js makes writes one
// (created, the brief said it, it closed, the next window opened, a day moved), so the last of
// them is the day the file last changed as far as the file itself can say. Never a window's day:
// the last day of a tax return is next year, and nothing may be written as changed in the future.
function logDays(o) {
  const days = [];
  for (const line of o.log) { const m = line.match(/^-\s*(\d{4}-\d{2}-\d{2})\b/); if (m) days.push(m[1]); }
  return days.sort();
}
// What the log said on one day, for the evidence of a closing that was only ever a word on a
// window line (migrateLegacy writes the same sentence into the event it makes).
function logOf(o, day) {
  const said = o.log.filter((l) => l.startsWith("- " + day + " ") && !/ SAID /.test(l)).map((l) => l.slice(13).trim());
  return said.length ? said[said.length - 1] : "the file said done";
}

// One `due/<slug>.md` as ticket 01's records: {deadline, closings}, or null for a file that does
// not read (it gets no record and stays "needs a look", as it is today).
function recordsOf(slug) {
  const { HEAD_FIELDS, deadlineUid, closingMoment } = records();
  const o = parseFile(slug);
  if (!o || o.problem) return null;
  const head = {}, lines = {};
  for (const [line, field] of Object.entries(HEAD_FIELDS)) head[field] = o.head[line] === undefined ? "" : o.head[line];
  for (const line of Object.keys(o.head)) if (!HEAD_FIELDS[line]) lines[line] = o.head[line];
  const began = beganOn(o);
  const deadline = {
    // `due-<slug>`: the id the notebook's rows have given this reminder since it first listed
    // them (native-due.mjs), so what points at one (a closing moment, a notification) still does.
    id: "due-" + slug, uid: deadlineUid(slug),
    ...head,
    title: o.head["TITLE"] || slug,
    native_slug: slug, native_file: fileOf(o),
    windows: o.strips.map(windowOf),
    log: o.log.length ? o.log.join("\n") + "\n" : "",
    head_lines: lines,
    created_at: (began || "1970-01-01") + "T00:00:00Z",
    // When it last changed, as the file says it, never by the clock of whichever machine is
    // copying: two machines copying one file must write the very same record (see above).
    updated_at: (logDays(o).pop() || began || "1970-01-01") + "T00:00:00Z",
  };
  const closings = [];
  const seen = new Set();
  const add = (kind, ref, event) => {
    // The window exactly as the old file names it, empty when the reference was bare: then
    // due.js works out which window it closed from the event's day, and goes on doing so.
    const key = [kind, ref.window, event.file].join("\n");
    if (seen.has(key)) return;
    seen.add(key);
    closings.push({ ...closingMoment({ deadline, kind, day: event.date, window: ref.window,
      evidence: event.evidence, source: event.source || "world/events", from: event.file }),
      created_at: event.date + "T00:00:00Z", updated_at: event.date + "T00:00:00Z" });
  };
  for (const event of worldEvents()) {
    for (const ref of event.closes) if (ref.slug === slug) add("closes", ref, event);
    for (const ref of event.drops) if (ref.slug === slug) add("drops", ref, event);
  }
  // A window still carrying the old `done <date>` word is a closing nobody ever wrote an event
  // for (migrateLegacy turns those into events on the next run of due.js). It is a closing here
  // too, so the records never say a finished window is open.
  for (const s of o.strips) {
    if (!s.legacy) continue;
    closings.push({ ...closingMoment({ deadline, kind: "closes", day: s.legacy, window: s.from,
      evidence: fileOf(o) + " log, " + s.legacy + ": " + logOf(o, s.legacy).slice(0, 300),
      source: "the word on the window line", from: fileOf(o) }),
      created_at: s.legacy + "T00:00:00Z", updated_at: s.legacy + "T00:00:00Z" });
  }
  return { deadline, closings };
}

// The other way round: the records written back as the old files, into this folder. Used by the
// copy's own check, which runs due.js over both folders and compares what it says about every
// reminder. A closing taken out of an old event file goes back under that file's own name, so
// even "what closed it" compares equal; one that was only ever a word on a window line has no
// file of its own and gets the name writeEvent would give it.
function writeFilesFrom({ deadlines = [], closings = [] }) {
  const { HEAD_FIELDS } = records();
  const byUid = new Map(deadlines.map((d) => [d.uid, d]));
  for (const d of deadlines) {
    const head = {};
    for (const [line, field] of Object.entries(HEAD_FIELDS)) {
      const value = field === "title" ? (d.title || "") : d[field];
      if (value !== undefined && value !== null && String(value) !== "") head[line] = String(value);
    }
    if (head["TITLE"] === undefined) head["TITLE"] = d.title || d.native_slug;
    for (const [line, value] of Object.entries(d.head_lines || {})) head[line] = String(value);
    const strips = (d.windows || []).map((w) => ({ from: w.start, to: w.deadline || "", target: w.target || "",
      moved: w.moved || "", extra: [...(w.extra || [])], state: "open", closed: "", legacy: "" }));
    const log = String(d.log || "").split("\n").filter((l) => l.trim());
    save({ slug: d.native_slug, path: filePath(d.native_slug), head, strips, log, said: [] });
  }
  for (const c of closings) {
    const d = byUid.get((c.references || []).find((r) => r.type === "deadlines")?.uid);
    if (!d) continue;
    const ref = "due/" + d.native_slug + (c.obligation_window ? "#" + c.obligation_window : "");
    const parts = { [c.obligation_kind === "drops" ? "drops" : "closes"]: [ref],
                    evidence: c.evidence, source: c.source, text: c.title };
    const named = String(c.moved_from || "").match(/^world\/events\/([^/\\]+\.md)$/);
    if (named) writeText(path.join(EVENTS_DIR, named[1]), eventText(c.happened_at, parts));
    else writeEvent(c.happened_at, parts);
  }
  CACHE.clear(); EVENTS = null;
}

return { DUE, EVENTS_DIR, filePath, slugs, parseFile, unreadable, worldEvents, applyEvents, writeEvent, save,
         cache: CACHE, unproven: UNPROVEN, recordsOf, writeFilesFrom, reread: () => { CACHE.clear(); EVENTS = null; } };
}

module.exports = { createDueFiles, SLUG, parseDate, isDate, addDays, daysBetween, addMonths, repeatOf,
                   aimOf, endOf, readText, writeText, slugify, readableStrip, fileOf, frontmatter,
                   parseRef, listOf, ORDER, render, stripLine, windowWords };
