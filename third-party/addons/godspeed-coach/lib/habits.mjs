// A habit is one file, coach/<area>/habits/<slug>.md: what it is, what counts as done, which days,
// and one line per day he tracked it (or was asked). The newest answer for a day wins, and "asked"
// never overrides an answer, so saying it twice or correcting it later both come out right.
import fs from "node:fs";
import path from "node:path";
import { parseDoc, setHead, appendToSection, formatDoc } from "./header.mjs";
import { addDays, weekdayOf, daysBetween, WEEKDAY_WORDS, listWords } from "./clock.mjs";
import { coachDir } from "./areas.mjs";

const WEEK = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const ANSWERS = ["done", "no", "skip"];
const LINE = /^- (\d{4}-\d{2}-\d{2}) (done|no|skip|asked) \(([^)]*)\)\s*(?:"(.*)")?\s*$/;
const STOP = new Set(["with", "done", "today", "habit", "track", "tracked", "didn't", "dont", "the", "and", "from", "that", "this"]);

export const GRADUATE_DAYS = 42;
export const GRADUATE_RATE = 0.7;
export const STRUGGLE_DAYS = 14;
export const STRUGGLE_MIN_ANSWERED = 5;
export const STRUGGLE_RATE = 0.5;

export function slugify(s) {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

export function parseDays(raw) {
  const r = String(raw || "daily").toLowerCase().trim();
  if (r === "daily" || r === "every day") return "daily";
  const ds = r.split(/[\s,]+/).map((x) => x.slice(0, 3)).filter((x) => WEEK.includes(x));
  return ds.length ? [...new Set(ds)] : null;
}

// "every day", "every Monday, Wednesday and Friday", "jeden Tag": the days as a person says them.
export function daysWords(days, lang = "en") {
  const de = lang === "de";
  if (days === "daily") return de ? "jeden Tag" : "every day";
  const names = [...days].sort((a, b) => WEEK.indexOf(a) - WEEK.indexOf(b)).map((d) => WEEKDAY_WORDS[de ? "de" : "en"][d]);
  return `${de ? "jeden" : "every"} ${listWords(names, lang)}`;
}

export function readHabit(file) {
  const text = fs.readFileSync(file, "utf8");
  const d = parseDoc(text);
  const h = d.head;
  const log = {};
  for (const l of (d.sections.Days || "").split("\n")) {
    const m = l.match(LINE);
    if (!m) continue;
    const [, ymd, answer, source, words = ""] = m;
    const e = (log[ymd] ||= { answer: null, asked: false, source: "", words: "" });
    if (answer === "asked") e.asked = true;
    else Object.assign(e, { answer, source, words });
  }
  return {
    slug: h.HABIT || path.basename(file, ".md"), file, area: h.AREA || path.basename(path.dirname(path.dirname(file))),
    title: h.TITLE || h.HABIT, doneMeans: h["DONE MEANS"] || "", days: parseDays(h.DAYS) || "daily", daysText: h.DAYS || "daily",
    started: h.STARTED || "", status: (h.STATUS || "active").toLowerCase(), auto: (h.AUTO || "").trim(), agreed: h.AGREED || "", log,
  };
}

export function listHabits(mcDir, { status } = {}) {
  const root = coachDir(mcDir);
  if (!fs.existsSync(root)) return [];
  const out = [];
  for (const a of fs.readdirSync(root, { withFileTypes: true })) {
    if (!a.isDirectory()) continue;
    const dir = path.join(root, a.name, "habits");
    if (!fs.existsSync(dir)) continue;
    for (const n of fs.readdirSync(dir).filter((x) => x.endsWith(".md")).sort()) out.push(readHabit(path.join(dir, n)));
  }
  return status ? out.filter((h) => h.status === status) : out;
}

export function addHabit(mcDir, { area, slug, title, doneMeans, days, agreed = "", auto = "" }, today, max = 5) {
  if (!area || !fs.existsSync(path.join(coachDir(mcDir), area))) throw new Error(`There is no coach area called "${area}".`);
  const s = slugify(slug || title);
  if (!s) throw new Error("A habit needs a name.");
  const d = parseDays(days);
  if (!d) throw new Error(`"${days}" is not a list of days. Say daily, or days like mon,wed,fri.`);
  const active = listHabits(mcDir, { status: "active" });
  if (active.some((h) => h.slug === s)) throw new Error(`There is already an active habit called ${s}.`);
  if (active.length >= max) throw new Error(`Already ${active.length} active habits: ${active.map((h) => h.title).join(", ")}. Pause or graduate one first.`);
  const file = path.join(coachDir(mcDir), area, "habits", `${s}.md`);
  if (fs.existsSync(file)) throw new Error(`${s} already exists as a ${readHabit(file).status} habit; make it active again instead.`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, formatDoc({
    HABIT: s, TITLE: title || s, AREA: area, "DONE MEANS": doneMeans || "", DAYS: d === "daily" ? "daily" : d.join(","),
    STARTED: today, AGREED: agreed, STATUS: "active", AUTO: auto,
  }, { Days: "" }));
  return readHabit(file);
}

function tokens(s) {
  return String(s || "").toLowerCase().split(/[^a-z0-9äöüß]+/).filter((w) => w.length >= 4 && !STOP.has(w));
}

// "did head lifts", "track head lifts", "Kopfheben erledigt": the habit whose name shares the most
// words with what he said. A tie is ambiguous and is asked about, never guessed.
export function findHabit(mcDir, words, { includeInactive = false } = {}) {
  const pool = listHabits(mcDir).filter((h) => includeInactive || h.status === "active");
  const said = String(words || "").toLowerCase();
  const exact = pool.find((h) => h.slug === slugify(said) || said.includes(h.slug) || said.includes(h.slug.replace(/-/g, " ")));
  if (exact) return exact;
  const w = new Set(tokens(said));
  const scored = pool.map((h) => ({ h, n: tokens(`${h.title} ${h.slug.replace(/-/g, " ")}`).filter((t) => w.has(t)).length })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  if (!scored.length) return null;
  if (scored.length > 1 && scored[0].n === scored[1].n) return { ambiguous: scored.filter((x) => x.n === scored[0].n).map((x) => x.h.title) };
  return scored[0].h;
}

export function track(habit, ymd, answer, source = "cli", words = "") {
  if (![...ANSWERS, "asked"].includes(answer)) throw new Error(`An answer is done, no or skip, not "${answer}".`);
  const clean = String(words || "").replace(/"/g, "'").replace(/\s+/g, " ").trim().slice(0, 300);
  const text = fs.readFileSync(habit.file, "utf8");
  fs.writeFileSync(habit.file, appendToSection(text, "Days", `- ${ymd} ${answer} (${String(source).replace(/[()]/g, "")}) "${clean}"`));
  return readHabit(habit.file);
}

export const answerOn = (habit, ymd) => habit.log[ymd]?.answer || null;
export const askedOn = (habit, ymd) => Boolean(habit.log[ymd]?.asked);

export function dueOn(habit, ymd) {
  if (habit.status !== "active" || (habit.started && ymd < habit.started)) return false;
  return habit.days === "daily" || habit.days.includes(weekdayOf(ymd));
}

export function stats(habit, untilYmd, days) {
  const r = { applicable: 0, done: 0, no: 0, skip: 0, unknown: 0, answered: 0, rate: null };
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(untilYmd, -i);
    if (habit.started && d < habit.started) continue;
    if (!(habit.days === "daily" || habit.days.includes(weekdayOf(d)))) continue;
    r.applicable++;
    const a = answerOn(habit, d);
    if (a) r[a]++; else r.unknown++;
  }
  r.answered = r.done + r.no;
  r.rate = r.answered ? r.done / r.answered : null;
  return r;
}

// Offered in the talk, never decided alone: graduate after six weeks of mostly done, or "make it
// smaller, or drop it?" after two weeks under half.
export function verdict(habit, todayYmd) {
  if (habit.status !== "active") return "fine";
  if (habit.started && daysBetween(habit.started, todayYmd) >= GRADUATE_DAYS) {
    const s = stats(habit, todayYmd, GRADUATE_DAYS);
    if (s.rate !== null && s.rate >= GRADUATE_RATE && s.answered * 2 >= s.applicable) return "graduate";
  }
  const s = stats(habit, todayYmd, STRUGGLE_DAYS);
  if (s.answered >= STRUGGLE_MIN_ANSWERED && s.rate < STRUGGLE_RATE) return "struggling";
  return "fine";
}

export function setStatus(habit, status) {
  if (!["active", "paused", "graduated", "dropped"].includes(status)) throw new Error(`A habit is active, paused, graduated or dropped, not "${status}".`);
  fs.writeFileSync(habit.file, setHead(fs.readFileSync(habit.file, "utf8"), "STATUS", status));
  return readHabit(habit.file);
}
