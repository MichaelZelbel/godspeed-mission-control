// Word matchers for the answers to the reset question and for an explicit reset request.
// English and German, case-insensitive, trailing punctuation tolerated. Small lists on purpose.
const clean = (s) => String(s ?? "").toLowerCase().replace(/[\u2018\u2019]/g, "'").trim().replace(/[\s.!?,;:]+$/u, "").trim();

const YES = ["yes", "yep", "ja", "jep", "reset", "fair"];
const NO = ["no", "nope", "nein", "that didn't count", "didn't count", "das zählt nicht"];

export const isYes = (words) => YES.includes(clean(words));
export const isNo = (words) => NO.includes(clean(words));

// Only a plain request to reset counts; telling a story about venting at an AI is a question, not a reset.
const RESET_PATTERNS = [
  /\bcharm slip\b/,
  /\b(reset|restart)\b.*\bcharm challenge\b/,
  /\bcharm challenge\b.*(zurücksetz|zurück ?gesetzt|neu starten|\breset\b)/,
  /(setz|zurücksetz).*\bcharm challenge\b/,
  /\bzurück auf 21\b/,
];
export const isExplicitReset = (words) => { const w = clean(words); return RESET_PATTERNS.some((r) => r.test(w)); };
