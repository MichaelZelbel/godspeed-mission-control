// Every sentence the Charm Challenge says, in English and German. A text is a function of the
// state from count.mjs, so the same words come out whichever way in it is asked (the command, the
// morning brief, the context block). Plain and friendly, never a scold, no long dashes.
import { LENGTH } from "./count.mjs";

const DAYS = {
  en: ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  de: ["Sonntag", "Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag"],
};
const MONTHS = {
  en: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
  de: ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"],
};

// "Wednesday 11 November" / "Mittwoch, 11. November" for a YYYY-MM-DD day. Calendar arithmetic
// in UTC, so the machine's own zone never moves the weekday.
export function formatDay(date, lang = "en") {
  const [y, m, d] = String(date).split("-").map(Number);
  const l = lang === "de" ? "de" : "en";
  const weekday = DAYS[l][new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
  return l === "de" ? `${weekday}, ${d}. ${MONTHS.de[m - 1]}` : `${weekday} ${d} ${MONTHS.en[m - 1]}`;
}

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const EN = {
  started: (end) => `Charm Challenge started. ${LENGTH} days to go, done on ${formatDay(end, "en")}.`,
  status: (s) => `${count(s.daysToGo, "day", "days")} to go, done on ${formatDay(s.end, "en")}. Longest run so far: ${count(s.longestRun, "day", "days")}. Restarts: ${s.restarts}.`,
  question: () => `That sounded like a slip. Back to ${LENGTH}? Yes / No.`,
  yes: (s) => `Back to ${LENGTH}. Done on ${formatDay(s.end, "en")}. Restarts: ${s.restarts}.`,
  no: (s) => `Fair enough. Still ${count(s.daysToGo, "day", "days")} to go.`,
  briefLine: (s) => `Charm Challenge: day ${s.day} of ${LENGTH}, ${count(s.daysToGo, "day", "days")} to go.`,
  finish: (s) => `Charm Challenge done: ${LENGTH} days. Restarts on the way: ${s.restarts}.` + (s.kept > 0 ? ` You talked me out of ${count(s.kept, "reset", "resets")}.` : ""),
  stopped: () => "Charm Challenge stopped. Say the word and we start a new one.",
  alreadyRunning: (s) => `Charm Challenge is already running: day ${s.day} of ${LENGTH}, ${count(s.daysToGo, "day", "days")} to go. Start over from ${LENGTH}? Yes / No.`,
  // Where no question could be opened (no conversation, or a reset already today), none is asked.
  alreadyRunningNoQuestion: (s) => `Charm Challenge is already running: day ${s.day} of ${LENGTH}, ${count(s.daysToGo, "day", "days")} to go.`,
  notRunning: () => "No Charm Challenge is running. Say the word and we start one.",
  noOpenQuestion: () => "There is no open question about a slip here, so nothing changed.",
  // A refusal for the model, worded so that it still reads as a plain sentence if it reaches the person.
  askFirst: () => `Only "charm slip" starts over right away, so nothing has changed yet.`,
  resetToday: (s) => `There was a reset today already, so nothing changed. Still ${count(s.daysToGo, "day", "days")} to go.`,
  notAnAnswer: () => "That was neither a yes nor a no, so the question stays open.",
};

const DE = {
  started: (end) => `Charm Challenge gestartet. Noch ${LENGTH} Tage, fertig am ${formatDay(end, "de")}.`,
  status: (s) => `Noch ${count(s.daysToGo, "Tag", "Tage")}, fertig am ${formatDay(s.end, "de")}. Längste Serie bisher: ${count(s.longestRun, "Tag", "Tage")}. Neustarts: ${s.restarts}.`,
  question: () => `Das klang nach einem Ausrutscher. Zurück auf ${LENGTH}? Ja / Nein.`,
  yes: (s) => `Zurück auf ${LENGTH}. Fertig am ${formatDay(s.end, "de")}. Neustarts: ${s.restarts}.`,
  no: (s) => `Alles klar. Noch ${count(s.daysToGo, "Tag", "Tage")}.`,
  briefLine: (s) => `Charm Challenge: Tag ${s.day} von ${LENGTH}, noch ${count(s.daysToGo, "Tag", "Tage")}.`,
  finish: (s) => `Charm Challenge geschafft: ${LENGTH} Tage. Neustarts unterwegs: ${s.restarts}.` + (s.kept > 0 ? ` Du hast mich ${s.kept === 1 ? "einmal" : s.kept + " Mal"} vom Zurücksetzen abgebracht.` : ""),
  stopped: () => "Charm Challenge beendet. Sag Bescheid, dann starten wir eine neue.",
  alreadyRunning: (s) => `Die Charm Challenge läuft schon: Tag ${s.day} von ${LENGTH}, noch ${count(s.daysToGo, "Tag", "Tage")}. Noch mal von vorn mit ${LENGTH} Tagen? Ja / Nein.`,
  alreadyRunningNoQuestion: (s) => `Die Charm Challenge läuft schon: Tag ${s.day} von ${LENGTH}, noch ${count(s.daysToGo, "Tag", "Tage")}.`,
  notRunning: () => "Gerade läuft keine Charm Challenge. Sag Bescheid, dann starten wir eine.",
  noOpenQuestion: () => "Hier gibt es keine offene Frage zu einem Ausrutscher, also hat sich nichts geändert.",
  askFirst: () => `Nur "charm slip" setzt sofort zurück, also hat sich noch nichts geändert.`,
  resetToday: (s) => `Heute gab es schon einen Neustart, also hat sich nichts geändert. Noch ${count(s.daysToGo, "Tag", "Tage")}.`,
  notAnAnswer: () => "Das war weder ein Ja noch ein Nein, also bleibt die Frage offen.",
};

// T[lang] is never undefined: a language this add-on does not speak (a settings file saying "fr",
// a missing value) gets the English texts rather than a crash in the middle of a reply. Only
// unknown names fall back: symbols and what every object has (toString, valueOf) stay as they
// are, so T still turns into a string or prints like any object.
const LANGUAGES = { en: EN, de: DE };
export const T = new Proxy(LANGUAGES, { get: (all, key) => (typeof key === "string" && !(key in all) ? all.en : all[key]) });
// The language a reply comes in: the first of the candidates this add-on speaks, else English.
export const pickLanguage = (...candidates) => candidates.find((l) => typeof l === "string" && Object.hasOwn(LANGUAGES, l)) || "en";
