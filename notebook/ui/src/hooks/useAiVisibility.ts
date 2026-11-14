import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { showToast } from "@/lib/toast";

export type AiVisibility = "visible" | "hidden";
export type AiKind = "notes" | "contacts" | "moments" | "collection_items" | "action_items";

/**
 * Toggle whether an item is visible to AI pipelines.
 *
 * When `hidden`:
 *  - The item is excluded from all MCP tool responses.
 *  - It does NOT contribute to People profile enrichment.
 *  - It is not drawn in the Note Graph unless asked.
 *  - It is not used as context by the in-app AI chat or daily digest.
 *  - Embeddings ARE still generated so the user can find the note via local
 *    semantic / keyword search - only AI-facing surfaces filter it out.
 */
export function useToggleAiVisibility(kind: AiKind) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: async ({ id, visibility }: { id: string; visibility: AiVisibility }) => {
      const { error } = await (supabase as any)
        .from(kind)
        .update({ ai_visibility: visibility })
        .eq("id", id);
      if (error) throw error;
      return { id, visibility };
    },
    onSuccess: ({ id, visibility }) => {
      qc.invalidateQueries({ queryKey: [kind] });
      qc.invalidateQueries({ queryKey: ["notes"] });
      // The open editor reads the single-row ["note", id] query, which the
      // ["notes"] prefix does not reach.
      if (kind === "notes") qc.invalidateQueries({ queryKey: ["note", id] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["ai_hidden_counts"] });
      // Hiding is one click on the note's toolbar, so it can be taken back from the toast (#573).
      if (visibility === "hidden")
        showToast.success("Hidden from AI - excluded from People, Graph, AI Chat & MCP", {
          action: { label: "Undo", onClick: () => mutation.mutate({ id, visibility: "visible" }) },
        });
      else showToast.success("Visible to AI again");
    },
    onError: (e: any) => {
      showToast.error(e.message ?? "Failed to update AI visibility");
    },
  });
  return mutation;
}

/**
 * Mark a contact (person) as sensitive. When sensitive:
 *  - The contact itself is redacted (only name/relationship exposed to AI)
 *  - All notes/moments/action_items linked to this person are automatically
 *    hidden from AI features, without needing per-item toggles.
 */
export function useToggleSensitivePerson() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: async ({ id, isSensitive }: { id: string; isSensitive: boolean }) => {
      const { error } = await (supabase as any)
        .from("contacts")
        .update({ is_sensitive: isSensitive })
        .eq("id", id);
      if (error) throw error;
      return { id, isSensitive };
    },
    onSuccess: ({ id, isSensitive }) => {
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["people"] });
      qc.invalidateQueries({ queryKey: ["ai_hidden_counts"] });
      if (isSensitive)
        showToast.success("Marked sensitive - hidden from all AI features", {
          action: { label: "Undo", onClick: () => mutation.mutate({ id, isSensitive: false }) },
        });
      else showToast.success("No longer sensitive - visible to AI again");
    },
    onError: (e: any) => {
      showToast.error(e.message ?? "Failed to update sensitive flag");
    },
  });
  return mutation;
}
