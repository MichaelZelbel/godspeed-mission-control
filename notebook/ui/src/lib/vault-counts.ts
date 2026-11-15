// What the Notes page's vault panel counts: topics, people and types from each note's metadata,
// and the notes Classify would still take. A note marked skip_processing (an add-on's note, its
// summary already in it) is never classified (notebook/core/processing.mjs), so it is not counted.
export interface VaultNote {
  metadata?: unknown;
  skip_processing?: boolean | null;
}

export function vaultCounts(allNotes: VaultNote[]) {
  const topics: Record<string, number> = {};
  const people: Record<string, number> = {};
  const types: Record<string, number> = {};
  let unclassified = 0;
  for (const note of allNotes) {
    const meta = note.metadata as Record<string, unknown> | null;
    if (!meta || !meta.type) { if (note.skip_processing !== true) unclassified++; continue; }
    if (Array.isArray(meta.topics)) for (const t of meta.topics as string[]) topics[t] = (topics[t] || 0) + 1;
    // Normalize people names: use canonical_name from matched_people when available
    const matchedMap = new Map<string, string>();
    if (Array.isArray(meta.matched_people)) {
      for (const m of meta.matched_people as Array<{ name: string; canonical_name: string }>) {
        matchedMap.set(m.name.toLowerCase(), m.canonical_name);
      }
    }
    if (Array.isArray(meta.people)) {
      for (const p of meta.people as string[]) {
        const canonical = matchedMap.get(p.toLowerCase()) || p;
        people[canonical] = (people[canonical] || 0) + 1;
      }
    }
    if (typeof meta.type === "string") types[meta.type] = (types[meta.type] || 0) + 1;
  }
  return {
    topicCounts: Object.entries(topics).sort((a, b) => b[1] - a[1]),
    peopleCounts: Object.entries(people).sort((a, b) => b[1] - a[1]),
    typeCounts: Object.entries(types).sort((a, b) => b[1] - a[1]),
    unclassifiedCount: unclassified,
  };
}
