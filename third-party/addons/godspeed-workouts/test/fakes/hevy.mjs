// A pretend Hevy for the tests, over real HTTP on 127.0.0.1, answering the way Hevy's public API
// answers (checked against the real one on 24 October 2026): the header api-key, 401 with
// "InvalidApiKey" for any other key, pages of at most 10 (a bigger page is 400), the events since a
// time newest first, each workout's current state in its "updated" event.
// Switches: `down` (500 to everything), `changed` (workouts without their exercises list).
import http from "node:http";
import { randomUUID } from "node:crypto";

export const KEY = "11111111-2222-4333-8444-555555555555";

export async function startFakeHevy({ key = KEY, clock = () => new Date() } = {}) {
  const workouts = new Map();
  const events = []; // { at, type, id, workout? }
  const calls = [];
  const fh = { down: false, changed: false, key, unit: "kg" };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    calls.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), at: clock().toISOString() });
    const send = (status, body) => { res.writeHead(status, { "content-type": typeof body === "string" ? "text/plain" : "application/json" }); res.end(typeof body === "string" ? body : JSON.stringify(body)); };
    if (fh.down) return send(500, "Internal Server Error");
    if (req.headers["api-key"] !== fh.key) return send(401, "InvalidApiKey");
    const page = Number(url.searchParams.get("page") || 1), size = Number(url.searchParams.get("pageSize") || 10);
    if (size > 10) return send(400, "Invalid page size");
    const shape = (w) => (fh.changed ? (({ exercises, ...rest }) => rest)(w) : w);
    // As the real one answers: a page past the last is 404 "Page not found"; no events at all is
    // one page holding an empty "workouts" list (not "events", whatever the documentation says).
    const paged = (list, name) => {
      if (name === "events" && !list.length) return { page: 1, page_count: 1, workouts: [] };
      const page_count = Math.max(1, Math.ceil(list.length / size));
      if (page > page_count) return null;
      return { page, page_count, [name]: list.slice((page - 1) * size, page * size) };
    };
    const pagedOr404 = (list, name) => { const j = paged(list, name); return j ? send(200, j) : send(404, { error: "Page not found" }); };
    if (url.pathname === "/v1/user/info") return send(200, { data: { id: "user-1", username: "alex", name: "Alex Example", url: "https://hevy.com/user/alex", weight_unit: fh.unit === "lb" ? "lbs" : "kg", distance_unit: "kilometers", is_pro: true } });
    if (url.pathname === "/v1/workouts/count") return send(200, { workout_count: workouts.size });
    if (url.pathname === "/v1/workouts") {
      const list = [...workouts.values()].sort((a, b) => b.start_time.localeCompare(a.start_time)).map(shape);
      return pagedOr404(list, "workouts");
    }
    if (url.pathname === "/v1/workouts/events") {
      const since = Date.parse(url.searchParams.get("since") || "1970-01-01T00:00:00Z");
      // The newest event per workout, newest first, as a cache-keeping list.
      const latest = new Map();
      for (const e of events) if (Date.parse(e.at) >= since) latest.set(e.id, e);
      const list = [...latest.values()].sort((a, b) => b.at.localeCompare(a.at)).map((e) => (e.type === "updated" ? { type: "updated", workout: shape(workouts.get(e.id) || e.workout) } : { type: "deleted", id: e.id, deleted_at: e.at }));
      return pagedOr404(list, "events");
    }
    return send(404, "Not found");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}`;

  return {
    url, fh, calls, workouts, events,
    // A made-up workout. `sets` per exercise: [[reps, kg], ...].
    add(w) {
      const at = clock().toISOString();
      const full = { id: randomUUID(), title: "Workout", routine_id: null, description: "", updated_at: at, created_at: at, ...w };
      workouts.set(full.id, full);
      events.push({ at, type: "updated", id: full.id, workout: full });
      return full;
    },
    edit(id, patch) {
      const at = clock().toISOString();
      const w = { ...workouts.get(id), ...patch, updated_at: at };
      workouts.set(id, w);
      events.push({ at, type: "updated", id, workout: w });
      return w;
    },
    remove(id, { event = true } = {}) {
      workouts.delete(id);
      if (event) events.push({ at: clock().toISOString(), type: "deleted", id });
    },
    close: () => new Promise((r) => server.close(r)),
  };
}

export function workout({ start, minutes = 45, title = "Push day", exercises = [], description = "" }) {
  const s = new Date(start);
  return {
    title, description,
    start_time: s.toISOString().replace(".000Z", "+00:00"),
    end_time: new Date(s.getTime() + minutes * 60000).toISOString().replace(".000Z", "+00:00"),
    exercises: exercises.map((e, i) => ({
      index: i, title: e.title, notes: e.notes ?? null, exercise_template_id: `T${i}`, superset_id: e.superset ?? null,
      sets: e.sets.map((s, j) => ({ index: j, type: s.type || "normal", weight_kg: s.kg ?? null, reps: s.reps ?? null, distance_meters: s.m ?? null, duration_seconds: s.sec ?? null, rpe: s.rpe ?? null, custom_metric: null })),
    })),
  };
}
