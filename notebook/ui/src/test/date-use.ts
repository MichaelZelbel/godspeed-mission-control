import fs from "node:fs";
import path from "node:path";
import * as ts from "typescript";
import { blank, callArguments, repoRoot } from "./default-waits";

// Finds code under notebook/ui/src that formats or parses a stored date value
// directly instead of through lib/local-date.ts. The check cannot know a
// value's type, so it works on one principle: a Date built in code from "now"
// or from numbers is not a stored value; anything else that a Date is parsed
// from, or formatted out of, is. There is no allowlist and no ignore comment:
// every site the rules flag must move to the helpers. Receiver tracing walks
// the file's syntax tree, so a held value is followed through any binding or
// wrapper shape instead of depending on the declaration's formatting.

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

// The method formatters a stored date can be shown with.
const FAMILY = new Set(["toLocaleDateString", "toLocaleTimeString", "toDateString", "toTimeString", "toUTCString"]);

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
  return builtInArgs(callArguments(arg, m[0].length - 1) || []);
}

/** True when a `new Date` call's arguments build the Date from "now" or from numbers, not a stored value. */
function builtInArgs(args: string[]): boolean {
  return args.length === 0 || args.length >= 2 || NOW_ARG.test((args[0] || "").trim());
}

/** The argument texts of a call, read from the blanked source so a string argument cannot impersonate code. */
function argTexts(text: string, args: ts.NodeArray<ts.Expression> | undefined): string[] {
  return (args || []).map((a) => text.slice(a.getStart(), a.getEnd()));
}

/** The expression with parens, non-null `!`, `as`/`satisfies` casts and `await` removed. */
function unwrapExpr(e: ts.Expression): ts.Expression {
  for (;;) {
    if (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAssertionExpression(e) ||
      ts.isAwaitExpression(e) || ts.isSatisfiesExpression(e)) {
      e = e.expression;
    } else return e;
  }
}

/** The value arms of an initializer: a conditional's two arms and the operands of `||`, `&&` and `??`. */
function armsOf(e: ts.Expression): ts.Expression[] {
  e = unwrapExpr(e);
  if (ts.isConditionalExpression(e)) return [...armsOf(e.whenTrue), ...armsOf(e.whenFalse)];
  if (ts.isBinaryExpression(e) && (e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
    e.operatorToken.kind === ts.SyntaxKind.BarBarToken || e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)) {
    return [...armsOf(e.left), ...armsOf(e.right)];
  }
  return [e];
}

interface DateImports {
  // Named members under their local names, with the module's `fp` marker:
  // the fp variants take the date last, the core variants first.
  names: Map<string, { orig: string; fp: boolean }>;
  // Namespace aliases, with the module's `fp` marker.
  namespaces: Map<string, boolean>;
}

/** The date-fns imports of a file, at any subpath depth the locked package's exports map owns (`date-fns/fp/format` included). */
function readImports(sf: ts.SourceFile): DateImports {
  const names = new Map<string, { orig: string; fp: boolean }>();
  const namespaces = new Map<string, boolean>();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const module = ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : "";
    if (module !== "date-fns" && !module.startsWith("date-fns/")) continue;
    const fp = /^date-fns\/fp(?:$|\/)/.test(module);
    const clause = statement.importClause;
    if (!clause?.namedBindings) continue;
    if (ts.isNamespaceImport(clause.namedBindings)) namespaces.set(clause.namedBindings.name.text, fp);
    else for (const element of clause.namedBindings.elements) {
      const orig = element.propertyName ? element.propertyName.text : element.name.text;
      if (FNS.has(orig)) names.set(element.name.text, { orig, fp });
    }
  }
  return { names, namespaces };
}

// One site per binding of a local: its initializer, or an assigned value. A
// destructured or for-of binding's site carries the provenance it was read
// from, searched for a parser instead of classified directly: the check
// cannot see the property's type, so only a parser in the provenance makes
// the binding a stored value (the same rule a plain `row.count` declarator
// follows).

interface Site {
  expr?: ts.Expression;
  binding?: boolean;
}

/** Every binding of every local, file-wide: named declarators with their initializers, destructured and for-of bindings with their provenance, and plain assignments to a declared name. */
function collectSites(sf: ts.SourceFile): Map<string, Site[]> {
  const sites = new Map<string, Site[]>();
  const push = (name: string, site: Site) => {
    const list = sites.get(name);
    if (list) list.push(site);
    else sites.set(name, [site]);
  };
  const patternNames = (pattern: ts.BindingName, fn: (name: string) => void): void => {
    if (ts.isIdentifier(pattern)) { fn(pattern.text); return; }
    for (const element of pattern.elements) {
      if (!ts.isOmittedExpression(element)) patternNames(element.name, fn);
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isForOfStatement(node)) {
      const list = node.initializer;
      if (ts.isVariableDeclarationList(list)) {
        for (const decl of list.declarations) {
          const site: Site = { expr: node.expression, binding: true };
          if (ts.isIdentifier(decl.name)) push(decl.name.text, site);
          else patternNames(decl.name, (name) => push(name, site));
        }
      }
    } else if (ts.isVariableDeclaration(node) && !(ts.isVariableDeclarationList(node.parent) && ts.isForOfStatement(node.parent.parent))) {
      if (ts.isIdentifier(node.name)) {
        if (node.initializer) push(node.name.text, { expr: node.initializer });
      } else if (node.initializer) {
        const init = node.initializer;
        patternNames(node.name, (name) => push(name, { expr: init, binding: true }));
      }
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) {
      push(node.left.text, { expr: node.right });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sites;
}

type Kind = "parse" | "now" | undefined;

/** Traces a value back to where it was read: "parse" when it is read from a stored value, "now" when every binding and every arm is provably built from now or numbers, undefined when the check cannot say. */
function makeTracer(text: string, imports: DateImports, parseNames: Set<string>, sites: Map<string, Site[]>) {
  const classify = (e: ts.Expression, seen: Set<string>): Kind => {
    e = unwrapExpr(e);
    if (ts.isNewExpression(e)) {
      return ts.isIdentifier(e.expression) && e.expression.text === "Date"
        ? (builtInArgs(argTexts(text, e.arguments)) ? "now" : "parse")
        : undefined;
    }
    if (ts.isCallExpression(e)) {
      const callee = unwrapExpr(e.expression);
      if (ts.isIdentifier(callee)) return parseNames.has(callee.text) ? "parse" : undefined;
      if (ts.isPropertyAccessExpression(callee)) {
        const obj = unwrapExpr(callee.expression);
        if (!ts.isIdentifier(obj)) return undefined;
        if (obj.text === "Date" && callee.name.text === "parse") return "parse";
        return imports.namespaces.has(obj.text) && FNS_PARSE.has(callee.name.text) ? "parse" : undefined;
      }
      return undefined;
    }
    if (ts.isIdentifier(e)) return classifyName(e.text, seen);
    return undefined;
  };
  const classifyName = (name: string, seen: Set<string>): Kind => {
    if (seen.has(name)) return undefined;
    const list = sites.get(name);
    if (!list) return undefined;
    seen = new Set(seen).add(name);
    let parse = false;
    let allNow = true;
    for (const site of list) {
      for (const arm of armsOf(site.expr!)) {
        const kind = site.binding ? (containsParse(arm, seen) ? "parse" : undefined) : classify(arm, seen);
        if (kind === "parse") { parse = true; allNow = false; }
        else if (kind !== "now") allNow = false;
      }
    }
    return parse ? "parse" : allNow ? "now" : undefined;
  };
  // A destructured or for-of binding's provenance is searched for a parser:
  // `const [d] = [parseInstant(row.at)]` holds a stored date; `const { at } =
  // row` holds a property of an object the check cannot see.
  const containsParse = (node: ts.Node, seen: Set<string>): boolean => {
    if (classify(node as ts.Expression, seen) === "parse") return true;
    let found = false;
    ts.forEachChild(node, (child) => {
      if (!found && containsParse(child, seen)) found = true;
    });
    return found;
  };
  return { classify, classifyName };
}

/** One `file:line: …` entry for each direct date use in `source`. */
export function dateUses(source: string, file: string): string[] {
  const text = blank(source);
  const out: string[] = [];
  const lineOf = (i: number) => text.slice(0, i).split("\n").length;
  const entry = (i: number, what: string, dateFnsName?: string) =>
    `${file}:${lineOf(i)}: ${what} reads or shows a stored date directly; use ${helperFor(what, dateFnsName)} from notebook/ui/src/lib/local-date.ts`;
  const add = (i: number, what: string, dateFnsName?: string) => out.push(entry(i, what, dateFnsName));

  for (const m of text.matchAll(/\bnew\s+Date\s*\(/g)) {
    const args = callArguments(text, m.index + m[0].length - 1);
    if (!args || args.length !== 1 || NOW_ARG.test(args[0])) continue;
    add(m.index, "new Date(value)");
  }
  for (const m of text.matchAll(/\bDate\.parse\s*\(/g)) add(m.index, "Date.parse");

  // The imports, declarations and calls are read from the file's syntax tree;
  // it parses at the same offsets the blanked text keeps.
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const imports = readImports(sf);
  // The parsers the check owns, plus their date-fns names and aliases.
  // `parse` stays out: a local parser or JSON.parse shares the name.
  const parseNames = new Set(["Date.parse", "parseDateOnly", "parseInstant", "parseISO", "parseJSON", "toDate"]);
  for (const [local, { orig }] of imports.names) if (FNS_PARSE.has(orig)) parseNames.add(local);
  const tracer = makeTracer(text, imports, parseNames, collectSites(sf));

  // The date-fns calls, collected on the side so they follow the Intl rule
  // like the loops they replace.
  const fnsEntries: string[] = [];
  const fnsAdd = (i: number, what: string, dateFnsName?: string) => fnsEntries.push(entry(i, what, dateFnsName));

  const curried = (call: ts.CallExpression): ts.CallExpression | undefined =>
    ts.isCallExpression(call.parent) && call.parent.expression === call ? call.parent : undefined;
  const dateArgOf = (call: ts.CallExpression, fp: boolean): string => {
    if (!fp) return argTexts(text, call.arguments)[0];
    const outer = curried(call) ?? call;
    const args = outer.arguments;
    return args.length ? text.slice(args[args.length - 1].getStart(), args[args.length - 1].getEnd()) : "";
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const target = node.expression;
      if (ts.isPropertyAccessExpression(target) && ts.isIdentifier(target.name)) {
        const name = target.name.text;
        if (FAMILY.has(name)) {
          const kind = tracer.classify(unwrapExpr(target.expression), new Set());
          if (kind !== "now") add(target.name.getStart(), name);
        } else if (name === "toLocaleString") {
          const kind = tracer.classify(unwrapExpr(target.expression), new Set());
          if (kind !== "now") {
            const opts = node.arguments.length > 1 ? text.slice(node.arguments[1].getStart(), node.arguments[1].getEnd()) : "";
            if (DATE_OPTS.test(opts) || kind === "parse") add(target.name.getStart(), "toLocaleString of a date");
          }
        } else {
          const obj = unwrapExpr(target.expression);
          if (ts.isIdentifier(obj) && FNS.has(name) && imports.namespaces.has(obj.text)) {
            if (!builtInCode(dateArgOf(node, imports.namespaces.get(obj.text)!))) {
              fnsAdd(target.getStart(), `${name} from date-fns`, name);
            }
          }
        }
      } else if (ts.isIdentifier(target)) {
        const info = imports.names.get(target.text);
        if (info && !builtInCode(dateArgOf(node, info.fp))) {
          fnsAdd(target.getStart(), `${info.orig} from date-fns`, info.orig);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);

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
  out.push(...fnsEntries);
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
