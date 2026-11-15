// Hevy's public API (https://api.hevyapp.com/docs, Hevy Pro only): the workouts, their count, and
// the events since a day (each workout updated or deleted since then), with the header
// `api-key: <key>`. Pages hold at most 10.
//
// Hevy says its API may change or go away. So every answer is checked against the shape this
// add-on knows before anything is written, and the three ways it can fail are told apart:
//   key      Hevy refused the key (401 or 403): only the person can make a new one;
//   changed  an answer that does not look the way it did (a field gone, a page size refused, an
//            endpoint gone): the add-on needs an update;
//   down     no answer, a server error, too many requests: it is tried again next hour.
export const HEVY_API = "https://api.hevyapp.com";
export const PAGE_SIZE = 10;
const MAX_PAGES = 5000;

export class HevyError extends Error {
  constructor(kind, message) { super(message); this.name = "HevyError"; this.kind = kind; }
}

const isNum = (v) => v === null || v === undefined || (typeof v === "number" && Number.isFinite(v));
const isTime = (v) => typeof v === "string" && Number.isFinite(Date.parse(v));
const optText = (v) => v === null || v === undefined || typeof v === "string";

// A workout as this add-on reads it; anything else is "changed", with what was wrong.
export function checkWorkout(w) {
  const bad = (what) => { throw new HevyError("changed", `a workout in Hevy's answer ${what}`); };
  if (!w || typeof w !== "object") bad("is not an object");
  if (typeof w.id !== "string" || !w.id) bad("has no id");
  if (!isTime(w.start_time)) bad(`(${w.id}) has no start_time`);
  if (w.end_time !== null && w.end_time !== undefined && !isTime(w.end_time)) bad(`(${w.id}) has an end_time that is not a time`);
  if (!optText(w.title) || !optText(w.description)) bad(`(${w.id}) has a title or description that is not text`);
  if (!Array.isArray(w.exercises)) bad(`(${w.id}) has no list of exercises`);
  for (const e of w.exercises) {
    if (!e || typeof e !== "object" || !optText(e.title) || !optText(e.notes) || !Array.isArray(e.sets)) bad(`(${w.id}) has an exercise without a title or a list of sets`);
    if (!isNum(e.index) || !isNum(e.superset_id)) bad(`(${w.id}) has an exercise whose order or superset is not a number`);
    for (const s of e.sets) {
      if (!s || typeof s !== "object") bad(`(${w.id}) has a set that is not an object`);
      for (const k of ["index", "weight_kg", "reps", "distance_meters", "duration_seconds", "rpe", "custom_metric"]) if (!isNum(s[k])) bad(`(${w.id}) has a set whose ${k} is not a number`);
      if (!optText(s.type)) bad(`(${w.id}) has a set whose type is not text`);
    }
  }
  return w;
}

function checkPage(j, list) {
  if (!j || typeof j !== "object" || !Number.isInteger(j.page_count) || j.page_count < 0 || !Array.isArray(j[list])) {
    throw new HevyError("changed", `Hevy's answer has no page_count or no list of ${list}`);
  }
  return j;
}

export function checkEvent(ev) {
  if (ev?.type === "updated") { checkWorkout(ev.workout); return ev; }
  if (ev?.type === "deleted") {
    if (typeof ev.id !== "string" || !ev.id) throw new HevyError("changed", "a deleted-workout event in Hevy's answer has no id");
    return ev;
  }
  throw new HevyError("changed", `Hevy's events hold a kind this add-on does not know (${JSON.stringify(ev?.type ?? null).slice(0, 40)})`);
}

export class Hevy {
  constructor({ key, base = HEVY_API, fetchImpl = fetch, timeoutMs = 30000, pauseMs = 250 } = {}) {
    if (!key) throw new HevyError("key", "no Hevy key is set");
    this.key = key;
    this.base = String(base).replace(/\/+$/, "");
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.pauseMs = pauseMs;
    this.calls = 0;
  }

  async get(route, query = {}) {
    const url = new URL(`${this.base}${route}`);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    // Two tries for no answer or a server error; a refusal is said at once.
    let last;
    for (let i = 0; i < 2; i++) {
      if (this.calls++ && this.pauseMs) await new Promise((r) => setTimeout(r, this.pauseMs));
      let r;
      try {
        r = await this.fetch(url, { headers: { "api-key": this.key, accept: "application/json", "user-agent": "godspeed-workouts" }, signal: AbortSignal.timeout(this.timeoutMs) });
      } catch (e) {
        last = new HevyError("down", `Hevy did not answer (${e.cause?.code || e.name || e.message})`);
        continue;
      }
      const text = await r.text().catch(() => "");
      if (r.status === 401 || r.status === 403) throw new HevyError("key", `Hevy refused the key (${r.status} ${text.slice(0, 60).trim()})`);
      if (r.status === 429) throw new HevyError("down", "Hevy asked to wait (429 too many requests)");
      if (r.status >= 500) { last = new HevyError("down", `Hevy answered ${r.status}`); continue; }
      // A page past the last (and, for an account with nothing, the first): {"error":"Page not found"}.
      if (r.status === 404 && /page not found/i.test(text) && query.page) return { page: Number(query.page), page_count: 0, nopage: true };
      if (r.status !== 200) throw new HevyError("changed", `Hevy answered ${r.status} for ${route} (${text.slice(0, 80).trim()})`);
      try { return JSON.parse(text); } catch { throw new HevyError("changed", `Hevy's answer for ${route} is not JSON`); }
    }
    throw last;
  }

  async userInfo() {
    const j = await this.get("/v1/user/info");
    const u = j?.data ?? j;
    if (!u || typeof u !== "object" || typeof u.id !== "string") throw new HevyError("changed", "Hevy's user info has no id");
    return {
      id: u.id,
      name: typeof u.name === "string" ? u.name : "",
      weight: u.weight_unit === "lbs" ? "lb" : "kg",
      distance: u.distance_unit === "miles" ? "mi" : "km",
      pro: typeof u.is_pro === "boolean" ? u.is_pro : null,
    };
  }

  async count() {
    const j = await this.get("/v1/workouts/count");
    if (!Number.isInteger(j?.workout_count) || j.workout_count < 0) throw new HevyError("changed", "Hevy's workout count is not a number");
    return j.workout_count;
  }

  async workoutsPage(page) {
    const raw = await this.get("/v1/workouts", { page, pageSize: PAGE_SIZE });
    const j = checkPage(raw.nopage ? { ...raw, workouts: [] } : raw, "workouts");
    j.workouts.forEach(checkWorkout);
    return j;
  }

  // Every workout, page by page. A page past the last answers 404 on some APIs: the page count
  // Hevy gives is followed, never more.
  async allWorkouts() {
    const out = [];
    const first = await this.workoutsPage(1);
    out.push(...first.workouts);
    const pages = Math.min(first.page_count, MAX_PAGES);
    for (let p = 2; p <= pages; p++) out.push(...(await this.workoutsPage(p)).workouts);
    return out;
  }

  // Every event since `since` (ISO), oldest first, so a later event about a workout wins.
  async eventsSince(since) {
    const page = async (p) => {
      const raw = await this.get("/v1/workouts/events", { page: p, pageSize: PAGE_SIZE, since });
      // With no events since then, Hevy answers {"page":1,"page_count":1,"workouts":[]}, not an
      // empty "events" list as its documentation says (seen on 24 October 2026). Only that exact
      // empty answer is taken as none; anything else without "events" is a change.
      const none = raw.nopage || (!("events" in raw) && Array.isArray(raw.workouts) && raw.workouts.length === 0);
      const j = checkPage(none ? { ...raw, events: [] } : raw, "events");
      j.events.forEach(checkEvent);
      return j;
    };
    const first = await page(1);
    const events = [...first.events];
    const pages = Math.min(first.page_count, MAX_PAGES);
    for (let p = 2; p <= pages; p++) events.push(...(await page(p)).events);
    // Hevy gives them newest first.
    return events.reverse();
  }
}
