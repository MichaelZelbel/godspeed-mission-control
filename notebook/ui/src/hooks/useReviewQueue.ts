import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

// Suggestions still waiting for a decision: the queue's list, its count and the sidebar badge.
const WAITING_STATUSES = ["pending", "pending_review", "auto_applied_unreviewed"];

export interface ReviewItem {
  id: string;
  user_id: string;
  source_note_id: string | null;
  target_entity_type: string | null;
  target_entity_id: string | null;
  source_title: string | null;
  extracted_value: string | null;
  confidence_score: number | null;
  is_sensitive: boolean;
  applied_at: string | null;
  blocked_at: string | null;
  suppression_key: string | null;
  suggestion_type: string;
  title: string;
  description: string | null;
  payload: Record<string, any>;
  status: string;
  created_at: string;
  reviewed_at: string | null;
  source_note?: { title: string } | null;
}

/**
 * @param contactId Only the suggestions about one person (a person page's
 * "N pending profile suggestions" link). Filtered in the database: filtering
 * the 500 newest rows in the page found nothing for a person whose
 * suggestions were older, while the badge that led there counted them.
 * @param view "waiting" is what the sidebar counts; "kept" lists earlier Keeps,
 * newest first, so one can still be rolled back without crowding the queue.
 */
export function useReviewQueue(contactId: string | null = null, view: "waiting" | "kept" = "waiting") {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["review-queue", user?.id, contactId ?? "all", view],
    queryFn: async () => {
      // Only fetch the columns a card actually renders, and cap at 500 rows.
      // The full count is served by the separate head:true query below.
      let query = supabase
        .from("review_queue" as any)
        .select("id,user_id,suggestion_type,target_entity_id,target_entity_type,applied_at,source_note_id,suppression_key,extracted_value,is_sensitive,title,description,payload,status,created_at,reviewed_at,confidence_score,blocked_at, source_note:notes!review_queue_source_note_id_fkey(title)")
        .in("status", view === "kept" ? ["kept"] : WAITING_STATUSES)
        .or(`snoozed_until.is.null,snoozed_until.lte.${new Date().toISOString()}`);
      if (contactId) query = query.contains("payload", { contact_id: contactId });
      const { data, error } = await query.order(view === "kept" ? "applied_at" : "created_at", { ascending: false }).range(0, 499);
      if (error) throw error;
      return (data || []) as unknown as ReviewItem[];
    },
    enabled: !!user,
    // No polling on the heavy list - the count badge below refreshes instead.
    staleTime: 30_000,
  });

  const updateStatus = useMutation({
    mutationFn: async ({ id, status, extra }: { id: string; status: "kept" | "removed" | "blocked" | "pending_review" | "auto_applied_unreviewed"; extra?: Record<string, unknown> }) => {
      const { error } = await supabase
        .from("review_queue" as any)
        .update({ status, reviewed_at: new Date().toISOString(), ...extra } as any)
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["review-queue"] });
      queryClient.invalidateQueries({ queryKey: ["review-queue-count"] });
    },
  });

  const pendingCount = useReviewQueueCount();

  return {
    items,
    isLoading,
    pendingCount,
    updateStatus,
  };
}

/**
 * The badge number only: one head:true count, polled once a minute.
 *
 * The sidebar is mounted on every signed-in page. It used to call
 * useReviewQueue() for this number, which also fetched up to 500 queue rows
 * with their payloads on every mount. Those only matter on the Review Queue page.
 */
export function useReviewQueueCount(): number {
  const { user } = useAuth();

  const { data: pendingCount = 0 } = useQuery({
    queryKey: ["review-queue-count", user?.id],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("review_queue" as any)
        .select("id", { count: "exact", head: true })
        .in("status", WAITING_STATUSES)
        .or(`snoozed_until.is.null,snoozed_until.lte.${new Date().toISOString()}`);
      if (error) throw error;
      return count || 0;
    },
    enabled: !!user,
    refetchInterval: 60_000,
  });

  return pendingCount;
}
