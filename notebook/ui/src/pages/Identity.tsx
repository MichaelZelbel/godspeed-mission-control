import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BookUser, ChevronDown, History, ListChecks, MessageSquare, NotebookPen, Pencil, Plus, ShieldCheck, Trash2, Undo2, UserRound, Wrench } from "lucide-react";
import { SEOHead } from "@/components/SEOHead";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { GlobalAIChatFAB } from "@/components/chat/GlobalAIChatFAB";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { BRAIN_PAGE } from "@/lib/brain-page";
import {
  GROUPS, NAME_LIMIT, ORIGIN_NOTE, ORIGIN_WORDS, PAGE_CHAT, PAGE_CHAT_CHANGED, TOGGLE_PAGE_CHAT, chars, identity, kindTag, manualAfter, paragraphs, places, reflow, ruleListLine, sizeLine, sizeState, versionWords, whenLabel,
  type Instruction, type InstructionVersion, type Item, type ManualSize, type NotebookTotals, type Overview, type PageFields, type RuleFields, type RuleGroup, type SkillFields, type SoulSize, type Version,
} from "@/lib/identity";

// GODSPEED'S BRAIN (lib/brain-page.ts; notebook/ui/DESIGN.md, "Godspeed's brain"): the files that
// make this mission control behave as it does, each changed here or by asking in the chat docked
// beside the page. Every change keeps the earlier version, and any version can be brought back as
// a new change. Rules, profile pages and skills carry the numbers the chat is told, so "change
// rule 13" means the tile that shows 13.
const selectClass = "block w-full min-h-11 rounded-md border border-input bg-background px-3 text-base sm:text-sm";
const CHAT = { page: PAGE_CHAT, label: BRAIN_PAGE.label, toggleEvent: TOGGLE_PAGE_CHAT, changedEvent: PAGE_CHAT_CHANGED };

function useInvalidate() {
  const qc = useQueryClient();
  return (target?: string) => {
    qc.invalidateQueries({ queryKey: ["identity"] });
    qc.invalidateQueries({ queryKey: ["identity-instructions"] });
    if (target) { qc.invalidateQueries({ queryKey: ["identity-item", target] }); qc.invalidateQueries({ queryKey: ["identity-history", target] }); }
  };
}

function Section({ id, icon, title, explain, action, children }: { id: string; icon: ReactNode; title: string; explain: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={id + "-heading"} className="scroll-mt-16 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary" aria-hidden="true">{icon}</div>
          <div className="min-w-0">
            <h2 id={id + "-heading"} className="text-xl font-bold font-display">{title}</h2>
            <p className="mt-0.5 max-w-[65ch] text-sm text-muted-foreground">{explain}</p>
          </div>
        </div>
        {action && <div className="flex shrink-0 flex-wrap gap-2 sm:pt-1">{action}</div>}
      </div>
      {children}
    </section>
  );
}

// One numbered tile: the number big, the short name as its headline, never cut off; the sentence
// below it smaller and muted.
function Tile({ n, name, text, tag, note, waiting, onOpen }: { n: number; name: string; text?: string; tag?: string; note?: string; waiting?: boolean; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="block h-full w-full rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
      <Card className="h-full cursor-pointer transition-colors hover:bg-accent/50">
        <CardContent className="flex h-full gap-3 p-4">
          <span className="min-w-[2ch] shrink-0 text-right font-display text-3xl font-extrabold leading-none tabular-nums text-primary">{n}</span>
          <span className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="break-words font-display text-lg font-bold leading-snug text-foreground">{name}</span>
            {tag && <Badge variant="outline" className="w-fit whitespace-nowrap px-1.5 py-0 text-[11px] font-medium text-muted-foreground">{tag}</Badge>}
            {text && <span className="line-clamp-3 text-sm leading-relaxed text-muted-foreground">{text}</span>}
            {note && <span className="text-xs text-muted-foreground">{note}</span>}
            {waiting && <Badge variant="outline" className="w-fit border-warning/40 text-warning">Two versions wait for you in Settings</Badge>}
          </span>
        </CardContent>
      </Card>
    </button>
  );
}
// As many columns as the page's own width holds, so the tiles stay readable beside the open chat.
const grid = "grid grid-cols-[repeat(auto-fill,minmax(min(100%,17rem),1fr))] gap-3";

// A text the owner wrote, in a column that reads well: one paragraph per blank line.
function Paragraphs({ text, className }: { text?: string | null; className?: string }) {
  return <div className={cn("max-w-[65ch] space-y-4 text-base leading-7", className)}>{paragraphs(text).map((p, i) => <p key={i}>{p}</p>)}</div>;
}

// Shown only when a change gets near or over what the file may hold.
function SizeNote({ total, size, what }: { total: number | null; size?: ManualSize | SoulSize; what?: "manual" | "soul" }) {
  const line = sizeLine(total, size, what), state = sizeState(total, size);
  if (!line) return null;
  return <p role="alert" className={cn("text-sm", state === "over" ? "text-destructive font-medium" : "text-warning")}>{line}</p>;
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
                <p className="text-xs text-muted-foreground">{versionWords(v)}</p>
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
  if (version.removed) return <p className="mt-2 text-sm text-muted-foreground">{kind === "who" ? "There was no marked \"who it is\" paragraph then." : kind === "extra" ? "There were no extra instructions then." : "It did not exist then."}</p>;
  if (kind === "who" || kind === "extra") return <p className={box}>{reflow(version.text)}</p>;
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
    setDraft(d.kind === "who" || d.kind === "extra" ? { text: reflow(d.text) } : { ...(d.fields as object) });
  }, [item.data]);
  const changed = () => { invalidate(target); item.refetch(); };
  const d = item.data;
  const save = async () => {
    if (!d || !draft) return;
    // Unchanged words are no change, however the file wraps them.
    if ((d.kind === "who" || d.kind === "extra") && draft.text.trim() === reflow(d.text).trim()) { toast.success("Nothing changed."); onClose(); return; }
    setBusy(true); setError("");
    try {
      const result = d.kind === "who" || d.kind === "extra" ? await identity.save(target, { text: draft.text }, d.hash) : await identity.save(target, d.kind === "profile" ? { text: draft.text } : { fields: draft }, d.hash);
      toast.success(result.unchanged ? "Nothing changed." : "Saved. The earlier version is kept.");
      if (result.manual?.warning) toast.warning(result.manual.warning);
      changed(); onClose();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    setBusy(true); setError("");
    try { await identity.removeRule(target, d?.hash); toast.success("Removed. You can bring it back from its earlier versions."); invalidate(target); onClose(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); setConfirmRemove(false); }
  };
  const tile = overview?.rules.find((r) => r.target === target), page = overview?.profile.find((p) => p.target === target), skill = overview?.skills.find((k) => k.target === target);
  const title = !d ? "Loading…" : d.kind === "who" ? "Who it is" : d.kind === "extra" ? "Extra instructions" : d.kind === "rule" ? (tile?.title || (d.fields as RuleFields).title) : d.kind === "skill" ? "Skill: " + (skill?.title ?? (d.fields as SkillFields).name) : (page?.title ?? "Profile page");
  const numbered = tile ? "Rule " + tile.n + ". " : page ? "Profile page " + page.n + ". " : skill ? "Skill " + skill.n + ". " : "";
  // What a change does to AGENTS.md and to what the assistant's program reads first.
  const manualSize = d?.manual ?? overview?.manual, soulSize = d?.soul ?? overview?.soul;
  const ruleBefore = d?.kind === "rule" && (d.fields as RuleFields).always ? (d.fields as RuleFields).line : "", ruleAfter = d?.kind === "rule" && draft?.always ? draft?.line ?? "" : "";
  const manualTotal = !d || !draft ? null : d.kind === "who" ? manualAfter(manualSize, d.text ?? "", draft.text ?? "") : d.kind === "rule" ? manualAfter(manualSize, ruleBefore, ruleAfter) : null;
  const soulTotal = !d || !draft || !soulSize ? null : d.kind === "who" || d.kind === "extra" ? manualAfter(soulSize, d.text ?? "", draft.text ?? "") : null;
  const grows = (total: number | null, size?: { chars: number }) => total !== null && !!size && total > size.chars;
  const tooLong = (sizeState(manualTotal, manualSize) === "over" && grows(manualTotal, manualSize)) || (sizeState(soulTotal, soulSize) === "over" && grows(soulTotal, soulSize));
  const nameProblem = d?.kind === "rule" && draft && draft.title !== (d.fields as RuleFields).title ? (!draft.title.trim() ? "Give the rule a name." : chars(draft.title.trim()) > NAME_LIMIT ? `Keep the name to a few words, at most ${NAME_LIMIT} characters.` : "") : "";
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="pr-6 text-xl leading-snug">{title}</DialogTitle>
          <DialogDescription>{d ? <>{numbered}Kept in <span className="font-mono text-xs">{d.file}</span> in your mission control.</> : " "}</DialogDescription>
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
            {d.kind === "who" && <div className="space-y-1.5">
              <Label htmlFor="who-text">Its name and character, in your words</Label>
              <Textarea id="who-text" rows={12} value={draft.text} onChange={(e) => setDraft({ text: e.target.value })} className="text-base leading-7" />
              <p className="text-xs text-muted-foreground">Your assistant reads this first, every time, in every chat and every routine. A blank line starts a new paragraph.</p>
            </div>}
            {d.kind === "extra" && <div className="space-y-1.5">
              <Label htmlFor="extra-text">Extra instructions</Label>
              <Textarea id="extra-text" rows={14} value={draft.text} onChange={(e) => setDraft({ text: e.target.value })} className="text-base leading-7" />
              <p className="text-xs text-muted-foreground">Your assistant reads these right after "Who it is": in Telegram, in this notebook's chat and in its routines. A blank line starts a new paragraph. Leave it empty for none.</p>
            </div>}
            {d.kind === "rule" && <RuleForm draft={draft as RuleFields} setDraft={setDraft} nameProblem={nameProblem} />}
            {d.kind === "skill" && <>
              <p className="text-xs text-muted-foreground">{ORIGIN_WORDS[d.origin ?? "own"]}</p>
              <div className="space-y-1.5"><Label htmlFor="skill-description">What it is for</Label>
                <Textarea id="skill-description" rows={3} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} className="text-base sm:text-sm" />
                <p className="text-xs text-muted-foreground">Your assistant picks a skill by this sentence.</p></div>
              <div className="space-y-1.5"><Label htmlFor="skill-steps">The steps</Label>
                <Textarea id="skill-steps" rows={16} value={draft.steps} onChange={(e) => setDraft({ ...draft, steps: e.target.value })} className="font-mono text-sm" /></div>
            </>}
            {d.kind === "profile" && <div className="space-y-1.5">
              <Label htmlFor="page-text">What it knows</Label>
              <Textarea id="page-text" rows={16} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} className="text-base sm:text-sm" />
              {(d.fields as PageFields).kept_details && <p className="text-xs text-muted-foreground">The few lines at the very top of this file, which your assistant uses to find it, stay as they are.</p>}
            </div>}
            <SizeNote total={manualTotal} size={manualSize} />
            {!sizeLine(manualTotal, manualSize) && <SizeNote total={soulTotal} size={soulSize} what="soul" />}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
              <div>{d.kind === "rule" && <Button type="button" variant="ghost" className="min-h-11 text-destructive sm:min-h-9" onClick={() => setConfirmRemove(true)}><Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />Remove this rule</Button>}</div>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button type="button" variant="ghost" className="min-h-11 sm:min-h-9" onClick={onClose}>Cancel</Button>
                <Button type="submit" className="min-h-11 sm:min-h-9" disabled={busy || d.review_waiting || tooLong || !!nameProblem}>{busy ? "Saving…" : "Save"}</Button>
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

function RuleForm({ draft, setDraft, nameProblem }: { draft: RuleFields; setDraft: (d: RuleFields) => void; nameProblem?: string }) {
  return <>
    <div className="space-y-1.5"><Label htmlFor="rule-title">Its name</Label>
      <Input id="rule-title" value={draft.title} placeholder="A few words, so you can find it" aria-describedby="rule-title-help" onChange={(e) => setDraft({ ...draft, title: e.target.value })} className="min-h-11 text-base sm:text-sm" />
      <p id="rule-title-help" className={cn("text-xs", nameProblem ? "text-destructive" : "text-muted-foreground")}>{nameProblem || "A few words, so you can find it."}</p></div>
    <div className="space-y-1.5"><Label htmlFor="rule-line">The rule in one sentence</Label><Textarea id="rule-line" rows={3} value={draft.line} onChange={(e) => setDraft({ ...draft, line: e.target.value.replace(/\n/g, " ") })} className="text-base sm:text-sm" />
      <p className="text-xs text-muted-foreground">{draft.always ? "Your assistant reads this sentence before every job." : "Your assistant reads this sentence when the rule's subject comes up."}</p></div>
    <div className="space-y-1.5"><Label htmlFor="rule-group">Kind of rule</Label>
      <select id="rule-group" className={selectClass} value={draft.group} onChange={(e) => setDraft({ ...draft, group: e.target.value as RuleGroup })}>
        {GROUPS.map((g) => <option key={g.value} value={g.value}>{g.short}</option>)}
      </select></div>
    <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3">
      <Label htmlFor="rule-always" className="leading-snug">Read before every job<span className="block text-xs font-normal text-muted-foreground">Off: read only when its subject comes up.</span></Label>
      <Switch id="rule-always" checked={draft.always} onCheckedChange={(always) => setDraft({ ...draft, always })} />
    </div>
    <div className="space-y-1.5"><Label htmlFor="rule-story">The whole story: why you gave it, and its exceptions</Label><Textarea id="rule-story" rows={10} value={draft.story} onChange={(e) => setDraft({ ...draft, story: e.target.value })} className="text-base sm:text-sm" /></div>
  </>;
}

function NewRule({ overview, onClose }: { overview?: Overview; onClose: () => void }) {
  const invalidate = useInvalidate();
  const [draft, setDraft] = useState<RuleFields>({ title: "", line: "", group: "must", always: true, story: "" }), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const total = manualAfter(overview?.manual, "", draft.always && draft.line ? ruleListLine(draft.line, draft.title.toLowerCase().replace(/[^a-z0-9]+/g, "-")) : "");
  const nameProblem = chars(draft.title.trim()) > NAME_LIMIT ? `Keep the name to a few words, at most ${NAME_LIMIT} characters.` : "";
  const add = async () => {
    setBusy(true); setError("");
    try { const r = await identity.addRule(draft); toast.success(draft.always ? "Added. Your assistant reads it before every job from now on." : "Added. Your assistant reads it when its subject comes up."); if (r.manual?.warning) toast.warning(r.manual.warning); invalidate(r.target); onClose(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto p-4 sm:p-6">
        <DialogHeader><DialogTitle>A new rule</DialogTitle><DialogDescription>A line your assistant does not cross, or something it always does.</DialogDescription></DialogHeader>
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void add(); }}>
          <RuleForm draft={draft} setDraft={setDraft} nameProblem={nameProblem} />
          <SizeNote total={total} size={overview?.manual} />
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" className="min-h-11 sm:min-h-9" onClick={onClose}>Cancel</Button>
            <Button type="submit" className="min-h-11 sm:min-h-9" disabled={busy || !draft.line.trim() || !!nameProblem || sizeState(total, overview?.manual) === "over"}>{busy ? "Adding…" : "Add the rule"}</Button>
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
    <div id="instructions" className="scroll-mt-16 space-y-3 rounded-lg border border-border p-4">
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

// What else the assistant can look up: everything in the notebook, counted as its tools see it.
const LOOKUPS: { key: keyof NotebookTotals; label: string; to: string; hint?: string }[] = [
  { key: "notes", label: "Notes", to: "/dashboard/notes" },
  { key: "people", label: "People", to: "/dashboard/people" },
  { key: "facts", label: "Facts", to: "/dashboard/profile", hint: "about you, your people and your world" },
  { key: "events", label: "Timeline events", to: "/dashboard/timeline" },
  { key: "things", label: "Places and things", to: "/dashboard/world" },
  { key: "collections", label: "Collections", to: "/collections" },
];
function InYourNotebook() {
  const totals = useQuery({ queryKey: ["identity-notebook"], queryFn: identity.notebook });
  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div><h3 className="text-base font-semibold">And everything in your notebook</h3>
        <p className="max-w-[65ch] text-sm text-muted-foreground">Your assistant searches these when a question needs them. It does not read them all every time.</p></div>
      {totals.error && <p className="text-sm text-muted-foreground">The notebook's totals did not load. Its notes, people and facts are still there.</p>}
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {LOOKUPS.map((l) => (
          <li key={l.key}>
            <Link to={l.to} className="flex min-h-11 flex-col rounded-md border border-border px-3 py-2 transition-colors hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <span className="font-display text-2xl font-bold tabular-nums">{totals.data ? totals.data[l.key].toLocaleString("en") : "…"}</span>
              <span className="text-sm font-medium">{l.label}</span>
              {l.hint && <span className="text-xs text-muted-foreground">{l.hint}</span>}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

// The text the assistant's program read first that its owner wrote (SOUL.md, kind "own").
function OwnSoul({ soul, busy, onBring }: { soul: Overview["soul"]; busy: boolean; onBring: () => void }) {
  const [show, setShow] = useState(false);
  return (
    <div className="space-y-2 rounded-md border border-border bg-muted/40 p-3 text-sm">
      <p>Hermes, the program your assistant runs on, also reads a text this page does not hold yet.</p>
      {soul.linked && <p className="text-muted-foreground">That text is a link to a file somewhere else, so it cannot be shown or brought here.</p>}
      {!soul.linked && <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="min-h-11 sm:min-h-9" onClick={() => setShow(true)}>Show it</Button>
        <Button size="sm" className="min-h-11 sm:min-h-9" disabled={busy} onClick={onBring}>Bring it here</Button>
      </div>}
      {show && <Dialog open onOpenChange={(open) => { if (!open) setShow(false); }}>
        <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto p-4 sm:p-6">
          <DialogHeader><DialogTitle>The text Hermes also reads</DialogTitle><DialogDescription>"Bring it here" moves it into your extra instructions, where you can change it and go back to any earlier version. The file it comes from is kept as a copy.</DialogDescription></DialogHeader>
          <div className="max-w-[65ch] whitespace-pre-wrap rounded bg-muted/50 p-4 text-base leading-7">{soul.text}</div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" className="min-h-11 sm:min-h-9" onClick={() => setShow(false)}>Close</Button>
            <Button type="button" className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => { setShow(false); onBring(); }}>Bring it here</Button>
          </div>
        </DialogContent>
      </Dialog>}
    </div>
  );
}

const PARTS = [["who", "Who it is"], ["extra", "Extra instructions"], ["rules", "Rules"], ["profile", "What it knows"], ["skills", "Skills"]] as const;

export default function Identity() {
  const location = useLocation();
  const invalidate = useInvalidate();
  const isMobile = useIsMobile();
  const overview = useQuery({ queryKey: ["identity"], queryFn: identity.overview });
  const [open, setOpen] = useState<string | null>(null), [adding, setAdding] = useState(false), [busy, setBusy] = useState(false), [chatOpen, setChatOpen] = useState(false), [restOpen, setRestOpen] = useState(false);
  useEffect(() => { if (location.hash && overview.data) document.getElementById(location.hash.slice(1))?.scrollIntoView(); }, [location.hash, overview.data]);
  // The assistant changed something here from the chat beside the page: show it.
  useEffect(() => {
    const shown = () => { invalidate(); toast.success("Your assistant changed this page. The earlier version is kept."); };
    window.addEventListener(PAGE_CHAT_CHANGED, shown);
    return () => window.removeEventListener(PAGE_CHAT_CHANGED, shown);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const o = overview.data;
  const always = useMemo(() => (o?.rules ?? []).filter((r) => r.always), [o]);
  const rest = useMemo(() => places(o?.rules ?? []), [o]);
  const restCount = rest.reduce((n, g) => n + g.rules.length, 0);
  const act = async (work: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try { await work(); toast.success(done); invalidate(); } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  const Icon = BRAIN_PAGE.icon;
  const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <>
      <SEOHead title={BRAIN_PAGE.label + " - Godspeed Mission Control"} description={BRAIN_PAGE.description} noIndex />
      {/* As Notes: the page scrolls in its own area, so the chat's switch stays at its top; on a
          phone the open chat sits above the page instead of beside it. */}
      <div className={cn("flex", isMobile && chatOpen ? "min-h-[calc(100dvh-104px)] flex-col" : "h-[calc(100dvh-104px)] overflow-hidden")}>
        <GlobalAIChatFAB embedded pageContext={CHAT} onOpenChange={setChatOpen} />
        <div className={cn("min-w-0 flex-1 overflow-y-auto", isMobile && chatOpen && "h-[60dvh] min-h-[420px] flex-none shrink-0")}>
          {/* The chat's switch at the top left, as on Notes, and a way to each part. */}
          <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-border bg-background/95 py-1.5 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:px-2">
            <Button type="button" size="icon" className={cn("h-8 w-8 shrink-0 max-sm:h-11 max-sm:w-11", chatOpen && "ring-2 ring-inset ring-primary-foreground/40")}
              title={chatOpen ? "Close the chat" : "Chat with Godspeed about this page"} aria-label={chatOpen ? "Close the chat" : "Chat with Godspeed about this page"} aria-pressed={chatOpen} aria-expanded={chatOpen}
              onClick={() => window.dispatchEvent(new Event(TOGGLE_PAGE_CHAT))}>
              <MessageSquare className="h-4 w-4" aria-hidden="true" />
            </Button>
            <nav aria-label="Parts of this page" className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {PARTS.map(([id, label]) => <Button key={id} type="button" variant="ghost" size="sm" className="h-8 shrink-0 px-2 text-xs text-muted-foreground max-sm:h-11" onClick={() => jump(id)}>{label}</Button>)}
            </nav>
          </div>
          <div className="mx-auto max-w-5xl space-y-10 py-5 sm:px-4">
            <header className="flex items-start gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary" aria-hidden="true"><Icon className="h-6 w-6" /></div>
              <div className="min-w-0">
                <h1 className="text-2xl font-bold font-display sm:text-3xl">{BRAIN_PAGE.label}</h1>
                <p className="mt-1 max-w-[65ch] text-sm text-muted-foreground">What makes your assistant behave the way it does. Change anything here, or open the chat with the button at the top left and ask, for example "Change rule 3 so that it also covers bookings". Every change keeps the earlier version, so you can always go back.</p>
              </div>
            </header>
            {overview.isLoading && <div className="space-y-4"><Skeleton className="h-28 w-full" /><Skeleton className="h-40 w-full" /></div>}
            {overview.error && <p role="alert" className="text-sm text-destructive">{(overview.error as Error).message}</p>}
            {o && <>
              <Section id="who" icon={<UserRound className="h-5 w-5" />} title="Who it is" explain="Its name and character. Your assistant reads this first, every time."
                action={o.who.state === "ok" ? <Button size="sm" className="min-h-11 sm:min-h-9" onClick={() => setOpen("who")}><Pencil className="mr-1.5 h-4 w-4" aria-hidden="true" />Edit</Button> : undefined}>
                {o.who.state === "ok" && <Card><CardContent className="p-5 sm:p-6"><Paragraphs text={o.who.text} /></CardContent></Card>}
                {o.who.state === "no-markers" && <Card><CardContent className="space-y-3 p-5">
                  <p className="text-sm">Your assistant's main instructions (AGENTS.md) do not mark which paragraph says who your assistant is, so it cannot be changed here yet. This paragraph would become it:</p>
                  <p className="whitespace-pre-wrap rounded bg-muted/50 p-3 text-sm">{o.who.proposal}</p>
                  <Button size="sm" className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => act(identity.markWho, "Marked. You can change it now, and undo the marking from its earlier versions.")}>Mark it</Button>
                </CardContent></Card>}
                {o.who.state === "no-manual" && <p className="text-sm text-muted-foreground">Your mission control has no main instructions for your assistant (AGENTS.md) yet.</p>}
              </Section>

              <Section id="extra" icon={<NotebookPen className="h-5 w-5" />} title="Extra instructions" explain={<>Your assistant reads these right after "Who it is": in Telegram, in this notebook's chat and in its routines.</>}
                action={o.extra.state !== "unavailable" ? <Button size="sm" variant={o.extra.text ? "default" : "outline"} className="min-h-11 sm:min-h-9" onClick={() => setOpen("extra")}>{o.extra.text ? <><Pencil className="mr-1.5 h-4 w-4" aria-hidden="true" />Edit</> : <><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Add</>}</Button> : undefined}>
                <Card><CardContent className="space-y-4 p-5 sm:p-6">
                  {o.extra.text ? <Paragraphs text={o.extra.text} /> : <p className="text-sm text-muted-foreground">None yet. For example: "Answer in German when I write German."</p>}
                  {o.extra.state === "unavailable" && <p className="text-sm text-muted-foreground">{o.extra.reason}</p>}
                  {o.soul.kind === "own" && <OwnSoul soul={o.soul} busy={busy} onBring={() => act(identity.bringSoulHere, "Brought here: it is part of your extra instructions now, and the file it came from is kept as a copy.")} />}
                  {o.soul.kind === "no-assistant" && <p className="text-xs text-muted-foreground">Your assistant's program is not connected on this computer, so these take effect where it runs.</p>}
                </CardContent></Card>
              </Section>

              <Section id="rules" icon={<ShieldCheck className="h-5 w-5" />} title="Rules"
                explain={always.length ? `Your assistant reads rules 1 to ${always[always.length - 1].n} before every job, numbered as it reads them. The others it reads only when their subject comes up.` : "Your rules. The ones read before every job come first, numbered as your assistant reads them."}
                action={<Button size="sm" className="min-h-11 sm:min-h-9" onClick={() => setAdding(true)}><Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />Add a rule</Button>}>
                {o.manual.rules_list === "out-of-step" && <div role="alert" className="flex flex-col gap-2 rounded-md border border-warning/40 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <p>The list in your assistant's main instructions (AGENTS.md) is behind your rules: something changed a rule without updating it.</p>
                  <Button size="sm" variant="outline" className="min-h-11 sm:min-h-9" disabled={busy} onClick={() => act(identity.gatherRules, "The list is up to date.")}>Bring the list up to date</Button></div>}
                {o.manual.rules_list === "kept-elsewhere" && <p role="alert" className="rounded-md border border-warning/40 p-3 text-sm">The list in your assistant's main instructions (AGENTS.md) is kept by {o.manual.rules_program ? <code className="break-all">{o.manual.rules_program}</code> : "a program of your own"}, and it is not the list this page would write from your rules. So rules are not changed here: change the rule file in rules/ and run that program.</p>}
                {o.manual.rules_list === "no-place" && <p className="rounded-md border border-warning/40 p-3 text-sm">Your assistant's main instructions (AGENTS.md) have no place for the list of rules, so your assistant reads them only when it opens the files.</p>}
                {always.length > 0 && <div className={grid}>
                  {always.map((r) => <Tile key={r.target} n={r.n} name={r.title} text={r.line || r.about} tag={kindTag(r.group)} waiting={r.review_waiting} onOpen={() => setOpen(r.target)} />)}
                </div>}
                {restCount > 0 && <Collapsible open={restOpen} onOpenChange={setRestOpen} className="rounded-lg border border-border">
                  <CollapsibleTrigger asChild>
                    <button type="button" className="flex min-h-12 w-full items-center justify-between gap-2 rounded-lg px-4 py-2 text-left text-base font-semibold hover:bg-accent/50">
                      <span>Read only when their subject comes up ({restCount})</span>
                      <ChevronDown className={cn("h-5 w-5 shrink-0 transition-transform", restOpen && "rotate-180")} aria-hidden="true" />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="space-y-5 px-4 pb-4 pt-1">
                    {rest.map((g) => <div key={g.key} className="space-y-2">
                      <h3 className="text-sm font-semibold text-muted-foreground">{g.label} ({g.rules.length})</h3>
                      <div className={grid}>{g.rules.map((r) => <Tile key={r.target} n={r.n} name={r.title} text={r.line || r.about} tag={r.stated ? kindTag(r.group) : undefined} waiting={r.review_waiting} onOpen={() => setOpen(r.target)} />)}</div>
                    </div>)}
                  </CollapsibleContent>
                </Collapsible>}
                {!o.rules.length && <p className="text-sm text-muted-foreground">No rules yet.</p>}
                <Instructions />
              </Section>

              <Section id="profile" icon={<BookUser className="h-5 w-5" />} title="What it knows about you" explain="Pages about you, your work and your voice. Your assistant opens them when its main instructions point to them or when their subject comes up.">
                {o.profile.length > 0 && <div className={grid}>
                  {o.profile.map((p) => <Tile key={p.target} n={p.n} name={p.title} text={p.preview} waiting={p.review_waiting} onOpen={() => setOpen(p.target)} />)}
                </div>}
                {!o.profile.length && <p className="text-sm text-muted-foreground">No pages yet.</p>}
                <InYourNotebook />
              </Section>

              <Section id="skills" icon={<Wrench className="h-5 w-5" />} title="Skills" explain="Step-by-step instructions for one job each. Your assistant picks a skill by what it is for.">
                {o.skills.length > 0 && <div className={grid}>
                  {o.skills.map((k) => <Tile key={k.target} n={k.n} name={k.title} text={k.description} note={ORIGIN_NOTE[k.origin]} waiting={k.review_waiting} onOpen={() => setOpen(k.target)} />)}
                </div>}
                {!o.skills.length && <p className="text-sm text-muted-foreground">No skills yet.</p>}
              </Section>
              <p className="flex items-start gap-2 pb-4 text-xs text-muted-foreground"><ListChecks className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />When you ask in the chat on this page, your assistant changes these the same way, and its change appears among the earlier versions, ready to undo.</p>
            </>}
          </div>
        </div>
      </div>
      {open && <Editor target={open} overview={o} onClose={() => setOpen(null)} />}
      {adding && <NewRule overview={o} onClose={() => setAdding(false)} />}
    </>
  );
}
