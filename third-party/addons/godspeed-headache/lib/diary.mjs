// Which diary a command reads and writes. Since 0.3.0 there are two:
//
// - the notebook's Headaches tracker (lib/notebook.mjs), one row per headache, in a mission
//   control whose notebook holds one (the Godspeed notebook, Mission Control's D-321);
// - the entry files under routines/headache/entries/ (lib/store.mjs), as before.
//
// The tracker when there is one. Otherwise the entry files when there are any, until
// `godspeed-headache migrate` moves them. Otherwise, in a mission control with the notebook, the
// first headache starts the tracker; without one, the entry files as always. Exactly one of them
// is the diary at any time, so a headache is never kept twice.
import fs from "node:fs";
import path from "node:path";
import { readEntries, writeEntry, ROOT } from "./store.mjs";
import { episodesFrom } from "./episodes.mjs";
import { findTracker, readItems, writeItems, createTracker, withNotebookLock, hasNotebook } from "./notebook.mjs";
import { FIELDS, NAMES, logFromRows, applyEntries, rowData } from "./rows.mjs";

export const entriesDir = (mcDir) => path.join(mcDir, ROOT, "entries");
export function hasOldEntries(mcDir) {
  const walk = (dir) => { let items = []; try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return false; } return items.some((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : e.name.endsWith(".md"))); };
  return walk(entriesDir(mcDir));
}

export function openDiary(mcDir, settings) {
  const tz = settings.timezone;
  const tracker = findTracker(mcDir);
  if (tracker || (!hasOldEntries(mcDir) && hasNotebook(mcDir))) return notebookDiary(mcDir, tz, tracker);
  return {
    kind: "files",
    log: () => episodesFrom(readEntries(mcDir)),
    save: (list, at) => list.forEach((entry, i) => writeEntry(mcDir, settings, entry, at, i)),
  };
}

function notebookDiary(mcDir, tz, found) {
  let tracker = found;
  const rows = () => readItems(mcDir, tracker);
  return {
    kind: "notebook",
    get tracker() { return tracker; },
    log: () => logFromRows(rows(), tz),
    // One command's entries, applied to the rows as they are inside the lock (a row he edited a
    // moment ago in the notebook is what they apply to). Words he gave, details and pills go on the
    // row; a cancel removes it; a pill with no headache going on is a row of its own.
    save(list, at) {
      withNotebookLock(mcDir, () => {
        if (!tracker) tracker = findTracker(mcDir) || createTracker(mcDir, { fields: FIELDS.map((f) => ({ ...f })), names: [...NAMES], now: at });
        const items = rows(), byItem = new Map(items.map((i) => [i.id, i]));
        const { changed, removed, pills } = applyEntries(logFromRows(items, tz), list);
        const put = [
          ...changed.map((ep) => { const item = ep.item ? byItem.get(ep.item) : null, data = rowData(ep, tz, item?.data); return { item, data, title: data.when }; }),
          ...pills.map((p) => { const data = rowData(p, tz); return { item: null, data, title: data.when }; }),
        ];
        writeItems(mcDir, tracker, { put, remove: removed.map((ep) => byItem.get(ep.item)) }, at);
      });
    },
  };
}
