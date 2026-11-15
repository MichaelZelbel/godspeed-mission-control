// Moving the entry files into the notebook's Headaches tracker (Mission Control's D-321), once.
// Every headache becomes one row and every pill taken with no headache going on a row of its own.
// The rows are written, read back from the notebook's files and compared with the diary they came
// from: every headache field by field (start, end, minutes, first and strongest pain, where, what
// it felt like, symptoms, triggers, every pill with its dose and time, his words) and every day of
// the whole history (headaches, minutes, strongest pain, painkiller doses). Any difference takes the
// rows away again and says what differed; the old files stay the diary. Only when everything is the
// same do the old files move to archives/, and a small file in their place stops an older
// godspeed-headache from starting a second diary there.
import fs from "node:fs";
import path from "node:path";
import { readEntries, ROOT } from "./store.mjs";
import { episodesFrom } from "./episodes.mjs";
import { dailyRollup } from "./report.mjs";
import { localParts } from "./clock.mjs";
import { hasOldEntries, entriesDir } from "./diary.mjs";
import { findTracker, readItems, writeItems, createTracker, withNotebookLock, hasNotebook, encodeRecord, decodeRecord } from "./notebook.mjs";
import { FIELDS, NAMES, logFromRows, rowData } from "./rows.mjs";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const epFields = (e) => ({
  start: e.start, end: e.end || null, minutes: e.minutes ?? null, pain_first: e.pain_first ?? null, pain_max: e.pain_max ?? null,
  side: e.side || null, quality: e.quality || null, symptoms: e.symptoms, triggers: e.triggers,
  meds: e.meds.map((m) => ({ med: m.med, dose: m.dose || "", taken: m.taken })), words: e.words.join("\n").trim(),
});
const pillKey = (m) => `${m.taken}|${m.med}|${m.dose || ""}`;
const dayFields = (r) => r ? { headache_episodes: r.headache_episodes, headache_min: r.headache_min, headache_max_pain: r.headache_max_pain ?? null, painkiller_doses: r.painkiller_doses } : { headache_episodes: 0, headache_min: 0, headache_max_pain: null, painkiller_doses: 0 };

// Before and after, compared. Both are {episodes, loose} as episodesFrom gives them.
export function compareLogs(before, after, tz, now) {
  const afterById = new Map(after.episodes.map((e) => [e.id, e]));
  const episodes = before.episodes.map((e) => {
    const a = afterById.get(e.id), was = epFields(e), is = a ? epFields(a) : null;
    const differences = is ? Object.keys(was).filter((k) => !same(was[k], is[k])).map((k) => ({ field: k, before: was[k], after: is[k] })) : [{ field: "row", before: "present", after: "missing" }];
    return { id: e.id, same: differences.length === 0, differences };
  });
  for (const a of after.episodes) if (!before.episodes.some((e) => e.id === a.id)) episodes.push({ id: a.id, same: false, differences: [{ field: "row", before: "missing", after: "present" }] });
  const pills = { before: before.loose.map(pillKey).sort(), after: after.loose.map(pillKey).sort() };
  pills.same = same(pills.before, pills.after);
  const b = new Map(dailyRollup(before, tz, now, {}).map((r) => [r.date, r])), c = new Map(dailyRollup(after, tz, now, {}).map((r) => [r.date, r]));
  const dates = [...new Set([...b.keys(), ...c.keys()])].sort();
  const days = dates.map((date) => { const was = dayFields(b.get(date)), is = dayFields(c.get(date)); return { date, before: was, after: is, same: same(was, is) }; });
  return { episodes, pills, days, same: episodes.every((e) => e.same) && pills.same && days.every((d) => d.same) };
}

// The rows a diary becomes. A loose pill keeps the words said with it.
export function rowsFromEntries(entries, tz) {
  const log = episodesFrom(entries);
  return [
    ...log.episodes.map((ep) => rowData(ep, tz)),
    ...entries.filter((e) => e.kind === "med" && !e.episode).map((e) => rowData({ kind: "pill", meds: [{ med: e.med, dose: e.dose || "", taken: e.taken || e.at }], words: e.words ? [e.words] : [] }, tz)),
  ];
}

function freeDir(dir) { for (let n = 1; ; n++) { const d = n > 1 ? `${dir}-${n}` : dir; if (!fs.existsSync(d)) return d; } }

export function migrate(mcDir, settings, now, { dryRun = false } = {}) {
  const tz = settings.timezone;
  if (!hasNotebook(mcDir)) return { ok: false, reason: "This mission control has no notebook to move the headache diary into." };
  if (findTracker(mcDir)) return { ok: false, reason: hasOldEntries(mcDir) ? "There is a Headaches tracker already, and the old diary beside it was not moved. Nothing was changed." : "Nothing to move: the headaches are kept in the Headaches tracker already." };
  const entries = readEntries(mcDir);
  if (!entries.length) return { ok: false, reason: "There is no headache diary to move." };
  const before = episodesFrom(entries), rows = rowsFromEntries(entries, tz);
  const result = { ok: false, dry_run: dryRun, moved: { headaches: before.episodes.length, pills: rows.length - before.episodes.length } };
  if (dryRun) {
    // Each row as the notebook would hold it: written to text and read back, nothing on disk.
    const items = rows.map((data, i) => decodeRecord(encodeRecord({ format: 1, type: "collection_items", id: "collection-items-dry" + i, uid: "dry-" + i, title: data.when, collection_id: "dry", data })));
    Object.assign(result, compareLogs(before, logFromRows(items, tz), tz, now));
    result.ok = result.same;
    return result;
  }
  let tracker, written = [];
  withNotebookLock(mcDir, () => {
    tracker = createTracker(mcDir, { fields: FIELDS.map((f) => ({ ...f })), names: [...NAMES], now });
    written = writeItems(mcDir, tracker, { put: rows.map((data) => ({ item: null, data, title: data.when })) }, now);
  });
  // Read back from the files, as every reader will read them from now on.
  const after = logFromRows(readItems(mcDir, tracker), tz);
  Object.assign(result, compareLogs(before, after, tz, now), { tracker: { id: tracker.id, name: tracker.name, file: path.relative(mcDir, tracker._file).split(path.sep).join("/") } });
  if (!result.same) {
    withNotebookLock(mcDir, () => { for (const r of [...written, tracker]) try { fs.unlinkSync(r._file); } catch {} });
    result.reason = "The rows did not come out the same, so they were taken away again and the old diary is still the diary.";
    return result;
  }
  const day = localParts(now, tz).date, archive = freeDir(path.join(mcDir, "archives", `${day}-headache-diary`));
  fs.mkdirSync(archive, { recursive: true });
  fs.renameSync(entriesDir(mcDir), path.join(archive, "entries"));
  const readme = path.join(mcDir, ROOT, "README.md");
  if (fs.existsSync(readme)) fs.renameSync(readme, path.join(archive, "README.md"));
  const where = path.relative(mcDir, archive).split(path.sep).join("/");
  fs.writeFileSync(path.join(archive, "MOVED.md"), `# Moved\n\nThese are the headache diary's entry files as they were on ${day}, when every headache moved into the notebook's Headaches tracker. Every headache and every day was checked to be the same before they moved here. Nothing reads them any more.\n`);
  fs.writeFileSync(entriesDir(mcDir), guardText(day, where));
  fs.writeFileSync(readme, readmeText(day, where));
  Object.assign(result, { ok: true, archive: where });
  return result;
}

export const guardText = (day, where) => `Your headaches are kept in the notebook's Headaches tracker since ${day}.\nThe diary that was here is in ${where}/.\n\nThis is a file on purpose: an older godspeed-headache that still writes this folder stops\nhere with an error and saves nothing, so a second diary cannot start. Run its setup again\nto update it.\n`;
export const readmeText = (day, where) => `# headache\n\nYour headaches are rows of the notebook's Headaches tracker: one row per headache, and one per pill taken with no headache going on. Change a row in the notebook and the next command reads your change.\n\`godspeed-headache list\` shows the headaches, \`godspeed-headache patterns\` what they have in common. The settings are in settings.json.${day ? ` The diary kept here until ${day} is in ${where}/.` : ""}\n`;

export function renderMigration(r) {
  if (r.reason && !r.days) return r.reason;
  const L = [];
  const eq = r.episodes.filter((e) => e.same).length, days = r.days.filter((d) => d.same).length;
  L.push(`${r.dry_run ? "Would move" : "Moved"} ${r.moved.headaches} headaches and ${r.moved.pills} pills taken with no headache into the Headaches tracker.`);
  L.push(`Every headache, field by field: ${eq} of ${r.episodes.length} the same.`);
  L.push(`Pills with no headache: ${r.pills.same ? "the same" : "different"} (${r.pills.before.length} before, ${r.pills.after.length} after).`);
  L.push(`Every day from ${r.days[0]?.date ?? "-"} to ${r.days.at(-1)?.date ?? "-"} (headaches, minutes, strongest pain, painkiller doses): ${days} of ${r.days.length} the same.`);
  for (const d of r.days) {
    const f = (x) => `${x.headache_episodes} headache${x.headache_episodes === 1 ? "" : "s"}, ${x.headache_min} min, pain ${x.headache_max_pain ?? "-"}, ${x.painkiller_doses} dose${x.painkiller_doses === 1 ? "" : "s"}`;
    L.push(`- ${d.date}: before ${f(d.before)}; after ${f(d.after)}${d.same ? "" : "  DIFFERENT"}`);
  }
  for (const e of r.episodes.filter((x) => !x.same)) L.push(`- ${e.id} differs: ${e.differences.map((d) => `${d.field} ${JSON.stringify(d.before)} became ${JSON.stringify(d.after)}`).join("; ")}`);
  L.push(r.ok ? (r.dry_run ? "Nothing was written (dry run)." : `The old diary is in ${r.archive}/.`) : r.reason || "Not moved.");
  return L.join("\n");
}
