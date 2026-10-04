import {supabase} from "@/integrations/supabase/client";
import {runReviewOperation} from "@/lib/review-operation.mjs";

export interface RevertableItem {
  id?: string;
  target_entity_id: string | null;
  target_entity_type: string | null;
  applied_at?: string | null;
  payload: Record<string, any> | null;
}
export function itemWroteFact(item: RevertableItem): boolean {
  return !!item.target_entity_id && (["claim", "claims"].includes(item.target_entity_type || "") || !!item.applied_at);
}
export class FactNotRevertible extends Error {}
const NOT_REVERTIBLE="This fact cannot be undone: it was merged with another fact or has changed since. Edit it on the profile instead.";
export function factRevertBlockReason(item: RevertableItem): string | null {
  if(!item.target_entity_id)return null;
  const info=item.payload?.fact_store_switch || {};
  if(info.revertible===false || info.entry_missing===true)return NOT_REVERTIBLE;
  return ["claim", "claims"].includes(item.target_entity_type || "") ? null : NOT_REVERTIBLE;
}
export function itemClaimIds(item: RevertableItem): string[] {
  const extra=Array.isArray(item.payload?.claim_ids)?item.payload!.claim_ids.map(String):[];
  return [...new Set([item.target_entity_id,...extra].filter((id): id is string=>!!id))];
}
// The server validates the complete receipt and all current hashes before Undo.
// The browser never deletes claims or recreates only part of their prior state.
export async function revertFactItem(item: RevertableItem): Promise<void> {
  if(!item.id)throw new FactNotRevertible("This change has no review receipt. Correct it on the profile instead.");
  await runReviewOperation(supabase,"rollback",[item.id]);
}
