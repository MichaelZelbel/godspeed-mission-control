import { test } from "node:test";
import assert from "node:assert/strict";
import { rowData, setText, durationText, same, fieldsFor, trackerShape, OWNED } from "../lib/rows.mjs";
import { DEFAULTS } from "../lib/settings.mjs";
import { checkWorkout } from "../lib/hevy.mjs";

// The shape Hevy answers, with a made-up workout in it.
const upperBody = {
  id: "00000000-0000-4000-8000-000000000001", title: "Upper body", routine_id: "00000000-0000-4000-8000-0000000000aa", description: "",
  start_time: "2026-03-14T17:05:48+00:00", end_time: "2026-03-14T17:55:55+00:00",
  updated_at: "2026-03-14T17:55:57.762Z", created_at: "2026-03-14T17:55:57.762Z",
  exercises: [
    { index: 0, title: "Bench press", notes: null, exercise_template_id: "a", superset_id: null, sets: [{ index: 0, type: "normal", weight_kg: 60, reps: 8, distance_meters: null, duration_seconds: null, rpe: null, custom_metric: null }] },
    { index: 1, title: "Row", notes: null, exercise_template_id: "b", superset_id: null, sets: [{ index: 0, type: "normal", weight_kg: 50, reps: 10, distance_meters: null, duration_seconds: null, rpe: null, custom_metric: null }] },
  ],
};

test("a workout becomes one row: the wall clock in the person's zone, every set as reps x kg", () => {
  checkWorkout(upperBody);
  assert.deepEqual(rowData(upperBody, { tz: "Europe/Berlin", units: { weight: "kg", distance: "km" } }), {
    when: "2026-03-14 18:05",
    workout: "Upper body",
    end: "2026-03-14 18:55",
    minutes: 50,
    exercises: "Bench press: 8 x 60 kg\nRow: 10 x 50 kg",
    sets: 2,
    volume: 980,
  });
});

test("sets: warm-ups, drop sets, failure, RPE, bodyweight, time, distance, assisted, nothing", () => {
  const s = (o) => ({ index: 0, type: "normal", weight_kg: null, reps: null, distance_meters: null, duration_seconds: null, rpe: null, custom_metric: null, ...o });
  assert.equal(setText(s({ reps: 8, weight_kg: 62.5, rpe: 8 })), "8 x 62.5 kg (RPE 8)");
  assert.equal(setText(s({ type: "warmup", reps: 12, weight_kg: 40 })), "warm-up 12 x 40 kg");
  assert.equal(setText(s({ type: "dropset", reps: 6, weight_kg: 50, rpe: 9.5 })), "6 x 50 kg (drop set, RPE 9.5)");
  assert.equal(setText(s({ type: "failure", reps: 15 })), "15 reps (to failure)");
  assert.equal(setText(s({ reps: 1, weight_kg: 140 })), "1 x 140 kg");
  assert.equal(setText(s({ reps: 1 })), "1 rep");
  assert.equal(setText(s({ duration_seconds: 60 })), "1:00 min");
  assert.equal(setText(s({ duration_seconds: 45, weight_kg: 10 })), "10 kg for 45 s");
  assert.equal(setText(s({ distance_meters: 5000, duration_seconds: 1500 })), "5 km in 25:00 min");
  assert.equal(setText(s({ distance_meters: 400 })), "400 m");
  assert.equal(setText(s({ reps: 8, weight_kg: -20 })), "8 x -20 kg");
  assert.equal(setText(s({ custom_metric: 50, duration_seconds: 600 })), "10:00 min (50 floors or steps)");
  assert.equal(setText(s({})), "nothing logged");
  assert.equal(setText(s({ reps: 10, weight_kg: 61.234960 }), { weight: "lb" }), "10 x 135 lb");
  assert.equal(durationText(3723), "1:02:03 h");
});

test("exercises keep Hevy's order; supersets are numbered; notes follow; volume leaves warm-ups out", () => {
  const w = {
    ...upperBody, description: "Felt strong.\nSlept well.",
    exercises: [
      { index: 1, title: "Row", notes: "slow\n eccentric", superset_id: 7, sets: [{ index: 0, type: "normal", weight_kg: 50, reps: 10 }] },
      { index: 0, title: "Bench Press (Barbell)", notes: null, superset_id: 7, sets: [{ index: 1, type: "normal", weight_kg: 60, reps: 10 }, { index: 0, type: "warmup", weight_kg: 40, reps: 12 }] },
      { index: 2, title: "Plank", notes: null, superset_id: null, sets: [] },
    ],
  };
  const r = rowData(w, { tz: "UTC" });
  assert.equal(r.exercises, "Bench Press (Barbell) (superset 1): warm-up 12 x 40 kg, 10 x 60 kg\nRow (superset 1): 10 x 50 kg. Note: slow eccentric\nPlank: no sets");
  assert.equal(r.sets, 3);
  assert.equal(r.volume, 1100);
  assert.equal(r.notes, "Felt strong.\nSlept well.");
  assert.equal(r.when, "2026-03-14 17:05");
});

test("a workout with no end has no end and no minutes; no title is 'Workout'", () => {
  const r = rowData({ ...upperBody, title: "", end_time: null }, { tz: "UTC" });
  assert.equal(r.end, undefined);
  assert.equal(r.minutes, undefined);
  assert.equal(r.workout, "Workout");
});

test("cells compare the way the notebook's table writes them", () => {
  assert.ok(same("2026-03-14 18:05", "2026-03-14T18:05"));
  assert.ok(same(10, "10"));
  assert.ok(same(undefined, ""));
  assert.ok(!same("Upper body", "Upper day"));
  assert.ok(same("a\r\nb", "a\nb"));
});

test("the tracker: a collection with a tracker card, 'when' first and primary, the person's column last", () => {
  const t = trackerShape(DEFAULTS, { talks: ["health"], units: { weight: "lb" } });
  assert.equal(t.name, "Workouts");
  assert.deepEqual(t.tracker, { names: ["Workouts", "Workout", "Training", "Hevy"], cadence: "any", talks: ["health"], specialist: "workouts" });
  assert.equal(t.field_schema[0].key, "when");
  assert.equal(t.field_schema[0].primary, true);
  assert.equal(t.field_schema.find((f) => f.key === "volume").unit, "lb");
  assert.ok(!OWNED.includes("comment"));
  assert.deepEqual(fieldsFor().map((f) => f.key), [...OWNED.slice(0, 7), "notes", "comment"]);
});
