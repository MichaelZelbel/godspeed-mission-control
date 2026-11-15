import { describe, expect, it } from "vitest";
import { vaultCounts } from "./vault-counts";

// "Classify unclassified vault notes (N)" offers what Classify takes. A note an add-on wrote with
// skip_processing (one per scanned letter, its summary already in it) is never classified, so
// counting it kept the button up for ever, and pressing it classified nothing.
describe("vaultCounts", () => {
  it("counts types, topics and people from the metadata", () => {
    const counts = vaultCounts([
      { metadata: { type: "idea", topics: ["garden"], people: ["Ani"], matched_people: [{ name: "Ani", canonical_name: "Fictional Ana" }] } },
      { metadata: { type: "idea", topics: ["garden", "tools"] } },
    ]);
    expect(counts.typeCounts).toEqual([["idea", 2]]);
    expect(counts.topicCounts).toEqual([["garden", 2], ["tools", 1]]);
    expect(counts.peopleCounts).toEqual([["Fictional Ana", 1]]);
  });

  it("counts a note without a type as unclassified, unless it is marked skip_processing", () => {
    const counts = vaultCounts([
      { metadata: {} },
      { metadata: null },
      { metadata: {}, skip_processing: true } as never,
      { metadata: { type: "task" } },
    ]);
    expect(counts.unclassifiedCount).toBe(2);
  });
});
