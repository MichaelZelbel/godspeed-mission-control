// A prepared talk: coach/<area>/prep/<talk date>.md, written ahead of the talk by a job of its own
// (in Godspeed Mission Control, the coach-prep recipe, which has an hour or more for it). Until
// 0.4.0 the talk job's model wrote the opening in about a minute from the brief, and the talks of
// 14 and 15 October 2026 opened unprepared. Now the opening is written ahead: the talk opens from
// the file (`talk open --from-prep`), the brief carries it whole, every interface carries its talk
// card while the talk is open (lib/context.mjs), and `prep-due` says which coming talks still need one.
//
// The file has the same plain shape as the rest of coach/ (lib/header.mjs):
//
//   AREA: work
//   TALK: 2026-10-21 19:00
//   PREPARED: 2026-10-20T08:12:00Z
//   STATE: ready            (or draft)
//
//   ## The opening          the message to send, exactly
//   ## Talk card            what every interface carries while the talk is open
//   ## Where he stands ... ## Cut, and why     the depth, read when the card does not answer
import fs from "node:fs";
import path from "node:path";
import { parseDoc } from "./header.mjs";
import { localParts, addDays, zonedToUtc } from "./clock.mjs";
import { listAreas, isTalkDay, nextTalkDay } from "./areas.mjs";
import { talkFile, talkDates, readTalk } from "./talks.mjs";

export const prepDir = (area) => path.join(area.dir, "prep");
export const prepFile = (area, ymd) => path.join(prepDir(area), `${ymd}.md`);
// A talk they start themselves on a day with no talk uses the next scheduled talk's preparation
// when that talk is at most this many days away.
export const PREP_AHEAD_DAYS = 7;

const rel = (mcDir, p) => {
  const r = path.relative(mcDir, p);
  return (r && !r.startsWith("..") && !path.isAbsolute(r) ? r : path.resolve(p)).replace(/\\/g, "/");
};
// A section by its name, whatever its case: "## The opening", "## The Opening".
const section = (sections, name) => {
  const k = Object.keys(sections).find((x) => x.toLowerCase() === name.toLowerCase());
  return k ? sections[k] : "";
};

export function readPrep(file) {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, "utf8").replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const d = parseDoc(text);
  return {
    file, text: text.trim(), head: d.head, sections: d.sections,
    state: String(d.head.STATE || "").trim().toLowerCase(),
    opening: section(d.sections, "The opening").trim(),
    card: section(d.sections, "Talk card").trim(),
  };
}

// Why a prepared talk cannot open a talk, in words; null when it can. Ready means STATE ready with
// an opening and a talk card, and for this area when the file names one.
export function prepProblem(p, area = null) {
  if (!p) return "there is no such file";
  if (area && p.head.AREA && p.head.AREA.trim().toLowerCase() !== area.slug) return `it is for the ${p.head.AREA.trim()} talk, not the ${area.title} talk`;
  if (p.state !== "ready") return `its STATE is ${p.state || "missing"}, not ready`;
  const empty = [["The opening", p.opening], ["Talk card", p.card]].filter(([, v]) => !v).map(([k]) => `"${k}"`);
  if (empty.length) return `its section${empty.length > 1 ? "s" : ""} ${empty.join(" and ")} ${empty.length > 1 ? "are" : "is"} empty`;
  return null;
}

// The day of another talk of this area that already opened with this preparation's opening, or null.
// A talk they started themselves with the next talk's preparation used it up: the scheduled talk
// must not send the same opening a second time.
export function prepUsedOn(area, p, exceptYmd) {
  if (!p || !p.opening) return null;
  const same = (t) => String(t || "").replace(/\s+/g, " ").trim();
  return talkDates(area).find((d) => d !== exceptYmd && same(readTalk(area, d)?.sections["The opening"]) === same(p.opening)) || null;
}

const usable = (area, p, ymd) => !prepProblem(p, area) && !prepUsedOn(area, p, ymd);

// Which prepared talk the brief for <ymd> carries, or null for the brief as before. On a scheduled
// talk day, that day's. Asked for on any other day (a talk they start themselves), the next
// scheduled talk's when it is at most PREP_AHEAD_DAYS away, else today's or yesterday's.
export function prepForBrief(area, ymd) {
  const days = [];
  if (isTalkDay(area, ymd)) days.push(ymd);
  else {
    const next = nextTalkDay(area, addDays(ymd, 1));
    if (next && next <= addDays(ymd, PREP_AHEAD_DAYS)) days.push(next);
    days.push(ymd, addDays(ymd, -1));
  }
  for (const d of days) {
    const p = readPrep(prepFile(area, d));
    if (usable(area, p, ymd)) return { ...p, date: d };
  }
  return null;
}

// Every area that is on and has a talk rhythm, whose next scheduled talk starts within <hours> from
// now and has no ready preparation yet, soonest first. A talk already opened for that day needs none.
export function prepDue(mcDir, s, now, hours) {
  const tz = s.timezone;
  const today = localParts(now, tz).date;
  const until = now.getTime() + hours * 3600000;
  const out = [];
  for (const a of listAreas(mcDir)) {
    if (!a.on || a.noTalk || !a.rhythm) continue;
    let next = null;
    for (let i = 0; i <= Math.ceil(hours / 24) + 1 && !next; i++) {
      const d = addDays(today, i);
      const at = isTalkDay(a, d) ? zonedToUtc(d, a.time, tz) : null;
      if (at && at.getTime() >= now.getTime()) next = { d, at };
    }
    if (!next || next.at.getTime() > until) continue;
    if (fs.existsSync(talkFile(a, next.d))) continue;
    if (usable(a, readPrep(prepFile(a, next.d)), next.d)) continue;
    out.push({ at: next.at.getTime(), area: a.slug, title: a.title, date: next.d, time: a.time, timezone: tz, file: rel(mcDir, prepFile(a, next.d)) });
  }
  return out.sort((x, y) => x.at - y.at).map(({ at, ...r }) => r);
}

export const prepPath = rel;
