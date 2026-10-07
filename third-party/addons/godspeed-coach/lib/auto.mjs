// Some habits are already known to a device: a run reaches the daily table from the phone, and so
// does a day of food logging. A habit with an AUTO rule ("run_km > 0") is ticked from that table and
// is never asked about, because asking for what a device already knows is the one thing the health
// rules forbid.
import fs from "node:fs";
import { dueOn, answerOn } from "./habits.mjs";

const RULE = /^([A-Za-z0-9_]+)\s*(>=|<=|>|<|=)\s*(-?\d+(?:\.\d+)?)$/;

export function parseAuto(rule) {
  const m = String(rule || "").trim().match(RULE);
  return m ? { column: m[1], op: m[2], value: Number(m[3]) } : null;
}

function splitCsv(line) {
  const out = []; let cur = ""; let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

export function readTable(file) {
  if (!file || !fs.existsSync(file)) return {};
  const lines = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n").split("\n").filter(Boolean);
  if (!lines.length) return {};
  const cols = splitCsv(lines[0]).map((c) => c.trim());
  const di = cols.indexOf("date");
  if (di === -1) return {};
  const out = {};
  for (const l of lines.slice(1)) {
    const v = splitCsv(l);
    const row = {};
    cols.forEach((c, i) => { row[c] = (v[i] ?? "").trim(); });
    if (/^\d{4}-\d{2}-\d{2}$/.test(row.date)) out[row.date] = row;
  }
  return out;
}

const holds = (x, op, v) => (op === ">" ? x > v : op === ">=" ? x >= v : op === "<" ? x < v : op === "<=" ? x <= v : x === v);

export function autoTicks(habits, table, ymds) {
  const out = [];
  for (const h of habits) {
    const r = parseAuto(h.auto);
    if (!r) continue;
    for (const d of ymds) {
      if (!dueOn(h, d) || answerOn(h, d)) continue;
      const raw = table[d]?.[r.column];
      if (raw === undefined || raw === "" || isNaN(Number(raw))) continue;
      if (holds(Number(raw), r.op, r.value)) out.push({ habit: h, ymd: d, words: `${r.column} ${raw}` });
    }
  }
  return out;
}
