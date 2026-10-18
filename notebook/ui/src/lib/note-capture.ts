import { supabase } from "@/integrations/supabase/client";
import type { Json } from "@/integrations/supabase/types";

/** Saves a new note in one authenticated request. */
export async function captureNote(note: Record<string, unknown>, authorization?: string): Promise<unknown> {
  const request = supabase.rpc("capture_note" as never, {
    _note: note as Json,
  } as never);
  // Offline uploads must retain the identity checked before constructing the
  // request, even if global auth switches before the request starts.
  const { data, error } = await (authorization ? request.setHeader("Authorization", authorization) : request);
  if (error) throw error;
  return data;
}
