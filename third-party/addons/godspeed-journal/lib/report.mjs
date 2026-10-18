// Where the time went, and what was said along the way.
//
// Counted time (0.3.0). A task's clock runs only while it is the last thing the person started or
// wrote a note about. It stops when they finish it, when they start something else, and at any
// stretch of more than four hours with no entry of theirs at all, at their last entry before that
// silence. The incident: "Substack post" started at 22:09 and was closed by hand after midnight
// the next day, and the week report said it took 26h 11m; the work talk reads that report to say
// where the hours went. A clock stopped by a silence marks the task `cut`, and the report says
// "at least" or "no time counted" rather than guess what happened while nobody said anything.
import { localParts, minutesBetween } from "./clock.mjs";
import { tasksFrom } from "./tasks.mjs";

const fmt = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
export const SILENCE_MINUTES = 4 * 60;

// The person's own entries: what they said, not what the machinery wrote about them (a check-in,
// the evening list, a mark, a close from the record).
const OWN = new Set(["start", "define", "note", "done", "drop", "reopen", "met"]);
export const isOwn = (e) => OWN.has(e.kind) && !["tick", "evidence"].includes(e.source);

export function countedTime(entries, now) {
  const tasks = new Map(tasksFrom(entries).map((t) => [t.id, t]));
  const out = new Map([...tasks.keys()].map((id) => [id, { minutes: 0, cut: false }]));
  const openAt = (id, iso) => { const t = tasks.get(id); return t && t.started <= iso && (!t.ended || iso < t.ended); };
  // A task ends at its own close, which for a close from the record is when the proof happened.
  const events = [
    ...entries.filter(isOwn).map((e) => ({ at: e.at, kind: e.kind, task: e.task, own: true })),
    ...[...tasks.values()].filter((t) => t.ended).map((t) => ({ at: t.ended, kind: "end", task: t.id, own: false })),
  ].sort((a, b) => a.at.localeCompare(b.at) || (a.kind === "end" ? -1 : 0) - (b.kind === "end" ? -1 : 0));

  let active = null; let since = null; let lastOwn = null;
  const stop = (iso, cut = false) => {
    const t = tasks.get(active); const row = out.get(active);
    const end = t?.ended && t.ended < iso ? t.ended : iso;
    if (row && end > since) row.minutes += minutesBetween(new Date(since), new Date(end));
    if (row && cut) row.cut = true;
    active = null; since = null;
  };
  const silent = (iso) => lastOwn && minutesBetween(new Date(lastOwn), new Date(iso)) > SILENCE_MINUTES;

  for (const ev of events) {
    if (active && silent(ev.at)) stop(lastOwn, true);
    if (ev.kind === "end" && ev.task === active) stop(ev.at);
    const switches = ev.kind === "start" || (ev.kind === "note" && ev.task && ev.task !== active && openAt(ev.task, ev.at));
    if (switches && ev.task) { if (active) stop(ev.at); active = ev.task; since = ev.at; }
    if (ev.own) lastOwn = ev.at;
  }
  if (active) { const iso = now.toISOString(); if (silent(iso)) stop(lastOwn, true); else stop(iso); }
  return out;
}

export function dayReport(entries, s, date, now = new Date()) {
  const onDay = (iso) => localParts(new Date(iso), s.timezone).date === date;
  const counted = countedTime(entries, now);
  const tasks = tasksFrom(entries).filter((t) => onDay(t.started)).map((t) => ({
    id: t.id, title: t.title, state: t.state, started: t.started, ended: t.ended || null,
    minutes: t.ended ? counted.get(t.id).minutes : null, at_least: Boolean(t.ended && counted.get(t.id).cut), missed: t.missed || [],
  }));
  return { date, tasks, notes: entries.filter((e) => e.kind === "note" && onDay(e.at)).length };
}

export function weekReport(entries, s, now) {
  const from = new Date(now.getTime() - 7 * 86400000);
  const inWeek = (iso) => new Date(iso) >= from && new Date(iso) <= now;
  const tasks = tasksFrom(entries).filter((t) => inWeek(t.started));
  const counted = countedTime(entries, now);
  const byTitle = new Map(); const uncounted = [];
  for (const t of tasks.filter((t) => t.state === "done")) {
    const c = counted.get(t.id);
    if (c.cut && c.minutes === 0) { uncounted.push(t.title); continue; }
    const k = t.title.trim().toLowerCase();
    const row = byTitle.get(k) || { title: t.title, minutes: 0, count: 0, at_least: false };
    row.minutes += c.minutes; row.count++; row.at_least ||= c.cut;
    byTitle.set(k, row);
  }
  const nudges = entries.filter((e) => e.kind === "nudge" && inWeek(e.at));
  const answered = nudges.filter((n) => entries.some((e) => e.task === n.task && e.at > n.at && !["nudge", "mark"].includes(e.kind)));
  return {
    from: from.toISOString(), to: now.toISOString(),
    byTitle: [...byTitle.values()].sort((a, b) => b.minutes - a.minutes),
    uncounted,
    catches: tasks.filter((t) => (t.missed || []).length).length,
    openNow: tasks.filter((t) => t.state === "open").length,
    nudgesSent: nudges.length, nudgesAnswered: answered.length,
  };
}

export function renderWeek(r, s) {
  const de = s.language === "de";
  const atLeast = de ? "mindestens " : "at least ";
  const rows = r.byTitle.slice(0, 8).map((x) => `${x.title}: ${x.at_least ? atLeast : ""}${fmt(x.minutes)}${x.count > 1 ? ` (${x.count}x)` : ""}`);
  const none = !r.uncounted?.length ? [] : [de
    ? `Keine Zeit gezählt (über mehr als vier Stunden ohne Eintrag offen geblieben): ${r.uncounted.join(", ")}.`
    : `No time counted (left open through more than four hours without an entry): ${r.uncounted.join(", ")}.`];
  const tail = de
    ? `Beim Abschluss fehlte etwas: ${r.catches}x. Nachfragen: ${r.nudgesSent}, beantwortet: ${r.nudgesAnswered}.`
    : `Something was missing at the finish: ${r.catches}x. Check-ins: ${r.nudgesSent}, answered: ${r.nudgesAnswered}.`;
  return [...rows, ...none, tail].join("\n");
}

// What they said, in their own words: the notes, and what they said when starting and finishing.
// This is what a weekly talk reads besides the hours, because the hours say where the time went
// and only the words say how it felt. A start whose words are just its title adds nothing.
const SAID = new Set(["start", "note", "done", "drop"]);

export function wordsReport(entries, s, now, days = 7) {
  const from = new Date(now.getTime() - days * 86400000);
  const titles = new Map(tasksFrom(entries).map((t) => [t.id, t.title]));
  return entries
    .filter((e) => SAID.has(e.kind) && isOwn(e) && String(e.words || "").trim())
    .filter((e) => new Date(e.at) >= from && new Date(e.at) <= now)
    .filter((e) => String(e.words).trim() !== String(e.title || "").trim())
    .map((e) => {
      const p = localParts(new Date(e.at), s.timezone);
      return { at: e.at, date: p.date, weekday: p.weekday, hm: p.hm, kind: e.kind, task: e.task || null,
        title: e.task ? titles.get(e.task) || e.title || e.task : null, words: String(e.words).trim() };
    });
}

export function renderWords(list, s) {
  if (!list.length) return "Nothing said in this stretch.";
  const out = []; let day = null;
  for (const w of list) {
    if (w.date !== day) { day = w.date; out.push(`${out.length ? "\n" : ""}${w.weekday[0].toUpperCase()}${w.weekday.slice(1)} ${w.date}`); }
    const about = !w.title ? w.kind : w.kind === "note" ? `note on "${w.title}"` : `${w.kind} "${w.title}"`;
    out.push(`${w.hm} ${about}: ${w.words.replace(/\s*\n+\s*/g, " ")}`);
  }
  return out.join("\n");
}
