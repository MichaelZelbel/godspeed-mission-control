#!/usr/bin/env node
'use strict';
//
// goals.js - what you want, one card each, and the choice of which goals get attention today.
// Type it as `mc-goals`.
//
// WHY THIS EXISTS. A mission control without this has deadlines, promises and a to-do pile, and nothing
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
// refuted, a playbook that is missing, refuted or past its review date, nothing looked at it for
// seven days, a deadline within thirty, your own word for importance. Never a number invented
// to stand for how much something matters, because the moment a number exists the thing that
// is easy to count wins. At most three outcomes are active in a day and the rest are quiet WITH
// THE REASON WRITTEN DOWN. Neglect is counted from the last time a goal was looked at, not from
// whether anything about it was measurable.
//
// An outcome with nothing in flight (no move of it live or waiting for its seven-day verdict on
// the goal's weekly number, see "the weekly number" below) ranks ahead of one whose moves are
// still out: a goal waiting on its numbers can rest a day, because a verdict is coming.
//
// The folders it owns:
//   goals/<ID>.md                    one card each
//   goals/diagnoses/<ID>-<date>.md   what limits one goal, on evidence (template from `diagnose`)
//   goals/playbooks/<ID>.md          how this goal is won, researched from people who won it (template
//                                    from `playbook`); an outcome without one ranks ahead of one with
//   goals/README.md                  the format, for you
// It asks `work` (sweep) and `forecast` (flag) when a goal changes, and says so in its output if
// either of them is not installed. It never does their job itself.

const fs = require('fs');
const path = require('path');
const L = require(path.join(__dirname, 'mc-cards.js'));

// blocks: the research files hold one block per person, case, claim or opening: a KEY: line
// opens it, KEY: value lines fill it, a blank line closes it. Windows line endings are taken
// out first, because these files are edited on Windows too and a \r once hid every person.
function blocks(text, key) {
  const out = [];
  let cur = null;
  for (const raw of String(text || '').replace(/\r/g, '').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim()) { cur = null; continue; }
    const m = line.match(/^([A-Z][A-Z ]*[A-Z]):\s?(.*)$/);
    if (m && m[1] === key) { cur = { [key]: m[2].trim() }; out.push(cur); continue; }
    if (cur && m) cur[m[1]] = m[2].trim();
  }
  return out;
}

// THE ONE THING THAT LIMITS A GOAL NOW, as its research brief names it (2026-10-13). One reading
// for every program that asks: check-research (a current brief must name it), check-moves (each
// move aims at it) and Mission Control's trial check (a copy of this rule, tested on the same
// cases in limit-cases.json). Three readings that disagreed meant a LIMIT under a later section
// passed the research check and quietly switched the aim check off.
//   - Windows line endings are taken out first.
//   - The section starts at the first line that, with trailing spaces removed, is exactly
//     "## The limit now", and ends at the next line starting with "## ". Only that first section counts.
//   - The limit is the first line inside it that starts with "LIMIT:" (at the very start of the line),
//     its text after "LIMIT:" with spaces trimmed at both ends.
//   - No such section, no such line, or an empty value: there is no limit (null).
function limitOf(briefText) {
  let inside = false;
  for (const line of String(briefText || '').replace(/\r/g, '').split('\n')) {
    if (line.startsWith('## ')) {
      if (inside) return null;
      inside = line.trimEnd() === '## The limit now';
      continue;
    }
    if (inside && line.startsWith('LIMIT:')) return line.slice('LIMIT:'.length).trim() || null;
  }
  return null;
}

// A standing permission: the person's own words, once, for one kind of step (2026-10-12). It is
// what lets a prepared step go out at a set time unless stopped, instead of waiting for a yes
// that, measured, did not come (no goal move approved between 2026-09-30 and 2026-10-11). It is
// a line on the goal card, written only by `mc-goals allow`, never inferred by a program:
//   MAY: <kind> | <what, in plain words> | <n> per week | notice|alone | "<their words>" <date>
// notice: the step goes out at its set time unless the person stops it. alone: it goes out when
// ready and is reported after; only for steps that touch the person's own pages, files and
// accounts and reach nobody else. A card may carry several, one per kind.
const MAY_RE = /^MAY: ([a-z0-9-]+) \| (.+?) \| (\d+) per week \| (notice|alone) \| "(.*)" (\d{4}-\d{2}-\d{2})$/;
function parseMay(line) {
  const m = String(line || '').replace(/\r/g, '').match(MAY_RE);
  return m ? { kind: m[1], what: m[2], perWeek: parseInt(m[3], 10), mode: m[4], words: m[5], date: m[6] } : null;
}
const formatMay = (m) => `MAY: ${m.kind} | ${m.what} | ${m.perWeek} per week | ${m.mode} | "${m.words}" ${m.date}`;
// Every MAY line in a card's text, in the order written.
function mayIn(text) { return String(text || '').replace(/\r/g, '').split('\n').map(parseMay).filter(Boolean); }
// THE STANDING PERMISSIONS A GOAL'S STEPS GO OUT UNDER (2026-10-13, final review I6). A goal's own
// MAY lines; a goal with none (a strategy or a project) uses those of the first outcome on its
// SERVES line that has any, one level up, the way it uses that outcome's research. Without this a
// strategy's step of a kind its outcome allows was refused by the moves check and sent to the
// ship list, to wait for a yes that does not come. One reading for check-moves and work.js.
// Returns null when the goal has no card; otherwise { holder, lines }: holder is the goal whose
// card carries the lines (its weekly limits are counted there), null when no card does.
const SAFE_GOAL = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
function standingOf(root, goal) {
  const card = (id) => {
    if (!SAFE_GOAL.test(String(id || ''))) return null;
    try { return fs.readFileSync(path.join(root, 'goals', `${id}.md`), 'utf8').replace(/\r/g, ''); } catch (e) { return null; }
  };
  const own = card(goal);
  if (own === null) return null;
  const lines = mayIn(own);
  if (lines.length) return { holder: goal, lines };
  const serves = (own.match(/^SERVES:[ \t]*(.*)$/m) || ['', ''])[1].split(',').map(s => s.trim()).filter(Boolean);
  for (const up of serves) {
    const text = card(up);
    if (text === null || !/^KIND:[ \t]*outcome[ \t]*$/m.test(text)) continue;
    const upLines = mayIn(text);
    if (upLines.length) return { holder: up, lines: upLines };
  }
  return { holder: null, lines: [] };
}
// Kinds of step that always need a fresh yes, whatever was said once: money, sign-ups, bookings,
// cancellations, a first message to someone never contacted (strangers, prospects, leads, an
// introduction, reaching out), a bulk message, LinkedIn by automation (its User Agreement 8.2).
// "book" only as booking something, so a page about a book is not refused.
const NEVER_STANDING = new RegExp('\\b(?:spend\\w*|pay|pays|paid|payments?|buy\\w*|bought|purchas\\w*|bookings?|booked'
  + '|book(?=\\s+(?:a|an|the|me|us|tickets?|flights?|hotels?|rooms?|tables?|calls?|meetings?|appointments?|slots?|venues?)\\b)'
  + '|subscri\\w*|sign[- ]?ups?|sign(?:ing)? up|cancel\\w*|ads?|advert\\w*|donat\\w*|linkedin|bulk|mass[- ]?e?-?mails?'
  + '|cold|first[- ](?:message|contact)s?|strangers?|prospects?|leads?|reach(?:ing)? out|introduc\\w*|new (?:people|contacts))\\b', 'i');
// Words that say a step reaches another person or the public, so it may never go out alone, only
// with notice. "reply" in its own forms only, so "replace a broken link" is not caught.
const REACHES_PEOPLE = /\b(?:repl(?:y|ies|ied|ying)|comment\w*|messag\w*|e-?mails?|dms?|send\w*|invit\w*|tweet\w*|outreach|write to|contact\w*|people|post\w*|publish\w*)\b/i;

function createGoalCommands({root=L.godspeedRoot(__filename),goalStore,workStore}={}) {
const GODSPEED = root;
const DIR = path.join(GODSPEED, 'goals');
const DIAG = path.join(DIR, 'diagnoses');
const PLAYBOOKS = path.join(DIR, 'playbooks');

const KINDS = ['outcome', 'strategy', 'project', 'commitment'];
const STATUSES = ['provisional', 'adopted', 'paused', 'achieved', 'retired'];
const ACTIVE = ['adopted'];
const IMPORTANCE = ['core', 'high', 'normal'];
const ENERGY = ['low', 'medium', 'high'];
const ORDER = ['ID', 'KIND', 'STATUS', 'AREA', 'TITLE', 'OWN WORDS', 'MEASURE', 'LEAD', 'DEADLINE', 'SERVES', 'DEPENDS ON',
  'PROTECTED', 'OWNER', 'IMPORTANCE', 'ENERGY', 'RESOURCES', 'CADENCE', 'REVIEW', 'SOURCE', 'FILED', 'NOTE'];
// MAY LINES SURVIVE EVERY WRITE (2026-10-12). The shared card format keeps only the first value
// of a repeated KEY and writes back fields and log, nothing else, so a plain write of a card
// with two MAY lines would keep one and lose the other: a permission silently gone. The file
// store is therefore wrapped. A card read from it carries no MAY field (they are not fields), and
// every write puts back the MAY lines that were in the file before it, all of them, once each,
// above ## Log. Only `allow` changes them, by handing the new set as c.may. A store passed in by
// a caller (the notebook's) keeps no card file and is used as it is.
function keepingMay(base) {
  const strip = (c) => { if (c) delete c.f.MAY; return c; };
  const withMay = (rendered, lines) => lines.length
    ? rendered.replace(/\n\n## Log\n/, `\n\n${lines.map(formatMay).join('\n')}\n\n## Log\n`) : rendered;
  const render = (c) => { const f = Object.assign({}, c.f); delete f.MAY; return base.render(Object.assign({}, c, { f })); };
  return Object.assign({}, base, {
    read: (id) => strip(base.read(id)),
    all: () => base.all().map(strip),
    write(c) {
      const lines = Array.isArray(c.may) ? c.may : mayIn(L.readText(base.path(c.id)));
      fs.mkdirSync(DIR, { recursive: true });
      fs.writeFileSync(base.path(c.id), withMay(render(c), lines), 'utf8');
    },
    render: (c) => withMay(render(c), Array.isArray(c.may) ? c.may : mayIn(L.readText(base.path(c.id)))),
  });
}
const S = goalStore || keepingMay(L.store(DIR, ORDER));
const { die, say, oneLine, flag, today, q } = L;
const MACHINE = L.machineWords(GODSPEED);

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
  if (!oneLine(a.source)) die('--source is required: where this goal was said (a date and a channel), so it is never a goal the mission control invented');
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
  if (status === 'adopted' && kind === 'outcome') scaffoldResearch(c, d);
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
  // The two programs next door. Neither is required: a mission control with only this one still keeps its
  // goals honestly, and the line below says plainly which half of the propagation happened.
  const w = L.runNode(__filename, GODSPEED, 'work', ['sweep', '--goal', c.id, closing ? '--cancel' : '--stale', '--reason', reason, '--date', d]);
  const fc = L.runNode(__filename, GODSPEED, 'forecast', ['flag', '--goal', c.id, '--reason', reason, '--date', d]);
  const told = (r, name, missingLine) => r.ok ? oneLine(r.out)
    : r.missing ? `${name} is not installed on this computer, so ${missingLine}`
    : `${name} could not be asked: ` + oneLine(r.err);
  return {
    touched,
    work: told(w, 'mc-work', 'nothing under this goal was marked stale; re-plan it by hand'),
    forecasts: told(fc, 'mc-forecast', 'no forecast under this goal was flagged for review'),
  };
}
cmds.change = (a) => {
  const c = S.read(a._[0] || die('usage: mc-goals change <id> --set FIELD=value [--set ...] --why "..."')) || die('no such goal');
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
    if (k === 'MAY') die('a MAY line is written only by mc-goals allow, with the person\'s own words quoted; never through change');
    if (k === 'STATUS' && !STATUSES.includes(v)) die(`STATUS must be one of: ${STATUSES.join(', ')}`);
    if (k === 'KIND' && !KINDS.includes(v)) die(`KIND must be one of: ${KINDS.join(', ')}`);
    if (k === 'IMPORTANCE' && !IMPORTANCE.includes(v)) die(`IMPORTANCE must be one of: ${IMPORTANCE.join(', ')}`);
    if (k === 'DEADLINE' && v && !L.isoDate(v) && v !== 'unresolved') die('DEADLINE must be YYYY-MM-DD or unresolved');
    if (k === 'SERVES') for (const up of list(v)) if (!S.exists(up)) die(`SERVES ${up}: no such goal`);
    if (k === 'LEAD' && v && !parseLead(v)) die(`LEAD is ${LEAD_FORM}`);
    const old = c.f[k] || '';
    if (old === v) continue;
    c.f[k] = v;
    L.logLine(c, d, 'CHANGED', `${k} ${q(old)} -> ${q(v)} because ${why}`);
    if (k === 'STATUS') L.logLine(c, d, v.toUpperCase(), why);
    changed.push(k);
  }
  if (!changed.length) { say(`${c.id}: nothing changed`); return; }
  if (changed.includes('STATUS') && c.f.STATUS === 'adopted' && c.f.KIND === 'outcome') scaffoldResearch(c, d);
  S.write(c);
  // The weekly number is how the goal is judged, not what it is (2026-09-30, found by the final
  // review of D-266): propagating it marked every open item under the goal stale, so his yes on a
  // ship-list line could no longer unblock it and a planned item left the runner's queue.
  if (changed.every(k => k === 'LEAD')) { say(`${c.id}: changed LEAD (${why}); the goal's work and forecasts stand as they are`); return; }
  const r = propagate(c, d, changed.join(', '), why);
  say(`${c.id}: changed ${changed.join(', ')} (${why})`);
  if (r.touched.length) say(`  review line written on: ${r.touched.join(', ')}`);
  say(`  work: ${r.work}`);
  say(`  forecasts: ${r.forecasts}`);
};
for (const [name, status] of [['adopt', 'adopted'], ['retire', 'retired'], ['pause', 'paused'], ['achieve', 'achieved']]) {
  cmds[name] = (a) => {
    if (!a._[0]) die(`usage: mc-goals ${name} <id> --why "..."`);
    cmds.change({ _: [a._[0]], set: `STATUS=${status}`, why: a.why, date: a.date });
  };
}

cmds.progress = (a) => {
  const c = S.read(a._[0] || die('usage: mc-goals progress <id> --evidence "..."')) || die('no such goal');
  const ev = oneLine(a.evidence);
  if (!ev) die('--evidence is required: what exists in the world now that did not before, and where it was read');
  const d = a.date || today();
  L.logLine(c, d, 'PROGRESS', ev);
  S.write(c);
  say(`${c.id}: progress recorded`);
};

// ---------------------------------------------------------------------------
// allow / may: standing permissions, one per kind of step, in the person's own words
// ---------------------------------------------------------------------------
function mayLines(c) { return mayIn(L.readText(path.join(DIR, `${c.id}.md`))); }
cmds.allow = (a) => {
  const c = S.read(a._[0] || die('usage: mc-goals allow <id> --kind <slug> --what "..." --per-week <n> --words "<their words>" [--mode notice|alone] | --kind <slug> --revoke --words "..."')) || die('no such goal');
  const d = a.date || today();
  const words = a.words === 'true' ? '' : oneLine(a.words);
  if (!words) die('--words is required: the person\'s own words, quoted; a standing permission is never inferred');
  const kind = oneLine(a.kind);
  if (!/^[a-z0-9-]+$/.test(kind)) die('--kind is a short slug like yt-replies');
  const lines = mayLines(c);
  if (flag(a, 'revoke')) {
    if (!lines.some(m => m.kind === kind)) die(`${c.id} has no standing permission "${kind}"; its kinds are: ${lines.map(m => m.kind).join(', ') || 'none'}`);
    c.may = lines.filter(m => m.kind !== kind);
    L.logLine(c, d, 'MAY-REVOKED', `${kind} ${q(words)}`);
    S.write(c);
    say(`${c.id}: ${kind} may no longer go out without a fresh yes`);
    return;
  }
  const what = a.what === 'true' ? '' : oneLine(a.what);
  if (!what) die('--what is required: the kind of step in plain words');
  if (NEVER_STANDING.test(`${kind} ${what}`)) die(`${kind}: this kind of step always needs a fresh yes, never a standing one (money, sign-ups, bookings, cancellations, a first message to someone never contacted, a bulk message, anything on LinkedIn by automation)`);
  const perWeek = /^\d+$/.test(String(a['per-week'] || '')) ? parseInt(a['per-week'], 10) : 0;
  if (!(perWeek >= 1 && perWeek <= 50)) die('--per-week is a number from 1 to 50: how many of these may go out in seven days');
  if (a.mode !== undefined && !['notice', 'alone'].includes(a.mode)) die('--mode is notice (goes out at its set time unless stopped, the default) or alone');
  const mode = a.mode === 'alone' ? 'alone' : 'notice';
  if (mode === 'alone' && REACHES_PEOPLE.test(`${kind} ${what}`)) die(`${kind} reaches other people, so it never goes out alone; give it --mode notice: it goes out at its set time unless stopped`);
  const given = { kind, what: what.replace(/\|/g, '/'), perWeek, mode, words: words.replace(/"/g, "'"), date: d };
  // Given again, a kind keeps its place on the card and takes the new words.
  c.may = lines.some(m => m.kind === kind) ? lines.map(m => (m.kind === kind ? given : m)) : lines.concat([given]);
  L.logLine(c, d, 'MAY-GIVEN', `${kind} (${mode}, ${perWeek} per week) ${q(words)}`);
  S.write(c);
  say(`${c.id}: ${kind} may go out ${mode === 'alone' ? 'when ready, reported after' : 'at its set time unless stopped'}, up to ${perWeek} a week`);
  // A notice step goes out only after a morning message showed it (mc-work announce), so without a
  // morning brief it never goes out, silently (final review I8, 2026-10-13).
  if (mode === 'notice') {
    const brief = morningBriefRoutine();
    if (brief === false) say('note: no morning brief runs in this mission control, and a step like this goes out only after a morning message has shown it; switch the morning brief on, or these steps never go out');
    else if (brief === null) say('note: a step like this goes out only after a morning message has shown it; if no morning brief runs here, switch it on, or these steps never go out');
  }
};
// Is there a morning brief routine to show notice steps? The routines live in the assistant's
// schedule (Hermes: <HERMES_HOME or ~/.hermes>/cron/jobs.json, where the notebook and the
// morning-brief recipe put it). true or false when that file can be read, null when it cannot.
function morningBriefRoutine() {
  const home = process.env.HERMES_HOME || path.join(require('os').homedir(), '.hermes');
  let data;
  try { data = JSON.parse(fs.readFileSync(path.join(home, 'cron', 'jobs.json'), 'utf8')); } catch (e) { return null; }
  const jobs = Array.isArray(data) ? data : (data && Array.isArray(data.jobs) ? data.jobs : []);
  return jobs.some(j => j && typeof j === 'object' && j.enabled !== false
    && (j.skill === 'morning-brief' || (Array.isArray(j.skills) && j.skills.includes('morning-brief')) || /morning[ -]brief/i.test(String(j.name || ''))));
}
cmds.may = (a) => {
  const c = S.read(a._[0] || die('usage: mc-goals may <id> [--json]')) || die('no such goal');
  // A strategy or project with none of its own moves under its outcome's (standingOf, above);
  // such lines carry from: <that outcome> in --json.
  const st = standingOf(GODSPEED, c.id) || { holder: c.id, lines: mayLines(c) };
  const inherited = st.holder && st.holder !== c.id;
  const lines = inherited ? st.lines.map(m => Object.assign({}, m, { from: st.holder })) : st.lines;
  if (flag(a, 'json')) { say(JSON.stringify(lines)); return; }
  if (!lines.length) { say(`${c.id}: no standing permissions; every outward step needs a fresh yes`); return; }
  if (inherited) say(`${c.id} has none of its own; its steps go out under those of ${st.holder}, the outcome it serves, and count toward ${st.holder}'s weekly limits:`);
  for (const m of lines) say(`${m.kind}: ${m.what} (${m.mode}, ${m.perWeek} a week) since ${m.date}: "${m.words}"`);
};

// ---------------------------------------------------------------------------
// the weekly number: LEAD on the card; READ, BET and RESULT lines in its log
// ---------------------------------------------------------------------------
// WHY THIS EXISTS (2026-09-30). The daily decision made moves and graded them by one thing:
// whether they reached the world. Asked what it had done for his money goal in 48 hours, the
// honest answer was three changes, no outcome, and its own checks set four and six weeks out. A
// goal's MEASURE (a balance, a weight, five friends) moves over months, and nothing between it
// and a move could move in a week. So an outcome names one weekly number a step before its
// MEASURE, one that people who reached the goal counted (its playbook's "What they track"):
//
//   LEAD: <what is counted, in plain words> | total | <where it is read>
//   LEAD: <what is counted, in plain words> | per week | <where it is read>
//
// total is a running count (people who ever subscribed); per week is one week's count (days
// with enough protein this week). Every move bets on the number, and seven days after the move
// went live THIS PROGRAM reads the number and writes the verdict (settle, below). The run that
// made the move never grades it: an assistant that grades its own work reuses its most
// confident mistakes. Model: The 4 Disciplines of Execution (lead measures, a scoreboard, a
// weekly cadence of accountability).
const LEAD_KINDS = ['total', 'per week'];
const LEAD_FORM = '"<what is counted> | total or per week | <where it is read>"';
const NUM = /^-?\d+(?:\.\d+)?$/;
function parseLead(v) {
  const p = String(v || '').split('|').map(s => s.trim());
  return (p.length === 3 && p[0] && LEAD_KINDS.includes(p[1]) && p[2]) ? { what: p[0], kind: p[1], where: p[2] } : null;
}
// One reading per day counts: the last one written that day. The log keeps every line.
function readings(c) {
  const byDate = {};
  for (const l of c.log) if (l.event === 'READ') { const v = l.rest.split(' ')[0]; if (NUM.test(v)) byDate[l.date] = parseFloat(v); }
  return Object.keys(byDate).sort().map(date => ({ date, value: byDate[date] }));
}
function lastBetween(rs, from, to) { let hit = null; for (const r of rs) if (r.date >= from && r.date <= to) hit = r; return hit; }
function firstBetween(rs, from, to) { for (const r of rs) if (r.date >= from && r.date <= to) return r; return null; }

cmds.read = (a) => {
  const c = S.read(a._[0] || die('usage: mc-goals read <id> <number> --where "<where it was read, and when>"')) || die('no such goal');
  if (!parseLead(c.f.LEAD)) die(`${c.id} has no weekly number (LEAD) to read; set one first: mc-goals change ${c.id} --set "LEAD=..." --why "..."`);
  const v = String(a._[1] === undefined ? '' : a._[1]);
  if (!NUM.test(v)) die('the reading is a plain number, as it was read, without units');
  const where = oneLine(a.where);
  if (!where || where === 'true') die('--where is required: where the number was read, so the next run can read it the same way');
  const d = a.date || today();
  L.logLine(c, d, 'READ', `${v} (${where})`);
  S.write(c);
  say(`${c.id}: ${v} read on ${d}`);
};

const BET_RE = /^(\S+) (-?\d+(?:\.\d+)?) -> (-?\d+(?:\.\d+)?)(?: "(.*)")?$/;
const WORK = workStore || L.store(path.join(GODSPEED, 'work'), []);   // read only: goals never writes work cards
function betsOf(c) {
  return c.log.filter(l => l.event === 'BET').map(l => {
    const m = l.rest.match(BET_RE);
    return m ? { work: m[1], from: parseFloat(m[2]), to: parseFloat(m[3]), title: m[4] || '', date: l.date } : null;
  }).filter(Boolean);
}
function settledIds(c) { return new Set(c.log.filter(l => l.event === 'RESULT').map(l => l.rest.split(' ')[0])); }
function workCard(id) { return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) && WORK.exists(id) ? WORK.read(id) : null; }
// The day a move reached the world is the day its work item was first verified.
function liveDate(w) { const v = w && w.log.find(l => l.event === 'VERIFIED'); return v ? v.date : null; }

// THE VERDICT, FROM NUMBERS ONLY. total: the gain from the last reading before the move went live
// (no older than three days before the bet) to the first reading seven to ten days after it did.
// per week: that first reading against the bet's own starting number. A bet from 3 to 1 is a
// number meant to fall. worked: it reached the bet. moved: the right way, short of the bet.
// flat: not the right way. unread: a reading is missing. Returns null while a reading may still come.
function judge(lead, rs, b, live, d) {
  const due = L.addDays(live, 7), late = L.addDays(due, 3);
  const after = firstBetween(rs, due, late);
  if (!after) return d > late ? { verdict: 'unread', why: `no reading between ${due} and ${late}` } : null;
  let from = b.from;
  if (lead.kind === 'total') {
    const start = lastBetween(rs, L.addDays(b.date, -3), live);
    if (!start) return { verdict: 'unread', why: `no reading between ${L.addDays(b.date, -3)} and the day it went live, ${live}` };
    from = start.value;
  }
  const dir = b.to >= b.from ? 1 : -1;
  const want = (b.to - b.from) * dir, got = (after.value - from) * dir;
  return { verdict: got <= 0 ? 'flat' : got >= want ? 'worked' : 'moved', from, to: after.value };
}

function settle(d, write) {
  const rows = [];
  for (const c of S.all()) {
    if (c.f.KIND !== 'outcome' || !isOpen(c)) continue;
    const lead = parseLead(c.f.LEAD);
    const r = { id: c.id, lead, now: null, before: null, today: [], earlier: [], live: [], waiting: [], readToday: false };
    rows.push(r);
    if (!lead) continue;
    const rs = readings(c);
    r.now = rs.length ? rs[rs.length - 1] : null;
    r.before = r.now ? lastBetween(rs, L.addDays(r.now.date, -10), L.addDays(r.now.date, -7)) : null;
    r.earlier = c.log.filter(l => l.event === 'RESULT' && L.daysBetween(l.date, d) <= 14).map(l => `${l.date} ${l.rest}`);
    const done = settledIds(c);
    const bets = betsOf(c);
    const lives = Object.fromEntries(bets.map(b => [b.work, liveDate(workCard(b.work))]));
    for (const b of bets) {
      if (done.has(b.work)) continue;
      const w = workCard(b.work), live = lives[b.work];
      let line;
      if (!w) line = `${b.work} never-live: no such work item`;
      else if (!live && w.f.STATUS === 'cancelled') line = `${b.work} never-live: the work was cancelled`;
      else if (!live && L.daysBetween(b.date, d) > 7) line = `${b.work} never-live: not live within seven days of the bet`;
      else if (!live) { r.waiting.push({ work: b.work, title: b.title, since: b.date }); continue; }
      else {
        const due = L.addDays(live, 7);
        const j = d >= due ? judge(lead, rs, b, live, d) : null;
        if (!j) { r.live.push({ work: b.work, title: b.title, live, due }); if (d >= due) r.readToday = true; continue; }
        const shared = bets.filter(o => o.work !== b.work && lives[o.work] && Math.abs(L.daysBetween(lives[o.work], live)) < 7).map(o => o.work);
        line = j.verdict === 'unread' ? `${b.work} unread: ${j.why}`
          : `${b.work} ${j.verdict}: ${j.from} -> ${j.to} in the seven days after it went live on ${live} (bet ${b.from} -> ${b.to})`
            + (shared.length ? `; shared with ${shared.join(', ')}` : '');
      }
      r.today.push(line);
      if (write) L.logLine(c, d, 'RESULT', line);
    }
    if (write && r.today.length) S.write(c);
  }
  return rows;
}

cmds.bets = (a) => {
  const file = a.moves && a.moves !== 'true' ? a.moves : die('usage: mc-goals bets --moves <run folder>/moves.md [--date D]');
  const text = L.readText(file);
  if (!text) die(`${file} is empty or not there`);
  const d = a.date || today();
  const num = '(-?\\d+(?:\\.\\d+)?)';
  const arrow = new RegExp(num + '\\s*(?:->|\u2192)\\s*' + num);
  let n = 0;
  const skipped = [];
  for (const b of text.split(/^(?=###? \d+\.)/m).filter(x => /^###? \d+\./.test(x))) {
    const field = (k) => { const m = b.match(new RegExp('^' + k + ':[ \\t]*(\\S.*)$', 'm')); return m ? m[1].trim() : ''; };
    const goal = field('GOAL').split(/\s+/)[0], work = field('APPLY').split(/\s+/)[0];
    const bet = field('BET').match(arrow);
    if (!goal || !work || !bet || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(goal) || !S.exists(goal)) continue;
    const c = S.read(goal);
    if (!parseLead(c.f.LEAD) || betsOf(c).some(x => x.work === work)) continue;
    const title = b.split('\n')[0].replace(/^#+\s*\d+\.\s*/, '').replace(/"/g, "'").trim();
    // Only a work item that exists can put a move live, so only its bet is recorded (2026-09-30:
    // a run called this before filing its items, and "APPLY: (filed below)" became a bet on an
    // item called "(filed"). The moves check refuses such a move, so when mc-decide runs this after
    // the check every bet names a filed item, and a run that called it too early is recorded then.
    if (!workCard(work)) { skipped.push(`"${title}": APPLY ${work} names no work item on the register yet`); continue; }
    L.logLine(c, d, 'BET', `${work} ${bet[1]} -> ${bet[2]} "${title}"`);
    S.write(c);
    n++;
  }
  say(`${n} bet(s) recorded from ${file}`);
  for (const s of skipped) say(`  not recorded: ${s}`);
};

cmds.settle = (a) => {
  const d = a.date || today();
  const rows = settle(d, !flag(a, 'dry-run'));
  if (flag(a, 'json')) { say(JSON.stringify(rows, null, 2)); return; }
  say(`Weekly numbers on ${d}. Every verdict here was worked out by mc-goals from the readings, never by the run that made the move.`);
  if (!rows.length) say('No adopted outcome on the register.');
  for (const r of rows) {
    if (!r.lead) { say(`${r.id}: no weekly number yet, so none of its moves can be judged. Set one from its playbook's "What they track": mc-goals change ${r.id} --set "LEAD=<what is counted> | total or per week | <where it is read>" --why "<the source>"`); continue; }
    say(`${r.id}: ${r.lead.what} (${r.lead.kind}, read from ${r.lead.where})`);
    if (!r.now) say('  never read yet');
    else {
      const diff = r.before ? r.now.value - r.before.value : null;
      say(`  now ${r.now.value}, read ${r.now.date}` + (r.before ? `; ${r.before.value} on ${r.before.date} (${diff >= 0 ? '+' : ''}${diff})` : ''));
      if (L.daysBetween(r.now.date, d) > 7) say(`  not read for ${L.daysBetween(r.now.date, d)} days`);
    }
    for (const s of r.today) say(`  settled today: ${s}`);
    for (const s of r.earlier) say(`  settled earlier: ${s}`);
    for (const s of r.live) say(`  live since ${s.live}, verdict due ${s.due}: ${s.work} ${s.title}`);
    for (const s of r.waiting) say(`  not live yet, bet placed ${s.since}: ${s.work} ${s.title}`);
  }
  const due = rows.filter(r => r.readToday).map(r => r.id);
  say(`read today: ${due.length ? due.join(' ') : 'none'}`);
};
cmds.question = (a) => {
  const c = S.read(a._[0] || die('usage: mc-goals question <id> --text "..."')) || die('no such goal');
  const t = oneLine(a.text);
  if (!t) die('--text is required');
  const d = a.date || today();
  const open = last(c, ['QUESTION', 'ANSWER']);
  if (open && open.event === 'QUESTION' && !flag(a, 'force')) die(`${c.id} already has an open question from ${open.date}; record the answer first (mc-goals answer)`);
  const recent = c.log.filter(l => l.event === 'QUESTION' && L.daysBetween(l.date, d) < 7);
  if (recent.length && !flag(a, 'force')) die(`${c.id} was asked on ${recent[0].date}; one question in seven days, so you are not managed by your own goal list`);
  L.logLine(c, d, 'QUESTION', t);
  S.write(c);
  say(`${c.id}: question recorded (${t.slice(0, 80)})`);
};
cmds.answer = (a) => {
  const c = S.read(a._[0] || die('usage: mc-goals answer <id> --text "<your words>"')) || die('no such goal');
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
  const c = S.read(a._[0] || die('usage: mc-goals diagnose <id> [--refute <file> --evidence "..."]')) || die('no such goal');
  const d = a.date || today();
  if (a.refute) {
    const p = path.isAbsolute(a.refute) ? a.refute : path.join(GODSPEED, a.refute);
    if (!fs.existsSync(p)) die(`no diagnosis at ${a.refute}`);
    const ev = oneLine(a.evidence);
    if (!ev) die('--evidence is required: the observation that disconfirmed it');
    let text = L.readText(p);
    text = text.replace(/^STATUS: .*$/m, 'STATUS: refuted ' + d);
    text += `\n## Refuted\n- ${d} ${ev}\n`;
    fs.writeFileSync(p, text, 'utf8');
    L.logLine(c, d, 'REFUTED', `${path.relative(GODSPEED, p).replace(/\\/g, '/')}: ${ev}`);
    S.write(c);
    say(`${c.id}: diagnosis refuted; the next attention plan asks for a new one`);
    return;
  }
  fs.mkdirSync(DIAG, { recursive: true });
  const p = path.join(DIAG, `${c.id}-${d}.md`);
  if (fs.existsSync(p)) { say(path.relative(GODSPEED, p).replace(/\\/g, '/')); return; }
  fs.writeFileSync(p, diagTemplate(c.id, d), 'utf8');
  L.logLine(c, d, 'DIAGNOSIS', path.relative(GODSPEED, p).replace(/\\/g, '/'));
  S.write(c);
  say(path.relative(GODSPEED, p).replace(/\\/g, '/'));
};
function diagnosisState(c) {
  const dg = last(c, ['DIAGNOSIS', 'REFUTED']);
  if (!dg) return 'none';
  if (dg.event === 'REFUTED') return 'refuted';
  const p = path.join(GODSPEED, dg.rest);
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
// playbook: the researched model of how a goal is won. One file per goal, written from the
// people, programs or cohorts who reached the outcome, never from what sounds reasonable. A
// diagnosis says what limits the goal now; the playbook says what winning it looks like at all.
// ---------------------------------------------------------------------------
const PLAYBOOK_SECTIONS = [
  ['## Who we model', '(named people, programs or cohorts who reached this outcome, each with the source read and how their start compares to this person\'s)'],
  ['## What they do', '(the levers, in order of leverage, each with the evidence behind it)'],
  ['## In what order', '(the sequence, and what they do first when starting from where this person stands)'],
  ['## What they track', '(the numbers, how often, with what instrument)'],
  ['## Where it fails', '(the common ways people fail at this, and the early signs)'],
  ['## Godspeed steps', '(what a mission control can do without the person: research, build the measurement, compute, find, draft, prepare)'],
  ['## Person steps', '(what only the person can do, and what the mission control prepares for each)'],
  ['## Unknown', '(where the levers disagree or this person\'s case differs: the experiments that would settle it)'],
  ['## Sources', '(every claim\'s source; UNVERIFIED where it was not read)'],
];
const playbookRel = (id) => `goals/playbooks/${id}.md`;
const playbookPath = (id) => path.join(PLAYBOOKS, `${id}.md`);
function playbookTemplate(id, d, reviewDays) {
  return `GOAL: ${id}
WRITTEN: ${d}
REVIEW BY: ${L.addDays(d, reviewDays)}
STATUS: draft
` + PLAYBOOK_SECTIONS.map(([h, hint]) => `\n${h}\n${hint}\n`).join('');
}
// The sections that still carry the template's parenthesised hint, so a playbook cannot be
// called current with a section nobody wrote.
function playbookPlaceholders(text) {
  const left = [];
  let section = '';
  for (const line of text.split('\n')) {
    if (line.startsWith('## ')) { section = line.slice(3).trim(); continue; }
    if (section && line.startsWith('(') && !left.includes(section)) left.push(section);
  }
  return left;
}
function playbookState(c, d) {
  const text = L.readText(playbookPath(c.id));
  if (!text) return last(c, ['PLAYBOOK']) ? 'missing file' : 'none';
  if (/^STATUS: refuted/m.test(text)) return 'refuted';
  if (/^STATUS: draft/m.test(text)) return 'draft';
  const m = text.match(/^REVIEW BY: (\d{4}-\d{2}-\d{2})/m);
  if (m && L.daysBetween(m[1], d || today()) > 0) return 'stale';
  if (researchChallenges(c.id).length) return 'challenged';
  return 'current';
}
const PLAYBOOK_REASON = {
  none: 'no playbook: how this goal is won has not been researched',
  draft: 'playbook is a draft, not yet filled in',
  refuted: 'its playbook was refuted: research it again before acting',
  stale: 'playbook past its review date',
  challenged: 'the research contradicts its playbook: check the lever before acting on it',
};
// An outcome with no model of how it is won sits ahead of one that has one: the research is
// the first work, and it is work the mission control can do alone.
const playbookRank = (state) => ['none', 'draft', 'refuted', 'stale', 'challenged'].includes(state) ? 0 : 1; // a draft is a scaffold nobody filled: as unresearched as none
cmds.playbook = (a) => {
  const c = S.read(a._[0] || die('usage: mc-goals playbook <id> [--review-days 30] | --current | --refute --evidence "..."')) || die('no such goal');
  const d = a.date || today();
  const reviewDays = Math.max(1, parseInt(a['review-days'] || '30', 10) || 30);
  const p = playbookPath(c.id);
  const rel = playbookRel(c.id);
  if (flag(a, 'refute')) {
    if (!fs.existsSync(p)) die(`no playbook at ${rel}`);
    const ev = oneLine(a.evidence);
    if (!ev) die('--evidence is required: the observation that showed the model of success was wrong');
    let text = L.readText(p);
    text = text.replace(/^STATUS: .*$/m, 'STATUS: refuted ' + d);
    text += `\n## Refuted\n- ${d} ${ev}\n`;
    fs.writeFileSync(p, text, 'utf8');
    L.logLine(c, d, 'PLAYBOOK-REFUTED', `${rel}: ${ev}`);
    S.write(c);
    say(`${c.id}: playbook refuted; research it again before acting on this goal`);
    return;
  }
  if (flag(a, 'current')) {
    if (!fs.existsSync(p)) die(`no playbook at ${rel}; mc-goals playbook ${c.id} writes the template`);
    let text = L.readText(p);
    const left = playbookPlaceholders(text);
    if (left.length) die(`${rel} still carries the template placeholder under: ${left.join(', ')}; fill those in before calling it current`);
    const by = L.addDays(d, reviewDays);
    text = text.replace(/^STATUS: .*$/m, 'STATUS: current').replace(/^WRITTEN: .*$/m, `WRITTEN: ${d}`).replace(/^REVIEW BY: .*$/m, `REVIEW BY: ${by}`);
    fs.writeFileSync(p, text, 'utf8');
    L.logLine(c, d, 'PLAYBOOK-CURRENT', `${rel}, review by ${by}`);
    S.write(c);
    say(`${c.id}: playbook current, review by ${by}`);
    return;
  }
  fs.mkdirSync(PLAYBOOKS, { recursive: true });
  if (fs.existsSync(p)) { say(rel); return; }
  fs.writeFileSync(p, playbookTemplate(c.id, d, reviewDays), 'utf8');
  L.logLine(c, d, 'PLAYBOOK', rel);
  S.write(c);
  say(rel);
};

// ---------------------------------------------------------------------------
// research: what the world knows about winning one outcome, kept current every night by the
// goal-research recipe (run by mc-research). The playbook is the model of how the goal is won;
// this folder is the evidence that keeps that model honest and the list of people and chances
// the daily moves are made from. Only outcomes have one: a strategy or project uses the research
// of the outcome it serves.
// ---------------------------------------------------------------------------
const RESEARCH = path.join(DIR, 'research');
const researchRel = (id) => `goals/research/${id}`;
const researchDir = (id) => path.join(RESEARCH, id);
const FOUNDED = { people: 30, cases: 5, claims: 10 };
const BRIEF_SECTIONS = ['## The limit now', '## What works now', '## What changed this week', '## What was proven wrong',
  '## Who to reach and what we offer', '## Openings', '## Experiments', '## What we could do without asking',
  '## Worth asking for', '## Challenges to the playbook'];
const RESEARCH_FILES = {
  'brief.md': (id, d) => `GOAL: ${id}\nUPDATED: ${d}\nSTATUS: founding\n` +
    BRIEF_SECTIONS.map(h => `\n${h}\n${h === '## Challenges to the playbook' ? 'none' : h === '## The limit now' ? 'nothing named' : '(nothing yet)'}\n`).join(''),
  'people.md': () => '# People\n\nThe top people of this field, one block each, a blank line between blocks.\nFields: PERSON, LINK, WHY, LAST, OFFER, STATUS (unverified | verified YYYY-MM-DD), HOT (yes | no).\n',
  'cases.md': () => '# Cases\n\nPeople who reached this goal, best from a start like this person\'s, one block each.\nFields: CASE, START, DID, RESULT, SOURCE (url (read YYYY-MM-DD)).\n',
  'claims.md': () => '# Claims\n\nWhat is known about how this goal is won, one block each.\nFields: CLAIM, STATUS (supported | contested | refuted, then the date), SOURCE, QUOTE, MEANS.\n',
  'openings.md': () => '# Openings\n\nChances with a closing date, one block each.\nFields: OPENING, UNTIL (YYYY-MM-DD), SOURCE, MOVE, IDEA.\n',
  'sources.md': () => '# Sources\n\nWhere this field\'s knowledge lives, one line each: "- <url> | <what it is> | <how often it changes>".\n',
};
function researchCounts(id, d) {
  const dir = researchDir(id);
  const people = blocks(L.readText(path.join(dir, 'people.md')), 'PERSON');
  const day = d || today();
  return {
    people: people.length,
    verified: people.filter(p => /^verified \d{4}-\d{2}-\d{2}$/.test(p.STATUS || '')).length,
    hot: people.filter(p => p.HOT === 'yes').length,
    cases: blocks(L.readText(path.join(dir, 'cases.md')), 'CASE').length,
    claims: blocks(L.readText(path.join(dir, 'claims.md')), 'CLAIM').length,
    openings: blocks(L.readText(path.join(dir, 'openings.md')), 'OPENING').filter(o => L.isoDate(o.UNTIL) && o.UNTIL >= day).length,
  };
}
// The newest night that completed. A night that did not complete leaves <date>.gap.md, which
// this never counts: a gap must never read as a quiet day.
function lastDay(id) {
  let names = [];
  try {
    const all = fs.readdirSync(path.join(researchDir(id), 'days'));
    // A night with a gap file beside its day record is not done: mc-research writes the gap file
    // BEFORE a goal's run and removes it only when the check passed, so a run that was killed
    // leaves a day record that still reads as unfinished.
    names = all.filter(n => /^\d{4}-\d{2}-\d{2}\.md$/.test(n) && !all.includes(n.slice(0, 10) + '.gap.md')).sort();
  } catch (e) { /* no days yet */ }
  return names.length ? names[names.length - 1].slice(0, 10) : null;
}
function researchState(c, d) {
  if (!fs.existsSync(researchDir(c.id))) return 'none';
  const n = researchCounts(c.id, d);
  if (n.people < FOUNDED.people || n.cases < FOUNDED.cases || n.claims < FOUNDED.claims) return 'founding';
  const ld = lastDay(c.id);
  if (!ld || L.daysBetween(ld, d || today()) >= 2) return 'stale';
  return 'current';
}
// Bullet lines under "## Challenges to the playbook" in the brief: research that contradicts a
// lever the playbook rests on.
function researchChallenges(id) {
  const text = String(L.readText(path.join(researchDir(id), 'brief.md')) || '').replace(/\r/g, '');
  const at = text.indexOf('\n## Challenges to the playbook');
  if (at < 0) return [];
  const body = text.slice(at + 1).split('\n').slice(1);
  const out = [];
  for (const line of body) { if (line.startsWith('## ')) break; if (line.trim().startsWith('- ')) out.push(line.trim()); }
  return out;
}
function scaffoldResearch(c, d) {
  const dir = researchDir(c.id);
  if (fs.existsSync(dir)) return researchRel(c.id);
  fs.mkdirSync(path.join(dir, 'days'), { recursive: true });
  for (const [name, make] of Object.entries(RESEARCH_FILES)) fs.writeFileSync(path.join(dir, name), make(c.id, d), 'utf8');
  L.logLine(c, d, 'RESEARCH', researchRel(c.id));
  return researchRel(c.id);
}
const RESEARCH_REASON = {
  none: 'no research folder: nothing keeps what is known about this goal current',
  founding: 'its research is still being founded (people, cases or claims short)',
  stale: 'its research has not completed a night for two days or more',
};
cmds.research = (a) => {
  const d = a.date || today();
  if (flag(a, 'due')) {
    const only = list(a.only || process.env.GODSPEED_RESEARCH_ONLY || '');
    const rows = S.all()
      .filter(c => c.f.KIND === 'outcome' && isOpen(c) && (!only.length || only.includes(c.id)))
      .map(c => { const st = researchState(c, d); return { id: c.id, mode: (st === 'none' || st === 'founding') ? 'founding' : 'daily', last: lastDay(c.id) }; })
      .filter(r => r.last !== d)
      .sort((x, y) => (x.last || '').localeCompare(y.last || '') || x.id.localeCompare(y.id));
    if (flag(a, 'json')) { say(JSON.stringify(rows)); return; }
    for (const r of rows) say(`${r.id} ${r.mode} ${r.last || 'never'}`);
    return;
  }
  const c = S.read(a._[0] || die('usage: mc-goals research <id> [--state [--json]] | research --due [--only a,b] [--json]')) || die('no such goal');
  if (c.f.KIND !== 'outcome') die(`${c.id} is a ${c.f.KIND}; research is kept for outcomes, and a ${c.f.KIND} uses the research of the outcome it serves (${list(c.f.SERVES)[0] || 'none named'})`);
  if (flag(a, 'state')) {
    const n = researchCounts(c.id, d);
    const st = researchState(c, d);
    if (flag(a, 'json')) { say(JSON.stringify(Object.assign({ id: c.id, state: st, last: lastDay(c.id) }, n))); return; }
    say(`${c.id}: ${st}; people ${n.people} (${n.verified} verified, ${n.hot} hot), cases ${n.cases}, claims ${n.claims}, open openings ${n.openings}, last night ${lastDay(c.id) || 'never'}`);
    return;
  }
  const rel = scaffoldResearch(c, d);
  S.write(c);
  say(rel);
};

// ---------------------------------------------------------------------------
// attention: which goals deserve attention today, and why. Weightless. Reads, never writes,
// unless --record.
// ---------------------------------------------------------------------------
// GODSPEED_ATTENTION_PIN=a,b,c: goals the person pinned for a trial (see plan, below).
const pinsFromEnv = () => String(process.env.GODSPEED_ATTENTION_PIN || '').split(',').map(s => s.trim()).filter(Boolean);
function plan(d, seats, pins = pinsFromEnv()) {
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
    if (c.f.KIND === 'outcome') r.playbook = playbookState(c, d);
    if (c.f.KIND === 'outcome' && c.f.STATUS === 'adopted') r.research = researchState(c, d);
    r.question = openQ(c);
    // THE LOOP DECIDES WHO RESTS (2026-09-30). A goal whose moves are out in the world is waiting
    // for their verdicts and can rest a day; one with nothing in flight needs moves. Four goals
    // marked core and three seats meant a "core always sits" rule could not have held.
    if (c.f.KIND === 'outcome') r.flight = parseLead(c.f.LEAD) ? betsOf(c).filter(b => !settledIds(c).has(b.work)).length : null;
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
    if (r.playbook && PLAYBOOK_REASON[r.playbook]) r.reasons.push(PLAYBOOK_REASON[r.playbook]);
    if (r.research && RESEARCH_REASON[r.research]) r.reasons.push(RESEARCH_REASON[r.research]);
    if (r.sinceAttention === null) r.reasons.push('never looked at since filing');
    else if (r.sinceAttention >= 7) r.reasons.push(`not looked at for ${r.sinceAttention} days`);
    if (r.sinceProgress === null || r.sinceProgress >= 14) r.reasons.push(r.sinceProgress === null ? 'no progress recorded yet' : `no progress in ${r.sinceProgress} days`);
    if (r.question && L.daysBetween(r.question.date, d) >= 14) r.reasons.push(`question unanswered for ${L.daysBetween(r.question.date, d)} days: reassess relevance or timing, silence is not a yes`);
    if (!c.f.MEASURE) r.reasons.push('no measure named; counted by attention, not by numbers');
    if (c.f.KIND === 'outcome') r.reasons.push(r.flight === null ? 'no weekly number (LEAD) yet: set one before its moves can be judged'
      : r.flight === 0 ? 'nothing in flight: no move live or waiting on its weekly number'
      : `${r.flight} move(s) in flight on its weekly number`);
    r.rank = [
      c.f.PROTECTED === 'yes' ? 0 : 1,
      (left !== null && left >= 0 && left <= 7) ? 0 : 1,
      r.flight ? 1 : 0,
      r.diagnosis === 'refuted' ? 0 : 1,
      r.playbook ? playbookRank(r.playbook) : 1,
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
  for (const r of rows) if (['strategy', 'project'].includes(r.kind)) {
    r.root = rootOf(r.id);
    r.standsAlone = !(byIdEarly[r.root] && byIdEarly[r.root].kind === 'outcome' && byIdEarly[r.root].status === 'adopted');
    if (!r.standsAlone || !r.rank) continue;
    r.reasons.unshift(r.root === r.id ? 'serves no outcome on the register' : `serves ${r.root}, which is ${byIdEarly[r.root] ? byIdEarly[r.root].status : 'not on the register'}: stands on its own in the ranking`);
    // It is ranked like an outcome, so it is asked for a playbook like one.
    r.playbook = playbookState(S.read(r.id), d);
    if (PLAYBOOK_REASON[r.playbook]) r.reasons.push(PLAYBOOK_REASON[r.playbook]);
    r.rank[4] = playbookRank(r.playbook);   // the playbook key (the flight key sits at 2)
  }
  const top = rows.filter(r => r.rank && (r.kind === 'outcome' || r.kind === 'commitment' || r.standsAlone));
  top.sort((x, y) => { for (let i = 0; i < x.rank.length; i++) if (x.rank[i] !== y.rank[i]) return x.rank[i] - y.rank[i]; return x.id < y.id ? -1 : 1; });
  const protectedRows = top.filter(r => r.kind === 'commitment');
  // GOALS THE PERSON PINNED FOR A TRIAL (2026-10-13, final review I3). A trial that judges a goal
  // by a decision and steps every day cannot let the seats rotate it out: three seats over six
  // outcomes left three of four trial goals quiet on its first day. A pinned goal is always active
  // and ranked first, and the seats grow to hold every pinned goal.
  const pinSet = new Set(pins);
  const pinnedRows = top.filter(r => r.kind !== 'commitment' && pinSet.has(r.id));
  const outcomes = pinnedRows.concat(top.filter(r => r.kind !== 'commitment' && !pinSet.has(r.id)));
  seats = Math.max(seats, pinnedRows.length);
  for (const r of pinnedRows) r.reasons.unshift('pinned for a trial: active every day while it stays pinned');
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
  for (const id of pins) if (!pinnedRows.some(r => r.id === id)) notes.push(`${id} is pinned for a trial, but it is not an adopted outcome (or a goal that stands on its own) on the register, so it holds no seat`);
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
  say(`Attention for ${d} (at most ${p.seats} outcomes active; every row carries its reason)`);
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
  if (!shown.length) { say('No goals on the register yet. `mc-goals file` adds one; provisional is the default status.'); return; }
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
    if (c.f.LEAD && !parseLead(c.f.LEAD)) problems.push(`${c.id}: LEAD is not ${LEAD_FORM}`);
    if (c.f.KIND === 'outcome' && c.f.STATUS === 'adopted' && !c.f.LEAD) notes.push(`${c.id}: no weekly number yet (LEAD); its moves cannot be judged`);
    for (const l of c.log) if (l.event === 'CHANGED' && !/ because /.test(l.rest)) problems.push(`${c.id}: a CHANGED line without a reason`);
    const dg = diagnosisState(c);
    if (dg === 'missing file') problems.push(`${c.id}: DIAGNOSIS line names a file that is gone`);
    if (dg === 'claims a constraint without saying what would disprove it') problems.push(`${c.id}: diagnosis ${dg}`);
    const pb = playbookState(c);
    if (pb === 'missing file') problems.push(`${c.id}: PLAYBOOK line names a file that is gone (${playbookRel(c.id)})`);
    else if (c.f.KIND === 'outcome' && c.f.STATUS === 'adopted') {
      if (pb === 'none') notes.push(`${c.id}: no playbook yet (mc-goals playbook ${c.id})`);
      if (pb === 'stale') notes.push(`${c.id}: playbook past its review date`);
      if (pb === 'refuted') notes.push(`${c.id}: playbook refuted, research again`);
      const rs = researchState(c);
      if (rs !== 'current') notes.push(`${c.id}: research ${rs}` + (rs === 'none' ? ` (mc-goals research ${c.id})` : ''));
    }
    for (const k of ['TITLE', 'MEASURE', 'OWN WORDS']) for (const [re, what] of MACHINE) if (c.f[k] && re.test(c.f[k])) problems.push(`${c.id}: ${k} carries ${what}`);
  }
  for (const n of notes) say('note ' + n);
  if (!problems.length) { say(`goals check: ${all.length} card(s), no problems`); return; }
  for (const p of problems) say('PROBLEM ' + p);
  process.exit(1);
};
cmds.help = () => say(`mc-goals: the register of what you want, and the choice of attention today

  file --kind outcome|strategy|project|commitment --title "..." --source "<when and where you said it>"
       [--status provisional|adopted] [--area health|money|relationships|work|godspeed|other] [--measure "..."]
       [--deadline YYYY-MM-DD|unresolved] [--serves <id,id>] [--depends-on <id>] [--importance core|high|normal]
       [--energy low|medium|high] [--resources "..."] [--own-words "..."] [--review YYYY-MM-DD] [--id <id>]
  change <id> --set "FIELD=value[;FIELD=value]" --why "..."     keeps the old value in the log, writes a REVIEW
                                                                 line on every goal that serves it, marks the
                                                                 work under it stale (or cancelled on retire/pause/
                                                                 achieve) and flags the forecasts that depend on it
  adopt|retire|pause|achieve <id> --why "..."
  progress <id> --evidence "..."          what exists now that did not before, and where it was read
  allow <id> --kind <slug> --what "<the kind of step, plain words>" --per-week <n> --words "<their words, quoted>"
       [--mode notice|alone]              a standing permission, written once as a MAY line on the card. notice (the
                                          default): such a step goes out at its set time unless stopped. alone: it
                                          goes out when ready and is reported after, only for steps that touch the
                                          person's own pages, files and accounts and reach nobody else. Money,
                                          sign-ups, bookings, cancellations, a first or bulk message and LinkedIn
                                          automation always need a fresh yes and are refused here
  allow <id> --kind <slug> --revoke --words "<their words>"   takes it back; logged as MAY-REVOKED
  may <id> [--json]                       the goal's standing permissions: kind, what, per week, mode, words, date;
                                          a strategy or project with none of its own uses those of the first
                                          outcome on its SERVES line that has some (--json adds from: <outcome>)
  question <id> --text "..."              one clarifying question in seven days per goal, never a second while one is open
  answer <id> --text "<your words>"
  diagnose <id>                           writes goals/diagnoses/<id>-<date>.md with the sections a diagnosis needs
  diagnose <id> --refute <file> --evidence "..."   the diagnosis was wrong; the next plan asks for a new one
  playbook <id> [--review-days 30]        writes goals/playbooks/<id>.md: who won this outcome, what they did, in
                                          what order, what they tracked, where it fails; draft until filled in
  playbook <id> --current                 the sections are filled in; sets the review date (refused while a
                                          template placeholder remains)
  playbook <id> --refute --evidence "..." the model of success was wrong; the next plan asks for new research
  research <id>                           makes goals/research/<id>/ (people, cases, claims, openings, sources,
                                          brief, days/); made by itself when an outcome is adopted
  research <id> --state [--json]          founding, stale or current, with the counts
  research --due [--only a,b] [--json]    adopted outcomes not researched today, oldest first, with the mode
  read <id> <number> --where "..."        this week's reading of the goal's weekly number (LEAD)
  bets --moves <moves.md>                 copies each move's BET onto its goal (mc-decide runs it)
  settle [--date D] [--dry-run] [--json]  seven days after a move went live: worked, moved, flat, unread
                                          or never-live, written by this program from the readings
  attention [--date D] [--active 3] [--json] [--record]   which goals get attention today and why (weightless bands);
                                          GODSPEED_ATTENTION_PIN=a,b,c names goals the person pinned for a trial:
                                          always active and ranked first, with as many seats as there are pinned
  list [--all] [--kind K] [--json] | show <id> | tree | check`);

return {cmds,plan,parseLead,judge};
}
module.exports={createGoalCommands,blocks,parseMay,limitOf,standingOf};
if(require.main===module){
const {cmds}=createGoalCommands();
const {die}=L;
const a = L.parseArgs(process.argv.slice(2));
L.alias(a, 'his-words', 'own-words');
const cmd = a._.shift() || 'help';
if (!cmds[cmd]) die(`unknown command ${cmd}; try help`);
cmds[cmd](a);
}
