// One headache is one row of the Headaches tracker, and one pill taken with no headache going on
// is a row of its own (it is still a painkiller day). This module turns a row into the headache the
// rest of the add-on knows (the shape episodesFrom gives) and a headache back into a row, and
// applies what one command says (a start, a detail, a pill, the end, a cancel) to the rows, by the
// same rules episodesFrom applies to the old entry files.
//
// What the table says is what counts: he can edit any row in the notebook, and the next command
// reads his edit. Start and end give the minutes; `pain` is the strongest, `pain_first` the first
// he gave. Times are local wall time in the diary's time zone, "YYYY-MM-DD HH:MM", with seconds and
// milliseconds only where a time had them (the history moved from the entry files keeps them, so
// it is exact to the millisecond).
import { localParts } from "./clock.mjs";
import { localToInstant } from "./when.mjs";
import { normSide, normQuality, parseMed } from "./episodes.mjs";

export const FIELDS = Object.freeze([
  { key: "when", label: "Started", type: "datetime", primary: true },
  { key: "end", label: "Ended", type: "datetime" },
  { key: "minutes", label: "Minutes", type: "number" },
  { key: "pain", label: "Strongest pain", type: "number" },
  { key: "pain_first", label: "First pain", type: "number" },
  { key: "side", label: "Where", type: "text" },
  { key: "quality", label: "Feels like", type: "text" },
  { key: "symptoms", label: "Symptoms", type: "text" },
  { key: "triggers", label: "Possible trigger", type: "text" },
  { key: "medication", label: "Medication", type: "text" },
  { key: "words", label: "In your words", type: "longtext" },
  { key: "episode", label: "Id", type: "text" },
  { key: "kind", label: "Kind", type: "select", options: ["headache", "pill"] },
].map((f) => Object.freeze(f)));
const OWN = new Set(FIELDS.map((f) => f.key));
export const NAMES = Object.freeze(["Headaches", "Headache", "Kopfschmerzen", "Kopfweh"]);

// "2026-10-12 06:30", "2026-09-28 08:38:34.924": an instant as the wall clock in tz shows it.
export function localStamp(value, tz) {
  const d = new Date(value), p = localParts(d, tz), seconds = p.hms.slice(4, 6), ms = d.getUTCMilliseconds();
  return `${p.date} ${p.hm}${seconds !== "00" || ms ? ":" + seconds : ""}${ms ? "." + String(ms).padStart(3, "0") : ""}`;
}
// Back to an instant. Also what the notebook's table writes ("2026-10-12T06:30"), a day alone, or
// a time with its offset. Null for anything else.
export function instantOf(value, tz) {
  if (value === null || value === undefined || value === "") return null;
  const s = String(value).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?)?\s*(Z|[+-]\d{2}:?\d{2})?$/i);
  if (!m) return null;
  if (m[6]) { const d = new Date(s.replace(" ", "T")); return Number.isNaN(d.getTime()) ? null : d; }
  const hm = `${String(m[2] ?? "0").padStart(2, "0")}:${m[3] ?? "00"}`;
  if (+hm.slice(0, 2) > 23 || +hm.slice(3) > 59) return null;
  const base = localToInstant(m[1], hm, tz);
  if (Number.isNaN(base.getTime())) return null;
  return new Date(base.getTime() + Number(m[4] || 0) * 1000 + Number((m[5] || "").padEnd(3, "0") || 0));
}

const list = (value) => [...new Set(String(value ?? "").split(/\s*[,;]\s*/).map((x) => x.trim().toLowerCase()).filter(Boolean))];
const num = (value) => { if (value === null || value === undefined || value === "") return null; const n = Number(String(value).replace(",", ".")); return Number.isFinite(n) ? n : null; };

// "Thomapyrin Intensiv: 2 tablets at 08:20; Ibuprofen at 2026-10-13 01:10". A pill with no time is
// taken at the start of the row.
export function parseMeds(text, start, tz) {
  const startDay = start ? localParts(start, tz).date : null, out = [];
  for (const part of String(text ?? "").split(/\s*;\s*/).map((x) => x.trim()).filter(Boolean)) {
    const m = part.match(/^(.*?)\s+at\s+(?:(\d{4}-\d{2}-\d{2})[ T])?(\d{1,2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)\s*$/i);
    const med = parseMed(m ? m[1] : part);
    if (!med) continue;
    let taken = start;
    if (m && (m[2] || startDay)) taken = instantOf(`${m[2] || startDay} ${m[3]}`, tz) || start;
    out.push({ med: med.med, dose: med.dose, taken: taken ? taken.toISOString() : null });
  }
  return out;
}
export function formatMeds(meds, start, tz) {
  const startDay = start ? localParts(new Date(start), tz).date : null;
  return meds.map((m) => {
    const stamp = m.taken ? localStamp(m.taken, tz) : "";
    const time = stamp && stamp.slice(0, 10) === startDay ? stamp.slice(11) : stamp;
    return `${m.med}${m.dose ? ": " + m.dose : ""}${time ? " at " + time : ""}`;
  }).join("; ");
}

// The rows as the headaches and loose pills episodesFrom would give for the same diary. Each
// headache carries `item`, the row it came from.
export function logFromRows(items, tz) {
  const episodes = [], loose = [];
  for (const item of items) {
    const d = item.data && typeof item.data === "object" ? item.data : {};
    const start = instantOf(d.when, tz);
    if (String(d.kind || "").toLowerCase() === "pill") {
      for (const m of parseMeds(d.medication, start, tz)) if (m.taken) loose.push({ ...m, item: item.id });
      continue;
    }
    if (!start) continue;
    const end = instantOf(d.end, tz);
    const strongest = num(d.pain), given = num(d.pain_first);
    const pain_max = strongest ?? given, pain_first = given === null ? pain_max : pain_max === null ? given : Math.min(given, pain_max);
    episodes.push({
      id: String(d.episode || "").trim() || item.id, item: item.id,
      start: start.toISOString(), end: end ? end.toISOString() : null, cancelled: false,
      pains: pain_first === null ? [] : pain_first === pain_max ? [{ pain: pain_first }] : [{ pain: pain_first }, { pain: pain_max }],
      side: d.side ? normSide(String(d.side)) : null, quality: d.quality ? normQuality(String(d.quality)) : null,
      symptoms: list(d.symptoms), triggers: list(d.triggers), meds: parseMeds(d.medication, start, tz).filter((m) => m.taken),
      words: String(d.words ?? "").trim() ? [String(d.words).trim()] : [],
      open: !end, pain_max, pain_first,
      minutes: end ? Math.round((end.getTime() - start.getTime()) / 60000) : null,
    });
  }
  episodes.sort((a, b) => a.start.localeCompare(b.start));
  return { episodes, loose };
}

// A headache (or a loose pill row) as the row's data. Fields he added to the tracker himself stay
// as they were (`keep`); empty values are left out.
export function rowData(state, tz, keep = {}) {
  const out = Object.fromEntries(Object.entries(keep || {}).filter(([k]) => !OWN.has(k)));
  const set = (key, value) => { if (value !== null && value !== undefined && value !== "") out[key] = value; };
  if (state.kind === "pill") {
    set("when", localStamp(state.meds[0].taken, tz));
    set("medication", formatMeds(state.meds, state.meds[0].taken, tz));
    set("words", state.words.join("\n").trim());
    set("kind", "pill");
    return out;
  }
  const pains = state.pains.map((p) => (typeof p === "object" ? p.pain : p)).filter((p) => p !== null && p !== undefined && !Number.isNaN(p));
  set("when", localStamp(state.start, tz));
  if (state.end) set("end", localStamp(state.end, tz));
  if (state.end) set("minutes", Math.round((Date.parse(state.end) - Date.parse(state.start)) / 60000));
  if (pains.length) { set("pain", Math.max(...pains)); set("pain_first", pains[0]); }
  set("side", state.side);
  set("quality", state.quality);
  set("symptoms", state.symptoms.join(", "));
  set("triggers", state.triggers.join(", "));
  set("medication", formatMeds(state.meds, state.start, tz));
  set("words", state.words.join("\n").trim());
  set("episode", state.id);
  set("kind", "headache");
  return out;
}

const RANK = { start: 0, set: 1, med: 2, end: 3, cancel: 4 };
// What one command says, applied to the rows: the headaches it changes or starts, the pill rows it
// adds and the rows it removes, by the rules of episodesFrom. `log` is logFromRows of the rows now.
export function applyEntries(log, entries) {
  const byId = new Map(log.episodes.map((e) => [e.id, { ...e, pains: e.pains.map((p) => p.pain), symptoms: [...e.symptoms], triggers: [...e.triggers], meds: [...e.meds], words: [...e.words] }]));
  const touched = new Set(), removed = new Set(), pills = [];
  const ordered = [...entries].sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")) || (RANK[a.kind] ?? 5) - (RANK[b.kind] ?? 5));
  for (const e of ordered) {
    if (e.kind === "med" && !e.episode) {
      const pill = pills.at(-1);
      const med = { med: e.med, dose: e.dose || "", taken: e.taken || e.at };
      if (pill) { pill.meds.push(med); if (e.words) pill.words.push(e.words); }
      else pills.push({ kind: "pill", meds: [med], words: e.words ? [e.words] : [] });
      continue;
    }
    if (e.kind === "start") {
      if (!byId.has(e.episode)) byId.set(e.episode, { id: e.episode, item: null, start: e.start, end: null, pains: [], side: null, quality: null, symptoms: [], triggers: [], meds: [], words: [] });
    }
    const ep = e.episode && byId.get(e.episode);
    if (!ep) continue;
    touched.add(ep.id);
    if (e.kind === "cancel") { removed.add(ep.id); continue; }
    if (e.kind === "start" && e.start) ep.start = e.start;
    if (e.kind === "end") ep.end = e.end || e.at;
    if (e.kind === "set" && e.start) ep.start = e.start;
    if (e.kind === "set" && e.end) ep.end = e.end;
    if (e.kind !== "end" && e.pain !== undefined && e.pain !== null && !Number.isNaN(e.pain)) ep.pains.push(e.pain);
    if (e.side) ep.side = e.side;
    if (e.quality) ep.quality = e.quality;
    for (const x of e.symptoms || []) if (!ep.symptoms.includes(x)) ep.symptoms.push(x);
    for (const x of e.triggers || []) if (!ep.triggers.includes(x)) ep.triggers.push(x);
    if (e.kind === "med") ep.meds.push({ med: e.med, dose: e.dose || "", taken: e.taken || e.at });
    if (e.words) ep.words.push(e.words);
  }
  const changed = [...touched].filter((id) => !removed.has(id)).map((id) => byId.get(id));
  return { changed, removed: [...removed].map((id) => byId.get(id)).filter((e) => e.item), pills };
}
