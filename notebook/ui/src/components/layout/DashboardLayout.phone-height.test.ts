import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// #1045: at phone widths main reaches the window's bottom; the chat button floats over it.
describe("DashboardLayout main at phone widths", () => {
  const src = readFileSync(new URL("./DashboardLayout.tsx", import.meta.url), "utf8");
  it("drops the 96 px reserve below sm", () => {
    expect(src).toContain("max-sm:max-h-[calc(100dvh-3.5rem)]");
    expect(src).toContain("max-sm:[--page-h:calc(100dvh-6.5rem)]");
  });
});
