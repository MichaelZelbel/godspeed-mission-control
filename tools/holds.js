#!/usr/bin/env node
'use strict';
//
// holds.js - the steps the person declined or postponed, read from the notebook's claims, so a
// proposal they already answered is not put in front of them again. Type it as `mc-holds`.
//
// WHY THIS EXISTS (#282, 2026-11-11). The person said "not yet, only once the book is out of beta"
// about an interview invitation. The assistant saved it as a world claim about the book, and for
// sixteen mornings the brief still asked for a yes on the same invitation: nothing that put a
// proposal in front of them read the claims. Now every program that does (mc-decide, the moves
// check, the work register, the notebook's mirror of the work cards) asks this file, live, which
// proposals a current claim holds. Nothing "held" is stored anywhere, so a hold lifts by itself the
// day its claim or its condition ends.
//
// A HOLD CLAIM is a claim record of the notebook (Facts/, docs/full-version/file-format.md) with
//   stance: declined | postponed
//   steps: [interview, ...]   optional: the kinds of step it holds; without it, every step
//   until: <claim>            optional, postponed only: it holds while that claim is current
//   valid_to: YYYY-MM-DD      optional: it holds through the day before
// Until the old world/claims/ files were taken into the notebook (#90) a hold was a file there; the
// notebook takes in what an older version still writes (notebook/core/world-copy.mjs).
// A PROPOSAL names the notebook's people and things it touches (a move's TOUCHES line, a work card's TOUCHES
// field). It is held when it touches the claim's subject and, if the claim names steps, one of
// them begins a word of the proposal's own line (a move's heading, a card's WHAT). A proposal that
// touches nothing is never held.
//
// A CLAIM IS CURRENT on day D when its valid_from is empty or at most D and its valid_to is empty
// or after D, and no newer claim replaces it: one with the same subject and attribute whose
// valid_from is later than its own and at most D (the way a fact changes).
// An `until` claim the notebook does not have keeps the hold, and `list` says so: silently
// asking again is the failure this exists to stop.
//
//   mc-holds list [--date D] [--json]
//   mc-holds hold --subject <slug> --stance declined|postponed --words "<their words>"
//                 [--steps "<word>, <word>"] [--until <claim>] [--to YYYY-MM-DD] [--attribute A] [--date D]
//   mc-holds end <claim> --words "<their words>" [--date D]
//   mc-holds strip --run <run folder> [--date D]     mc-decide's: takes held moves out of moves.md

const fs = require('fs');
const path = require('path');
const L = require(path.join(__dirname, 'mc-cards.js'));
const { notebookCore } = require(path.join(__dirname, 'notebook-core.js'));

const STANCES = ['declined', 'postponed'];
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

const text = (v) => (Array.isArray(v) ? v.join(', ') : String(v == null ? '' : v)).trim();
const day = (v) => { const s = text(v); return L.isoDate(s) ? s : ''; };
const sameAttribute = (a, b) => text(a).toLowerCase().replace(/[-_\s]+/g, '-') === text(b).toLowerCase().replace(/[-_\s]+/g, '-');

// The notebook's claims and the code that reads them. A copy of this program with no notebook
// beside it cannot know what is held, and says so rather than reading "nothing is held".
function world(root, given = null) {
  const dir = notebookCore(root, 'world-records.mjs');
  if (!dir) throw new Error('I could not find the notebook that keeps your claims, so I did not read or change anything. Run this through your mission control (godspeed ...).');
  const records = require(path.join(dir, 'world-records.mjs'));
  return { records, store: records.openWorld(root, given) };
}
// Every live claim, as { name, id, uid, f } where f has the fields the rules below read.
const readClaims = (records, store) => records.claimRows(store).map(c => ({ name: c.name, id: c.name, uid: c.uid, f: c }));

const started = (c, date) => !day(c.f.valid_from) || day(c.f.valid_from) <= date;
const closed = (c, date) => !!day(c.f.valid_to) && day(c.f.valid_to) <= date;
function replacedBy(c, all, date) {
  const own = day(c.f.valid_from);
  return all.find(o => o !== c && text(o.f.subject) === text(c.f.subject) && sameAttribute(o.f.attribute, c.f.attribute)
    && day(o.f.valid_from) && day(o.f.valid_from) > own && day(o.f.valid_from) <= date) || null;
}
const current = (c, all, date) => started(c, date) && !closed(c, date) && !replacedBy(c, all, date);

// Every hold that is in force on `date`, { id, name, subject, stance, steps, value, until, waiting },
// and `skipped`: one line for each claim that may be a hold but cannot be read as one.
// `waiting` says what the condition claim is: 'current', 'missing', or '' when there is none.
// A notebook that cannot be read throws: "could not tell" must never read as "nothing is held".
function readHolds(root, date, store = null) {
  const { records, store: opened } = world(root, store);
  store = opened;
  const all = readClaims(records, store);
  const byRef = new Map(all.flatMap(c => [[c.uid, c], [c.name, c]]));
  const holds = [], skipped = [];
  for (const c of all) {
    const stance = text(c.f.stance).toLowerCase();
    if (!STANCES.includes(stance) || !current(c, all, date)) continue;
    if (!SLUG.test(text(c.f.subject))) {
      skipped.push(`${c.id}: stance ${stance}, but its subject "${text(c.f.subject)}" is not the slug of a person or thing, so it holds nothing`);
      continue;
    }
    const wanted = stance === 'postponed' ? text(c.f.until) : '';
    let waiting = '', until = '';
    if (wanted) {
      const cond = byRef.get(wanted);
      if (cond && (closed(cond, date) || replacedBy(cond, all, date))) continue;
      waiting = cond ? 'current' : 'missing';
      until = cond ? cond.name : text(c.f.untilName) || wanted;
    }
    const steps = (Array.isArray(c.f.steps) ? c.f.steps : text(c.f.steps).split(',')).map(s => text(s).toLowerCase()).filter(Boolean);
    holds.push({ id: c.id, name: c.name, subject: text(c.f.subject), stance, steps, value: text(c.f.value), until, waiting });
  }
  return { holds, skipped };
}
const currentHolds = (root, date, store = null) => readHolds(root, date, store).holds;

// The words of a TOUCHES line or field, as written; "none" and empty name nothing. mc-work file
// refuses one that is not a SLUG, and matching reads them lower-cased (parseTouches).
const touchTokens = (s) => text(s).split(/[\s,]+/).filter(t => t && t.toLowerCase() !== 'none');
const parseTouches = (s) => touchTokens(s).map(t => t.toLowerCase());
// A move's TOUCHES in moves.md: its line plus the indented lines that continue it, the way the
// next-action recipe wraps it. The moves check and strip both read it here, so they hold the same moves.
function moveTouches(block) {
  const lines = String(block).replace(/\r/g, '').split('\n');
  const at = lines.findIndex(l => /^TOUCHES:/.test(l));
  if (at < 0) return undefined;
  let value = lines[at].replace(/^TOUCHES:[ \t]*/, '');
  for (let i = at + 1; i < lines.length && /^\s+\S/.test(lines[i]); i++) value += ' ' + lines[i].trim();
  return value;
}
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// The first hold that holds a proposal touching `touches` (slugs, or a TOUCHES string) whose own
// line is `text`, or null.
function heldBy(holds, { touches, text: line }) {
  const slugs = Array.isArray(touches) ? touches : parseTouches(touches);
  if (!slugs.length) return null;
  return holds.find(h => slugs.includes(h.subject)
    && (!h.steps.length || h.steps.some(w => new RegExp('\\b' + escape(w), 'i').test(String(line || ''))))) || null;
}
function describe(h) {
  return `${h.id} (${h.stance}, "${h.value}")`;
}
function condition(h) {
  return !h.until ? '' : h.waiting === 'missing' ? `until ${h.until}, which the notebook does not have (it holds until that is fixed)`
    : `until ${h.until}: still current`;
}

// ------------------------------------------------------------------------------- the commands
const ROOT_OF = (a) => a.godspeed || L.godspeedRoot(__filename);
const DATE_OF = (a) => {
  const d = a.date && a.date !== 'true' ? a.date : L.today();
  if (!L.isoDate(d)) L.die('--date is YYYY-MM-DD');
  return d;
};
const words = (a) => (a.words === 'true' ? '' : L.oneLine(a.words));
const yamlValue = (s) => (/^[\w .,;!?()'&/-]*$/.test(s) && !/^['\s]/.test(s) ? s : JSON.stringify(s));

const cmds = {};
cmds.list = (a) => {
  const { holds, skipped } = readHolds(ROOT_OF(a), DATE_OF(a));
  if (L.flag(a, 'json')) { L.say(JSON.stringify({ holds, skipped }, null, 2)); return; }
  if (!holds.length) L.say('nothing is held');
  for (const h of holds) {
    L.say(`${h.id}: ${h.stance}, ${h.steps.length ? 'steps: ' + h.steps.join(', ') : 'every step'}, touching ${h.subject}; the person said "${h.value}"`
      + (h.until ? `; ${condition(h)}` : ''));
  }
  for (const line of skipped) L.say(`skipped: ${line}`);
};

cmds.hold = (a) => {
  const root = ROOT_OF(a), d = DATE_OF(a);
  const subject = L.oneLine(a.subject);
  if (!SLUG.test(subject)) L.die('--subject is the slug of a person or thing in the notebook: lower-case letters, digits and dashes');
  const stance = L.oneLine(a.stance);
  if (!STANCES.includes(stance)) L.die('--stance is declined or postponed');
  const said = words(a);
  if (!said) L.die('--words is required: what the person said, as they said it');
  const steps = a.steps && a.steps !== 'true' ? parseTouches(a.steps) : [];
  const { records, store } = world(root);
  let until = '', untilName = '';
  if (a.until !== undefined) {
    if (stance !== 'postponed') L.die('--until is for a postponement; a step declined stays declined until you end it');
    untilName = a.until === 'true' ? '' : L.oneLine(a.until);
    const cond = records.claimRows(store).find(c => c.name === untilName || c.id === untilName || c.uid === untilName);
    if (!untilName || !cond) L.die(`--until names no claim in the notebook (${untilName || 'nothing'}); write the claim it waits on first, or use --to <date>`);
    until = cond.uid; untilName = cond.name;
  }
  const to = a.to === undefined ? '' : String(a.to);
  if (a.to !== undefined && (!L.isoDate(to) || to <= d)) L.die('--to is a day after today, YYYY-MM-DD: the hold lifts on that day');
  const attribute = L.oneLine(a.attribute || (steps.length ? `${steps[0]}-stance` : 'proposals-stance')).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const { name } = records.writeHold(store, { subject, stance, words: said, steps, until, untilName, to, attribute, day: d });
  L.say(`${name}: ${stance}${steps.length ? ' ' + steps.join(', ') : ''} touching ${subject}`
    + (until ? `, until ${untilName} ends` : to ? `, until ${to}` : ''));
};

cmds.end = (a) => {
  const root = ROOT_OF(a), d = DATE_OF(a);
  const name = L.oneLine(a._[0] || L.die('usage: mc-holds end <claim> --words "<their words>"'));
  const said = words(a);
  if (!said) L.die('--words is required: what the person said, as they said it');
  const { records, store } = world(root);
  const done = records.endClaim(store, name, { day: d, words: said });
  if (done.missing) L.die(`no claim ${name} in the notebook`);
  if (done.menerio) L.die(`${name} came from Menerio; fix it in the notebook`);
  if (done.ended) L.die(`${name} already ended on ${done.ended}`);
  L.say(`${name}: ended on ${d}`);
};

// STRIP, run by mc-decide after the moves check. A move the person declined or postponed that is
// still in moves.md after the run was sent back once is taken out by program: the block goes to
// held.md and a HELD line stays in its place. Today's card is the run's own text, so only the held
// move's title is taken off it, where it first stands as a whole card item; every other line stays as the
// run wrote it. A card that does not carry the title may name the step in other words, so it gets
// one "Held back" line saying the step is not applied. Then one line per held proposal and per
// claim that could not be read as one, which is the log a schedule keeps (decide.log).
const MOVE_HEADING = /^###? \d+\./;
const TAIL = /^(?:FEWER|UNREAD|HOLD|HELD) |^## /;
const OPEN_WAITING = ['planned', 'dispatched', 'attempted', 'blocked'];
// A card item starts at the start of the card, or after a semicolon, a line end or a colon, with an
// optional list marker ("1." "2)" "-" "*"). It ends at a semicolon, a line end or a full stop; failing
// that, at a parenthesised remark such as "(carried)". An item that only contains the held title
// ("Draft and post on LinkedIn", "Re-post on LinkedIn") is not the held step and is left alone.
const ITEM_START = '(^|[;:\\n])([ \\t]*(?:\\d+[.)][ \\t]*|[-*][ \\t]+)?)';
const ITEM_ENDS = ['(?=[ \\t]*(?:[;\\n]|\\.(?!\\S)|$))', '(?=[ \\t]*\\()'];
// Where in text the held title stands as a whole item: { from, to } of the title, or null. A plain
// item wins over one with a remark, so "Post on LinkedIn (recap); Post on LinkedIn" takes the second.
function itemAt(text, title) {
  const t = escape(title).replace(/\s+/g, '\\s+');
  for (const tail of ITEM_ENDS) {
    const m = new RegExp(ITEM_START + t + tail, 'i').exec(text);
    if (m) { const from = m.index + m[1].length + m[2].length; return { from, to: m.index + m[0].length }; }
  }
  return null;
}
// One section of decision.md by its exact heading: { m, body } or null.
function sectionOf(decision, heading) {
  const m = new RegExp(`^## ${heading}[ \\t]*\\n([\\s\\S]*?)(?=^## |(?![\\s\\S]))`, 'm').exec(decision);
  return m ? { m, body: m[1] } : null;
}
function withNotes(body, notes) {
  if (!notes.length) return body;
  const kept = body.replace(/\s*$/, ''), gap = body.slice(kept.length);
  return (kept ? kept + '\n' : '') + notes.join('\n') + (gap.length > 1 ? gap : '\n');
}
function putSection(decision, s, body) {
  return decision.slice(0, s.m.index) + s.m[0].slice(0, s.m[0].length - s.body.length) + body + decision.slice(s.m.index + s.m[0].length);
}
// decision.md with the held moves off its "For you today" card and its "## Moves" list (see STRIP above).
function withoutHeld(decision, held) {
  const marks = (x) => `(held back: you ${x.h.stance} this, ${x.h.id})`;
  // The Moves list: the held move's line keeps its number and goal, and the rest of it (what it
  // changes, "(ship list)") is replaced by the held-back mark.
  const moves = sectionOf(decision, 'Moves');
  if (moves) {
    let body = moves.body;
    const notes = [];
    for (const x of held) {
      const at = itemAt(body, x.title);
      if (at) { const eol = body.indexOf('\n', at.from); body = body.slice(0, at.from) + marks(x) + (eol < 0 ? '' : body.slice(eol)); }
      else notes.push(`Held back: move ${x.n} of moves.md is a step you ${x.h.stance} (${x.h.id}); if a line here names it in other words, it is not on the ship list.`);
    }
    decision = putSection(decision, moves, withNotes(body, notes));
  }
  const card = sectionOf(decision, 'For you today[^\\n]*');
  let body = card ? card.body : '';
  const notes = [];
  let marked = 0;
  for (const x of held) {
    const at = itemAt(body, x.title);
    if (at) { body = body.slice(0, at.from) + marks(x) + body.slice(at.to); marked++; }
    else notes.push(`Held back: move ${x.n} of moves.md is a step you ${x.h.stance} (${x.h.id}); if this card names it in other words, it is not applied.`);
  }
  if (!card) return decision.replace(/\s*$/, '') + `\n\n## For you today\n${notes.join('\n')}\n`;
  return putSection(decision, card, withNotes(recount(body, marked), notes));
}
// THE CARD COUNTS ONLY WHAT IS READY (2026-11-11, #405). The run counted its card's items before a
// held one was marked "held back", so "3 changes are ready" stood over two that were. The first
// "<N> changes are ready" of the card loses the items marked here and says how many are held back,
// in the run's own way of writing the number (a digit, or a word up to twelve).
const NUMBER_WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
const READY = new RegExp(`\\b(\\d+|${NUMBER_WORDS.join('|')})(\\s+)changes?(\\s+)(?:are|is)(\\s+)ready\\b`, 'i');
function recount(body, marked) {
  if (!marked) return body;
  const m = READY.exec(body);
  if (!m) return body;
  const asWord = !/^\d+$/.test(m[1]);
  const n = asWord ? NUMBER_WORDS.indexOf(m[1].toLowerCase()) : parseInt(m[1], 10);
  if (n < marked) return body;
  const left = n - marked;
  let said = asWord ? NUMBER_WORDS[left] : String(left);
  if (asWord && /^[A-Z]/.test(m[1])) said = said[0].toUpperCase() + said.slice(1);
  const phrase = `${said}${m[2]}${left === 1 ? 'change' : 'changes'}${m[3]}${left === 1 ? 'is' : 'are'}${m[4]}ready, ${marked} held back`;
  return body.slice(0, m.index) + phrase + body.slice(m.index + m[0].length);
}
cmds.strip = (a) => {
  const root = ROOT_OF(a), d = DATE_OF(a);
  const run = a.run && a.run !== 'true' ? a.run : path.join(root, 'routines', 'next-action', d);
  const { holds, skipped } = readHolds(root, d);
  for (const line of skipped) L.say(`skipped: ${line}`);
  if (!holds.length) return;
  const movesFile = path.join(run, 'moves.md');
  const moves = fs.existsSync(movesFile) ? fs.readFileSync(movesFile, 'utf8').replace(/\r/g, '') : '';
  const work = L.store(path.join(root, 'work'), []);
  const out = [], held = [], kept = [];
  for (const seg of moves.split(/^(?=###? \d+\.)/m)) {
    if (!MOVE_HEADING.test(seg)) { kept.push(seg); continue; }
    const lines = seg.split('\n');
    let end = lines.findIndex((l, i) => i > 0 && TAIL.test(l));
    if (end < 0) end = lines.length;
    const block = lines.slice(0, end).join('\n'), tail = lines.slice(end).join('\n');
    const heading = lines[0].replace(/^#+\s*/, '').trim();
    const title = heading.replace(/^\d+\.\s*/, '');
    const touches = moveTouches(block) || '';
    const h = heldBy(holds, { touches, text: title });
    const n = (heading.match(/^(\d+)\./) || [])[1] || '?';
    if (!h) { kept.push(seg); continue; }
    held.push({ n, title, h, block: block.replace(/\s*$/, '\n') });
    kept.push(`HELD ${n}: ${title} (held by ${h.id})\n` + (tail ? '\n' + tail : '\n'));
    const applyTo = (block.match(/^APPLY:[ \t]*([A-Za-z0-9][A-Za-z0-9._-]*)/m) || [])[1];
    const card = applyTo && work.exists(applyTo) ? work.read(applyTo) : null;
    if (card && !card.f.TOUCHES) {
      card.f.TOUCHES = parseTouches(touches).join(', ');
      L.logLine(card, d, 'HELD', `by ${h.id}`);
      work.write(card);
    }
    out.push(`held: move ${n} "${title}" by ${h.id}`);
  }
  if (held.length) {
    fs.writeFileSync(movesFile, kept.join(''), 'utf8');
    fs.appendFileSync(path.join(run, 'held.md'), held.map(x => `held by ${x.h.id}: ${x.h.stance}, the person said "${x.h.value}"\n\n${x.block}\n`).join(''), 'utf8');
    const decisionFile = path.join(run, 'decision.md');
    const decision = fs.existsSync(decisionFile) ? fs.readFileSync(decisionFile, 'utf8').replace(/\r/g, '') : '';
    fs.writeFileSync(decisionFile, withoutHeld(decision, held), 'utf8');
  }
  for (const c of work.all()) {
    if (!/^apply-/.test(c.f.KEY || '') || !OPEN_WAITING.includes(c.f.STATUS)) continue;
    const h = heldBy(holds, { touches: c.f.TOUCHES, text: c.f.WHAT });
    if (h) out.push(`held: ${c.id} "${c.f.WHAT}" by ${h.id}`);
  }
  for (const l of out) L.say(l);
};

cmds.help = () => L.say(`mc-holds: what the person declined or postponed, read live from the notebook's claims

  list [--date D] [--json]          every hold in force: its claim, stance, steps, subject, their words, and
                                    the claim it waits on; "nothing is held" when there is none
  hold --subject <slug> --stance declined|postponed --words "<their words>"
       [--steps "<word>, <word>"]   the kinds of step it holds (a word that begins a word of the move's line);
                                    without it, every step touching <slug>
       [--until <claim>]            postponed until that claim ends (gets a valid_to, or a newer claim replaces it)
       [--to YYYY-MM-DD]            or until that day
       [--attribute A] [--date D]   files a claim named <slug>--<attribute>--<date>
  end <claim> --words "<their words>" [--date D]   a later yes: the claim gets valid_to and stays
  strip --run <folder> [--date D]   mc-decide's: held moves out of moves.md into held.md and off today's card`);

if (require.main === module) {
  const a = L.parseArgs(process.argv.slice(2));
  const cmd = a._.shift() || 'help';
  if (!cmds[cmd]) L.die(`unknown command ${cmd}; try help`);
  try { cmds[cmd](a); } catch (e) { L.die(e.message); }
}

module.exports = { SLUG, touchTokens, moveTouches, currentHolds, heldBy, describe };
