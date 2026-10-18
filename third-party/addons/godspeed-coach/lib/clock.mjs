// Every time the coach shows a person is local time in the zone their settings name. The server
// runs on UTC and the laptop does not, and a Sunday 19:00 talk has to be 19:00 in Berlin on both.
export function now() {
  return process.env.GODSPEED_NOW ? new Date(process.env.GODSPEED_NOW) : new Date();
}

const WEEKDAYS = { Mon: "mon", Tue: "tue", Wed: "wed", Thu: "thu", Fri: "fri", Sat: "sat", Sun: "sun" };
const localFormatters = new Map();

export function localParts(date, tz) {
  let f = localFormatters.get(tz);
  if (!f) { f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", weekday: "short",
  }); if (localFormatters.size >= 64) localFormatters.delete(localFormatters.keys().next().value); localFormatters.set(tz, f); }
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`, hm: `${p.hour}:${p.minute}`, hms: `${p.hour}${p.minute}${p.second}`,
    y: p.year, m: p.month, d: p.day, weekday: WEEKDAYS[p.weekday],
  };
}

export const minutesBetween = (a, b) => Math.round((b.getTime() - a.getTime()) / 60000);

// The UTC moment of a local date and time in a zone. Two passes, so a date across a clock change
// lands on the right hour.
export function zonedToUtc(ymd, hm, tz) {
  const [y, m, d] = ymd.split("-").map(Number);
  const [h, mi] = hm.split(":").map(Number);
  const wanted = Date.UTC(y, m - 1, d, h, mi);
  let t = wanted;
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(t), tz);
    const [lh, lm] = p.hm.split(":").map(Number);
    const seen = Date.UTC(Number(p.y), Number(p.m) - 1, Number(p.d), lh, lm);
    t += wanted - seen;
  }
  return new Date(t);
}

export function addDays(ymd, n) {
  const t = Date.parse(ymd + "T12:00:00Z") + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

export function weekdayOf(ymd) {
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"][new Date(ymd + "T12:00:00Z").getUTCDay()];
}

export function daysBetween(a, b) {
  return Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000);
}

// Days written for a message a person reads cold, on a phone, with nothing else on screen:
// "yesterday at 19:02", "on Sunday", "every Monday and Friday". "2026-10-04" and "mon,fri" are
// shorthand the assistant can read; a person has to decode them. The same words as
// godspeed-journal's check-in (2026-09-30).
export const WEEKDAY_WORDS = {
  en: { mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday" },
  de: { mon: "Montag", tue: "Dienstag", wed: "Mittwoch", thu: "Donnerstag", fri: "Freitag", sat: "Samstag", sun: "Sonntag" },
};
const MONTH_WORDS = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  de: ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"],
};

export function listWords(items, lang = "en") {
  if (items.length < 2) return items.join("");
  return `${items.slice(0, -1).join(", ")}${lang === "de" ? " und " : " and "}${items.at(-1)}`;
}

// A day seen from today, past or coming: today, tomorrow, yesterday, the weekday within a week,
// the date beyond that.
export function dayWords(ymd, todayYmd, lang = "en") {
  const de = lang === "de";
  const n = daysBetween(todayYmd, ymd);
  if (n === 0) return de ? "heute" : "today";
  if (n === 1) return de ? "morgen" : "tomorrow";
  if (n === -1) return de ? "gestern" : "yesterday";
  if (Math.abs(n) < 7) return `${de ? "am" : "on"} ${WEEKDAY_WORDS[de ? "de" : "en"][weekdayOf(ymd)]}`;
  const [, m, d] = ymd.split("-").map(Number);
  return de ? `am ${d}. ${MONTH_WORDS.de[m - 1]}` : `on ${d} ${MONTH_WORDS.en[m - 1]}`;
}

export const atWords = (hm, lang = "en") => `${lang === "de" ? "um" : "at"} ${hm}`;

export function whenSaid(iso, now, tz, lang = "en") {
  const p = localParts(new Date(iso), tz);
  return `${dayWords(p.date, localParts(now, tz).date, lang)} ${atWords(p.hm, lang)}`;
}
