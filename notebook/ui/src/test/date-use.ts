import fs from "node:fs";
import path from "node:path";
import { blank, callArguments, repoRoot } from "./default-waits";

// Finds code under notebook/ui/src that formats or parses a stored date value
// directly instead of through lib/local-date.ts. The check cannot know a
// value's type, so it works on one principle: a Date built in code from "now"
// or from numbers is not a stored value; anything else that a Date is parsed
// from, or formatted out of, is. There is no allowlist and no ignore comment:
// every site the rules flag must move to the helpers.

// `new Date(x)` with one argument is only "now" code when x starts with
// Date.now() or with the identifier `now`; no argument, or two or more, is
// built-in code too. `Date.parse` always reads a stored value.
const NOW_ARG = /^(?:Date\.now\(\)|now\b)/;

// An options object naming any of these keys is formatting a date.
const DATE_OPTS = /\b(?:dateStyle|timeStyle|weekday|year|month|day|hour|minute|second)\b/;

// date-fns functions that read or format a stored date. Arithmetic and
// comparison (isValid, setMonth, ...) are not flagged.
const FNS = new Set([
  "format", "formatDistance", "formatDistanceStrict", "formatDistanceToNow",
  "formatDistanceToNowStrict", "formatRelative", "lightFormat", "intlFormat",
  "intlFormatDistance", "parse", "parseISO", "parseJSON", "toDate",
]);
const FNS_PARSE = new Set(["parse", "parseISO", "parseJSON", "toDate"]);

const PARSE_HELPER = "parseInstant (an instant) or parseDateOnly (a calendar day)";
const DAY_HELPER = "showDate to show it, or localDateISO to compare days";

function helperFor(what: string, dateFnsName?: string): string {
  if (what === "new Date(value)" || what === "Date.parse") return PARSE_HELPER;
  if (dateFnsName && FNS_PARSE.has(dateFnsName)) return PARSE_HELPER;
  if (what === "toDateString" || what === "toTimeString") return DAY_HELPER;
  return "showDate";
}

/** True when the argument builds a Date from "now" or from numbers, not a stored value. */
function builtInCode(arg: string | undefined): boolean {
  arg = (arg || "").trim();
  if (!arg) return true;
  if (NOW_ARG.test(arg)) return true;
  const m = /^new\s+Date\s*\(/.exec(arg);
  if (!m) return false;
  const args = callArguments(arg, m[0].length - 1) || [];
  return args.length === 0 || args.length >= 2 || NOW_ARG.test(args[0]);
}

/** True when the expression before `end` is a `new Date` built from "now" or numbers. */
function receiverIsBuiltInDate(text: string, end: number): boolean {
  let j = end - 1;
  if (text[j] === "?") j--;
  if (text[j] !== ")") return false;
  let depth = 0;
  for (; j >= 0; j--) {
    if (text[j] === ")") depth++;
    else if (text[j] === "(") { depth--; if (depth === 0) break; }
  }
  if (!/new\s+Date\s*$/.test(text.slice(Math.max(0, j - 12), j))) return false;
  const args = callArguments(text, j) || [];
  return args.length === 0 || args.length >= 2 || NOW_ARG.test((args[0] || "").trim());
}

/** True when the expression before `end` ends in a call to new Date, parseDateOnly or parseInstant. */
function receiverIsDateCall(text: string, end: number): boolean {
  let j = end - 1;
  if (text[j] === "?") j--;
  if (text[j] !== ")") return false;
  let depth = 0;
  for (; j >= 0; j--) {
    if (text[j] === ")") depth++;
    else if (text[j] === "(") { depth--; if (depth === 0) break; }
  }
  return /(?:new\s+Date|parseDateOnly|parseInstant)\s*$/.test(text.slice(Math.max(0, j - 20), j));
}

/** One `file:line: …` entry for each direct date use in `source`. */
export function dateUses(source: string, file: string): string[] {
  const raw = source;
  const text = blank(source);
  const out: string[] = [];
  const lineOf = (i: number) => text.slice(0, i).split("\n").length;
  const add = (i: number, what: string, dateFnsName?: string) =>
    out.push(`${file}:${lineOf(i)}: ${what} reads or shows a stored date directly; use ${helperFor(what, dateFnsName)} from notebook/ui/src/lib/local-date.ts`);

  for (const m of text.matchAll(/\bnew\s+Date\s*\(/g)) {
    const args = callArguments(text, m.index + m[0].length - 1);
    if (!args || args.length !== 1 || NOW_ARG.test(args[0])) continue;
    add(m.index, "new Date(value)");
  }
  for (const m of text.matchAll(/\bDate\.parse\s*\(/g)) add(m.index, "Date.parse");
  for (const m of text.matchAll(/\.(toLocaleDateString|toLocaleTimeString|toDateString|toTimeString|toUTCString)\s*\(/g)) {
    if (receiverIsBuiltInDate(text, m.index)) continue;
    add(m.index, m[1]);
  }
  for (const m of text.matchAll(/\.toLocaleString\s*\(/g)) {
    const args = callArguments(text, m.index + m[0].length - 1) || [];
    if (DATE_OPTS.test(args[1] || "")) { add(m.index, "toLocaleString of a date"); continue; }
    if (receiverIsDateCall(text, m.index)) add(m.index, "toLocaleString of a date");
  }
  for (const m of text.matchAll(/\bIntl\.DateTimeFormat\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const args = callArguments(text, open) || [];
    let k = open + 1;
    let depth = 1;
    for (; k < text.length && depth; k++) {
      if (text[k] === "(") depth++;
      else if (text[k] === ")") depth--;
    }
    if (/^\s*\.resolvedOptions\b/.test(text.slice(k))) continue;
    if (/\btimeZone\s*(?:[,}]|:\s*[A-Za-z_$])/.test(args[1] || "")) continue;
    add(m.index, "Intl.DateTimeFormat");
  }
  // Module names are blanked in the text, so the import clauses are read from
  // the raw source at the same shape.
  const names = new Map<string, string>();
  for (const m of raw.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']date-fns(?:\/[\w-]+)?["']/g)) {
    for (const part of m[1].split(",")) {
      const [orig, alias] = part.trim().split(/\s+as\s+/);
      if (FNS.has(orig)) names.set(alias || orig, orig);
    }
  }
  for (const [local, orig] of names) {
    for (const m of text.matchAll(new RegExp(`(?<![\\w.])${local}\\s*\\(`, "g"))) {
      const args = callArguments(text, m.index + m[0].length - 1) || [""];
      if (builtInCode(args[0])) continue;
      add(m.index, `${orig} from date-fns`, orig);
    }
  }
  return out;
}

/** Repository-relative paths of the UI sources the check scans. */
export function checkedSourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "test") walk(full);
      } else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) && !/\.d\.ts$/.test(entry.name)) {
        files.push(path.relative(repoRoot, full).split(path.sep).join("/"));
      }
    }
  };
  walk(path.join(repoRoot, "notebook/ui/src"));
  return files.filter((f) => f !== "notebook/ui/src/lib/local-date.ts").sort();
}
