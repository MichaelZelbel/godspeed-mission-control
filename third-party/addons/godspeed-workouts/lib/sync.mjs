// One run: Hevy's workouts brought into the notebook.
//
// 1. The first run reads every workout (the backfill) and writes one row each.
// 2. Every later run reads only Hevy's events since the last good run (each workout updated or
//    deleted since then), with a quarter of an hour of overlap so a clock that is a little off
//    loses nothing; an event already applied changes nothing.
// 3. Once a day the count Hevy gives is compared with the rows the records hold; when they differ
//    (an event Hevy no longer lists, a run lost), every workout is read again and the rows follow.
// 4. A problem the person can act on becomes one message (notify.mjs); everything else goes to the
//    log and `godspeed-workouts status`, and the next run tries again.
import { readJson, writeJson, appendLog } from "./files.mjs";
import { acquire } from "./lock.mjs";
import { readKey } from "./keys.mjs";
import { Hevy, HevyError, HEVY_API } from "./hevy.mjs";
import { Notebook, NotebookDown, NotebookError, DEFAULT_NOTEBOOK } from "./notebook.mjs";
import { Records, ensureTracker, applyWorkout, removeWorkout } from "./tracker.mjs";
import { machineZone, validZone } from "./clock.mjs";
import { notifyStep, setProblem, clearProblem } from "./notify.mjs";

export const OVERLAP_MS = 15 * 60 * 1000;
export const COUNT_CHECK_MS = 24 * 3600 * 1000;

export function hevyBase(env = process.env) {
  if (env.GODSPEED_WORKOUTS_HEVY_API) {
    if (env.GODSPEED_WORKOUTS_TEST !== "1") throw new Error("a pretend Hevy address is honoured only in test mode");
    return env.GODSPEED_WORKOUTS_HEVY_API;
  }
  return HEVY_API;
}
export const notebookBase = (env = process.env) => env.GODSPEED_WORKOUTS_NOTEBOOK || DEFAULT_NOTEBOOK;

// What a run needs. `deps` lets the tests hand in a clock, a Hevy and a notebook of their own.
export function context({ paths, settings, env = process.env, deps = {} }) {
  const now = deps.now || (() => new Date());
  const state = readJson(paths.state, {});
  const lines = [];
  return {
    paths, settings, env, state, now, lines,
    records: new Records(paths.records),
    nb: deps.notebook || new Notebook({ base: notebookBase(env) }),
    hevyFor: deps.hevyFor || ((key) => new Hevy({ key, base: hevyBase(env) })),
    tell: deps.tell,
    log: (line) => { lines.push(line); appendLog(paths.log, `${now().toISOString()} ${line}`); },
    saveState() { writeJson(paths.state, this.state); },
  };
}

async function fullSync(c, hevy, { reconcile }) {
  const all = await hevy.allWorkouts();
  const counts = { added: 0, changed: 0, removed: 0, kept: 0 };
  const seen = new Set();
  for (const w of all) {
    seen.add(w.id);
    const r = await applyWorkout(c, w);
    if (r) counts[r]++;
  }
  if (reconcile) {
    for (const id of c.records.live()) {
      if (seen.has(id)) continue;
      const r = await removeWorkout(c, id);
      if (r) counts[r]++;
    }
  }
  return { ...counts, workouts: all.length };
}

async function eventSync(c, hevy, since) {
  const events = await hevy.eventsSince(since);
  // The last event about a workout is what it is now.
  const last = new Map();
  for (const ev of events) last.set(ev.type === "updated" ? ev.workout.id : ev.id, ev);
  const counts = { added: 0, changed: 0, removed: 0, kept: 0, events: events.length };
  for (const ev of last.values()) {
    const r = ev.type === "updated" ? await applyWorkout(c, ev.workout) : await removeWorkout(c, ev.id);
    if (r) counts[r]++;
  }
  return counts;
}

const sum = (o) => Object.entries(o).filter(([k]) => ["added", "changed", "removed", "kept"].includes(k)).map(([k, v]) => `${v} ${k}`).join(", ");

// Returns { ok, code, summary }. code 0: done (or nothing to do), 1: a problem (said in status).
export async function runSync({ paths, settings, env = process.env, deps = {}, full = false }) {
  const lock = acquire(paths);
  if (!lock) return { ok: true, code: 0, summary: "another run is going on; this one stops" };
  const c = context({ paths, settings, env, deps });
  const st = c.state;
  const started = c.now();
  st.last_run = { at: started.toISOString(), ok: false };
  c.tz = settings.timezone && validZone(settings.timezone) ? settings.timezone : st.tz || machineZone();
  try {
    const key = readKey(paths);
    if (!key) {
      setProblem(c, "no-key", "no Hevy key is set: godspeed-workouts connect");
      st.last_run.why = "no Hevy key";
      return { ok: false, code: 1, summary: "no Hevy key is set. Run: godspeed-workouts connect" };
    }
    if (!(await c.nb.answers())) {
      st.notebook_down_since ||= started.toISOString();
      st.last_run.why = "the notebook does not answer";
      c.log("the notebook does not answer; the workouts wait for the next run");
      return { ok: false, code: 1, summary: "the notebook does not answer; tried again next hour" };
    }
    delete st.notebook_down_since;
    const hevy = c.hevyFor(key);
    // The units the person uses in Hevy, read once, so every row of the tracker speaks the same.
    if (!st.units) {
      const u = await hevy.userInfo();
      st.units = { weight: u.weight, distance: u.distance };
    }
    c.units = st.units;
    if (!(settings.timezone && validZone(settings.timezone))) c.tz = (await c.nb.timezone()) || c.tz;
    st.tz = c.tz;
    st.web ??= await c.nb.address();
    await ensureTracker(c);

    let counts, how;
    if (!st.backfill?.done_at || full) {
      how = st.backfill?.done_at ? "full" : "backfill";
      counts = await fullSync(c, hevy, { reconcile: !!st.backfill?.done_at });
      if (!c.retry) {
        st.backfill = { done_at: started.toISOString(), workouts: counts.workouts };
        st.count_check_at = started.toISOString();
      }
    } else {
      how = "events";
      counts = await eventSync(c, hevy, st.cursor || st.backfill.done_at);
      const due = !st.count_check_at || started - new Date(st.count_check_at) >= COUNT_CHECK_MS;
      if (due && !c.retry) {
        const n = await hevy.count();
        const live = c.records.live().length;
        st.count_check_at = started.toISOString();
        if (n !== live) {
          c.log(`Hevy counts ${n} workout(s), the rows ${live}: every workout is read again`);
          const again = await fullSync(c, hevy, { reconcile: true });
          for (const k of ["added", "changed", "removed", "kept"]) counts[k] += again[k];
          how = "events, then full";
        }
      }
    }
    // The cursor moves only when every workout of this run was written, so nothing is skipped.
    if (!c.retry) st.cursor = new Date(started.getTime() - OVERLAP_MS).toISOString();
    for (const k of ["no-key", "key-refused", "hevy-changed", "notebook-refused", "run-failed"]) clearProblem(c, k);
    delete st.hevy_down_since;
    st.last_run = { at: started.toISOString(), ok: true, how, ...counts };
    st.last_good = started.toISOString();
    const summary = `${how}: ${sum(counts)}${c.retry ? " (a row saved at the same moment is tried again next run)" : ""}`;
    if (counts.added || counts.changed || counts.removed || counts.kept || how !== "events") c.log(summary);
    return { ok: true, code: 0, summary };
  } catch (e) {
    let summary;
    if (e instanceof HevyError && e.kind === "key") { setProblem(c, "key-refused", e.message); summary = e.message; }
    else if (e instanceof HevyError && e.kind === "changed") { setProblem(c, "hevy-changed", e.message); summary = e.message; }
    else if (e instanceof HevyError) { st.hevy_down_since ||= started.toISOString(); summary = `${e.message}; tried again next hour`; }
    else if (e instanceof NotebookDown) { st.notebook_down_since ||= started.toISOString(); summary = `${e.message}; tried again next hour`; }
    else if (e instanceof NotebookError) { setProblem(c, "notebook-refused", e.message); summary = e.message; }
    else { setProblem(c, "run-failed", e?.message || String(e)); summary = e?.message || String(e); }
    st.last_run.why = summary;
    c.log(`run stopped: ${summary}`);
    return { ok: false, code: 1, summary };
  } finally {
    try { await notifyStep(c); } catch (e) { c.log(`message step: ${e.message}`); }
    c.saveState();
    lock.release();
  }
}
