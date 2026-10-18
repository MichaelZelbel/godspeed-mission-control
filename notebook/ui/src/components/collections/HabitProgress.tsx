import type { ReactNode } from "react";
import { Check, CircleHelp, Minus, Pause, Circle, X } from "lucide-react";
import { habitDayLabel, habitDateLabel, type HabitDayStatus, type HabitProgress as Progress } from "@/lib/habit-progress";
import ready from "../../../../core/progress-assets/playful/flame-ready.svg";
import done from "../../../../core/progress-assets/playful/flame-done.svg";
import ice from "../../../../core/progress-assets/playful/flame-ice.svg";
import rest from "../../../../core/progress-assets/playful/flame-rest.svg";
import "./habit-progress.css";

const ART = { completed: done, protected: ice, paused: rest, notplanned: rest, unknown: ready };
const ICONS = { completed: Check, protected: Check, paused: Pause, notplanned: Minus, unknown: CircleHelp, missed: X, gap: Circle };
export function HabitDayIcon({ status }: { status: HabitDayStatus | "gap" }) {
  if (status in ART) return <img src={ART[status as keyof typeof ART]} alt="" width="256" height="256" className="habit-day-art" />;
  const Icon = ICONS[status];
  return <Icon aria-hidden="true" className="habit-day-icon" strokeWidth={2} />;
}

export function HabitProgress({ progress, habitStatus = "active", children }: { progress: Progress; habitStatus?: string; children?: ReactNode }) {
  const week = progress.calendar.slice(-7);
  const calm = progress.display === "calm";
  const today = progress.calendar.find(day => day.date === progress.today);
  const paused = habitStatus === "paused";
  const graduated = habitStatus === "graduated";
  const completed = today?.status === "completed";
  const resting = paused || graduated || today?.status === "paused" || today?.status === "notplanned";
  const heroArt = resting ? rest : completed ? done : today?.status === "protected" ? ice : ready;
  const headline = paused ? "Paused, progress safe" : graduated ? "A habit well kept" : completed ? "A little brighter today" : progress.currentRun ? String(progress.currentRun.toLocaleString("en-GB")) + "-day streak" : "A fresh spark";
  const shortLabel = (day: Progress["calendar"][number]) => ({ completed: "", protected: "Saved", paused: "Rest", notplanned: "Off", unknown: day.date === progress.today ? "Today" : "", missed: day.answer === null ? "Gap" : "Not done" }[day.status]);
  return <section className={"habit-progress" + (calm ? " habit-progress-calm" : "") + (paused ? " habit-progress-paused" : "")} aria-label="Habit progress">
    <div className="habit-glow">
      <div className="habit-hero">
        {!calm && <img className="habit-hero-art" src={heroArt} alt="" width="256" height="256" />}
        <div>
          <p className="habit-eyebrow">{paused ? "Room to rest" : graduated ? "Keep what you built" : completed ? "Today is done" : resting ? "No action due today" : "One small step"}</p>
          <h2 className="habit-hero-title">{calm ? paused ? "Paused, progress safe" : completed ? "Today is done" : "Your next small step" : headline}</h2>
          {!calm && completed && progress.currentRun > 0 && <p className="habit-hero-note">{progress.currentRun}-day streak, kept.</p>}
          {paused && <p className="habit-hero-note">Take the time you need.</p>}
          {!paused && !graduated && resting && <p className="habit-hero-note">Your streak can rest too.</p>}
          {!calm && !resting && !completed && (progress.currentRun === 0 || (progress.pendingDays ?? 0) > 0) && <p className="habit-hero-note">{progress.currentRun === 0 ? "Your next tiny win starts here." : "Recent days still to record."}</p>}
        </div>
      </div>
      {children && <div className="habit-next-step">{children}</div>}
    </div>
    <div className="habit-lifetime"><span className="habit-lifetime-number">{progress.lifetimeCompletedDays.toLocaleString("en-GB")}</span><div><h3>Days completed, all time</h3><p>Yours to keep. Even after a break.</p></div></div>
    {week.length > 0 && <div className="habit-week-section">
      <h3 className="habit-week-heading">Seven little steps</h3>
      <ol className="habit-week" aria-label="Recent days">
        {week.map(day => <li key={day.date} className={"habit-calendar-day habit-day-" + day.status + (day.date === progress.today ? " habit-is-today" : "")} aria-label={habitDateLabel(day.date, true) + ": " + habitDayLabel(day) + (day.reason ? ". " + day.reason : "")}>
          <span className="habit-weekday">{day.weekday}</span>
          <span className="habit-day-symbol">{calm ? <span className="habit-calm-symbol" aria-hidden="true">{day.status === "completed" ? "✓" : day.status === "protected" ? "◇" : day.status === "missed" ? "○" : "·"}</span> : day.status === "unknown" ? day.date === progress.today ? <svg className="habit-waiting-spark" viewBox="0 0 48 56" aria-hidden="true"><path d="M25 6c2 10-5 13-5 20-5-1-7-5-6-9C4 27 3 39 9 46c7 8 23 8 30-1 7-9 3-19-3-25 1 7-2 9-4 9 2-10-2-16-7-23Z" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round"/><path d="m24 35 3 5-3 5-3-5Z" fill="currentColor" opacity=".5"/></svg> : <span className="habit-unrecorded-dot" aria-hidden="true" /> : <HabitDayIcon status={day.status === "missed" && day.answer === null ? "gap" : day.status} />}</span>
          <time dateTime={day.date} className="habit-date">{habitDateLabel(day.date)}</time>
          <span className="habit-day-caption">{shortLabel(day)}</span>
        </li>)}
      </ol>
    </div>}
    {!calm && <div className="habit-ice-bank">
      <div className="habit-ice-icons" aria-hidden="true">{Array.from({ length: Math.min(2, progress.protections.limit) }, (_, i) => <img key={i} src={ice} width="256" height="256" alt="" className={i < progress.protections.remaining ? "" : "habit-ice-used"} />)}</div>
      <div><h3>{progress.protections.remaining} {progress.protections.remaining === 1 ? "freeze" : "freezes"} ready</h3><p>{paused ? "Your progress is safe. Pauses use no ice." : graduated ? "Your completed days are yours to keep." : progress.currentRun === 0 ? "These freezes can protect your next streak." : "Ice covers a missed planned day; without ice, a gap can end this streak."}</p></div>
    </div>}
    <details className="habit-progress-details">
      <summary className="habit-summary">{calm ? "About your record" : "Streak safety and milestones"}</summary>
      <div className="habit-details-content">
        {!calm && <><p>Unrecorded planned days have 48 hours after that day ends to catch up. Then a freeze protects the gap, if available.</p><p>Without a freeze, a gap can end the displayed streak. It does not mean you missed the activity. Your all-time total stays.</p><p>You have {progress.protections.limit} freezes in any {progress.protections.windowDays}-day window. Pauses and excused dates do not use ice.</p></>}
        <p>Only completed days increase your total. Add a past day below if you completed it.</p>
        {progress.coverage.note && <p>{progress.coverage.note}</p>}
        {!calm && <><p>Longest streak: {progress.longestRun} completed planned days.</p>{progress.nextMilestone && <div><p>Next milestone: {progress.nextMilestone.days} completed days. {progress.nextMilestone.remaining} to go.</p><progress className="habit-milestone" max={progress.nextMilestone.days} value={progress.lifetimeCompletedDays} aria-label={"Next milestone: " + progress.nextMilestone.days + " completed days"} /></div>}<h3 className="font-semibold">Past achievements</h3>{progress.achievements.length ? <ul>{progress.achievements.map(a => <li key={a.id}>{a.id === "graduated" ? "Habit graduated" : String(a.days) + " completed days"}{a.earnedOn ? ", reached " + habitDateLabel(a.earnedOn) : ""}</li>)}</ul> : <p>Your first milestone is ahead. Your completed days already count.</p>}</>}
      </div>
    </details>
  </section>;
}
