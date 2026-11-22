/**
 * Date-only values ("2026-09-16") mean a calendar day, not an instant.
 *
 * `new Date("2026-09-16")` is midnight UTC, so west of UTC it renders as the
 * day before, and east of UTC a thing due today counts as overdue from 02:00.
 * Moments store their day as a timestamptz at UTC midnight, so their first ten
 * characters are the day too. Everything here reads and compares the day in
 * the viewer's local calendar.
 *
 * `showDate` is the one way a stored date is shown. It takes a kind: "day"
 * reads the calendar day a value names (a date column, or a moment's day
 * stored as UTC-midnight timestamptz), "date" reads an instant as the viewer's
 * local day, "time" adds the local clock time, "ago" says how long ago it was.
 * A missing or unreadable value reads "Not set"; the helper never throws.
 */
import { format, formatDistanceToNow, isValid, parse } from "date-fns";
import { todayISO } from "./claims";

const DAY_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;
const PLAIN_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD of a Date in local time. */
export { todayISO as localDateISO };

/** The calendar day of a stored date or timestamp, as YYYY-MM-DD. */
export function dayOf(value: string): string {
  return value.slice(0, 10);
}

/** The one way a stored day is shown: "Nov 21, 2026". */
export const DAY_FORMAT = "MMM d, yyyy";

/** The one way a stored day with its clock time is shown: "Nov 21, 2026, 14:05". */
export const TIME_FORMAT = "MMM d, yyyy, HH:mm";

/** What a missing or unreadable date reads as. */
export const NOT_SET = "Not set";

/** How a stored date is shown. */
export type DateShown = "day" | "date" | "time" | "ago";

/**
 * Local midnight of the day a date-only value (or a moment's timestamp) names,
 * for display with toLocaleDateString / date-fns format. Null when unparseable.
 */
export function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = DAY_PREFIX.exec(value);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const fallback = new Date(value);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

/** True when a due date's day is before today's local day. Due today is not overdue. */
export function isPastDay(value: string | null | undefined, now: Date = new Date()): boolean {
  if (!value || !DAY_PREFIX.test(value)) return false;
  return dayOf(value) < todayISO(now);
}

/**
 * A stored instant (timestamp string, epoch ms or Date) as a Date; a plain
 * day is that day's local midnight. Null when missing or unreadable.
 */
export function parseInstant(value: string | number | Date | null | undefined): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : new Date(value.getTime());
  if (typeof value === "string" && PLAIN_DAY.test(value)) return parseDateOnly(value);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "HH:mm" of a stored instant in local time, for time inputs and "today at 14:05". */
export function localTimeHM(value: string | number | Date | null | undefined): string {
  const d = parseInstant(value);
  if (!d) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const TYPED_DAY_FORMATS = ["yyyy-MM-dd", "dd.MM.yyyy", "MM/dd/yyyy", "yyyy/MM/dd"];

/**
 * A day the user typed (yyyy-MM-dd, dd.MM.yyyy, MM/dd/yyyy, yyyy/MM/dd) as a
 * local Date, or null.
 */
export function parseTypedDay(text: string): Date | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  for (const fmt of TYPED_DAY_FORMATS) {
    const d = parse(trimmed, fmt, new Date());
    if (isValid(d)) return d;
  }
  return null;
}

/**
 * The one way a stored date is shown. Missing or unreadable reads "Not set",
 * never throws.
 */
export function showDate(value: string | number | Date | null | undefined, kind: DateShown = "date"): string {
  try {
    if (kind === "day") {
      const d = typeof value === "string" ? parseDateOnly(value) : parseInstant(value);
      return d ? format(d, DAY_FORMAT) : NOT_SET;
    }
    const d = parseInstant(value);
    if (!d) return NOT_SET;
    if (kind === "date") return format(d, DAY_FORMAT);
    if (kind === "time") return format(d, TIME_FORMAT);
    return formatDistanceToNow(d, { addSuffix: true });
  } catch {
    return NOT_SET;
  }
}
