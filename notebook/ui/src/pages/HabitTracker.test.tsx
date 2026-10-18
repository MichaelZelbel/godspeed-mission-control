// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import "@testing-library/jest-dom/vitest";
import HabitTracker from "./HabitTracker";

const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke } } }));
vi.mock("@/components/SEOHead", () => ({ SEOHead: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const progress = { version: 1, today: "2026-10-13", timezone: "Pacific/Auckland", display: "standard", currentRun: 4, longestRun: 4, lifetimeCompletedDays: 4, achievements: [], nextMilestone: { days: 10, remaining: 6 }, protections: { limit: 2, windowDays: 30, remaining: 2 }, coverage: { from: "2026-10-01", scheduleHistoryComplete: true }, calendar: [{ date: "2026-10-13", weekday: "Tue", day: 13, status: "unknown", answer: null, scheduled: true }] };
const habit = { id: "habit-reading", name: "Read", habit_status: "active", doneMeans: "Read one page", progress, recent: [{ when: "2026-10-12", data: { answer: "done", note: "One page" } }] };
function open(selectedHabit = habit) {
  invoke.mockImplementation(async (_name, options) => ({ error: null, data: options.body.type === "tracker-list" ? { trackers: [selectedHabit] } : { reply: "Saved" } }));
  return render(<MemoryRouter initialEntries={["/trackers/habits/habit-reading"]}><Routes><Route path="/trackers/habits/:id" element={<HabitTracker />} /></Routes></MemoryRouter>);
}
describe("Habit tracker actions", () => {
  afterEach(() => { cleanup(); invoke.mockReset(); });
  it("uses the server's date for meaningful completion rather than the device clock", async () => {
    open();
    fireEvent.click(await screen.findByRole("button", { name: "I did it" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("personal-operation", { body: { tracker: "habit-reading", type: "track", on: "2026-10-13", answer: "done" } }));
    expect(screen.getByText("Read one page")).toBeVisible();
  });
  it("persists calm display, pauses, and an explicitly chosen excused range through the same record operations", async () => {
    open(); await screen.findByText("Read");
    fireEvent.click(screen.getByText("Pauses and display"));
    fireEvent.change(screen.getByLabelText("Progress display"), { target: { value: "calm" } });
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("personal-operation", { body: { tracker: "habit-reading", type: "habit-progress", action: "display", display: "calm" } }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Pause from today" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Pause from today" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("personal-operation", { body: { tracker: "habit-reading", type: "habit-progress", action: "pause", on: "2026-10-13" } }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Excuse these dates" })).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText("First day"), { target: { value: "2026-10-01" } });
    fireEvent.change(screen.getByLabelText("Last day"), { target: { value: "2026-10-03" } });
    fireEvent.change(screen.getByLabelText("Reason (optional)"), { target: { value: "Holiday" } });
    fireEvent.click(screen.getByRole("button", { name: "Excuse these dates" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("personal-operation", { body: { tracker: "habit-reading", type: "habit-progress", action: "exempt", from: "2026-10-01", to: "2026-10-03", note: "Holiday" } }));
  });
  it("offers a truthful resume action for a paused habit without asking for today's activity", async () => {
    open({ ...habit, habit_status: "paused" });
    expect(await screen.findByRole("heading", { name: "Paused, progress safe" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "I did it" })).not.toBeInTheDocument();
    expect(screen.queryByText("Read one page")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resume this habit" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("personal-operation", { body: { tracker: "habit-reading", type: "habit-progress", action: "resume", on: "2026-10-13" } }));
  });
});
