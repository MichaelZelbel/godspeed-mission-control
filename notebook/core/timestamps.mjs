// Timestamps in the shape Menerio's database service (PostgREST) gave the
// screens: ISO 8601 with a "T", "2026-10-05T00:00:00+00:00".
//
// Postgres itself writes a timestamp as text with a space and a short offset,
// "2026-10-05 00:00:00+00". The Menerio import read that text form, and
// assistant proposals kept whatever the model wrote ("2026-10-11
// 00:00:00+02:00"), so moments carried the space form. The Menerio screens cut
// a moment's date at the "T", so the edit dialog put the whole text into a date
// field that cannot show it, and the start and end dates looked empty
// (10 October 2026). The clock time and offset are kept as written: turning
// "2026-10-11 00:00:00+02:00" into UTC would move the moment to the day before.

const POSTGRES_TEXT = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}(?::?\d{2})?)?$/;

/** A timestamp in Postgres' text form as ISO 8601; every other value as it is. */
export function isoTimestamp(value) {
  if (typeof value !== 'string') return value;
  const match = POSTGRES_TEXT.exec(value.trim());
  if (!match) return value;
  let [, day, time, zone] = match;
  if (time.length === 5) time += ':00';
  if (zone && zone !== 'Z') {
    const digits = zone.slice(1).replace(':', '');
    zone = zone[0] + digits.slice(0, 2) + ':' + (digits.slice(2, 4) || '00');
  }
  return day + 'T' + time + (zone || '');
}

/**
 * A moment (or a change to one) with its dates in ISO form. Only the date
 * fields it carries are touched, so a change that leaves a date out still
 * leaves it out. The same object comes back when nothing needed changing.
 */
export function momentDates(row) {
  if (!row || typeof row !== 'object') return row;
  let next = row;
  for (const key of ['happened_at', 'happened_end']) {
    if (!(key in row)) continue;
    const value = isoTimestamp(row[key]);
    if (value !== row[key]) { if (next === row) next = { ...row }; next[key] = value; }
  }
  return next;
}

/**
 * Every top-level timestamp of a source row in ISO form, as PostgREST hands a
 * row out. Values inside JSON columns are left as they were stored.
 */
export function isoTimestamps(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
  let next = row;
  for (const [key, old] of Object.entries(row)) {
    const value = isoTimestamp(old);
    if (value !== old) { if (next === row) next = { ...row }; next[key] = value; }
  }
  return next;
}
