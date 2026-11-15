import { useQuery } from "@tanstack/react-query";
import { z } from "zod";
import { MEDIA_PRESENCE_BATCH_SIZE } from "../../../shared/media-limits.mjs";

const mediaPresenceSchema = z.enum(["present", "kept_elsewhere", "removed", "unavailable"]);
const mediaPresenceResponseSchema = z.object({ data: z.record(z.string(), mediaPresenceSchema) });
export type MediaPresence = z.infer<typeof mediaPresenceSchema>;

export async function loadMediaPresence(paths: string[], signal?: AbortSignal): Promise<Record<string, MediaPresence>> {
  const uniquePaths = [...new Set(paths)];
  const batches = Array.from({ length: Math.ceil(uniquePaths.length / MEDIA_PRESENCE_BATCH_SIZE) }, (_, index) =>
    uniquePaths.slice(index * MEDIA_PRESENCE_BATCH_SIZE, (index + 1) * MEDIA_PRESENCE_BATCH_SIZE),
  );
  const results = await Promise.all(batches.map(async batch => {
    const response = await fetch("/api/media/presence", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ paths: batch }),
      signal,
    });
    if (!response.ok) throw new Error(`Media presence answered ${response.status}`);
    return mediaPresenceResponseSchema.parse(await response.json()).data;
  }));
  return Object.assign({}, ...results);
}

export function useMediaPresence(paths: string[]) {
  const key = [...new Set(paths)].sort();
  return useQuery({
    queryKey: ["media-presence", key],
    queryFn: ({ signal }) => loadMediaPresence(key, signal),
    enabled: key.length > 0,
    refetchInterval: (query) => Object.values(query.state.data || {}).some(value => value !== "present") ? 60_000 : false,
  });
}

export const keptElsewhereMessage = "This file is kept on another computer. Open it on the computer where it was added, or make it smaller so it can travel.";
