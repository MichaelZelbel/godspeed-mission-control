import { describe, expect, it } from "vitest";
import { habitDays, habitShelf, lastEntryDays, shelve } from "./tracker-shelf";

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

// Habits are trackers made from the coach's own files (D-321, step 3): tracker-list gives them
// with specialist "habit". An active habit is on the shelf; a paused, graduated or dropped one rests.
describe("habitShelf", () => {
  const listed = [
    { id: "habit-health-walk-to-work", name: "Walk to work and back", specialist: "habit", status: "active" },
    { id: "habit-health-head-lifts", name: "Neck work with the band", specialist: "habit", status: "resting", habit_status: "paused" },
    { id: "belly-1", name: "Belly", specialist: null, status: "active" },
    { id: "headaches-1", name: "Headaches", specialist: "headache", status: "active" },
  ];
  it("puts active habits on the shelf and the others in Resting, and leaves collections to shelve", () => {
    const out = habitShelf(listed);
    expect(out.active.map((h) => h.id)).toEqual(["habit-health-walk-to-work"]);
    expect(out.resting.map((h) => h.id)).toEqual(["habit-health-head-lifts"]);
  });
  it("lists a habit's days newest first, each with its answer", () => {
    expect(habitDays({ recent: [
      { when: "2026-10-06", data: { answer: "done", note: "steps 9513" } },
      { when: "2026-10-08", data: { answer: "skip" } },
    ] })).toEqual([
      { day: "2026-10-08", answer: "skip", note: "" },
      { day: "2026-10-06", answer: "done", note: "steps 9513" },
    ]);
    expect(habitDays({})).toEqual([]);
  });
});
