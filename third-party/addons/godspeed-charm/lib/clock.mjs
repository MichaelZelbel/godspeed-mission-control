// Every date the challenge shows is the person's local day in the zone their settings name. The
// server runs on UTC and the laptop does not, and both must file the same moment on the same day.
// GODSPEED_CHARM_NOW pins the time for tests and rehearsals; GODSPEED_NOW is the one Mission
// Control itself uses; without either it is the real time.
export function now() {
  const pinned = process.env.GODSPEED_CHARM_NOW || process.env.GODSPEED_NOW;
  return pinned ? new Date(pinned) : new Date();
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
