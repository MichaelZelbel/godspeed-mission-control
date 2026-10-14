#!/usr/bin/env node
'use strict';
//
// check-moves.js - did today's decision make moves, or only paper? Type it as `mc-check-moves`.
//
// WHY THIS EXISTS (2026-09-24). The daily decision was rewritten around moves: concrete changes
// in the world, each prepared to the last click, three per active goal. Two test runs of the new
// recipe read that instruction and made two moves across three goals, reused the mission
// control's own old idea as "who did this", and finished in eight of the forty minutes it had.
// A sentence in a recipe is advice; the decision run follows advice when it is convenient. So
// the count and the fields are checked by a program, the way the work register checks that an
// item is done, and the run is told to keep going until this passes.
//
// WHAT IT CHECKS, in routines/next-action/<date>/moves.md against attention.txt beside it:
//   - every ACTIVE goal has at least --per-goal move blocks (default 3), or a line
//       FEWER <goal>: <why, in a sentence>
//     that says what stopped the rest (and that obstacle is tomorrow's first move).
//   - every move block (a heading "### <n>. ...") carries GOAL, WHERE, NOW, AFTER, WHO DID THIS,
//     HOW IT LANDS, UNDO and PERMISSION, none of them empty.
//   - WHO DID THIS names somebody outside: not "his own", "my own", "this mission control", a
//     work id or an idea file.
//   - AFTER is the thing itself, or names a file that exists and is not empty.
//   - a ship-list move the mission control applies names its work item on an APPLY line.
//   - a move under a standing permission, "PERMISSION: may:<kind>", names a kind its goal card has
//     a MAY line for (2026-10-12), or, for a strategy or project with none of its own, the card of
//     the first outcome on its SERVES line that has some (2026-10-13); it is not on the ship list,
//     so it needs no line there.
//   - once a goal's research brief names its limit ("LIMIT:" under "## The limit now"), each of
//     its moves carries "AIMS AT:" naming that limit; while it names none, a NOTE says so and the
//     moves pass (2026-10-12).
//   - at most one move of the whole day is the person's to do (HOW IT LANDS "only the person").
//   - a goal whose card names a weekly number (LEAD) is judged by it (2026-09-30): each of its
//     moves carries "BET: <now> -> <expected seven days after it goes live>" and an APPLY line,
//     the number was read in the last seven days, and a goal settle.txt names under "read today"
//     has a reading dated today. A goal with no LEAD is checked exactly as before.
//   - a dated chance that closes within fourteen days gets a move (2026-10-14): for each active
//     goal, every OPENING in goals/research/<its research goal>/openings.md whose UNTIL lies from
//     today to fourteen days on and whose IDEA names an idea file is cited by at least one move
//     (that idea's path or its name without .md), reported once per idea; an IDEA of "none ..." is
//     exempt. Why: the decision twice kept a chance closing within the week away from the person,
//     writing that it "changes no weekly number", though its recipe says such a chance gets a move.
//     An opening whose idea file says "STATUS: dropped" (the person said no) or "STATUS: made" is
//     skipped, though it stays in openings.md until its UNTIL; a missing idea file is still required.
//
//   mc-check-moves --date 2026-09-24 [--per-goal 3] [--godspeed DIR]
//
// Exit 0 and it prints OK with the count per goal. Exit 1 and it prints one line per gap.

const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf('--' + name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };
function findRoot(start) {
  let d = start;
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(d, 'rules')) || fs.existsSync(path.join(d, 'goals'))) return d;
    const p = path.dirname(d); if (p === d) break; d = p;
  }
  return start;
}
const ROOT = opt('godspeed', process.env.GODSPEED_ROOT || findRoot(process.cwd()));
const DATE = opt('date', process.env.GODSPEED_TODAY || new Date().toISOString().slice(0, 10));
const PER = parseInt(opt('per-goal', '3'), 10) || 3;
const RUN = path.join(ROOT, 'routines', 'next-action', DATE);

const problems = [];
const read = (p) => { try { return fs.readFileSync(p, 'utf8').replace(/\r/g, ''); } catch (e) { return null; } };
const { blocks: parseBlocks, limitOf: limitIn, standingOf } = require(path.join(__dirname, 'goals.js'));
// Which goal's research a move is held to: the goal's own folder if it has one, else the folder of
// the first outcome its card says it SERVES that has one (a strategy uses the research of the
// outcome it serves). Returns the research goal id, or null when no research exists.
const SAFE_ID = /^[a-z0-9][a-z0-9-]*$/;
const hasResearch = (id) => SAFE_ID.test(id) && fs.existsSync(path.join(ROOT, 'goals', 'research', id));
function researchGoal(goal) {
  if (!SAFE_ID.test(goal)) return null;
  if (hasResearch(goal)) return goal;
  const card = read(path.join(ROOT, 'goals', goal + '.md'));
  const m = card && card.match(/^SERVES:[ 	]*(.*)$/m);
  if (!m) return null;
  return m[1].split(',').map(s => s.trim()).filter(Boolean).find(hasResearch) || null;
}
// The names a goal's research knows: its cases and its people. Once a goal has any, a move for it
// copies one of them, because a move copies what worked for somebody we actually read about
// (2026-10-11: the moves had been copying names from the model's memory).
const researchNames = {};
function namesOf(goal) {
  const rg = researchGoal(goal);
  if (!rg) return { from: null, names: [] };
  if (!(rg in researchNames)) {
    const dir = path.join(ROOT, 'goals', 'research', rg);
    researchNames[rg] = [...parseBlocks(read(path.join(dir, 'cases.md')), 'CASE').map(b => b.CASE),
                         ...parseBlocks(read(path.join(dir, 'people.md')), 'PERSON').map(b => b.PERSON)]
      .filter(Boolean).map(s => s.toLowerCase());
  }
  return { from: rg, names: researchNames[rg] };
}
// The one thing that limits a goal now, as its research brief names it: the LIMIT: line under
// "## The limit now" in goals/research/<id>/brief.md (2026-10-12), read by goals.js limitOf, the
// one reading check-research and the trial check share (2026-10-13). null while the research
// names none (founding night, or no research at all), and then a move for the goal needs no aim.
const limits = {};
function limitOf(goal) {
  const rg = researchGoal(goal);
  if (!rg) return null;
  if (!(rg in limits)) {
    const limit = limitIn(read(path.join(ROOT, 'goals', 'research', rg, 'brief.md')) || '');
    limits[rg] = limit ? limit.replace(/\s+/g, ' ') : null;
  }
  return limits[rg];
}
// The kinds of step a goal lets go out without a fresh yes: its MAY lines, each written by
// `mc-goals allow` with the person's own words (2026-10-12); for a strategy or project with none
// of its own, those of the first outcome on its SERVES line that has some (goals.js standingOf,
// the reading work.js files the step under, 2026-10-13). { holder, kinds }.
const mayKinds = {};
function kindsOf(goal) {
  if (!SAFE_ID.test(goal)) return { holder: null, kinds: [] };
  if (!(goal in mayKinds)) {
    const st = standingOf(ROOT, goal);
    mayKinds[goal] = { holder: st && st.holder, kinds: st ? st.lines.map(m => m.kind) : [] };
  }
  return mayKinds[goal];
}
const days = (a, b) => Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000);
function leadOf(goal) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(goal)) return null;
  const t = read(path.join(ROOT, 'goals', goal + '.md'));
  const m = t && t.match(/^LEAD:[ \t]*(.+)$/m);
  if (!m || m[1].split('|').length !== 3) return null;
  const reads = [...t.matchAll(/^- (\d{4}-\d{2}-\d{2}) READ /gm)].map(x => x[1]).sort();
  const sets = [...t.matchAll(/^- (\d{4}-\d{2}-\d{2}) CHANGED LEAD /gm)].map(x => x[1]).sort();
  return { lastRead: reads.length ? reads[reads.length - 1] : null, lastSet: sets.length ? sets[sets.length - 1] : null };
}
// A weekly number set in the last seven days may wait for its first reading: a number only the
// person can tell is asked for on the day's card, and the answer can take a few days.
const fresh = (lead) => lead.lastSet && days(lead.lastSet, DATE) <= 7;
const BET_LINE = /^BET:[ \t]*(-?\d+(?:\.\d+)?)\s*(?:->|→)\s*(-?\d+(?:\.\d+)?)/m;

const att = read(path.join(RUN, 'attention.txt'));
const active = [];
if (att) {
  let inActive = false;
  for (const line of att.split('\n')) {
    if (/^active:/.test(line)) { inActive = true; continue; }
    if (/^\S/.test(line)) { inActive = false; continue; }
    const m = line.match(/^  ([a-z0-9][a-z0-9-]*)\s+outcome\b/);
    if (inActive && m) active.push(m[1]);
  }
}

const text = read(path.join(RUN, 'moves.md'));
if (text === null) {
  console.log(`no moves.md in the run folder for ${DATE}: today's decision made no moves`);
  process.exit(1);
}

const FIELDS = ['GOAL', 'WHERE', 'NOW', 'AFTER', 'WHO DID THIS', 'HOW IT LANDS', 'UNDO', 'PERMISSION'];
// Read like the fields above, but required only for a goal whose research names its limit.
const PARSED = [...FIELDS, 'AIMS AT'];
const notes = [];
const noted = new Set();
let persons = 0;
const blocks = text.split(/^(?=###? \d+\.)/m).filter(b => /^###? \d+\./.test(b));
// A MOVE THE CHECK CANNOT SEE IS NOT CHECKED (2026-09-30). A run on Hermes headed its moves
// "### Move 1: ...": no block matched, FEWER lines covered the count, and not one field was read
// (a bet with no APPLY got through, and mc-goals bets, which splits the same way, recorded none).
// Every GOAL line must sit in its own numbered block.
const goalLines = (s) => (s.match(/^GOAL:/gm) || []).length;
const seen = blocks.reduce((n, b) => n + Math.min(goalLines(b), 1), 0);
const unseen = goalLines(text) - seen;
if (unseen > 0) problems.push(`${unseen} move(s) are not under a heading "### <n>. <what changes where>" of their own (a "GOAL:" line outside one, or two moves under one heading), so their fields cannot be checked and their bets never reach the goal card; give every move that heading, numbered 1, 2, 3...`);
const counts = {};
for (const b of blocks) {
  const title = b.split('\n')[0].replace(/^#+\s*/, '').trim();
  const f = {};
  let cur = null;
  for (const line of b.split('\n').slice(1)) {
    const m = line.match(/^([A-Z][A-Z ]+):\s?(.*)$/);
    if (m && PARSED.includes(m[1].trim())) { cur = m[1].trim(); f[cur] = m[2]; continue; }
    if (cur && /^\s+\S/.test(line)) f[cur] += ' ' + line.trim();
  }
  for (const k of FIELDS) if (!f[k] || !f[k].trim()) problems.push(`move "${title}": ${k} is missing or empty`);
  const goal = (f.GOAL || '').trim();
  if (goal) counts[goal] = (counts[goal] || 0) + 1;
  const who = f['WHO DID THIS'] || '';
  if (/\b(his own|my own|her own|their own|this mission control|mission control's own)\b|W-\d{8}-\d+|ideas\//i.test(who)) {
    problems.push(`move "${title}": WHO DID THIS must name somebody outside who did this, not the person's or the mission control's own work`);
  }
  const known = goal ? namesOf(goal) : { from: null, names: [] };
  if (known.names.length && !known.names.some(n => who.toLowerCase().includes(n))) {
    problems.push(`move "${title}": WHO DID THIS must name a person or case from goals/research/${known.from}/ (cases.md or people.md); if the one you copied is not there, add them there first with the source you read`);
  }
  // A move on the ship list that the mission control applies needs its work item named, or a
  // "ship 2" answer reaches nothing (ship-list-apply reads this line).
  const lead = leadOf(goal);
  const bet = b.match(BET_LINE);
  if (lead && !bet) problems.push(`move "${title}": ${goal} has a weekly number, so the move needs a line "BET: <the number now> -> <what you expect seven days after it goes live>"`);
  // A bet of no change is not a move for this goal (the replay of 2026-09-30 made three: a
  // thank-you "betting on a reply", a call's topics "that add no contact", run days "held"). Name
  // the change it should make, or file it as work beside the moves.
  else if (lead && parseFloat(bet[1]) === parseFloat(bet[2])) problems.push(`move "${title}": its BET (${bet[1]} -> ${bet[2]}) bets on no change, so it is not a move for ${goal}'s weekly number; name the change you expect within seven days of going live, or file it as work beside the moves`);
  // A step under a standing permission names its kind, "PERMISSION: may:<kind>", and the goal's
  // card must hold a MAY line for that kind (a strategy's or project's with none of its own: its
  // outcome's); such a step goes out at its time unless stopped, so it is never on the ship list
  // and needs no line there.
  const may = (f.PERMISSION || '').match(/^\s*may:\s*([a-z0-9-]+)?/i);
  const kind = may ? may[1] || '' : '';
  const allowed = may ? kindsOf(goal) : null;
  if (may && !allowed.kinds.includes(kind)) problems.push(`move "${title}": PERMISSION may:${kind} is not a standing permission of ${goal}`
    + (allowed.holder && allowed.holder !== goal ? ` (it has none of its own and uses those of ${allowed.holder}, the outcome it serves)` : '')
    + `; use a kind it has a MAY line for (mc-goals may ${goal}), or put the move on the ship list`);
  const onList = !may && /ship list/i.test(f.PERMISSION || '');
  const his = /^\s*only the person/i.test(f['HOW IT LANDS'] || '');
  if (his) persons++;
  // EVERY MOVE AIMS AT THE LIMIT (2026-10-12). Changes that touch only what the mission control may
  // touch, on pages nobody visits, move no goal's number. Once the goal's research names what
  // limits it now, the move says how it moves that.
  if (goal) {
    const limit = limitOf(goal);
    const key = limit && limit.slice(0, 40).trimEnd();
    const aims = (f['AIMS AT'] || '').replace(/\s+/g, ' ').toLowerCase();
    if (key && !aims.includes(key.toLowerCase())) problems.push(`move "${title}": AIMS AT must name this goal's limit ("${key}...") from goals/research/${researchGoal(goal)}/brief.md, and say in one line how this move moves it`);
    else if (!limit && !noted.has(goal)) {
      noted.add(goal);
      notes.push(researchGoal(goal) ? `NOTE ${goal}: no LIMIT named yet in its research; AIMS AT not required`
        : `NOTE ${goal}: has no research yet; AIMS AT not required`);
    }
  }
  const applyTo = (b.match(/^APPLY:[ \t]*(\S+)/m) || [])[1];
  if (lead && !applyTo) problems.push(`move "${title}": a move with a bet needs "APPLY: <work id>", the item whose verification starts its seven days (a move only the person can make gets an item they own, whose CHECK shows it happened)`);
  // The item exists by the time this runs, so a bet names it or it is lost (final review of D-266:
  // "APPLY: (filed below)" passed, and mc-goals bets could record nothing for it).
  else if (lead && !(/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(applyTo) && fs.existsSync(path.join(ROOT, 'work', applyTo + '.md')))) problems.push(`move "${title}": its APPLY (${applyTo}) names no work item on the register; file the item and write its id there, or the bet never reaches ${goal}'s card`);
  else if (!lead && !/^APPLY:\s*\S+/m.test(b) && onList && !his) problems.push(`move "${title}": on the ship list but no "APPLY: <work id>" line, so an answer by number cannot reach it`);
  const after = (f.AFTER || '').trim();
  const file = after.match(/([A-Za-z0-9_.-]+\/[A-Za-z0-9_./-]+\.(?:md|txt|html|json|csv))/);
  if (file && after.length < 200) {
    const p = path.join(ROOT, file[1]);
    if (!fs.existsSync(p) || fs.statSync(p).size < 50) problems.push(`move "${title}": AFTER points to ${file[1]}, which is not there or empty`);
  }
}

// AT MOST ONE THING A DAY FOR THE PERSON (2026-10-12), across all goals: a day that hands them two
// or three tasks hands them a routine they never asked for, and the moves that wait on them do
// not happen.
if (persons > 1) problems.push(`at most one move a day may be the person's to do; ${persons} are (HOW IT LANDS "only the person"); keep the one they already said they want, and find a route the mission control holds for the rest, or leave them for another day and write "FEWER <goal>: the person's one step today is move <n>" for a goal that is left short`);

// A DATED CHANCE CLOSING SOON GETS A MOVE (2026-10-14). Twice the decision read a chance in a goal's
// research that closed within the week and left it out, writing that it "changes no weekly number";
// the person never heard of it and the date passed. A chance with an idea file that closes within
// fourteen days is carried by a move that cites the idea (its path, or its name without .md): on the
// ship list as a question for the person, or as the person's one step today. A FEWER line does not
// excuse it. Several openings may share one idea; it is reported once, with its earliest date.
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (s) => ISO_DAY.test(s) && !isNaN(Date.parse(s + 'T00:00:00Z')) && new Date(s + 'T00:00:00Z').toISOString().slice(0, 10) === s;
const IDEA_FILE = /ideas\/[A-Za-z0-9._-]+\.md/;
// An idea already settled needs no move: the person said no (dropped) or it is done (made). Its
// opening stays in openings.md until its UNTIL, so without this the day would be refused for it
// every morning. Read from the idea file's own first STATUS line; a missing file is not settled.
const settled = new Map();
function ideaSettled(rel) {
  if (!settled.has(rel)) {
    const st = (read(path.join(ROOT, rel)) || '').match(/^STATUS:[ \t]*(.*)$/m);
    settled.set(rel, !!st && /^(?:dropped|made)\b/i.test(st[1].trim()));
  }
  return settled.get(rel);
}
const chances = new Map();
const openingsRead = new Set();
for (const g of active) {
  const rg = researchGoal(g);
  if (!rg || openingsRead.has(rg)) continue;
  openingsRead.add(rg);
  for (const o of parseBlocks(read(path.join(ROOT, 'goals', 'research', rg, 'openings.md')), 'OPENING')) {
    const until = (o.UNTIL || '').trim();
    if (!validDay(until)) continue;
    const left = days(DATE, until);
    if (left < 0 || left > 14) continue;
    const idea = (o.IDEA || '').trim();
    if (/^none\b/i.test(idea)) continue;
    const file = idea.match(IDEA_FILE);
    if (!file || ideaSettled(file[0])) continue;
    const had = chances.get(file[0]);
    if (!had || until < had.until) chances.set(file[0], { goal: g, opening: (o.OPENING || '').replace(/\s+/g, ' ').trim(), until });
  }
}
const moveTexts = blocks.map(b => b.toLowerCase());
for (const [idea, c] of chances) {
  const slug = path.basename(idea, '.md').toLowerCase();
  if (moveTexts.some(t => t.includes(idea.toLowerCase()) || t.includes(slug))) continue;
  const short = c.opening.length > 80 ? c.opening.slice(0, 80).trimEnd() + '...' : c.opening;
  problems.push(`${c.goal}: the chance "${short}" closes on ${c.until} and no move today carries it; make it a move (on the ship list as a question for the person, or as the person's one step today) and cite ${idea} in that move`);
}

const fewer = {};
// Two reasons are refused, because the recipe answers both (2026-09-24, test run 4 used them for
// every goal): a thin ideas register (the next move comes from what people who got there did,
// read today) and a platform nobody is signed in to (the move is prepared anyway and its
// ship-list line asks for the one sign-in).
// Running out of time is refused too: the run has forty minutes and the moves are where they go
// (test run 6 said "not in the time this run had" at minute 13). A reason may run over several
// lines, and all of it is read, up to the next blank line, move or FEWER line.
// A missing or draft playbook is refused as well (2026-09-30, a test reader on Hermes gave a new
// goal no moves "because the playbook is a draft"): the runner researches it, and today's moves
// come from two or three real cases read today.
const REFUSED = /\b(register|ideas?\b|signed[- ]in|sign-in|session|log(?:ged)?[- ]?in|no route|route .*not hold|in the time|time (?:this|the) run|run had|to (?:that|the same) standard|no playbook|playbook (?:is |was )?(?:a |still )?(?:draft|missing|not (?:yet )?(?:written|researched|current))|draft playbook)/i;
for (const m of text.matchAll(/^FEWER ([a-z0-9-]+):[ \t]*(\S[^\n]*(?:\n(?![ \t]*\n)(?!#+ \d+\.)(?!FEWER )[^\n]*)*)/gm)) {
  if (REFUSED.test(m[2])) problems.push(`FEWER ${m[1]}: a thin ideas register, a missing sign-in or running out of time is not a reason for fewer moves; read what people who reached this goal did at this stage, prepare moves for unsigned platforms anyway (the ship list asks for the sign-in), and use the time the run has`);
  else fewer[m[1]] = m[2];
}
for (const g of active) {
  const n = counts[g] || 0;
  if (n < PER && !fewer[g]) problems.push(`${g}: ${n} move(s), fewer than ${PER}, and no "FEWER ${g}: <why>" line`);
}
// A NUMBER ONLY THE PERSON CAN TELL, NOT TOLD (final review of D-266): "UNREAD <goal>: <where and
// when it was asked>" lets the day pass honestly, the way FEWER does for moves; settle then writes
// "unread" by itself when a verdict's reading never comes. Without it the only way through was to
// re-record an old value as today's reading.
const unread = {};
for (const m of text.matchAll(/^UNREAD ([a-z0-9-]+):[ \t]*(\S[^\n]*)$/gm)) unread[m[1]] = m[2];
for (const g of active) {
  const lead = leadOf(g);
  if (lead && !unread[g] && (!lead.lastRead || days(lead.lastRead, DATE) > 7) && !fresh(lead)) problems.push(`${g}: its weekly number was not read in the last seven days; read it and record it: mc-goals read ${g} <number> --where "...", or, when only the person can tell it and has not, write a line "UNREAD ${g}: <where and when you asked>"`);
}
const settleTxt = read(path.join(RUN, 'settle.txt')) || '';
const dueLine = settleTxt.match(/^read today:[ \t]*(.*)$/m);
for (const g of (dueLine ? dueLine[1].split(/\s+/) : []).filter(x => x && x !== 'none')) {
  const lead = leadOf(g);
  if (lead && !unread[g] && lead.lastRead !== DATE) problems.push(`${g}: a verdict is due today and its weekly number has no reading dated ${DATE}; read it and record it: mc-goals read ${g} <number> --where "...", or, when only the person can tell it and has not, write a line "UNREAD ${g}: <where and when you asked>"`);
}

// A NOTE explains and never fails a day; it is printed after the gaps or after OK.
if (problems.length) {
  for (const p of problems) console.log(p);
  for (const n of notes) console.log(n);
  process.exit(1);
}
console.log('OK ' + (active.length ? active.map(g => `${g} ${counts[g] || 0}${fewer[g] ? ' (fewer: said why)' : ''}`).join(', ') : `${blocks.length} move(s)`));
for (const n of notes) console.log(n);
