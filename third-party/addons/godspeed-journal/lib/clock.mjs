// Every time the journal shows a person is local time in the zone their settings name. The
// server runs on UTC and the laptop does not, and both must file 10:40 as 10:40.
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

// The time a person says something happened, in their own words, English or German, read in the
// zone their settings name. When the words fit two times on the same day ("at 9", said at 22:00)
// or none yet ("at 17:00", said at 15:00), the journal asks instead of guessing: a wrong time
// saved silently is worse than one short question. The result is exactly one of
//   { at }, { start, end }, { ask: "unknown" }, { ask: "which", options: [a, b] },
//   { ask: "future", at }, { ask: "order", start, end }.
const HOUR = 60, DAY_MS = 86400000;
const NUMBER_WORDS = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, forty: 40, "forty-five": 45, "forty five": 45, fifty: 50,
  ein: 1, eine: 1, einer: 1, einem: 1, eins: 1, zwei: 2, drei: 3, vier: 4, "fünf": 5, fuenf: 5, sechs: 6, sieben: 7,
  acht: 8, neun: 9, zehn: 10, elf: 11, "zwölf": 12, zwoelf: 12, "fünfzehn": 15, fuenfzehn: 15, zwanzig: 20,
  "dreißig": 30, dreissig: 30, vierzig: 40, "fünfundvierzig": 45, fuenfundvierzig: 45, "fünfzig": 50, fuenfzig: 50,
};
const UNIT = /^(minutes?|mins?|m|minuten?|hours?|hrs?|h|stunden?|std)$/;
const unitMinutes = (u) => /^(h|hrs?|hours?|std|stunden?)$/.test(u) ? HOUR : 1;
const PERIODS = {
  morning: 9 * HOUR, vormittag: 10 * HOUR, noon: 12 * HOUR, afternoon: 15 * HOUR, evening: 19 * HOUR, night: 22 * HOUR,
};
const PERIOD_WORDS = [
  [/\b(?:(?:in the|this) )?morning\b|\bam morgen\b|\bmorgens\b|\bfrüh\b/, "morning"],
  [/(?:\bam )?\bvormittags?\b/, "vormittag"],
  [/\b(?:at )?(?:noon|midday)\b|(?:\bam |\bzu )?\bmittags?\b/, "noon"],
  [/\b(?:(?:in the|this) )?afternoon\b|(?:\bam )?\bnachmittags?\b/, "afternoon"],
  [/\b(?:(?:in the|this) )?evening\b|(?:\bam )?\babends?\b/, "evening"],
  [/\b(?:(?:at|in the) )?night\b|\bnachts?\b/, "night"],
];

function number(word) {
  if (/^\d+(?:[.,]\d+)?$/.test(word)) return Number(word.replace(",", "."));
  return NUMBER_WORDS[word];
}

function minutesAgo(amount) {
  const fixed = {
    "half an hour": 30, "a half hour": 30, "an hour and a half": 90, "one and a half hours": 90,
    "a quarter of an hour": 15, "quarter of an hour": 15, "a quarter hour": 15,
    "einer halben stunde": 30, "ner halben stunde": 30, "anderthalb stunden": 90, "eineinhalb stunden": 90,
    "einer viertelstunde": 15, "einer viertel stunde": 15, "einer dreiviertelstunde": 45, "einer dreiviertel stunde": 45,
  };
  if (fixed[amount] !== undefined) return fixed[amount];
  const half = amount.match(/^(\S+) and a half hours?$/);
  if (half && number(half[1]) !== undefined) return (number(half[1]) + 0.5) * HOUR;
  const n = "(\\d+(?:[.,]\\d+)?|[a-zäöüß-]+(?: five)?)";
  const m = amount.match(new RegExp(`^${n} ?([a-zäöü]+)(?: (?:and |und )?${n} ?([a-zäöü]+))?$`));
  if (!m || !UNIT.test(m[2]) || number(m[1]) === undefined) return undefined;
  let total = number(m[1]) * unitMinutes(m[2]);
  if (m[3] !== undefined) {
    if (!UNIT.test(m[4]) || number(m[3]) === undefined) return undefined;
    total += number(m[3]) * unitMinutes(m[4]);
  }
  return total;
}

const HOUR_WORD = /^(?:\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|ein|eins|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn|elf|zwölf|zwoelf)$/;
const hourOf = (w) => HOUR_WORD.test(w) && number(w) >= 0 && number(w) <= 12 ? number(w) : undefined;

// One clock time: { minutes, explicit }. A time is explicit when it can only mean one hour of
// the day (09:00, 14:30, 9 pm); "9" or "half past nine" could be morning or evening.
function clockTime(text) {
  const t = text.replace(/\s*(?:uhr|o'clock)$/, "").trim();
  if (t === "midnight" || t === "mitternacht") return { minutes: 0, explicit: true };
  const d = t.match(/^(\d{1,2})(?:(?::|\.|h)(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)?$/);
  if (d) {
    const h = Number(d[1]), m = Number(d[2] || 0);
    if (m > 59) return null;
    if (d[3]) {
      if (h < 1 || h > 12) return null;
      return { minutes: ((h % 12) + (d[3][0] === "p" ? 12 : 0)) * HOUR + m, explicit: true };
    }
    if (h > 23) return null;
    return { minutes: h * HOUR + m, explicit: d[1].startsWith("0") || h === 0 || h >= 13 };
  }
  const word = t.match(/^(\S+)\s*(a\.?m\.?|p\.?m\.?)?$/);
  if (word && hourOf(word[1]) !== undefined && hourOf(word[1]) > 0 && !/^\d/.test(word[1])) {
    const h = hourOf(word[1]);
    if (word[2]) return { minutes: ((h % 12) + (word[2][0] === "p" ? 12 : 0)) * HOUR, explicit: true };
    return { minutes: h * HOUR, explicit: false };
  }
  const forms = [
    [/^half past (\S+)$/, 0, 30], [/^quarter past (\S+)$/, 0, 15], [/^quarter to (\S+)$/, -1, 45],
    [/^halb (\S+)$/, -1, 30], [/^viertel nach (\S+)$/, 0, 15], [/^viertel vor (\S+)$/, -1, 45], [/^dreiviertel (\S+)$/, -1, 45],
  ];
  for (const [re, shift, m] of forms) {
    const x = t.match(re);
    const h = x && hourOf(x[1]);
    if (h) return { minutes: (((h + shift) % 12 + 12) % 12) * HOUR + m, explicit: false };
  }
  return null;
}

// The hours of the day a clock time can mean, once a period word ("afternoon", "abends") has
// said which half of the day it was. dayShift is 1 for "last night at 2", which is the next date.
function withPeriod(time, period) {
  if (time.explicit || !period) return { options: time.explicit ? [time.minutes] : [time.minutes % (12 * HOUR), time.minutes % (12 * HOUR) + 12 * HOUR], dayShift: 0 };
  const m = time.minutes % (12 * HOUR), h = Math.floor(m / HOUR);
  if (period === "morning" || period === "vormittag") return { options: [m], dayShift: 0 };
  if (period === "noon") return { options: [h < 6 ? m + 12 * HOUR : m], dayShift: 0 };
  if (period === "night") return h >= 6 ? { options: [m + 12 * HOUR], dayShift: 0 } : { options: [m], dayShift: 1 };
  return { options: [m + 12 * HOUR], dayShift: 0 };
}

// A local date and a minute of that day in a zone, as an instant. Guessed as UTC, then moved
// by the offset the zone shows at the guess, twice, so a guess that crosses a daylight saving
// change settles. A wall time that does not exist (02:30 on the spring change) lands an hour later.
function zonedDate(date, minutes, tz) {
  const want = Date.parse(date + "T00:00:00Z") + minutes * 60000;
  let t = want;
  for (let i = 0; i < 2; i++) {
    const p = localParts(new Date(t), tz);
    t += want - Date.parse(`${p.date}T${p.hm}:00Z`);
  }
  return new Date(t);
}
const addDays = (date, n) => new Date(Date.parse(date + "T00:00:00Z") + n * DAY_MS).toISOString().slice(0, 10);

// Which of the possible times was meant. With a day named, each option on that day that is not
// still ahead. With none, today's when it has passed, otherwise yesterday's within the last 12
// hours ("23:00" said at 00:30 is last night; "at 11" said at 15:00 is not 23:00 yesterday).
function pick(options, day, dayShift, now, tz) {
  const today = localParts(now, tz).date;
  const counted = [], ahead = [];
  for (const m of options) {
    if (day !== null) {
      const t = zonedDate(addDays(today, day + dayShift), m, tz);
      (t <= now ? counted : ahead).push(t);
      continue;
    }
    const t = zonedDate(addDays(today, dayShift), m, tz);
    if (t <= now) { counted.push(t); continue; }
    const y = zonedDate(addDays(today, dayShift - 1), m, tz);
    if (now - y <= 12 * HOUR * 60000) counted.push(y); else ahead.push(t);
  }
  counted.sort((a, b) => a - b); ahead.sort((a, b) => a - b);
  if (counted.length === 1) return { at: counted[0] };
  if (counted.length > 1) return { ask: "which", options: counted };
  return { ask: "future", at: ahead[0] };
}

function normalize(words) {
  return String(words).toLowerCase().replace(/[’`]/g, "'").replace(/[–—]/g, "-").replace(/,(?!\d)/g, " ")
    .replace(/\s+/g, " ").trim().replace(/(?<![ap]\.m)[.!?]+$/, "")
    .replace(/^(?:(?:at|around|about|roughly|um|gegen|so|etwa|ungefähr|circa|ca\.?)\s+)+/, "");
}

export function parseWhen(words, now, tz) {
  let s = normalize(words);
  const ago = s.match(/^(.+) ago$/) || s.match(/^vor (.+)$/);
  if (ago) {
    const minutes = minutesAgo(ago[1]);
    if (minutes === undefined || minutes > 48 * HOUR) return { ask: "unknown" };
    return { at: new Date(now.getTime() - minutes * 60000) };
  }

  let day = null, period = null;
  if (/\blast night\b|\bletzte nacht\b/.test(s)) { day = -1; period = "night"; s = s.replace(/\blast night\b|\bletzte nacht\b/, " "); }
  const morgen = s.match(/\b(heute|gestern) (?:früh|morgen)\b/);
  if (morgen) { day = morgen[1] === "heute" ? 0 : -1; period = "morning"; s = s.replace(morgen[0], " "); }
  if (/\b(?:yesterday|gestern)\b/.test(s)) { day = -1; s = s.replace(/\b(?:yesterday|gestern)\b/, " "); }
  if (/\b(?:today|heute)\b/.test(s)) { day = 0; s = s.replace(/\b(?:today|heute)\b/, " "); }
  if (!period) for (const [re, name] of PERIOD_WORDS) if (re.test(s)) { period = name; s = s.replace(re, " "); break; }
  s = s.replace(/\s+/g, " ").trim().replace(/^(?:(?:at|around|about|um|gegen|so|etwa|ca\.?)\s+)+/, "").trim();

  if (!s) {
    if (!period) return { ask: "unknown" };
    return pick([PERIODS[period]], day, 0, now, tz);
  }
  const single = clockTime(s);
  if (single) {
    const { options, dayShift } = withPeriod(single, period);
    return pick(options, day, dayShift, now, tz);
  }
  const span = splitSpan(s);
  if (!span) return { ask: "unknown" };
  const a = withPeriod(span[0], period);
  const start = pick(a.options, day, a.dayShift, now, tz);
  if (start.ask) return start;
  const b = withPeriod(span[1], period);
  const startDate = localParts(start.at, tz).date;
  const ends = [0, 1].flatMap((n) => b.options.map((m) => zonedDate(addDays(startDate, n), m, tz)))
    .filter((t) => t > start.at && t - start.at <= 12 * HOUR * 60000).sort((x, y) => x - y);
  if (!ends.length) return { ask: "order", start: start.at, end: zonedDate(startDate, b.options[0], tz) };
  if (ends[0] > now) return { ask: "future", at: ends[0] };
  return { start: start.at, end: ends[0] };
}

// "from 9 to 10:30", "9-10:30", "von 9 bis 10:30", "zwischen 9 und 10". Every place the words
// could split is tried, since "quarter to ten" holds a "to" of its own.
function splitSpan(s) {
  const body = s.replace(/^(?:from|von|between|zwischen)\s+/, "");
  const between = body !== s && /^(?:between|zwischen)\b/.test(s);
  const sep = between ? /\s+(?:and|und)\s+/g : /\s*-\s*|\s+(?:to|until|till|bis)\s+/g;
  for (const m of body.matchAll(sep)) {
    const a = clockTime(body.slice(0, m.index).trim()), b = clockTime(body.slice(m.index + m[0].length).trim());
    if (a && b) return [a, b];
  }
  return null;
}
