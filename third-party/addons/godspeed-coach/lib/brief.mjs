// Everything one talk needs, gathered before the model runs: the area's rules, what to prepare, the
// last talk in full (the memory), the question queued for today, what other talks raised this week,
// the week of each habit (its own, and other areas' habits that name it), the goals the area serves
// and what the nightly research found for them. A talk prepared ahead (lib/prep.mjs) brings that
// file whole instead of the research, and its opening is already written. The talk itself reads
// more only when the conversation gets there.
import fs from "node:fs";
import path from "node:path";
import { parseDoc } from "./header.mjs";
import { localParts, addDays, dayWords } from "./clock.mjs";
import { lastTalk, missedInARow, talkFile, talkDates, readTalk } from "./talks.mjs";
import { listHabits, stats, verdict, daysWords } from "./habits.mjs";
import { rhythmWords, listAreas, findArea } from "./areas.mjs";
import { prepForBrief } from "./prep.mjs";

export function queuedQuestions(area, ymd) {
  const f = path.join(area.dir, "questions.md");
  if (!fs.existsSync(f)) return [];
  const text = fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");
  const parts = text.split(/^### /m).slice(1);
  const out = [];
  for (const p of parts) {
    const m = p.match(/^(\d{4}-\d{2}-\d{2}):\s*(.*)\n?([\s\S]*)$/);
    if (!m) continue;
    const [, date, title, body] = m;
    if (date > ymd || /^ASKED:/m.test(body)) continue;
    out.push({ date, title: title.trim(), body: body.trim() });
  }
  return out;
}

function goalDoc(mcDir, id) {
  const f = path.join(mcDir, "goals", `${id}.md`);
  return fs.existsSync(f) ? parseDoc(fs.readFileSync(f, "utf8")) : null;
}

// A goal with research gets no log lines: they are bookkeeping ("BET W-20261014-10 150 -> 240",
// "READ 0 (outside.txt line ...)") that a talk cannot say in words the person would recognise, and
// the research section below says what they meant.
function goalLines(mcDir, id, { log = true } = {}) {
  const d = goalDoc(mcDir, id);
  if (!d) return `- ${id}: no goal file found`;
  const lines = (d.sections.Log || "").split("\n").filter((l) => /^- \d{4}-\d{2}-\d{2} /.test(l) && !/^- \S+ ATTENTION /.test(l));
  const recent = log ? lines.slice(-3).map((l) => `    ${l.length > 300 ? l.slice(0, 297) + "..." : l}`) : [];
  return [`- ${id}: ${d.head.TITLE || ""}${d.head.MEASURE ? ` (measure: ${d.head.MEASURE})` : ""}`, ...recent].join("\n");
}

// What the nightly goal research found (goals/research/<goal>/brief.md, when the mission control has
// one): the money picture, what changed, openings with their closing dates, people worth reaching.
// It is the talk's main material, so the talk never opens on a stale to-do title instead (the work
// talk of 14 October 2026). "Experiments" is left out: it is bookkeeping full of work-item codes.
// Longer than RESEARCH_CAP, whole sections are left out, never half of one: the RESEARCH_FIRST ones
// are kept first, then the others in the file's order while they fit, and the section names what
// was left out and where all of it is. The sections keep the file's order.
export const RESEARCH_CAP = 6000;
export const RESEARCH_STALE_DAYS = 2;
const RESEARCH_SKIP = new Set(["Experiments"]);
const RESEARCH_FIRST = ["The limit now", "What changed this week", "Openings", "Who to reach and what we offer"];

export function researchFile(mcDir, id) { return path.join(mcDir, "goals", "research", id, "brief.md"); }

export function goalResearch(mcDir, id, ymd, cap = RESEARCH_CAP) {
  const f = researchFile(mcDir, id);
  if (!fs.existsSync(f)) return null;
  const text = fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");
  const updated = (parseDoc(text).head.UPDATED || "").match(/^\d{4}-\d{2}-\d{2}$/)?.[0] || "";
  const sections = [];
  for (const part of text.split(/^## /m).slice(1)) {
    const nl = part.indexOf("\n");
    const title = (nl === -1 ? part : part.slice(0, nl)).trim();
    const body = (nl === -1 ? "" : part.slice(nl + 1)).trim().replace(/^(#{3,5}) /gm, "#$1 ");
    if (!title || !body || RESEARCH_SKIP.has(title)) continue;
    const first = RESEARCH_FIRST.indexOf(title);
    sections.push({ i: sections.length, title, block: `### ${title}\n${body}`, rank: first === -1 ? RESEARCH_FIRST.length + sections.length : first });
  }
  if (!sections.length) return null;
  const byRank = [...sections].sort((a, b) => a.rank - b.rank);
  const kept = new Map(); const left = [];
  let size = 0;
  for (const s of byRank) {
    if (size + s.block.length + 2 <= cap) { kept.set(s.i, s.block); size += s.block.length + 2; } else left.push(s.title);
  }
  // One section longer than the whole cap: its first lines, so the talk still has something.
  if (!kept.size) {
    const s = byRank[0];
    kept.set(s.i, s.block.slice(0, cap).replace(/\n[^\n]*$/, ""));
    left[0] = `the rest of "${s.title}"`;
  }
  const body = sections.filter((s) => kept.has(s.i)).map((s) => kept.get(s.i));
  if (left.length) body.push(`Left out for length: ${left.join("; ")}. All of it: ${path.relative(mcDir, f).replace(/\\/g, "/")}.`);
  const stale = !updated || updated < addDays(ymd, -RESEARCH_STALE_DAYS);
  const when = updated ? `updated ${updated}${stale ? ", older than two days: say so if you use it" : ""}` : "no update date: say so if you use it";
  const title = goalDoc(mcDir, id)?.head.TITLE || id;
  return `## What the research found for ${title} (${when})\n${body.join("\n\n")}`;
}

// The planned days are the ones that count: a skipped day is named apart and left out of them,
// so the talk never reads it as a missed day (habits.mjs, stats). A habit another area owns
// (`owner`, that area's title) is marked as that area's and carries no graduate or struggling
// note: offering either belongs to its own talk.
export function habitLine(h, ymd, owner = null) {
  const s = stats(h, ymd, 7);
  const v = owner ? "fine" : verdict(h, ymd);
  const note = v === "graduate" ? "; six weeks of mostly done: offer to graduate it" : v === "struggling" ? "; under half for two weeks: ask whether to make it smaller or drop it" : "";
  const skipped = s.skip ? `; ${s.skip} skipped, not counted` : "";
  const whose = owner ? `${/^[aeiou]/i.test(owner) ? "an" : "a"} ${owner} habit, ` : "";
  return `- ${h.title} (${whose}${daysWords(h.days)}${h.auto ? `, ticked from data: ${h.auto}` : ""}): last 7 days, ${s.applicable} planned: done ${s.done}, no ${s.no}, unknown ${s.unknown}${skipped}${note}`;
}

// What the other talks raised in the seven days before this talk's day and on the day itself (so
// last week's talk at a later hour still counts): per talk the day in words, the opening as sent
// and what changed, trimmed. The opening never starts with any of it (the recipe, "Opening a
// talk"): two talks that may read the same habit or tracker do not go over the same thing twice.
export const RAISED_DAYS = 7;
const short = (t, n) => { const c = String(t || "").replace(/\s+/g, " ").trim(); return c.length > n ? c.slice(0, n - 3).trimEnd() + "..." : c; };
export function raisedElsewhere(mcDir, area, ymd) {
  const out = [];
  for (const other of listAreas(mcDir)) {
    if (other.slug === area.slug) continue;
    for (const d of talkDates(other).filter((x) => x >= addDays(ymd, -RAISED_DAYS) && x <= ymd)) {
      const t = readTalk(other, d);
      const opening = short(t.sections["The opening"], 240);
      const changed = short((t.sections["What changed"] || "").split("\n").map((l) => l.replace(/^\s*[-*]\s*/, "").trim()).filter(Boolean).join("; "), 240);
      const said = `- The ${other.title} talk ${dayWords(d, ymd)} ${opening ? `opened with: "${opening}"` : "opened, with no opening recorded."}`;
      out.push(said + (changed ? ` What changed: ${changed}${/[.!?]$/.test(changed) ? "" : "."}` : ""));
    }
  }
  return out;
}

// What the open command's --prepared asks for, in the brief's command line so the talk job's model
// sees it: the things it would bring up next, ready for "what else do you have?", so the talk goes on
// from the record and the [godspeed-coach] block alone (lib/context.mjs).
export const preparedHint = (from) => `<two to four more things from ${from}, one line each, in plain words with their date and source link, ready for 'what else do you have?'>`;

// The open command when the talk was prepared ahead (lib/prep.mjs): the opening is written, so the
// talk job's model only saves it and returns it as it is.
export const fromPrepCommand = (area, home, file) => `godspeed-coach talk open ${area.slug} --godspeed "${home}" --from-prep "${file}"`;
const FROM_PREP_SAYS = "The opening is written: this command saves it with the talk card and prints it, and your final answer is that opening, exactly as printed.";

// `inChat`: they asked for this talk in the conversation (`godspeed-coach brief <area>`), so the opening
// is the reply they read, and the record is made as seen (`--shown`). The scheduled talk's brief, which
// the gate prints, never is: a talk that waits for the chat must stay waiting.
export function brief(mcDir, s, area, ymd, { inChat = false } = {}) {
  const rel = (p) => path.relative(mcDir, p).replace(/\\/g, "/");
  const L = [];
  const research = area.serves.map((g) => ({ g, found: goalResearch(mcDir, g, ymd) }));
  // A talk prepared ahead brings its own depth: the goal research is in it, checked and cut, so the
  // brief leaves the research sections out and stays focused.
  const prep = prepForBrief(area, ymd);
  L.push(`COACH TALK DUE: ${area.title} (id for commands: ${area.slug}), ${ymd}, ${area.time} ${s.timezone}`);
  const home = mcDir.replace(/\\/g, "/");
  const hint = preparedHint(research.some((r) => r.found) ? "the research" : "what you read");
  L.push(prep
    ? `Record: ${rel(talkFile(area, ymd))}, created by (run it exactly like this): ${fromPrepCommand(area, home, rel(prep.file))}${inChat ? " --shown" : ""}. ${FROM_PREP_SAYS}`
    : `Record: ${rel(talkFile(area, ymd))}, created by (run it exactly like this): godspeed-coach talk open ${area.slug} --godspeed "${home}" --opening "<the opening>" --prepared "${hint}" --read "<what you read>"${inChat ? " --shown" : ""}`);
  L.push(`Mission control folder: ${home} (every godspeed-coach command in this talk takes --godspeed "${home}")`);
  L.push(`Style: ${area.style}. Tone: ${area.tone}. Rhythm: ${rhythmWords(area)}.`);
  if (area.serves.length) L.push(`Serves: ${area.serves.join(", ")}.`);
  const limits = area.lists.LIMIT || [];
  if (limits.length) L.push("Limits, binding:", ...limits.map((l) => `- ${l}`));
  const reads = area.lists["MAY READ"] || [];
  if (reads.length) L.push("May read:", ...reads.map((l) => `- ${l}`));
  if (area.sections.Preparation) L.push("", "## Preparation", area.sections.Preparation);
  // The whole file, its headings one level down so they stay inside this section.
  if (prep) L.push("", `## The prepared talk (${rel(prep.file)})`, prep.text.replace(/^(#{2,5}) /gm, "#$1 "));

  const qs = queuedQuestions(area, ymd);
  L.push("", "## Question queued for this talk");
  if (qs.length) {
    const q = qs[0];
    L.push(`### ${q.date}: ${q.title}`, q.body, "", `This replaces the general question. After asking it, add a line "ASKED: ${ymd}" under its heading in ${rel(path.join(area.dir, "questions.md"))}.`);
  } else L.push("None. Ask the one question the preparation leads to.");

  const missed = missedInARow(area);
  if (missed >= 3) L.push("", "## Rhythm", `The last ${missed} ${area.title} talks got no answer. Instead of pushing on, this opening asks whether the rhythm still suits them, in one or two short sentences that make sense on their own: that the last ${missed} talks went unanswered, that the talk comes ${rhythmWords(area)}, and whether to keep it, move it to another day or time, have it less often, or pause it.`);

  const last = lastTalk(area, ymd);
  L.push("", "## The last talk");
  L.push(last ? `${rel(last.file)} (${last.state})\n\n${fs.readFileSync(last.file, "utf8").trim()}` : "None yet: this is the first talk of this area.");

  const raised = raisedElsewhere(mcDir, area, ymd);
  L.push("", "## Raised in other talks this week");
  L.push(raised.length ? ["Another talk already raised these with them. The opening never starts with any of them: pick another thing. If they bring one up themselves, talk about it from this talk's own subject.", ...raised].join("\n") : "None.");

  // Its own habits, then the habits of other areas whose READ BY names this one (lib/habits.mjs).
  const active = listHabits(mcDir, { status: "active" });
  const hs = active.filter((h) => h.area === area.slug);
  const borrowed = active.filter((h) => h.area !== area.slug && h.readBy.includes(area.slug));
  L.push("", "## Habits in this area");
  const lines = [...hs.map((h) => habitLine(h, ymd)), ...borrowed.map((h) => habitLine(h, ymd, findArea(mcDir, h.area)?.title || h.area))];
  if (borrowed.length) lines.push("A habit marked as another area's belongs to that area's talk: look at it here, but only its own talk offers to graduate it, make it smaller or drop it.");
  L.push(lines.length ? lines.join("\n") : "None active.");

  if (area.serves.length) {
    L.push("", "## Goals it serves", ...research.map(({ g, found }) => goalLines(mcDir, g, { log: !found })));
    if (!prep) for (const { found } of research) if (found) L.push("", found);
  }
  return L.join("\n");
}

export const todayOf = (now, s) => localParts(now, s.timezone).date;
