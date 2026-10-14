import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BookUser, ChefHat, ChevronDown, Fingerprint, History, MessageSquare, Pencil, Plus, ShieldCheck, Trash2, Undo2, UserRound } from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ScopeBadge, SCOPE_OPTIONS } from "@/components/profile/ScopeBadge";
import { cn } from "@/lib/utils";
import {
  GROUPS, ORIGIN_WORDS, identity, manualAfter, reflow, sizeLine, sizeState, versionLine, whenLabel, ruleListLine,
  type Instruction, type InstructionVersion, type Item, type ManualSize, type Overview, type RuleFields, type RuleGroup, type SkillFields, type PageFields, type Version,
} from "@/lib/identity";

// THE IDENTITY PAGE (notebook/ui/DESIGN.md, "Identity page"): the files that make this mission
// control behave as it does, in four parts, each changed here or by asking in chat. Every change
// keeps the earlier version, and any version can be brought back as a new change.
const selectClass = "block w-full min-h-11 rounded-md border border-input bg-background px-3 text-base sm:text-sm";

function useInvalidate() {
  const qc = useQueryClient();
  return (target?: string) => {
    qc.invalidateQueries({ queryKey: ["identity"] });
    qc.invalidateQueries({ queryKey: ["identity-instructions"] });
    if (target) { qc.invalidateQueries({ queryKey: ["identity-item", target] }); qc.invalidateQueries({ queryKey: ["identity-history", target] }); }
  };
}

function Section({ id, icon, title, explain, action, children }: { id: string; icon: ReactNode; title: string; explain: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={id + "-heading"} className="scroll-mt-20 space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary" aria-hidden="true">{icon}</div>
          <div className="min-w-0">
            <h2 id={id + "-heading"} className="text-lg font-bold font-display">{title}</h2>
            <p className="mt-0.5 text-sm text-muted-foreground">{explain}</p>
          </div>
        </div>
        {action && <div className="flex shrink-0 flex-wrap gap-2 sm:pt-1">{action}</div>}
      </div>
      {children}
    </section>
  );
}

function ItemCard({ title, text, note, onOpen, waiting }: { title: string; text?: string; note?: string; onOpen: () => void; waiting?: boolean }) {
  return (
    <button type="button" onClick={onOpen} className="block w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
      <Card className="h-full cursor-pointer transition-colors hover:bg-accent/50">
        <CardHeader className="pb-2"><CardTitle className="text-base leading-snug">{title}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {text && <p className="line-clamp-3 text-sm text-muted-foreground">{text}</p>}
          {note && <p className="text-xs text-muted-foreground">{note}</p>}
          {waiting && <Badge variant="outline" className="border-warning/40 text-warning">Two versions wait for you in Settings</Badge>}
        </CardContent>
      </Card>
    </button>
  );
}

function SizeNote({ total, size }: { total: number | null; size?: ManualSize }) {
  const line = sizeLine(total, size), state = sizeState(total, size);
  if (!line) return null;
  return <p role={state === "fine" ? undefined : "alert"} className={cn("text-xs", state === "over" ? "text-destructive font-medium" : state === "near" ? "text-warning" : "text-muted-foreground")}>{line}</p>;
}

// Earlier versions of one part, newest first, with undo and restore.
function Versions({ target, kind, hash, onChanged }: { target: string; kind: Item["kind"]; hash?: string; onChanged: () => void }) {
  const history = useQuery({ queryKey: ["identity-history", target], queryFn: () => identity.history(target) });
  const [open, setOpen] = useState<string | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const run = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true); setError("");
    try { await work(); toast.success(done); onChanged(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  if (history.isLoading) return <p role="status" className="text-sm text-muted-foreground">Reading the earlier versions…</p>;
  if (history.error) return <p role="alert" className="text-sm text-destructive">{(history.error as Error).message}</p>;
  const list = history.data ?? [];
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">{list.length > 1 ? `${list.length} versions, newest first.` : "No earlier version yet. The next change keeps this one."}</p>
        <Button size="sm" variant="outline" className="min-h-11 sm:min-h-9" disabled={busy || list.length < 2} onClick={() => run(() => identity.undo(target, hash), "Undone. What you undid is kept as an earlier version too.")}>
          <Undo2 className="mr-1.5 h-4 w-4" aria-hidden="true" />Undo last change
        </Button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <ol className="space-y-2">
        {list.map((v: Version) => (
          <li key={v.id + v.at} className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-medium">{whenLabel(v.at)}{v.current && <Badge variant="secondary" className="ml-2 align-middle">Now</Badge>}</p>
                <p className="text-xs text-muted-foreground">{versionLine(v)}, {v.by}</p>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" className="min-h-11 sm:min-h-9" aria-expanded={open === v.id} onClick={() => setOpen(open === v.id ? null : v.id)}>{open === v.id ? "Hide" : "Show"}</Button>
                {!v.current && <Button size="sm" variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => run(() => identity.restore(target, v.id, hash), "Brought back. The version before is kept too.")}>Restore this version</Button>}
              </div>
            </div>
            {open === v.id && <VersionText kind={kind} version={v} />}
          </li>
        ))}
      </ol>
    </div>
  );
}
function VersionText({ kind, version }: { kind: Item["kind"]; version: Version }) {
  const box = "mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted/50 p-3 text-sm";
  if (version.removed) return <p className="mt-2 text-sm text-muted-foreground">{kind === "who" ? "There was no marked \"who it is\" paragraph then." : "It did not exist then."}</p>;
  if (kind === "who") return <p className={box}>{reflow(version.text)}</p>;
  const f = version.fields as any;
  if (kind === "rule") return <div className={box}><p className="font-medium">{f.title}</p><p>{f.line}</p><p className="mt-2 text-muted-foreground">{f.story}</p></div>;
  if (kind === "skill") return <div className={box}><p className="font-medium">{f.description}</p><p className="mt-2">{f.steps}</p></div>;
  return <div className={box}>{f.text}</div>;
}

// The editor of one part, with its earlier versions behind a second view.
function Editor({ target, overview, onClose }: { target: string; overview?: Overview; onClose: () => void }) {
  const invalidate = useInvalidate();
  const item = useQuery({ queryKey: ["identity-item", target], queryFn: () => identity.item(target) });
  const [view, setView] = useState<"edit" | "history">("edit");
  const [draft, setDraft] = useState<any>(null), [busy, setBusy] = useState(false), [error, setError] = useState(""), [confirmRemove, setConfirmRemove] = useState(false);
  useEffect(() => {
    if (!item.data) return;
    const d = item.data;
    // The paragraph as one flowing text: the file's fixed line width means nothing on a phone.
    setDraft(d.kind === "who" ? { text: reflow(d.text) } : { ...(d.fields as object) });
  }, [item.data]);
  const changed = () => { invalidate(target); item.refetch(); };
  const save = async () => {
    if (!item.data || !draft) return;
    // Unchanged words are no change, however the file wraps them.
    if (item.data.kind === "who" && draft.text.trim() === reflow(item.data.text).trim()) { toast.success("Nothing changed."); onClose(); return; }
    setBusy(true); setError("");
    try {
      const result = item.data.kind === "who" ? await identity.save(target, { text: draft.text }, item.data.hash) : await identity.save(target, item.data.kind === "profile" ? { text: draft.text } : { fields: draft }, item.data.hash);
      toast.success(result.unchanged ? "Nothing changed." : "Saved. The earlier version is kept.");
      if (result.manual?.warning) toast.warning(result.manual.warning);
      changed(); onClose();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setError("");
    try { await identity.removeRule(target, item.data?.hash); toast.success("Removed. You can bring it back from its earlier versions."); invalidate(target); onClose(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); setConfirmRemove(false); }
  };
  const d = item.data;
  const title = !d ? "Loading…" : d.kind === "who" ? "Who it is" : d.kind === "rule" ? (draft?.title || "Rule") : d.kind === "skill" ? "Recipe: " + (d.fields as SkillFields & { name?: string })?.name : (overview?.profile.find((p) => p.target === target)?.title ?? "Profile page");
  const before = d?.kind === "who" ? d.text ?? "" : d?.kind === "rule" ? (d.fields as RuleFields).always ? (d.fields as RuleFields).line : "" : "";
  const after = d?.kind === "who" ? draft?.text ?? "" : d?.kind === "rule" ? draft?.always ? draft?.line ?? "" : "" : "";
  const total = d && (d.kind === "who" || d.kind === "rule") ? manualAfter(d.manual ?? overview?.manual, before, after) : null;
  const tooLong = sizeState(total, d?.manual ?? overview?.manual) === "over" && (total ?? 0) > ((d?.manual ?? overview?.manual)?.chars ?? 0);
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{d ? <>Kept in <span className="font-mono text-xs">{d.file}</span> in your mission control.</> : " "}</DialogDescription>
        </DialogHeader>
        <div className="flex gap-2" role="tablist">
          <Button role="tab" aria-selected={view === "edit"} size="sm" variant={view === "edit" ? "secondary" : "ghost"} className="min-h-11 sm:min-h-9" onClick={() => setView("edit")}><Pencil className="mr-1.5 h-4 w-4" aria-hidden="true" />Edit</Button>
          <Button role="tab" aria-selected={view === "history"} size="sm" variant={view === "history" ? "secondary" : "ghost"} className="min-h-11 sm:min-h-9" onClick={() => setView("history")}><History className="mr-1.5 h-4 w-4" aria-hidden="true" />Earlier versions</Button>
        </div>
        {item.isLoading && <Skeleton className="h-40 w-full" />}
        {item.error && <p role="alert" className="text-sm text-destructive">{(item.error as Error).message}</p>}
        {d?.review_waiting && <p role="alert" className="rounded-md border border-warning/40 p-3 text-sm">Two versions of this wait for you in <Link className="underline" to="/dashboard/settings">Settings, under Review conflicting edits</Link>. Settle that first, then change it here.</p>}
        {d && draft && view === "edit" && (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            {d.kind === "who" && <>
              <Label htmlFor="who-text">Its name and character, in your words</Label>
              <Textarea id="who-text" rows={10} value={draft.text} onChange={(e) => setDraft({ text: e.target.value })} className="text-base sm:text-sm" />
              <p className="text-xs text-muted-foreground">Your assistant reads this paragraph first, every time, in every chat and every routine. Only this paragraph of your manual changes.</p>
            </>}
            {d.kind === "rule" && <RuleForm draft={draft as RuleFields} setDraft={setDraft} />}
            {d.kind === "skill" && <>
              <p className="text-xs text-muted-foreground">{ORIGIN_WORDS[d.origin ?? "own"]}</p>
              <Label htmlFor="skill-description">What it is for</Label>
              <Textarea id="skill-description" rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className="text-base sm:text-sm" />
              <p className="text-xs text-muted-foreground">Your assistant picks a recipe by this sentence.</p>
              <Label htmlFor="skill-steps">The steps</Label>
              <Textarea id="skill-steps" rows={16} value={draft.steps} onChange={(e) => setDraft({ ...draft, steps: e.target.value })} className="font-mono text-sm" />
            </>}
            {d.kind === "profile" && <>
              <Label htmlFor="page-text">What it knows</Label>
              <Textarea id="page-text" rows={16} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} className="text-base sm:text-sm" />
              {(d.fields as PageFields).kept_details && <p className="text-xs text-muted-foreground">The few lines at the very top of this file, which your assistant uses to find it, stay as they are.</p>}
            </>}
            <SizeNote total={total} size={d.manual ?? overview?.manual} />
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <div>{d.kind === "rule" && <Button type="button" variant="ghost" className="min-h-11 text-destructive sm:min-h-9" onClick={() => setConfirmRemove(true)}><Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />Remove this rule</Button>}</div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button type="button" variant="ghost" className="min-h-11 sm:min-h-9" onClick={onClose}>Cancel</Button>
                <Button type="submit" className="min-h-11 sm:min-h-9" disabled={busy || d.review_waiting || tooLong}>{busy ? "Saving…" : "Save"}</Button>
              </div>
            </div>
          </form>
        )}
        {d && view === "history" && <Versions target={target} kind={d.kind} hash={d.hash} onChanged={changed} />}
        <AlertDialog open={confirmRemove} onOpenChange={setConfirmRemove}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove this rule?</AlertDialogTitle>
              <AlertDialogDescription>Your assistant stops following it. It stays among its earlier versions, so you can bring it back.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction onClick={() => void remove()} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Remove</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
}

function RuleForm({ draft, setDraft }: { draft: RuleFields; setDraft: (d: RuleFields) => void }) {
  return <>
    <div className="space-y-1.5"><Label htmlFor="rule-title">Its name</Label><Input id="rule-title" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="min-h-11 text-base sm:text-sm" /></div>
    <div className="space-y-1.5"><Label htmlFor="rule-line">The rule in one sentence</Label><Textarea id="rule-line" rows={2} value={draft.line} onChange={(e) => setDraft({ ...draft, line: e.target.value.replace(/\n/g, " ") })} className="text-base sm:text-sm" />
      <p className="text-xs text-muted-foreground">This sentence goes on the list your assistant reads before every job, after {draft.group === "must" ? "\"I must:\"" : draft.group === "never" ? "\"I must never:\"" : "\"How things work here:\""}.</p></div>
    <div className="space-y-1.5"><Label htmlFor="rule-group">Kind of rule</Label>
      <select id="rule-group" className={selectClass} value={draft.group} onChange={(e) => setDraft({ ...draft, group: e.target.value as RuleGroup })}>
        {GROUPS.map((g) => <option key={g.value} value={g.value}>{g.short}</option>)}
      </select></div>
    <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
      <Label htmlFor="rule-always" className="leading-snug">Read before every job<span className="block text-xs font-normal text-muted-foreground">Off: kept for when its subject comes up.</span></Label>
      <Switch id="rule-always" checked={draft.always} onCheckedChange={(always) => setDraft({ ...draft, always })} />
    </div>
    <div className="space-y-1.5"><Label htmlFor="rule-story">The whole story: why you gave it, and its exceptions</Label><Textarea id="rule-story" rows={10} value={draft.story} onChange={(e) => setDraft({ ...draft, story: e.target.value })} className="text-base sm:text-sm" /></div>
  </>;
}

function NewRule({ overview, onClose }: { overview?: Overview; onClose: () => void }) {
  const invalidate = useInvalidate();
  const [draft, setDraft] = useState<RuleFields>({ title: "", line: "", group: "must", always: true, story: "" }), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const total = manualAfter(overview?.manual, "", draft.always && draft.line ? ruleListLine(draft.line, draft.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")) : "");
  const add = async () => {
    setBusy(true); setError("");
    try { const r = await identity.addRule(draft); toast.success("Added. Your assistant reads it before every job from now on."); if (r.manual?.warning) toast.warning(r.manual.warning); invalidate(r.target); onClose(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader><DialogTitle>A new rule</DialogTitle><DialogDescription>A line your assistant does not cross, or something it always does.</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <RuleForm draft={draft} setDraft={setDraft} />
          <SizeNote total={total} size={overview?.manual} />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" className="min-h-11 sm:min-h-9" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="min-h-11 sm:min-h-9" disabled={busy || !draft.line.trim() || sizeState(total, overview?.manual) === "over"}>{busy ? "Adding…" : "Add the rule"}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// Instructions for the AI apps connected to the notebook: records they receive with the profile.
function Instructions() {
  const invalidate = useInvalidate();
  const list = useQuery({ queryKey: ["identity-instructions"], queryFn: identity.instructions });
  const [editing, setEditing] = useState<Partial<Instruction> | null>(null), [historyOf, setHistoryOf] = useState<Instruction | null>(null), [removedOpen, setRemovedOpen] = useState(false), [error, setError] = useState("");
  const live = (list.data ?? []).filter((i) => !i.removed), removed = (list.data ?? []).filter((i) => i.removed);
  const save = async (change: Partial<Instruction> & { removed?: boolean }, hash?: string, done = "Saved. The earlier version is kept.") => {
    setError("");
    try { await identity.saveInstruction(change, hash); toast.success(done); invalidate(); setEditing(null); }
    catch (e) { setError((e as Error).message); }
  };
  return (
    <div id="instructions" className="scroll-mt-20 space-y-3 rounded-lg border border-border p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div><h3 className="text-base font-semibold">Instructions for AI apps you connect</h3>
          <p className="text-sm text-muted-foreground">Apps you connect to your notebook (Settings, Connect AI) receive these with your profile. Your mission control's own assistant follows the rules above.</p></div>
        <Button size="sm" variant="outline" className="min-h-11 shrink-0 sm:min-h-9" onClick={() => setEditing({ instruction: "", applies_to: "all" })}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Add an instruction</Button>
      </div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {editing && !editing.id && <InstructionForm value={editing} onCancel={() => setEditing(null)} onSave={(v) => save(v, undefined, "Added.")} />}
      {list.isLoading && <Skeleton className="h-16 w-full" />}
      {!list.isLoading && live.length === 0 && !editing && <p className="text-sm text-muted-foreground">None yet. For example: "Always address me as Sam".</p>}
      <ul className="space-y-2">
        {live.map((inst) => editing?.id === inst.id ? <li key={inst.id}><InstructionForm value={editing} onCancel={() => setEditing(null)} onSave={(v) => save({ id: inst.id, instruction: v.instruction, applies_to: v.applies_to }, inst.hash)} /></li> : (
          <li key={inst.id} className="flex flex-col gap-3 rounded-md border border-border p-3 sm:flex-row sm:items-start">
            <Switch checked={inst.is_active} aria-label={inst.is_active ? "In use; switch off to pause" : "Paused; switch on to use"} onCheckedChange={(on) => save({ id: inst.id, is_active: on }, inst.hash, on ? "Switched on." : "Paused.")} />
            <div className="min-w-0 flex-1"><p className={cn("text-sm", !inst.is_active && "text-muted-foreground line-through")}>{inst.instruction}</p><ScopeBadge scope={inst.applies_to} className="mt-1.5" /></div>
            <div className="flex flex-wrap gap-1">
              <Button size="sm" variant="ghost" className="min-h-11 sm:min-h-9" onClick={() => setEditing(inst)}>Edit</Button>
              <Button size="sm" variant="ghost" className="min-h-11 sm:min-h-9" onClick={() => setHistoryOf(inst)}>Earlier versions</Button>
              <Button size="sm" variant="ghost" className="min-h-11 text-destructive sm:min-h-9" onClick={() => save({ id: inst.id, removed: true }, inst.hash, "Removed. You can bring it back below.")}>Remove</Button>
            </div>
          </li>
        ))}
      </ul>
      {removed.length > 0 && (
        <Collapsible open={removedOpen} onOpenChange={setRemovedOpen}>
          <CollapsibleTrigger asChild><button type="button" className="flex min-h-11 items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">Removed ({removed.length})<ChevronDown className={cn("h-4 w-4 transition-transform", removedOpen && "rotate-180")} aria-hidden="true" /></button></CollapsibleTrigger>
          <CollapsibleContent><ul className="space-y-2">{removed.map((inst) => (
            <li key={inst.id} className="flex flex-col gap-2 rounded-md border border-dashed border-border p-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">{inst.instruction}</p>
              <Button size="sm" variant="outline" className="min-h-11 sm:min-h-9" onClick={() => save({ id: inst.id, removed: false }, inst.hash, "Brought back.")}>Bring back</Button>
            </li>))}</ul></CollapsibleContent>
        </Collapsible>
      )}
      {historyOf && <InstructionHistory inst={historyOf} onClose={() => setHistoryOf(null)} onChanged={() => invalidate()} />}
    </div>
  );
}
function InstructionForm({ value, onSave, onCancel }: { value: Partial<Instruction>; onSave: (v: { instruction: string; applies_to: string }) => void; onCancel: () => void }) {
  const [text, setText] = useState(value.instruction ?? ""), [scope, setScope] = useState(value.applies_to ?? "all");
  return (
    <form className="space-y-3 rounded-md border border-border bg-muted/30 p-3" onSubmit={(e) => { e.preventDefault(); if (text.trim()) onSave({ instruction: text.trim(), applies_to: scope }); }}>
      <Label htmlFor={"instruction-" + (value.id ?? "new")}>Instruction</Label>
      <Textarea id={"instruction-" + (value.id ?? "new")} rows={2} value={text} onChange={(e) => setText(e.target.value)} autoFocus className="text-base sm:text-sm" />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <label className="sr-only" htmlFor={"scope-" + (value.id ?? "new")}>Which apps</label>
        <select id={"scope-" + (value.id ?? "new")} className={cn(selectClass, "sm:w-56")} value={scope} onChange={(e) => setScope(e.target.value)}>{SCOPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        <div className="flex-1" />
        <Button type="button" variant="ghost" className="min-h-11 sm:min-h-9" onClick={onCancel}>Cancel</Button>
        <Button type="submit" className="min-h-11 sm:min-h-9" disabled={!text.trim()}>Save</Button>
      </div>
    </form>
  );
}
function InstructionHistory({ inst, onClose, onChanged }: { inst: Instruction; onClose: () => void; onChanged: () => void }) {
  const history = useQuery({ queryKey: ["identity-instruction-history", inst.id], queryFn: () => identity.instructionHistory(inst.id) });
  const [error, setError] = useState("");
  const restore = async (v: InstructionVersion) => {
    try { await identity.restoreInstruction(inst.id, v.id); toast.success("Brought back. The version before is kept too."); onChanged(); history.refetch(); }
    catch (e) { setError((e as Error).message); }
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[92dvh] max-w-xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader><DialogTitle>Earlier versions</DialogTitle><DialogDescription>{inst.instruction}</DialogDescription></DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <ol className="space-y-2">{(history.data ?? []).map((v) => (
          <li key={v.id} className="rounded-md border border-border p-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0"><p className="text-sm font-medium">{whenLabel(v.at)}{v.current && <Badge variant="secondary" className="ml-2">Now</Badge>}</p>
                <p className="text-sm">{v.removed ? "Removed" : v.instruction}{!v.removed && !v.is_active && " (paused)"}</p></div>
              {!v.current && <Button size="sm" variant="outline" className="min-h-11 sm:min-h-9" onClick={() => void restore(v)}>Restore this version</Button>}
            </div>
          </li>))}</ol>
      </DialogContent>
    </Dialog>
  );
}

export default function Identity() {
  const location = useLocation();
  const invalidate = useInvalidate();
  const overview = useQuery({ queryKey: ["identity"], queryFn: identity.overview });
  const [open, setOpen] = useState<string | null>(null), [adding, setAdding] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => { if (location.hash && overview.data) document.getElementById(location.hash.slice(1))?.scrollIntoView(); }, [location.hash, overview.data]);
  const o = overview.data;
  const grouped = useMemo(() => GROUPS.map((g) => ({ ...g, rules: (o?.rules ?? []).filter((r) => r.group === g.value) })).filter((g) => g.rules.length), [o]);
  const act = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await work(); toast.success(done); invalidate(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      <SEOHead title="Identity - Godspeed Mission Control" description="Who your mission control is, what it may and may not do, what it knows about you and how it does its jobs." noIndex />
      <div className="mx-auto max-w-5xl space-y-8 p-4 sm:p-6">
        <header className="flex items-start gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary" aria-hidden="true"><Fingerprint className="h-6 w-6" /></div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold font-display">Identity</h1>
            <p className="mt-1 text-sm text-muted-foreground">What makes your mission control behave the way it does. Change anything here, or ask in <Link to="/dashboard/chat" className="underline underline-offset-2">chat</Link>, for example "Call yourself Speedy from now on". Every change keeps the earlier version, so you can always go back.</p>
          </div>
        </header>
        {overview.isLoading && <div className="space-y-4"><Skeleton className="h-28 w-full" /><Skeleton className="h-40 w-full" /></div>}
        {overview.error && <p role="alert" className="text-sm text-destructive">{(overview.error as Error).message}</p>}
        {o && <>
          <Section id="who" icon={<UserRound className="h-5 w-5" />} title="Who it is" explain="Its name and character. Your assistant reads this first, every time."
            action={o.who.state === "ok" ? <Button size="sm" className="min-h-11 sm:min-h-9" onClick={() => setOpen("who")}><Pencil className="mr-1.5 h-4 w-4" aria-hidden="true" />Edit</Button> : undefined}>
            {o.who.state === "ok" && <Card><CardContent className="space-y-3 pt-6">
              <p className="whitespace-pre-line text-sm leading-relaxed">{reflow(o.who.text)}</p>
              <SizeNote total={o.manual.chars} size={o.manual} />
              {o.soul.kind === "own" && <div className="rounded-md border border-warning/40 p-3 text-sm">
                <p>Your assistant's program also has an identity of its own, which you or someone else wrote. It is left as it is, and it may say something else:</p>
                {o.soul.text && <p className="mt-2 line-clamp-4 whitespace-pre-wrap text-muted-foreground">{o.soul.text}</p>}
                <Button size="sm" variant="outline" className="mt-2 min-h-11 sm:min-h-9" disabled={busy} onClick={() => act(identity.useWhoForAssistant, "Your assistant's program now uses \"who it is\" too. Its own text is kept in a copy.")}>Use "who it is" there too</Button>
              </div>}
            </CardContent></Card>}
            {o.who.state === "no-markers" && <Card><CardContent className="space-y-3 pt-6">
              <p className="text-sm">Your manual does not mark which paragraph says who your assistant is, so it cannot be changed here yet. This paragraph would become it:</p>
              <p className="whitespace-pre-wrap rounded bg-muted/50 p-3 text-sm">{o.who.proposal}</p>
              <Button size="sm" className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => act(identity.markWho, "Marked. You can change it now, and undo the marking from its earlier versions.")}>Mark it</Button>
            </CardContent></Card>}
            {o.who.state === "no-manual" && <p className="text-sm text-muted-foreground">Your mission control has no manual (AGENTS.md) yet.</p>}
          </Section>

          <Section id="rules" icon={<ShieldCheck className="h-5 w-5" />} title="What it may and may not do" explain="Your rules. The one sentence of each goes on the list your assistant reads before every job."
            action={<Button size="sm" className="min-h-11 sm:min-h-9" onClick={() => setAdding(true)}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Add a rule</Button>}>
            {o.manual.rules_list === "out-of-step" && <div role="alert" className="flex flex-col gap-2 rounded-md border border-warning/40 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
              <p>The list in your manual is behind your rules: something changed a rule without updating it.</p>
              <Button size="sm" variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => act(identity.gatherRules, "The list is up to date.")}>Bring the list up to date</Button></div>}
            {o.manual.rules_list === "no-place" && <p className="rounded-md border border-warning/40 p-3 text-sm">Your manual has no place for the list of rules, so your assistant reads them only when it opens the files.</p>}
            {grouped.map((g) => <div key={g.value} className="space-y-2">
              <h3 className="text-sm font-semibold text-muted-foreground">{g.title}</h3>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {g.rules.map((r) => <ItemCard key={r.target} title={r.title} text={r.line} note={r.always ? undefined : "Read when its subject comes up"} waiting={r.review_waiting} onOpen={() => setOpen(r.target)} />)}
              </div></div>)}
            {!o.rules.length && <p className="text-sm text-muted-foreground">No rules yet.</p>}
            <Instructions />
          </Section>

          <Section id="profile" icon={<BookUser className="h-5 w-5" />} title="What it knows about you" explain="Your pages about yourself, your work and your voice. Your people and facts are in the notebook itself.">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {o.profile.map((p) => <ItemCard key={p.target} title={p.title} text={p.preview} waiting={p.review_waiting} onOpen={() => setOpen(p.target)} />)}
            </div>
            {!o.profile.length && <p className="text-sm text-muted-foreground">No pages yet.</p>}
          </Section>

          <Section id="skills" icon={<ChefHat className="h-5 w-5" />} title="How it does its jobs" explain="Its recipes: one job you never want to explain again, each.">
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {o.skills.map((k) => <ItemCard key={k.target} title={k.name} text={k.description} note={k.origin === "shipped" ? "Kept up to date by updates" : k.origin === "changed" ? "Changed by you" : "Your own"} waiting={k.review_waiting} onOpen={() => setOpen(k.target)} />)}
            </div>
            {!o.skills.length && <p className="text-sm text-muted-foreground">No recipes yet.</p>}
          </Section>
          <p className="flex items-start gap-2 text-xs text-muted-foreground"><MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />When you ask in chat, your assistant changes these the same way, and its change appears among the earlier versions, ready to undo.</p>
        </>}
      </div>
      {open && <Editor target={open} overview={o} onClose={() => setOpen(null)} />}
      {adding && <NewRule overview={o} onClose={() => setAdding(false)} />}
    </>
  );
}
