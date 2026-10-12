// Trackers sit on their own shelf; one with no entry for 30 days rests in a
// folded part of it (D-321). Nothing here deletes or hides data. The same
// 30 days as the notebook's own rule (notebook/core/trackers.mjs REST_DAYS).
const REST_DAYS = 30;
type Row = { id: string; created_at?: string | null; tracker?: unknown };

export function shelve<T extends Row>(collections: T[], lastWhen: Record<string, string | undefined>, now: Date) {
  const trackers: T[] = [], resting: T[] = [], others: T[] = [];
  for (const c of collections) {
    if (!c.tracker || typeof c.tracker !== "object") { others.push(c); continue; }
    const day = (lastWhen[c.id] || c.created_at || "").slice(0, 10);
    const age = (now.getTime() - Date.parse(day + "T00:00:00Z")) / 86400000;
    (age > REST_DAYS ? resting : trackers).push(c);
  }
  return { trackers, resting, others };
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
