// The Workouts tracker in the person's notebook, and its rows. A tracker is an ordinary collection
// with a `tracker` card (the notebook's trackers, D-321): the notebook shows it as a table, its chat
// knows it by its names, and a coaching talk the card names reads its rows ("The health talk may
// also look at my Workouts tracker" adds that talk to the card; the notebook does it).
//
// Each row is keyed by the Hevy workout's id (the item's source_id), so a reinstall or lost records
// find the same row, never a second one.
//
// THE PERSON'S EDITS. The add-on fills the cells it made (rows.mjs OWNED) and remembers what it
// wrote in each. A cell whose value is no longer what the add-on last wrote was changed by the
// person, in the table or through their assistant: from then on that cell is theirs, and a later
// change of the workout in Hevy no longer touches it. Set back to exactly what Hevy says, it is
// Hevy's again. "Your comment" and every column the person adds are never written at all. A row the
// person deletes in the notebook is not made again. With the records lost, every cell the add-on
// made counts as Hevy's again (the add-on cannot know which ones were changed).
//
// A WORKOUT DELETED IN HEVY takes its row away. A row that holds something of the person's (a
// cell they changed, their comment, a column they added) stays instead, and its Workout cell says
// "(deleted in Hevy)", so nothing they wrote is lost.
import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "./files.mjs";
import { OWNED, THEIRS, SOURCE, SPECIALIST, rowData, same, trackerShape, fieldsFor } from "./rows.mjs";

// Whether the coach has a talk of that area: coach/<area>/area.md with a talk rhythm (an area made
// for a habit alone has RHYTHM none). The notebook's trackers.mjs reads it the same way.
export function talkExists(workspace, area) {
  if (!workspace || !/^[a-z][a-z0-9-]{0,39}$/.test(String(area))) return false;
  let text = "";
  try { text = fs.readFileSync(path.join(workspace, "coach", area, "area.md"), "utf8"); } catch { return false; }
  const rhythm = ((text.replace(/\r/g, "").split("\n\n")[0].match(/^RHYTHM:[ \t]*(.*)$/m) || [])[1] || "").trim().toLowerCase();
  return Boolean(rhythm) && rhythm !== "none";
}

export class Records {
  constructor(file) { this.file = file; this.map = readJson(file, {}); }
  get(id) { return this.map[id] || null; }
  put(id, rec) { this.map[id] = rec; writeJson(this.file, this.map); }
  all() { return Object.entries(this.map); }
  // The workouts Hevy still has, as far as these records know.
  live() { return this.all().filter(([, r]) => !r.gone).map(([id]) => id); }
}

// The tracker: the one these records name, else the add-on's own (source_app), else one whose card
// names this specialist; made when there is none. Returns the collection.
export async function ensureTracker(c) {
  const { nb, state, settings } = c;
  let coll = null;
  if (state.collection?.id) {
    coll = await nb.collection(state.collection.id);
    if (coll && (!coll.tracker || coll.removed_at)) coll = null;
  }
  if (!coll) {
    const all = (await nb.collections()).filter((x) => x.tracker && typeof x.tracker === "object" && !x.removed_at);
    const mine = all.filter((x) => x.source_app === SOURCE || x.tracker.specialist === SPECIALIST)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    coll = mine.find((x) => x.name === settings.tracker) || mine[0] || null;
  }
  if (!coll) {
    const talks = (settings.talks || []).filter((t) => talkExists(settings.workspace, t));
    coll = await nb.createCollection(trackerShape(settings, { talks, units: c.units }));
    c.log(`notebook: made the tracker "${coll.name}"${talks.length ? ` (read by the ${talks.join(" and ")} talk)` : ""}`);
  } else {
    // A column a newer version has and this tracker lacks is added at the end; the person's own
    // columns, their order and their names stay as they are.
    const have = new Set((coll.field_schema || []).map((f) => f.key));
    const missing = fieldsFor(c.units).filter((f) => !have.has(f.key));
    if (missing.length) {
      coll = await nb.updateCollection(coll.id, { field_schema: [...(coll.field_schema || []), ...missing] }, coll._hash) || coll;
      c.log(`notebook: added the column(s) ${missing.map((f) => f.label).join(", ")} to "${coll.name}"`);
    }
  }
  if (state.collection?.id !== coll.id || state.collection?.slug !== coll.slug) state.collection = { id: coll.id, slug: coll.slug };
  c.coll = coll;
  return coll;
}

async function findRow(c, id, rec) {
  if (rec?.item) {
    const byId = await c.nb.itemById(rec.item);
    if (byId && byId.collection_id === c.coll.id) return byId;
  }
  return c.nb.item(c.coll.id, id);
}

// Whether a row holds anything of the person's: a cell they changed, their comment, a column of
// their own with a value.
function holdsTheirs(cur, rec) {
  const data = cur?.data || {};
  if ((rec?.mine || []).length) return true;
  if (!same(data[THEIRS], "")) return true;
  return Object.entries(data).some(([k, v]) => !OWNED.includes(k) && k !== THEIRS && !k.startsWith("_") && !same(v, ""));
}

// A workout from Hevy: its row made, or brought level. Returns "added", "changed", or null.
export async function applyWorkout(c, w) {
  const rec = c.records.get(w.id);
  if (rec?.deleted_by_you) return null;
  const want = rowData(w, { tz: c.tz, units: c.units });
  const cur = await findRow(c, w.id, rec);
  if (!cur && rec?.item && !rec.gone) {
    // The add-on made this row and it is gone: the person deleted it in the notebook.
    c.records.put(w.id, { ...rec, deleted_by_you: true, updated_at: w.updated_at });
    c.log(`${want.when} ${w.id}: its row was deleted in the notebook, so it is not made again`);
    return null;
  }
  if (!cur) {
    const row = await c.nb.insertItem({ collection_id: c.coll.id, source_app: SOURCE, source_id: w.id, data: want });
    c.records.put(w.id, { item: row?.id || null, wrote: want, seen: want, mine: [], updated_at: w.updated_at });
    c.log(`${want.when} ${w.id}: row added`);
    return "added";
  }
  const mine = new Set(rec?.mine || []);
  const wrote = rec?.wrote || null;
  const next = { ...(cur.data || {}) };
  const wroteNow = {};
  for (const k of OWNED) {
    if (mine.has(k)) {
      // Set back to what Hevy says (now, or at the last run): Hevy's again.
      if (same(cur.data?.[k], want[k]) || (rec?.seen && same(cur.data?.[k], rec.seen[k]))) mine.delete(k);
      else continue;
    } else if (wrote && !same(cur.data?.[k], wrote[k])) {
      mine.add(k); // changed by the person since the add-on wrote it
      c.log(`${want.when} ${w.id}: the cell "${k}" was changed in the notebook and stays as it is`);
      continue;
    }
    if (want[k] === undefined) delete next[k]; else next[k] = want[k];
    if (want[k] !== undefined) wroteNow[k] = want[k];
  }
  const changed = OWNED.some((k) => !same(next[k], cur.data?.[k]));
  const recNext = { item: cur.id, wrote: wroteNow, seen: want, mine: [...mine], updated_at: w.updated_at };
  if (!changed) {
    if (JSON.stringify(rec) !== JSON.stringify(recNext)) c.records.put(w.id, recNext);
    return null;
  }
  try { await c.nb.updateItem(cur.id, next, cur._hash); }
  catch (e) {
    if (!e?.conflict) throw e;
    c.log(`${want.when} ${w.id}: its row was saved in the notebook at the same moment; tried again next run`);
    c.retry = true;
    return null;
  }
  c.records.put(w.id, recNext);
  c.log(`${want.when} ${w.id}: row changed`);
  return "changed";
}

// A workout deleted in Hevy. Returns "removed", "kept", or null.
export async function removeWorkout(c, id) {
  const rec = c.records.get(id);
  if (rec?.gone) return null;
  const cur = await findRow(c, id, rec);
  if (!cur) {
    if (rec) c.records.put(id, { ...rec, gone: "deleted" });
    return null;
  }
  const when = cur.data?.when || "";
  if (!holdsTheirs(cur, rec)) {
    try { await c.nb.deleteItem(cur.id, cur._hash); }
    catch (e) {
      if (!e?.conflict) throw e;
      c.log(`${when} ${id}: its row was saved in the notebook at the same moment; tried again next run`);
      c.retry = true;
      return null;
    }
    c.records.put(id, { ...(rec || {}), item: cur.id, gone: "deleted" });
    c.log(`${when} ${id}: deleted in Hevy, row removed`);
    return "removed";
  }
  // Something of theirs is in it: the row stays, marked.
  const mine = new Set(rec?.mine || []);
  const next = { ...(cur.data || {}) };
  const mark = c.settings.texts.deleted_mark;
  if (!mine.has("workout") && !String(next.workout || "").endsWith(mark)) next.workout = `${String(next.workout || "Workout").trim()} ${mark}`;
  try { if (!same(next.workout, cur.data?.workout)) await c.nb.updateItem(cur.id, next, cur._hash); }
  catch (e) {
    if (!e?.conflict) throw e;
    c.retry = true;
    return null;
  }
  c.records.put(id, { ...(rec || {}), item: cur.id, gone: "kept" });
  c.log(`${when} ${id}: deleted in Hevy; the row holds your own words, so it stays, marked`);
  return "kept";
}
