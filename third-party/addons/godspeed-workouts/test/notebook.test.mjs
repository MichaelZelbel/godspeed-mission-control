// Against a real Godspeed notebook: GODSPEED_NOTEBOOK_CHECKOUT names a checkout of the product
// (MichaelZelbel/godspeed-mission-control); its notebook is started for this test in a folder of its
// own, on a port of its own, with every GODSPEED_* and HERMES_* variable cleared, so the test can
// never reach a notebook that belongs to someone. NOTEBOOK_NODE: the Node it runs on (default this
// one). Hevy is the pretend one. Without the checkout this test is skipped and says so.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { spawn } from "node:child_process";
import { world, tmp } from "./helpers.mjs";
import { workout } from "./fakes/hevy.mjs";

const CHECKOUT = process.env.GODSPEED_NOTEBOOK_CHECKOUT ? path.resolve(process.env.GODSPEED_NOTEBOOK_CHECKOUT) : null;
const freePort = () => new Promise((r) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => r(port)); }); });

async function startNotebook() {
  const ws = tmp("notebook"), home = tmp("notebook-home"), port = await freePort();
  // A health talk, so a talk can be given the tracker.
  fs.mkdirSync(path.join(ws, "coach", "health"), { recursive: true });
  fs.writeFileSync(path.join(ws, "coach", "health", "area.md"), "AREA: health\nTITLE: Health\nRHYTHM: weekly sunday 19:00\nSTATUS: on\n\n## Preparation\n\nMade up for a test.\n");
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GODSPEED_|HERMES_)/i.test(k)));
  Object.assign(env, { GODSPEED_WORKSPACE: ws, GODSPEED_PORT: String(port), GODSPEED_FOOD_TABLE: "off", HOME: home, USERPROFILE: home });
  const log = fs.openSync(path.join(home, "notebook.log"), "a");
  const child = spawn(process.env.NOTEBOOK_NODE || process.execPath, [path.join(CHECKOUT, "notebook", "server", "main.mjs")], { env, stdio: ["ignore", log, log] });
  const url = `http://127.0.0.1:${port}`;
  for (const until = Date.now() + 90000; ;) {
    try { if ((await fetch(`${url}/health`)).ok) break; } catch { /* not yet */ }
    if (Date.now() > until || child.exitCode !== null) throw new Error(`the notebook did not start: ${fs.readFileSync(path.join(home, "notebook.log"), "utf8").slice(-800)}`);
    await new Promise((r) => setTimeout(r, 500));
  }
  const post = async (route, body) => { const r = await fetch(`${url}${route}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); return r.json(); };
  const query = async (body) => { const j = await post("/api/query", body); if (j.error) throw new Error(j.error); return j.data; };
  // The notebook's own tracker operations, as the assistant calls them.
  const op = async (args) => {
    const j = await post("/mcp", { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "personal_operation", arguments: args } });
    const text = j.result?.content?.[0]?.text;
    if (j.error || j.result?.isError) throw new Error(text || JSON.stringify(j.error));
    return JSON.parse(text);
  };
  const tracker = async () => (await query({ table: "collections", operation: "select" })).find((c) => c.tracker?.specialist === "workouts");
  const rows = async () => { const t = await tracker(); return t ? query({ table: "collection_items", operation: "select", filters: [["eq", "collection_id", t.id]] }) : []; };
  return {
    url, ws, query, op, tracker, rows,
    close: async () => { child.kill(); await new Promise((r) => child.once("exit", r)); for (const d of [ws, home]) fs.rmSync(d, { recursive: true, force: true, maxRetries: 5 }); },
  };
}

test("a real notebook: the tracker, edits and deletes through events, the person's cell, and a talk that may look at it", { skip: CHECKOUT ? false : "GODSPEED_NOTEBOOK_CHECKOUT is not set" }, async () => {
  const nb = await startNotebook();
  const w = await world({ notebook: nb });
  try {
    // The installation's time zone, as Godspeed's setup keeps it: the rows follow it, whatever
    // zone this machine is in.
    const inst = (await nb.query({ table: "settings", operation: "select", filters: [["eq", "id", "installation"]] }))[0];
    if (inst) await nb.query({ table: "settings", operation: "update", values: { timezone: "Europe/Berlin" }, filters: [["eq", "id", "installation"]], expected: { installation: inst._hash } });
    else await nb.query({ table: "settings", operation: "insert", values: { id: "installation", timezone: "Europe/Berlin" } });
    const upper = w.hevy.add(workout({ start: "2026-10-23T16:05:48Z", minutes: 50, title: "Upper body", exercises: [{ title: "Bench press", sets: [{ reps: 8, kg: 60 }] }, { title: "Row", sets: [{ reps: 10, kg: 50 }] }] }));
    const legs = w.hevy.add(workout({ start: "2026-10-22T17:00:00Z", title: "Leg day", exercises: [{ title: "Squat (Barbell)", sets: [{ reps: 5, kg: 100, type: "warmup" }, { reps: 5, kg: 120, rpe: 8.5 }] }] }));
    const r = await w.run();
    assert.equal(r.ok, true, r.summary);

    // The tracker, as the notebook's own tracker list sees it.
    const list = await nb.op({ type: "tracker-list", days: 30 });
    const t = list.trackers.find((x) => x.name === "Workouts");
    assert.ok(t, JSON.stringify(list.trackers.map((x) => x.name)));
    assert.equal(t.specialist, "workouts");
    assert.equal(t.cadence, "any");
    assert.deepEqual(t.talks, []);
    assert.equal(t.status, "active");
    const row = (await nb.rows()).find((x) => x.source_id === upper.id);
    assert.equal(row.title, "2026-10-23 18:05");
    assert.deepEqual(Object.fromEntries(Object.entries(row.data)), {
      when: "2026-10-23 18:05", workout: "Upper body", end: "2026-10-23 18:55", minutes: 50,
      exercises: "Bench press: 8 x 60 kg\nRow: 10 x 50 kg", sets: 2, volume: 980,
    });
    // Its file, where the notebook keeps trackers.
    assert.ok(fs.existsSync(path.join(nb.ws, "notebook", "Collections", "Workouts.md")));

    // "The health talk may also look at my Workouts tracker": the notebook's own operation.
    const talk = await nb.op({ type: "tracker-talk", tracker: "Workouts", talk: "health", words: "The health talk may also look at my Workouts tracker", expected: { [`collections/${t.id}`]: t.hash } });
    assert.equal(talk.changed, true, JSON.stringify(talk));
    assert.match(talk.reply, /health talk may now look at your workouts tracker/i);
    const forTalk = await nb.op({ type: "tracker-list", talk: "health", days: 30 });
    const seen = forTalk.trackers.find((x) => x.name === "Workouts");
    assert.equal(seen.recent.length, 2, "the health talk reads both workouts");
    assert.ok(seen.recent.some((x) => x.data.exercises === "Bench press: 8 x 60 kg\nRow: 10 x 50 kg"));

    // The person changes the title in the table (only that cell is written, as the table does) and
    // writes a comment; then Hevy edits the workout and deletes the other one.
    const before = (await nb.rows()).find((x) => x.source_id === upper.id);
    await nb.query({ table: "collection_items", operation: "update", values: { data: { ...before.data, workout: "Upper body, first try", comment: "Felt it the next day." } }, filters: [["eq", "id", before.id]], expected: { [before.id]: before._hash } });
    w.now.hours(1);
    w.hevy.edit(upper.id, { description: "Slow reps", exercises: [{ index: 0, title: "Bench press", notes: null, superset_id: null, sets: [{ index: 0, type: "normal", weight_kg: 62.5, reps: 6, distance_meters: null, duration_seconds: null, rpe: null, custom_metric: null }] }] });
    w.hevy.remove(legs.id);
    const r2 = await w.run();
    assert.equal(r2.ok, true, r2.summary);
    assert.match(r2.summary, /1 changed, 1 removed/);
    const after = await nb.rows();
    assert.equal(after.length, 1);
    assert.equal(after[0].data.workout, "Upper body, first try");
    assert.equal(after[0].data.comment, "Felt it the next day.");
    assert.equal(after[0].data.exercises, "Bench press: 6 x 62.5 kg");
    assert.equal(after[0].data.notes, "Slow reps");
    assert.equal(after[0].data.volume, 375);
    // The tracker card still names the talk (the add-on never touches the card).
    assert.deepEqual((await nb.tracker()).tracker.talks, ["health"]);
    // A run with nothing new changes nothing.
    w.now.hours(1);
    const hash = after[0]._hash;
    await w.run();
    assert.equal((await nb.rows())[0]._hash, hash);
  } finally { await w.close(); await nb.close(); }
});
