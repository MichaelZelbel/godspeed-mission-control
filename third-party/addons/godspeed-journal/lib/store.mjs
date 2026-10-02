// One file per entry. Two devices writing at the same minute never touch the same file, so
// git never has a conflict to resolve, which is the same reason world/ keeps one event per file.
import fs from "node:fs";
import path from "node:path";
import { localParts, now } from "./clock.mjs";

const ARRAYS = new Set(["done_means", "met", "missed"]);
const ORDER = ["at", "kind", "task", "title", "done_means", "met", "missed", "evidence", "evidence_id", "evidence_at", "source"];

export function slugify(text) {
  const s = String(text || "").replace(/ß/g, "ss").replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue")
    .replace(/Ä/g, "ae").replace(/Ö/g, "oe").replace(/Ü/g, "ue")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/, "");
  return s || "task";
}

export function taskId(date, tz, title) {
  const p = localParts(date, tz);
  return `t-${p.date.replaceAll("-", "")}-${p.hm.replace(":", "")}-${slugify(title)}`;
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
    e[k] = ARRAYS.has(k) ? JSON.parse(v) : v;
  }
  e.words = m[2].trim();
  return e;
}

export function writeEntry(mcDir, settings, entry, at = now()) {
  const p = localParts(at, settings.timezone);
  const rel = path.join("routines", "journal", "entries", p.y, p.m, p.d);
  fs.mkdirSync(path.join(mcDir, rel), { recursive: true });
  const label = entry.title || entry.words || entry.kind;
  const base = `${p.hms}-${entry.kind}-${slugify(label).slice(0, 24).replace(/-+$/, "")}`;
  let name = `${base}.md`;
  for (let n = 2; fs.existsSync(path.join(mcDir, rel, name)); n++) name = `${base}-${n}.md`;
  const full = { ...entry, at: at.toISOString() };
  fs.writeFileSync(path.join(mcDir, rel, name), serialize(full));
  return { file: path.join(rel, name).replace(/\\/g, "/"), entry: full };
}

export function readEntries(mcDir, settings, { days = 8, until = now() } = {}) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const p = localParts(new Date(until.getTime() - i * 86400000), settings.timezone);
    const dir = path.join(mcDir, "routines", "journal", "entries", p.y, p.m, p.d);
    let names = [];
    try { names = fs.readdirSync(dir).filter((n) => n.endsWith(".md")); } catch { continue; }
    for (const n of names) {
      const e = parse(fs.readFileSync(path.join(dir, n), "utf8"));
      if (e && e.at && new Date(e.at) <= until) out.push(e);
    }
  }
  const seen = new Set();
  return out.filter((e) => { const k = e.at + e.kind + (e.task || "") + e.words; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.at.localeCompare(b.at) || rank(a) - rank(b));
}

// Two entries at the same instant (a frozen clock, a script writing several at once) are read in
// the order they can happen in, not the order their file names sort in: "done" sorts before
// "start" alphabetically, and a done read before its start is dropped, leaving the task open.
const RANK = { start: 0, define: 1, note: 2, done: 3, drop: 3, met: 4, reopen: 5 };
const rank = (e) => RANK[e.kind] ?? 6;
