import { useEffect, useState } from "react";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fetchAiFootprint } from "@/hooks/useAiFootprint";
import {
  useToggleAiVisibility,
  useToggleSensitivePerson,
  type AiKind,
} from "@/hooks/useAiVisibility";

import { AiFootprintDialog } from "@/components/common/AiFootprintDialog";

export type AiEntityKind = "person" | "note" | "moment" | "collection_item" | "action_item";

const kindToTable: Record<Exclude<AiEntityKind, "person">, AiKind> = {
  note: "notes",
  moment: "moments",
  collection_item: "collection_items",
  action_item: "action_items",
};

// While the save runs the switch does not stop being focusable: an HTML-disabled button drops
// keyboard focus to the page body when the change starts, and the next Tab began again from the
// top (#864). It keeps focus, is marked `aria-disabled` for assistive technology, does nothing
// until the save settles, and looks disabled through that state.
const CONFIRMATION_MS = 4000;

type Confirmation = { text: string; failed: boolean };

interface Props {
  kind: AiEntityKind;
  id: string;
  hidden: boolean;
  className?: string;
  /** Render as icon-only (no label). Defaults to false. */
  iconOnly?: boolean;
}

/**
 * Unified visibility toggle for any AI-touched entity.
 *  - Eye + "Shown to AI"       = visible to AI (People, AI Chat, MCP)
 *  - EyeOff + "Hidden from AI" = hidden from all AI surfaces
 * Its label says the state and its name the click's effect too: a bare "AI"
 * read like an AI action (#809). Its tooltip keeps main's explanation of
 * what a click does - for a person that the hide spreads to the linked
 * notes and moments - carried now as a `title`, one tooltip like its
 * neighbours have (#890).
 *
 * For `kind="person"` this flips `is_sensitive` (which also cascades to
 * linked notes/moments/actions). For all other kinds it flips
 * `ai_visibility` on the row itself.
 *
 * What a click did shows in a small note just above the switch, not as a page
 * toast: in some layout or other every corner of the page lies over the open
 * note (its toolbar at the top right #809, its save status at the bottom
 * #819, its Backlinks and Comments rows at the bottom left #831). The note
 * keeps a gap from the switch on its top side, so it ends above the toolbar
 * the switch sits in and covers none of the note.
 */
export function AiVisibilityButton({ kind, id, hidden, className, iconOnly = false }: Props) {
  const togglePerson = useToggleSensitivePerson();
  const toggleItem = useToggleAiVisibility(
    kind === "person" ? "contacts" : kindToTable[kind],
  );

  const [optimistic, setOptimistic] = useState(hidden);
  const [footprintOpen, setFootprintOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  useEffect(() => setOptimistic(hidden), [hidden]);
  useEffect(() => {
    if (!confirmation) return;
    const timer = setTimeout(() => setConfirmation(null), CONFIRMATION_MS);
    return () => clearTimeout(timer);
  }, [confirmation]);

  const failed = (e: any, fallback: string) => {
    setOptimistic(hidden);
    setConfirmation({ text: e?.message ?? fallback, failed: true });
  };

  const pending = kind === "person" ? togglePerson.isPending : toggleItem.isPending;

  const onClick = () => {
    if (pending) return;
    const next = !optimistic;
    setOptimistic(next);
    if (kind === "person") {
      togglePerson.mutate(
        { id, isSensitive: next },
        {
          onError: (e) => failed(e, "Failed to update sensitive flag"),
          onSuccess: () =>
            setConfirmation({
              text: next
                ? "Marked sensitive - hidden from all AI features"
                : "No longer sensitive - visible to AI again",
              failed: false,
            }),
        },
      );
    } else {
      toggleItem.mutate(
        { id, visibility: next ? "hidden" : "visible" },
        {
          onError: (e) => failed(e, "Failed to update AI visibility"),
          onSuccess: async () => {
            setConfirmation({
              text: next
                ? "Hidden from AI - excluded from People, Graph, AI Chat & MCP"
                : "Visible to AI again",
              failed: false,
            });
            if (next && kind === "note") {
              try {
                const fp = await fetchAiFootprint(id);
                const total =
                  fp.profileEntries.length +
                  fp.connections.length;
                if (total > 0) setFootprintOpen(true);
              } catch {
                // Silent: if the footprint check fails, skip the dialog
                // rather than showing a misleading "nothing to clean up".
              }
            }
          },
        },
      );
    }
  };

  // The hover's explanation, restored from main: before the click it says
  // what hiding means - for a person that the hide spreads to their linked
  // notes and moments, for anything else where the item still appears and
  // that local search still finds it (#890, loop review of 6e2572e97).
  const tooltip = optimistic
    ? kind === "person"
      ? "Hidden from AI. Linked notes & moments are hidden too. Click to make visible."
      : "Hidden from AI: excluded from People, the Note Graph, AI Chat and MCP. Local search still finds it. Click to make visible."
    : kind === "person"
      ? "Visible to AI. Click to hide this person and everything linked to them from all AI features."
      : "Visible to AI: used in People profiles, the Note Graph, AI Chat, and MCP clients. Click to hide.";

  const Icon = pending ? Loader2 : optimistic ? EyeOff : Eye;
  const label = optimistic ? "Hidden from AI" : "Shown to AI";
  const action = optimistic ? "Show to AI again" : "Hide from AI";

  return (
    <PopoverPrimitive.Root
      open={confirmation !== null}
      onOpenChange={(open) => { if (!open) setConfirmation(null); }}
    >
      <PopoverPrimitive.Anchor asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onClick}
          aria-disabled={pending}
          aria-busy={pending}
          title={tooltip}
          aria-label={`${label}. ${action}`}
          className={cn(
            "h-7 gap-1.5 px-2 text-xs font-normal aria-disabled:opacity-50 aria-disabled:pointer-events-none",
            optimistic
              ? "text-muted-foreground border-dashed"
              : "text-foreground",
            className,
          )}
        >
          <Icon className={cn("h-3.5 w-3.5", pending && "animate-spin")} />
          {!iconOnly && <span>{label}</span>}
        </Button>
      </PopoverPrimitive.Anchor>
      <PopoverPrimitive.Portal>
        {/* Above the switch, its right edge at the switch's, 10px clear of
            it: the toolbar the switch sits in starts 6px above the button. It
            takes no focus, so a click goes on with the note. */}
        <PopoverPrimitive.Content
          side="top"
          align="end"
          sideOffset={10}
          collisionPadding={8}
          role="status"
          aria-live="polite"
          data-ai-switch-confirmation=""
          onOpenAutoFocus={(e) => e.preventDefault()}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className={cn(
            "z-50 max-w-[calc(100vw-16px)] rounded-md border bg-popover px-2 py-1 text-xs shadow-md outline-none",
            confirmation?.failed ? "border-destructive text-destructive" : "text-popover-foreground",
          )}
        >
          {confirmation?.text}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
      {kind === "note" && (
        <AiFootprintDialog
          noteId={id}
          open={footprintOpen}
          onOpenChange={setFootprintOpen}
        />
      )}
    </PopoverPrimitive.Root>
  );
}
