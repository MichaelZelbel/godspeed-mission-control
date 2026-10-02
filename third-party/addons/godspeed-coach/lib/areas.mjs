// An area is one folder under coach/ with an area.md: what the talks are about, when they happen,
// how they sound and what they may never do. Adding an area is adding a folder; nothing here knows
// any area by name.
import fs from "node:fs";
import path from "node:path";
import { parseDoc } from "./header.mjs";
import { weekdayOf, daysBetween, zonedToUtc, WEEKDAY_WORDS } from "./clock.mjs";

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const DAY_NAMES = { monday: "mon", tuesday: "tue", wednesday: "wed", thursday: "thu", friday: "fri", saturday: "sat", sunday: "sun" };

export const coachDir = (mcDir) => path.join(mcDir, "coach");

export function parseRhythm(raw) {
  const r = String(raw || "").trim().toLowerCase();
  const day = (w) => DAY_NAMES[w] || (DAYS.includes(w) ? w : null);
  if (r === "daily") return { kind: "daily" };
  let m = r.match(/^weekly (\w+)$/);
  if (m && day(m[1])) return { kind: "weeks", every: 1, day: day(m[1]) };
  m = r.match(/^every (\d+) weeks? (\w+)$/);
  if (m && day(m[2]) && Number(m[1]) >= 1) return { kind: "weeks", every: Number(m[1]), day: day(m[2]) };
  m = r.match(/^monthly (\d+)$/);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 28) return { kind: "monthly", day: Number(m[1]) };
  return null;
}

// The rhythm and time in the words a person would use, "every Sunday at 19:00", for the brief the
// model writes from. Handed "weekly sunday, 19:00", a model repeats the setting as it is.
const ordinal = (n) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;
export function rhythmWords(area) {
  const r = area.rhythm;
  const at = `at ${area.time}`;
  if (!r) return `${at}, on a rhythm the coach cannot read ("${area.rhythmText}")`;
  if (r.kind === "daily") return `every day ${at}`;
  if (r.kind === "monthly") return `on the ${ordinal(r.day)} of every month ${at}`;
  const day = WEEKDAY_WORDS.en[r.day];
  return r.every === 1 ? `every ${day} ${at}` : `every ${r.every} weeks on ${day} ${at}`;
}

export function readArea(dir) {
  const file = path.join(dir, "area.md");
  if (!fs.existsSync(file)) return null;
  const d = parseDoc(fs.readFileSync(file, "utf8"));
  const h = d.head;
  return {
    slug: path.basename(dir), dir, file, head: h, lists: d.lists, sections: d.sections,
    title: h.TITLE || path.basename(dir),
    rhythm: parseRhythm(h.RHYTHM), rhythmText: h.RHYTHM || "",
    time: /^\d\d:\d\d$/.test(h.TIME || "") ? h.TIME : "19:00",
    starts: /^\d{4}-\d{2}-\d{2}$/.test(h.STARTS || "") ? h.STARTS : null,
    on: (h.STATUS || "on").toLowerCase() === "on",
    style: h.STYLE || "compass", tone: h.TONE || "gentle",
    serves: (h.SERVES || "").split(",").map((x) => x.trim()).filter(Boolean),
  };
}

export function listAreas(mcDir) {
  const root = coachDir(mcDir);
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => readArea(path.join(root, e.name)))
    .filter(Boolean)
    .sort((a, b) => a.slug.localeCompare(b.slug));
}

export function findArea(mcDir, name) {
  const n = String(name || "").toLowerCase();
  return listAreas(mcDir).find((a) => a.slug === n || a.title.toLowerCase() === n) || null;
}

export function isTalkDay(area, ymd) {
  if (!area || !area.on || !area.rhythm || !area.starts || ymd < area.starts) return false;
  const r = area.rhythm;
  if (r.kind === "daily") return true;
  if (r.kind === "monthly") return Number(ymd.slice(8, 10)) === r.day;
  if (weekdayOf(ymd) !== r.day) return false;
  if (r.every === 1) return true;
  // Counted from the first talk day on or after STARTS.
  let first = area.starts;
  while (weekdayOf(first) !== r.day) first = new Date(Date.parse(first + "T12:00:00Z") + 86400000).toISOString().slice(0, 10);
  return Math.floor(daysBetween(first, ymd) / 7) % r.every === 0;
}

export function talkMoment(area, ymd, tz) {
  return isTalkDay(area, ymd) ? zonedToUtc(ymd, area.time, tz) : null;
}

export function nextTalkDay(area, fromYmd) {
  for (let i = 0; i < 400; i++) {
    const d = new Date(Date.parse(fromYmd + "T12:00:00Z") + i * 86400000).toISOString().slice(0, 10);
    if (isTalkDay(area, d)) return d;
  }
  return null;
}

// What a new area's talk prepares when the person has said nothing more specific. Written for any
// assistant, so it names no person and no data source; "MAY READ" lines and a longer Preparation are
// added in conversation when the person names them.
export const DEFAULT_PREPARATION = {
  review: "Read the last talk of this area and whatever the MAY READ lines name. Choose one thing: what changed since the last talk, in their own records if there are any, or one finding they could act on this week. Then one question.",
  compass: "Read the last talk of this area. Open with what was decided last time, if anything, in a short sentence that makes sense on its own, then one question about direction: what is pulling at them, what to try next.",
};

const FIELD_CHECKS = {
  TITLE: (v) => (v.trim() ? null : "A title cannot be empty."),
  RHYTHM: (v) => (parseRhythm(v) ? null : `"${v}" is not a rhythm. Say daily, weekly sunday, every 2 weeks friday or monthly 1.`),
  TIME: (v) => (/^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? null : `"${v}" is not a time. Write it as HH:MM, for example 19:00.`),
  STARTS: (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v)) ? null : `"${v}" is not a date. Write it as YYYY-MM-DD.`),
  STATUS: (v) => (["on", "paused"].includes(v) ? null : "STATUS is on or paused."),
  STYLE: (v) => (["review", "compass"].includes(v) ? null : "STYLE is review (data and one change) or compass (questions and one direction)."),
  TONE: (v) => (["gentle", "direct"].includes(v) ? null : "TONE is gentle or direct."),
  SERVES: () => null,
};
export const AREA_FIELDS = Object.keys(FIELD_CHECKS);

export function addArea(mcDir, { slug, title, rhythm, time = "19:00", starts, style = "compass", tone = "gentle", serves = "", limits = [], reads = [], preparation = "" }) {
  const s = String(slug || title || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
  if (!s) throw new Error("An area needs a name, for example health.");
  const dir = path.join(coachDir(mcDir), s);
  if (fs.existsSync(path.join(dir, "area.md"))) throw new Error(`There is already an area called ${s}. Change it instead.`);
  const fields = { TITLE: title || s, RHYTHM: rhythm, TIME: time, STARTS: starts, STATUS: "on", STYLE: style, TONE: tone, SERVES: serves };
  for (const [k, v] of Object.entries(fields)) {
    const p = FIELD_CHECKS[k](String(v ?? ""));
    if (p) throw new Error(p);
  }
  const head = [`AREA: ${s}`, ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`.trimEnd()),
    ...[].concat(reads).filter(Boolean).map((r) => `MAY READ: ${r}`), ...[].concat(limits).filter(Boolean).map((l) => `LIMIT: ${l}`)];
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "area.md"), `${head.join("\n")}\n\n## Preparation\n\n${preparation || DEFAULT_PREPARATION[style]}\n`);
  return readArea(dir);
}

export function setAreaField(area, key, value) {
  const k = String(key || "").toUpperCase();
  if (!FIELD_CHECKS[k]) throw new Error(`An area's settings are ${AREA_FIELDS.join(", ")}; "${key}" is not one of them.`);
  const raw = String(value ?? "").trim();
  const v = ["STYLE", "TONE", "STATUS", "RHYTHM"].includes(k) ? raw.toLowerCase() : raw;
  const p = FIELD_CHECKS[k](v);
  if (p) throw new Error(p);
  const lines = fs.readFileSync(area.file, "utf8").replace(/\r\n/g, "\n").split("\n");
  const end = lines.findIndex((l) => !l.trim() || l.startsWith("## "));
  const stop = end === -1 ? lines.length : end;
  const at = lines.slice(0, stop).findIndex((l) => l.startsWith(k + ":"));
  if (at !== -1) lines[at] = `${k}: ${v}`; else lines.splice(stop, 0, `${k}: ${v}`);
  fs.writeFileSync(area.file, lines.join("\n"));
  return readArea(area.dir);
}
