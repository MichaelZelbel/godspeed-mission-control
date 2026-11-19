import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkedTestFiles, defaultWaits, repoRoot } from "./default-waits";
import { WAIT_MS } from "./wait-limits";
import viteConfig from "../../vite.config";

const sample = [
  'it("x", async () => {',
  "  await waitFor(() => expect(a).toBe(1));",
  '  await screen.findByText("x");',
  "  await vi.waitFor(() => y);",
  "  await waitFor(",
  "    () => expect(b).toBe(2),",
  "  );",
  '  await page.getByText("t").waitFor();',
  '  await screen.findByRole("button", { name: "Save" });',
  '  await screen.findAllByText("y", undefined, { interval: 10 });',
  "  await waitForElementToBeRemoved(() => q);",
  "});",
].join("\n");

const explicit = [
  "await waitFor(fn, WAIT);",
  'await screen.findByRole("b", { name: "c" }, WAIT);',
  "await screen.findByText(/x/, undefined, { timeout: 8_000 });",
  "await vi.waitFor(fn, 5000);",
  "await locator.waitFor({ state: 'visible', timeout: 15_000 });",
  "await store.waitForWriter(o);",
  "async function waitFor(check) { return check(); }",
  "// await waitFor(x)",
  "/* await findByText('x') */",
  'const s = "waitFor(x)";',
  "const t = `findByText(${'x'})`;",
  "expect(text).toMatch(/company's \"plan\" waitFor(x)/);",
  "await waitFor(fn, { timeout: WAIT_MS });",
  "const el = <p>a/b</p>;",
].join("\n");

describe("default wait limits", () => {
  it("no UI or notebook test waits with a library's default limit", () => {
    const files = checkedTestFiles();
    expect(files).toContain("notebook/ui/src/pages/Identity.test.tsx");
    expect(files.some((f) => f.startsWith("notebook/test/") && f.endsWith(".test.mjs"))).toBe(true);
    expect(files.flatMap((f) => defaultWaits(fs.readFileSync(path.join(repoRoot, f), "utf8"), f))).toEqual([]);
  });

  it("names the file and line of each wait in a sample file that uses the default", () => {
    expect(defaultWaits(sample, "sample.test.tsx").map((entry) => entry.split(" ")[0] + " " + entry.split(" ")[1])).toEqual([
      "sample.test.tsx:2: waitFor",
      "sample.test.tsx:3: findByText",
      "sample.test.tsx:4: vi.waitFor",
      "sample.test.tsx:5: waitFor",
      "sample.test.tsx:8: waitFor",
      "sample.test.tsx:9: findByRole",
      "sample.test.tsx:10: findAllByText",
      "sample.test.tsx:11: waitForElementToBeRemoved",
    ]);
  });

  it("passes waits with an explicit limit, and names in comments, strings and regexes", () => {
    expect(defaultWaits(explicit, "explicit.test.tsx")).toEqual([]);
  });

  // WAIT only takes effect when vitest lets a test run longer than it; at vitest's own 5 s
  // per-test limit a 10 s wait is cut short and the flakes come back (#789).
  it("gives every test longer than WAIT before vitest stops it", () => {
    expect(viteConfig.test?.testTimeout).toBeGreaterThan(WAIT_MS);
  });
});
