#!/usr/bin/env node
// godspeed-coach: recurring coaching talks and daily habits for Godspeed Mission Control. This file only
// parses arguments and prints. What gets decided lives in lib/, where the tests can reach it.
import fs from "node:fs";
import path from "node:path";
import { findMissionControl, appHome } from "../lib/paths.mjs";
import { now, localParts, addDays, weekdayOf, WEEKDAY_WORDS } from "../lib/clock.mjs";
import { loadSettings, setSetting, DEFAULTS } from "../lib/settings.mjs";
import { listAreas, findArea, isTalkDay, addArea, setAreaField, nextTalkDay, habitArea, AREA_FIELDS, addAreaLine, removeAreaLine } from "../lib/areas.mjs";
import { openTalk, unansweredBefore, readTalk, setTalkState, setFollowUp, addSaid, setShown, talkDates, talkFile } from "../lib/talks.mjs";
import { addHabit, listHabits, findHabit, track, untrack, lastAnsweredDay, setStatus, stats, askedOn, answerOn,setHabitSchedule,setHabitDisplay,exemptHabitDays, setHabitReader, habitReadersWords } from "../lib/habits.mjs";
import {habitProgress,assertDay} from '../lib/progress.mjs';
import { readTable } from "../lib/auto.mjs";
import { brief, habitLine } from "../lib/brief.mjs";
import { gate, NO_WAKE } from "../lib/gate.mjs";
import { dueTick } from "../lib/tick.mjs";
import { contextBlock, waitingTalks } from "../lib/context.mjs";
import { readPrep, prepProblem, prepForBrief, prepDue, prepPath, prepCheck, prepFile } from "../lib/prep.mjs";
import { writeQuestions, readQuestions, questionsFile, openQuestionsDate, addQuestion, dropQuestion, hasQuestions } from "../lib/questions.mjs";
import { commitCoach, syncInBackground, syncQueued, pullQuietly } from "../lib/sync.mjs";
import { decodeArgv, readTextFile, restoreShellEnv, startedFromGitBash, gitBashPath, LAUNCHER_ENV, CMDLINE_ENV } from "../lib/argv.mjs";

const FLAGS = new Set(["json", "yes", "no-hermes", "no-claude", "all", "scheduled", "remove", "shown"]);
// The values that name a file or folder. From Git Bash these are turned into Windows paths;
// the person's words never are (lib/argv.mjs).
const PATH_FLAGS = ["godspeed", "out", "evidence", "answer", "issues-out", "words-file", "opening-file", "prepared-file", "from-prep", "extra-skills-dir", "daily-table"];
// Free text that may run over several lines, and the flag that takes it from a file instead.
const TEXT_FILES = [["words-file", "words"], ["opening-file", "opening"], ["prepared-file", "prepared"]];
// A flag given more than once keeps its last value in f, as always, and every value in all: "talk
// said" saves each --words (or --words-file) as a message of its own.
function parseArgs(argv) {
  const pos = []; const f = {}; const all = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { pos.push(a); continue; }
    const k = a.slice(2);
    if (FLAGS.has(k)) { f[k] = true; continue; }
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) return { pos, f, all, error: `--${k} needs a value.` };
    f[k] = next; (all[k] ||= []).push(next); i++;
  }
  return { pos, f, all };
}

// The launchers say how they handed the arguments over (lib/argv.mjs). The markers are read once
// and taken out of the environment, so a program this one starts (the background sync) never
// mistakes itself for something the .cmd launcher started.
const launched = decodeArgv(process.argv.slice(2), process.env);
const fromGitBash = startedFromGitBash(process.env);
delete process.env[LAUNCHER_ENV]; delete process.env[CMDLINE_ENV];
restoreShellEnv(process.env);
const [cmd = "help", ...rest] = launched.argv;
const { pos, f, all, error: argError } = parseArgs(rest);
// These three run inside other programs (before every turn, and on the schedule). A broken coach
// never breaks the assistant and never sends an error into his chat.
const QUIET = ["context", "tick", "gate"].includes(cmd);

function die(msg) {
  if (cmd === "gate") { process.stdout.write(NO_WAKE + "\n"); process.exit(0); }
  if (QUIET) process.exit(0);
  console.error(msg); process.exit(1);
}
if (launched.error) die(launched.error);
if (argError) die(argError);
if (fromGitBash) for (const k of PATH_FLAGS) if (typeof f[k] === "string") { f[k] = gitBashPath(f[k]); if (all[k]) all[k] = all[k].map((p) => gitBashPath(p)); }
// Words or an opening that hold a line break or a quote travel safest in a file: no shell reads a
// file's contents, so nothing on the way can cut or change them.
for (const [flag, key] of TEXT_FILES) {
  if (f[flag] === undefined) continue;
  if (f[key] !== undefined) die(`Give the ${key} once: either --${key} or --${flag}, not both.`);
  try { all[key] = all[flag].map((file) => readTextFile(file, key)); f[key] = all[key].at(-1); } catch (e) { die(e.message); }
}

const mcDir = findMissionControl({ arg: f.godspeed });
if (!mcDir && !["help", "setup"].includes(cmd)) die("Could not find your mission control folder. Run this from inside it, or add --godspeed <folder>.");
const s = mcDir ? loadSettings(mcDir) : { ...DEFAULTS };
const rawSync = process.env.GODSPEED_COACH_GIT_SYNC;
const syncMode = ["auto", "commit", "off"].includes(rawSync) ? rawSync : s.git_sync;
const at = now();
const today = localParts(at, s.timezone).date;
const out = (human, json) => console.log(f.json ? JSON.stringify(json) : human);
const saved = (label) => syncInBackground(mcDir, `coach: ${label}`, syncMode);
const progressResult=h=>({habit:h.slug,progressCard:{id:'habit-'+h.area+'-'+h.slug,name:h.title,status:h.status,doneMeans:h.doneMeans,days:h.days,daysText:h.daysText,started:h.started,progress:habitProgress(h,{now:at,timezone:s.timezone})}});
const progressReply=h=>{const p=habitProgress(h,{now:at,timezone:s.timezone});return `${h.title}: ${p.lifetimeCompletedDays} completed ${p.lifetimeCompletedDays===1?'day':'days'} altogether${p.display==='calm'?'':`, ${p.currentRun} ${p.currentRun===1?'completion':'completions'} in this run`}.`;};

function dateArg(v) {
  if (!v || v === "today") return today;
  if (v === "yesterday") return addDays(today, -1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(Date.parse(v))) die(`Give the day as YYYY-MM-DD, today or yesterday, not "${v}".`);
  return v;
}
function needArea(name) {
  const a = findArea(mcDir, name);
  if (!a) die(`There is no coach area called "${name || ""}". Areas: ${listAreas(mcDir).map((x) => x.slug).join(", ") || "none yet"}.`);
  return a;
}
function openTalkDate(a) {
  if (f.date) return dateArg(f.date);
  const open = talkDates(a).reverse().find((d) => readTalk(a, d).state === "opened");
  if (!open) die(`No ${a.title} talk is open. Give the day with --date.`);
  return open;
}
function needHabit(words, opts) {
  const h = findHabit(mcDir, words, opts);
  const names = listHabits(mcDir, { status: "active" }).map((x) => x.title).join(", ") || "none";
  if (!h) die(`No habit matches "${words}". Active habits: ${names}.`);
  if (h.ambiguous) die(`Several habits match "${words}": ${h.ambiguous.join(" / ")}. Say which one.`);
  return h;
}
function habitEffectiveDate(habit,value=f.date) {
 const localToday=localParts(at,habit.timezone||s.timezone).date;
 const date=!value||value==='today'?localToday:value==='yesterday'?addDays(localToday,-1):assertDay(value);
 if(date>localToday)throw Error('An effective date cannot be in the future. Use a dated exemption for a future holiday.');
 return date;
}
const ANSWER_WORDS = { yes: "done", y: "done", ja: "done", done: "done", did: "done", erledigt: "done", no: "no", n: "no", nein: "no", not: "no", skip: "skip", skipped: "skip" };
function answerWord(v) {
  const a = ANSWER_WORDS[String(v || "done").toLowerCase()];
  if (!a) die(`An answer is yes, no or skip, not "${v}".`);
  return a;
}

const commands = {
  areas() {
    const as = listAreas(mcDir);
    const next = (a) => { for (let i = 0; i < 400; i++) { const d = addDays(today, i); if (isTalkDay(a, d)) return d; } return null; };
    out(as.map((a) => (a.noTalk ? `${a.slug}: ${a.title}, no talk` : `${a.slug}: ${a.title}, ${a.rhythmText} ${a.time}, ${a.style}, ${a.tone}, ${a.on ? `next talk ${next(a) || "none"}` : "paused"}`)).join("\n") || "No areas yet.", as.map((a) => ({ slug: a.slug, title: a.title, next: next(a), ...(a.noTalk ? { talk: false } : {}) })));
  },
  show() { const a = needArea(pos[0]); console.log(fs.readFileSync(a.file, "utf8")); },
  area() {
    const [sub, name, key, ...v] = pos;
    if (sub === "add") {
      // A new area starts tomorrow unless a date is given, so creating "Sundays at seven" on a
      // Sunday evening never opens a talk fifteen minutes later by surprise.
      try {
        // An area a habit made with no talk gets its talk here (lib/areas.mjs addArea).
        const had = findArea(mcDir, name);
        const a = addArea(mcDir, { slug: had?.noTalk ? had.slug : name, title: f.title, rhythm: f.rhythm, time: f.time || "19:00", starts: f.starts ? dateArg(f.starts) : addDays(today, 1), style: f.style || "compass", tone: f.tone || "gentle", serves: f.serves || "" });
        saved(`area ${a.slug} ${had?.noTalk ? "has a talk now" : "added"}`);
        const first = nextTalkDay(a, a.starts);
        return out(`Added: ${a.title} (${a.slug}), ${a.rhythmText} at ${a.time}, ${a.style}, ${a.tone}. First talk: ${first || "none"}.`, { ok: true, area: a.slug, first });
      } catch (e) { die(e.message); }
    }
    if (sub === "set") {
      const a = needArea(name);
      if (!key || !v.length) die(`godspeed-coach area set <area> <${AREA_FIELDS.join("|")}> <value>`);
      try {
        let b = setAreaField(a, key, v.join(" "));
        // An area that had no talk gets one from tomorrow when it is given a rhythm.
        if (key.toUpperCase() === "RHYTHM" && b.rhythm && !b.starts) b = setAreaField(b, "STARTS", addDays(today, 1));
        saved(`area ${b.slug} ${key.toUpperCase()}`);
        const first = nextTalkDay(b, today > (b.starts || today) ? today : b.starts || today);
        return out(`Changed: ${b.title} ${key.toUpperCase()} = ${v.join(" ")}. ${b.noTalk ? "It has no talk." : b.on ? `Next talk: ${first || "none"}.` : "Paused: no talks until it is on again."}`, { ok: true, next: b.noTalk ? null : first });
      } catch (e) { die(e.message); }
    }
    if (sub === "read" || sub === "limit" || sub === "source") {
      // "The health talk may also look at my sleep tracker" (read), "must never suggest buying
      // anything" (limit), and --remove to take one back. Only that header line changes
      // (lib/areas.mjs addAreaLine, removeAreaLine).
      const a = needArea(name);
      const K = sub === "read" ? "MAY READ" : sub === "source" ? "SOURCE" : "LIMIT";
      const talk = `the ${a.title} talk`;
      const state = (b) => ({ ok: true, area: b.slug, may_read: b.lists["MAY READ"] || [], limits: b.lists.LIMIT || [], ...(sub === "source" || (b.lists.SOURCE || []).length ? { sources: b.lists.SOURCE || [] } : {}) });
      const later = a.noTalk ? " It has no talk yet; the talk it gets later keeps this." : "";
      if (pos.length < 3) {
        const have = a.lists[K] || [];
        const T = talk.charAt(0).toUpperCase() + talk.slice(1);
        if (sub === "source") return out(have.length ? `${T} reads first: ${have.join("; ")}.` : `Nothing is named for ${talk} to read first.`, state(a));
        return out(sub === "read"
          ? (have.length ? `${T} may look at: ${have.join("; ")}.` : `Nothing is named for ${talk} to look at.`)
          : (have.length ? `${T}'s limits: ${have.join("; ")}.` : `${T} has no limits of its own.`), state(a));
      }
      const what = [key, ...v].join(" ");
      try {
        if (f.remove) {
          const r = removeAreaLine(a, K, what);
          saved(`area ${a.slug} ${K} taken away`);
          if (sub === "source") return out(`Taken away: ${talk} no longer reads ${r.removed.join(" and ")} first.`, { ...state(r.area), removed: r.removed });
          return out(sub === "read" ? `Taken away: ${talk} no longer looks at ${r.removed.join(" and ")}.` : `Taken away: ${talk}'s limit ${r.removed.map((x) => `"${x}"`).join(" and ")}.`, { ...state(r.area), removed: r.removed });
        }
        const r = addAreaLine(a, K, what);
        if (r.changed) saved(`area ${a.slug} ${K} added`);
        if (sub === "source") return out(r.changed ? `Added: ${talk} reads ${r.line} first.` : `Already there: ${talk} reads ${r.line} first. Nothing changed.`, { ...state(r.area), changed: r.changed });
        const said = sub === "read" ? `${talk} may look at ${r.line}.` : r.changed ? `Added a limit to ${talk}: ${r.line}.` : `${talk}'s limit "${r.line}".`;
        return out(r.changed ? (sub === "read" ? `Added: ${said}` : said) + later : `Already there: ${said} Nothing changed.`, { ...state(r.area), changed: r.changed });
      } catch (e) { die(e.message); }
    }
    die("godspeed-coach area add <name> --title ... --rhythm ... | area set <area> <SETTING> <value> | area read <area> \"<what it may look at>\" [--remove] | area limit <area> \"<what it must never do>\" [--remove] | area source <area> \"<what the research reads first>\" [--remove]");
  },
  // Asked for in the conversation ("Can we do the health talk now?"): the open command it prints
  // carries --shown. The scheduled talk gets its brief from the gate, without it.
  brief() { const a = needArea(pos[0]); console.log(brief(mcDir, s, a, dateArg(f.date), { inChat: true })); },
  // For the job that prepares talks ahead (lib/prep.mjs): which coming talks still need preparing.
  // It only reads: nothing is pulled, written or sent.
  "prep-due"() {
    const raw = f["within-hours"];
    const hours = Number(raw);
    if (raw === undefined || !Number.isFinite(hours) || hours <= 0) die("godspeed-coach prep-due --within-hours <hours> [--json]: the talks that start within that many hours and are not prepared yet.");
    const due = prepDue(mcDir, s, at, hours);
    // A stale one says when it was prepared, in the talk's own time zone.
    const when = (x) => { if (!x.prepared) return "no PREPARED time"; const p = localParts(new Date(x.prepared), x.timezone); return `prepared ${p.date} ${p.hm}`; };
    out(due.map((x) => `${x.area}: ${x.title}, ${WEEKDAY_WORDS.en[weekdayOf(x.date)]} ${x.date} at ${x.time} (${x.timezone}), prepare ${x.file}${x.stale ? ` (stale, ${when(x)})` : ""}`).join("\n") || "Nothing to prepare.", due);
  },
  // One talk's preparation (lib/prep.mjs, prepCheck): "ready" when it can open the talk, else why
  // not; exit 1 when it cannot. The day is the talk's next one unless --date names another.
  "prep-check"() {
    const a = needArea(pos[0]);
    if (a.noTalk || !a.rhythm) die(`The ${a.title} area has no talk to prepare.`);
    const d = f.date ? dateArg(f.date) : nextTalkDay(a, today);
    if (!d) die(`The ${a.title} talk has no coming day.`);
    const r = prepCheck(mcDir, s, a, d);
    const when = r.prepared ? (() => { const p = localParts(new Date(r.prepared), s.timezone); return `prepared ${p.date} ${p.hm}`; })() : "no PREPARED time";
    const day = r.talk_day ? "" : ` (${d} is not a day of the ${a.title} talk)`;
    out(r.ready ? `ready: ${r.file}, ${when}${r.stale ? ", stale: more than 48 hours before the talk" : ""}${day}` : `not ready: ${r.file}: ${r.problem}${day}`, r);
    if (!r.ready) process.exitCode = 1;
  },
  // THE RECEIPTS OF A PREPARATION RUN (lib/prep-receipts.mjs), for the job that prepares talks
  // (mc-coach-prep): after the run, the pages it read are taken from its own record (Claude Code's
  // transcript or Hermes' session store, found by --marker) and written to --out as the evidence.
  // Exit 1, with the reason, when no record holds the marker or the run read no page.
  async "prep-receipts"() {
    const a = needArea(pos[0]);
    const d = dateArg(f.date);
    if (!f.marker || !f.started || !f.finished || !f.out) die("godspeed-coach prep-receipts <area> --date <talk day> --marker <run marker> --started <time> --finished <time> --out <file> [--json]");
    const { captureRun, writeEvidence } = await import("../lib/prep-receipts.mjs");
    const run = await captureRun({ marker: f.marker, startedMs: Date.parse(f.started), finishedMs: Date.parse(f.finished) });
    if (run.problem) { out(`no receipts: ${run.problem}`, { ok: false, problem: run.problem }); process.exitCode = 1; return; }
    const file = prepFile(a, d);
    if (!fs.existsSync(file)) { out(`no receipts: there is no ${prepPath(mcDir, file)}`, { ok: false, problem: "there is no preparation" }); process.exitCode = 1; return; }
    const ev = writeEvidence({ prepFile: file, area: a, run: { ...run, marker: f.marker }, out: path.resolve(f.out) });
    const n = ev.sources.length;
    const said = `${run.assistant} session ${run.session_id}: ${n} source page${n === 1 ? "" : "s"} read${run.dropped ? `, ${run.dropped} reading${run.dropped === 1 ? "" : "s"} left out (failed, empty or outside the run's time)` : ""}`;
    out(n ? `receipts: ${said}` : `no receipts: ${said}`, { ok: n > 0, assistant: run.assistant, session_id: run.session_id, sources: n, dropped: run.dropped, ...(n ? {} : { problem: "the run opened no source page successfully" }) });
    if (!n) process.exitCode = 1;
  },
  // THE SEAL OF THE SEPARATE REVIEW: the reviewer's answer (--answer, its JSON) and its own run's
  // record (--marker) become the review in --out, bound to the preparation, the area and --evidence;
  // then the coach's gate checks the pair. Exit 0 when it opens the talk; 1 with the reason, and the
  // issues for the next try in --issues-out, when it does not.
  async "prep-seal"() {
    const a = needArea(pos[0]);
    const d = dateArg(f.date);
    if (!f.marker || !f.started || !f.finished || !f.out || !f.evidence || !f.answer) die("godspeed-coach prep-seal <area> --date <talk day> --evidence <file> --answer <reviewer's answer> --marker <review marker> --started <time> --finished <time> --out <file> [--issues-out <file>] [--json]");
    const { captureRun, sealReview } = await import("../lib/prep-receipts.mjs");
    const fail = (problem, issues) => {
      if (f["issues-out"]) fs.writeFileSync(path.resolve(f["issues-out"]), issues.map((x) => `- ${x}\n`).join(""));
      out(`not sealed: ${problem}`, { ok: false, problem, issues }); process.exitCode = 1;
    };
    const run = await captureRun({ marker: f.marker, startedMs: Date.parse(f.started), finishedMs: Date.parse(f.finished) });
    if (run.problem) return fail(`the review run: ${run.problem}`, ["The review could not be checked: " + run.problem]);
    let answer = "";
    try { answer = fs.readFileSync(path.resolve(f.answer), "utf8"); } catch { /* none */ }
    const r = sealReview({ prepFile: prepFile(a, d), area: a, evidenceFile: path.resolve(f.evidence), answer, out: path.resolve(f.out),
      reviewer: { ...run, marker: f.marker }, reviewedAt: run.finished_at, now: at });
    if (r.problem) return fail(r.problem, r.issues);
    out(`sealed: the review passed, ${r.review.coverage.length} domains and goals judged`, { ok: true, coverage: r.review.coverage.length });
  },
  gate() {
    pullQuietly(mcDir, syncMode);
    const g = gate(mcDir, s, at, path.join(appHome(), "state.json"));
    process.stdout.write(g.output + "\n");
  },
  talk() {
    const [sub, name] = pos;
    const a = needArea(name);
    if (sub === "open") {
      const d = dateArg(f.date);
      // --shown: the opening is the reply they are reading in the chat, so the talk never waits for it.
      // A scheduled run never marks a talk seen (GODSPEED_SCHEDULED_RUN or --scheduled): for someone
      // without a messenger that would hide a talk that really waits.
      const shown = f.shown && !(f.scheduled || process.env.GODSPEED_SCHEDULED_RUN) ? at.toISOString().replace(/\.\d+Z$/, "Z") : "";
      const t = { opening: f.opening, read: f.read || "", shown, prepared: f.prepared || "", prep: "" };
      if (f["from-prep"] !== undefined) {
        // The talk was prepared ahead (lib/prep.mjs): the opening and the talk card come from the
        // file, and the opening is printed, so the talk job's final answer is exactly that.
        if (f.opening !== undefined || f.prepared !== undefined) die("Give the opening either from the prepared talk (--from-prep) or with --opening and --prepared, not both.");
        const file = path.resolve(mcDir, f["from-prep"]);
        const p = readPrep(file);
        const why = prepProblem(p, a);
        if (why) die(`The prepared talk ${prepPath(mcDir, file)} cannot open a talk: ${why}. Nothing was opened.`);
        Object.assign(t, { opening: p.opening, prepared: p.card, read: f.read || `the prepared talk ${prepPath(mcDir, file)}`, prep: prepPath(mcDir, file) });
      }
      if (!t.opening) die('Give the opening: --opening "<what you are sending them>", or --from-prep <file> for a talk prepared ahead');
      const r = openTalk(a, d, t, at);
      // A talk they asked for on a talk day replaces an earlier one that got no reply.
      if (r.created && shown && isTalkDay(a, d)) for (const e of unansweredBefore(a, d)) setTalkState(a, e, "not-held");
      if (r.created) saved(`${a.slug} talk opened ${d}`);
      const where = path.relative(mcDir, r.file).replace(/\\/g, "/");
      if (r.created && t.prep) return out(`Opened: ${where}. The opening, to send exactly as it is:\n\n${t.opening}`, { ok: true, created: true, file: r.file, opening: t.opening });
      return out(r.created ? `Opened: ${where}` : `Already open: ${where} (kept the first opening)`, { ok: true, created: r.created, file: r.file });
    }
    if (sub === "evidence") {
      // What the preparation behind a talk shows (routes, sources read, the second check), so "what did
      // you actually research?" is answered from it. Read only.
      const ds = talkDates(a);
      const d = f.date ? dateArg(f.date) : ([...ds].reverse().find((x) => readTalk(a, x).state === "opened") || today);
      const t = ds.includes(d) ? readTalk(a, d) : null;
      const found = t ? null : prepForBrief(a, d);
      const p = t ? (t.prep ? readPrep(path.resolve(mcDir, t.prep)) : null) : (found ? readPrep(found.file) : null);
      if (!p) return out(`There is no preparation to show for the ${a.title} talk of ${d}: do not claim any research for it.`, { ok: true, prep: null });
      const lines = [`Preparation: ${prepPath(mcDir, p.file)}`, `Prepared: ${p.head.PREPARED || "no time recorded"}`];
      const sec = (n) => { const k = Object.keys(p.sections).find((x) => x.toLowerCase() === n.toLowerCase()); return k ? String(p.sections[k]).trim() : ""; };
      const shown = {};
      for (const n of ["Routes", "Rejected routes", "Opportunities", "Research coverage", "Cut, and why"]) if (sec(n)) { lines.push("", `${n}:`, sec(n)); shown[n] = sec(n); }
      let review = null, sources = [];
      const base = p.file.replace(/\.md$/i, "");
      try { review = JSON.parse(fs.readFileSync(`${base}.review.json`, "utf8")); } catch { /* none */ }
      try { sources = JSON.parse(fs.readFileSync(`${base}.evidence.json`, "utf8")).sources || []; } catch { /* none */ }
      lines.push("", review ? `Second check: ${review.verdict}, ${review.reviewed_at || "no time recorded"}` : "Second check: none recorded");
      if (sources.length) { lines.push("Sources read:"); for (const x of sources) lines.push(`- ${x.url} (read ${x.read_at || "at no recorded time"}${x.tool ? `, with ${x.tool}` : ""})`); }
      else lines.push("No source pages were recorded.");
      return out(lines.join("\n"), { ok: true, prep: prepPath(mcDir, p.file), prepared: p.head.PREPARED || "", sections: shown, review: review ? { verdict: review.verdict, reviewed_at: review.reviewed_at } : null, sources });
    }
    if (sub === "said") {
      // One --words per message: where commands show on their screen, the whole talk is saved in
      // one command at its close, each message on a line of its own.
      const said = (all.words || []).map((w) => String(w).replace(/\s+/g, " ").trim()).filter(Boolean);
      if (!said.length) die('Give their words: --words "<what they said>", one --words per message');
      const d = openTalkDate(a);
      const hm = localParts(at, s.timezone).hm;
      addSaid(a, d, said.map((w) => `- ${hm} ${w}`));
      saved(`${a.slug} talk ${d}`);
      return out(said.length === 1 ? "Saved." : `Saved ${said.length} messages.`, { ok: true, date: d, saved: said.length });
    }
    if (sub === "held" || sub === "not-held") {
      const d = f.date ? dateArg(f.date) : (talkDates(a).at(-1) || die(`No ${a.title} talk exists yet.`));
      setTalkState(a, d, sub);
      // Closing a talk writes the next talk's live questions (lib/questions.mjs), for an area that serves a goal.
      const q = sub === "held" ? writeQuestions(mcDir, a, d, at, today) : null;
      saved(`${a.slug} talk ${d} ${sub}`);
      return out(`Recorded: the ${a.title} talk of ${d} is ${sub}.`, { ok: true, date: d, state: sub, ...(q ? { questions: path.relative(mcDir, q.file).replace(/\\/g, "/"), questions_date: q.date } : {}) });
    }
    if (sub === "state") {
      const ds = talkDates(a);
      return out(ds.slice(-5).map((d) => `${d}: ${readTalk(a, d).state}`).join("\n") || "No talks yet.", ds.map((d) => ({ date: d, state: readTalk(a, d).state })));
    }
    die("godspeed-coach talk open|said|evidence|held|not-held|state <area>");
  },
  // The live questions of an area's next talk (lib/questions.mjs). The program writes the file when
  // a talk closes; the model refines it only here. With no date: the next talk that has a file, else
  // the next talk day.
  questions() {
    const [name, sub, ...args] = pos;
    const a = needArea(name);
    if (!hasQuestions(a)) die(`The ${a.title} area serves no goal, so it has no live questions.`);
    const d = f.date ? dateArg(f.date) : openQuestionsDate(a, today) || nextTalkDay(a, today);
    if (!d) die(`The ${a.title} talk has no coming day.`);
    const rel = (p) => path.relative(mcDir, p).replace(/\\/g, "/");
    if (!sub || sub === "show") {
      const q = readQuestions(questionsFile(a, d));
      if (!q) return out(`No questions yet for the ${a.title} talk of ${d}. They are written when a talk closes.`, { ok: true, date: d, questions: [] });
      return out(`${rel(q.file)}\n` + q.items.map((i) => `- ${i.text}\n  why: ${i.why}`).join("\n"), { ok: true, date: d, file: rel(q.file), questions: q.items });
    }
    try {
      if (sub === "add") {
        const r = addQuestion(a, d, args.join(" "), f.why, at);
        if (r.changed) saved(`${a.slug} question added for ${d}`);
        return out(r.changed ? `Added to ${rel(r.file)}.` : "Already there. Nothing changed.", { ok: true, date: d, changed: r.changed });
      }
      if (sub === "drop") {
        const r = dropQuestion(a, d, args.join(" "), at);
        saved(`${a.slug} question dropped for ${d}`);
        return out(`Dropped: ${r.dropped}`, { ok: true, date: d, dropped: r.dropped });
      }
      if (sub === "write") {
        const last = talkDates(a).filter((x) => x < d).at(-1);
        if (!last) die(`The ${a.title} area has no talk before ${d} to write questions from.`);
        const r = writeQuestions(mcDir, a, last, at);
        if (!r) die("No questions could be written.");
        saved(`${a.slug} questions ${r.date}`);
        return out(`Written: ${rel(r.file)} (${r.count} questions).`, { ok: true, date: r.date, count: r.count });
      }
    } catch (e) { die(e.message); }
    die('godspeed-coach questions <area> [show] | add "<question>" --why "<why>" | drop "<words>" | write [--date <talk day>]');
  },
  habit() {
    const [sub, ...args] = pos;
    if (sub === "add") {
      const [area, slug] = args;
      if (!f.title && !slug) die('godspeed-coach habit add <area> <slug> --title "..." --done-means "..." --days daily');
      if (!area) die('Say the habit\'s area: godspeed-coach habit add <area> <slug> --title "..."');
      // A habit starts on its own, on day one: an area it names that does not exist yet is made for
      // it, with no talk (lib/areas.mjs habitArea). The five-habit cap and every other check stay
      // addHabit's; when it refuses, an area made for it is taken away again.
      let made = null;
      try {
        const { area: a, created } = habitArea(mcDir, area);
        made = created ? a : null;
        const h = addHabit(mcDir, { area: a.slug, slug, title: f.title || slug, doneMeans: f["done-means"] || "", days: f.days || "daily", agreed: f.agreed || "", auto: f.auto || "" }, today, s.max_habits);
        saved(`habit ${h.slug} started`);
        return out(`Started: ${h.title} (${h.slug}), ${h.daysText}, from ${h.started}.${made ? ` New area: ${made.title} (${made.slug}), with no talk.` : ""}`, { ok: true, habit: h.slug, area: a.slug, ...(made ? { area_created: true } : {}) });
      } catch (e) {
        if (made) fs.rmSync(made.dir, { recursive: true, force: true });
        die(e.message);
      }
    }
    if (sub === "track") {
      const words = args.join(" ").trim() || f.words;
      if (!words) die('Say which habit: godspeed-coach habit track "head lifts"');
      const h = needHabit(words);
      h.progressTimezone=s.timezone;
      const habitToday=localParts(at,h.timezone||s.timezone).date;
      const d=!f.date||f.date==='today'?habitToday:f.date==='yesterday'?addDays(habitToday,-1):dateArg(f.date);
      const ans = answerWord(f.answer);
      if(d>localParts(at,h.timezone||s.timezone).date)die('A completion cannot be recorded in the future.');
      const updated=track(h, d, ans, f.source || "cli", f.words || words);
      saved(`habit ${h.slug} ${d} ${ans}`);
      return out(`Tracked: ${h.title}, ${d}, ${ans}.`, { ok: true, slug:h.slug, date: d, answer: ans,reply:progressReply(updated),...progressResult(updated) });
    }
    if (sub === "untrack") {
      // "Delete the last head lifts", "undo that": the newest tracked day, or the day --date names,
      // is taken back, line and all (lib/habits.mjs untrack).
      const words = args.join(" ").trim() || f.words;
      if (!words) die('Say which habit: godspeed-coach habit untrack "head lifts"');
      const h = needHabit(words, { includeInactive: true });
      const d = f.date ? dateArg(f.date) : lastAnsweredDay(h);
      if (!d) die(`Nothing is tracked for ${h.title} yet.`);
      let updated;try { updated=untrack(h, d); } catch (e) { die(e.message); }
      saved(`habit ${h.slug} ${d} taken back`);
      return out(`Taken back: ${h.title}, ${d}.`, { ok: true, slug: h.slug, date: d,reply:progressReply(updated),...progressResult(updated) });
    }
    if (sub === "answer") {
      // "yes no" to tonight's check, in the order it asked.
      const d = dateArg(f.date);
      const asked = listHabits(mcDir, { status: "active" }).filter((h) => askedOn(h, d) && !answerOn(h, d));
      if (!asked.length) die("No habit check is waiting for an answer today.");
      const words = args.join(" ").split(/[\s,]+/).filter(Boolean);
      if (words.length !== asked.length && words.length !== 1) die(`The check asked about ${asked.length}: ${asked.map((h) => h.title).join(", ")}. Give one answer each, or one for all.`);
      const updated=[];
      const done = asked.map((h, i) => { const ans = answerWord(words[words.length === 1 ? 0 : i]);h.progressTimezone=s.timezone;updated.push(track(h, d, ans, f.source || "cli", f.words || words.join(" "))); return `${h.title} ${ans}`; });
      saved(`habits ${d}`);
      return out(`Tracked: ${done.join(", ")}.`, { ok: true, date: d, tracked: done,reply:updated.map(progressReply).join('\n'),habits:updated.map(h=>progressResult(h).progressCard) });
    }
    if (sub === "list") {
      const hs = listHabits(mcDir).filter((h) => f.all || h.status === "active");
      return out(hs.map((h) => `${h.slug}: ${h.title} (${h.area}${h.readBy.length ? `, also read by ${h.readBy.join(", ")}` : ""}, ${h.daysText}, ${h.status}${h.auto ? `, from data: ${h.auto}` : ""})`).join("\n") || "No habits.", hs.map(({ log, ...h }) => ({...h,progress:habitProgress(h,{now:at,timezone:s.timezone})})));
    }
    if (sub === "read-by") {
      // "The psychology talk may also look at my walk to work habit", "... no longer needs it"
      // (--remove), and with no area, who looks at it now. Only the habit's READ BY line changes
      // (lib/habits.mjs setHabitReader); its own talk keeps the evening check and graduation.
      const [ref, areaName, ...extra] = args;
      if (!ref || extra.length) die('godspeed-coach habit read-by "<habit>" <area> [--remove], with the habit\'s name in quotes, for example: godspeed-coach habit read-by "walk to work" psychology');
      const h = needHabit(ref, { includeInactive: true });
      const state = (x) => ({ ok: true, habit: x.slug, area: x.area, read_by: x.readBy });
      if (!areaName) { const reply = habitReadersWords(mcDir, h); return out(reply, { ...state(h), reply }); }
      try {
        const r = setHabitReader(mcDir, h, areaName, { remove: Boolean(f.remove) });
        if (r.changed) saved(`habit ${h.slug} ${f.remove ? "no longer" : "also"} read by ${r.area.slug}`);
        return out(r.reply, { ...state(r.habit), changed: r.changed, reply: r.reply });
      } catch (e) { die(e.message); }
    }
    if (sub==='progress') {
      const h=needHabit(args.join(' '),{includeInactive:true}),p=habitProgress(h,{now:at,timezone:s.timezone});
      return out(progressReply(h),{ok:true,reply:progressReply(h),...progressResult(h)});
    }
    if (['schedule','display','exempt','pause','resume'].includes(sub)) {
      const h=needHabit(args.join(' '),{includeInactive:true});let updated;
      h.progressTimezone=s.timezone;
      const date=habitEffectiveDate(h);
      if(sub==='schedule')updated=setHabitSchedule(h,f.days,date,s.timezone);
      else if(sub==='display')updated=setHabitDisplay(h,f.display);
      else if(sub==='exempt')updated=exemptHabitDays(h,assertDay(f.from||date),assertDay(f.to||f.from||date),f.words||'');
      else updated=setStatus(h,sub==='pause'?'paused':'active',date);
      saved(`habit ${h.slug} ${sub}`);return out(`Changed: ${h.title}.`,{ok:true,reply:progressReply(updated),...progressResult(updated)});
    }
    if (sub === "status") {
      const [ref, st] = args;
      const h = needHabit(ref, { includeInactive: true });
      try { h.progressTimezone=s.timezone;setStatus(h, st,habitEffectiveDate(h)); } catch (e) { die(e.message); }
      saved(`habit ${h.slug} ${st}`);
      return out(`${h.title} is now ${st}.`, { ok: true });
    }
    die("godspeed-coach habit add|track|untrack|answer|list|status|read-by");
  },
  habits() {
    if (pos[0] !== "week") die("godspeed-coach habits week [<area>]");
    const hs = listHabits(mcDir, { status: "active" }).filter((h) => !pos[1] || h.area === pos[1]);
    out(hs.map((h) => habitLine(h, today)).join("\n") || "No active habits.", hs.map((h) => ({ habit: h.slug, ...stats(h, today, 7) })));
  },
  context() {
    // --scheduled (or GODSPEED_SCHEDULED_RUN): a routine is reading this, not a conversation with
    // them, so a talk waiting for the chat stays waiting.
    const scheduled = Boolean(f.scheduled || process.env.GODSPEED_SCHEDULED_RUN);
    const waiting = waitingTalks(mcDir, s, at, { scheduled });
    const c = contextBlock(mcDir, s, at, { scheduled });
    if (c) process.stdout.write(c + "\n");
    for (const { area, ymd } of waiting) { try { setShown(area, ymd, at.toISOString().replace(/\.\d+Z$/, "Z")); } catch { /* shown again next turn */ } }
    if (waiting.length) saved("talk brought up in the chat");
  },
  tick() {
    pullQuietly(mcDir, syncMode);
    const table = s.daily_table ? readTable(path.isAbsolute(s.daily_table) ? s.daily_table : path.join(mcDir, s.daily_table)) : {};
    const { messages, writes } = dueTick(mcDir, s, at, table);
    for (const w of writes) {
      if (w.kind === "asked") track(w.habit, w.ymd, "asked", "tick", "");
      else if (w.kind === "auto") track(w.habit, w.ymd, "done", "data", w.words);
      else if (w.kind === "follow-up") setFollowUp(w.area, w.ymd, w.at);
      else if (w.kind === "not-held") setTalkState(w.area, w.ymd, "not-held");
      else if (w.kind === "questions") writeQuestions(mcDir, w.area, w.ymd, at, w.from);
    }
    commitCoach(mcDir, writes.length ? `coach: ${[...new Set(writes.map((w) => w.kind))].join(", ")}` : "coach: pending changes", syncMode);
    if (messages.length) process.stdout.write(messages.join("\n\n") + "\n");
  },
  config() {
    const [sub = "show", key, ...v] = pos;
    if (sub === "show") return console.log(JSON.stringify(s, null, 2));
    if (sub === "get") { if (!(key in s)) die(`There is no setting called "${key}".`); return console.log(String(s[key])); }
    if (sub === "set") {
      if (!key || !v.length) die("godspeed-coach config set <key> <value>");
      try { setSetting(mcDir, key, v.join(" ")); } catch (e) { die(e.message); }
      saved(`setting ${key}`);
      return console.log(`Changed: ${key} = ${v.join(" ")}`);
    }
    die("godspeed-coach config [show | get <key> | set <key> <value>]");
  },
  async setup() { const { setup } = await import("../lib/setup.mjs"); process.exitCode = await setup(f); },
  async check() { const { check } = await import("../lib/setup.mjs"); process.exitCode = await check(mcDir, f); },
  _sync() { syncQueued(mcDir); },
  help() {
    console.log(fs.readFileSync(new URL("../README.md", import.meta.url), "utf8").split("## Use")[1]?.split("\n## ")[0] || "See README.md");
  },
};

try {
  if (!commands[cmd]) die(`Unknown command "${cmd}". Try: godspeed-coach help`);
  await commands[cmd]();
} catch (e) {
  die(`godspeed-coach: ${e.message}`);
}
