// The notebook's Charm Challenge tracker, as files. In a mission control with the Godspeed notebook,
// every event of the challenge (start, slip question, reset, finish) is one row of a collection
// whose tracker card names the specialist "charm": the notebook shows it as a table a person can
// sort and edit, and this command reads and writes the same rows. The notebook keeps every record as a Markdown file with
// YAML front matter; this module reads and writes only the two kinds the challenge needs, the tracker
// (a collection) and its rows (collection items), the way the notebook writes them: the same front
// matter (lib/yaml.mjs is the notebook's own YAML module, copied), the same folder and file name
// rules, a tombstone in _system/ when a row is removed. It writes under the notebook's own writer
// lock and names what it wrote in the notebook's change journal, so a running notebook never
// writes at the same moment and sees the change at once. It never opens any other record.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { threadId } from "node:worker_threads";
import { stringify, parse } from "./yaml.mjs";

export const SPECIALIST = "charm";
const NOTEBOOK = "notebook";
const SYSTEM = "_system";
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
// A mission control with the notebook: its records folder and its machine state.
export const hasNotebook = (mcDir) => isDir(path.join(mcDir, NOTEBOOK)) && isDir(path.join(mcDir, ".godspeed"));

// ---- The notebook's record files ----------------------------------------------------------------
const WORDS = { collection: "collections", "collection item": "collection_items" };
const LAYOUT = {
  collections: { word: "collection", body: "description", first: ["name", "slug"] },
  collection_items: { word: "collection item", first: ["title", "collection_id", "data"] },
};
// Readable front matter uses these names for these fields (the notebook's layout.mjs RENAMES).
const RENAMES = [["created_at", "created"], ["updated_at", "modified"], ["is_favorite", "favorite"], ["is_pinned", "pinned"], ["is_sensitive", "sensitive"]];
const FRONT = /^---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n([\s\S]*))?$/;

// One record file's text as the notebook reads it, or null for anything that is not a record.
export function decodeRecord(text) {
  let source = String(text);
  if (source.charCodeAt(0) === 0xfeff) source = source.slice(1);
  const m = source.match(FRONT);
  if (!m) return null;
  let data;
  try { data = parse(m[1] ?? ""); } catch { return null; }
  if (!data || typeof data !== "object" || !Object.hasOwn(data, "uid") || data.format !== 1) return null;
  const type = WORDS[data.type] || data.type;
  const shown = new Map(RENAMES.filter(([field, name]) => Object.hasOwn(data, name) && !Object.hasOwn(data, field)).map(([field, name]) => [name, field]));
  const record = {};
  for (const [key, value] of Object.entries(data)) record[key === "type" ? "type" : shown.get(key) || key] = key === "type" ? type : value;
  const layout = LAYOUT[type];
  if (layout?.body && ((m[2] ?? "") !== "" || !Object.hasOwn(data, layout.body))) record[layout.body] = m[2] ?? "";
  return record;
}

// A record as the notebook writes it (its layout.mjs encode, for these two kinds).
export function encodeRecord(record) {
  const { _file, ...value } = record;
  const layout = LAYOUT[value.type];
  if (!layout) throw new Error("Only the tracker and its rows are written here");
  const plain = JSON.parse(JSON.stringify(value));
  const front = { id: plain.id, type: layout.word }, used = new Set(["id", "type"]);
  const body = layout.body && typeof plain[layout.body] === "string" ? layout.body : null;
  if (body) used.add(body);
  const renamed = new Map(RENAMES.filter(([field, name]) => Object.hasOwn(plain, field) && !Object.hasOwn(plain, name)));
  const put = (field) => { if (used.has(field) || !Object.hasOwn(plain, field)) return; used.add(field); front[renamed.get(field) || field] = plain[field]; };
  for (const field of layout.first) put(field);
  for (const field of ["created_at", "updated_at", "tags", "aliases", "is_favorite", "is_pinned", "is_sensitive"]) put(field);
  for (const field of Object.keys(plain)) put(field);
  return "---\n" + stringify(front) + "---\n" + (body ? plain[body] : "");
}

// The notebook's file names (its layout.mjs sanitizeName): no <>:"/\|?*, spaces collapsed, at
// most 200 characters and bytes, no leading dot, no trailing dot or space, no device name
// Windows reserves.
const RESERVED = /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?=\.|$)/i;
export function sanitizeName(value, fallback = "Untitled") {
  let name = String(value ?? "").normalize("NFC").replace(/[<>:"/\\|?*]/g, "").replace(/\s+/g, " ").replace(/[\u0000-\u001f\u007f]/g, "").trim().replace(/^[.\s]+/, "");
  const points = [...name]; let bytes = 0, end = 0;
  for (; end < points.length && end < 200; end++) { bytes += Buffer.byteLength(points[end]); if (bytes > 200) break; }
  name = points.slice(0, end).join("").replace(/[.\s]+$/, "").replace(RESERVED, "$1_");
  return name || fallback;
}
const guarded = (part) => (/^(secrets|node_modules)$/i.test(part) ? part + "_" : part);
const nameKey = (name) => { const text = String(name); return (/^[\x20-\x7e]*$/.test(text) ? text : text.normalize("NFC")).toLowerCase(); };
const itemsFolder = (tracker) => "Collections/" + guarded(sanitizeName(tracker.name, "Unfiled"));

function readRecord(file) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return null; }
  const record = decodeRecord(text);
  return record ? Object.assign(record, { _file: file }) : null;
}
const markdownIn = (dir) => { try { return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile() && e.name.endsWith(".md") && !e.name.startsWith(".")).map((e) => path.join(dir, e.name)); } catch { return []; } };

// The Charm Challenge tracker: a live collection whose tracker card names this specialist. Should
// there ever be two, the oldest is the record, so the count is never split between them.
export function findTracker(mcDir) {
  const found = markdownIn(path.join(mcDir, NOTEBOOK, "Collections")).map(readRecord)
    .filter((r) => r && r.type === "collections" && !r.removed_at && r.tracker && typeof r.tracker === "object" && r.tracker.specialist === SPECIALIST);
  return found.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)))[0] || null;
}

// Its rows: every live item that names it, wherever under Collections/ the notebook keeps them.
export function readItems(mcDir, tracker) {
  if (!tracker) return [];
  const root = path.join(mcDir, NOTEBOOK, "Collections");
  let folders = [];
  try { folders = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => path.join(root, e.name)); } catch {}
  return folders.flatMap(markdownIn).map(readRecord).filter((r) => r && r.type === "collection_items" && r.collection_id === tracker.id && !r.removed_at);
}

// ---- The writer lock (the notebook's records/store.mjs protocol) --------------------------------
// One writer at a time across every program that opens the workspace. The lock is a file created
// with "wx" that names its writer; only the writer that holds it removes it, and a lock whose
// writer is gone is taken over under a short break lock, never two at once.
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function lockIsStale(text, stat) {
  let owner = null; try { owner = JSON.parse(text); } catch {}
  if (!owner || typeof owner !== "object" || !Number.isInteger(owner.pid) || owner.pid <= 0) return Date.now() - stat.mtimeMs >= 10000;
  const at = Number.isFinite(Date.parse(owner.at)) ? Date.parse(owner.at) : stat.mtimeMs;
  if (at < Date.now() - os.uptime() * 1000 - 60000) return true;
  if (owner.pid === process.pid) return at < Date.now() - process.uptime() * 1000 - 1000;
  try { process.kill(owner.pid, 0); return false; } catch (error) { return error.code === "ESRCH"; }
}
function lookAt(lock) {
  const before = fs.statSync(lock, { bigint: true }), text = fs.readFileSync(lock, "utf8"), after = fs.statSync(lock, { bigint: true });
  if (before.ino !== after.ino || before.mtimeNs !== after.mtimeNs || before.size !== after.size) return null;
  return { text, ino: after.ino, mtimeMs: Number(after.mtimeMs) };
}
function takeOver(lock) {
  let seen; try { seen = lookAt(lock); } catch (error) { return error.code === "ENOENT"; }
  if (!seen || !lockIsStale(seen.text, seen)) return false;
  const breaker = lock + ".break", mine = randomUUID(); let fd;
  try { fd = fs.openSync(breaker, "wx"); } catch (error) {
    if (error.code === "EEXIST") try { if (Date.now() - fs.statSync(breaker).mtimeMs > 10000) fs.unlinkSync(breaker); } catch {}
    return false;
  }
  try {
    fs.writeFileSync(fd, mine);
    let again; try { again = lookAt(lock); } catch (error) { return error.code === "ENOENT"; }
    if (!again || again.ino !== seen.ino || again.text !== seen.text || !lockIsStale(again.text, again)) return false;
    try { fs.unlinkSync(lock); } catch (error) { return error.code === "ENOENT"; }
    return true;
  } catch { return false; }
  finally { try { fs.closeSync(fd); } catch {} try { if (fs.readFileSync(breaker, "utf8") === mine) fs.unlinkSync(breaker); } catch {} }
}
function release(lock, token, ino) {
  let text, stat; try { stat = fs.statSync(lock, { bigint: true }); text = fs.readFileSync(lock, "utf8"); } catch (error) { if (error.code === "ENOENT") return; throw error; }
  let owner = null; try { owner = JSON.parse(text); } catch {}
  if (owner?.token !== token && !(owner === null && ino && stat.ino === ino)) return;
  for (let tries = 0; ; tries++) {
    try { fs.unlinkSync(lock); return; } catch (error) {
      if (error.code === "ENOENT") return;
      if (process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(error.code) || tries > 100) throw error;
      sleep(25);
    }
  }
}
export function withNotebookLock(mcDir, work, { timeoutMs = 20000 } = {}) {
  const lock = path.join(mcDir, ".godspeed", "workspace.lock"), token = randomUUID(), deadline = Date.now() + timeoutMs;
  let fd;
  for (;;) {
    try { fd = fs.openSync(lock, "wx"); break; } catch (error) {
      if (!["EEXIST", "EPERM", "EACCES", "EBUSY"].includes(error.code)) throw error;
      if (error.code === "EEXIST" && takeOver(lock)) continue;
      if (Date.now() >= deadline) throw new Error("The notebook is busy writing, so nothing was saved. Say it again in a moment.");
      sleep(25 + Math.floor(Math.random() * 25));
    }
  }
  let ino;
  try { ino = fs.fstatSync(fd, { bigint: true }).ino; fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, thread: threadId, token, at: new Date().toISOString() })); fs.fsyncSync(fd); }
  catch (error) { try { fs.closeSync(fd); } catch {} try { release(lock, token, ino); } catch {} throw error; }
  fs.closeSync(fd);
  try { return work(); } finally { release(lock, token, ino); }
}

// ---- Writing ------------------------------------------------------------------------------------
export function atomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + "." + randomUUID() + ".tmp";
  const fd = fs.openSync(tmp, "wx");
  try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  for (let tries = 0; ; tries++) {
    try { fs.renameSync(tmp, file); return; } catch (error) {
      if (process.platform !== "win32" || !["EPERM", "EACCES", "EBUSY"].includes(error.code) || tries > 60) { try { fs.unlinkSync(tmp); } catch {} throw error; }
      sleep(25);
    }
  }
}
// What this writer changed, for every notebook that watches the folder (the notebook's
// store.mjs journal): one line per file, "<writer>\t<path under notebook/>".
function journal(mcDir, names) {
  if (!names.length) return;
  const file = path.join(mcDir, ".godspeed", "changes.log");
  let fresh = true; try { fresh = fs.statSync(file).size >= 4 * 1024 * 1024; } catch {}
  if (fresh) fs.writeFileSync(file, "#" + randomUUID() + "\n");
  const writer = process.pid + "-" + randomUUID().slice(0, 8);
  fs.appendFileSync(file, names.map((name) => writer + "\t" + name + "\n").join(""));
}
const relative = (mcDir, file) => path.relative(path.join(mcDir, NOTEBOOK), file).split(path.sep).join("/");
function device(mcDir) {
  if (process.env.GODSPEED_DEVICE && process.env.GODSPEED_DEVICE !== "local") return process.env.GODSPEED_DEVICE;
  try { const id = JSON.parse(fs.readFileSync(path.join(mcDir, ".godspeed", "device.json"), "utf8")).id; if (/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,180}$/.test(id || "")) return id; } catch {}
  return "local";
}
const readableSlug = (value) => String(value).replace(/[äÄ]/g, "ae").replace(/[öÖ]/g, "oe").replace(/[üÜ]/g, "ue").replace(/ß/g, "ss").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "record";

// A free file name for a title in a folder: the title, or the title with a number, as the notebook
// names a second page of the same title. `own` is the file this record has now, which stays its own.
function freeName(dir, title, own) {
  const base = sanitizeName(title);
  const taken = new Set(markdownIn(dir).filter((f) => f !== own).map((f) => nameKey(path.basename(f))));
  for (let n = 1; ; n++) {
    const name = (n > 1 ? base + " " + n : base) + ".md";
    if (!taken.has(nameKey(name))) return path.join(dir, name);
  }
}
// Whether a record's current file still fits its title (the notebook's layout.mjs fits).
function fits(file, title) {
  const base = path.basename(file).slice(0, -3).normalize("NFC"), name = sanitizeName(title);
  return base === name || (base.startsWith(name + " ") && /^(?:[2-9]|[1-9]\d+)$/.test(base.slice(name.length + 1)));
}

// The tracker itself, made the way the notebook makes a collection (its query.mjs defaults). No
// coaching talk reads it, so it never names one.
export function createTracker(mcDir, { name = "Charm Challenge", fields, names, talk = null, now = new Date() }) {
  const existing = markdownIn(path.join(mcDir, NOTEBOOK, "Collections")).map(readRecord).filter((r) => r && r.type === "collections");
  const plain = readableSlug(name);
  const uid = randomUUID(), stamp = now.toISOString();
  const slug = existing.some((r) => String(r.slug || "").toLowerCase() === plain) ? plain + "-" + uid.slice(0, 8) : plain;
  const record = {
    tags: [], aliases: [], references: [], metadata: {}, user_id: "owner",
    field_schema: fields, visibility: "personal", icon: "✨", description: "Tracker", agent_instructions: null, settings: {},
    name, tracker: { names: names || [name], cadence: "any", talk, specialist: SPECIALIST },
    format: 1, type: "collections", id: readableSlug(name) + "-" + uid.slice(0, 8), uid, device: device(mcDir), revision: 1, created_at: stamp, updated_at: stamp, slug,
  };
  const file = freeName(path.join(mcDir, NOTEBOOK, "Collections"), name, null);
  atomic(file, encodeRecord(record));
  journal(mcDir, [relative(mcDir, file)]);
  return Object.assign(record, { _file: file });
}

// Writes rows: `put` is a list of {item?, data, title} (item: the current record, for a change),
// `remove` a list of current records. Returns the records written. Call it under withNotebookLock.
export function writeItems(mcDir, tracker, { put = [], remove = [] }, now = new Date()) {
  const stamp = now.toISOString(), dir = path.join(mcDir, NOTEBOOK, ...itemsFolder(tracker).split("/")), names = [], written = [];
  for (const { item, data, title } of put) {
    let record;
    if (item) {
      // A change keeps everything the notebook or he put on the row; data is replaced whole.
      const { _file, ...old } = item;
      record = { ...old, title, data, revision: (old.revision || 0) + 1, updated_at: stamp };
    } else {
      const uid = randomUUID();
      record = {
        tags: [], aliases: [], references: [{ type: "collections", id: tracker.id, uid: tracker.uid, field: "collection_id" }], metadata: {}, user_id: "owner",
        data, is_favorite: false, folder_id: null, last_viewed_at: null, collection_id: tracker.id,
        format: 1, type: "collection_items", id: "collection-items-" + uid.slice(0, 8), uid, device: device(mcDir), revision: 1, created_at: stamp, updated_at: stamp, title,
      };
    }
    const keep = item && path.dirname(item._file) === dir && fits(item._file, title);
    const file = keep ? item._file : freeName(dir, title, item?._file);
    atomic(file, encodeRecord(record));
    names.push(relative(mcDir, file));
    if (item && item._file !== file) { try { fs.unlinkSync(item._file); } catch {} names.push(relative(mcDir, item._file)); }
    written.push(Object.assign(record, { _file: file }));
  }
  for (const item of remove) {
    // A removed row becomes a tombstone in _system/, as the notebook's own delete makes one, so the
    // removal reaches every machine and nothing that named it is left pointing at nothing.
    const { _file, ...old } = item;
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,180}$/.test(old.id || "") || old.id.includes("..")) throw new Error("A row with an unreadable id cannot be removed here; remove it in the notebook.");
    const tomb = { ...old, revision: (old.revision || 0) + 1, updated_at: stamp, removed_at: stamp };
    const file = path.join(mcDir, NOTEBOOK, SYSTEM, "collection_items", item.id + ".md");
    atomic(file, encodeRecord(tomb));
    try { fs.unlinkSync(_file); } catch {}
    names.push(relative(mcDir, file), relative(mcDir, _file));
  }
  journal(mcDir, names);
  return written;
}
