// The record of the challenge: every event is one row of the charm tracker in the notebook. Each
// row carries data.when, the time it happened on the person's own clock ("2026-10-12 10:00", which
// the notebook's record page shows as the row's name, as the headache's rows read), data.at, the
// exact moment (so events within one minute read in the order they happened), and data.date, the
// local day in the person's timezone, which is what the count works on (a slip at 23:30 Berlin time
// belongs to that day, whatever the server's clock says). Rows written before 21 October 2026 carry
// the exact moment in data.when itself, and still read.
import { SPECIALIST, findTracker, readItems, createTracker, writeItems, withNotebookLock } from "./notebook.mjs";
import { loadSettings } from "./settings.mjs";
import { localParts, localToInstant, now as clockNow } from "./clock.mjs";

export const KINDS = Object.freeze(["start", "asked", "reset", "kept", "finish", "stop"]);
export const FIELDS = Object.freeze([
  { key: "when", label: "When", type: "datetime", primary: true },
  { key: "kind", label: "Kind", type: "select", options: [...KINDS] },
  { key: "date", label: "Day", type: "date" },
  { key: "words", label: "In their words", type: "longtext" },
  { key: "conversation", label: "Conversation", type: "text" },
  { key: "at", label: "Recorded", type: "datetime" },
].map((f) => Object.freeze(f)));
export const NAMES = Object.freeze(["Charm Challenge", "Charm"]);

// The local day (YYYY-MM-DD) an instant falls on in a timezone.
export const localDate = (when, tz) => localParts(when, tz).date;

// "2026-10-12 10:00": an instant as the wall clock in tz shows it, to the minute.
export const localStamp = (when, tz) => { const p = localParts(when, tz); return `${p.date} ${p.hm}`; };

// The moment a row stands for, as an ISO string, or null when its time cannot be read. What the
// table says counts: `at` refines the order only while it falls in the minute `when` shows, so a
// time he changed in the notebook (its editor writes "2026-10-12T09:15") is the time that counts.
const ZONED = /(?:Z|[+-]\d{2}:?\d{2})$/i;
const WALL = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?)?$/;
const exact = (value) => { const s = typeof value === "string" ? value.trim() : ""; return s && ZONED.test(s) && !Number.isNaN(Date.parse(s)) ? s : null; };
function momentOf(d, tz) {
  const when = typeof d.when === "string" ? d.when.trim() : "";
  if (exact(when)) return when;
  const m = when.match(WALL);
  if (!m) return null;
  const [, day, h = "0", min = "00", s = "0", ms = "0"] = m, hm = `${h.padStart(2, "0")}:${min}`;
  const midnight = Date.parse(day + "T00:00:00Z");
  if (+h > 23 || +min > 59 || +s > 59 || Number.isNaN(midnight) || new Date(midnight).toISOString().slice(0, 10) !== day) return null;
  const at = exact(d.at);
  if (at && m[4] === undefined && localStamp(new Date(at), tz) === `${day} ${hm}`) return at;
  const wall = localToInstant(day, hm, tz);
  return new Date(wall.getTime() + Number(s) * 1000 + Number(ms.padEnd(3, "0"))).toISOString();
}

const toEvent = (item, tz) => {
  const d = item.data;
  if (!d || typeof d !== "object" || typeof d.kind !== "string" || !d.kind || typeof d.when !== "string") return null;
  let when;
  try { when = momentOf(d, tz); } catch { return null; }
  if (!when) return null;
  const event = { kind: d.kind, when, date: typeof d.date === "string" ? d.date : d.when.trim().slice(0, 10) };
  if (typeof d.words === "string" && d.words) event.words = d.words;
  if (typeof d.conversation === "string" && d.conversation) event.conversation = d.conversation;
  return event;
};

// The events of a list of rows, in time order; a row nobody can read is skipped. The notebook reads
// its own copy of the rows through this (its chat-context.mjs), so both read them the same way.
// tz: the settings' timezone, the clock the rows' times are on.
export function eventsFromItems(items, tz = "UTC") {
  const events = (Array.isArray(items) ? items : []).map((item) => (item && typeof item === "object" ? toEvent(item, tz) : null)).filter(Boolean);
  return events.map((e, i) => [e, i, Date.parse(e.when)]).sort((a, b) => a[2] - b[2] || a[1] - b[1]).map((p) => p[0]);
}

// The events in time order. No tracker yet is an empty list. Without a timezone, the settings' one
// (UTC when they cannot be read: every command refuses then anyway, and the context block is quiet).
export function readEvents(mcDir, tz) {
  if (!tz) { try { tz = loadSettings(mcDir).timezone; } catch { tz = "UTC"; } }
  return eventsFromItems(readItems(mcDir, findTracker(mcDir)), tz);
}

// Writes one event. The day comes from the settings' timezone (a corrupt settings file throws, so
// nothing is filed on a guessed day). The first write creates the tracker.
// lockTimeoutMs: how long to wait for a busy notebook before giving up (default the lock's own 20 s);
// the context block waits only a moment, since a hook that stalls holds up the person's message.
export function appendEvent(mcDir, event, now = clockNow(), { lockTimeoutMs } = {}) {
  const tz = loadSettings(mcDir).timezone;
  const when = new Date(event.when);
  if (Number.isNaN(when.getTime())) throw new Error(`"${event.when}" is not a time.`);
  const date = localDate(when, tz);
  const written = { kind: event.kind, when: event.when, date };
  const data = { kind: event.kind, when: localStamp(when, tz), date };
  if (event.words) { data.words = event.words; written.words = event.words; }
  if (event.conversation) { data.conversation = event.conversation; written.conversation = event.conversation; }
  data.at = event.when;
  const title = event.kind.charAt(0).toUpperCase() + event.kind.slice(1) + " " + date;
  withNotebookLock(mcDir, () => {
    const tracker = findTracker(mcDir) || createTracker(mcDir, { fields: FIELDS.map((f) => ({ ...f })), names: [...NAMES], now });
    writeItems(mcDir, tracker, { put: [{ data, title }] }, now);
  }, lockTimeoutMs > 0 ? { timeoutMs: lockTimeoutMs } : undefined);
  return written;
}

export { SPECIALIST };
