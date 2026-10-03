// One file per entry, and entries are only ever added. Ending a headache is a new entry that
// names the episode, never an edit of the one that started it, so two devices writing at the
// same minute never touch the same file and git never has a conflict to resolve. This is the
// same reason world/ keeps one event per file and never edits an event.
import fs from "node:fs";
import path from "node:path";
import { localParts } from "./clock.mjs";

export const ROOT = path.join("routines", "headache");
const ARRAYS = new Set(["symptoms", "triggers"]);
const ORDER = ["at", "kind", "episode", "start", "end", "pain", "side", "quality", "symptoms", "triggers", "med", "dose", "taken", "source"];

export function slugify(text) {
  const s = String(text || "").replace(/ß/g, "ss").replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
    .replace(/Ä/g, "ae").replace(/Ö/g, "oe").replace(/Ü/g, "ue")
    .normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return s || "entry";
}

export function serialize(e) {
  const lines = ["---"];
  for (const k of ORDER) {
    if (e[k] === undefined || e[k] === null || e[k] === "") continue;
    if (ARRAYS.has(k)) { if (e[k].length) lines.push(`${k}: ${JSON.stringify(e[k])}`); }
    else lines.push(`${k}: ${String(e[k]).replace(/[\r\n]+/g, " ").trim()}`);
  }
  lines.push("---", String(e.words || "").trim(), "");
  return lines.join("\n");
}

export function parse(text) {
  const m = String(text).replace(/\r\n/g, "\n").match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return null;
  const e = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i < 1) continue;
    const k = line.slice(0, i).trim(); const v = line.slice(i + 1).trim();
    if (ARRAYS.has(k)) { try { e[k] = JSON.parse(v); } catch { e[k] = []; } }
    else if (k === "pain") e[k] = Number(v);
    else e[k] = v;
  }
  e.words = m[2].trim();
  return e;
}

// Several entries written by one command (a start with its pill) share one moment and are
// told apart by `seq`, which only orders them in the file name.
export function writeEntry(mcDir, settings, entry, at, seq = 0) {
  const p = localParts(at, settings.timezone);
  const rel = path.join(ROOT, "entries", p.y, p.m, p.d);
  fs.mkdirSync(path.join(mcDir, rel), { recursive: true });
  const base = `${p.hms}${seq ? `-${seq}` : ""}-${entry.kind}-${slugify(entry.episode || entry.med || "")}`.replace(/-+$/, "");
  let name = `${base}.md`;
  for (let n = 2; fs.existsSync(path.join(mcDir, rel, name)); n++) name = `${base}-${n}.md`;
  const full = { ...entry, at: at.toISOString() };
  fs.writeFileSync(path.join(mcDir, rel, name), serialize(full));
  return { file: path.join(rel, name).replace(/\\/g, "/"), entry: full };
}

function walk(dir, out) {
  let items = [];
  try { items = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const it of items) {
    const p = path.join(dir, it.name);
    if (it.isDirectory()) walk(p, out);
    else if (it.name.endsWith(".md")) out.push(p);
  }
}

// Every entry ever written, oldest first. A person logs a few headaches a week, so reading
// all of them is cheap for years, and a pattern needs the long view anyway.
export function readEntries(mcDir) {
  const files = [];
  walk(path.join(mcDir, ROOT, "entries"), files);
  const out = [];
  for (const f of files) {
    const e = parse(fs.readFileSync(f, "utf8"));
    if (e && e.at && e.kind) { e._file = path.basename(f); out.push(e); }
  }
  return out.sort((a, b) => a.at.localeCompare(b.at) || a._file.localeCompare(b._file));
}
