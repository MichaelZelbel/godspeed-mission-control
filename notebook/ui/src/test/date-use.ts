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
  "formatDistanceToNowStrict", "formatISO", "formatISO9075", "formatRelative",
  "formatRFC3339", "formatRFC7231", "lightFormat", "intlFormat",
  "intlFormatDistance", "parse", "parseISO", "parseJSON", "toDate",
]);
const FNS_PARSE = new Set(["parse", "parseISO", "parseJSON", "toDate"]);

const PARSE_HELPER = "parseInstant (an instant) or parseDateOnly (a calendar day)";
const DAY_HELPER = "showDate to show it, or localDateISO to compare days";

// A `$` in an import alias is an assertion in a pattern, so aliases reach the
// call patterns escaped.
const esc = (name: string) => name.replace(/\$/g, "\\$");

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
  return builtInArgs(callArguments(arg, m[0].length - 1) || []);
}

/** True when a `new Date` call's arguments build the Date from "now" or from numbers, not a stored value. */
function builtInArgs(args: string[]): boolean {
  return args.length === 0 || args.length >= 2 || NOW_ARG.test((args[0] || "").trim());
}

/** The callee and arguments of an expression that ends in a call, or null when it does not. */
function callTail(tail: string): { callee: string; args: string[] } | null {
  tail = tail.trim().replace(/\?$/, "").trim().replace(/\s+as\s+[\w.\[$\]<>|,\s]+$/i, "").trim();
  if (!tail.endsWith(")")) return null;
  let depth = 0;
  let j = tail.length - 1;
  for (; j >= 0; j--) {
    if (tail[j] === ")") depth++;
    else if (tail[j] === "(") { depth--; if (depth === 0) break; }
  }
  if (j < 0) return null;
  return { callee: tail.slice(0, j).trimEnd(), args: callArguments(tail, j) || [] };
}

/** True when the expression is a call to a stored-date parser: a stored `new Date`, Date.parse, parseDateOnly, parseInstant, or a date-fns parser under its local name. */
function isParseTail(tail: string, parseNames: Set<string>): boolean {
  const call = callTail(tail);
  if (!call) return false;
  if (/new\s+Date\s*$/.test(call.callee)) return !builtInArgs(call.args);
  const m = /([\w$]+)\s*$/.exec(call.callee);
  return parseNames.has(call.callee) || (!!m && parseNames.has(m[1]));
}

/** True when the expression is a call to a `new Date` built from "now" or numbers. */
function isNowDateTail(tail: string): boolean {
  const call = callTail(tail);
  return !!call && /new\s+Date\s*$/.test(call.callee) && builtInArgs(call.args);
}

/** The initializer expression of the declaration whose `=` ends at `from`: to the statement's `;`, `,` or newline at depth 0. */
function initializerText(text: string, from: number): string {
  let depth = 0;
  let k = from;
  for (; k < text.length; k++) {
    const c = text[k];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") { if (depth === 0) break; depth--; }
    else if (depth === 0 && (c === ";" || c === "," || c === "\n")) break;
  }
  return text.slice(from, k);
}

/** The initializer of every declarator naming `name`, in every declaration of the file: through a type annotation, a conditional's arms, and a comma-separated declarator list. */
function declaratorInitializers(text: string, name: string): string[] {
  const inits: string[] = [];
  for (const m of text.matchAll(/\b(?:const|let|var)\s+/g)) {
    let k = m.index + m[0].length;
    for (;;) {
      while (k < text.length && /\s/.test(text[k])) k++;
      const id = /^[\w$]+/.exec(text.slice(k));
      if (!id) break;
      const named = id[0] === name;
      k += id[0].length;
      // To the declarator's `=`; a type annotation's angle brackets are generics, not comparisons.
      let depth = 0;
      let eq = -1;
      for (let h = k; h < text.length; h++) {
        const c = text[h];
        if (c === "(" || c === "[" || c === "{" || c === "<") depth++;
        else if (c === ")" || c === "]" || c === "}" || c === ">") { if (depth === 0) break; depth--; }
        else if (depth === 0 && (c === "=" || c === ";" || c === "\n")) { if (c === "=") eq = h; break; }
      }
      if (eq < 0) break;
      const init = initializerText(text, eq + 1);
      if (named) inits.push(init);
      k = eq + 1 + init.length;
      while (k < text.length && /\s/.test(text[k])) k++;
      if (text[k] !== ",") break;
      k++;
    }
  }
  return inits;
}

/** The arms of a conditional expression, so a held value parsed in one arm is seen. */
function conditionalArms(init: string): string[] {
  const arms: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < init.length; i++) {
    const c = init[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (depth === 0 && (c === "?" || c === ":")) { arms.push(init.slice(start, i)); start = i + 1; }
  }
  arms.push(init.slice(start));
  return arms;
}

/** True when any declaration of the local initializes it from a stored-date parser. */
function declaredAsDate(text: string, name: string, parseNames: Set<string>): boolean {
  return declaratorInitializers(text, name).some((init) => conditionalArms(init).some((arm) => isParseTail(arm, parseNames)));
}

/** True when any declaration of the local initializes it from a `new Date` built from "now" or numbers. */
function declaredAsNowDate(text: string, name: string): boolean {
  return declaratorInitializers(text, name).some((init) => conditionalArms(init).some((arm) => isNowDateTail(arm)));
}

/** True when the receiver before `end` holds a stored date: a call to a stored-date parser, or a local declared from one. */
function receiverIsDateCall(text: string, end: number, parseNames: Set<string>): boolean {
  let j = end - 1;
  if (text[j] === "?") j--;
  if (text[j] !== ")") {
    // A plain local held from a parse call: `const d = parseInstant(row.at); d.toLocaleString()`.
    const m = /([\w$]+)$/.exec(text.slice(0, j + 1));
    return !!m && !/[.\w$]$/.test(text.slice(0, j + 1 - m[0].length)) && declaredAsDate(text, m[1], parseNames);
  }
  const call = callTail(text.slice(0, j + 1));
  if (!call) return false;
  if (/new\s+Date\s*$/.test(call.callee)) return !builtInArgs(call.args);
  const m = /([\w$]+)\s*$/.exec(call.callee);
  return parseNames.has(call.callee) || (!!m && parseNames.has(m[1]));
}

/** True when the receiver before `end` holds a date built from "now" or numbers: inline, or a local declared from one. */
function receiverIsNowDate(text: string, end: number): boolean {
  let j = end - 1;
  if (text[j] === "?") j--;
  if (text[j] !== ")") {
    const m = /([\w$]+)$/.exec(text.slice(0, j + 1));
    return !!m && !/[.\w$]$/.test(text.slice(0, j + 1 - m[0].length)) && declaredAsNowDate(text, m[1]);
  }
  const call = callTail(text.slice(0, j + 1));
  return !!call && /new\s+Date\s*$/.test(call.callee) && builtInArgs(call.args);
}

/** One `file:line: …` entry for each direct date use in `source`. */
export function dateUses(source: string, file: string): string[] {
  const raw = source;
  const text = blank(source);
  const out: string[] = [];
  const lineOf = (i: number) => text.slice(0, i).split("\n").length;
  const add = (i: number, what: string, dateFnsName?: string) =>
    out.push(`${file}:${lineOf(i)}: ${what} reads or shows a stored date directly; use ${helperFor(what, dateFnsName)} from notebook/ui/src/lib/local-date.ts`);

  // Module names are blanked in the text, so the import clauses are read from
  // the raw source at the same shape.
  const names = new Map<string, string>();
  const namespaces: string[] = [];
  for (const m of raw.matchAll(/import\s*\{([^}]*)\}\s*from\s*["']date-fns(?:\/[\w-]+)?["']/g)) {
    for (const part of m[1].split(",")) {
      const [orig, alias] = part.trim().split(/\s+as\s+/);
      if (FNS.has(orig)) names.set(alias || orig, orig);
    }
  }
  for (const m of raw.matchAll(/import\s*\*\s*as\s*([\w$]+)\s*from\s*["']date-fns(?:\/[\w-]+)?["']/g)) namespaces.push(m[1]);
  // The parsers the check already owns, plus their date-fns names and aliases.
  // `parse` stays out: a local parser or JSON.parse shares the name.
  const parseNames = new Set(["Date.parse", "parseDateOnly", "parseInstant", "parseISO", "parseJSON", "toDate"]);
  for (const [local, orig] of names) if (FNS_PARSE.has(orig)) parseNames.add(local);

  for (const m of text.matchAll(/\bnew\s+Date\s*\(/g)) {
    const args = callArguments(text, m.index + m[0].length - 1);
    if (!args || args.length !== 1 || NOW_ARG.test(args[0])) continue;
    add(m.index, "new Date(value)");
  }
  for (const m of text.matchAll(/\bDate\.parse\s*\(/g)) add(m.index, "Date.parse");
  for (const m of text.matchAll(/\.(toLocaleDateString|toLocaleTimeString|toDateString|toTimeString|toUTCString)\s*\(/g)) {
    if (receiverIsNowDate(text, m.index)) continue;
    add(m.index, m[1]);
  }
  for (const m of text.matchAll(/\.toLocaleString\s*\(/g)) {
    const args = callArguments(text, m.index + m[0].length - 1) || [];
    if (DATE_OPTS.test(args[1] || "")) { add(m.index, "toLocaleString of a date"); continue; }
    if (receiverIsDateCall(text, m.index, parseNames)) add(m.index, "toLocaleString of a date");
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
  for (const alias of namespaces) {
    for (const m of text.matchAll(new RegExp(`(?<![\\w.])${esc(alias)}\\s*\\.\\s*(\\w+)\\s*\\(`, "g"))) {
      const name = m[1];
      if (!FNS.has(name)) continue;
      const args = callArguments(text, m.index! + m[0].length - 1) || [""];
      if (builtInCode(args[0])) continue;
      add(m.index, `${name} from date-fns`, name);
    }
  }
  for (const [local, orig] of names) {
    for (const m of text.matchAll(new RegExp(`(?<![\\w.])${esc(local)}\\s*\\(`, "g"))) {
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
