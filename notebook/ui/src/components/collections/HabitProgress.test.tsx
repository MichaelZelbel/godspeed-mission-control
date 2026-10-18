// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { HabitProgress } from "./HabitProgress";
import type { HabitProgress as Progress, HabitDayStatus } from "@/lib/habit-progress";

export const progressFixture: Progress = {
  version: 1, today: "2026-10-13", timezone: "Europe/Berlin", dayBoundary: "midnight", display: "standard",
  currentRun: 4, pendingDays: 1, longestRun: 9, lifetimeCompletedDays: 36,
  achievements: [{ id: "completed-10", days: 10, earnedOn: "2026-09-01" }],
  nextMilestone: { days: 50, remaining: 14 },
  protections: { limit: 2, windowDays: 30, used: 1, remaining: 1, dates: ["2026-10-08"] },
  coverage: { from: "2026-09-01", scheduleHistoryComplete: true },
  calendar: (["completed", "protected", "paused", "notplanned", "unknown", "missed", "unknown"] as HabitDayStatus[]).map((status, index) => ({
    date: `2026-10-${String(index + 7).padStart(2, "0")}`, day: index + 7,
    weekday: ["Wed", "Thu", "Fri", "Sat", "Sun", "Mon", "Tue"][index], status,
    answer: status === "completed" ? "done" : status === "missed" || status === "protected" ? "no" : null,
    scheduled: status !== "notplanned",
  })),
};

describe("Habit progress", () => {
  afterEach(cleanup);
  it("labels each date with its actual weekday and a screen-reader status, independent of colour", () => {
    render(<HabitProgress progress={progressFixture} />);
    const days = within(screen.getByRole("list", { name: "Recent days" })).getAllByRole("listitem");
    expect(days).toHaveLength(7);
    expect(days[0]).toHaveAccessibleName("Wednesday, 7 October 2026: Done");
    expect(days[1]).toHaveAccessibleName("Thursday, 8 October 2026: Protected");
    expect(days[4]).toHaveAccessibleName("Sunday, 11 October 2026: Not recorded");
    expect(days[6]).toHaveTextContent("Tue13 OctToday");
    expect(screen.queryByRole("list", { name: "Calendar key" })).not.toBeInTheDocument();
    expect(days[0].querySelector("img")?.src).toContain("flame-done.svg");
    expect(days[1].querySelector("img")?.src).toContain("flame-ice.svg");
    expect(days[6].querySelector("img")).toBeNull();
    expect(days[6].querySelector(".habit-waiting-spark")).not.toBeNull();
    expect(days[4].querySelector(".habit-unrecorded-dot")).not.toBeNull();
  });
  it("keeps lifetime effort visible after a break without a large zero or loss message", () => {
    render(<HabitProgress progress={{ ...progressFixture, currentRun: 0 }} />);
    expect(screen.getByText("36")).toBeVisible();
    expect(screen.getByText("A fresh spark")).toBeVisible();
    expect(screen.getByText("These freezes can protect your next streak.")).toBeVisible();
    expect(screen.getByText("Your next tiny win starts here.")).toBeVisible();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    expect(screen.queryByText(/lost|broken|failure/i)).not.toBeInTheDocument();
  });
  it("honours calm mode while keeping lifetime progress and honest day states", () => {
    render(<HabitProgress progress={{ ...progressFixture, display: "calm" }} />);
    expect(screen.getByText("36")).toBeVisible();
    expect(screen.getByRole("list", { name: "Recent days" })).toBeVisible();
    expect(screen.queryByText("Current streak")).not.toBeInTheDocument();
    expect(screen.queryByText("Past achievements")).not.toBeInTheDocument();
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });
  it("keeps an unresolved gap distinct from a confirmed missed activity and discloses limited history", () => {
    render(<HabitProgress progress={{ ...progressFixture, coverage: { from: "2026-10-13", scheduleHistoryComplete: false, note: "Streak history starts with a dated schedule." }, calendar: [{ ...progressFixture.calendar[5], answer: null }] }} />);
    expect(within(screen.getByRole("list", { name: "Recent days" })).getByRole("listitem")).toHaveAccessibleName("Monday, 12 October 2026: Gap in record");
    expect(screen.getByText("Streak history starts with a dated schedule.")).toBeInTheDocument();
    expect(screen.getByText("Recent days still to record.")).toBeVisible();
  });
  it("supports a graduated legacy habit whose graduation date is unknown", () => {
    render(<HabitProgress progress={{ ...progressFixture, achievements: [{ id: "graduated", days: 36, earnedOn: null }] }} />);
    expect(screen.getByText("Habit graduated")).toBeInTheDocument();
  });
  it("makes the whole habit pause distinct from a single active rest day", () => {
    const { rerender } = render(<HabitProgress progress={progressFixture} habitStatus="paused" />);
    expect(screen.getByRole("heading", { name: "Paused, progress safe" })).toBeVisible();
    expect(screen.getByText("Your progress is safe. Pauses use no ice.")).toBeVisible();
    expect(screen.queryByText(/recent days still/i)).not.toBeInTheDocument();
    expect(document.querySelector(".habit-hero-art")?.getAttribute("src")).toContain("flame-rest.svg");
    rerender(<HabitProgress progress={{ ...progressFixture, calendar: [{ ...progressFixture.calendar[6], status: "notplanned", scheduled: false }] }} />);
    expect(screen.getByText("No action due today")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Paused, progress safe" })).not.toBeInTheDocument();
  });
});
