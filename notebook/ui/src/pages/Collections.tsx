import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ChevronDown, LayoutGrid, Plus, Sparkles, type LucideIcon } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { SEOHead } from "@/components/SEOHead";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { Database } from "@/integrations/supabase/types";
import { AICollectionDialog } from "@/components/collections/AICollectionDialog";
import { BRAND } from "@/lib/brand";
import { dbErrorMessage } from "@/lib/function-error";
import { LoadErrorState } from "@/components/collections/LoadErrorState";
import { charmShelf, habitShelf, lastEntryDays, shelve, talksLabel, type CharmListed } from "@/lib/tracker-shelf";
import type { HabitProgress } from "@/lib/habit-progress";
import { CharmCard } from "@/components/collections/CharmCard";

type Collection = Database["public"]["Tables"]["collections"]["Row"];
// itemCount is null when the count could not be read: "0 items" would be a
// claim about the collection that nobody checked.
type CollectionWithCount = Collection & { itemCount: number | null };

const iconMap: Record<string, LucideIcon> = { LayoutGrid, Sparkles };
const emojiOptions = ["📚", "🏠", "💼", "🎯", "🍳", "✏️", "🎨", "💡", "🔧", "🌱"];
const collectionFormSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(60, "Name must be 60 characters or fewer"),
  icon: z.string().trim().refine((value) => !value || (/^\p{Emoji}/u.test(value) && Array.from(value.replace(/\uFE0F/g, "")).length === 1), "Use a single emoji"),
  description: z.string().trim().max(200, "Description must be 200 characters or fewer").optional(),
  visibility: z.enum(["private", "personal"]),
});

type CollectionFormValues = z.infer<typeof collectionFormSchema>;
type CollectionFormErrors = Partial<Record<keyof CollectionFormValues, string>>;

function slugify(value: string) {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "collection";
}

function CollectionIcon({ icon, className = "h-5 w-5" }: { icon?: string | null; className?: string }) {
  if (icon && /^\p{Emoji}/u.test(icon)) return <span className={className}>{icon}</span>;
  const Icon = icon && icon in iconMap ? iconMap[icon] : LayoutGrid;
  return <Icon className={className} />;
}

function CollectionsSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, index) => (
        <Card key={index}>
          <CardHeader className="pb-3">
            <div className="flex items-start gap-3">
              <Skeleton className="h-10 w-10 rounded-md" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-5 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Skeleton className="h-4 w-20" />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function EmptyCollectionsState({ onNewBlank, onCreateWithAI, onBrowseTemplates }: { onNewBlank: () => void; onCreateWithAI: () => void; onBrowseTemplates: () => void }) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4 py-16 text-center">
      <div className="max-w-2xl">
        <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-md bg-primary/10 text-primary">
          <LayoutGrid className="h-8 w-8" />
        </div>
        <h1 className="text-2xl font-bold font-display">No collections yet</h1>
        <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
          A collection is a table of things you want to keep in order: household items, reading lists, contacts, job applications. Create one from a template or describe what it should hold. Anything you track by saying "track" goes on its own Trackers shelf here.
        </p>
        <div className="mt-6 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button variant="secondary" onClick={onBrowseTemplates}>Browse Templates</Button>
          <Button size="lg" className="bg-gradient-to-r from-primary to-accent text-primary-foreground hover:opacity-95" onClick={onCreateWithAI}>
            ✨ Create with AI
          </Button>
        </div>
        <button type="button" className="mt-4 text-sm text-primary underline-offset-4 hover:underline" onClick={onNewBlank}>
          or create a blank collection
        </button>
      </div>
    </div>
  );
}

function CollectionCard({ collection }: { collection: CollectionWithCount }) {
  // A real link, so the card is reachable with Tab and opens with Enter.
  return (
    <Link
      to={`/collections/${collection.slug}`}
      className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <Card className="cursor-pointer transition-colors hover:bg-accent/50">
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
              <CollectionIcon icon={collection.icon} />
            </div>
            <div className="min-w-0 flex-1">
              <CardTitle className="truncate text-base">{collection.name}</CardTitle>
              <p className="mt-1 line-clamp-2 min-h-10 text-sm text-muted-foreground">
                {collection.description || "No description"}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground">
            {collection.itemCount === null
              ? "Item count not available"
              : `${collection.itemCount} item${collection.itemCount === 1 ? "" : "s"}`}
          </p>
        </CardContent>
      </Card>
    </Link>
  );
}

// A habit on the Trackers shelf (D-321, step 3): the coach's own record, shown as a tracker. Its
// page lists its days and changes them through the coach.
type HabitCardData = { id: string; name: string; specialist?: string | null; status?: string; habit_status?: string; talks?: string[] | null; talk?: string | null; progress?: HabitProgress; last?: { when?: string; data?: { answer?: string } } | null };
const ANSWER_WORDS: Record<string, string> = { done: "done", no: "not done", skip: "skipped" };
function HabitCard({ habit }: { habit: HabitCardData }) {
  const last = habit.last?.when && habit.last.data?.answer ? `${ANSWER_WORDS[habit.last.data.answer] ?? habit.last.data.answer} on ${habit.last.when}` : "No day tracked yet";
  return (
    <Link
      to={`/trackers/habits/${encodeURIComponent(habit.id)}`}
      className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <Card className="cursor-pointer transition-colors hover:bg-accent/50">
        <CardHeader className="pb-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary" aria-hidden="true">✓</div>
            <div className="min-w-0 flex-1">
              <CardTitle className="truncate text-base">{habit.name}</CardTitle>
              <p className="mt-1 line-clamp-2 min-h-10 text-sm text-muted-foreground">
                Habit{talksLabel(habit) ? `, ${talksLabel(habit)}` : ""}{habit.habit_status && habit.habit_status !== "active" ? `, ${habit.habit_status}` : ""}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {habit.progress && <div className="mb-2 space-y-1 text-sm">
            <p className="font-medium">{habit.progress.lifetimeCompletedDays} days completed, all time</p>
            {habit.progress.display !== "calm" && habit.progress.currentRun > 0 && <p>Current streak: {habit.progress.currentRun} completed planned days</p>}
          </div>}
          <p className="text-xs text-muted-foreground">{last}</p>
        </CardContent>
      </Card>
    </Link>
  );
}

function NewCollectionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [values, setValues] = useState<CollectionFormValues>({ name: "", icon: "📚", description: "", visibility: "private" });
  const [errors, setErrors] = useState<CollectionFormErrors>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const slugPreview = slugify(values.name);

  const updateValue = <K extends keyof CollectionFormValues>(key: K, value: CollectionFormValues[K]) => {
    setValues((current) => ({ ...current, [key]: value }));
    setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const validate = () => {
    const parsed = collectionFormSchema.safeParse(values);
    if (parsed.success) {
      setErrors({});
      return parsed.data;
    }

    const nextErrors: CollectionFormErrors = {};
    parsed.error.issues.forEach((issue) => {
      const key = issue.path[0] as keyof CollectionFormValues | undefined;
      if (key) nextErrors[key] = issue.message;
    });
    setErrors(nextErrors);
    return null;
  };

  const reset = () => {
    setValues({ name: "", icon: "📚", description: "", visibility: "private" });
    setErrors({});
    setIsSubmitting(false);
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!user) return;

    const parsed = validate();
    if (!parsed) return;

    setIsSubmitting(true);
    const { data, error } = await supabase
      .from("collections")
      .insert({
        user_id: user.id,
        name: parsed.name,
        slug: slugPreview,
        icon: parsed.icon || null,
        description: parsed.description || null,
        visibility: parsed.visibility,
        field_schema: [],
        agent_instructions: null,
      })
      .select("slug")
      .single();

    setIsSubmitting(false);
    if (error || !data) {
      toast.error("Could not create collection", { description: "Please try again." });
      return;
    }

    toast.success("Collection created");
    onOpenChange(false);
    reset();
    navigate(`/collections/${data.slug}/schema`);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) reset(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>New Collection</DialogTitle></DialogHeader>
        <form className="space-y-5" onSubmit={submit}>
          <div className="space-y-2">
            <Label htmlFor="collection-name">Name</Label>
            <Input id="collection-name" value={values.name} maxLength={60} onChange={(event) => updateValue("name", event.target.value)} onBlur={validate} placeholder="Reading List" />
            <p className="text-xs text-muted-foreground">Slug: {slugPreview}</p>
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
          </div>

          <div className="space-y-2">
            <Label>Icon</Label>
            <div className="flex flex-wrap gap-2">
              {emojiOptions.map((emoji) => (
                <button key={emoji} type="button" className={cn("flex h-9 w-9 items-center justify-center rounded-md border text-lg transition-colors hover:bg-accent", values.icon === emoji && "border-primary bg-primary/10")} onClick={() => updateValue("icon", emoji)}>
                  {emoji}
                </button>
              ))}
            </div>
            <Input value={values.icon} maxLength={4} onChange={(event) => updateValue("icon", event.target.value)} onBlur={validate} className="w-24" aria-label="Custom emoji" />
            {errors.icon && <p className="text-xs text-destructive">{errors.icon}</p>}
          </div>

          <div className="space-y-2">
            <Label htmlFor="collection-description">Description</Label>
            <Textarea id="collection-description" value={values.description} maxLength={200} onChange={(event) => updateValue("description", event.target.value)} onBlur={validate} placeholder="What does this collection track?" />
            {errors.description && <p className="text-xs text-destructive">{errors.description}</p>}
          </div>

          <div className="space-y-2">
            <Label>Visibility</Label>
            <RadioGroup value={values.visibility} onValueChange={(value) => updateValue("visibility", value as "private" | "personal")}>
              <Label className="flex items-center gap-2 rounded-md border p-3"><RadioGroupItem value="private" /> Private (only me)</Label>
              <Label className="flex items-center gap-2 rounded-md border p-3"><RadioGroupItem value="personal" /> Personal (visible to my AI agents)</Label>
            </RadioGroup>
          </div>

          <p className="rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">URL: {BRAND.domain}/collections/{slugPreview}</p>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!values.name.trim() || isSubmitting}>Create</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Collections() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [collections, setCollections] = useState<CollectionWithCount[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  // The latest entry day of each tracker (D-321); null when it could not be
  // read, and then no tracker is folded away as resting on a guess.
  const [lastWhen, setLastWhen] = useState<Record<string, string> | null>({});
  const [restingOpen, setRestingOpen] = useState(false);
  // Habits, from tracker-list; none when it could not be read, and the rest of the page still loads.
  const [habits, setHabits] = useState<{ active: HabitCardData[]; resting: HabitCardData[] }>({ active: [], resting: [] });
  // The Charm Challenge's count, from tracker-list too; none when it could not be read, and its card
  // then says so instead of a number.
  const [charmListed, setCharmListed] = useState<CharmListed[]>([]);
  const userId = user?.id;

  useEffect(() => {
    if (!userId) return;

    let cancelled = false;
    const fetchCollections = async () => {
      setIsLoading(true);
      setLoadFailed(false);
      const { data, error } = await supabase
        .from("collections")
        .select("*")
        .eq("user_id", userId)
        .order("updated_at", { ascending: false });

      if (error) {
        // Shown as a failure with Retry. The empty state ("No collections
        // yet") would tell the person their collections are gone.
        if (!cancelled) {
          setLoadFailed(true);
          setIsLoading(false);
        }
        return;
      }

      const rows = data ?? [];
      let countError: unknown = null;
      const counts = await Promise.all(
        rows.map(async (collection) => {
          const { count, error: rowCountError } = await supabase
            .from("collection_items")
            .select("id", { count: "exact", head: true })
            .eq("collection_id", collection.id)
            .eq("user_id", userId);

          if (rowCountError) {
            countError = rowCountError;
            return [collection.id, null] as const;
          }
          return [collection.id, count ?? 0] as const;
        }),
      );
      if (countError && !cancelled)
        toast.error("Could not load item counts", {
          description: dbErrorMessage(countError, "Please try again."),
        });

      const countById = new Map<string, number | null>(counts);
      // A tracker is a collection with a tracker card; its entries' days say
      // whether it is resting.
      const trackerIds = rows.filter((collection) => (collection as { tracker?: unknown }).tracker).map((collection) => collection.id);
      let days: Record<string, string> | null = {};
      if (trackerIds.length) {
        const { data: entries, error: entriesError } = await supabase
          .from("collection_items")
          .select("collection_id, data")
          .in("collection_id", trackerIds)
          .eq("user_id", userId);
        days = entriesError ? null : lastEntryDays(entries ?? []);
      }
      // Habits are trackers made from the coach's own files (D-321): tracker-list gives them.
      const { data: listed, error: listError } = await supabase.functions.invoke("personal-operation", { body: { type: "tracker-list" } });
      const listedTrackers = listError ? [] : ((listed as { trackers?: (HabitCardData & CharmListed)[] } | null)?.trackers ?? []);
      const habitList = habitShelf(listedTrackers);
      if (!cancelled) {
        setCollections(rows.map((collection) => ({ ...collection, itemCount: countById.get(collection.id) ?? null })));
        setLastWhen(days);
        setHabits(habitList);
        setCharmListed(listedTrackers.filter((t) => t.specialist === "charm"));
        setIsLoading(false);
      }
    };

    fetchCollections();
    return () => { cancelled = true; };
  }, [userId, refreshKey]);

  const hasCollections = useMemo(() => collections.length > 0, [collections.length]);
  const shelf = useMemo(() => {
    const sorted = shelve(collections, lastWhen ?? {}, new Date());
    return lastWhen ? sorted : { ...sorted, trackers: [...sorted.trackers, ...sorted.resting], resting: [] };
  }, [collections, lastWhen]);
  const charm = useMemo(() => charmShelf(collections, charmListed, lastWhen, new Date()), [collections, charmListed, lastWhen]);
  const hasTrackers = shelf.trackers.length + shelf.resting.length + habits.active.length + habits.resting.length + charm.active.length + charm.resting.length > 0;
  const resting = shelf.resting.length + habits.resting.length + charm.resting.length;

  return (
    <div className="w-full max-w-6xl">
      <SEOHead title="Collections - Godspeed Mission Control" noIndex />
      {hasCollections && (
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-bold font-display">Collections</h1>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => navigate("/collections/templates")}>Templates</Button>
            <Button size="sm" className="bg-gradient-to-r from-primary to-accent text-primary-foreground hover:opacity-95" onClick={() => setAiDialogOpen(true)}>✨ Create with AI</Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="icon" aria-label="New blank collection" onClick={() => setDialogOpen(true)}>
                  <Plus className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>New blank collection</TooltipContent>
            </Tooltip>
          </div>
        </div>
      )}

      {isLoading ? (
        <CollectionsSkeleton />
      ) : loadFailed ? (
        <LoadErrorState
          className="min-h-[40vh]"
          title="Your collections could not be loaded."
          onRetry={() => setRefreshKey((key) => key + 1)}
        />
      ) : collections.length === 0 && !hasTrackers ? (
        <EmptyCollectionsState onNewBlank={() => setDialogOpen(true)} onCreateWithAI={() => setAiDialogOpen(true)} onBrowseTemplates={() => navigate("/collections/templates")} />
      ) : (
        <div className="space-y-8">
          {hasTrackers && (
            <section className="space-y-3" aria-labelledby="trackers-heading">
              <h2 id="trackers-heading" className="text-lg font-bold font-display">Trackers</h2>
              {shelf.trackers.length + habits.active.length + charm.active.length > 0 && (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {charm.active.map((card) => <CharmCard key={card.collection.id} collection={card.collection} charm={card.charm} />)}
                  {shelf.trackers.map((collection) => <CollectionCard key={collection.id} collection={collection} />)}
                  {habits.active.map((habit) => <HabitCard key={habit.id} habit={habit} />)}
                </div>
              )}
              {resting > 0 && (
                <Collapsible open={restingOpen} onOpenChange={setRestingOpen} className="space-y-3">
                  <CollapsibleTrigger asChild>
                    <button type="button" className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground">
                      Resting ({resting})
                      <ChevronDown className={cn("h-4 w-4 transition-transform", restingOpen && "rotate-180")} />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {charm.resting.map((card) => <CharmCard key={card.collection.id} collection={card.collection} charm={card.charm} />)}
                      {shelf.resting.map((collection) => <CollectionCard key={collection.id} collection={collection} />)}
                      {habits.resting.map((habit) => <HabitCard key={habit.id} habit={habit} />)}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}
            </section>
          )}
          {shelf.others.length > 0 && (
            <section className="space-y-3" aria-labelledby={hasTrackers ? "collections-heading" : undefined}>
              {hasTrackers && <h2 id="collections-heading" className="text-lg font-bold font-display">Collections</h2>}
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {shelf.others.map((collection) => <CollectionCard key={collection.id} collection={collection} />)}
              </div>
            </section>
          )}
        </div>
      )}
      <NewCollectionDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      <AICollectionDialog open={aiDialogOpen} onOpenChange={setAiDialogOpen} onCreated={() => setRefreshKey((key) => key + 1)} />
    </div>
  );
}
