// Word matchers for the answers to the reset question and for an explicit reset request.
// English and German, case-insensitive, trailing punctuation tolerated. Small lists on purpose.
const clean = (s) => String(s ?? "").toLowerCase().replace(/[\u2018\u2019]/g, "'").trim().replace(/[\s.!?,;:]+$/u, "").trim();

const YES = ["yes", "yep", "ja", "jep", "reset", "fair"];
const NO = ["no", "nope", "nein", "that didn't count", "didn't count", "das zählt nicht"];

export const isYes = (words) => YES.includes(clean(words));
export const isNo = (words) => NO.includes(clean(words));

// Only a short, plain request counts, because a hit resets without asking. Questions, negations and
// stories fall through to false, the safe direction: the assistant then asks yes/no.
const RESET_PATTERNS = [
  /^charm slip$/,
  /^(please )?(reset|restart) (my|the) charm challenge$/,
  /^(bitte )?charm challenge (zurücksetzen|neu starten)$/,
  /^(bitte )?setz(e)? (meine|die) charm challenge (zurück|neu)$/,
  /^(bitte )?zurück auf 21$/,
];
const NEGATION = /(don't|dont|do not|never|nicht|kein|keine|nie)/;
export const isExplicitReset = (words) => {
  if (String(words ?? "").includes("?")) return false;
  const w = clean(words);
  return !NEGATION.test(w) && RESET_PATTERNS.some((r) => r.test(w));
};
