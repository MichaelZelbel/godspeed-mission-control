import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface GraphNode {
  id: string;
  title: string;
  type: string;
  topics: string[];
  tags: string[];
  created_at: string;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  strength: number;
  metadata: Record<string, unknown>;
}

export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphDataOptions {
  limit?: number;
  min_strength?: number;
  connection_types?: string[];
  note_type?: string;
  topic?: string;
  person?: string;
  include_hidden?: boolean;
  /** Include notes mirrored from a mission control folder; left out by default. */
  include_godspeed?: boolean;
}

/**
 * What the Note Graph screen asks for first. Its side panels (bridge notes,
 * clusters) ask with the same options, so the screen makes one request.
 */
export const DEFAULT_GRAPH_OPTIONS: GraphDataOptions = { limit: 200, include_hidden: false, include_godspeed: false };

/**
 * The query for the full graph, shared by the hook and by callers that need
 * the graph once on demand (queryClient.fetchQuery), such as the export.
 */
export function graphDataQuery(userId: string | undefined, options?: GraphDataOptions) {
  return {
    queryKey: ["graph-data", userId, options] as const,
    queryFn: async (): Promise<GraphData> => {
      const res = await supabase.functions.invoke("get-graph-data", {
        body: options || {},
      });
      if (res.error) throw res.error;
      return res.data as GraphData;
    },
    staleTime: 60_000,
  };
}

/** Fetch the full knowledge graph for the current user */
export function useGraphData(options?: GraphDataOptions) {
  const { user } = useAuth();

  return useQuery<GraphData>({
    ...graphDataQuery(user?.id, options),
    enabled: !!user,
  });
}

/** Fetch neighborhood graph around a specific note */
export function useNoteNeighborhood(noteId: string | null, hops = 2) {
  const { user } = useAuth();

  return useQuery<GraphData>({
    queryKey: ["note-neighborhood", noteId, hops, user?.id],
    enabled: !!user && !!noteId,
    queryFn: async () => {
      const res = await supabase.functions.invoke("get-graph-data", {
        body: { note_id: noteId, hops },
      });
      if (res.error) throw res.error;
      return res.data as GraphData;
    },
    staleTime: 60_000,
  });
}
