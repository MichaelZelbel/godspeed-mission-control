import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useAICredits } from "@/hooks/useAICredits";
import { showToast } from "@/lib/toast";
import { functionErrorMessage } from "@/lib/function-error";
import { triggerCreditsRefresh } from "@/lib/credits-events";
import { AI_CONNECTION_UNREADABLE_STATUS, AI_REFUSED, AI_STALLED_STATUS, AI_UNREACHABLE, NO_AI_ANALYSIS } from "../../../../core/no-ai.mjs";

type SuggestMembersResult = {
  suggestions_added: number;
  auto_applied?: number;
  structured_import?: { source_note?: { title?: string | null }; parsed_rows?: number; created_contacts?: number; imported_members?: number; updated_members?: number };
};

export function SuggestMembersButton({ groupId }: { groupId: string }) {
  const qc = useQueryClient();
  const { providerConfigured, aiAvailability } = useAICredits();
  const suggestMembers = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke<SuggestMembersResult>("suggest-group-members", { body: { group_id: groupId } });
      if (error) throw new Error(await functionErrorMessage(error, "Could not suggest members."));
      return data || { suggestions_added: 0, auto_applied: 0 };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["review-queue"] });
      qc.invalidateQueries({ queryKey: ["review-queue-count"] });
      qc.invalidateQueries({ queryKey: ["contact_group_memberships", groupId] });
      qc.invalidateQueries({ queryKey: ["contact_groups"] });
      triggerCreditsRefresh();
      if (result.structured_import) {
        const imported = result.structured_import.imported_members || 0;
        const updated = result.structured_import.updated_members || 0;
        showToast.success(`${imported} member${imported === 1 ? "" : "s"} imported${updated > 0 ? ` · ${updated} updated` : ""}`);
        return;
      }
      const added = result.suggestions_added - (result.auto_applied || 0);
      if (result.auto_applied) showToast.success(`${result.auto_applied} member${result.auto_applied === 1 ? "" : "s"} added${added > 0 ? ` · ${added} in Review Queue` : ""}`);
      else showToast.success(`${result.suggestions_added} suggestion${result.suggestions_added === 1 ? "" : "s"} added to Review Queue`);
    },
    onError: (error: Error) => showToast.error(error.message || "Could not suggest members"),
  });

  // #834: while the button sits disabled because the AI is not working, it says why beside itself,
  // in the words the other AI actions use for the same states (core/no-ai.mjs): a refused key, an
  // outage, an AI that is not answering, or no AI connected. With a working AI nothing is added.
  const reason = providerConfigured || suggestMembers.isPending ? null :
    aiAvailability === "refused" ? AI_REFUSED :
    aiAvailability === "unreachable" ? AI_UNREACHABLE :
    aiAvailability === "stalled" ? `${AI_STALLED_STATUS}. Try again in a moment, or check it in Settings, Your AI.` :
    aiAvailability === "unreadable" ? AI_CONNECTION_UNREADABLE_STATUS :
    aiAvailability === "none" ? NO_AI_ANALYSIS : null;

  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1">
      {reason && (
        <p role="status" className="text-sm text-muted-foreground text-right">
          {reason}{" "}
          <Link to="/dashboard/settings#connect-ai" className="underline text-primary">Open Settings, Your AI</Link>
        </p>
      )}
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => suggestMembers.mutate()} disabled={suggestMembers.isPending || !providerConfigured}>
        {suggestMembers.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} AI Match Members
      </Button>
    </div>
  );
}
