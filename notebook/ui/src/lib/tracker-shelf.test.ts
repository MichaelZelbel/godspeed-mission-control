import { describe, expect, it } from "vitest";
import { lastEntryDays, shelve } from "./tracker-shelf";

describe("shelve", () => {
  const now = new Date("2026-10-11T12:00:00Z");
  const belly = { id: "b", name: "Belly", created_at: "2026-10-02T08:00:00Z", tracker: { names: ["Belly"] } };
  const sauna = { id: "s", name: "Sauna", created_at: "2026-08-01T08:00:00Z", tracker: { names: ["Sauna"] } };
  const fresh = { id: "n", name: "Sleep", created_at: "2026-10-10T08:00:00Z", tracker: { names: ["Sleep"] } };
  const films = { id: "f", name: "Movies & TV", created_at: "2026-01-01T08:00:00Z" };
  it("puts trackers on their own shelf and folds the resting ones away", () => {
    const out = shelve([belly, sauna, films, fresh], { b: "2026-10-09", s: "2026-08-20" }, now);
    expect(out.trackers.map((c) => c.id)).toEqual(["b", "n"]);
    expect(out.resting.map((c) => c.id)).toEqual(["s"]);
    expect(out.others.map((c) => c.id)).toEqual(["f"]);
  });
  it("reads the latest day of each tracker's entries, whatever their order", () => {
    expect(lastEntryDays([
      { collection_id: "b", data: { when: "2026-10-05" } },
      { collection_id: "b", data: { when: "2026-10-09" } },
      { collection_id: "b", data: { when: "2026-10-02" } },
      { collection_id: "s", data: { when: "2026-08-20 19:00" } },
      { collection_id: "s", data: null },
    ])).toEqual({ b: "2026-10-09", s: "2026-08-20 19:00" });
  });
});
