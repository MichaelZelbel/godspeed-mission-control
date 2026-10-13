import { Check, CircleHelp, Minus, Pause, ShieldCheck, Circle, X } from "lucide-react";
import { HABIT_DAY_LABELS, habitDayLabel, habitDateLabel, type HabitDayStatus, type HabitProgress as Progress } from "@/lib/habit-progress";
import "./habit-progress.css";

const ICONS = { completed: Check, protected: ShieldCheck, paused: Pause, notplanned: Minus, unknown: CircleHelp, missed: X, gap: Circle };
export function HabitDayIcon({ status }: { status: HabitDayStatus | "gap" }) {
  const Icon = ICONS[status];
  return <Icon aria-hidden="true" className="habit-day-icon" strokeWidth={status === "completed" ? 3 : 2} />;
}

export function HabitProgress({ progress }: { progress: Progress }) {
  const week = progress.calendar.slice(-7);
  const calm = progress.display === "calm";
  const milestone = progress.nextMilestone;
  const pending = (progress.pendingDays ?? 0) > 0;
  return <section className="habit-progress" aria-label="Habit progress">
    <div className="habit-progress-totals">
      <div>
        <p className="habit-progress-number">{progress.lifetimeCompletedDays.toLocaleString("en-GB")}</p>
        <h2 className="font-semibold">Days completed, all time</h2>
        <p className="mt-1 text-sm">Every completed day stays with you.</p>
      </div>
      {!calm && <div className="habit-progress-run">
        <p className="text-2xl font-semibold tabular-nums">{progress.currentRun > 0 ? progress.currentRun.toLocaleString("en-GB") : "Ready"}</p>
        <p className="font-medium">{progress.currentRun > 0 ? "Current streak" : "For your next small step"}</p>
        {progress.currentRun > 0 && <p className="mt-1 text-sm">Completed planned days in this run</p>}
        {pending && <p className="mt-1 text-sm">Recent days still to record</p>}
      </div>}
    </div>
    {!calm && milestone && <div className="mt-5 space-y-2">
      <div className="flex flex-wrap justify-between gap-1 text-sm"><span>Next milestone: {milestone.days.toLocaleString("en-GB")} completed days</span><span>{milestone.remaining} to go</span></div>
      <progress className="habit-milestone" max={milestone.days} value={progress.lifetimeCompletedDays} aria-label={`Next milestone: ${milestone.days} completed days`} />
    </div>}
    {week.length > 0 && <div className="mt-6">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-1">
        <h3 className="font-semibold">Your last seven days</h3>
        <p className="text-sm">{habitDateLabel(week[0].date)} to {habitDateLabel(week[week.length - 1].date)}</p>
      </div>
      <ol className="habit-week" aria-label="Recent days">
        {week.map(day => <li key={day.date} className={`habit-calendar-day habit-day-${day.status}`} aria-label={`${habitDateLabel(day.date, true)}: ${habitDayLabel(day)}${day.reason ? `. ${day.reason}` : ""}`}>
          <span className="habit-weekday">{day.weekday}</span>
          <time dateTime={day.date} className="habit-date">{day.day}</time>
          <span className="habit-day-symbol"><HabitDayIcon status={day.status === "missed" && day.answer === null ? "gap" : day.status} /></span>
          <span className="habit-today">{day.date === progress.today ? "Today" : ""}</span>
        </li>)}
      </ol>
      <ul className="habit-legend" aria-label="Calendar key">
        {(Object.keys(HABIT_DAY_LABELS) as HabitDayStatus[]).map(status => <li key={status} className={`habit-day-${status}`}><HabitDayIcon status={status} /><span>{HABIT_DAY_LABELS[status]}</span></li>)}
        <li><HabitDayIcon status="gap" /><span>Gap in record</span></li>
      </ul>
    </div>}
    {!calm && <p className="mt-4 text-sm leading-6">{progress.protections.remaining} of {progress.protections.limit} freezes available within {progress.protections.windowDays} days. Pauses do not use freezes.</p>}
    <p className="mt-2 text-sm leading-6">Only completed days increase your total. Add a past day below if you completed it.</p>
    {!calm && <details className="mt-2">
      <summary className="habit-summary">How gaps affect your streak</summary>
      <p className="pb-3 text-sm leading-6">Unrecorded planned days have 48 hours after that day ends to catch up. Then a freeze protects the gap, if available. A gap in your record can end the displayed streak. It does not mean you missed the activity. Adding a completed day recalculates your progress.</p>
    </details>}
    {!progress.coverage.scheduleHistoryComplete && progress.coverage.note && <p className="mt-3 text-sm leading-6">{progress.coverage.note}</p>}
    {!calm && <details className="mt-4">
      <summary className="habit-summary">Past achievements</summary>
      <div className="space-y-2 py-3 text-sm">
        <p>Longest streak: {progress.longestRun} completed planned days.</p>
        {progress.achievements.length ? <ul className="space-y-1">{progress.achievements.map(a => <li key={a.id}>{a.id === "graduated" ? "Habit graduated" : `${a.days} completed days`}{a.earnedOn ? `, reached ${habitDateLabel(a.earnedOn)}` : ""}</li>)}</ul> : <p>Your first milestone is ahead. Your completed days already count.</p>}
        {progress.coverage.scheduleHistoryComplete && progress.coverage.note && <p>{progress.coverage.note}</p>}
      </div>
    </details>}
  </section>;
}
