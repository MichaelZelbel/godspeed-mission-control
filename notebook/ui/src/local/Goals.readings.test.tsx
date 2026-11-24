// @vitest-environment jsdom
// The "since a week ago" reading comparison counts calendar days: local midnights
// seven days apart are a hair under 7×86400000 ms across a spring-forward, and the
// old unrounded comparison picked a reading a week or more older instead. The unit
// tests in Goals.since.test.tsx pin daysBetween; this pins the call site's sentence.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as any;
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { Readings } from "./Goals";

afterEach(cleanup);

it("names the reading exactly seven days back in the since sentence, across a spring-forward", () => {
  render(<Readings goal={{ lead: { what: "Steps", kind: "watch", where: "wrist" }, readings: [
    { date: "2026-03-07", value: 10, where: "watch" },
    { date: "2026-03-14", value: 12, where: "watch" },
  ] } as any} />);
  expect(screen.getByText(/since Mar 7/)).toBeInTheDocument();
});
