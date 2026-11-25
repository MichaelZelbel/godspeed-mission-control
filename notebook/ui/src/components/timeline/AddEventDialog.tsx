import { type MouseEvent, useEffect, useId, useState } from "react";
import { format } from "date-fns";
import { Loader2, Plus, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useAICreditsGate } from "@/hooks/useAICreditsGate";
import type { AIAvailability } from "@/hooks/useAICredits";
import { triggerCreditsRefresh } from "@/lib/credits-events";
import { OUT_OF_CREDITS_MESSAGE, dbErrorMessage, functionErrorMessage, readFunctionError } from "@/lib/function-error";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import PeopleMultiSelect from "./PeopleMultiSelect";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label, LabelAside, RequiredMark } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import ImportanceSlider from "./ImportanceSlider";
import { UNNAMED_PERSON } from "./people";
import { END_BEFORE_START, aiFailureKind, factsNotPulledOut, filledOnOpen, endsBeforeStart, joinMoment, mergeSuggestion, momentTime, newPeopleToCreate, noAiFacts } from "./moment-form.mjs";

export interface TimelineContact {
  id: string;
  name: string;
  relationship: string | null;
}

interface MomentDraft {
  happened_at: string;
  happened_end?: string | null;
  title: string;
  status: string;
  impact_level: number;
  confidence_date: number;
  confidence_truth: number;
  participants?: string[];
}

export interface EditMomentData {
  id: string;
  title: string;
  description: string | null;
  // A moment another writer saved may have no happened_at and no scores.
  happened_at: string | null;
  happened_end: string | null;
  status: string;
  impact_level: number | null;
  confidence_date: number | null;
  confidence_truth: number | null;
  participantIds?: string[];
}

// The label each status shows in this form. The Timeline's cards and filters
// read these too, so a status is named the same way everywhere it appears.
export const statusLabels: Record<string, string> = {
  past_fact: "Past Fact",
  future_plan: "Future Plan",
  ongoing: "Ongoing",
  unknown: "Unknown",
};
// A status the form does not know shows as it is stored rather than as nothing.
export const statusLabel = (status: string) => statusLabels[status] ?? status;

interface AddEventDialogProps {
  people: TimelineContact[];
  onCreated: () => void;
  editEvent?: EditMomentData | null;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

const AI_FALLBACK = "The suggestion could not be made. Try again.";

export default function AddEventDialog({ people, onCreated, editEvent, open: controlledOpen, onOpenChange }: AddEventDialogProps) {
  const { user, session } = useAuth();
  const { toast } = useToast();
  const { checkCredits, providerConfigured, aiAvailability, refetch: refetchAIStatus } = useAICreditsGate();
  const isControlled = controlledOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? (onOpenChange || (() => {})) : setInternalOpen;
  const isEditMode = !!editEvent;
  const today = format(new Date(), "yyyy-MM-dd");

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dateStart, setDateStart] = useState(today);
  const [dateEnd, setDateEnd] = useState("");
  const [timeStart, setTimeStart] = useState("");
  const [timeEnd, setTimeEnd] = useState("");
  // The values an edit opened with, so an untouched timed value is written
  // back as its writer saved it instead of relabelled to Z.
  const [opened, setOpened] = useState<{ start: string; end: string } | null>(null);
  const [status, setStatus] = useState("unknown");
  // Null means the moment has no such score saved and the person has not set
  // one: the slider's label reads Not set, and saving writes null again.
  const [impactLevel, setImpactLevel] = useState<number | null>(1);
  const [confDate, setConfDate] = useState<number | null>(5);
  const [confTruth, setConfTruth] = useState<number | null>(5);
  const [matchedPeople, setMatchedPeople] = useState<string[]>([]);
  const [suggestedNewPeople, setSuggestedNewPeople] = useState<string[]>([]);
  const [selectedNewPeople, setSelectedNewPeople] = useState<string[]>([]);
  // New people typed into the People picker by hand, created on save like the suggested ones.
  const [typedNewPeople, setTypedNewPeople] = useState<string[]>([]);
  const [suggestionApplied, setSuggestionApplied] = useState(false);
  // How many fields the last suggestion filled; 0 means everything was already filled in.
  const [suggestionFilled, setSuggestionFilled] = useState(0);
  // Fields the person has filled in, which a suggestion leaves alone (moment-form.mjs).
  const [filled, setFilled] = useState(() => filledOnOpen(null));
  const markFilled = (field: "title" | "dateStart" | "dateEnd" | "status" | "impactLevel" | "confDate" | "confTruth") => setFilled((f) => (f[field] ? f : { ...f, [field]: true }));
  const [aiLoading, setAiLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // Every visible field label names its control: inputs through for/id, the Status and People
  // buttons through for/id too, the sliders' thumbs through aria-labelledby. Clicking a label
  // only focuses its control, the way a label of a native select does; it never opens a picker.
  const fieldId = useId();
  const peopleFieldId = `${fieldId}-people`;
  const ids = {
    title: `${fieldId}-title`, dateStart: `${fieldId}-date-start`, dateEnd: `${fieldId}-date-end`, timeStart: `${fieldId}-time-start`, timeEnd: `${fieldId}-time-end`, dateEndError: `${fieldId}-date-end-error`, status: `${fieldId}-status`,
    confDate: `${fieldId}-conf-date`, confDateLabel: `${fieldId}-conf-date-label`,
    confTruth: `${fieldId}-conf-truth`, confTruthLabel: `${fieldId}-conf-truth-label`,
    newPeopleLabel: `${fieldId}-new-people-label`,
  };
  const focusOnly = (id: string) => (e: MouseEvent) => { e.preventDefault(); document.getElementById(id)?.focus(); };
  // The edit of a moment with no day at all may stay undated: its Start Date
  // opens empty and saving without touching it writes no date. A dated moment
  // still needs one, as its * says.
  const dateOptional = isEditMode && !editEvent?.happened_at;
  const confDateText = confDate?.toString() ?? "Not set";
  const confTruthText = confTruth?.toString() ?? "Not set";

  useEffect(() => {
    if (!open) return;
    if (editEvent) {
      setTitle(editEvent.title);
      setDescription(editEvent.description || "");
      // A dateless or scoreless moment opens with empty fields instead of
      // made-up ones: no start date and sliders labelled Not set, so saving
      // without touching them keeps the moment as it was. filledOnOpen leaves
      // those gaps open to a suggestion, like any other empty field.
      setDateStart(editEvent.happened_at ? editEvent.happened_at.split("T")[0] : "");
      setDateEnd(editEvent.happened_end ? editEvent.happened_end.split("T")[0] : "");
      setTimeStart(momentTime(editEvent.happened_at));
      setTimeEnd(momentTime(editEvent.happened_end));
      setOpened({ start: editEvent.happened_at ?? "", end: editEvent.happened_end ?? "" });
      setStatus(editEvent.status);
      setImpactLevel(editEvent.impact_level);
      setConfDate(editEvent.confidence_date);
      setConfTruth(editEvent.confidence_truth);
      setMatchedPeople(editEvent.participantIds || []);
    } else {
      setTitle("");
      setDescription("");
      setDateStart(today);
      setDateEnd("");
      setTimeStart("");
      setTimeEnd("");
      setOpened(null);
      setStatus("unknown");
      setImpactLevel(1);
      setConfDate(5);
      setConfTruth(5);
      setMatchedPeople([]);
    }
    setFilled(filledOnOpen(editEvent));
    setSuggestedNewPeople([]);
    setSelectedNewPeople([]);
    setTypedNewPeople([]);
    setSuggestionApplied(false);
  }, [open, editEvent, today]);

  // A suggestion fills only the fields the person has not filled in yet; it
  // used to replace them all, so a chosen start date became "yesterday".
  const applyDraft = (draft: MomentDraft) => {
    const merged = mergeSuggestion(
      { title, dateStart, dateEnd, status, impactLevel, confDate, confTruth, matchedPeople },
      filled,
      draft,
      people,
    );
    setTitle(merged.form.title);
    setDateStart(merged.form.dateStart);
    setDateEnd(merged.form.dateEnd);
    setStatus(merged.form.status);
    setImpactLevel(merged.form.impactLevel);
    setConfDate(merged.form.confDate);
    setConfTruth(merged.form.confTruth);
    setMatchedPeople(merged.form.matchedPeople);
    setSuggestedNewPeople(merged.newPeople);
    setSelectedNewPeople(merged.newPeople);
    setSuggestionFilled(merged.changed.length + merged.newPeople.length);
    setSuggestionApplied(true);
  };

  // Known draft-event codes get their own sentence; anything else goes through
  // functionErrorMessage, so raw provider or runtime text never reaches the toast.
  const friendlyAiError = (code?: string | null): { title: string; description: string } | null => {
    switch (code) {
      case "AI_NO_DRAFT":
        return { title: "No suggestion possible", description: "The AI could not make a suggestion from this description. Try wording it more concretely, or shorten it." };
      case "AI_REFUSED":
        return { title: "Text declined", description: "The AI declined this text, probably because of its safety filter. Try rewording it." };
      case "AI_TRUNCATED":
        return { title: "Description too long", description: "The description is too long for a suggestion. Please shorten it." };
      case "PROVIDER_ERROR":
        return { title: "AI provider error", description: "The AI provider returned an error." };
      case "INSUFFICIENT_CREDITS":
        return { title: "No AI credits left", description: OUT_OF_CREDITS_MESSAGE };
      default:
        return null;
    }
  };

  const handleAiSuggest = async () => {
    if (!description.trim() || !session) return;
    if (!checkCredits()) return;
    setAiLoading(true);
    setSuggestionApplied(false);
    try {
      const { data, error } = await supabase.functions.invoke("draft-event", {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { messages: [{ role: "user", content: description.trim() }], today, people: people.filter((p) => p.name !== UNNAMED_PERSON).map((p) => ({ name: p.name })) },
      });
      if (error) {
        const details = await readFunctionError(error);
        const f = friendlyAiError(details.code);
        toast({
          title: f?.title ?? "No suggestion",
          description: f?.description ?? (await functionErrorMessage(error, AI_FALLBACK)),
          variant: "destructive",
        });
        return;
      }
      const code = (data as { code?: string } | null)?.code;
      if (code) {
        const f = friendlyAiError(code);
        toast({ title: f?.title ?? "No suggestion", description: f?.description ?? AI_FALLBACK, variant: "destructive" });
        return;
      }
      if ((data as any)?.error) throw new Error((data as any).error);
      applyDraft((data as any).draft as MomentDraft);
      triggerCreditsRefresh();
    } catch (err: unknown) {
      toast({ title: "No suggestion", description: await functionErrorMessage(err, AI_FALLBACK), variant: "destructive" });
    } finally {
      setAiLoading(false);
    }
  };

  const startValue = joinMoment(dateStart, timeStart);
  const endValue = joinMoment(dateEnd, timeEnd);
  const endBeforeStart = endsBeforeStart(startValue, endValue);
  // A timed value the person did not change is written back as it came.
  const toStore = (value: string, original: string | undefined) =>
    original && momentTime(original) && value === joinMoment(original.slice(0, 10), momentTime(original)) ? original : value;
  const handleSave = async () => {
    if (!user || !title.trim() || (!dateStart && !dateOptional) || endBeforeStart) return;
    setSaving(true);
    try {
      // A date or score the moment is missing and the person has not set
      // saves as null, so an edit of an undated or sparse moment leaves its
      // gaps as they are instead of dating it today with made-up scores.
      const momentPayload = {
        user_id: user.id,
        title: title.trim(),
        description: description.trim() || null,
        happened_at: toStore(startValue, opened?.start) || null,
        happened_end: toStore(endValue, opened?.end) || null,
        status,
        impact_level: impactLevel,
        confidence_date: confDate,
        confidence_truth: confTruth,
      };

      // People are resolved before the moment is written, so a failure here
      // leaves nothing half-saved and a retry does not create a second moment.
      const newPeopleIds: string[] = [];
      for (const name of newPeopleToCreate(selectedNewPeople, typedNewPeople)) {
        // A name typed as new may already be in People under another case.
        const { data: existing, error: lookupError } = await supabase
          .from("contacts")
          .select("id")
          .eq("user_id", user.id)
          .is("merged_into", null)
          .ilike("name", name.replace(/[%_\\]/g, (ch) => "\\" + ch))
          .limit(1);
        // A failed lookup would otherwise create a duplicate of an existing person.
        if (lookupError) throw lookupError;
        if (existing && existing.length > 0) {
          newPeopleIds.push(existing[0].id);
          continue;
        }
        const { data, error: createError } = await supabase.from("contacts").insert({ user_id: user.id, name }).select("id").single();
        // Swallowing this used to save the moment without the person, silently.
        if (createError || !data) throw createError || new Error(`Could not add ${name}`);
        newPeopleIds.push(data.id);
      }

      const desiredIds = Array.from(new Set([...matchedPeople, ...newPeopleIds]));
      // The first person, picked or new, is the moment's main person.
      const momentRow = { ...momentPayload, person_id: desiredIds[0] || null };

      let momentId = editEvent?.id;
      if (isEditMode && momentId) {
        const { error } = await supabase.from("moments" as any).update(momentRow).eq("id", momentId);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("moments" as any).insert({ ...momentRow, source: "manual" }).select("id").single();
        if (error || !data) throw error || new Error("Moment was not created");
        momentId = (data as any).id;
      }

      if (momentId) {
        // Diff against what the moment already has instead of the old
        // delete-everything-then-reinsert. That pattern permanently lost every
        // participant whenever the dialog opened without them loaded, and even
        // in the normal flow a throw between the delete and the insert wiped
        // them with no recovery. Now an unchanged edit touches nothing.
        let existingIds: string[] = [];
        if (isEditMode) {
          const { data: existingRows, error: existingError } = await supabase
            .from("moment_participants" as any)
            .select("person_id")
            .eq("moment_id", momentId);
          // Read as "nobody" this re-inserted everyone and hit the primary key.
          if (existingError) throw existingError;
          existingIds = ((existingRows || []) as unknown as { person_id: string }[]).map((r) => r.person_id);
        }
        const toAdd = desiredIds.filter((id) => !existingIds.includes(id));
        const toRemove = existingIds.filter((id) => !desiredIds.includes(id));
        if (toRemove.length > 0) {
          const { error } = await supabase.from("moment_participants" as any).delete().eq("moment_id", momentId).in("person_id", toRemove);
          if (error) throw error;
        }
        if (toAdd.length > 0) {
          const { error } = await supabase.from("moment_participants" as any).insert(toAdd.map((person_id) => ({ moment_id: momentId, person_id })));
          if (error) throw error;
        }
      }

      // Profile facts about the participants are pulled out after the save and never hold it up. When
      // the AI refused the key or could not be reached, the confirmation says no facts were (#779).
      const saved = isEditMode ? "Moment updated" : "Moment created";
      // A refused, unreachable or stalled AI the tab already knows about keeps its at-once answer
      // (#796). With no AI connected at all (the tab's own status, refreshed every few seconds) no
      // extraction is asked for (#881): a moment with people still gets the no-AI explanation
      // (#784). When the tab still says an AI is connected, the extraction decides when the moment
      // is saved (#812). If the connection was removed while the tab was open, the extraction's
      // own reply supplies the answer.
      // A cached answer that says no AI is connected is read afresh before the save skips anything
      // (#907): connecting the AI again in Settings, Your AI leaves the tab's last poll answer
      // standing until the next one, so a save made in between must not skip on the older picture.
      // The status read asks the AI nothing, so a save with no AI connected still sends it nothing.
      let statusConfigured = providerConfigured;
      let statusAvailability = aiAvailability;
      // The same goes for a remembered failure (#1057): the AI may since have answered differently
      // (500, then a refused key), so the reason shown is read from the status check made now.
      const failureKnown = statusAvailability === "refused" || statusAvailability === "unreachable" || statusAvailability === "stalled";
      if (!statusConfigured && (statusAvailability === "none" || failureKnown) && refetchAIStatus) {
        const fresh = await refetchAIStatus();
        if (fresh.data) {
          statusConfigured = !!fresh.data.runtimeConfigured;
          statusAvailability = fresh.data.aiAvailability as AIAvailability | undefined;
        }
      }
      const hasPeople = desiredIds.length > 0;
      const noneConnected = !statusConfigured && statusAvailability === "none";
      const known = statusConfigured || (noneConnected && !hasPeople) ? null : factsNotPulledOut(statusAvailability);
      if (momentId && !known && !noneConnected) {
        supabase.functions
          .invoke("extract-moment-profile", { body: { moment_id: momentId } })
          .then(({ error }) => {
            const message = String(error?.message || "");
            const skipped = (hasPeople ? noAiFacts(message) : null) || factsNotPulledOut(aiFailureKind(message));
            if (skipped) toast({ title: saved, description: skipped });
          })
          .catch(() => {});
      }
      toast(known ? { title: saved, description: known } : { title: saved });
      setOpen(false);
      onCreated();

    } catch (err: unknown) {
      toast({
        title: isEditMode ? "Failed to update moment" : "Failed to create moment",
        description: dbErrorMessage(err, "Your changes were not saved. Try again."),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const dialogContent = (
    <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>{isEditMode ? "Edit Moment" : "Add Moment"}</DialogTitle></DialogHeader>
      <div className="space-y-4">
        <Textarea value={description} onChange={(e) => { setDescription(e.target.value); if (suggestionApplied) setSuggestionApplied(false); }} placeholder="Describe what happened…" aria-label="Describe what happened" rows={4} />
        <div className="space-y-1.5">
          <Button type="button" variant="outline" size="sm" onClick={handleAiSuggest} disabled={aiLoading || !description.trim()} className="w-full">
            {aiLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            Suggest title and other values
          </Button>
          {suggestionApplied && <p className="text-xs text-muted-foreground">{suggestionFilled > 0 ? "Suggestions applied - review and edit below." : "The suggestion left every field as it was."}</p>}
        </div>
        <div className="space-y-2"><div><Label htmlFor={ids.title} onClick={focusOnly(ids.title)}>Title</Label> <RequiredMark /></div><Input id={ids.title} aria-required="true" value={title} onChange={(e) => { setTitle(e.target.value); markFilled("title"); }} placeholder="Short title for this moment" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <div><Label htmlFor={ids.dateStart} onClick={focusOnly(ids.dateStart)}>Start Date</Label>{!dateOptional && <> <RequiredMark /></>}</div>
            <Input id={ids.dateStart} aria-required={dateOptional ? undefined : true} type="date" value={dateStart} onChange={(e) => { setDateStart(e.target.value); markFilled("dateStart"); }} />
            <div className="space-y-2"><Label htmlFor={ids.timeStart} onClick={focusOnly(ids.timeStart)}>Start Time</Label><Input id={ids.timeStart} type="time" value={timeStart} disabled={!dateStart} aria-invalid={endBeforeStart || undefined} onChange={(e) => setTimeStart(e.target.value)} /></div>
          </div>
          <div className="space-y-2"><Label htmlFor={ids.dateEnd} onClick={focusOnly(ids.dateEnd)}>End Date</Label><Input id={ids.dateEnd} type="date" value={dateEnd} aria-invalid={endBeforeStart || undefined} aria-describedby={endBeforeStart ? ids.dateEndError : undefined} onChange={(e) => { setDateEnd(e.target.value); if (!e.target.value) setTimeEnd(""); markFilled("dateEnd"); }} /><div className="space-y-2"><Label htmlFor={ids.timeEnd} onClick={focusOnly(ids.timeEnd)}>End Time</Label><Input id={ids.timeEnd} type="time" value={timeEnd} disabled={!dateEnd} aria-invalid={endBeforeStart || undefined} aria-describedby={endBeforeStart ? ids.dateEndError : undefined} onChange={(e) => setTimeEnd(e.target.value)} /></div>{endBeforeStart && <p id={ids.dateEndError} className="text-xs text-destructive">{END_BEFORE_START}</p>}</div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            <Label htmlFor={ids.status} onClick={focusOnly(ids.status)}>Status</Label>
            <Select value={status} onValueChange={(v) => { setStatus(v); markFilled("status"); }}>
              <SelectTrigger id={ids.status}><SelectValue /></SelectTrigger>
              <SelectContent>
                {Object.entries(statusLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <div><Label id={ids.confDateLabel} onClick={focusOnly(ids.confDate)}>Confidence (Date)</Label><LabelAside>: {confDateText}</LabelAside></div>
            <Slider value={[confDate ?? 5]} onValueChange={([v]) => { setConfDate(v); markFilled("confDate"); }} min={0} max={10} step={1} thumbProps={{ id: ids.confDate, "aria-labelledby": ids.confDateLabel, "aria-valuetext": confDateText }} />
          </div>
        </div>
        <ImportanceSlider value={impactLevel} onChange={(v) => { setImpactLevel(v); markFilled("impactLevel"); }} />
        <div className="space-y-2">
          <div><Label id={ids.confTruthLabel} onClick={focusOnly(ids.confTruth)}>Confidence (Truth)</Label><LabelAside>: {confTruthText}</LabelAside></div>
          <Slider value={[confTruth ?? 5]} onValueChange={([v]) => { setConfTruth(v); markFilled("confTruth"); }} min={0} max={10} step={1} thumbProps={{ id: ids.confTruth, "aria-labelledby": ids.confTruthLabel, "aria-valuetext": confTruthText }} />
        </div>
        <div className="space-y-2"><Label htmlFor={peopleFieldId} onClick={focusOnly(peopleFieldId)} className="text-xs">People</Label><PeopleMultiSelect id={peopleFieldId} people={people} value={matchedPeople} onChange={setMatchedPeople} newNames={typedNewPeople} onNewNamesChange={setTypedNewPeople} /></div>
        {suggestedNewPeople.length > 0 && <div className="space-y-2"><p id={ids.newPeopleLabel} className="text-xs font-medium leading-none text-muted-foreground">Add new people (not yet in your list)</p><div role="group" aria-labelledby={ids.newPeopleLabel} className="space-y-1.5">{suggestedNewPeople.map((name) => <label key={name} className="flex items-center gap-2 cursor-pointer"><Checkbox checked={selectedNewPeople.includes(name)} onCheckedChange={(checked) => setSelectedNewPeople((prev) => checked ? [...prev, name] : prev.filter((n) => n !== name))} /><span className="text-sm">{name}</span></label>)}</div></div>}
      </div>
      <DialogFooter><Button onClick={handleSave} disabled={saving || !title.trim() || (!dateStart && !dateOptional) || endBeforeStart}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}{isEditMode ? "Save Changes" : "Create Moment"}</Button></DialogFooter>
    </DialogContent>
  );

  if (isControlled) return <Dialog open={open} onOpenChange={setOpen}>{dialogContent}</Dialog>;
  return <Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button size="sm"><Plus className="mr-2 h-4 w-4" /> Add Moment</Button></DialogTrigger>{dialogContent}</Dialog>;
}
