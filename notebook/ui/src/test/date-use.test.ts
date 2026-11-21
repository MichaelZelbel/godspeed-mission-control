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
});
