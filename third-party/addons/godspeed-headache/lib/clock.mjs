// Every time the journal shows a person is local time in the zone their settings name. The
// server runs on UTC and the laptop does not, and both must file 10:40 as 10:40.
export function now() {
  return process.env.GODSPEED_NOW ? new Date(process.env.GODSPEED_NOW) : new Date();
}

const WEEKDAYS = { Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat", Sun: "sun" };

export function localParts(date, tz) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", weekday: "short",
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}`, hms: `${p.hour}${p.minute}${p.second}`,
    y: p.year, m: p.month, d: p.day, weekday: WEEKDAYS[p.weekday],
  };
}

export const minutesBetween = (a, b) => Math.round((b.getTime() - a.getTime()) / 60000);

export function inQuietHours(hm, range) {
  if (!range) return false;
  const [s, e] = range.split("-");
  return s <= e ? hm >= s && hm < e : hm >= s || hm < e;
}
