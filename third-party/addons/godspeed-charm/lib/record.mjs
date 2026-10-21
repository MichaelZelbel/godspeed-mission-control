// The record of the challenge: every event is one row of the charm tracker in the notebook. Each
// row carries data.when, the instant it happened, and data.date, the local day in the person's
// timezone, which is what the count works on (a slip at 23:30 Berlin time belongs to that day,
// whatever the server's clock says).
import { SPECIALIST, findTracker, readItems, createTracker, writeItems, withNotebookLock } from "./notebook.mjs";
import { loadSettings } from "./settings.mjs";
import { localParts, now as clockNow } from "./clock.mjs";

export const KINDS = Object.freeze(["start", "asked", "reset", "kept", "finish", "stop"]);
export const FIELDS = Object.freeze([
  { key: "when", label: "When", type: "datetime", primary: true },
  { key: "kind", label: "Kind", type: "select", options: [...KINDS] },
  { key: "date", label: "Day", type: "date" },
  { key: "words", label: "In their words", type: "longtext" },
  { key: "conversation", label: "Conversation", type: "text" },
].map((f) => Object.freeze(f)));
export const NAMES = Object.freeze(["Charm Challenge", "Charm"]);

// The local day (YYYY-MM-DD) an instant falls on in a timezone.
export const localDate = (when, tz) => localParts(when, tz).date;

const toEvent = (item) => {
  const d = item.data;
  if (!d || typeof d !== "object" || typeof d.kind !== "string" || !d.kind || typeof d.when !== "string" || Number.isNaN(Date.parse(d.when))) return null;
  const event = { kind: d.kind, when: d.when, date: typeof d.date === "string" ? d.date : d.when.slice(0, 10) };
  if (typeof d.words === "string" && d.words) event.words = d.words;
  if (typeof d.conversation === "string" && d.conversation) event.conversation = d.conversation;
  return event;
};

// The events of a list of rows, in time order; a row nobody can read is skipped. The notebook reads
// its own copy of the rows through this (its chat-context.mjs), so both read them the same way.
export function eventsFromItems(items) {
  const events = (Array.isArray(items) ? items : []).map((item) => (item && typeof item === "object" ? toEvent(item) : null)).filter(Boolean);
  return events.map((e, i) => [e, i]).sort((a, b) => a[0].when.localeCompare(b[0].when) || a[1] - b[1]).map((p) => p[0]);
}

// The events in time order. No tracker yet is an empty list.
export function readEvents(mcDir) {
  return eventsFromItems(readItems(mcDir, findTracker(mcDir)));
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
  const data = { kind: event.kind, when: event.when, date };
  if (event.words) { data.words = event.words; written.words = event.words; }
  if (event.conversation) { data.conversation = event.conversation; written.conversation = event.conversation; }
  const title = event.kind.charAt(0).toUpperCase() + event.kind.slice(1) + " " + date;
  withNotebookLock(mcDir, () => {
    const tracker = findTracker(mcDir) || createTracker(mcDir, { fields: FIELDS.map((f) => ({ ...f })), names: [...NAMES], now });
    writeItems(mcDir, tracker, { put: [{ data, title }] }, now);
  }, lockTimeoutMs > 0 ? { timeoutMs: lockTimeoutMs } : undefined);
  return written;
}

export { SPECIALIST };
