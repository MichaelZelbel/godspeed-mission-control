import { LENGTH } from "../../../../third-party/addons/godspeed-charm/lib/count.mjs";
import { formatDay } from "../../../../third-party/addons/godspeed-charm/lib/texts.mjs";

// Trackers sit on their own shelf; one with no entry for 30 days rests in a
// folded part of it (D-321). Nothing here deletes or hides data. The same
// 30 days as the notebook's own rule (notebook/core/trackers.mjs REST_DAYS).
const REST_DAYS = 30;
type Row = { id: string; created_at?: string | null; tracker?: unknown };
const rests = (c: Row, lastWhen: Record<string, string | undefined>, now: Date) => {
  const day = (lastWhen[c.id] || c.created_at || "").slice(0, 10);
  return (now.getTime() - Date.parse(day + "T00:00:00Z")) / 86400000 > REST_DAYS;
};

// The Charm Challenge's tracker has a card of its own (charmShelf), so it is never also a plain tracker card.
export function shelve<T extends Row>(collections: T[], lastWhen: Record<string, string | undefined>, now: Date) {
  const trackers: T[] = [], resting: T[] = [], others: T[] = [];
  for (const c of collections) {
    if (!c.tracker || typeof c.tracker !== "object") { others.push(c); continue; }
    if (isCharm(c)) continue;
    (rests(c, lastWhen, now) ? resting : trackers).push(c);
  }
  return { trackers, resting, others };
}

// The Charm Challenge (spec 2026-10-21, "Notebook card"): 21 days of charming the AI instead of
// arguing with it, kept by the charm add-on. tracker-list gives its tracker the add-on's count as
// `charm` (null when the record could not be counted) and its brief line. It is not a habit: no
// "I did it", no streak. While it runs its card is always on the shelf, however long ago its last
// row was written; a stopped or finished one rests after 30 days like any other tracker. When the
// count or the entries' days could not be read, nothing is folded away on a guess.
export type CharmState = {
  running: boolean; started: string | null; end: string | null; day: number | null; daysToGo: number | null;
  restarts: number; longestRun: number; kept: number; needsFinish: boolean; finishedOn: string | null;
};
export type CharmCardData<C> = { collection: C; charm: CharmState | null; brief: string | null };
export type CharmListed = { id: string; specialist?: string | null; charm?: CharmState | null; brief?: string | null };
export const isCharm = (c: { tracker?: unknown }) => !!c.tracker && typeof c.tracker === "object" && (c.tracker as { specialist?: unknown }).specialist === "charm";
export function charmShelf<C extends Row>(collections: C[], listed: CharmListed[], lastWhen: Record<string, string | undefined> | null, now: Date) {
  const active: CharmCardData<C>[] = [], resting: CharmCardData<C>[] = [];
  for (const collection of collections.filter(isCharm)) {
    const entry = listed.find((t) => t.id === collection.id && t.specialist === "charm");
    const card = { collection, charm: entry?.charm ?? null, brief: entry?.brief ?? null };
    (card.charm && !card.charm.running && lastWhen && rests(collection, lastWhen, now) ? resting : active).push(card);
  }
  return { active, resting };
}

// What the card says, in the add-on's own words for the day ("done on Wednesday 11 November").
// `big` is the big number or word, `unit` the words beside it, `spoken` the sentence a screen
// reader hears instead of the two, `after` the line under them. `quiet`: a state, not a count, so
// it is not shown as large as one.
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
export function charmCardText(charm: CharmState | null) {
  if (!charm) return { big: null, unit: "", spoken: "", after: "The count could not be read right now.", stats: null, hint: null };
  const stats = charm.started ? { shown: `Restarts: ${charm.restarts} · Longest run: ${plural(charm.longestRun, "day", "days")}`, spoken: `Restarts: ${charm.restarts}. Longest run: ${plural(charm.longestRun, "day", "days")}.` } : null;
  const done = charm.end && (charm.running ? charm.needsFinish : Boolean(charm.finishedOn));
  if (done) return { big: "Done", unit: "", spoken: `Done: ${LENGTH} days, finished on ${formatDay(charm.end)}.`, after: `on ${formatDay(charm.end)}`, stats, hint: null };
  if (charm.running && charm.end && charm.daysToGo !== null) {
    const unit = charm.daysToGo === 1 ? "day to go" : "days to go";
    return { big: String(charm.daysToGo), unit, spoken: `${charm.daysToGo} ${unit}, done on ${formatDay(charm.end)}.`, after: `done on ${formatDay(charm.end)}`, stats, hint: null };
  }
  return { big: "Not running", quiet: true, unit: "", spoken: "The Charm Challenge is not running.", after: "", stats, hint: 'Say "start the Charm Challenge" to begin.' };
}

// The latest `when` ("2026-10-09", or "2026-10-09 06:30") among each
// tracker's entries, by collection id.
export function lastEntryDays(items: { collection_id: string; data?: unknown }[]) {
  const last: Record<string, string> = {};
  for (const item of items) {
    const when = item.data && typeof item.data === "object" ? (item.data as { when?: unknown }).when : undefined;
    if (typeof when !== "string" || !when) continue;
    if (!last[item.collection_id] || when > last[item.collection_id]) last[item.collection_id] = when;
  }
  return last;
}

// Habits are trackers too (D-321, step 3), made from the coach's own habit files: tracker-list
// gives them with specialist "habit". An active habit is on the shelf; a paused, graduated or
// dropped one rests in the folded part, with every day it ever had.
type Listed = { id: string; specialist?: string | null; status?: string };
export function habitShelf<T extends Listed>(listed: T[]) {
  const habits = listed.filter((t) => t.specialist === "habit");
  return { active: habits.filter((t) => t.status === "active"), resting: habits.filter((t) => t.status !== "active") };
}

// A habit's tracked days, newest first, as the habit page lists them.
type Day = { when?: string; data?: { answer?: string; note?: string } | null };
export function habitDays(habit: { recent?: Day[] | null }) {
  return [...(habit.recent ?? [])]
    .filter((d) => typeof d.when === "string" && d.data?.answer)
    .sort((a, b) => String(b.when).localeCompare(String(a.when)))
    .map((d) => ({ day: String(d.when), answer: String(d.data?.answer), note: String(d.data?.note ?? "") }));
}

// The talks that read a tracker, as the shelf names them: "health talk", "health and psychology talks",
// "health, work and money talks". Any number of talks may read a tracker (the decision of 13
// October 2026), so tracker-list gives `talks`; a notebook from before that day gave one `talk`.
const talkName = (talk: string) => (talk === "work-money" ? "work and money" : talk.replace(/-/g, " "));
export function talksLabel(tracker: { talks?: string[] | null; talk?: string | null }) {
  const names = (Array.isArray(tracker.talks) ? tracker.talks : tracker.talk ? [tracker.talk] : []).filter(Boolean).map(talkName);
  if (!names.length) return "";
  const list = names.length < 2 ? names[0] : names.slice(0, -1).join(", ") + " and " + names[names.length - 1];
  return list + (names.length > 1 ? " talks" : " talk");
}
