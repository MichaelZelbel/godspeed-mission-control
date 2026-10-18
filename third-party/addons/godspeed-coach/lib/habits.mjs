// A habit is one file, coach/<area>/habits/<slug>.md: what it is, what counts as done, which days,
// and one line per day he tracked it (or was asked). The newest answer for a day wins, and "asked"
// never overrides an answer, so saying it twice or correcting it later both come out right.
import fs from "node:fs";
import path from "node:path";
import { parseDoc, setHead, appendToSection, formatDoc } from "./header.mjs";
import { addDays, weekdayOf, daysBetween, WEEKDAY_WORDS, listWords, now, localParts } from "./clock.mjs";
import { coachDir, findArea, listAreas } from "./areas.mjs";
import {loadSettings} from './settings.mjs';
import {assertDay,stateOn} from './progress.mjs';

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
  const progressHistory=[];
  for(const line of (d.sections['Progress history']||'').split('\n')) {
    try { const e=JSON.parse(line.replace(/^- /,''));if(e&&typeof e.kind==='string'&&e.on)progressHistory.push(e); } catch { /* Other prose stays in the source file. */ }
  }
  for (const l of (d.sections.Days || "").split("\n")) {
    const m = l.match(LINE);
    if (!m) continue;
    const [, ymd, answer, source, words = ""] = m;
    const e = (log[ymd] ||= { answer: null, asked: false, source: "", words: "" });
    if (answer === "asked") e.asked = true;
    else Object.assign(e, { answer, source, words });
  }
  const area = h.AREA || path.basename(path.dirname(path.dirname(file)));
  return {
    slug: h.HABIT || path.basename(file, ".md"), file, area, readBy: readersOf(h["READ BY"], area),
    title: h.TITLE || h.HABIT, doneMeans: h["DONE MEANS"] || "", days: parseDays(h.DAYS) || "daily", daysText: h.DAYS || "daily",
    started: h.STARTED || "", status: (h.STATUS || "active").toLowerCase(), auto: (h.AUTO || "").trim(), agreed: h.AGREED || "", log,
    timezone:h.TIMEZONE||null,progressDisplay:h['PROGRESS DISPLAY']==='calm'?'calm':'standard',progressHistory,
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

// Which other talks may look at a habit (the decision of 13 October 2026: a headache
// tracker matters to a health talk and a psychology talk alike). One header line names the OTHER
// areas, "READ BY: psychology, sleep"; the habit's own area always looks at it and is never in the
// line. Only looking: the evening check, graduation and "make it smaller" stay with its own talk.
function readersOf(raw, own) {
  return [...new Set(String(raw || "").split(",").map((x) => x.trim().toLowerCase()).filter((x) => x && x !== own))];
}
const talkOf = (a) => `the ${a.title} talk`;
const capital = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const withArticle = (t) => `${/^[aeiou]/i.test(t) ? "an" : "a"} ${t}`;
const areaSlugOf = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const ownerOf = (mcDir, habit) => findArea(mcDir, habit.area) || { slug: habit.area, title: habit.area };

// A habit by its slug, or the habit itself (from listHabits or readHabit), read fresh from its file.
function habitFrom(mcDir, ref) {
  if (ref && typeof ref === "object" && ref.file) return readHabit(ref.file);
  const s = slugify(ref);
  const all = listHabits(mcDir).filter((h) => h.slug === s);
  const active = all.filter((h) => h.status === "active");
  const pool = active.length ? active : all;
  if (!s || !pool.length) throw new Error(`There is no habit called "${String(ref ?? "").trim()}".`);
  if (pool.length > 1) throw new Error(`Several habits are called ${s}: ${pool.map((h) => `${h.title} (${h.area})`).join(" / ")}. Say which one.`);
  return pool[0];
}

// "Your habit Walk to work and back belongs to the Health talk; the Psychology talk may also look
// at it." For listing who reads it.
export function habitReadersWords(mcDir, ref) {
  const habit = habitFrom(mcDir, ref);
  const others = habit.readBy.map((slug) => talkOf(findArea(mcDir, slug) || { title: slug }));
  return `Your habit ${habit.title} belongs to ${talkOf(ownerOf(mcDir, habit))}; ${others.length ? `${listWords(others)} may also look at it.` : "no other talk looks at it."}`;
}

// Adds an area to the habit's READ BY line, or takes it away with { remove: true }. Only that one
// header line is written (made under AREA, dropped with its last area); every other line and the
// file's own line endings stay exactly as they were. Refuses, writing nothing, an area that does
// not exist and the habit's own area. Returns the habit read fresh, the area, whether anything
// changed, the readers now, and `reply`: one plain sentence to say back to the person as it is.
export function setHabitReader(mcDir, ref, areaName, { remove = false } = {}) {
  const habit = habitFrom(mcDir, ref);
  const owner = ownerOf(mcDir, habit);
  const area = findArea(mcDir, areaName);
  if ((area ? area.slug : areaSlugOf(areaName)) === habit.area) {
    throw new Error(`${habit.title} is ${withArticle(owner.title)} habit; ${talkOf(owner)} always looks at it.`);
  }
  if (!area) throw new Error(`There is no coach area called "${String(areaName ?? "").trim()}". Areas: ${listAreas(mcDir).map((a) => a.slug).join(", ") || "none yet"}.`);
  const had = habit.readBy.includes(area.slug);
  const T = capital(talkOf(area));
  const result = (changed, reply) => {
    const h = readHabit(habit.file);
    return { habit: h, area: { slug: area.slug, title: area.title, noTalk: area.noTalk }, changed, readBy: h.readBy, reply };
  };
  if (remove ? !had : had) {
    return result(false, remove ? `${T} was not looking at your habit ${habit.title}. Nothing changed.` : `${T} may already look at your habit ${habit.title}. Nothing changed.`);
  }
  const readers = remove ? habit.readBy.filter((x) => x !== area.slug) : [...habit.readBy, area.slug];
  const raw = fs.readFileSync(habit.file, "utf8");
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = raw.split(eol);
  let end = lines.findIndex((l) => !l.trim() || l.startsWith("## "));
  if (end === -1) end = lines.length;
  const at = lines.slice(0, end).findIndex((l) => l.startsWith("READ BY:"));
  const line = `READ BY: ${readers.join(", ")}`;
  if (at !== -1) {
    if (readers.length) lines[at] = line; else lines.splice(at, 1);
  } else if (readers.length) {
    const areaLine = lines.slice(0, end).findIndex((l) => l.startsWith("AREA:"));
    lines.splice(areaLine === -1 ? end : areaLine + 1, 0, line);
  }
  fs.writeFileSync(habit.file, lines.join(eol));
  const later = area.noTalk ? " It has no talk yet; the talk it gets later keeps this." : "";
  return result(true, remove ? `${T} no longer looks at your habit ${habit.title}.` : `${T} may now look at your habit ${habit.title}.${later}`);
}

export function addHabit(mcDir, { area, slug, title, doneMeans, days, agreed = "", auto = "", timezone }, today, max = 5) {
  assertDay(today);
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
    STARTED: today, AGREED: agreed, STATUS: "active", AUTO: auto,TIMEZONE:timezone||loadSettings(mcDir).timezone,
  }, { 'Progress history': [JSON.stringify({kind:'schedule',on:today,days:d}),JSON.stringify({kind:'status',on:today,status:'active'})].map(s=>'- '+s).join('\n'),Days: "" }));
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
  assertDay(ymd);
  if (![...ANSWERS, "asked"].includes(answer)) throw new Error(`An answer is done, no or skip, not "${answer}".`);
  const clean = String(words || "").replace(/"/g, "'").replace(/\s+/g, " ").trim().slice(0, 300);
  const text = withProgressBaseline(habit,localParts(now(),habit.timezone||habit.progressTimezone||'UTC').date);
  fs.writeFileSync(habit.file, appendToSection(text, "Days", `- ${ymd} ${answer} (${String(source).replace(/[()]/g, "")}) "${clean}"`));
  return readHabit(habit.file);
}

// Takes back the newest answer of a day ("delete the last walk to work", D-321): that one line goes,
// so the file is as it was before it was tracked. An older answer of the same day counts again, and
// an "asked" line is never removed: it records the evening check, not an answer.
export function untrack(habit, ymd) {
  const lines = fs.readFileSync(habit.file, "utf8").split("\n");
  const start = lines.findIndex((l) => l.trim() === "## Days");
  let end = lines.findIndex((l, j) => j > start && l.startsWith("## "));
  if (end === -1) end = lines.length;
  for (let j = end - 1; start !== -1 && j > start; j--) {
    const m = lines[j].match(LINE);
    if (!m || m[1] !== ymd || !ANSWERS.includes(m[2])) continue;
    lines.splice(j, 1);
    fs.writeFileSync(habit.file, lines.join("\n"));
    return readHabit(habit.file);
  }
  throw new Error(`No answer is tracked for ${ymd}.`);
}

// The day of the newest answer line in the file: the one he tracked or changed last.
export function lastAnsweredDay(habit) {
  const lines = fs.readFileSync(habit.file, "utf8").split("\n");
  for (let j = lines.length - 1; j >= 0; j--) { const m = lines[j].match(LINE); if (m && ANSWERS.includes(m[2])) return m[1]; }
  return null;
}

export const answerOn = (habit, ymd) => habit.log[ymd]?.answer || null;
export const askedOn = (habit, ymd) => Boolean(habit.log[ymd]?.asked);

export function dueOn(habit, ymd) {
  if (habit.status !== "active" || (habit.started && ymd < habit.started)) return false;
  const state=stateOn(habit,ymd);return state.status==='active'&&state.scheduled;
}

// The last `days` calendar days up to untilYmd. `applicable` is the planned days that count:
// done + no + unknown (a planned day with no answer). A skipped day is counted in `skip` only and
// left out of everything else, because "skip" is the answer for a day that shouldn't count ("for
// example because you were ill", in the evening check; "Does not count" on the notebook's habit
// page). So it never makes the graduation's half-answered rule harder and never counts as a no.
export function stats(habit, untilYmd, days) {
  const r = { applicable: 0, done: 0, no: 0, skip: 0, unknown: 0, answered: 0, rate: null };
  for (let i = days - 1; i >= 0; i--) {
    const d = addDays(untilYmd, -i);
    if (habit.started && d < habit.started) continue;
    const state=stateOn(habit,d);
    if (!state.scheduled || state.status!=='active'||habit.progressHistory?.some(e=>e.kind==='exempt'&&e.from<=d&&e.to>=d)) continue;
    const a = answerOn(habit, d);
    if (a === "skip") { r.skip++; continue; }
    r.applicable++;
    if (a) r[a]++; else r.unknown++;
  }
  r.answered = r.done + r.no;
  r.rate = r.answered ? r.done / r.answered : null;
  return r;
}

// Offered in the talk, never decided alone: graduate after six weeks of mostly done, or "make it
// smaller, or drop it?" after two weeks under half. Both read stats(), so a skipped day counts in
// neither: graduating needs at least half of the planned days that count answered.
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

export function setStatus(habit, status, on=localParts(now(),habit.timezone||'UTC').date) {
  if (!["active", "paused", "graduated", "dropped"].includes(status)) throw new Error(`A habit is active, paused, graduated or dropped, not "${status}".`);
  assertDay(on);
  let text=withProgressBaseline(habit,on);
  text=appendToSection(text,'Progress history','- '+JSON.stringify({kind:'status',on,status}));
  // A retrospective change records history without changing today's status to the past state.
  const current=readHabit(habit.file).progressHistory.filter(e=>e.kind==='status'&&e.on>on).sort((a,b)=>a.on.localeCompare(b.on)).at(-1)?.status||status;
  fs.writeFileSync(habit.file, setHead(text, "STATUS", current));
  return readHabit(habit.file);
}

function withProgressBaseline(habit,on) {
  let text=fs.readFileSync(habit.file,'utf8');
  if(!habit.progressHistory?.some(e=>e.kind==='schedule')) {
    text=appendToSection(text,'Progress history','- '+JSON.stringify({kind:'schedule',on,days:habit.days}));
    text=appendToSection(text,'Progress history','- '+JSON.stringify({kind:'status',on,status:habit.status}));
  }
  if(!habit.timezone&&habit.progressTimezone)text=setHead(text,'TIMEZONE',habit.progressTimezone);
  return text;
}
// Explicit installer upgrade, never a read-side effect. Preserve every completion and make
// only the current schedule known from adoption onwards, without reconstructing prior history.
export function initializeHabitProgress(habit,on,timezone) {
  assertDay(on);new Intl.DateTimeFormat('en',{timeZone:timezone});
  const before=fs.readFileSync(habit.file,'utf8');
  let text=withProgressBaseline({...habit,progressTimezone:timezone},on);
  if(!habit.timezone)text=setHead(text,'TIMEZONE',timezone);
  if(text!==before)fs.writeFileSync(habit.file,text);
  return {habit:readHabit(habit.file),changed:text!==before};
}
export function setHabitSchedule(habit,days,on,timezone) {
  assertDay(on);const parsed=parseDays(days);if(!parsed)throw Error('Choose daily or weekdays such as mon,wed,fri');
  let text=withProgressBaseline(habit,on);
  text=appendToSection(text,'Progress history','- '+JSON.stringify({kind:'schedule',on,days:parsed}));
  const later=habit.progressHistory.filter(e=>e.kind==='schedule'&&e.on>on).sort((a,b)=>a.on.localeCompare(b.on)).at(-1);
  const current=later?.days||parsed;
  text=setHead(text,'DAYS',current==='daily'?'daily':current.join(','));
  if(!habit.timezone&&timezone)text=setHead(text,'TIMEZONE',timezone);
  fs.writeFileSync(habit.file,text);return readHabit(habit.file);
}
export function setHabitDisplay(habit,display) {
  if(!['standard','calm'].includes(display))throw Error('Choose standard or calm display');
  fs.writeFileSync(habit.file,setHead(fs.readFileSync(habit.file,'utf8'),'PROGRESS DISPLAY',display));return readHabit(habit.file);
}
export function exemptHabitDays(habit,from,to,reason='') {
  assertDay(from);assertDay(to);if(to<from)throw Error('The last day must come after the first day');
  if(daysBetween(from,to)>3660)throw Error('Choose a pause of at most ten years');
  const text=appendToSection(fs.readFileSync(habit.file,'utf8'),'Progress history','- '+JSON.stringify({kind:'exempt',on:from,from,to,reason:String(reason).replace(/\s+/g,' ').slice(0,300)}));
  fs.writeFileSync(habit.file,text);return readHabit(habit.file);
}
