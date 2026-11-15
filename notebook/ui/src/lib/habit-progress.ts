// Dates and all progress arithmetic come from the installation, never the browser clock.
export type HabitDayStatus = "completed" | "protected" | "paused" | "notplanned" | "unknown" | "missed";
export type HabitProgress = {
  version: 1;
  today: string;
  timezone: string;
  dayBoundary: "midnight";
  display: "standard" | "calm";
  currentRun: number;
  pendingDays?: number;
  longestRun: number;
  lifetimeCompletedDays: number;
  achievements: { id: string; days: number; earnedOn: string | null }[];
  nextMilestone: { days: number; remaining: number } | null;
  protections: { limit: number; windowDays: number; used: number; remaining: number; dates: string[] };
  coverage: { from: string; scheduleHistoryComplete: boolean; note?: string | null };
  calendar: { date: string; weekday: string; day: number; status: HabitDayStatus; answer: "done" | "no" | "skip" | null; scheduled: boolean; reason?: string }[];
  lastBreak?: string | null;
};

export const HABIT_DAY_LABELS: Record<HabitDayStatus, string> = {
  completed: "Done", protected: "Protected", paused: "Paused", notplanned: "Not planned", unknown: "Not recorded", missed: "Not done",
};
export function habitDayLabel(day: { status: HabitDayStatus; answer: string | null }) {
  return day.status === "missed" && day.answer === null ? "Gap in record" : HABIT_DAY_LABELS[day.status];
}

// A date-only value has no browser timezone. UTC is used only to format its printed calendar date.
export function habitDateLabel(date: string, full = false) {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", day: "numeric", month: full ? "long" : "short", ...(full ? { weekday: "long" as const, year: "numeric" as const } : {}) }).format(new Date(`${date}T12:00:00Z`));
}
