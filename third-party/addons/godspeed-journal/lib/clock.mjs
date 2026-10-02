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

// When a task started, said so a person knows which one is meant: the time alone today, the
// weekday and time within the week, the date and time before that. "Since 22:09" about a task
// from the evening before reads as a task from this morning.
const DAY_NAMES = {
  en: { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" },
  de: { mon: "Mo", tue: "Di", wed: "Mi", thu: "Do", fri: "Fr", sat: "Sa", sun: "So" },
};
export function sinceLabel(iso, now, tz, lang = "en") {
  const p = localParts(new Date(iso), tz);
  const n = localParts(now, tz);
  if (p.date === n.date) return p.hm;
  const days = (Date.parse(n.date) - Date.parse(p.date)) / 86400000;
  return days < 7 ? `${(DAY_NAMES[lang] || DAY_NAMES.en)[p.weekday]} ${p.hm}` : `${p.date} ${p.hm}`;
}

// The same moment written for a message a person reads cold, on a phone, with nothing else on
// screen: "yesterday at 22:09", "am Montag um 14:20". "Mon 22:09" is shorthand the assistant can
// read; a person has to decode it.
const WEEKDAY_WORDS = {
  en: { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" },
  de: { mon: "Montag", tue: "Dienstag", wed: "Mittwoch", thu: "Donnerstag", fri: "Freitag", sat: "Samstag", sun: "Sonntag" },
};
const MONTH_WORDS = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  de: ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"],
};
export function whenSaid(iso, now, tz, lang = "en") {
  const de = lang === "de";
  const p = localParts(new Date(iso), tz);
  const n = localParts(now, tz);
  const at = de ? `um ${p.hm}` : `at ${p.hm}`;
  const days = (Date.parse(n.date) - Date.parse(p.date)) / 86400000;
  if (days === 0) return `${de ? "heute" : "today"} ${at}`;
  if (days === 1) return `${de ? "gestern" : "yesterday"} ${at}`;
  if (days > 1 && days < 7) return `${de ? "am" : "on"} ${WEEKDAY_WORDS[de ? "de" : "en"][p.weekday]} ${at}`;
  const month = MONTH_WORDS[de ? "de" : "en"][Number(p.m) - 1];
  return de ? `am ${Number(p.d)}. ${month} ${at}` : `on ${Number(p.d)} ${month} ${at}`;
}

export function inQuietHours(hm, range) {
  if (!range) return false;
  const [s, e] = range.split("-");
  return s <= e ? hm >= s && hm < e : hm >= s || hm < e;
}
