import { useQuery } from "@tanstack/react-query";

export type MediaPresence = "present" | "kept_elsewhere" | "removed" | "unavailable";

export async function loadMediaPresence(paths: string[], signal?: AbortSignal): Promise<Record<string, MediaPresence>> {
  if (paths.length === 0) return {};
  const response = await fetch("/api/media/presence", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paths }),
    signal,
  });
  if (!response.ok) throw new Error(`Media presence answered ${response.status}`);
  const result: { data: Record<string, MediaPresence> } = await response.json();
  return result.data;
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
