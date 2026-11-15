// A talk's live questions: what the NEXT talk of an area must answer, written when a talk closes
// (or at the next tick for a talk that ended without a closing turn). One short plain file per area
// and next talk date, coach/<area>/questions/<next talk date>.md. The coach program writes it from
// the talk's record; the model only refines it through `godspeed-coach questions`. The nightly goal
// research (tools/mc-research) reads it for every goal the area serves, and the preparation reads
// it first. Only an area that serves a goal has questions; every other area is left alone.
import fs from "node:fs";
import path from "node:path";
import { parseDoc } from "./header.mjs";
import { addDays } from "./clock.mjs";
import { nextTalkDay } from "./areas.mjs";
import { readTalk, talkDates } from "./talks.mjs";
import { listHabits, verdict } from "./habits.mjs";

export const questionsDir = (area) => path.join(area.dir, "questions");
export const questionsFile = (area, ymd) => path.join(questionsDir(area), `${ymd}.md`);

export const hasQuestions = (area) => !area.noTalk && area.on && Boolean(area.rhythm) && area.serves.length > 0;

const norm = (t) => String(t || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const bare = (t) => one(t).replace(/[.!?\s]+$/, "");
const one = (t, n = 220) => { const c = String(t || "").replace(/\s+/g, " ").trim(); return c.length > n ? c.slice(0, n - 3).trimEnd() + "..." : c; };
const lineBody = (l) => l.replace(/^\s*[-*]\s*(\d\d:\d\d\s+)?/, "").trim();

const CORRECTION = /^(no|nope|nein|actually|eigentlich|wrong|falsch)\b|\b(that'?s wrong|that is wrong|is wrong|not true|isn'?t true|i already|stimmt nicht|that'?s not (right|true|correct))\b/i;
const ASK = /\b(look(?:ing)? into|find out|research|search|check (?:whether|if)|investigate|schau|recherchier)|\?\s*$/i;

export function readQuestions(file) {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const d = parseDoc(text);
  const items = [];
  for (const l of text.split("\n")) {
    if (l.startsWith("- ")) items.push({ text: l.slice(2).trim(), why: "", origin: "" });
    else if (items.length && /^\s+WHY:/.test(l)) items.at(-1).why = l.replace(/^\s+WHY:\s*/, "").trim();
    else if (items.length && /^\s+ORIGIN:/.test(l)) items.at(-1).origin = l.replace(/^\s+ORIGIN:\s*/, "").trim();
  }
  return { file, head: d.head, dropped: d.lists.DROPPED || [], items };
}

function formatQuestions(area, forYmd, from, items, dropped, at) {
  const head = [`QUESTIONS: ${area.slug}`, `FOR: ${forYmd}`, `FROM: ${from}`, `WRITTEN: ${at.toISOString().replace(/\.\d+Z$/, "Z")}`, ...dropped.map((x) => `DROPPED: ${x}`)];
  const body = items.map((i) => `- ${one(i.text, 400)}\n  WHY: ${one(i.why, 300)}\n  ORIGIN: ${i.origin}`);
  return head.join("\n") + "\n\n" + body.join("\n\n") + "\n";
}

function goalHead(mcDir, id) {
  const f = path.join(mcDir, "goals", `${id}.md`);
  return fs.existsSync(f) ? parseDoc(fs.readFileSync(f, "utf8")).head : {};
}

// What the talk's record gives, deterministically. Order: goals, what the talk decided, what they
// corrected, what they asked for, their data.
export function buildItems(mcDir, area, talkYmd) {
  const t = readTalk(area, talkYmd);
  const items = [];
  for (const id of area.serves) {
    const h = goalHead(mcDir, id);
    const title = h.TITLE || id;
    items.push({ text: `What is the newest strong evidence for the next step on "${title}"${h.MEASURE ? ` (measure: ${h.MEASURE})` : ""}?`, why: `The ${area.title} talk serves this goal, and the next talk needs to move it.`, origin: `goal ${id}` });
  }
  if (t) {
    const said = (t.sections["What you said"] || t.sections["What he said"] || "").split("\n").map(lineBody).filter(Boolean);
    const changed = (t.sections["What changed"] || "").split("\n").map(lineBody).filter((l) => l && !/^nothing yet\b/i.test(l));
    const corrections = (t.sections.Corrections || "").split("\n").map(lineBody).filter(Boolean);
    for (const l of changed) items.push({ text: `Is "${bare(l)}" working for them, and what does the evidence say about it?`, why: `The ${talkYmd} talk decided or promised it.`, origin: "changed" });
    const asked = [];
    for (const l of said) {
      if (corrections.includes(l)) continue;
      if (l.split(/\s+/).length >= 4 && CORRECTION.test(l)) corrections.push(l);
      else if (ASK.test(l)) asked.push(l);
    }
    for (const l of corrections) items.push({ text: `They corrected this: "${bare(l)}". What is true, according to the sources?`, why: `They corrected it in the ${talkYmd} talk; the next talk must not repeat the mistake.`, origin: "corrected" });
    for (const l of asked) items.push({ text: `They asked: "${bare(l)}". What did the research find?`, why: `They asked for it in the ${talkYmd} talk.`, origin: "asked" });
  }
  const habits = listHabits(mcDir, { status: "active" }).filter((h) => h.area === area.slug || (h.readBy || []).includes(area.slug));
  for (const h of habits) {
    if (verdict(h, talkYmd) === "struggling") items.push({ text: `"${h.title}" is under half for two weeks. What would make it easier or smaller, according to the evidence?`, why: "Their own habit record, which the area reads.", origin: "data" });
  }
  for (const r of area.lists["MAY READ"] || []) items.push({ text: `What does ${one(r, 100)} show since the talk, and does it change the plan?`, why: "The area may read it, and it is their current data.", origin: "data" });
  return items;
}

export function nextDateAfter(area, talkYmd, fromYmd = "") {
  const day = addDays(talkYmd, 1);
  return nextTalkDay(area, fromYmd > day ? fromYmd : day);
}

// Writes (or rewrites) the questions for the talk after `talkYmd`. The program's own items are
// rebuilt from the record; items added through the coach's command are kept; one dropped stays dropped.
// `fromYmd` is the day the coach looks: a talk closed or noticed late gets its questions for the first
// talk day on or after it, because the research reads only questions for a talk still to come.
export function writeQuestions(mcDir, area, talkYmd, at = new Date(), fromYmd = "") {
  if (!hasQuestions(area)) return null;
  const next = nextDateAfter(area, talkYmd, fromYmd);
  if (!next) return null;
  const file = questionsFile(area, next);
  const before = readQuestions(file);
  const dropped = before?.dropped || [];
  const seen = new Set(dropped.map(norm));
  const items = [];
  for (const i of [...buildItems(mcDir, area, talkYmd), ...(before?.items || []).filter((x) => x.origin === "added")]) {
    const k = norm(i.text);
    if (!k || seen.has(k)) continue;
    seen.add(k); items.push(i);
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, formatQuestions(area, next, `talk ${talkYmd}`, items, dropped, at));
  return { file, date: next, count: items.length };
}

// The earliest questions file for a talk on or after `fromYmd`.
export function openQuestionsDate(area, fromYmd) {
  const dir = questionsDir(area);
  if (!fs.existsSync(dir)) return null;
  return fs.readdirSync(dir).map((n) => n.match(/^(\d{4}-\d{2}-\d{2})\.md$/)?.[1]).filter(Boolean).sort().find((d) => d >= fromYmd) || null;
}

export function addQuestion(area, ymd, text, why, at = new Date()) {
  const file = questionsFile(area, ymd);
  const q = readQuestions(file) || { head: { FROM: "added by hand" }, dropped: [], items: [] };
  const t = one(text, 400);
  if (!t) throw new Error("Give the question.");
  if (q.items.some((i) => norm(i.text) === norm(t))) return { file, changed: false };
  q.items.push({ text: t, why: one(why || "They asked for it.", 300), origin: "added" });
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, formatQuestions(area, ymd, q.head.FROM || "added by hand", q.items, q.dropped.filter((d) => norm(d) !== norm(t)), at));
  return { file, changed: true };
}

export function dropQuestion(area, ymd, words, at = new Date()) {
  const file = questionsFile(area, ymd);
  const q = readQuestions(file);
  if (!q) throw new Error(`There are no questions for the ${area.title} talk of ${ymd}.`);
  const w = norm(words);
  if (!w) throw new Error("Say which question to drop.");
  const hit = q.items.filter((i) => norm(i.text).includes(w));
  if (!hit.length) throw new Error(`No question matches "${one(words, 60)}". Questions: ${q.items.map((i) => i.text).join(" / ")}`);
  if (hit.length > 1) throw new Error(`Several questions match "${one(words, 60)}": ${hit.map((i) => i.text).join(" / ")}. Say which one.`);
  const gone = hit[0];
  const rest = q.items.filter((i) => i !== gone);
  const dropped = gone.origin === "added" ? q.dropped : [...q.dropped, gone.text];
  fs.writeFileSync(file, formatQuestions(area, ymd, q.head.FROM || "", rest, dropped, at));
  return { file, dropped: gone.text };
}

// A talk that was answered but never closed: the latest talk before today, however long ago, that was
// answered (a later talk the person never answered does not hide it) and has no questions file for its
// next talk or any later one. Used by the tick, which writes them for the first talk day on or after
// today. Once written, the file exists and the talk is not seen again.
export function unclosedTalk(area, todayYmd) {
  if (!hasQuestions(area)) return null;
  for (const d of talkDates(area).filter((x) => x < todayYmd).reverse()) {
    const t = readTalk(area, d);
    if (!t.answered || t.state === "not-held") continue;
    const first = nextDateAfter(area, d);
    return !first || openQuestionsDate(area, first) ? null : d;
  }
  return null;
}
