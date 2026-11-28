import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Circle, Plus, X } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { NOTE_AUTOSAVE_MS } from "@/lib/autosave";

// The parts of an add-on's page (core/addon-notebook.mjs). Every string the add-on sent is shown as
// text; nothing it sends is rendered as markup, and a kind this screen does not know is one plain line.
export type Part = { kind: string; id?: string; title?: string; [key: string]: any };
export type SaveResult<T> = { state: "saved"; value: T } | { state: "conflict"; current: T };
export type Api = {
  save: (part: string, value: any, base: any) => Promise<SaveResult<any>>;
  act: (part: string, input?: Record<string, string>) => Promise<{ state: string; message: string; refresh?: boolean }>;
  job: (job: string) => Promise<{ state: string; message: string; progress?: number }>;
};

// Typing is saved after a pause, one write at a time. A section that changed since this page loaded
// it is not overwritten: the newer text is shown beside what the person typed, and they choose.
function useField<T extends string | string[]>(initial: T, save: (value: T, base: T) => Promise<SaveResult<T>>) {
  const [value, setValue] = useState<T>(initial);
  const [conflict, setConflict] = useState<T | null>(null);
  const [error, setError] = useState("");
  const base = useRef<T>(initial), latest = useRef<T>(initial), timer = useRef<ReturnType<typeof setTimeout> | null>(null), busy = useRef(false), again = useRef(false);
  const same = (a: T, b: T) => JSON.stringify(a) === JSON.stringify(b);
  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (busy.current) { again.current = true; return; }
    if (same(latest.current, base.current)) return;
    busy.current = true;
    const sent = latest.current;
    try {
      const result = await save(sent, base.current);
      if (result.state === "conflict") setConflict(result.current);
      else { base.current = result.value; setError(""); }
    } catch (e: any) { setError(e.message || "This could not be saved."); }
    busy.current = false;
    if (again.current) { again.current = false; void flush(); }
  }, [save]);
  const change = (next: T) => {
    latest.current = next; setValue(next); setError("");
    if (conflict === null) { if (timer.current) clearTimeout(timer.current); timer.current = setTimeout(() => void flush(), NOTE_AUTOSAVE_MS); }
  };
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); void flush(); } }, [flush]);
  const keepMine = () => { base.current = conflict as T; setConflict(null); void flush(); };
  const useNewer = () => { base.current = conflict as T; latest.current = conflict as T; setValue(conflict as T); setConflict(null); };
  return { value, change, conflict, error, keepMine, useNewer, flush };
}

function Conflict({ newer, keepMine, useNewer }: { newer: string; keepMine: () => void; useNewer: () => void }) {
  return (
    <Alert role="alert">
      <AlertDescription className="space-y-2">
        <p>This changed while you were typing. Your text is kept below; the newer text is:</p>
        <p className="whitespace-pre-wrap rounded border p-2 text-sm">{newer || "(empty)"}</p>
        <div className="flex gap-2"><Button size="sm" onClick={keepMine}>Keep mine</Button><Button size="sm" variant="outline" onClick={useNewer}>Use newer</Button></div>
      </AlertDescription>
    </Alert>
  );
}

function TextPart({ part, api }: { part: Part; api: Api }) {
  const f = useField<string>(part.value ?? "", useCallback((v, b) => api.save(part.id!, v, b), [api, part.id]));
  return (
    <div className="space-y-2">
      <Label htmlFor={`part-${part.id}`}>{part.title}</Label>
      <Textarea id={`part-${part.id}`} value={f.value} placeholder={part.hint} className="min-h-24 [field-sizing:content]" onChange={(e) => f.change(e.target.value)} onBlur={() => void f.flush()} />
      {f.error && <p role="alert" className="text-sm text-destructive">{f.error}</p>}
      {f.conflict !== null && <Conflict newer={f.conflict} keepMine={f.keepMine} useNewer={f.useNewer} />}
    </div>
  );
}

function ListPart({ part, api }: { part: Part; api: Api }) {
  const f = useField<string[]>(part.items ?? [], useCallback((v, b) => api.save(part.id!, v, b), [api, part.id]));
  const [fresh, setFresh] = useState("");
  const add = () => { const item = fresh.trim(); if (!item) return; f.change([...f.value, item]); setFresh(""); };
  return (
    <div className="space-y-2">
      <Label htmlFor={`part-${part.id}`}>{part.title}</Label>
      <ul className="space-y-2">
        {f.value.map((item, i) => (
          <li key={i} className="flex items-center gap-2">
            <Input aria-label={`${part.title} ${i + 1}`} value={item} onChange={(e) => f.change(f.value.map((x, j) => (j === i ? e.target.value : x)))} onBlur={() => void f.flush()} />
            <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${item}`} onClick={() => { f.change(f.value.filter((_, j) => j !== i)); void f.flush(); }}><X className="h-4 w-4" /></Button>
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Input id={`part-${part.id}`} value={fresh} placeholder={part.hint || "Add one"} onChange={(e) => setFresh(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); add(); } }} />
        <Button type="button" variant="outline" onClick={add}><Plus className="mr-1 h-4 w-4" />Add</Button>
      </div>
      {f.error && <p role="alert" className="text-sm text-destructive">{f.error}</p>}
      {f.conflict !== null && <Conflict newer={f.conflict.join("\n")} keepMine={f.keepMine} useNewer={f.useNewer} />}
    </div>
  );
}

// An action runs at the add-on and answers done, ask or failed; while it answers "working" the job is asked again.
function useRun(api: Api) {
  const [said, setSaid] = useState(""), [running, setRunning] = useState(false);
  const gone = useRef(false);
  useEffect(() => () => { gone.current = true; }, []);
  const run = async (start: () => Promise<{ state: string; message: string; job?: string }>) => {
    setRunning(true); setSaid("");
    try {
      let answer = await start();
      while (answer.state === "working" && answer.job && !gone.current) { setSaid(answer.message); await new Promise((r) => setTimeout(r, 2000)); answer = await api.job(answer.job); }
      setSaid(answer.message);
    } catch (e: any) { setSaid(e.message || "That did not work."); }
    setRunning(false);
  };
  return { said, running, run };
}

function ActionPart({ part, api }: { part: Part; api: Api }) {
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const r = useRun(api);
  return (
    <div className="space-y-2">
      {part.inputs?.map((i: any) => (
        <div key={i.id} className="space-y-1"><Label htmlFor={`part-${part.id}-${i.id}`}>{i.label}</Label><Input id={`part-${part.id}-${i.id}`} value={inputs[i.id] ?? ""} onChange={(e) => setInputs({ ...inputs, [i.id]: e.target.value })} /></div>
      ))}
      <Button disabled={r.running} onClick={() => void r.run(() => api.act(part.id!, inputs))}>{part.label || part.title}</Button>
      {r.said && <p role="status" className="text-sm text-muted-foreground">{r.said}</p>}
    </div>
  );
}

function ChoicePart({ part, api }: { part: Part; api: Api }) {
  const r = useRun(api);
  return (
    <div className="space-y-2">
      {part.text && <p>{part.text}</p>}
      <RadioGroup aria-label={part.title} disabled={r.running} onValueChange={(choice) => void r.run(() => api.act(part.id!, { choice }))}>
        {part.choices?.map((c: any) => (<div key={c.id} className="flex items-center gap-2"><RadioGroupItem id={`part-${part.id}-${c.id}`} value={c.id} /><Label htmlFor={`part-${part.id}-${c.id}`}>{c.title}</Label></div>))}
      </RadioGroup>
      {r.said && <p role="status" className="text-sm text-muted-foreground">{r.said}</p>}
    </div>
  );
}

function StepsPart({ part }: { part: Part }) {
  return (
    <ol className="space-y-1">
      {part.steps?.map((s: any, i: number) => (
        <li key={i} className="flex items-center gap-2" aria-current={s.state === "current" ? "step" : undefined}>
          {s.state === "done" ? <Check className="h-4 w-4 text-primary" /> : <Circle className={`h-4 w-4 ${s.state === "current" ? "text-primary" : "text-muted-foreground"}`} />}
          <span className={s.state === "todo" ? "text-muted-foreground" : ""}>{s.title}</span>
          {s.state === "current" && <Badge variant="secondary">Now</Badge>}
        </li>
      ))}
    </ol>
  );
}

function PeoplePart({ part }: { part: Part }) {
  return part.people?.length
    ? <ul className="space-y-1">{part.people.map((p: any) => <li key={p.id}><Link className="underline" to={`/dashboard/people/${p.id}`}>{p.name}</Link></li>)}</ul>
    : <p className="text-sm text-muted-foreground">Nobody here yet.</p>;
}

function Body({ part, api }: { part: Part; api: Api }) {
  switch (part.kind) {
    case "text": return <TextPart part={part} api={api} />;
    case "list": return <ListPart part={part} api={api} />;
    case "action": return <ActionPart part={part} api={api} />;
    case "choice": return <ChoicePart part={part} api={api} />;
    case "steps": return <StepsPart part={part} />;
    case "people": return <PeoplePart part={part} />;
    case "note": return part.noteId ? <Link className="underline" to={`/dashboard/notes/${part.noteId}`}>{part.title || "Open the note"}</Link> : <p className="text-sm text-muted-foreground">That note is not there yet.</p>;
    default: return <p className="text-sm text-muted-foreground">This part is not available in this version of the notebook.</p>;
  }
}

export function AddonPart({ part, api }: { part: Part; api: Api }) {
  const titled = !["text", "list", "unknown"].includes(part.kind) && part.title && part.kind !== "action";
  return (
    <Card>
      {titled && <CardHeader><CardTitle className="font-display text-lg">{part.title}</CardTitle></CardHeader>}
      <CardContent className={titled ? "" : "pt-6"}><Body part={part} api={api} /></CardContent>
    </Card>
  );
}
