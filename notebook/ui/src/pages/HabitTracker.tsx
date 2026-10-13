import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { SEOHead } from "@/components/SEOHead";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadErrorState } from "@/components/collections/LoadErrorState";
import { HabitProgress } from "@/components/collections/HabitProgress";
import { habitDateLabel, type HabitProgress as Progress } from "@/lib/habit-progress";
import { habitDays } from "@/lib/tracker-shelf";

// One habit on the Trackers shelf (D-321, step 3). Its days are the coach's own record, the habit
// file the evening check and the talks read; every change here goes back through the coach
// (personal operations track and tracker-correct), so a day is never kept twice.
type Habit = { id: string; name: string; hash?: string; talk?: string | null; habit_status?: string; doneMeans?: string; daysText?: string; progress?: Progress; recent?: { when?: string; data?: { answer?: string; note?: string } | null }[] | null };
const ANSWERS = [["done", "Done"], ["no", "Not done"], ["skip", "Excused day"]] as const;
const selectClass = "block w-full min-h-11 rounded-md border bg-background px-3 text-base";

export default function HabitTracker() {
  const { id = "" } = useParams();
  const [habit, setHabit] = useState<Habit | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "failed">("loading");
  const [busy, setBusy] = useState(false);
  const [day, setDay] = useState("");
  const [answer, setAnswer] = useState("done");
  const [note, setNote] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("");
  const [visibleHistory, setVisibleHistory] = useState(14);
  const busyRef = useRef(false);

  const load = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("personal-operation", { body: { type: "tracker-list", days: 366, calendarDays: 14 } });
    if (error) { setState("failed"); return; }
    const found = ((data as { trackers?: Habit[] } | null)?.trackers ?? []).find((t) => t.id === id) ?? null;
    setHabit(found);
    if (found?.progress?.today) {
      setDay(current => current || found.progress!.today);
      setFrom(current => current || found.progress!.today);
      setTo(current => current || found.progress!.today);
    }
    setState(found ? "ready" : "missing");
  }, [id]);
  useEffect(() => { setDay(""); setFrom(""); setTo(""); load(); }, [load]);

  const run = async (body: Record<string, unknown>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("personal-operation", { body: { tracker: id, ...(habit?.hash ? { expected: { [id]: habit.hash } } : {}), ...body } });
      if (error) { toast.error(error.message); await load(); return; }
      toast.success((data as { reply?: string } | null)?.reply ?? "Saved");
      await load();
    } catch { toast.error("The change could not be saved. Try again."); }
    finally { busyRef.current = false; setBusy(false); }
  };

  if (state === "loading") return <p className="text-sm text-muted-foreground" role="status">Loading your habit…</p>;
  if (state === "failed") return <LoadErrorState className="min-h-[40vh]" title="This habit could not be loaded." onRetry={() => { setState("loading"); load(); }} />;
  if (state === "missing" || !habit) return <p className="text-sm">There is no habit here any more. <Link className="underline" to="/collections">Back to Collections</Link></p>;
  const days = habitDays(habit);
  const progress = habit.progress;
  const today = progress?.calendar.find(d => d.date === progress.today);
  const paused = habit.habit_status === "paused";
  const active = !habit.habit_status || habit.habit_status === "active";
  return (
    <div className="habit-tracker w-full max-w-3xl space-y-6" aria-busy={busy}>
      <SEOHead title={`${habit.name} - Godspeed Mission Control`} noIndex />
      <div>
        <Link to="/collections" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">Back to your trackers</Link>
        <h1 className="mt-1 text-2xl font-bold font-display">{habit.name}</h1>
      </div>
      {progress ? <>
        <HabitProgress progress={progress} habitStatus={habit.habit_status}>
          {active && today?.scheduled && today.status !== "completed" && today.status !== "paused" && <><p className="habit-tiny-action">{habit.doneMeans || habit.name}</p><Button disabled={busy} onClick={() => run({ type: "track", on: progress.today, answer: "done" })}>I did it</Button></>}
          {today?.status === "completed" && <p>A small step, kept. {habit.doneMeans}</p>}
          {active && today && (!today.scheduled || today.status === "paused") && today.status !== "completed" && <p>Nothing to complete today. You can still add a completed day below.</p>}
          {paused && <Button disabled={busy} onClick={() => run({ type: "habit-progress", action: "resume", on: progress.today })}>Resume this habit</Button>}
        </HabitProgress>
      </> : <p role="status">Progress could not be calculated. Your recorded days are below.</p>}
      <details className="border-t pt-2">
        <summary className="habit-summary">Add or correct a day</summary>
        <p className="mt-1 text-sm leading-6">Already did it? Record it here. A late entry counts on the day you did it.</p>
        <form className="mt-3 grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); run({ type: "track", on: day, answer, ...(note.trim() ? { note: note.trim() } : {}) }); }}>
          <label className="space-y-1 text-sm font-medium">Day<Input className="text-base" type="date" value={day} max={progress?.today} onChange={(e) => setDay(e.target.value)} required disabled={busy || !progress} /></label>
          <label className="space-y-1 text-sm font-medium">What happened?<select className={selectClass} value={answer} onChange={(e) => setAnswer(e.target.value)} disabled={busy}>{ANSWERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="space-y-1 text-sm font-medium sm:col-span-2">Note (optional)<Input className="text-base" value={note} onChange={e => setNote(e.target.value)} maxLength={1000} disabled={busy} /></label>
          <Button type="submit" className="sm:justify-self-start" disabled={busy || !progress}>Save this day</Button>
        </form>
      </details>
      {progress && <details className="border-t pt-2">
        <summary className="habit-summary font-medium">Pauses and display</summary>
        <div className="space-y-6 pb-4 pt-3">
          {habit.doneMeans && <p className="text-sm leading-6">Your small step: {habit.doneMeans}</p>}
          {habit.daysText && <p className="text-sm">Planned: {habit.daysText}</p>}
          <div>
            <label className="space-y-2 text-sm font-medium">Progress display<select className={selectClass} value={progress.display} disabled={busy} onChange={e => run({ type: "habit-progress", action: "display", display: e.target.value })}><option value="standard">Streaks and milestones</option><option value="calm">Calm view: completed days only</option></select></label>
            <p className="mt-2 text-sm">Calm view hides streaks and milestones. Your record stays the same.</p>
          </div>
          {(active || paused) && <div className="space-y-2">
            <h3 className="font-medium">Taking a break?</h3>
            <p className="text-sm leading-6">Pause for as long as you need. Illness, holidays and caring duties do not have to use freezes.</p>
            {active && <Button variant="outline" disabled={busy} onClick={() => run({ type: "habit-progress", action: "pause", on: progress.today })}>Pause from today</Button>}
          </div>}
          <form className="space-y-3" onSubmit={e => { e.preventDefault(); run({ type: "habit-progress", action: "exempt", from, to, note: reason.trim() }); }}>
            <div><h3 className="font-medium">Excuse a break, including a past one</h3><p className="mt-1 text-sm leading-6">These dates preserve your streak without adding completed days or using freezes.</p></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm font-medium">First day<Input className="text-base" type="date" required value={from} max={to || undefined} onChange={e => setFrom(e.target.value)} disabled={busy} /></label>
              <label className="space-y-1 text-sm font-medium">Last day<Input className="text-base" type="date" required value={to} min={from || undefined} onChange={e => setTo(e.target.value)} disabled={busy} /></label>
            </div>
            <label className="block space-y-1 text-sm font-medium">Reason (optional)<Input className="text-base" value={reason} maxLength={1000} onChange={e => setReason(e.target.value)} disabled={busy} /></label>
            <Button variant="outline" type="submit" disabled={busy}>Excuse these dates</Button>
          </form>
          <p className="text-sm leading-6">Days follow {progress.timezone}, changing at midnight. Travel does not silently change your habit dates.</p>
        </div>
      </details>}
      <details className="border-t pt-2">
        <summary className="habit-summary font-medium">Recorded days from the last year ({days.length})</summary>
        <p className="mt-1 text-sm">Your all-time total also includes earlier completed days.</p>
        {!days.length ? <p className="py-4 text-sm">No days recorded in the last year. Start with your next small step.</p> : <>
          <ul className="divide-y">{days.slice(0, visibleHistory).map(d => <li key={d.day} className="grid gap-2 py-4 sm:grid-cols-[1fr_10rem]">
            <div><time dateTime={d.day} className="font-medium">{habitDateLabel(d.day, true)}</time>{d.note && <p className="mt-1 text-sm leading-6">{d.note}</p>}</div>
            <label className="text-sm">Answer<select aria-label={`Answer on ${d.day}`} className={selectClass} value={d.answer} disabled={busy} onChange={e => run({ type: "tracker-correct", entry_id: d.day, answer: e.target.value })}>{ANSWERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <Button className="justify-self-start sm:col-span-2" variant="ghost" disabled={busy} onClick={() => { if (window.confirm(`Undo the latest entry for ${habitDateLabel(d.day)}? An earlier answer may return.`)) run({ type: "tracker-correct", entry_id: d.day, remove: true }); }}>Undo latest entry</Button>
          </li>)}</ul>
          {visibleHistory < days.length && <Button className="my-3" variant="outline" onClick={() => setVisibleHistory(n => n + 30)}>Show earlier days</Button>}
        </>}
      </details>
    </div>
  );
}
