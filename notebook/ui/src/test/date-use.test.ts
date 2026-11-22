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
      "sample.tsx:5: Date.parse",
      "sample.tsx:6: toLocaleDateString",
      "sample.tsx:7: toLocaleTimeString",
      "sample.tsx:8: toDateString",
      "sample.tsx:9: toUTCString",
      "sample.tsx:10: toLocaleString",
      "sample.tsx:11: toLocaleString",
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
      "shapes.tsx:6: parseISO",
      "shapes.tsx:8: parseJSON",
      "shapes.tsx:10: toDate",
    ]);
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

  it("sees the date-fns call through a subpath namespace import and a $-prefixed alias", () => {
    const imports = [
      'import * as fp from "date-fns/fp";',
      'fp.format("PPP", stored);',
      'import * as $d from "date-fns";',
      '$d.format(stored, "PPP");',
      'import { format as $f } from "date-fns";',
      '$f(stored, "PPP");',
    ].join("\n");
    expect(dateUses(imports, "imports.tsx").map((entry) => entry.split(" ").slice(0, 2).join(" "))).toEqual([
      "imports.tsx:2: format",
      "imports.tsx:4: format",
      "imports.tsx:6: format",
    ]);
  });
});
