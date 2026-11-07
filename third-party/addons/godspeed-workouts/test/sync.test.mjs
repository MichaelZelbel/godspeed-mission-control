import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { world } from "./helpers.mjs";
import { workout } from "./fakes/hevy.mjs";

const bench = (start, extra = {}) => workout({ start, title: "Push day", exercises: [{ title: "Bench Press (Barbell)", sets: [{ reps: 10, kg: 60 }, { reps: 8, kg: 62.5, rpe: 8 }] }], ...extra });

test("backfill: every workout once, over several pages, one row each, keyed by Hevy's id", async () => {
  const w = await world();
  try {
    const ids = [];
    for (let i = 0; i < 23; i++) ids.push(w.hevy.add(bench(`2026-09-${String(1 + i).padStart(2, "0")}T17:00:00Z`)).id);
    const r = await w.run();
    assert.equal(r.ok, true, r.summary);
    assert.match(r.summary, /^backfill: 23 added/);
    const rows = w.nb.rows();
    assert.equal(rows.length, 23);
    assert.deepEqual(new Set(rows.map((x) => x.source_id)), new Set(ids));
    assert.ok(rows.every((x) => x.source_app === "godspeed-workouts"));
    const one = w.nb.row(ids[0]);
    assert.equal(one.data.when, "2026-09-01 19:00"); // Europe/Berlin, the notebook's zone
    assert.equal(one.data.exercises, "Bench Press (Barbell): 10 x 60 kg, 8 x 62.5 kg (RPE 8)");
    assert.equal(one.title, "2026-09-01 19:00");
    const t = w.nb.tracker();
    assert.deepEqual(t.tracker, { names: ["Workouts", "Workout", "Training", "Hevy"], cadence: "any", talks: [], specialist: "workouts" });
    // Pages of 10, never more (Hevy refuses a bigger page).
    assert.ok(w.hevy.calls.filter((c) => c.path === "/v1/workouts").every((c) => Number(c.query.pageSize) <= 10));
    assert.equal(w.hevy.calls.filter((c) => c.path === "/v1/workouts").length, 3);
    // A second run with nothing new in Hevy writes nothing.
    const before = w.nb.writes.length;
    w.now.hours(1);
    const again = await w.run();
    assert.match(again.summary, /^events: 0 added, 0 changed, 0 removed/);
    assert.equal(w.nb.writes.length, before);
    // An hour later there is no event at all since the last run: Hevy's own empty answer.
    w.now.hours(1);
    const quiet = await w.run();
    assert.equal(quiet.ok, true, quiet.summary);
    assert.equal(w.hevy.calls.at(-1).path, "/v1/workouts/events");
    assert.equal(w.nb.writes.length, before);
    assert.deepEqual(w.told, []);
  } finally { await w.close(); }
});

test("an edit in Hevy arrives through the events and changes the row; a delete in Hevy removes it", async () => {
  const w = await world();
  try {
    const a = w.hevy.add(bench("2026-10-20T16:00:00Z"));
    const b = w.hevy.add(bench("2026-10-21T16:00:00Z", { title: "Leg day" }));
    await w.run();
    assert.equal(w.nb.rows().length, 2);
    const cursor1 = w.state().cursor;

    w.now.hours(1);
    w.hevy.edit(a.id, { title: "Push day, heavy", exercises: [{ index: 0, title: "Bench Press (Barbell)", notes: null, superset_id: null, sets: [{ index: 0, type: "normal", weight_kg: 70, reps: 5, distance_meters: null, duration_seconds: null, rpe: 9, custom_metric: null }] }] });
    w.hevy.remove(b.id);
    w.now.add(60e3);
    const r = await w.run();
    assert.equal(r.ok, true, r.summary);
    assert.match(r.summary, /^events: 0 added, 1 changed, 1 removed/);
    // Events were asked for since the last good run, a quarter of an hour early.
    const ev = w.hevy.calls.filter((c) => c.path === "/v1/workouts/events");
    assert.equal(ev.at(-1).query.since, cursor1);
    const rows = w.nb.rows();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].source_id, a.id);
    assert.equal(rows[0].data.workout, "Push day, heavy");
    assert.equal(rows[0].data.exercises, "Bench Press (Barbell): 5 x 70 kg (RPE 9)");
    assert.equal(rows[0].data.volume, 350);
    assert.equal(w.records()[b.id].gone, "deleted");
    // The same events read again (the overlap) change nothing.
    w.now.add(5 * 60e3);
    const n = w.nb.writes.length;
    await w.run();
    assert.equal(w.nb.writes.length, n);
  } finally { await w.close(); }
});

test("a cell the person changed stays theirs through a later Hevy edit; set back to Hevy's, it follows Hevy again", async () => {
  const w = await world();
  try {
    const a = w.hevy.add(bench("2026-10-20T16:00:00Z"));
    await w.run();
    const row = w.nb.row(a.id);
    // In the notebook's table: the title, and the start time as the table writes it.
    w.nb.edit(row.id, { workout: "Push day (gym B)", when: "2026-10-20T18:30", comment: "Shoulder felt fine." });
    w.now.hours(1);
    w.hevy.edit(a.id, { title: "Push day v2", description: "New notes" });
    await w.run();
    let now = w.nb.row(a.id);
    assert.equal(now.data.workout, "Push day (gym B)");
    assert.equal(now.data.when, "2026-10-20T18:30");
    assert.equal(now.data.comment, "Shoulder felt fine.");
    assert.equal(now.data.notes, "New notes"); // still Hevy's
    assert.deepEqual(w.records()[a.id].mine.sort(), ["when", "workout"]);
    // Set back to exactly what Hevy says: Hevy's again.
    w.nb.edit(now.id, { workout: "Push day v2" });
    w.now.hours(1);
    w.hevy.edit(a.id, { title: "Push day v3" });
    await w.run();
    now = w.nb.row(a.id);
    assert.equal(now.data.workout, "Push day v3");
    assert.equal(now.data.when, "2026-10-20T18:30");
    assert.deepEqual(w.records()[a.id].mine, ["when"]);
  } finally { await w.close(); }
});

test("deleted in Hevy: a row with the person's own words stays, marked; a row they deleted is not made again", async () => {
  const w = await world();
  try {
    const a = w.hevy.add(bench("2026-10-20T16:00:00Z"));
    const b = w.hevy.add(bench("2026-10-21T16:00:00Z"));
    await w.run();
    w.nb.edit(w.nb.row(a.id).id, { comment: "PR attempt next week." });
    w.nb.remove(w.nb.row(b.id).id);
    w.now.hours(1);
    w.hevy.remove(a.id);
    w.hevy.edit(b.id, { title: "Changed after you deleted its row" });
    const r = await w.run();
    assert.equal(r.ok, true, r.summary);
    const kept = w.nb.row(a.id);
    assert.equal(kept.data.workout, "Push day (deleted in Hevy)");
    assert.equal(kept.data.comment, "PR attempt next week.");
    assert.equal(w.records()[a.id].gone, "kept");
    assert.equal(w.nb.row(b.id), undefined);
    assert.equal(w.records()[b.id].deleted_by_you, true);
    assert.match(w.log(), /deleted in the notebook, so it is not made again/);
  } finally { await w.close(); }
});

test("once a day the count is compared, and a delete Hevy no longer lists is caught", async () => {
  const w = await world();
  try {
    const a = w.hevy.add(bench("2026-10-20T16:00:00Z"));
    w.hevy.add(bench("2026-10-21T16:00:00Z"));
    await w.run();
    w.hevy.remove(a.id, { event: false });
    w.now.hours(1);
    await w.run();
    assert.equal(w.nb.rows().length, 2, "within the day only the events count");
    w.now.hours(24);
    const r = await w.run();
    assert.match(r.summary, /events, then full: 0 added, 0 changed, 1 removed/);
    assert.equal(w.nb.rows().length, 1);
  } finally { await w.close(); }
});

test("a key Hevy refuses: one message after the second run, never a second one; over when a key works again", async () => {
  const w = await world();
  try {
    w.hevy.add(bench("2026-10-20T16:00:00Z"));
    await w.run();
    w.hevy.fh.key = "99999999-2222-4333-8444-555555555555";
    w.now.hours(1);
    const r1 = await w.run();
    assert.equal(r1.ok, false);
    assert.equal(w.told.length, 0, "one refusal is not yet a problem");
    for (let i = 0; i < 3; i++) { w.now.hours(1); await w.run(); }
    assert.equal(w.told.length, 1);
    assert.match(w.told[0].text, /^Hevy stopped accepting the key/);
    assert.equal(w.told[0].link, "https://hevy.com/settings?developer");
    assert.equal((w.told[0].text.match(/https?:\/\//g) || []).length, 1, "one link");
    assert.ok(!w.told[0].text.includes(w.hevy.fh.key) && !fs.readFileSync(w.paths.log, "utf8").includes("11111111-2222"), "the key is never in a message or the log");
    // A new key (the person's), and it is over.
    w.hevy.fh.key = "11111111-2222-4333-8444-555555555555";
    w.now.hours(1);
    const ok = await w.run();
    assert.equal(ok.ok, true, ok.summary);
    assert.equal(w.state().problems?.["key-refused"], undefined);
    // Refused again another day: a new problem, a new message.
    w.hevy.fh.key = "99999999-2222-4333-8444-555555555555";
    for (let i = 0; i < 2; i++) { w.now.hours(1); await w.run(); }
    assert.equal(w.told.length, 2);
  } finally { await w.close(); }
});

test("Hevy answering in a shape it never had: nothing is written, the cursor stays, one message", async () => {
  const w = await world();
  try {
    w.hevy.add(bench("2026-10-20T16:00:00Z"));
    await w.run();
    const cursor = w.state().cursor;
    w.now.hours(1);
    w.hevy.add(bench("2026-10-22T16:00:00Z"));
    w.hevy.fh.changed = true;
    await w.run();
    w.now.hours(1);
    await w.run();
    assert.equal(w.nb.rows().length, 1);
    assert.equal(w.state().cursor, cursor);
    assert.equal(w.told.length, 1);
    assert.match(w.told[0].text, /^Hevy changed how its connection answers/);
    // Back to its old shape: the waiting workout arrives.
    w.hevy.fh.changed = false;
    w.now.hours(1);
    const r = await w.run();
    assert.match(r.summary, /1 added/);
    assert.equal(w.nb.rows().length, 2);
  } finally { await w.close(); }
});

test("Hevy or the notebook not answering is never a message: the next hour catches up", async () => {
  const w = await world();
  try {
    w.hevy.add(bench("2026-10-20T16:00:00Z"));
    w.hevy.fh.down = true;
    for (let i = 0; i < 3; i++) { await w.run(); w.now.hours(1); }
    assert.ok(w.state().hevy_down_since);
    w.hevy.fh.down = false;
    w.nb.fb.down = true;
    for (let i = 0; i < 3; i++) { await w.run(); w.now.hours(1); }
    assert.ok(w.state().notebook_down_since);
    w.nb.fb.down = false;
    const r = await w.run();
    assert.match(r.summary, /^backfill: 1 added/);
    assert.equal(w.state().hevy_down_since, undefined);
    assert.equal(w.state().notebook_down_since, undefined);
    assert.deepEqual(w.told, []);
  } finally { await w.close(); }
});

test("a row the person saves at the same moment is not written over: tried again next run", async () => {
  const w = await world();
  try {
    const a = w.hevy.add(bench("2026-10-20T16:00:00Z"));
    await w.run();
    const cursor = w.state().cursor;
    w.now.hours(1);
    w.hevy.edit(a.id, { title: "Changed in Hevy" });
    // The person saves the row between the add-on's read and its write.
    const id = w.nb.row(a.id).id;
    const save = global.fetch;
    let bumped = false;
    global.fetch = async (url, init) => {
      if (!bumped && String(url).endsWith("/api/query") && String(init?.body).includes('"operation":"update"')) {
        bumped = true;
        w.nb.edit(id, { comment: "typed this second" });
      }
      return save(url, init);
    };
    let r;
    try { r = await w.run(); } finally { global.fetch = save; }
    assert.equal(r.ok, true, r.summary);
    assert.match(r.summary, /tried again next run/);
    assert.equal(w.state().cursor, cursor, "the cursor waits for that row");
    assert.equal(w.nb.row(a.id).data.comment, "typed this second");
    w.now.hours(1);
    await w.run();
    assert.equal(w.nb.row(a.id).data.workout, "Changed in Hevy");
    assert.equal(w.nb.row(a.id).data.comment, "typed this second");
  } finally { await w.close(); }
});

test("units: a person who lifts in pounds gets pounds, the volume column says so", async () => {
  const w = await world();
  try {
    w.hevy.fh.unit = "lb";
    w.hevy.add(workout({ start: "2026-10-20T16:00:00Z", exercises: [{ title: "Squat", sets: [{ reps: 5, kg: 102.0582 }] }] }));
    await w.run();
    const row = w.nb.rows()[0];
    assert.equal(row.data.exercises, "Squat: 5 x 225 lb");
    assert.equal(row.data.volume, 1125);
    assert.equal(w.nb.tracker().field_schema.find((f) => f.key === "volume").unit, "lb");
  } finally { await w.close(); }
});

test("a talk named at setup reads the tracker only when that talk exists", async () => {
  const fsMod = await import("node:fs");
  const path = await import("node:path");
  const { tmp } = await import("./helpers.mjs");
  const ws = tmp("ws");
  fsMod.mkdirSync(path.join(ws, "coach", "health"), { recursive: true });
  fsMod.writeFileSync(path.join(ws, "coach", "health", "area.md"), "AREA: health\nTITLE: Health\nRHYTHM: weekly sunday 19:00\n\n## Preparation\n");
  const w = await world({ settings: { talks: ["health", "work"], workspace: ws } });
  try {
    w.hevy.add(bench("2026-10-20T16:00:00Z"));
    await w.run();
    assert.deepEqual(w.nb.tracker().tracker.talks, ["health"]);
  } finally { await w.close(); fsMod.rmSync(ws, { recursive: true, force: true }); }
});
