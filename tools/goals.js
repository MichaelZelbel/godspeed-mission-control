#!/usr/bin/env node
'use strict';
//
// goals.js - what you want, one card each, and the choice of which goals get attention today.
// Type it as `hub-goals`.
//
// WHY THIS EXISTS. A hub without this has deadlines, promises and a to-do pile, and nothing
// that says what any of it is FOR. The first thing that goes wrong is that a means gets carried
// as if it were the end: "post every day" sits in the system as a goal, and the thing it was
// supposed to buy you is written down nowhere. The second is that the loudest queue wins every
// morning, because nothing else is arguing for the quiet parts of your life.
//
// WHAT A CARD IS. One file under `goals/`, `KEY: value` lines then a `## Log` that is only ever
// added to. Four kinds, and keeping them apart is most of the value here:
//   outcome     a state of the world you want. "Healthy and strong in my 90s."
//   strategy    a way meant to produce an outcome. "Train three times a week."
//   project     bounded work under a strategy or an outcome. "Fix the knee."
//   commitment  a protected obligation with its own slot: a client, a weekly call.
// Five statuses: provisional (an idea you floated - never worked on, at most one clarifying
// question in seven days), adopted, paused, achieved, retired. SERVES links a card upward. A
// change to a card writes a REVIEW line on every card that serves it, and tells `work` to mark
// the work under it stale, so a change to a goal actually reaches the plans beneath it.
//
// THE CHOICE OF ATTENTION IS EXPLICIT AND HAS NO SCORE IN IT. `attention` sorts into bands and
// puts the reason on every row: protected, a deadline within seven days, a diagnosis that was
// refuted, nothing looked at it for seven days, a deadline within thirty, your own word for
// importance. Never a number invented to stand for how much something matters, because the
// moment a number exists the thing that is easy to count wins. At most three outcomes are
// active in a day and the rest are quiet WITH THE REASON WRITTEN DOWN. Neglect is counted from
// the last time a goal was looked at, not from whether anything about it was measurable.
//
// The folders it owns:
//   goals/<ID>.md                    one card each
//   goals/diagnoses/<ID>-<date>.md   what limits one goal, on evidence (template from `diagnose`)
//   goals/README.md                  the format, for you
// It asks `work` (sweep) and `forecast` (flag) when a goal changes, and says so in its output if
// either of them is not installed. It never does their job itself.

const fs = require('fs');
const path = require('path');
const L = require(path.join(__dirname, 'hub-cards.js'));

const HUB = L.hubRoot(__filename);
const DIR = path.join(HUB, 'goals');
const DIAG = path.join(DIR, 'diagnoses');

const KINDS = ['outcome', 'strategy', 'project', 'commitment'];
const STATUSES = ['provisional', 'adopted', 'paused', 'achieved', 'retired'];
const ACTIVE = ['adopted'];
const IMPORTANCE = ['core', 'high', 'normal'];
const ENERGY = ['low', 'medium', 'high'];
const ORDER = ['ID', 'KIND', 'STATUS', 'AREA', 'TITLE', 'OWN WORDS', 'MEASURE', 'DEADLINE', 'SERVES', 'DEPENDS ON',
  'PROTECTED', 'OWNER', 'IMPORTANCE', 'ENERGY', 'RESOURCES', 'CADENCE', 'REVIEW', 'SOURCE', 'FILED', 'NOTE'];
const S = L.store(DIR, ORDER);
const { die, say, oneLine, flag, today, q } = L;
const MACHINE = L.machineWords(HUB);

const cmds = {};

function list(v) { return oneLine(v).split(',').map(s => s.trim()).filter(Boolean); }
function last(c, events) {
  const evs = Array.isArray(events) ? events : [events];
  for (let i = c.log.length - 1; i >= 0; i--) if (evs.includes(c.log[i].event)) return c.log[i];
  return null;
}
function daysSince(c, events, d) { const l = last(c, events); return l ? L.daysBetween(l.date, d) : null; }
function isOpen(c) { return ACTIVE.includes(c.f.STATUS); }
function children(all, id) { return all.filter(c => list(c.f.SERVES).includes(id) || list(c.f['DEPENDS ON']).includes(id)); }

// ---------------------------------------------------------------------------
// file
// ---------------------------------------------------------------------------
cmds.file = (a) => {
  const kind = String(a.kind || '').toLowerCase();
  if (!KINDS.includes(kind)) die(`--kind must be one of: ${KINDS.join(', ')}`);
  const status = String(a.status || 'provisional').toLowerCase();
  if (!STATUSES.includes(status)) die(`--status must be one of: ${STATUSES.join(', ')}`);
  const title = oneLine(a.title);
  if (!title) die('--title is required, in your own words where possible');
  if (!oneLine(a.source)) die('--source is required: where this goal was said (a date and a channel), so it is never a goal the hub invented');
  const d = a.date || today();
  if (a.deadline && !L.isoDate(a.deadline) && a.deadline !== 'unresolved') die('--deadline must be YYYY-MM-DD or the word unresolved');
  const importance = String(a.importance || 'normal').toLowerCase();
  if (!IMPORTANCE.includes(importance)) die(`--importance must be one of: ${IMPORTANCE.join(', ')} (your word for it, never a number)`);
  const energy = a.energy ? String(a.energy).toLowerCase() : '';
  if (energy && !ENERGY.includes(energy)) die(`--energy must be one of: ${ENERGY.join(', ')}`);
  const id = a.id ? L.safeId(a.id) : title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
  if (S.exists(id)) die(`${id} already exists; use change to alter it (a goal keeps its history)`);
  for (const up of list(a.serves)) if (!S.exists(up)) die(`SERVES ${up}: no such goal; file the outcome first`);
  for (const up of list(a['depends-on'])) if (!S.exists(up)) die(`DEPENDS ON ${up}: no such goal`);
  const f = {
    ID: id, KIND: kind, STATUS: status, AREA: oneLine(a.area || 'other'), TITLE: title,
    'OWN WORDS': oneLine(a['own-words']), MEASURE: oneLine(a.measure), DEADLINE: oneLine(a.deadline),
    SERVES: list(a.serves).join(', '), 'DEPENDS ON': list(a['depends-on']).join(', '),
    PROTECTED: kind === 'commitment' ? (a.protected === 'no' ? 'no' : 'yes') : (a.protected === 'yes' ? 'yes' : 'no'),
    OWNER: oneLine(a.owner || 'person'), IMPORTANCE: importance, ENERGY: energy, RESOURCES: oneLine(a.resources),
    CADENCE: oneLine(a.cadence), REVIEW: oneLine(a.review), SOURCE: oneLine(a.source), FILED: d, NOTE: oneLine(a.note),
  };
  const c = { id, f, log: [] };
  L.logLine(c, d, 'FILED', `${status} ${kind}, source: ${f.SOURCE}`);
  if (status === 'adopted') L.logLine(c, d, 'ADOPTED', `at filing, source: ${f.SOURCE}`);
  S.write(c);
  say(`${id}: ${status} ${kind} filed`);
  if (status === 'provisional') say(`  provisional: never acted on as a goal until adopted; at most one clarifying question in seven days`);
};

// ---------------------------------------------------------------------------
// change: every change carries its reason, and propagates
// ---------------------------------------------------------------------------
function propagate(c, d, what, why, opts) {
  const all = S.all();
  const touched = [];
  for (const k of children(all, c.id)) {
    L.logLine(k, d, 'REVIEW', `${c.id} changed ${what}: ${why}`);
    S.write(k);
    touched.push(k.id);
  }
  const closing = ['retired', 'paused', 'achieved'].includes(c.f.STATUS);
  const reason = `${c.id} changed ${what}: ${why}`;
  // The two programs next door. Neither is required: a hub with only this one still keeps its
  // goals honestly, and the line below says plainly which half of the propagation happened.
  const w = L.runNode(__filename, HUB, 'work', ['sweep', '--goal', c.id, closing ? '--cancel' : '--stale', '--reason', reason, '--date', d]);
  const fc = L.runNode(__filename, HUB, 'forecast', ['flag', '--goal', c.id, '--reason', reason, '--date', d]);
  const told = (r, name, missingLine) => r.ok ? oneLine(r.out)
    : r.missing ? `${name} is not installed on this computer, so ${missingLine}`
    : `${name} could not be asked: ` + oneLine(r.err);
  return {
    touched,
    work: told(w, 'hub-work', 'nothing under this goal was marked stale; re-plan it by hand'),
    forecasts: told(fc, 'hub-forecast', 'no forecast under this goal was flagged for review'),
  };
}
cmds.change = (a) => {
  const c = S.read(a._[0] || die('usage: hub-goals change <id> --set FIELD=value [--set ...] --why "..."')) || die('no such goal');
  const why = oneLine(a.why);
  if (!why) die('--why is required: a goal changes for a reason, and the reason is kept');
  const sets = [].concat(a.set === undefined ? [] : a.set);
  // parseArgs keeps only the last --set; accept several as FIELD=value;FIELD=value too.
  const pairs = sets.join(';').split(';').map(s => s.trim()).filter(Boolean);
  if (!pairs.length) die('--set FIELD=value is required (several: --set "A=x;B=y")');
  const d = a.date || today();
  const changed = [];
  for (const p of pairs) {
    const m = p.match(/^([A-Z][A-Z ]*)=(.*)$/);
    if (!m) die(`--set "${p}" is not FIELD=value`);
    const k = m[1].trim(), v = oneLine(m[2]);
    if (k === 'ID' || k === 'FILED') die(`${k} never changes`);
    if (k === 'STATUS' && !STATUSES.includes(v)) die(`STATUS must be one of: ${STATUSES.join(', ')}`);
    if (k === 'KIND' && !KINDS.includes(v)) die(`KIND must be one of: ${KINDS.join(', ')}`);
    if (k === 'IMPORTANCE' && !IMPORTANCE.includes(v)) die(`IMPORTANCE must be one of: ${IMPORTANCE.join(', ')}`);
    if (k === 'DEADLINE' && v && !L.isoDate(v) && v !== 'unresolved') die('DEADLINE must be YYYY-MM-DD or unresolved');
    if (k === 'SERVES') for (const up of list(v)) if (!S.exists(up)) die(`SERVES ${up}: no such goal`);
    const old = c.f[k] || '';
    if (old === v) continue;
    c.f[k] = v;
    L.logLine(c, d, 'CHANGED', `${k} ${q(old)} -> ${q(v)} because ${why}`);
    if (k === 'STATUS') L.logLine(c, d, v.toUpperCase(), why);
    changed.push(k);
  }
  if (!changed.length) { say(`${c.id}: nothing changed`); return; }
  S.write(c);
  const r = propagate(c, d, changed.join(', '), why);
  say(`${c.id}: changed ${changed.join(', ')} (${why})`);
  if (r.touched.length) say(`  review line written on: ${r.touched.join(', ')}`);
  say(`  work: ${r.work}`);
  say(`  forecasts: ${r.forecasts}`);
};
for (const [name, status] of [['adopt', 'adopted'], ['retire', 'retired'], ['pause', 'paused'], ['achieve', 'achieved']]) {
  cmds[name] = (a) => {
    if (!a._[0]) die(`usage: hub-goals ${name} <id> --why "..."`);
    cmds.change({ _: [a._[0]], set: `STATUS=${status}`, why: a.why, date: a.date });
  };
}

cmds.progress = (a) => {
  const c = S.read(a._[0] || die('usage: hub-goals progress <id> --evidence "..."')) || die('no such goal');
  const ev = oneLine(a.evidence);
  if (!ev) die('--evidence is required: what exists in the world now that did not before, and where it was read');
  const d = a.date || today();
  L.logLine(c, d, 'PROGRESS', ev);
  S.write(c);
  say(`${c.id}: progress recorded`);
};
cmds.question = (a) => {
  const c = S.read(a._[0] || die('usage: hub-goals question <id> --text "..."')) || die('no such goal');
  const t = oneLine(a.text);
  if (!t) die('--text is required');
  const d = a.date || today();
  const open = last(c, ['QUESTION', 'ANSWER']);
  if (open && open.event === 'QUESTION' && !flag(a, 'force')) die(`${c.id} already has an open question from ${open.date}; record the answer first (hub-goals answer)`);
  const recent = c.log.filter(l => l.event === 'QUESTION' && L.daysBetween(l.date, d) < 7);
  if (recent.length && !flag(a, 'force')) die(`${c.id} was asked on ${recent[0].date}; one question in seven days, so you are not managed by your own goal list`);
  L.logLine(c, d, 'QUESTION', t);
  S.write(c);
  say(`${c.id}: question recorded (${t.slice(0, 80)})`);
};
cmds.answer = (a) => {
  const c = S.read(a._[0] || die('usage: hub-goals answer <id> --text "<your words>"')) || die('no such goal');
  const t = oneLine(a.text);
  if (!t) die('--text is required: your words, as you said them');
  const d = a.date || today();
  L.logLine(c, d, 'ANSWER', q(t));
  S.write(c);
  say(`${c.id}: answer recorded`);
};

// ---------------------------------------------------------------------------
// diagnose: a constraint diagnosis is a file with the sections that keep it honest
// ---------------------------------------------------------------------------
const DIAG_SECTIONS = ['## Situation and history', '## Competing explanations', '## Verified', '## Inferred', '## Open questions',
  '## Constraint claimed', '## Disconfirmed if', '## Method', '## Next test or action'];
function diagTemplate(id, d) {
  return `GOAL: ${id}
DATE: ${d}
STATUS: draft
METHOD: undecided

## Situation and history
(what is true now and what happened, with where each fact was read)

## Competing explanations
(at least two; say what evidence would separate them)

## Verified
(read live or in a file, one per line, with its source)

## Inferred
(what follows from the verified lines, marked as inference)

## Open questions
(what nobody knows yet, and how it could be found out)

## Constraint claimed
(the one limiting factor, if the evidence supports one; otherwise "none yet, run the experiment below")

## Disconfirmed if
(the observation that would show the claimed constraint is wrong; required)

## Method
(toc: a single supported constraint, apply the five focusing steps | experiment: cause uncertain, test cheaply | eks: a market question of focus, strengths and customer need | none)

## Next test or action
(the smallest step that either moves the goal or settles the question)
`;
}
cmds.diagnose = (a) => {
  const c = S.read(a._[0] || die('usage: hub-goals diagnose <id> [--refute <file> --evidence "..."]')) || die('no such goal');
  const d = a.date || today();
  if (a.refute) {
    const p = path.isAbsolute(a.refute) ? a.refute : path.join(HUB, a.refute);
    if (!fs.existsSync(p)) die(`no diagnosis at ${a.refute}`);
    const ev = oneLine(a.evidence);
    if (!ev) die('--evidence is required: the observation that disconfirmed it');
    let text = L.readText(p);
    text = text.replace(/^STATUS: .*$/m, 'STATUS: refuted ' + d);
    text += `\n## Refuted\n- ${d} ${ev}\n`;
    fs.writeFileSync(p, text, 'utf8');
    L.logLine(c, d, 'REFUTED', `${path.relative(HUB, p).replace(/\\/g, '/')}: ${ev}`);
    S.write(c);
    say(`${c.id}: diagnosis refuted; the next attention plan asks for a new one`);
    return;
  }
  fs.mkdirSync(DIAG, { recursive: true });
  const p = path.join(DIAG, `${c.id}-${d}.md`);
  if (fs.existsSync(p)) { say(path.relative(HUB, p).replace(/\\/g, '/')); return; }
  fs.writeFileSync(p, diagTemplate(c.id, d), 'utf8');
  L.logLine(c, d, 'DIAGNOSIS', path.relative(HUB, p).replace(/\\/g, '/'));
  S.write(c);
  say(path.relative(HUB, p).replace(/\\/g, '/'));
};
function diagnosisState(c) {
  const dg = last(c, ['DIAGNOSIS', 'REFUTED']);
  if (!dg) return 'none';
  if (dg.event === 'REFUTED') return 'refuted';
  const p = path.join(HUB, dg.rest);
  const text = L.readText(p);
  if (!text) return 'missing file';
  if (/^STATUS: refuted/m.test(text)) return 'refuted';
  const claimed = (text.split('## Constraint claimed')[1] || '').split('\n## ')[0].replace(/\(.*?\)/gs, '').trim();
  const disc = (text.split('## Disconfirmed if')[1] || '').split('\n## ')[0].replace(/\(.*?\)/gs, '').trim();
  if (claimed && !disc) return 'claims a constraint without saying what would disprove it';
  if (/^STATUS: draft/m.test(text)) return 'draft';
  return 'current';
}

// ---------------------------------------------------------------------------
// attention: which goals deserve attention today, and why. Weightless. Reads, never writes,
// unless --record.
// ---------------------------------------------------------------------------
function plan(d, seats) {
  const all = S.all();
  const rows = [];
  const openQ = (c) => { const l = last(c, ['QUESTION', 'ANSWER']); return l && l.event === 'QUESTION' ? l : null; };
  for (const c of all) {
    const r = { id: c.id, kind: c.f.KIND, status: c.f.STATUS, area: c.f.AREA, title: c.f.TITLE, reasons: [], band: 'quiet', importance: c.f.IMPORTANCE || 'normal' };
    // An outcome is as urgent as the nearest deadline in the tree under it: a strategy due
    // this week is its outcome's business.
    let left = L.isoDate(c.f.DEADLINE) ? L.daysBetween(d, c.f.DEADLINE) : null;
    if (c.f.KIND === 'outcome') {
      const seen = new Set([c.id]);
      const walk = (id) => { for (const k of children(all, id)) { if (seen.has(k.id) || !isOpen(k)) continue; seen.add(k.id); const kl = L.isoDate(k.f.DEADLINE) ? L.daysBetween(d, k.f.DEADLINE) : null; if (kl !== null && kl >= 0 && (left === null || left < 0 || kl < left)) { left = kl; r.nearest = k.id; } walk(k.id); } };
      walk(c.id);
    }
    r.daysLeft = left;
    r.sinceAttention = daysSince(c, ['ATTENTION', 'PROGRESS'], d);
    r.sinceProgress = daysSince(c, ['PROGRESS'], d);
    r.diagnosis = diagnosisState(c);
    r.question = openQ(c);
    if (c.f.STATUS === 'provisional') {
      r.band = 'provisional';
      const qd = daysSince(c, ['QUESTION'], d);
      r.mayAsk = !r.question && (qd === null || qd >= 7);
      const ans = last(c, ['ANSWER']);
      r.reasons.push('provisional: never acted on as a goal' + (r.question ? `; question open since ${r.question.date}` : r.mayAsk ? '; one clarifying question may be asked' : `; asked ${qd} days ago, wait`) + (ans ? `; last answer ${ans.date}` : ''));
      rows.push(r);
      continue;
    }
    if (!isOpen(c)) { r.band = c.f.STATUS; r.reasons.push(c.f.STATUS); rows.push(r); continue; }
    if (c.f.PROTECTED === 'yes') r.reasons.push('protected: keeps its slot whatever else is active');
    if (left !== null && left < 0) r.reasons.push(`deadline passed ${-left} day(s) ago: re-set or retire`);
    else if (left !== null && left <= 7) r.reasons.push(`deadline in ${left} day(s)` + (r.nearest ? ` (${r.nearest})` : ''));
    else if (left !== null && left <= 30) r.reasons.push(`deadline in ${left} days` + (r.nearest ? ` (${r.nearest})` : ''));
    if (r.diagnosis === 'refuted') r.reasons.push('its constraint diagnosis was refuted: diagnose again before acting');
    if (r.diagnosis === 'claims a constraint without saying what would disprove it') r.reasons.push('diagnosis claims a constraint with no disconfirming condition');
    if (r.sinceAttention === null) r.reasons.push('never looked at since filing');
    else if (r.sinceAttention >= 7) r.reasons.push(`not looked at for ${r.sinceAttention} days`);
    if (r.sinceProgress === null || r.sinceProgress >= 14) r.reasons.push(r.sinceProgress === null ? 'no progress recorded yet' : `no progress in ${r.sinceProgress} days`);
    if (r.question && L.daysBetween(r.question.date, d) >= 14) r.reasons.push(`question unanswered for ${L.daysBetween(r.question.date, d)} days: reassess relevance or timing, silence is not a yes`);
    if (!c.f.MEASURE) r.reasons.push('no measure named; counted by attention, not by numbers');
    r.rank = [
      c.f.PROTECTED === 'yes' ? 0 : 1,
      (left !== null && left >= 0 && left <= 7) ? 0 : 1,
      r.diagnosis === 'refuted' ? 0 : 1,
      (r.sinceAttention === null || r.sinceAttention >= 7) ? 0 : 1,
      (left !== null && left >= 0 && left <= 30) ? 0 : 1,
      IMPORTANCE.indexOf(r.importance) === -1 ? 2 : IMPORTANCE.indexOf(r.importance),
      -(r.sinceAttention === null ? 999 : r.sinceAttention),
    ];
    rows.push(r);
  }
  // A strategy or project rides with the outcome it serves. One whose outcome is provisional or
  // missing stands on its own feet in the ranking (an adopted means to an unadopted end is still
  // work you adopted), and the plan says so.
  const byIdEarly = Object.fromEntries(rows.map(r => [r.id, r]));
  const rootOf = (id) => { let root = id; for (let i = 0; i < 6; i++) { const c = S.read(root); const up = c ? list(c.f.SERVES)[0] : ''; if (!up) return root; root = up; } return root; };
  for (const r of rows) if (['strategy', 'project'].includes(r.kind)) { r.root = rootOf(r.id); r.standsAlone = !(byIdEarly[r.root] && byIdEarly[r.root].kind === 'outcome' && byIdEarly[r.root].status === 'adopted'); if (r.standsAlone && r.rank) r.reasons.unshift(r.root === r.id ? 'serves no outcome on the register' : `serves ${r.root}, which is ${byIdEarly[r.root] ? byIdEarly[r.root].status : 'not on the register'}: stands on its own in the ranking`); }
  const top = rows.filter(r => r.rank && (r.kind === 'outcome' || r.kind === 'commitment' || r.standsAlone));
  top.sort((x, y) => { for (let i = 0; i < x.rank.length; i++) if (x.rank[i] !== y.rank[i]) return x.rank[i] - y.rank[i]; return x.id < y.id ? -1 : 1; });
  const protectedRows = top.filter(r => r.kind === 'commitment');
  const outcomes = top.filter(r => r.kind !== 'commitment');
  const active = outcomes.slice(0, seats);
  for (const r of protectedRows) r.band = 'protected';
  for (const r of active) r.band = 'active';
  for (const r of outcomes.slice(seats)) { r.band = 'quiet'; r.reasons.unshift(`quiet today: ${seats} outcomes already active (${active.map(x => x.id).join(', ')})`); }
  // Strategies and projects ride with the outcome they serve.
  const byId = Object.fromEntries(rows.map(r => [r.id, r]));
  const under = {};
  for (const c of all) {
    if (!['strategy', 'project'].includes(c.f.KIND) || !isOpen(c) || byId[c.id].standsAlone) continue;
    const root = byId[c.id].root;
    (under[root] = under[root] || []).push(byId[c.id]);
    byId[c.id].band = byId[root] && byId[root].band === 'active' ? 'active (serves ' + root + ')' : 'with ' + root;
  }
  const energy = active.map(r => (S.read(r.id) || { f: {} }).f.ENERGY).filter(e => e === 'high');
  const notes = [];
  if (energy.length >= 2) notes.push(`${energy.length} active outcomes both ask for high energy today; expect one to move and say which`);
  const asks = rows.filter(r => r.band === 'provisional' && r.mayAsk).sort((x, y) => x.id < y.id ? -1 : 1);
  const ask = asks.length ? asks[0] : null;
  return { date: d, seats, protected: protectedRows, active, quiet: outcomes.slice(seats), under, provisional: rows.filter(r => r.band === 'provisional'), ask, closed: rows.filter(r => ['paused', 'retired', 'achieved'].includes(r.band)), notes };
}
cmds.attention = (a) => {
  const d = a.date || today();
  const seats = Math.max(1, Math.min(5, parseInt(a.active || '3', 10) || 3));
  const p = plan(d, seats);
  if (flag(a, 'record')) {
    for (const r of p.active.concat(p.protected)) {
      const c = S.read(r.id);
      if (!c) continue;
      L.logLine(c, d, 'ATTENTION', oneLine(a.why || r.reasons.join('; ') || 'active today'));
      S.write(c);
    }
  }
  if (flag(a, 'json')) { say(JSON.stringify(p, null, 2)); return; }
  say(`Attention for ${d} (at most ${seats} outcomes active; every row carries its reason)`);
  const line = (r) => `  ${r.id.padEnd(34)} ${r.kind.padEnd(11)} ${r.reasons.join('; ') || 'nothing pressing'}`;
  if (p.protected.length) { say('protected:'); p.protected.forEach(r => say(line(r))); }
  say('active:');
  if (!p.active.length) say('  no adopted outcome on the register');
  for (const r of p.active) {
    say(line(r));
    for (const s of (p.under[r.id] || [])) say(`    under it: ${s.id} (${s.kind})${s.reasons.length ? ': ' + s.reasons.join('; ') : ''}`);
  }
  if (p.quiet.length) { say('quiet today:'); p.quiet.forEach(r => say(line(r))); }
  if (p.provisional.length) { say('provisional (never acted on):'); p.provisional.forEach(r => say(line(r))); }
  if (p.ask) say(`one question today may go to: ${p.ask.id}`);
  else if (p.provisional.length) say('no question today: every provisional idea was asked within seven days or has an answer pending');
  for (const n of p.notes) say('note: ' + n);
  if (flag(a, 'record')) say('recorded ATTENTION on the active and protected cards');
};

// ---------------------------------------------------------------------------
// list / show / tree / check
// ---------------------------------------------------------------------------
cmds.list = (a) => {
  const all = S.all();
  const rows = flag(a, 'all') ? all : all.filter(c => isOpen(c) || c.f.STATUS === 'provisional');
  const kind = a.kind ? String(a.kind).toLowerCase() : '';
  const shown = rows.filter(c => !kind || c.f.KIND === kind);
  if (flag(a, 'json')) { say(JSON.stringify(shown.map(c => Object.assign({ id: c.id, log: c.log }, c.f)), null, 2)); return; }
  if (!shown.length) { say('No goals on the register yet. `hub-goals file` adds one; provisional is the default status.'); return; }
  for (const c of shown) {
    say(`${(c.f.STATUS || '?').padEnd(11)} ${c.f.KIND.padEnd(11)} ${c.id.padEnd(34)} ${c.f.TITLE}` +
      (c.f.DEADLINE ? `  (by ${c.f.DEADLINE})` : '') + (c.f.SERVES ? `  -> ${c.f.SERVES}` : ''));
  }
};
cmds.show = (a) => {
  const c = S.read(a._[0] || die('which goal?')) || die('no such goal');
  say(S.render(c).trimEnd());
};
cmds.tree = () => {
  const all = S.all();
  const kids = (id, depth) => {
    for (const c of children(all, id)) {
      say(`${'  '.repeat(depth)}${c.id} [${c.f.KIND}, ${c.f.STATUS}] ${c.f.TITLE}`);
      kids(c.id, depth + 1);
    }
  };
  for (const c of all.filter(c => !c.f.SERVES && !c.f['DEPENDS ON'])) {
    say(`${c.id} [${c.f.KIND}, ${c.f.STATUS}] ${c.f.TITLE}`);
    kids(c.id, 1);
  }
};
cmds.check = () => {
  const all = S.all();
  const problems = [];
  const notes = [];
  const ids = new Set(all.map(c => c.id));
  for (const c of all) {
    if (c.id !== c.f.ID) problems.push(`${c.id}: ID field says ${c.f.ID}`);
    if (!KINDS.includes(c.f.KIND)) problems.push(`${c.id}: KIND ${c.f.KIND}`);
    if (!STATUSES.includes(c.f.STATUS)) problems.push(`${c.id}: STATUS ${c.f.STATUS}`);
    if (!oneLine(c.f.SOURCE)) problems.push(`${c.id}: no SOURCE; a goal that cannot be traced back to something you said is not your goal`);
    if (c.f.DEADLINE && !L.isoDate(c.f.DEADLINE) && c.f.DEADLINE !== 'unresolved') problems.push(`${c.id}: DEADLINE ${c.f.DEADLINE}`);
    for (const up of list(c.f.SERVES).concat(list(c.f['DEPENDS ON']))) {
      if (!ids.has(up)) problems.push(`${c.id}: serves ${up}, which is not on the register`);
      else { const u = S.read(up); if (u && c.f.STATUS === 'adopted' && u.f.STATUS === 'provisional') notes.push(`${c.id}: adopted, serves provisional ${up}; the means is firmer than the end, which is allowed and worth a question`); }
    }
    if (c.f.STATUS === 'adopted' && !last(c, ['ADOPTED'])) problems.push(`${c.id}: adopted with no ADOPTED line (who adopted it, when?)`);
    for (const l of c.log) if (l.event === 'CHANGED' && !/ because /.test(l.rest)) problems.push(`${c.id}: a CHANGED line without a reason`);
    const dg = diagnosisState(c);
    if (dg === 'missing file') problems.push(`${c.id}: DIAGNOSIS line names a file that is gone`);
    if (dg === 'claims a constraint without saying what would disprove it') problems.push(`${c.id}: diagnosis ${dg}`);
    for (const k of ['TITLE', 'MEASURE', 'OWN WORDS']) for (const [re, what] of MACHINE) if (c.f[k] && re.test(c.f[k])) problems.push(`${c.id}: ${k} carries ${what}`);
  }
  for (const n of notes) say('note ' + n);
  if (!problems.length) { say(`goals check: ${all.length} card(s), no problems`); return; }
  for (const p of problems) say('PROBLEM ' + p);
  process.exit(1);
};
cmds.help = () => say(`hub-goals: the register of what you want, and the choice of attention today

  file --kind outcome|strategy|project|commitment --title "..." --source "<when and where you said it>"
       [--status provisional|adopted] [--area health|money|relationships|work|hub|other] [--measure "..."]
       [--deadline YYYY-MM-DD|unresolved] [--serves <id,id>] [--depends-on <id>] [--importance core|high|normal]
       [--energy low|medium|high] [--resources "..."] [--own-words "..."] [--review YYYY-MM-DD] [--id <id>]
  change <id> --set "FIELD=value[;FIELD=value]" --why "..."     keeps the old value in the log, writes a REVIEW
                                                                 line on every goal that serves it, marks the
                                                                 work under it stale (or cancelled on retire/pause/
                                                                 achieve) and flags the forecasts that depend on it
  adopt|retire|pause|achieve <id> --why "..."
  progress <id> --evidence "..."          what exists now that did not before, and where it was read
  question <id> --text "..."              one clarifying question in seven days per goal, never a second while one is open
  answer <id> --text "<your words>"
  diagnose <id>                           writes goals/diagnoses/<id>-<date>.md with the sections a diagnosis needs
  diagnose <id> --refute <file> --evidence "..."   the diagnosis was wrong; the next plan asks for a new one
  attention [--date D] [--active 3] [--json] [--record]   which goals get attention today and why (weightless bands)
  list [--all] [--kind K] [--json] | show <id> | tree | check`);

const a = L.parseArgs(process.argv.slice(2));
L.alias(a, 'his-words', 'own-words');
const cmd = a._.shift() || 'help';
if (!cmds[cmd]) die(`unknown command ${cmd}; try help`);
cmds[cmd](a);
