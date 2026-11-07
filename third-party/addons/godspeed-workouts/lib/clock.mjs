// Times as the person's wall clock shows them, in their time zone: a row says "2026-10-23 18:05",
// the way the notebook's trackers keep a day and a minute.
const cache = new Map();
function parts(date, tz) {
  let f = cache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    cache.set(tz, f);
  }
  const o = Object.fromEntries(f.formatToParts(date).map((p) => [p.type, p.value]));
  return { date: `${o.year}-${o.month}-${o.day}`, hm: `${o.hour === "24" ? "00" : o.hour}:${o.minute}` };
}

// "2026-10-23 18:05"; empty for no time.
export function localStamp(iso, tz) {
  if (!iso) return "";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return "";
  const p = parts(d, tz);
  return `${p.date} ${p.hm}`;
}

export function localDay(iso, tz) {
  return localStamp(iso, tz).slice(0, 10);
}

export function validZone(tz) {
  try { new Intl.DateTimeFormat("en-GB", { timeZone: tz }); return true; } catch { return false; }
}

export const machineZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

// "24 October 2026", for a message.
export function dayWords(iso, tz) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return String(iso || "");
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: tz }).format(d);
}
