#!/usr/bin/env node
'use strict';
//
// holds.js - the steps the person declined or postponed, read from the world's claims, so a
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
// A HOLD CLAIM is a world claim (world/claims/*.md, world/README.md) with
//   stance: declined | postponed
//   steps: [interview, ...]   optional: the kinds of step it holds; without it, every step
//   until: <claim file>       optional, postponed only: it holds while that claim is current
//   valid_to: YYYY-MM-DD      optional: it holds through the day before
// A PROPOSAL names the world entities it touches (a move's TOUCHES line, a work card's TOUCHES
// field). It is held when it touches the claim's subject and, if the claim names steps, one of
// them begins a word of the proposal's own line (a move's heading, a card's WHAT). A proposal that
// touches nothing is never held.
//
// A CLAIM IS CURRENT on day D when its valid_from is empty or at most D and its valid_to is empty
// or after D, and no newer claim replaces it: one with the same subject and attribute whose
// valid_from is later than its own and at most D (the way world/README.md says a fact changes).
// An `until` claim that is not in world/claims/ keeps the hold, and `list` says so: silently
// asking again is the failure this exists to stop.
//
//   mc-holds list [--date D] [--json]
//   mc-holds hold --subject <slug> --stance declined|postponed --words "<their words>"
//                 [--steps "<word>, <word>"] [--until <claim file>] [--to YYYY-MM-DD] [--attribute A] [--date D]
//   mc-holds end <claim file> --words "<their words>" [--date D]
//   mc-holds strip --run <run folder> [--date D]     mc-decide's: takes held moves out of moves.md

const fs = require('fs');
const path = require('path');
const L = require(path.join(__dirname, 'mc-cards.js'));

const STANCES = ['declined', 'postponed'];
const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const CLAIMS = path.join('world', 'claims');

// world/ files are YAML front matter of `key: value` lines, a list as `[a, b]`, then free text.
// The same reading as notebook/core/world-facts.mjs frontMatter, which this CommonJS file cannot load.
function scalar(value) {
  const v = value.trim();
  if (/^".*"$/.test(v)) { try { return JSON.parse(v); } catch (e) { return v.slice(1, -1); } }
  if (/^'.*'$/.test(v)) return v.slice(1, -1).replace(/''/g, "'");
  return v === 'null' || v === '~' ? '' : v;
}
function frontMatter(text) {
  const m = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/.exec(String(text));
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):[ \t]*(.*)$/.exec(line);
    if (!kv) continue;
    const raw = kv[2].trim();
    fields[kv[1]] = /^\[.*\]$/.test(raw) ? raw.slice(1, -1).split(',').map(scalar).filter(Boolean) : scalar(raw);
  }
  return { fields, body: (m[2] || '').trim() };
}

const text = (v) => (Array.isArray(v) ? v.join(', ') : String(v == null ? '' : v)).trim();
const day = (v) => { const s = text(v); return L.isoDate(s) ? s : ''; };
const claimName = (s) => path.basename(String(s || '').trim()).replace(/\.md$/, '');
const sameAttribute = (a, b) => text(a).toLowerCase().replace(/[-_\s]+/g, '-') === text(b).toLowerCase().replace(/[-_\s]+/g, '-');

function readClaims(root) {
  const dir = path.join(root, CLAIMS);
  let names;
  try { names = fs.readdirSync(dir).filter(n => n.endsWith('.md') && n !== 'README.md').sort(); } catch (e) {
    if (e.code === 'ENOENT') return { claims: [], unread: [] };
    throw e;
  }
  const claims = [], unread = [];
  for (const file of names) {
    const parsed = frontMatter(L.readText(path.join(dir, file)));
    if (parsed) claims.push({ name: file.replace(/\.md$/, ''), id: `world/claims/${file}`, f: parsed.fields, body: parsed.body });
    else unread.push(`world/claims/${file}: no front matter, so whether it holds anything cannot be told`);
  }
  return { claims, unread };
}

const started = (c, date) => !day(c.f.valid_from) || day(c.f.valid_from) <= date;
const closed = (c, date) => !!day(c.f.valid_to) && day(c.f.valid_to) <= date;
function replacedBy(c, all, date) {
  const own = day(c.f.valid_from);
  return all.find(o => o !== c && text(o.f.subject) === text(c.f.subject) && sameAttribute(o.f.attribute, c.f.attribute)
    && day(o.f.valid_from) && day(o.f.valid_from) > own && day(o.f.valid_from) <= date) || null;
}
const current = (c, all, date) => started(c, date) && !closed(c, date) && !replacedBy(c, all, date);

// Every hold that is in force on `date`, { id, name, subject, stance, steps, value, until, waiting },
// and `skipped`: one line for each claim file that may be a hold but cannot be read as one.
// `waiting` says what the condition claim is: 'current', 'missing', or '' when there is none.
// A claim file that cannot be read throws: "could not tell" must never read as "nothing is held".
function readHolds(root, date) {
  const { claims: all, unread } = readClaims(root);
  const byName = new Map(all.map(c => [c.name, c]));
  const holds = [], skipped = [...unread];
  for (const c of all) {
    const stance = text(c.f.stance).toLowerCase();
    if (!STANCES.includes(stance) || !current(c, all, date)) continue;
    if (!SLUG.test(text(c.f.subject))) {
      skipped.push(`${c.id}: stance ${stance}, but its subject "${text(c.f.subject)}" is not the slug of a world entity, so it holds nothing`);
      continue;
    }
    const until = stance === 'postponed' && text(c.f.until) ? claimName(c.f.until) : '';
    let waiting = '';
    if (until) {
      const cond = byName.get(until);
      if (cond && (closed(cond, date) || replacedBy(cond, all, date))) continue;
      waiting = cond ? 'current' : 'missing';
    }
    const steps = (Array.isArray(c.f.steps) ? c.f.steps : text(c.f.steps).split(',')).map(s => text(s).toLowerCase()).filter(Boolean);
    holds.push({ id: c.id, name: c.name, subject: text(c.f.subject), stance, steps, value: text(c.f.value), until, waiting });
  }
  return { holds, skipped };
}
const currentHolds = (root, date) => readHolds(root, date).holds;

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
  return !h.until ? '' : h.waiting === 'missing' ? `until ${h.until}, which is not in world/claims (it holds until that is fixed)`
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
  if (!SLUG.test(subject)) L.die('--subject is the slug of a world entity (world/entities/<slug>.md): lower-case letters, digits and dashes');
  const stance = L.oneLine(a.stance);
  if (!STANCES.includes(stance)) L.die('--stance is declined or postponed');
  const said = words(a);
  if (!said) L.die('--words is required: what the person said, as they said it');
  const steps = a.steps && a.steps !== 'true' ? parseTouches(a.steps) : [];
  let until = '';
  if (a.until !== undefined) {
    if (stance !== 'postponed') L.die('--until is for a postponement; a step declined stays declined until you end it');
    until = claimName(a.until === 'true' ? '' : a.until);
    if (!until || !fs.existsSync(path.join(root, CLAIMS, until + '.md'))) L.die(`--until names no claim in world/claims/ (${until || 'nothing'}); write the claim it waits on first, or use --to <date>`);
  }
  const to = a.to === undefined ? '' : String(a.to);
  if (a.to !== undefined && (!L.isoDate(to) || to <= d)) L.die('--to is a day after today, YYYY-MM-DD: the hold lifts on that day');
  const attribute = L.oneLine(a.attribute || (steps.length ? `${steps[0]}-stance` : 'proposals-stance')).toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const dir = path.join(root, CLAIMS);
  fs.mkdirSync(dir, { recursive: true });
  let name = `${subject}--${attribute}--${d}`;
  for (let n = 2; fs.existsSync(path.join(dir, name + '.md')); n++) name = `${subject}--${attribute}--${d}-${n}`;
  const lines = ['---', `subject: ${subject}`, 'origin: mission control', `attribute: ${attribute}`, `value: ${yamlValue(said)}`,
    `stance: ${stance}`];
  if (steps.length) lines.push(`steps: [${steps.join(', ')}]`);
  if (until) lines.push(`until: ${until}`);
  lines.push(`valid_from: ${d}`);
  if (to) lines.push(`valid_to: ${to}`);
  lines.push('confidence: certain', `source: your words, ${d}`, '---', JSON.stringify(said), '');
  fs.writeFileSync(path.join(dir, name + '.md'), lines.join('\n'), 'utf8');
  L.say(`world/claims/${name}.md: ${stance}${steps.length ? ' ' + steps.join(', ') : ''} touching ${subject}`
    + (until ? `, until ${until} ends` : to ? `, until ${to}` : ''));
};

cmds.end = (a) => {
  const root = ROOT_OF(a), d = DATE_OF(a);
  const name = claimName(a._[0] || L.die('usage: mc-holds end <claim file> --words "<their words>"'));
  const file = path.join(root, CLAIMS, name + '.md');
  if (!fs.existsSync(file)) L.die(`no claim world/claims/${name}.md`);
  const said = words(a);
  if (!said) L.die('--words is required: what the person said, as they said it');
  const raw = L.readText(file);
  const parsed = frontMatter(raw);
  if (!parsed) L.die(`world/claims/${name}.md has no front matter to close`);
  if (text(parsed.fields.origin).toLowerCase() === 'menerio') L.die(`world/claims/${name}.md came from Menerio; fix it in the notebook`);
  if (closed({ f: parsed.fields }, d)) L.die(`world/claims/${name}.md already ended on ${day(parsed.fields.valid_to)}`);
  const head = raw.match(/^﻿?---\n[\s\S]*?\n---/)[0];
  const rest = raw.slice(head.length).replace(/^[ \t]*\n?/, '');
  const newHead = /^valid_to:.*$/m.test(head) ? head.replace(/^valid_to:.*$/m, `valid_to: ${d}`) : head.replace(/\n---$/, `\nvalid_to: ${d}\n---`);
  const body = rest.replace(/\s*$/, '');
  fs.writeFileSync(file, `${newHead}\n${body ? body + '\n' : ''}- ${d} ended: ${JSON.stringify(said)}\n`, 'utf8');
  L.say(`world/claims/${name}.md: ended on ${d}`);
};

// STRIP, run by mc-decide after the moves check. A move the person declined or postponed that is
// still in moves.md after the run was sent back once is taken out by program: the block goes to
// held.md and a HELD line stays in its place. Today's card is the run's own text, so the held
// move's title is taken off it where it stands and every other line stays as the run wrote it;
// a card that does not carry the title word for word may name the step in other words, so it is
// held back and the moves still ready are listed instead. Then one line per held proposal and
// per claim that could not be read as one, which is the log a schedule keeps (decide.log).
const MOVE_HEADING = /^###? \d+\./;
const TAIL = /^(?:FEWER|UNREAD|HOLD|HELD) |^## /;
const OPEN_WAITING = ['planned', 'dispatched', 'attempted', 'blocked'];
// decision.md with the held moves off its "For you today" section (see STRIP above).
function withoutHeld(decision, held, ready) {
  const ids = [...new Set(held.map(x => x.h.id))].join(', ');
  const section = /^## For you today[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m;
  const m = section.exec(decision);
  if (!m) return decision.replace(/\s*$/, '') + `\n\n## For you today\nHeld back: a step you declined or postponed (${ids}).\n`;
  const titled = (x) => new RegExp(escape(x.title).replace(/\s+/g, '\\s+'), 'gi');
  let card = m[1];
  if (!ready.length) card = `Nothing today: every move today is one you declined or postponed (${ids}), so the card is held back.\n\n`;
  else if (held.every(x => titled(x).test(card))) {
    for (const x of held) card = card.replace(titled(x), `(held back: you ${x.h.stance} this, ${x.h.id})`);
  } else card = `Held back: the card the run wrote lists a step you declined or postponed (${ids}), so it is not shown. The moves still ready are ${ready.join('; ')} (moves.md).\n\n`;
  return decision.slice(0, m.index) + m[0].slice(0, m[0].length - m[1].length) + card + decision.slice(m.index + m[0].length);
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
  const out = [], held = [], kept = [], ready = [];
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
    if (!h) { kept.push(seg); ready.push(`${n}. ${title}`); continue; }
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
    fs.writeFileSync(decisionFile, withoutHeld(decision, held, ready), 'utf8');
  }
  for (const c of work.all()) {
    if (!/^apply-/.test(c.f.KEY || '') || !OPEN_WAITING.includes(c.f.STATUS)) continue;
    const h = heldBy(holds, { touches: c.f.TOUCHES, text: c.f.WHAT });
    if (h) out.push(`held: ${c.id} "${c.f.WHAT}" by ${h.id}`);
  }
  for (const l of out) L.say(l);
};

cmds.help = () => L.say(`mc-holds: what the person declined or postponed, read live from world/claims/

  list [--date D] [--json]          every hold in force: its claim, stance, steps, subject, their words, and
                                    the claim it waits on; "nothing is held" when there is none
  hold --subject <slug> --stance declined|postponed --words "<their words>"
       [--steps "<word>, <word>"]   the kinds of step it holds (a word that begins a word of the move's line);
                                    without it, every step touching <slug>
       [--until <claim file>]       postponed until that claim ends (gets a valid_to, or a newer claim replaces it)
       [--to YYYY-MM-DD]            or until that day
       [--attribute A] [--date D]   writes world/claims/<slug>--<attribute>--<date>.md
  end <claim file> --words "<their words>" [--date D]   a later yes: the claim gets valid_to and stays
  strip --run <folder> [--date D]   mc-decide's: held moves out of moves.md into held.md and off today's card`);

if (require.main === module) {
  const a = L.parseArgs(process.argv.slice(2));
  const cmd = a._.shift() || 'help';
  if (!cmds[cmd]) L.die(`unknown command ${cmd}; try help`);
  try { cmds[cmd](a); } catch (e) { L.die(e.message); }
}

module.exports = { SLUG, touchTokens, moveTouches, currentHolds, heldBy, describe };
