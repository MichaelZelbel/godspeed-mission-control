// @vitest-environment jsdom
// The "since a week ago" reading comparison counts calendar days: local midnights
// seven days apart are a hair under 7×86400000 ms across a spring-forward, and the
// old unrounded comparison picked a reading a week or more older instead.
import { expect, it } from "vitest";
import { daysBetween } from "./Goals";

it("counts seven days across a spring-forward, not one hour short of a week", () => {
  expect(daysBetween("2026-03-14", "2026-03-07")).toBe(7);
  expect(daysBetween("2026-03-14", "2026-03-07") >= 7).toBe(true);
});

it("says NaN when either day is missing, and counts whole weeks otherwise", () => {
  expect(Number.isNaN(daysBetween(null, "2026-03-07"))).toBe(true);
  expect(daysBetween("2026-03-14", "2026-02-28")).toBe(14);
});
