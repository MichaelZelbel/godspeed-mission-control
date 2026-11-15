// One Hevy workout is one row of the Workouts tracker. This module turns a workout into the row's
// cells, and says what the tracker itself looks like. Nothing here reads or writes anything.
//
// A row: when it started and ended (the person's wall clock, "2026-10-23 18:05"), the minutes, the
// workout's title, every exercise with every set in Hevy's order ("Bench press: 8 x 60 kg"),
// the number of sets, the volume (reps x weight over every set except warm-ups) and the workout's
// notes. "Your comment" is the person's: no code here ever fills it.
import { localStamp } from "./clock.mjs";

export const SOURCE = "godspeed-workouts";
export const SPECIALIST = "workouts";

export function fieldsFor(units = { weight: "kg" }) {
  return [
    { key: "when", label: "Started", type: "datetime", primary: true },
    { key: "workout", label: "Workout", type: "text" },
    { key: "end", label: "Ended", type: "datetime" },
    { key: "minutes", label: "Minutes", type: "number", unit: "min" },
    { key: "exercises", label: "Exercises and sets", type: "longtext" },
    { key: "sets", label: "Sets", type: "number" },
    { key: "volume", label: "Volume", type: "number", unit: units.weight === "lb" ? "lb" : "kg" },
    { key: "notes", label: "Notes", type: "longtext" },
    { key: "comment", label: "Your comment", type: "longtext" },
  ];
}
// The cells the add-on fills. "Your comment", and every column the person adds, are theirs.
export const OWNED = ["when", "workout", "end", "minutes", "exercises", "sets", "volume", "notes"];
export const THEIRS = "comment";

export function trackerShape(settings, { talks = [], units } = {}) {
  return {
    name: settings.tracker,
    icon: "🏋️",
    visibility: "personal",
    source_app: SOURCE,
    field_schema: fieldsFor(units),
    tracker: { names: [...new Set([settings.tracker, ...(settings.names || [])])], cadence: "any", talks, specialist: SPECIALIST },
    description: "Every workout you log in Hevy, one row each, within the hour: when it started and ended, every exercise with every set (reps x weight, RPE when you gave one), the number of sets, the volume (reps x weight over every set except warm-ups) and your notes. Kept by godspeed-workouts. Change a workout in Hevy and its row follows. A cell you change here stays as you wrote it. \"Your comment\" and any column you add are yours.",
    agent_instructions: "Kept by godspeed-workouts from the person's Hevy app: one row per workout, brought level with Hevy every hour. Read it for what they trained, how often and how heavy. To change a workout, they change it in Hevy. A cell they changed here is theirs and no longer follows Hevy. \"Your comment\" is theirs alone. Do not add rows for Hevy workouts by hand.",
  };
}

// 62.5 -> "62.5", 10 -> "10", 61.234960 -> "61.23".
const num = (n, digits = 2) => String(Number(Number(n).toFixed(digits)));
const pos = (n) => typeof n === "number" && Number.isFinite(n) && n > 0;
const KG_PER_LB = 0.45359237;

function weightText(kg, unit) {
  return unit === "lb" ? `${num(kg / KG_PER_LB, 1)} lb` : `${num(kg)} kg`;
}
function distanceText(m, unit) {
  if (unit === "mi") return `${num(m / 1609.344)} mi`;
  return m >= 1000 ? `${num(m / 1000)} km` : `${num(m, 0)} m`;
}
// 45 -> "45 s", 90 -> "1:30 min", 3723 -> "1:02:03 h".
export function durationText(sec) {
  const s = Math.round(sec);
  if (s < 60) return `${s} s`;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${r} h` : `${m}:${r} min`;
}
const oneLine = (t) => String(t ?? "").replace(/\s+/g, " ").trim();

// "40 x 10 kg", "12 reps", "5 km in 25:00 min", "warm-up 12 x 40 kg", "8 x 62.5 kg (drop set, RPE 9)".
export function setText(s, units = {}) {
  const w = units.weight === "lb" ? "lb" : "kg", d = units.distance === "mi" ? "mi" : "km";
  const reps = pos(s.reps) ? s.reps : null;
  // A weight of 0 is no weight; a negative one is an assisted lift ("-20 kg" of help), kept as given.
  const kg = typeof s.weight_kg === "number" && Number.isFinite(s.weight_kg) && s.weight_kg !== 0 ? s.weight_kg : null;
  const pieces = [];
  if (reps !== null && kg !== null) pieces.push(`${num(reps)} x ${weightText(kg, w)}`);
  else if (reps !== null) pieces.push(`${num(reps)} ${reps === 1 ? "rep" : "reps"}`);
  else if (kg !== null) pieces.push(weightText(kg, w));
  if (pos(s.distance_meters)) pieces.push(pieces.length ? `over ${distanceText(s.distance_meters, d)}` : distanceText(s.distance_meters, d));
  if (pos(s.duration_seconds)) pieces.push(pieces.length ? `${pos(s.distance_meters) ? "in" : "for"} ${durationText(s.duration_seconds)}` : durationText(s.duration_seconds));
  const extras = [];
  if (s.type === "dropset") extras.push("drop set");
  if (s.type === "failure") extras.push("to failure");
  if (typeof s.rpe === "number" && Number.isFinite(s.rpe)) extras.push(`RPE ${num(s.rpe, 1)}`);
  if (pos(s.custom_metric)) extras.push(`${num(s.custom_metric)} floors or steps`);
  const body = pieces.join(" ") || "nothing logged";
  return `${s.type === "warmup" ? "warm-up " : ""}${body}${extras.length ? ` (${extras.join(", ")})` : ""}`;
}

const byIndex = (a, b) => (a?.index ?? 0) - (b?.index ?? 0);

// The cells of a workout's row; an empty cell is left out.
export function rowData(w, { tz = "UTC", units = {} } = {}) {
  const exercises = [...(w.exercises || [])].sort(byIndex);
  const supersets = new Map();
  for (const e of exercises) if (typeof e.superset_id === "number" && !supersets.has(e.superset_id)) supersets.set(e.superset_id, supersets.size + 1);
  const lines = exercises.map((e) => {
    const sets = [...(e.sets || [])].sort(byIndex).map((s) => setText(s, units));
    const ss = typeof e.superset_id === "number" ? ` (superset ${supersets.get(e.superset_id)})` : "";
    const note = oneLine(e.notes);
    return `${oneLine(e.title) || "Exercise"}${ss}: ${sets.length ? sets.join(", ") : "no sets"}${note ? `. Note: ${note}` : ""}`;
  });
  const allSets = exercises.flatMap((e) => e.sets || []);
  const factor = units.weight === "lb" ? 1 / KG_PER_LB : 1;
  const volume = allSets.filter((s) => s.type !== "warmup" && pos(s.reps) && pos(s.weight_kg)).reduce((t, s) => t + s.reps * s.weight_kg * factor, 0);
  const start = Date.parse(w.start_time), end = w.end_time ? Date.parse(w.end_time) : NaN;
  const out = {};
  const set = (k, v) => { if (v !== null && v !== undefined && v !== "") out[k] = v; };
  set("when", localStamp(w.start_time, tz));
  set("workout", oneLine(w.title) || "Workout");
  set("end", Number.isFinite(end) ? localStamp(w.end_time, tz) : "");
  set("minutes", Number.isFinite(end) && end >= start ? Math.round((end - start) / 60000) : null);
  set("exercises", lines.join("\n"));
  set("sets", allSets.length);
  set("volume", volume > 0 ? Number(volume.toFixed(1)) : null);
  set("notes", String(w.description ?? "").trim());
  return out;
}

// How two cells compare: the notebook's own table writes a time as "2026-10-23T18:05", numbers may
// come back as text, an empty cell is nothing.
export function same(a, b) {
  const n = (v) => {
    if (v === null || v === undefined) return "";
    if (typeof v === "number") return String(v);
    const s = String(v).trim();
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return s.replace("T", " ");
    if (s !== "" && /^-?\d+(\.\d+)?$/.test(s)) return String(Number(s));
    return s.replace(/\r\n/g, "\n");
  };
  return n(a) === n(b);
}
