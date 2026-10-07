// A task is what a start entry opened. Everything after it that names the same task either
// adds to it, closes it, or (for nudges and marks) is bookkeeping that is not the person's
// activity, so a nudge never resets the clock that decides the next nudge.
import { minutesBetween } from "./clock.mjs";

export function tasksFrom(entries) {
  const map = new Map();
  for (const e of entries) {
    if (!e.task) continue;
    if (e.kind === "start") {
      map.set(e.task, { id: e.task, title: e.title || e.task, started: e.at, done_means: [...(e.done_means || [])], state: "open", last: e.at, nudges: 0, flags: [], rejected: [] });
      continue;
    }
    const t = map.get(e.task);
    if (!t) continue;
    if (e.kind === "nudge") { t.nudges++; t.lastNudge = e.at; continue; }
    if (e.kind === "mark") { t.flags.push(String(e.words || "").trim()); continue; }
    // Something left out at the finish that happened after all. It moves from missed to met, so
    // the evening list and the block stop naming it; the finish itself keeps its time.
    if (e.kind === "met") {
      const items = e.met || [];
      const settled = new Set(items.map(itemKey));
      t.missed = (t.missed || []).filter((m) => !settled.has(itemKey(m)));
      t.met = [...(t.met || []), ...items];
      continue;
    }
    // Reopening undoes a close. When the close came from the record, that proof is remembered as
    // wrong for this task, so the next look at the record does not close it again with it.
    if (e.kind === "reopen") {
      if (t.state === "open") continue;
      if (t.evidence) t.rejected.push(t.evidence.id);
      Object.assign(t, { state: "open", met: [], missed: [], last: e.at });
      delete t.ended; delete t.evidence;
      continue;
    }
    // The first close wins. Two machines can each find the same proof before either has seen
    // the other's entry, and a second close must not move the time the task ended.
    if ((e.kind === "done" || e.kind === "drop") && t.state !== "open") continue;
    if (e.kind === "define") t.done_means.push(...(e.done_means || []));
    if (e.kind === "done") {
      Object.assign(t, { state: "done", ended: e.at, met: e.met || [], missed: e.missed || [] });
      // Closed from the record, not by the person: it ended when the proof happened (the post
      // went out), and the proof travels with it so every interface can say what it was.
      if (e.source === "evidence") {
        t.ended = e.evidence_at || e.at;
        t.evidence = { url: e.evidence || "", id: e.evidence_id || e.evidence || "", words: e.words || "", closed: e.at };
      }
    }
    if (e.kind === "drop") Object.assign(t, { state: "dropped", ended: e.at });
    t.last = e.at;
  }
  return [...map.values()];
}

const itemKey = (x) => String(x).trim().toLowerCase();

export const openTasks = (entries) => tasksFrom(entries).filter((t) => t.state === "open");

// Loose ends: finished tasks with something from their done definition still missing. They are
// named once, in the evening list after the finish, and in the per-turn block for a day, so a
// "the letter's signed now" lands on the right task. Nothing asks about them.
export const looseEnds = (entries) => tasksFrom(entries).filter((t) => t.state === "done" && (t.missed || []).length);

// For `met`: with no words, the most recently finished task that has a loose end.
export function resolveLooseEnd(entries, ref) {
  const pool = looseEnds(entries).sort((a, b) => a.ended.localeCompare(b.ended));
  if (!ref) return pool.at(-1) || null;
  const byId = pool.find((t) => t.id === ref);
  if (byId) return byId;
  const matches = pool.filter((t) => t.title.toLowerCase().includes(String(ref).toLowerCase()));
  if (matches.length > 1) return { ambiguous: matches.map((t) => t.title) };
  return matches[0] || null;
}

// Which missed item the person means: the same words, or the one item their words are part of
// (or that is part of their words). Anything less certain is null, and the caller asks.
export function matchItem(missed, said) {
  const k = itemKey(said);
  const exact = missed.find((m) => itemKey(m) === k);
  if (exact) return exact;
  const near = missed.filter((m) => itemKey(m).includes(k) || k.includes(itemKey(m)));
  return near.length === 1 ? near[0] : null;
}

// How long an open task is still worth showing: the evening list and the per-turn context both
// stop naming a task once it has been open this long, so this window is one number, not two.
export const RECENT_MINUTES = 3 * 24 * 60;

export const recentTasks = (entries, now) => openTasks(entries).filter((t) => minutesBetween(new Date(t.started), now) <= RECENT_MINUTES);

// includeClosed matters only for an exact id: closing the same task twice ("done" on a task
// already done) must not find it again by id, or it writes a second done entry. mark is the
// one caller that needs to reach a closed task by id (for example to flag it after the fact),
// so it alone passes includeClosed: true. A title-word search only ever looks at open tasks
// either way, since naming a finished task by its words is not something callers ask for.
export function resolveTask(entries, ref, { includeClosed = false } = {}) {
  const open = openTasks(entries);
  if (!ref) return open.at(-1) || null;
  const idPool = includeClosed ? tasksFrom(entries) : open;
  const byId = idPool.find((t) => t.id === ref);
  if (byId) return byId;
  const matches = open.filter((t) => t.title.toLowerCase().includes(String(ref).toLowerCase()));
  if (matches.length > 1) return { ambiguous: matches.map((t) => t.title) };
  return matches[0] || null;
}

// reopen is the one caller that names a finished task by its words ("that Substack one is not
// done"). With no words it means the task most recently closed from the record, since that is
// the close the person did not make themselves.
export function resolveClosed(entries, ref) {
  const closed = tasksFrom(entries).filter((t) => t.state !== "open");
  if (!ref) return closed.filter((t) => t.evidence).sort((a, b) => a.evidence.closed.localeCompare(b.evidence.closed)).at(-1) || null;
  const byId = closed.find((t) => t.id === ref);
  if (byId) return byId;
  const matches = closed.filter((t) => t.title.toLowerCase().includes(String(ref).toLowerCase()));
  if (matches.length > 1) return { ambiguous: matches.map((t) => t.title) };
  return matches[0] || null;
}
