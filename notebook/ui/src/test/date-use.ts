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
//
// Accepted limits (decided on the pull request for #928; a review round may
// not ask for these): the check is a lint-style rule, not a data-flow
// analysis. (1) A copy of an imported date-fns function is invisible to both
// call routes and to the tracer: `const g = format; g(stored, "PPP")` passes
// silently. (2) An fp call whose date argument cannot be resolved through
// its curried chain, a pipe's first argument, or a consuming call of the
// local it is held in is treated as now-only: a stored date fed through any
// other shape passes silently. Parameters and catch bindings are collected
// as unreadable bindings, so a stored date shown through one is flagged,
// and the nearest binding of a name decides: another function's binding of
// the same name cannot flag or spare a use.

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

interface Binding {
  // A parameter or a catch binding is unresolvable: the check cannot know
  // what the caller handed in, so a display through it is flagged. An
  // assignment to it inside the scope makes the value readable again.
  kind: "param" | "catch" | "value";
  sites: Site[];
}

// One lexical scope: the bindings it declares. Lookup walks the syntax
// tree's ancestors, so no parent pointers are kept.
interface Scope {
  bindings: Map<string, Binding>;
}

interface Scopes {
  scopes: Map<ts.Node, Scope>;
  // An fp partial application held in a local: the call node that created it
  // and the local's name, so a later call of that local can be read as the
  // date provider.
  boundCalls: Map<ts.CallExpression, string>;
  // Per local name, the calls that call it (a held partial's consumers).
  consumingCalls: Map<string, ts.CallExpression[]>;
}

const isFunctionLikeNode = (node: ts.Node): node is ts.SignatureDeclaration =>
  ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) ||
  ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node) ||
  ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node);

/** The scopes of a file: one per function-like node (its parameters), block, catch clause and for statement (its loop bindings), plus the module scope. Also records which calls create an fp partial held in a local and which calls call that local. */
function collectScopes(sf: ts.SourceFile): Scopes {
  const scopes = new Map<ts.Node, Scope>();
  const boundCalls = new Map<ts.CallExpression, string>();
  const consumingCalls = new Map<string, ts.CallExpression[]>();
  const moduleScope: Scope = { bindings: new Map() };
  scopes.set(sf, moduleScope);
  const stack: Scope[] = [moduleScope];
  const scopeFor = (node: ts.Node): Scope => {
    let s = scopes.get(node);
    if (!s) { s = { bindings: new Map() }; scopes.set(node, s); }
    return s;
  };
  const declare = (scope: Scope, name: string, kind: Binding["kind"], site?: Site): void => {
    const b = scope.bindings.get(name);
    if (b) { if (site) b.sites.push(site); return; }
    scope.bindings.set(name, { kind, sites: site ? [site] : [] });
  };
  const patternNames = (pattern: ts.BindingName, fn: (name: string) => void): void => {
    if (ts.isIdentifier(pattern)) { fn(pattern.text); return; }
    for (const element of pattern.elements) {
      if (!ts.isOmittedExpression(element)) patternNames(element.name, fn);
    }
  };
  // A `var` declaration is function-scoped: it lands on the nearest
  // enclosing function-like scope, or the module scope at top level.
  const functionScopeOf = (node: ts.Node): Scope => {
    for (let n = node.parent; n; n = n.parent) {
      if (isFunctionLikeNode(n)) return scopes.get(n)!;
    }
    return moduleScope;
  };
  const visit = (node: ts.Node): void => {
    if (isFunctionLikeNode(node)) {
      const scope = scopeFor(node);
      for (const param of node.parameters) {
        patternNames(param.name, (name) => declare(scope, name, "param"));
      }
      stack.push(scope);
      ts.forEachChild(node, visit);
      stack.pop();
      return;
    }
    if (ts.isBlock(node) || ts.isCatchClause(node)) {
      const scope = scopeFor(node);
      if (ts.isCatchClause(node) && node.variableDeclaration) {
        patternNames(node.variableDeclaration.name, (name) => declare(scope, name, "catch"));
      }
      stack.push(scope);
      ts.forEachChild(node, visit);
      stack.pop();
      return;
    }
    if ((ts.isForOfStatement(node) || ts.isForInStatement(node) || ts.isForStatement(node)) && node.initializer && ts.isVariableDeclarationList(node.initializer)) {
      const scope = scopeFor(node);
      const site: Site | undefined = ts.isForStatement(node) ? undefined : { expr: node.expression, binding: true };
      for (const decl of node.initializer.declarations) {
        patternNames(decl.name, (name) => declare(scope, name, "value", site));
      }
      stack.push(scope);
      ts.forEachChild(node, visit);
      stack.pop();
      return;
    }
    if (ts.isVariableDeclaration(node) && !(ts.isVariableDeclarationList(node.parent) && (ts.isForOfStatement(node.parent.parent) || ts.isForInStatement(node.parent.parent) || ts.isForStatement(node.parent.parent)))) {
      const isVar = ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.BlockScoped) === 0;
      const scope = isVar ? functionScopeOf(node) : stack[stack.length - 1];
      if (ts.isIdentifier(node.name)) {
        declare(scope, node.name.text, "value", node.initializer ? { expr: node.initializer } : undefined);
      } else if (node.initializer) {
        const init = node.initializer;
        patternNames(node.name, (name) => declare(scope, name, "value", { expr: init, binding: true }));
      }
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left)) {
      // An assignment writes the nearest binding of the name the file
      // declares; an undeclared name lands on the module scope.
      const name = node.left.text;
      let scope: Scope | undefined;
      for (let n: ts.Node | undefined = node; n && n !== sf; n = n.parent) {
        const s = scopes.get(n);
        if (s?.bindings.has(name)) { scope = s; break; }
      }
      declare(scope ?? moduleScope, name, "value", { expr: node.right });
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      const list = consumingCalls.get(name);
      if (list) list.push(node);
      else consumingCalls.set(name, [node]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  for (const [node, scope] of scopes) {
    for (const [name, binding] of scope.bindings) {
      for (const site of binding.sites) {
        for (const arm of armsOf(site.expr!)) {
          if (ts.isCallExpression(arm)) boundCalls.set(arm, name);
        }
      }
    }
  }
  return { scopes, boundCalls, consumingCalls };
}

type Kind = "parse" | "now" | undefined;

/** Traces a value back to where it was read: "parse" when it is read from a stored value, "now" when every binding and every arm is provably built from now or numbers, undefined when the check cannot say. Names resolve per scope: the nearest binding of the name, walking up from the use through enclosing blocks, functions, catch clauses and for statements. */
function makeTracer(text: string, imports: DateImports, parseNames: Set<string>, collected: Scopes) {
  const { scopes } = collected;
  const bindingOf = (id: ts.Identifier): Binding | undefined => {
    for (let node: ts.Node | undefined = id; node; node = node.parent) {
      const scope = scopes.get(node);
      const binding = scope?.bindings.get(id.text);
      if (binding) return binding;
    }
    return undefined;
  };
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
    if (ts.isIdentifier(e)) return classifyName(e, seen);
    return undefined;
  };
  const classifyName = (id: ts.Identifier, seen: Set<string>): Kind => {
    if (seen.has(id.text)) return undefined;
    const binding = bindingOf(id);
    if (!binding || binding.sites.length === 0) return undefined;
    seen = new Set(seen).add(id.text);
    let parse = false;
    let allNow = true;
    for (const site of binding.sites) {
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
  const collected = collectScopes(sf);
  const tracer = makeTracer(text, imports, parseNames, collected);

  // The date-fns calls, collected on the side so they follow the Intl rule
  // like the loops they replace.
  const fnsEntries: string[] = [];
  const fnsAdd = (i: number, what: string, dateFnsName?: string) => fnsEntries.push(entry(i, what, dateFnsName));

  // The date argument of a call. Core functions take the date first; the fp
  // variants take it last, so a one-argument fp call is a partial application
  // and the date comes from its consumer: the outermost curried call, the
  // first argument of a pipe it feeds, or the last argument of a call of the
  // local it is held in. When none of those resolve, the partial has no
  // readable date argument and is treated as now-only.
  const outermostCurried = (call: ts.CallExpression): ts.CallExpression | undefined => {
    let node: ts.Node = call;
    let outer: ts.CallExpression | undefined;
    for (;;) {
      const p = node.parent;
      if (ts.isParenthesizedExpression(p)) { node = p; continue; }
      if (ts.isCallExpression(p) && p.expression === node) { outer = p; node = p; continue; }
      break;
    }
    return outer;
  };
  const isPipeCall = (call: ts.CallExpression): boolean => {
    const target = unwrapExpr(call.expression);
    if (ts.isIdentifier(target)) return target.text === "pipe";
    return ts.isPropertyAccessExpression(target) && target.name.text === "pipe" &&
      ts.isIdentifier(target.expression) && imports.namespaces.get(target.expression.text) === true;
  };
  const dateArgOf = (call: ts.CallExpression, fp: boolean): ts.Expression | undefined => {
    if (!fp) return call.arguments[0];
    const outer = outermostCurried(call);
    if (outer) return outer.arguments.length ? outer.arguments[outer.arguments.length - 1] : undefined;
    // Not consumed by a curried parent: the call itself may be a partial
    // application awaiting its date, or a direct two-argument fp call.
    if (call.arguments.length >= 2) return call.arguments[call.arguments.length - 1];
    if (call.arguments.length === 0) return undefined;
    // One argument: the format string or options; the date comes from the consumer.
    if (ts.isCallExpression(call.parent) && isPipeCall(call.parent) && call.parent.arguments.includes(call)) {
      return call.parent.arguments[0];
    }
    const holder = collected.boundCalls.get(call);
    if (holder) {
      for (const consumer of collected.consumingCalls.get(holder) || []) {
        if (!consumer.arguments.length) continue;
        const arg = consumer.arguments[consumer.arguments.length - 1];
        if (storedArg(arg)) return arg;
      }
      return undefined;
    }
    return undefined;
  };
  // A date argument is stored when it is neither built from now or numbers
  // (builtInCode) nor a held value the tracer can prove is built from now.
  const storedArg = (arg: ts.Expression): boolean => {
    if (builtInCode(text.slice(arg.getStart(), arg.getEnd()))) return false;
    return tracer.classify(unwrapExpr(arg), new Set()) !== "now";
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
            const arg = dateArgOf(node, imports.namespaces.get(obj.text)!);
            if (arg && storedArg(arg)) {
              fnsAdd(target.getStart(), `${name} from date-fns`, name);
            }
          }
        }
      } else if (ts.isIdentifier(target)) {
        const info = imports.names.get(target.text);
        if (info) {
          const arg = dateArgOf(node, info.fp);
          if (arg && storedArg(arg)) {
            fnsAdd(target.getStart(), `${info.orig} from date-fns`, info.orig);
          }
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
