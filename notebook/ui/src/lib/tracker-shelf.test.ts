import { describe, expect, it } from "vitest";
import { charmCardText, charmShelf, habitDays, habitShelf, lastEntryDays, shelve, talksLabel, type CharmState } from "./tracker-shelf";

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

// The Charm Challenge has its own card (spec 2026-10-21): never a plain tracker card, never a habit;
// while it runs it is on the shelf whatever its last row's day, and a stopped or finished one rests.
describe("charmShelf", () => {
  const now = new Date("2026-12-20T12:00:00Z");
  const state = (over: Partial<CharmState>): CharmState => ({ running: true, started: "2026-10-21", end: "2026-11-11", day: 10, daysToGo: 12, restarts: 0, longestRun: 9, kept: 0, needsFinish: false, finishedOn: null, ...over });
  const charm = { id: "charm-challenge-1", name: "Charm Challenge", created_at: "2026-10-21T08:00:00Z", tracker: { names: ["Charm Challenge"], specialist: "charm" } };
  const belly = { id: "b", name: "Belly", created_at: "2026-12-01T08:00:00Z", tracker: { names: ["Belly"] } };
  const lastWhen = { "charm-challenge-1": "2026-10-21T08:00:00.000Z", b: "2026-12-19" };
  it("keeps the charm tracker out of the plain tracker cards", () => {
    const out = shelve([charm, belly], lastWhen, now);
    expect(out.trackers.map((c) => c.id)).toEqual(["b"]);
    expect([...out.resting, ...out.others]).toEqual([]);
  });
  it("never rests a running challenge, even 60 days after its last row", () => {
    const out = charmShelf([charm, belly], [{ id: charm.id, specialist: "charm", charm: state({ needsFinish: true, daysToGo: 0 }), brief: "x" }], lastWhen, now);
    expect(out.active.map((c) => c.collection.id)).toEqual([charm.id]);
    expect(out.active[0].brief).toBe("x");
    expect(out.resting).toEqual([]);
  });
  it("rests a stopped or finished one after 30 days, and keeps it on the shelf before that", () => {
    const stopped = [{ id: charm.id, specialist: "charm", charm: state({ running: false }) }];
    expect(charmShelf([charm], stopped, lastWhen, now).resting.map((c) => c.collection.id)).toEqual([charm.id]);
    expect(charmShelf([charm], stopped, lastWhen, new Date("2026-11-01T12:00:00Z")).active.map((c) => c.collection.id)).toEqual([charm.id]);
  });
  it("folds nothing away on a guess: no count, or no entry days, keeps it on the shelf", () => {
    expect(charmShelf([charm], [], lastWhen, now).active).toEqual([{ collection: charm, charm: null, brief: null }]);
    expect(charmShelf([charm], [{ id: charm.id, specialist: "charm", charm: state({ running: false }) }], null, now).active.length).toBe(1);
  });
});

describe("charmCardText", () => {
  const state = (over: Partial<CharmState>): CharmState => ({ running: true, started: "2026-10-21", end: "2026-11-11", day: 10, daysToGo: 12, restarts: 2, longestRun: 9, kept: 3, needsFinish: false, finishedOn: null, ...over });
  it("says the days to go, the end date and the record, as the add-on says them", () => {
    expect(charmCardText(state({}))).toEqual({
      big: "12", unit: "days to go", spoken: "12 days to go, done on Wednesday 11 November.", after: "done on Wednesday 11 November",
      stats: { shown: "Restarts: 2 · Longest run: 9 days", spoken: "Restarts: 2. Longest run: 9 days." }, hint: null,
    });
  });
  it("uses the singular for one", () => {
    const one = charmCardText(state({ daysToGo: 1, day: 21, restarts: 1, longestRun: 1 }));
    expect([one.big, one.unit, one.stats?.shown]).toEqual(["1", "day to go", "Restarts: 1 · Longest run: 1 day"]);
  });
  it("says Done on the finish day and after the finish, never 0 days to go", () => {
    for (const s of [state({ needsFinish: true, daysToGo: 0, day: 21 }), state({ running: false, daysToGo: null, day: null, finishedOn: "2026-11-12", longestRun: 21 })]) {
      const t = charmCardText(s);
      expect([t.big, t.unit, t.after, t.spoken, t.hint]).toEqual(["Done", "", "on Wednesday 11 November", "Done: 21 days, finished on Wednesday 11 November.", null]);
    }
  });
  it("says Not running, with what to say, when stopped or never started, and plainly when unreadable", () => {
    const stopped = charmCardText(state({ running: false, daysToGo: null, day: null }));
    expect([stopped.big, stopped.quiet, stopped.hint, stopped.stats?.shown]).toEqual(["Not running", true, 'Say "start the Charm Challenge" to begin.', "Restarts: 2 · Longest run: 9 days"]);
    const never = charmCardText(state({ running: false, started: null, end: null, daysToGo: null, day: null, restarts: 0, longestRun: 0 }));
    expect([never.big, never.stats]).toEqual(["Not running", null]);
    expect(charmCardText(null)).toMatchObject({ big: null, after: "The count could not be read right now." });
  });
  it("has no long dashes in anything it says", () => {
    const all = [state({}), state({ needsFinish: true, daysToGo: 0 }), state({ running: false }), null].map((s) => JSON.stringify(charmCardText(s))).join(" ");
    expect(all).not.toMatch(new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]"));
  });
});

// Any number of talks may read a tracker (13 October 2026): the shelf names them all, in plain words.
describe("talksLabel", () => {
  it("names one talk, two talks and three talks naturally, and an older single talk too", () => {
    expect(talksLabel({ talks: ["health"] })).toBe("health talk");
    expect(talksLabel({ talks: ["health", "psychology"] })).toBe("health and psychology talks");
    expect(talksLabel({ talks: ["health", "psychology", "deep-sleep"] })).toBe("health, psychology and deep sleep talks");
    expect(talksLabel({ talks: ["work-money"] })).toBe("work and money talk");
    expect(talksLabel({ talk: "health" })).toBe("health talk");
    expect(talksLabel({ talks: [] })).toBe("");
    expect(talksLabel({})).toBe("");
  });
});
