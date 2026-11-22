import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Finds library waits in test sources that would fall back to the library's own limit: Testing
// Library's waitFor/findBy*/findAllBy*/waitForElementToBeRemoved (1 s), vi.waitFor/vi.waitUntil
// (1 s) and a playwright locator's waitFor. A wait counts as explicit when its options argument is
// anything but missing, `undefined`, or an object literal without a `timeout` key.

const WAIT_CALL = /(\bvi\.(?:waitFor|waitUntil)|(?<![\w.])waitForElementToBeRemoved|(?<![\w.])waitFor|\.waitFor|\bfind(?:All)?By[A-Z]\w*)\s*\(/g;

// A `/` after one of these opens a regex literal, not a division. `<`, a lone `>` and `}` are left
// out: in TSX they come before the `/` of `</p>`, `/>` and `{x} />`.
const BEFORE_REGEX = /(?:=>|[(,=:[!&|?{;+\-*%~^]|\breturn|\btypeof|\bcase)\s*$/;

/** The source with comments and the contents of strings, templates and regex literals blanked to spaces, newlines and length kept. A template literal's interpolations are code and stay visible. */
export function blank(source: string): string {
  let out = "";
  let i = 0;
  const n = source.length;
  const skip = (end: number) => {
    for (; i < end && i < n; i++) out += source[i] === "\n" ? "\n" : " ";
  };
  // Scans one string, template or regex literal whose opening character is at i.
  // A template's `${` hands the interpolation back to the code scanner until the `}`
  // that closes it, so interpolation code is seen and its content stays blanked.
  const scanLiteral = (quote: string) => {
    let inClass = false;
    out += source[i];
    i++;
    while (i < n) {
      const e = source[i];
      if (e === "\\") { skip(i + 2); continue; }
      if (e === "\n" && quote !== "`") return;
      if (quote === "`" && e === "$" && source[i + 1] === "{") {
        skip(i + 2);
        if (!scanCode(true)) return;
        skip(i + 1);
        continue;
      }
      if (quote === "/") {
        if (e === "[") inClass = true;
        else if (e === "]") inClass = false;
        else if (e === "/" && !inClass) { out += e; i++; return; }
      } else if (e === quote) {
        out += e;
        i++;
        return;
      }
      skip(i + 1);
    }
  };
  // Scans code. Returns true when it stopped at the `}` closing an interpolation
  // (left at i, not consumed); false only at the end of the source.
  const scanCode = (inInterpolation: boolean): boolean => {
    let braces = 0;
    while (i < n) {
      const c = source[i];
      const d = source[i + 1];
      if (c === "/" && d === "/") {
        const end = source.indexOf("\n", i);
        skip(end < 0 ? n : end);
      } else if (c === "/" && d === "*") {
        const end = source.indexOf("*/", i + 2);
        skip(end < 0 ? n : end + 2);
      } else if (c === '"' || c === "'" || c === "`" || (c === "/" && BEFORE_REGEX.test(out.slice(-12)))) {
        scanLiteral(c);
      } else if (c === "{") {
        braces++;
        out += c;
        i++;
      } else if (c === "}") {
        if (inInterpolation && braces === 0) return true;
        if (braces > 0) braces--;
        out += c;
        i++;
      } else {
        out += c;
        i++;
      }
    }
    return false;
  };
  scanCode(false);
  return out;
}

/** The trimmed top-level arguments of the call whose `(` is at `open`, or null when it never closes. */
export function callArguments(text: string, open: number): string[] | null {
  const list: string[] = [];
  let depth = 0;
  let start = open + 1;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      if (depth === 0) {
        list.push(text.slice(start, i));
        const args = list.map((a) => a.trim());
        if (args[args.length - 1] === "") args.pop();
        return args;
      }
    } else if (c === "," && depth === 1) {
      list.push(text.slice(start, i));
      start = i + 1;
    }
  }
  return null;
}

function optionsIndex(name: string): number {
  if (name === ".waitFor") return 0;
  if (name.startsWith("find")) return 2;
  return 1;
}

function isExplicit(options: string | undefined): boolean {
  if (options === undefined || options === "undefined") return false;
  if (options.startsWith("{")) return /\btimeout\b/.test(options);
  return true;
}

/** One `file:line: …` entry for each wait in `source` that would use its library's default limit. */
export function defaultWaits(source: string, file: string): string[] {
  const text = blank(source);
  const found: string[] = [];
  for (const match of text.matchAll(WAIT_CALL)) {
    const name = match[1];
    if (/\bfunction\s+$/.test(text.slice(Math.max(0, match.index - 20), match.index))) continue;
    const args = callArguments(text, match.index + match[0].length - 1);
    if (!args || isExplicit(args[optionsIndex(name)])) continue;
    const line = text.slice(0, match.index).split("\n").length;
    found.push(`${file}:${line}: ${name.replace(/^\./, "")} uses its default wait limit; pass WAIT from notebook/ui/src/test/wait-limits.ts (or an explicit { timeout })`);
  }
  return found;
}

export const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));

/** Repository-relative paths of the UI tests (notebook/ui/src) and the notebook tests (notebook/test). */
export function checkedTestFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string, pattern: RegExp) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules") walk(full, pattern);
      } else if (pattern.test(entry.name)) {
        files.push(path.relative(repoRoot, full).split(path.sep).join("/"));
      }
    }
  };
  walk(path.join(repoRoot, "notebook/ui/src"), /\.test\.tsx?$/);
  walk(path.join(repoRoot, "notebook/test"), /\.test\.mjs$/);
  return files.sort();
}
