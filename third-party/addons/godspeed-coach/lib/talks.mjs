// One file per talk, coach/<area>/talks/<date>.md, written when the talk opens. Its STATE says what
// became of it: opened (waiting for him), held, or not-held. The file existing is the proof the talk
// happened for work/commitments/, so a talk that got no answer still leaves a record.
import fs from "node:fs";
import path from "node:path";
import { parseDoc, setHead, appendToSection, formatDoc } from "./header.mjs";
import { localParts, zonedToUtc, addDays } from "./clock.mjs";
import { talkMoment, isTalkDay, listAreas } from "./areas.mjs";

export const OPEN_WINDOW_HOURS = 6;

export const talksDir = (area) => path.join(area.dir, "talks");
export const talkFile = (area, ymd) => path.join(talksDir(area), `${ymd}.md`);

export function readTalk(area, ymd) {
  const f = talkFile(area, ymd);
  if (!fs.existsSync(f)) return null;
  const d = parseDoc(fs.readFileSync(f, "utf8"));
  return {
    ymd, file: f, state: (d.head.STATE || "opened").toLowerCase(), opened: d.head.OPENED || "",
    followUp: d.head["FOLLOW-UP"] || "", sections: d.sections,
    answered: Boolean((d.sections["What you said"] || d.sections["What he said"] || "").trim()),
  };
}

export function talkDates(area) {
  const dir = talksDir(area);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).map((n) => n.match(/^(\d{4}-\d{2}-\d{2})\.md$/)?.[1]).filter(Boolean).sort();
}

export function lastTalk(area, beforeYmd) {
  const ds = talkDates(area).filter((d) => !beforeYmd || d < beforeYmd);
  return ds.length ? readTalk(area, ds.at(-1)) : null;
}

export function openTalk(area, ymd, { opening = "", read = "" } = {}, now = new Date()) {
  const f = talkFile(area, ymd);
  // Opened twice (a retry after the first message did go out): keep the first record.
  if (fs.existsSync(f)) return { file: f, created: false };
  fs.mkdirSync(path.dirname(f), { recursive: true });
  const text = formatDoc(
    { TALK: area.slug, DATE: ymd, STATE: "opened", OPENED: now.toISOString().replace(/\.\d+Z$/, "Z"), "FOLLOW-UP": "" },
    { "What was read": read, "The opening": opening, "What you said": "", "What changed": "" },
  );
  fs.writeFileSync(f, text);
  return { file: f, created: true };
}

function rewrite(area, ymd, fn) {
  const f = talkFile(area, ymd);
  if (!fs.existsSync(f)) throw new Error(`There is no ${area.slug} talk on ${ymd}.`);
  fs.writeFileSync(f, fn(fs.readFileSync(f, "utf8")));
  return f;
}

export const setTalkState = (area, ymd, state) => rewrite(area, ymd, (t) => setHead(t, "STATE", state));
export const setFollowUp = (area, ymd, iso) => rewrite(area, ymd, (t) => setHead(t, "FOLLOW-UP", iso));
export const addSaid = (area, ymd, line) => rewrite(area, ymd, (t) => appendToSection(t, "What you said", line));

// A talk opens between its moment and six hours after it, once. A server that was down all evening
// does not open Sunday's talk at three in the morning.
export function talkDue(area, now, tz) {
  const today = localParts(now, tz).date;
  const m = talkMoment(area, today, tz);
  if (!m) return null;
  const t = now.getTime();
  if (t < m.getTime() || t > m.getTime() + OPEN_WINDOW_HOURS * 3600000) return null;
  return fs.existsSync(talkFile(area, today)) ? null : today;
}

// The evening after an unanswered talk, at the talk's own time, one short follow-up. Not when that
// evening is itself a talk evening (a daily rhythm): the new talk replaces the follow-up.
export function followUpDue(area, now, tz) {
  const today = localParts(now, tz).date;
  const yesterday = addDays(today, -1);
  const t = readTalk(area, yesterday);
  if (!t || t.state !== "opened" || t.followUp || t.answered) return null;
  if (isTalkDay(area, today)) return null;
  const at = zonedToUtc(today, area.time, tz).getTime();
  const n = now.getTime();
  return n >= at && n <= at + OPEN_WINDOW_HOURS * 3600000 ? yesterday : null;
}

// Recorded not-held: 20 hours after the follow-up with still no word from him, or as soon as a
// later talk of the same area exists.
export function notHeldDue(area, now, tz) {
  const today = localParts(now, tz).date;
  const dates = talkDates(area);
  const out = [];
  for (const d of dates.filter((x) => x < today)) {
    const t = readTalk(area, d);
    if (t.state !== "opened" || t.answered) continue;
    const late = t.followUp && now.getTime() - Date.parse(t.followUp) >= 20 * 3600000;
    const superseded = dates.some((x) => x > d);
    if (late || superseded) out.push(d);
  }
  return out;
}

export function missedInARow(area) {
  let n = 0;
  for (const d of talkDates(area).reverse()) {
    if (readTalk(area, d).state === "not-held") n++; else break;
  }
  return n;
}

export function openTalks(mcDir, now) {
  const out = [];
  for (const a of listAreas(mcDir)) {
    for (const d of talkDates(a)) {
      const t = readTalk(a, d);
      const since = Date.parse(t.opened || d + "T00:00:00Z");
      if (t.state === "opened" && now.getTime() - since < 3 * 86400000) out.push({ area: a, ymd: d, talk: t });
    }
  }
  return out;
}
