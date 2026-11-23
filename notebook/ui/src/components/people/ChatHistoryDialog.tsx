import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useAICreditsGate } from "@/hooks/useAICreditsGate";
import { functionErrorMessage } from "@/lib/function-error";
import { showDate } from "@/lib/local-date";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { alreadyKnown, monthRequests, readChatFile, type ChatMonth, type KnownMoment } from "@/lib/whatsapp-export";
import { NO_AI_CONNECT } from "../../../../core/no-ai.mjs";

interface Suggestion { id: number; title: string; day: string; quote: string; status: string; impact: number; people: string[] }
interface Person { id: string; name: string }
interface Props { open: boolean; onOpenChange: (open: boolean) => void; personId: string; personName: string; people: Person[]; onSaved: () => void }

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_NAME = (month: string) => {
  const [year, number] = month.split("-");
  return `${MONTH_NAMES[Number(number) - 1] ?? number} ${year}`;
};

// The moments the timeline already holds, with the names of the people in each.
async function knownMoments(): Promise<KnownMoment[]> {
  const { data: rows, error: rowsError } = await supabase.from("moments" as any).select("id, title, happened_at, person_id").is("deleted_at", null);
  const { data: links, error: linksError } = await supabase.from("moment_participants" as any).select("moment_id, person_id");
  const { data: contacts, error: contactsError } = await supabase.from("contacts" as any).select("id, name");
  const failure = rowsError || linksError || contactsError;
  if (failure) throw failure;
  const names = new Map<string, string>((contacts || []).map((c: any) => [c.id, c.name]));
  return (rows || []).filter((m: any) => m.happened_at).map((m: any) => {
    const ids = new Set<string>([m.person_id, ...(links || []).filter((l: any) => l.moment_id === m.id).map((l: any) => l.person_id)].filter(Boolean));
    return { title: m.title, day: String(m.happened_at).slice(0, 10), people: [...ids].map((id) => names.get(id) || "") };
  });
}

export function ChatHistoryDialog({ open, onOpenChange, personId, personName, people, onSaved }: Props) {
  const { user } = useAuth();
  const { providerConfigured } = useAICreditsGate();
  const [months, setMonths] = useState<ChatMonth[] | null>(null);
  const [problem, setProblem] = useState("");
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);
  const [finished, setFinished] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [saved, setSaved] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingNow = useRef(false);
  const run = useRef(0);

  const reset = () => { run.current++; setMonths(null); setProblem(""); setRunning(false); setDone(0); setFinished(false); setSuggestions([]); setSaved(0); };
  useEffect(() => { if (!open) reset(); }, [open]);
  useEffect(() => () => { run.current++; }, []);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    reset();
    try { setMonths(await readChatFile(file)); } catch (error) { setProblem(error instanceof Error ? error.message : "This file could not be read."); }
  };

  const start = async () => {
    if (!months || running || !providerConfigured) return;
    const mine = ++run.current;
    setRunning(true); setDone(0); setFinished(false); setProblem(""); setSuggestions([]);
    let known: KnownMoment[];
    try { known = await knownMoments(); } catch { setRunning(false); setProblem("Your timeline could not be read. Try again."); return; }
    let id = 0;
    for (const [index, month] of months.entries()) {
      for (const lines of monthRequests(month)) {
        if (run.current !== mine) return;
        const { data, error } = await supabase.functions.invoke("draft-chat-moments", { body: { month: month.month, person: { name: personName }, lines } });
        if (run.current !== mine) return;
        if (error || !data) { setRunning(false); setProblem(await functionErrorMessage(error, "The AI could not read this chat. Try again.")); return; }
        const fresh: Suggestion[] = [];
        for (const m of (data as any).moments || []) {
          const candidate = { title: m.title as string, day: m.happened_at as string, people: [personName, ...(m.participants || []).filter((n: string) => people.some((p) => p.name.toLowerCase() === n.toLowerCase()))] };
          if (alreadyKnown(candidate, known)) continue;
          known.push(candidate);
          fresh.push({ id: id++, title: m.title, day: m.happened_at, quote: m.quote || "", status: m.status, impact: m.impact_level, people: candidate.people });
        }
        if (fresh.length) setSuggestions((list) => [...list, ...fresh]);
      }
      setDone(index + 1);
    }
    setRunning(false); setFinished(true);
  };

  const keep = async (items: Suggestion[]) => {
    if (!user || !items.length || savingNow.current) return;
    savingNow.current = true; setSaving(true);
    let keptAny = false;
    try {
      for (const s of items) {
        const { data, error } = await supabase.from("moments" as any).insert({
          user_id: user.id, title: s.title, description: s.quote ? `“${s.quote}”` : null, happened_at: s.day, happened_end: null,
          status: s.status, impact_level: s.impact, confidence_date: 5, confidence_truth: 5, person_id: personId, source: "manual",
        }).select("id").single();
        if (error || !data) throw error || new Error("Moment was not created");
        const others = s.people.slice(1).map((n) => people.find((p) => p.name.toLowerCase() === n.toLowerCase())?.id).filter((x): x is string => !!x && x !== personId);
        const { error: linkError } = await supabase.from("moment_participants" as any).insert([...new Set([personId, ...others])].map((person_id) => ({ moment_id: (data as any).id, person_id })));
        if (linkError) {
          await supabase.from("moments" as any).delete().eq("id", (data as any).id);
          throw linkError;
        }
        keptAny = true;
        setSuggestions((list) => list.filter((x) => x.id !== s.id));
        setSaved((n) => n + 1);
      }
    } catch {
      setProblem(keptAny ? "A moment could not be saved. The ones already kept are on the timeline; this one is still listed." : "A moment could not be saved. It is still listed.");
    } finally {
      savingNow.current = false; setSaving(false);
      if (keptAny) onSaved();
    }
  };

  const first = months?.[0], last = months?.[months.length - 1];
  const sentence = months && first && last
    ? `Starting sends this chat, month by month, to your connected AI, and the chat covers ${months.length} month${months.length === 1 ? "" : "s"}, ${MONTH_NAME(first.month)} to ${MONTH_NAME(last.month)}.`
    : "";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Add a chat history with {personName}</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="chat-history-file">WhatsApp export file (.txt or .zip, without media)</Label>
            <input id="chat-history-file" type="file" accept=".txt,.zip,text/plain,application/zip" disabled={running}
              onChange={(e) => { void choose(e.target.files?.[0]); e.target.value = ""; }} className="block w-full text-sm" />
          </div>
          {problem && <p role="alert" className="text-sm text-destructive">{problem}</p>}
          {months && !running && !finished && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">{sentence}</p>
              {!providerConfigured && <p role="status" className="text-sm text-muted-foreground">{NO_AI_CONNECT}</p>}
              <Button onClick={start} disabled={!providerConfigured}>Start</Button>
            </div>
          )}
          {months && (running || finished) && (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              {running && <Loader2 className="h-4 w-4 animate-spin" />}
              {finished ? `Done: all ${months.length} months read.` : `Reading month ${Math.min(done + 1, months.length)} of ${months.length}`}
              {saved > 0 && ` · ${saved} kept`}
            </p>
          )}
          {finished && !suggestions.length && <p className="text-sm text-muted-foreground">{saved ? "No more suggestions." : "No moments were found in this chat."}</p>}
          {suggestions.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">{suggestions.length} suggested moment{suggestions.length === 1 ? "" : "s"}</h3>
                <Button size="sm" variant="outline" disabled={saving} onClick={() => void keep(suggestions)}>Keep all</Button>
              </div>
              <ul className="space-y-2">
                {suggestions.map((s) => (
                  <li key={s.id} className="rounded-lg border p-3">
                    <p className="text-xs text-muted-foreground">{showDate(s.day, "day")}</p>
                    <p className="font-medium">{s.title}</p>
                    {s.quote && <p className="mt-1 text-sm italic text-muted-foreground">“{s.quote}”</p>}
                    <div className="mt-2 flex gap-2">
                      <Button size="sm" aria-label={`Keep ${s.title}`} disabled={saving} onClick={() => void keep([s])}>Keep</Button>
                      <Button size="sm" variant="ghost" aria-label={`Drop ${s.title}`} onClick={() => setSuggestions((list) => list.filter((x) => x.id !== s.id))}>Drop</Button>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>{running ? "Stop and close" : "Close"}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
