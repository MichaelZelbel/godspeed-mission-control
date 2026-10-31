// Every date the challenge shows is the person's local day in the zone their settings name. The
// server runs on UTC and the laptop does not, and both must file the same moment on the same day.
// GODSPEED_CHARM_NOW pins the time for tests and rehearsals; GODSPEED_NOW is the one Mission
// Control itself uses; without either it is the real time.
export function now() {
  const pinned = process.env.GODSPEED_CHARM_NOW || process.env.GODSPEED_NOW;
  return pinned ? new Date(pinned) : new Date();
}

// How far the wall clock in `tz` is ahead of UTC at the instant `d`, in milliseconds, and the instant
// at which that clock shows `date` `hm` (both as the headache add-on's when.mjs has them).
export function tzOffset(d, tz) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(d).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}
export function localToInstant(date, hm, tz) {
  const [y, m, d] = date.split("-").map(Number);
  const [h, min] = hm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, min);
  let t = guess - tzOffset(new Date(guess), tz);
  t = guess - tzOffset(new Date(t), tz);
  return new Date(t);
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
