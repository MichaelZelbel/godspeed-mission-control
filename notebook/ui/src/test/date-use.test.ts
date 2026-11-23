import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkedSourceFiles, dateUses } from "./date-use";
import { repoRoot } from "./default-waits";

const sample = [
  "new Date(row.created_at);",
  "const x = new Date(",
  "  row.at",
  ");",
  "Date.parse(s);",
  "d.toLocaleDateString();",
  "d.toLocaleTimeString();",
  "d.toDateString();",
  "d.toUTCString();",
  "new Date(s).toLocaleString();",
  'd.toLocaleString(undefined, { dateStyle: "medium" });',
  'new Intl.DateTimeFormat(undefined, { dateStyle: "long" }).format(d);',
  'new Intl.DateTimeFormat("en-GB", { timeZone: "UTC" }).format(d);',
  'import { format as fmt, parseISO, formatDistanceToNow } from "date-fns";',
  'fmt(d, "PPP");',
  "parseISO(s);",
  "formatDistanceToNow(d);",
  "new Date(stored).toLocaleDateString();",
  "const d2 = new Date(stored); d2.toDateString();",
  'count.toLocaleString("en", { day: "numeric" });',
].join("\n");

const allowed = [
  "new Date();",
  "Date.now();",
  "new Date(Date.now() - 1000);",
  "new Date(now);",
  "new Date(now.getTime() - ms);",
  "new Date(2000, i, 1);",
  "new Date().toDateString();",
  "new Date().toLocaleDateString();",
  "count.toLocaleString();",
  'n.toLocaleString("en-GB");',
  "Intl.DateTimeFormat().resolvedOptions().timeZone;",
  'new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric" });',
  "new Intl.DateTimeFormat(\"en\", { timeZone });",
  'import { isValid, format as fmt2 } from "date-fns";',
  'fmt2(new Date(), "yyyy-MM-dd");',
  "isValid(d);",
  "const g = (d: Date) => format(d);",
  "// new Date(x).toLocaleString()",
  'const s = "toLocaleDateString()"',
  // A held "now" Date is not a stored value either, however it is shown.
  "const now = new Date();",
  "now.toLocaleString();",
  "now.toDateString();",
  "const t = new Date(Date.now());",
  "t.toLocaleString();",
  "const stamp = new Date(2000, i, 1);",
  "stamp.toLocaleString();",
  "new Date().toLocaleString();",
  "new Date(Date.now()).toLocaleString();",
  "new Date(2000, i, 1).toLocaleString();",
  // A now-only receiver stays exempt even when it formats with date options.
  'new Date().toLocaleString("en-US", { day: "numeric" });',
  "const clock = new Date();",
  'clock.toLocaleString("en-US", { day: "numeric" });',
  // date-fns/fp takes the date last: the format string is argument 0.
  'import { format as fpFormat } from "date-fns/fp";',
  'fpFormat("PPP", new Date());',
  'fpFormat("PPP")(new Date());',
  'import * as fpNow from "date-fns/fp";',
  'fpNow.format("PPP", new Date());',
  // fp now-only code stays clean through every application shape: a held
  // pre-curried formatter, a parenthesized callee and a pipe composition.
  'const f = fpFormat("PPP"); f(new Date());',
  '(fpFormat("PPP"))(new Date());',
  'fpNow.pipe(new Date(), fpNow.format("PPP"));',
  'fpFormat("PPP", Date.now());',
  'fpFormat({ locale: es })(new Date());',
  // A held "now" Date passed to a date-fns call is not a stored value either.
  'fmt2(clock, "yyyy-MM-dd");',
].join("\n");

describe("direct date use", () => {
  it("no UI source reads or shows a stored date without local-date.ts", () => {
    const files = checkedSourceFiles();
    expect(files).toContain("notebook/ui/src/pages/GroupDetail.tsx");
    expect(files).not.toContain("notebook/ui/src/lib/local-date.ts");
    expect(files.flatMap((f) => dateUses(fs.readFileSync(path.join(repoRoot, f), "utf8"), f))).toEqual([]);
  });

  it("names the file, line and helper for each kind of direct date use", () => {
    const uses = dateUses(sample, "sample.tsx");
    expect(uses.map((entry) => entry.split(" ").slice(0, 2).join(" "))).toEqual([
      "sample.tsx:1: new",
      "sample.tsx:2: new",
      "sample.tsx:10: new",
      "sample.tsx:18: new",
      "sample.tsx:19: new",
      "sample.tsx:5: Date.parse",
      "sample.tsx:6: toLocaleDateString",
      "sample.tsx:7: toLocaleTimeString",
      "sample.tsx:8: toDateString",
      "sample.tsx:9: toUTCString",
      "sample.tsx:10: toLocaleString",
      "sample.tsx:11: toLocaleString",
      "sample.tsx:18: toLocaleDateString",
      "sample.tsx:19: toDateString",
      "sample.tsx:20: toLocaleString",
      "sample.tsx:12: Intl.DateTimeFormat",
      "sample.tsx:13: Intl.DateTimeFormat",
      "sample.tsx:15: format",
      "sample.tsx:16: parseISO",
      "sample.tsx:17: formatDistanceToNow",
    ]);
    const helper = (line: string) => uses.find((e) => e.startsWith(line))!.split("; use ")[1];
    expect(helper("sample.tsx:1: new")).toBe("parseInstant (an instant) or parseDateOnly (a calendar day) from notebook/ui/src/lib/local-date.ts");
    expect(helper("sample.tsx:2: new")).toBe("parseInstant (an instant) or parseDateOnly (a calendar day) from notebook/ui/src/lib/local-date.ts");
    expect(helper("sample.tsx:5: Date.parse")).toBe("parseInstant (an instant) or parseDateOnly (a calendar day) from notebook/ui/src/lib/local-date.ts");
    expect(helper("sample.tsx:6: toLocaleDateString")).toBe("showDate from notebook/ui/src/lib/local-date.ts");
    expect(helper("sample.tsx:7: toLocaleTimeString")).toBe("showDate from notebook/ui/src/lib/local-date.ts");
    expect(helper("sample.tsx:8: toDateString")).toBe("showDate to show it, or localDateISO to compare days from notebook/ui/src/lib/local-date.ts");
    expect(helper("sample.tsx:9: toUTCString")).toBe("showDate from notebook/ui/src/lib/local-date.ts");
    expect(helper("sample.tsx:10: toLocaleString")).toBe("showDate from notebook/ui/src/lib/local-date.ts");
    expect(helper("sample.tsx:11: toLocaleString")).toBe("showDate from notebook/ui/src/lib/local-date.ts");
    expect(helper("sample.tsx:12: Intl.DateTimeFormat")).toBe("showDate from notebook/ui/src/lib/local-date.ts");
    expect(helper("sample.tsx:13: Intl.DateTimeFormat")).toBe("showDate from notebook/ui/src/lib/local-date.ts");
    expect(helper("sample.tsx:15: format")).toBe("showDate from notebook/ui/src/lib/local-date.ts");
    expect(helper("sample.tsx:16: parseISO")).toBe("parseInstant (an instant) or parseDateOnly (a calendar day) from notebook/ui/src/lib/local-date.ts");
    expect(helper("sample.tsx:17: formatDistanceToNow")).toBe("showDate from notebook/ui/src/lib/local-date.ts");
  });

  it("passes now-only code, dates built from numbers, numbers, and names in comments and strings", () => {
    expect(dateUses(allowed, "allowed.tsx")).toEqual([]);
  });

  it("sees the direct use written inside a template literal, a held variable, a namespace import and the remaining date-fns formatters", () => {
    const evasive = [
      "<p>{`Last updated ${new Date(stored).toLocaleString()}`}</p>",
      "const parsed = parseInstant(row.at);",
      "parsed.toLocaleString();",
      "const n = row.count;",
      "n.toLocaleString();",
      'import * as dfns from "date-fns";',
      'dfns.format(dfns.parseISO(s), "PPP");',
      'import { formatRFC3339, formatISO9075 } from "date-fns";',
      "formatRFC3339(d);",
      "formatISO9075(d);",
    ].join("\n");
    expect(dateUses(evasive, "evasive.tsx").map((entry) => entry.split(" ").slice(0, 2).join(" "))).toEqual([
      "evasive.tsx:1: new",
      "evasive.tsx:1: toLocaleString",
      "evasive.tsx:3: toLocaleString",
      "evasive.tsx:7: format",
      "evasive.tsx:7: parseISO",
      "evasive.tsx:9: formatRFC3339",
      "evasive.tsx:10: formatISO9075",
    ]);
  });

  it("sees the held value through the declaration shapes a stored column invites", () => {
    const shapes = [
      "const d = row.at ? parseInstant(row.at) : null; d.toLocaleString();",
      "const d2: Date = parseInstant(row.at); d2.toLocaleString();",
      "const d3: Date | null = row.at ? parseInstant(row.at) : null; d3.toLocaleString();",
      "const a = 1, d4 = parseInstant(row.at); d4.toLocaleString();",
      'import { parseISO } from "date-fns";',
      "const d5 = parseISO(row.at); d5.toLocaleString();",
      'import { parseJSON } from "date-fns";',
      "const d6 = parseJSON(text); d6.toLocaleString();",
      'import { toDate } from "date-fns";',
      "const d7 = toDate(x); d7.toLocaleString();",
      "const d8 = Date.parse(s); d8.toLocaleString();",
      "const d9 = row.at ? parseInstant(row.at) : null; d9?.toLocaleString();",
      "const d10 =",
      "  parseInstant(row.at);",
      "d10.toLocaleString();",
      "const d11 = row.at",
      "  ? parseInstant(row.at)",
      "  : null;",
      "d11.toLocaleString();",
      "const d12: Date | null =",
      "  parseInstant(row.at);",
      "d12.toLocaleString();",
      "const d13 = parseInstant(row.at)!; d13.toLocaleString();",
      "const d14 = parseInstant?.(row.at); d14.toLocaleString();",
      "const d15 = (parseInstant(row.at)); d15.toLocaleString();",
      "const d16 = (",
      "  parseInstant(row.at)",
      "); d16.toLocaleString();",
      'import * as dfns from "date-fns";',
      'const d17 = dfns.parse(s, "yyyy");',
      "d17.toLocaleString();",
    ].join("\n");
    expect(dateUses(shapes, "shapes.tsx").map((entry) => entry.split(" ").slice(0, 2).join(" "))).toEqual([
      "shapes.tsx:11: Date.parse",
      "shapes.tsx:1: toLocaleString",
      "shapes.tsx:2: toLocaleString",
      "shapes.tsx:3: toLocaleString",
      "shapes.tsx:4: toLocaleString",
      "shapes.tsx:6: toLocaleString",
      "shapes.tsx:8: toLocaleString",
      "shapes.tsx:10: toLocaleString",
      "shapes.tsx:11: toLocaleString",
      "shapes.tsx:12: toLocaleString",
      "shapes.tsx:15: toLocaleString",
      "shapes.tsx:19: toLocaleString",
      "shapes.tsx:22: toLocaleString",
      "shapes.tsx:23: toLocaleString",
      "shapes.tsx:24: toLocaleString",
      "shapes.tsx:25: toLocaleString",
      "shapes.tsx:28: toLocaleString",
      "shapes.tsx:31: toLocaleString",
      "shapes.tsx:6: parseISO",
      "shapes.tsx:8: parseJSON",
      "shapes.tsx:10: toDate",
      "shapes.tsx:30: parse",
    ]);
  });

  it("sees the held value through assignment, for-of and alias bindings, and reads a destructured binding from its provenance", () => {
    const bound = [
      // A binding read out of an object the check cannot see follows the rule a
      // plain `row.count` declarator follows: only a parser in the provenance
      // makes it a stored value.
      "const { at } = row; at.toLocaleString();",
      "const { at: last } = row; last.toLocaleString();",
      "const [d] = [parseInstant(row.at)]; d.toLocaleString();",
      "let d2; d2 = parseInstant(row.at); d2.toLocaleString();",
      "let d3 = null; if (row.at) d3 = parseInstant(row.at); d3.toLocaleString();",
      "for (const d4 of rows.map((r) => parseInstant(r.at))) d4.toLocaleString();",
      "const d5 = parseInstant(row.at); const e = d5; e.toLocaleString();",
      // A held number that is not read from a parser is not flagged.
      "const n = row.count; n.toLocaleString();",
      "let g; g = row.count; g.toLocaleString();",
    ].join("\n");
    expect(dateUses(bound, "bound.tsx").map((entry) => entry.split(" ").slice(0, 2).join(" "))).toEqual([
      "bound.tsx:3: toLocaleString",
      "bound.tsx:4: toLocaleString",
      "bound.tsx:5: toLocaleString",
      "bound.tsx:6: toLocaleString",
      "bound.tsx:7: toLocaleString",
    ]);
  });

  it("sees the stored arm of a mixed now-and-stored declaration and the name another scope holds from now", () => {
    const mixed = [
      "const d = row.at ? parseInstant(row.at) : new Date(); d.toDateString();",
      "const d2 = parseInstant(row.at) || new Date(); d2.toLocaleString();",
      "const d3 = parseInstant(row.at) || new Date(); d3.toDateString();",
      "const d4 = stored ?? new Date(); d4.toDateString();",
      "function a() { const d5 = new Date(); return d5.getTime(); }",
      "function b(row) { const d5 = parseInstant(row.at); return d5.toLocaleDateString(); }",
    ].join("\n");
    expect(dateUses(mixed, "mixed.tsx").map((entry) => entry.split(" ").slice(0, 2).join(" "))).toEqual([
      "mixed.tsx:1: toDateString",
      "mixed.tsx:2: toLocaleString",
      "mixed.tsx:3: toDateString",
      "mixed.tsx:4: toDateString",
      "mixed.tsx:6: toLocaleDateString",
    ]);
    expect(dateUses("const d = row.at ? new Date() : new Date(); d.toDateString();", "allnow.tsx")).toEqual([]);
  });

  it("sees the direct use after a template literal whose interpolation opens with a regex literal", () => {
    const tricky = [
      "const a = `${/can't/.test(m)} it's here`;",
      "const t = new Date(stored).toLocaleString();",
      "const ok = /can't/.test(s);",
    ].join("\n");
    expect(dateUses(tricky, "tricky.tsx").map((entry) => entry.split(" ").slice(0, 2).join(" "))).toEqual([
      "tricky.tsx:2: new",
      "tricky.tsx:2: toLocaleString",
    ]);
  });

  it("sees the stored date a held fp partial is fed, a pipe carries and a curried chain applies, and spares the same shapes fed now", () => {
    const fp = [
      'import { format } from "date-fns/fp";',
      'import * as fpNow from "date-fns/fp";',
      'import { parseISO } from "date-fns";',
      // The fp call whose date argument is not resolvable through the immediate
      // parent call is traced to its consumer: a held partial's call, a pipe's
      // first argument, or the outermost curried call.
      'const f = format("PPP"); f(stored);',
      'fpNow.pipe(parseISO(s), fpNow.format("PPP"));',
      'format("PPP")("2026-01-01");',
      // The same shapes fed now stay clean.
      'const g = format("PPP"); g(new Date());',
      'fpNow.pipe(new Date(), fpNow.format("PPP"));',
      'format("PPP")(new Date());',
    ].join("\n");
    expect(dateUses(fp, "fp.tsx").map((entry) => entry.split(" ").slice(0, 2).join(" "))).toEqual([
      "fp.tsx:4: format",
      "fp.tsx:5: parseISO",
      "fp.tsx:5: format",
      "fp.tsx:6: format",
    ]);
  });

  it("sees the stored date shown through a parameter, an arrow parameter and a catch binding, and leaves another function's now-only display alone", () => {
    const scopes = [
      "const d = new Date();",
      // The parameter shadows the module's now-local: its own scope decides.
      'function b(d){ return d.toLocaleString("en-US", { day: "numeric" }); }',
      'rows.map((d) => d.toLocaleString("en-US", { month: "short" }));',
      "try {} catch (e) { (e as Date).toDateString(); }",
      // Two functions, each with its own binding of the same name: a's own
      // now-local decides for a's display, b's stored binding for b's.
      "function a() { const d2 = new Date(); return d2.toDateString(); }",
      "function b2() { const d2 = parseInstant(row.at); return d2.toLocaleString(); }",
    ].join("\n");
    expect(dateUses(scopes, "scopes.tsx").map((entry) => entry.split(" ").slice(0, 2).join(" "))).toEqual([
      "scopes.tsx:2: toLocaleString",
      "scopes.tsx:3: toLocaleString",
      "scopes.tsx:4: toDateString",
      "scopes.tsx:6: toLocaleString",
    ]);
    expect(dateUses("function a() { const d = new Date(); return d.toLocaleString(); }\nfunction b() { const d = parseInstant(row.at); return d.toLocaleString(); }", "twofn.tsx").map((entry) => entry.split(" ").slice(0, 2).join(" "))).toEqual([
      "twofn.tsx:2: toLocaleString",
    ]);
  });

  it("sees the date-fns call through a subpath namespace import and a $-prefixed alias", () => {
    const imports = [
      'import * as fp from "date-fns/fp";',
      'fp.format("PPP", stored);',
      'import * as $d from "date-fns";',
      '$d.format(stored, "PPP");',
      'import { format as $f } from "date-fns";',
      '$f(stored, "PPP");',
      // Every subpath depth the locked package's exports map owns is read.
      'import { format } from "date-fns/fp/format";',
      'format("PPP")(stored);',
      'import * as ff from "date-fns/fp/format";',
      'ff.format("PPP")(stored);',
      'import { format } from "date-fns/fp";',
      'format("PPP", stored);',
    ].join("\n");
    expect(dateUses(imports, "imports.tsx").map((entry) => entry.split(" ").slice(0, 2).join(" "))).toEqual([
      "imports.tsx:2: format",
      "imports.tsx:4: format",
      "imports.tsx:6: format",
      "imports.tsx:8: format",
      "imports.tsx:10: format",
      "imports.tsx:12: format",
    ]);
  });
});
