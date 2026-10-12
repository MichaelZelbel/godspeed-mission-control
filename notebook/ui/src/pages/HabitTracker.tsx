import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { SEOHead } from "@/components/SEOHead";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LoadErrorState } from "@/components/collections/LoadErrorState";
import { habitDays } from "@/lib/tracker-shelf";

// One habit on the Trackers shelf (D-321, step 3). Its days are the coach's own record, the habit
// file the evening check and the talks read; every change here goes back through the coach
// (personal operations track and tracker-correct), so a day is never kept twice.
type Habit = { id: string; name: string; talk?: string | null; habit_status?: string; recent?: { when?: string; data?: { answer?: string; note?: string } | null }[] | null };
const ANSWERS = [["done", "Done"], ["no", "Not done"], ["skip", "Does not count"]] as const;
const localDay = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export default function HabitTracker() {
  const { id = "" } = useParams();
  const [habit, setHabit] = useState<Habit | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "failed">("loading");
  const [busy, setBusy] = useState(false);
  const [day, setDay] = useState(localDay());
  const [answer, setAnswer] = useState("done");

  const load = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("personal-operation", { body: { type: "tracker-list", days: 366 } });
    if (error) { setState("failed"); return; }
    const found = ((data as { trackers?: Habit[] } | null)?.trackers ?? []).find((t) => t.id === id) ?? null;
    setHabit(found);
    setState(found ? "ready" : "missing");
  }, [id]);
  useEffect(() => { load(); }, [load]);

  const run = async (body: Record<string, unknown>) => {
    setBusy(true);
    const { data, error } = await supabase.functions.invoke("personal-operation", { body: { tracker: id, ...body } });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success((data as { reply?: string } | null)?.reply ?? "Saved");
    load();
  };

  if (state === "loading") return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (state === "failed") return <LoadErrorState className="min-h-[40vh]" title="This habit could not be loaded." onRetry={() => { setState("loading"); load(); }} />;
  if (state === "missing" || !habit) return <p className="text-sm">There is no habit here any more. <Link className="underline" to="/collections">Back to Collections</Link></p>;
  const days = habitDays(habit);
  return (
    <div className="w-full max-w-3xl space-y-6">
      <SEOHead title={`${habit.name} - Godspeed Mission Control`} noIndex />
      <div>
        <Link to="/collections" className="text-sm text-muted-foreground hover:text-foreground">Collections</Link>
        <h1 className="mt-1 text-2xl font-bold font-display">{habit.name}</h1>
        <p className="text-sm text-muted-foreground">
          A habit from your coach{habit.talk ? `, read in your ${habit.talk} talk` : ""}{habit.habit_status && habit.habit_status !== "active" ? `. It is ${habit.habit_status}.` : "."} Changes here go into the coach's own record.
        </p>
      </div>
      <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); run({ type: "track", on: day, answer, note: "Tracked in the notebook" }); }}>
        <label className="text-sm">Day<Input type="date" value={day} max={localDay()} onChange={(e) => setDay(e.target.value)} required /></label>
        <label className="text-sm">Answer
          <select className="block h-10 rounded-md border bg-background px-2" value={answer} onChange={(e) => setAnswer(e.target.value)}>
            {ANSWERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <Button type="submit" disabled={busy}>Track this day</Button>
      </form>
      {days.length === 0 ? <p className="text-sm text-muted-foreground">No day tracked in the last year.</p> : (
        <table className="w-full text-sm">
          <thead><tr className="text-left text-muted-foreground"><th className="py-2">Day</th><th>Answer</th><th>Words</th><th /></tr></thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.day} className="border-t">
                <td className="py-2 tabular-nums">{d.day}</td>
                <td>
                  <select aria-label={`Answer on ${d.day}`} className="h-9 rounded-md border bg-background px-2" value={d.answer} disabled={busy}
                    onChange={(e) => run({ type: "tracker-correct", entry_id: d.day, answer: e.target.value, note: "Changed in the notebook" })}>
                    {ANSWERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </td>
                <td className="max-w-xs truncate text-muted-foreground">{d.note}</td>
                <td className="text-right"><Button variant="ghost" size="sm" disabled={busy} onClick={() => run({ type: "tracker-correct", entry_id: d.day, remove: true })}>Take back</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
