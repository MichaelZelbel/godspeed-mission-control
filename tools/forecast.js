#!/usr/bin/env node
'use strict';
//
// forecast.js - what your hub expects to happen, written down so it can be wrong on the record.
// Type it as `hub-forecast`.
//
// WHY THIS EXISTS. Every plan carries a prediction whether or not anybody writes one: "this will
// sell", "I will keep it up this time", "the client will say yes next week". Unwritten, a
// prediction cannot be wrong, so nobody ever learns anything from it, and an assistant that makes
// them all day is simply confident. Written down with a date and a number, it becomes the one
// thing in a personal system that can be scored.
//
// WHAT A FORECAST HERE HAS. A question with one clearly defined outcome. How a reader will tell
// yes from no on the deadline. A probability (or a low-high range for a number). The reference
// class: the comparable cases it was read from, INCLUDING the ones that failed, which is the half
// people leave out. How that class fits and where it does not. The quality of the evidence, what
// data is missing, what has to hold, and which action it depends on. Every revision is appended
// with its reason; the old number stays.
//
// HOW IT IS SCORED. `score` uses the last probability before the deadline, once per question, and
// reports the mean Brier score (Brier 1950: the squared gap between the probability and what
// happened, on a 0 to 1 scale, where 0 is perfect, 0.25 is a coin flip at 50% and 1 is confidently
// wrong), a calibration table by bucket, and the same score for the plain historical baseline the
// forecast named. That last one is the point: being right is easy when the answer was obvious, and
// the honest question is whether you beat what history alone would have said. Twenty revisions of
// one question still count as one outcome.
//
// WHAT IT REFUSES. A probability with more than two decimals, which is invented precision. An
// extreme probability with no stated reason. A forecast with no reference class or no way to
// resolve it. A revision that would overwrite history, or one made after the deadline. A
// resolution with no evidence. And it will not let a handful of resolved questions be read as a
// track record: under five it says so, under twenty it says to read it with the interval in mind.
//
// The folder it owns:
//   forecasts/<ID>.md     one card each
//   forecasts/README.md   the format, for you

const path = require('path');
const L = require(path.join(__dirname, 'hub-cards.js'));

const HUB = L.hubRoot(__filename);
const DIR = path.join(HUB, 'forecasts');
const STATUSES = ['open', 'resolved', 'void'];
const QUALITY = ['strong', 'moderate', 'weak', 'none'];
const ORDER = ['ID', 'STATUS', 'GOAL', 'QUESTION', 'RESOLVES WHEN', 'DEADLINE', 'MADE ON', 'P', 'LOW', 'HIGH', 'UNIT', 'BASELINE',
  'BASELINE SOURCE', 'REFERENCE CLASS', 'FIT', 'DIFFERS', 'FAILURES INCLUDED', 'EVIDENCE QUALITY', 'MISSING DATA', 'ASSUMPTIONS',
  'DEPENDS ON', 'ALTERNATIVE', 'STATUS QUO', 'EVIDENCE', 'HORIZON DAYS', 'OUTCOME', 'RESOLVED ON', 'RESOLUTION EVIDENCE', 'FILED'];
const S = L.store(DIR, ORDER);
const { die, say, oneLine, flag, today, q } = L;

function parseP(v, what) {
  const s = oneLine(v);
  if (!/^(0(\.\d{1,2})?|1(\.0{1,2})?)$/.test(s)) die(`${what} must be a probability between 0 and 1 with at most two decimals (${s || 'empty'}); more digits is invented precision`);
  return Number(s);
}
const hasP = (c) => c.f.P !== undefined && c.f.P !== '';
function lastP(c, before) {
  // The probability in force at a date: the last MADE or REVISED line dated on or before it.
  let p = null;
  for (const l of c.log) {
    if (before && l.date > before) continue;
    const m = (l.event === 'MADE' || l.event === 'REVISED') && l.rest.match(/p=([0-9.]+)/);
    if (m) p = Number(m[1]);
  }
  return p;
}
const cmds = {};

cmds.file = (a) => {
  const question = oneLine(a.question);
  if (!question) die('--question is required: one clearly defined outcome');
  const resolves = oneLine(a['resolves-when']);
  if (!resolves) die('--resolves-when is required: how a reader will tell yes from no on the deadline');
  if (!L.isoDate(a.deadline)) die('--deadline YYYY-MM-DD is required');
  const d = a.date || today();
  if (a.deadline < d) die('the deadline is already past; a forecast about the past is a record, not a forecast');
  const range = a.low !== undefined || a.high !== undefined;
  let p = null;
  if (!range) p = parseP(a.p, '--p');
  else { if (!oneLine(a.low) || !oneLine(a.high) || !oneLine(a.unit)) die('a range needs --low, --high and --unit'); }
  if (p !== null && (p <= 0.02 || p >= 0.98) && !oneLine(a['extreme-because'])) die('a probability at or beyond 2% or 98% needs --extreme-because "..."');
  const ref = oneLine(a['reference-class']);
  if (!ref) die('--reference-class is required: the comparable cases, including the failures, and where they were read');
  if (!oneLine(a.evidence)) die('--evidence is required');
  const quality = String(a['evidence-quality'] || 'weak').toLowerCase();
  if (!QUALITY.includes(quality)) die(`--evidence-quality must be one of: ${QUALITY.join(', ')}`);
  let baseline = '';
  if (a.baseline !== undefined) { baseline = String(parseP(a.baseline, '--baseline')); if (!oneLine(a['baseline-source'])) die('--baseline needs --baseline-source: what history was the base rate read from'); }
  const id = a.id ? L.safeId(a.id) : `F-${d}-${question.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').split('-').slice(0, 6).join('-')}`.slice(0, 90);
  if (S.exists(id)) die(`${id} already exists; revise it instead of filing it twice`);
  const f = {
    ID: id, STATUS: 'open', GOAL: oneLine(a.goal), QUESTION: question, 'RESOLVES WHEN': resolves, DEADLINE: a.deadline, 'MADE ON': d,
    P: p === null ? '' : String(p), LOW: oneLine(a.low), HIGH: oneLine(a.high), UNIT: oneLine(a.unit),
    BASELINE: baseline, 'BASELINE SOURCE': oneLine(a['baseline-source']),
    'REFERENCE CLASS': ref, FIT: oneLine(a.fit), DIFFERS: oneLine(a.differs), 'FAILURES INCLUDED': a['failures-included'] === 'no' ? 'no' : (a['failures-included'] ? 'yes' : ''),
    'EVIDENCE QUALITY': quality, 'MISSING DATA': oneLine(a['missing-data']), ASSUMPTIONS: oneLine(a.assumptions),
    'DEPENDS ON': oneLine(a['depends-on']), ALTERNATIVE: oneLine(a.alternative), 'STATUS QUO': oneLine(a['status-quo']),
    EVIDENCE: oneLine(a.evidence), 'HORIZON DAYS': String(L.daysBetween(d, a.deadline)), FILED: d,
  };
  const c = { id, f, log: [] };
  L.logLine(c, d, 'MADE', p === null ? `range ${f.LOW}-${f.HIGH} ${f.UNIT}` : `p=${p}` + (a['extreme-because'] ? ` extreme because ${oneLine(a['extreme-because'])}` : ''));
  S.write(c);
  say(`${id}: filed, ${p === null ? 'range' : 'p=' + p}, resolves by ${a.deadline} (${f['HORIZON DAYS']} days)`);
  if (!f.FIT || !f.DIFFERS) say('  note: say how the reference class fits and where it differs (--fit, --differs); a class without both is a story');
  if (f['FAILURES INCLUDED'] !== 'yes') say('  note: --failures-included yes once the class holds the cases that failed, not only the ones that worked');
};

cmds.revise = (a) => {
  const c = S.read(a._[0] || die('usage: hub-forecast revise <id> --p 0.xx --why "..."')) || die('no such forecast');
  if (c.f.STATUS !== 'open') die(`${c.id} is ${c.f.STATUS}; history is not revised`);
  const why = oneLine(a.why);
  if (!why) die('--why is required: what evidence moved the number');
  const d = a.date || today();
  if (d > c.f.DEADLINE) die(`the deadline ${c.f.DEADLINE} has passed; resolve it, do not revise it`);
  if (hasP(c) || a.p !== undefined) {
    const p = parseP(a.p, '--p');
    if (String(p) === c.f.P) die('same probability as before; a revision changes the number or it is a note');
    if ((p <= 0.02 || p >= 0.98) && !oneLine(a['extreme-because'])) die('a probability at or beyond 2% or 98% needs --extreme-because');
    L.logLine(c, d, 'REVISED', `p=${p} from ${c.f.P} because ${why}`);
    c.f.P = String(p);
  } else {
    if (!oneLine(a.low) || !oneLine(a.high)) die('a range revision needs --low and --high');
    L.logLine(c, d, 'REVISED', `range ${oneLine(a.low)}-${oneLine(a.high)} ${c.f.UNIT} from ${c.f.LOW}-${c.f.HIGH} because ${why}`);
    c.f.LOW = oneLine(a.low); c.f.HIGH = oneLine(a.high);
  }
  S.write(c);
  say(`${c.id}: revised (${why.slice(0, 80)}); ${c.log.filter(l => l.event === 'REVISED').length} revision(s) on record`);
};

cmds.flag = (a) => {
  // A goal changed: every open forecast that depends on it or serves it gets a REVIEW line.
  const goal = oneLine(a.goal);
  if (!goal) die('--goal is required');
  const d = a.date || today();
  const hit = S.all().filter(c => c.f.STATUS === 'open' && (c.f.GOAL === goal || oneLine(c.f['DEPENDS ON']).split(/[,\s]+/).includes(goal)));
  for (const c of hit) { L.logLine(c, d, 'REVIEW', oneLine(a.reason || `${goal} changed`)); S.write(c); }
  say(hit.length ? `review line written on ${hit.length} open forecast(s): ${hit.map(c => c.id).join(', ')}` : 'no open forecast depends on ' + goal);
};

cmds.resolve = (a) => {
  const c = S.read(a._[0] || die('usage: hub-forecast resolve <id> --outcome yes|no|void --evidence "..." [--value N]')) || die('no such forecast');
  if (c.f.STATUS !== 'open') die(`${c.id} is already ${c.f.STATUS}`);
  const o = String(a.outcome || '').toLowerCase();
  if (!['yes', 'no', 'void'].includes(o)) die('--outcome must be yes, no or void (the question became unanswerable)');
  const ev = oneLine(a.evidence);
  if (!ev) die('--evidence is required: what was observed, where');
  const d = a.date || today();
  if (!hasP(c) && o !== 'void' && a.value === undefined) die('a range forecast resolves with --value N (the observed number)');
  c.f.STATUS = o === 'void' ? 'void' : 'resolved';
  c.f.OUTCOME = o === 'void' ? 'void' : o;
  if (a.value !== undefined) c.f.OUTCOME = `${o} value=${oneLine(a.value)}`;
  c.f['RESOLVED ON'] = d;
  c.f['RESOLUTION EVIDENCE'] = ev;
  L.logLine(c, d, 'RESOLVED', `${c.f.OUTCOME} ${q(ev)}`);
  S.write(c);
  if (hasP(c) && o !== 'void') {
    const p = lastP(c, c.f.DEADLINE);
    const y = o === 'yes' ? 1 : 0;
    say(`${c.id}: resolved ${o}; Brier ${((p - y) ** 2).toFixed(3)} at p=${p}` + (c.f.BASELINE ? `, baseline ${((Number(c.f.BASELINE) - y) ** 2).toFixed(3)} at p=${c.f.BASELINE}` : ''));
  } else say(`${c.id}: ${c.f.STATUS} (${c.f.OUTCOME})`);
};

cmds.list = (a) => {
  const d = a.date || today();
  const all = S.all();
  let rows = flag(a, 'all') ? all : all.filter(c => c.f.STATUS === 'open');
  if (flag(a, 'due')) rows = all.filter(c => c.f.STATUS === 'open' && c.f.DEADLINE <= d);
  if (a.goal) rows = rows.filter(c => c.f.GOAL === a.goal);
  if (flag(a, 'json')) { say(JSON.stringify(rows.map(c => Object.assign({ id: c.id, log: c.log }, c.f)), null, 2)); return; }
  if (!rows.length) { say(flag(a, 'due') ? 'nothing to resolve today' : 'no forecasts on the register'); return; }
  for (const c of rows) {
    const revs = c.log.filter(l => l.event === 'REVISED').length;
    say(`${c.f.STATUS.padEnd(9)} ${c.id.padEnd(48)} ${hasP(c) ? 'p=' + c.f.P : c.f.LOW + '-' + c.f.HIGH + ' ' + c.f.UNIT}  by ${c.f.DEADLINE}` +
      (revs ? `  (${revs} revision${revs > 1 ? 's' : ''})` : '') + (c.f.OUTCOME ? `  -> ${c.f.OUTCOME}` : '') + (c.f.DEADLINE <= d && c.f.STATUS === 'open' ? '  DUE' : ''));
    say(`          ${c.f.QUESTION}`);
  }
};
cmds.due = (a) => cmds.list(Object.assign({}, a, { due: 'true' }));
cmds.show = (a) => { const c = S.read(a._[0] || die('which forecast?')) || die('no such forecast'); say(S.render(c).trimEnd()); };

// SCORE. Once per resolved binary question, the last probability before the deadline.
function scoreRows(all) {
  const rows = [];
  for (const c of all) {
    if (c.f.STATUS !== 'resolved' || !hasP(c)) continue;
    const y = /^yes/.test(c.f.OUTCOME) ? 1 : /^no/.test(c.f.OUTCOME) ? 0 : null;
    if (y === null) continue;
    const p = lastP(c, c.f.DEADLINE);
    if (p === null) continue;
    const first = lastP(c, c.f['MADE ON']);
    rows.push({ id: c.id, goal: c.f.GOAL, p, first, y, brier: (p - y) ** 2, horizon: Number(c.f['HORIZON DAYS'] || 0),
      baseline: c.f.BASELINE === '' ? null : Number(c.f.BASELINE), baselineBrier: c.f.BASELINE === '' ? null : (Number(c.f.BASELINE) - y) ** 2 });
  }
  return rows;
}
cmds.score = (a) => {
  const rows = scoreRows(S.all());
  const n = rows.length;
  const mean = (xs) => xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
  const buckets = [[0, 0.2], [0.2, 0.4], [0.4, 0.6], [0.6, 0.8], [0.8, 1.01]].map(([lo, hi]) => {
    const inB = rows.filter(r => r.p >= lo && r.p < hi);
    return { range: `${lo.toFixed(1)}-${Math.min(hi, 1).toFixed(1)}`, n: inB.length, meanP: mean(inB.map(r => r.p)), observed: mean(inB.map(r => r.y)) };
  });
  const withBase = rows.filter(r => r.baselineBrier !== null);
  const out = { resolved: n, meanBrier: mean(rows.map(r => r.brier)), meanBrierFirst: mean(rows.map(r => (r.first - r.y) ** 2)),
    baselineQuestions: withBase.length, meanBrierOnBaselineQuestions: mean(withBase.map(r => r.brier)), baselineMeanBrier: mean(withBase.map(r => r.baselineBrier)),
    byHorizon: { under30: mean(rows.filter(r => r.horizon < 30).map(r => r.brier)), from30: mean(rows.filter(r => r.horizon >= 30).map(r => r.brier)) },
    calibration: buckets, rows, note: n < 5 ? 'fewer than five resolved questions: a note, not a track record' : n < 20 ? 'under twenty resolved questions: read with the interval in mind' : '' };
  if (flag(a, 'json')) { say(JSON.stringify(out, null, 2)); return; }
  if (!n) { say('no resolved binary forecasts yet; the first score exists when the first deadline passes and is resolved with evidence'); return; }
  say(`Forecast score over ${n} resolved question(s), each counted once at its last pre-deadline probability`);
  say(`  mean Brier (0 is perfect, 0.25 is a coin at 50%, 1 is confidently wrong): ${out.meanBrier.toFixed(3)}` + (out.meanBrierFirst !== null ? `; at first filing ${out.meanBrierFirst.toFixed(3)}` : ''));
  if (withBase.length) say(`  same questions, the named historical baseline: hub ${out.meanBrierOnBaselineQuestions.toFixed(3)} vs baseline ${out.baselineMeanBrier.toFixed(3)} over ${withBase.length}`);
  else say('  no baseline named on any resolved question, so there is nothing to beat yet');
  say('  calibration (bucket, n, mean forecast, observed rate):');
  for (const b of buckets) if (b.n) say(`    ${b.range}  n=${b.n}  forecast ${b.meanP.toFixed(2)}  observed ${b.observed.toFixed(2)}`);
  if (out.byHorizon.under30 !== null || out.byHorizon.from30 !== null) say(`  by horizon: under 30 days ${out.byHorizon.under30 === null ? 'none' : out.byHorizon.under30.toFixed(3)}, 30 days and more ${out.byHorizon.from30 === null ? 'none' : out.byHorizon.from30.toFixed(3)}`);
  if (out.note) say('  ' + out.note);
};

cmds.check = () => {
  const all = S.all();
  const problems = [];
  const d = today();
  for (const c of all) {
    if (c.id !== c.f.ID) problems.push(`${c.id}: ID field says ${c.f.ID}`);
    if (!STATUSES.includes(c.f.STATUS)) problems.push(`${c.id}: STATUS ${c.f.STATUS}`);
    if (!L.isoDate(c.f.DEADLINE)) problems.push(`${c.id}: DEADLINE ${c.f.DEADLINE}`);
    if (!c.f['RESOLVES WHEN']) problems.push(`${c.id}: no resolution criteria`);
    if (!c.f['REFERENCE CLASS']) problems.push(`${c.id}: no reference class`);
    if (hasP(c) && !/^(0(\.\d{1,2})?|1(\.0{1,2})?)$/.test(c.f.P)) problems.push(`${c.id}: P ${c.f.P} is not a two-decimal probability`);
    if (!hasP(c) && !(c.f.LOW && c.f.HIGH && c.f.UNIT)) problems.push(`${c.id}: neither a probability nor a full range`);
    if (!c.log.some(l => l.event === 'MADE')) problems.push(`${c.id}: no MADE line`);
    if (c.f.STATUS === 'resolved' && !c.f['RESOLUTION EVIDENCE']) problems.push(`${c.id}: resolved without evidence`);
    if (c.f.STATUS === 'open' && c.f.DEADLINE < L.addDays(d, -14)) problems.push(`${c.id}: deadline ${c.f.DEADLINE} passed over two weeks ago and it is still open; resolve it`);
    const revs = c.log.filter(l => l.event === 'REVISED');
    for (const r of revs) if (!/ because /.test(r.rest)) problems.push(`${c.id}: a revision without a reason`);
    for (const r of revs) if (r.date > c.f.DEADLINE) problems.push(`${c.id}: revised after its deadline`);
  }
  if (!problems.length) { say(`forecast check: ${all.length} card(s), no problems`); return; }
  for (const p of problems) say('PROBLEM ' + p);
  process.exit(1);
};
cmds.help = () => say(`hub-forecast: explicit forecasts, revisions kept, scored once per question

  file --question "..." --resolves-when "..." --deadline YYYY-MM-DD (--p 0.xx | --low N --high N --unit U)
       --reference-class "..." --evidence "..." [--evidence-quality strong|moderate|weak|none]
       [--fit "..."] [--differs "..."] [--failures-included yes|no] [--missing-data "..."] [--assumptions "..."]
       [--baseline 0.xx --baseline-source "..."] [--goal <goal id>] [--depends-on <work or goal id>]
       [--alternative "..."] [--status-quo "..."] [--extreme-because "..."] [--id <id>]
  revise <id> --p 0.xx --why "..."      appends; the old number stays in the log; refused after the deadline
  resolve <id> --outcome yes|no|void --evidence "..." [--value N]
  flag --goal <id> --reason "..."      a goal changed; every open forecast under it gets a REVIEW line
  list [--all|--due] [--goal G] [--json] | due | show <id>
  score [--json]                       Brier per resolved question (last pre-deadline p), calibration by bucket,
                                       the named baseline on the same questions, by horizon
  check`);

const a = L.parseArgs(process.argv.slice(2));
const cmd = a._.shift() || 'help';
if (!cmds[cmd]) die(`unknown command ${cmd}; try help`);
cmds[cmd](a);
