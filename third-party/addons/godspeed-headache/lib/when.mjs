// Turning what a person says ("06:30", "yesterday 22:00") into an exact moment, in their own
// time zone. The server runs on UTC and the laptop does not, and both must file 06:30 as 06:30.
import { localParts } from "./clock.mjs";

// How far a local wall clock in `tz` is ahead of UTC at the instant `d`, in milliseconds.
export function tzOffset(d, tz) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

// The instant at which the wall clock in `tz` shows `date` `hm`.
export function localToInstant(date, hm, tz) {
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = hm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, min);
  let t = guess - tzOffset(new Date(guess), tz);
  t = guess - tzOffset(new Date(t), tz);
  return new Date(t);
}

export function addDays(date, n) {
  const t = new Date(Date.parse(date + "T12:00:00Z") + n * 86400000);
  return t.toISOString().slice(0, 10);
}

const HM = /^(\d{1,2})[:.h](\d{2})$/;
const normHm = (h, m) => `${String(h).padStart(2, "0")}:${m}`;

// Accepts: now, -30m / 30 min ago / vor 2 h, HH:MM, YYYY-MM-DD HH:MM, YYYY-MM-DDTHH:MM, yesterday HH:MM, gestern HH:MM,
// and a full ISO time with an offset. `after` is the start of an episode when reading its end:
// a bare time then belongs to the start's day, or the next day when it would come before it.
// A bare time that would lie in the future (more than five minutes) means yesterday.
export function resolveTime(spec, { tz, now, after = null }) {
  const s = String(spec ?? "now").trim().toLowerCase();
  if (!s || s === "now" || s === "jetzt") return new Date(now);
  // "-30m", "30 min ago", "vor 2 h": relative to now, so the recipe never has to do clock sums.
  let r = s.match(/^-\s*(\d+(?:[.,]\d+)?)\s*(m|min|mins|minutes|h|hr|hrs|hours|std|stunden)$/) || s.match(/^(\d+(?:[.,]\d+)?)\s*(m|min|mins|minutes|h|hr|hrs|hours|std|stunden)\s+ago$/) || s.match(/^vor\s+(\d+(?:[.,]\d+)?)\s*(m|min|minuten|h|std|stunden)$/);
  if (r) {
    const n = parseFloat(r[1].replace(",", "."));
    const ms = /^(h|hr|hrs|hours|std|stunden)$/.test(r[2]) ? n * 3600000 : n * 60000;
    return new Date(now.getTime() - ms);
  }
  if (/^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}(:\d{2})?(\.\d+)?(z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(spec); if (!isNaN(d)) return d;
  }
  let m = s.match(/^(\d{4}-\d{2}-\d{2})[ t](\d{1,2})[:.](\d{2})$/);
  if (m) return localToInstant(m[1], normHm(m[2], m[3]), tz);
  m = s.match(/^(yesterday|gestern)\s+(\d{1,2})[:.h](\d{2})$/);
  if (m) return localToInstant(addDays(localParts(now, tz).date, -1), normHm(m[2], m[3]), tz);
  m = s.match(HM);
  if (m) {
    if (+m[1] > 23 || +m[2] > 59) throw new Error(`"${spec}" is not a time of day.`);
    const hm = normHm(m[1], m[2]);
    if (after) {
      const day = localParts(after, tz).date;
      let t = localToInstant(day, hm, tz);
      if (t <= after) t = localToInstant(addDays(day, 1), hm, tz);
      return t;
    }
    const today = localParts(now, tz).date;
    let t = localToInstant(today, hm, tz);
    if (t.getTime() > now.getTime() + 5 * 60000) t = localToInstant(addDays(today, -1), hm, tz);
    return t;
  }
  throw new Error(`Could not read the time "${spec}". Use HH:MM, "yesterday HH:MM", YYYY-MM-DD HH:MM or -30m.`);
}
