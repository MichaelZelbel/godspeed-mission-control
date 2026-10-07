// What the log is for: seeing a pattern the person could not see day to day. Every figure here
// is a count or an average of what was logged, and every comparison says how many days it
// rests on, because four headaches are an anecdote and forty are a pattern.
import fs from "node:fs";
import { localParts } from "./clock.mjs";
import { localToInstant, addDays } from "./when.mjs";

export const hm = (iso, tz) => localParts(new Date(iso), tz).hm;
export const dayOf = (iso, tz) => localParts(new Date(iso), tz).date;
const dur = (m) => (m == null ? "" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`);

export function describe(ep, tz, now) {
  const d = dayOf(ep.start, tz);
  const span = ep.open ? `since ${hm(ep.start, tz)}, still going (${dur(Math.round((now - Date.parse(ep.start)) / 60000))})` : `${hm(ep.start, tz)}-${hm(ep.end, tz)}${dayOf(ep.end, tz) !== d ? ` (${dayOf(ep.end, tz)})` : ""}, ${dur(ep.minutes)}`;
  const bits = [span];
  if (ep.pain_max != null) bits.push(`pain ${ep.pain_first !== ep.pain_max ? `${ep.pain_first} to ${ep.pain_max}` : ep.pain_max}`);
  if (ep.side) bits.push(ep.side);
  if (ep.quality) bits.push(ep.quality);
  if (ep.symptoms.length) bits.push(ep.symptoms.join(", "));
  if (ep.triggers.length) bits.push(`trigger: ${ep.triggers.join(", ")}`);
  if (ep.meds.length) bits.push(`took ${ep.meds.map((m) => `${m.med}${m.dose ? ` ${m.dose}` : ""} at ${hm(m.taken, tz)}`).join(", ")}`);
  return `${d}: ${bits.join("; ")}`;
}

// Minutes of headache that fall on each local calendar day, for a table with one row per day.
// An open headache counts up to now.
export function minutesByDay(ep, tz, now) {
  const out = {};
  let t = Date.parse(ep.start);
  const end = ep.end ? Date.parse(ep.end) : now.getTime();
  while (t < end) {
    const d = dayOf(new Date(t).toISOString(), tz);
    const next = Math.min(end, localToInstant(addDays(d, 1), "00:00", tz).getTime());
    out[d] = (out[d] || 0) + Math.round((next - t) / 60000);
    t = next;
  }
  return out;
}

// One row per day: headache minutes, strongest pain, painkiller doses, headache count.
export function dailyRollup({ episodes, loose }, tz, now, { from, to }) {
  const rows = {};
  const row = (d) => (rows[d] ||= { date: d, headache_min: 0, headache_max_pain: null, headache_episodes: 0, painkiller_doses: 0 });
  for (const ep of episodes) {
    const mins = minutesByDay(ep, tz, now);
    for (const [d, m] of Object.entries(mins)) {
      const r = row(d); r.headache_min += m;
      if (ep.pain_max != null) r.headache_max_pain = Math.max(r.headache_max_pain ?? 0, ep.pain_max);
    }
    row(dayOf(ep.start, tz)).headache_episodes += 1;
    for (const m of ep.meds) row(dayOf(m.taken, tz)).painkiller_doses += 1;
  }
  for (const m of loose) row(dayOf(m.taken, tz)).painkiller_doses += 1;
  return Object.values(rows).filter((r) => (!from || r.date >= from) && (!to || r.date <= to)).sort((a, b) => a.date.localeCompare(b.date));
}

function count(list) {
  const c = {};
  for (const x of list) if (x) c[x] = (c[x] || 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1]);
}
const mean = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const i = Math.floor(s.length / 2); return s.length % 2 ? s[i] : Math.round((s[i - 1] + s[i]) / 2); };

function readCsv(file) {
  const lines = fs.readFileSync(file, "utf8").replace(/\r/g, "").split("\n").filter(Boolean);
  const head = lines.shift().split(",");
  return lines.map((l) => Object.fromEntries(l.split(",").map((v, i) => [head[i], v])));
}

export function patterns(log, s, now, { days = 90 } = {}) {
  const tz = s.timezone;
  const to = localParts(now, tz).date;
  const from = addDays(to, -(days - 1));
  const eps = log.episodes.filter((e) => dayOf(e.start, tz) >= from);
  const daily = dailyRollup(log, tz, now, { from, to });
  const headacheDays = daily.filter((r) => r.headache_min > 0).map((r) => r.date);
  const pillDays = daily.filter((r) => r.painkiller_doses > 0).map((r) => r.date);
  // The most painkiller days inside any 30 days of the window: the figure the overuse limit is
  // written against.
  let worst30 = 0;
  for (let i = 0; i < days; i++) {
    const a = addDays(from, i); const b = addDays(a, 29);
    worst30 = Math.max(worst30, pillDays.filter((d) => d >= a && d <= b).length);
  }
  const bucket = (iso) => { const h = +hm(iso, tz).slice(0, 2); return h < 6 ? "night (0-6)" : h < 12 ? "morning (6-12)" : h < 18 ? "afternoon (12-18)" : "evening (18-24)"; };
  const wd = (iso) => localParts(new Date(iso), tz).weekday;
  const closed = eps.filter((e) => !e.open);
  const reliefs = [];
  for (const e of closed) if (e.meds.length) reliefs.push(Math.round((Date.parse(e.end) - Date.parse(e.meds[0].taken)) / 60000));
  const r = {
    window: { from, to, days },
    episodes: eps.length,
    headache_days: headacheDays.length,
    hours_total: Math.round(daily.reduce((a, x) => a + x.headache_min, 0) / 6) / 10,
    pain_mean: mean(eps.map((e) => e.pain_max).filter((x) => x != null)),
    minutes_median: median(closed.map((e) => e.minutes)),
    painkiller_days: pillDays.length,
    painkiller_doses: daily.reduce((a, x) => a + x.painkiller_doses, 0),
    painkiller_days_worst_30: worst30,
    overuse_limit: s.overuse_days,
    minutes_from_pill_to_end_median: median(reliefs),
    pill_episodes: reliefs.length,
    starts_by_time: count(eps.map((e) => bucket(e.start))),
    starts_by_weekday: count(eps.map((e) => wd(e.start))),
    sides: count(eps.map((e) => e.side)),
    qualities: count(eps.map((e) => e.quality)),
    triggers: count(eps.flatMap((e) => e.triggers)),
    symptoms: count(eps.flatMap((e) => e.symptoms)),
    meds: count(eps.flatMap((e) => e.meds.map((m) => m.med)).concat(log.loose.filter((m) => dayOf(m.taken, tz) >= from).map((m) => m.med))),
    compare: null,
  };
  r.compare = compareWithTable(s, headacheDays, from, to);
  return r;
}

// Headache days against headache-free days, column by column, from the person's daily health
// table when they have one. Only printed once both sides have enough days to mean anything.
export function compareWithTable(s, headacheDays, from, to, minDays = 5) {
  if (!s.daily_table || !s.daily_columns?.length || !fs.existsSync(s.daily_table)) return null;
  const rows = readCsv(s.daily_table).filter((r) => r.date >= from && r.date <= to);
  const hd = new Set(headacheDays);
  const out = [];
  for (const col of s.daily_columns) {
    const on = []; const off = [];
    for (const r of rows) {
      const v = parseFloat(r[col]);
      if (!Number.isFinite(v)) continue;
      (hd.has(r.date) ? on : off).push(v);
    }
    out.push({ column: col, headache_days: on.length, free_days: off.length, mean_on: mean(on), mean_off: mean(off), enough: on.length >= minDays && off.length >= minDays });
  }
  return out;
}

export function renderPatterns(r) {
  const L = [];
  const list = (pairs) => pairs.map(([k, v]) => `${k} ${v}`).join(", ") || "none logged";
  L.push(`Headaches ${r.window.from} to ${r.window.to} (${r.window.days} days): ${r.episodes} logged, on ${r.headache_days} days, ${r.hours_total} hours in all.`);
  if (!r.episodes) return L.join("\n");
  L.push(`Strongest pain, average: ${r.pain_mean ?? "not logged"}. Typical length: ${r.minutes_median != null ? dur(r.minutes_median) : "no finished headache yet"}.`);
  L.push(`Painkillers: ${r.painkiller_doses} doses on ${r.painkiller_days} days; at most ${r.painkiller_days_worst_30} days in any 30 (limit ${r.overuse_limit}).`);
  if (r.pill_episodes) L.push(`From the first pill to the headache ending: typically ${dur(r.minutes_from_pill_to_end_median)} (${r.pill_episodes} headaches).`);
  L.push(`Starts: ${list(r.starts_by_time)}.`);
  L.push(`Weekdays: ${list(r.starts_by_weekday)}.`);
  L.push(`Side: ${list(r.sides)}. Kind: ${list(r.qualities)}.`);
  if (r.triggers.length) L.push(`Triggers named: ${list(r.triggers)}.`);
  if (r.symptoms.length) L.push(`Other symptoms: ${list(r.symptoms)}.`);
  L.push(`Medicines: ${list(r.meds)}.`);
  if (r.compare) {
    const good = r.compare.filter((c) => c.enough);
    if (good.length) {
      L.push("Headache days against headache-free days (a difference, not a cause):");
      for (const c of good) L.push(`- ${c.column}: ${c.mean_on} on ${c.headache_days} headache days, ${c.mean_off} on ${c.free_days} free days`);
    } else L.push("Comparison with the daily health table: not enough headache days yet (needs 5 on each side).");
  }
  return L.join("\n");
}
