#!/usr/bin/env node
'use strict';
//
// work.js - what your hub decided to do, tracked from planned to verified, so a job is not lost
// between sessions, not run twice when something fires twice, and never called done because a
// model said it was done. Type it as `hub-work`.
//
// WHY THIS EXISTS. An assistant that works while you are asleep has one characteristic failure,
// and it is not that it does the wrong thing. It is that it produces something, writes down that
// it produced something, and stops. Nobody checks. "Posted", "sent", "fixed" are the runner's own
// words about its own work, which is the one source you cannot use. So this register keeps three
// states apart that every to-do list treats as one:
//   DISPATCHED  a runner has taken it and holds a lease on it
//   ATTEMPTED   the runner says it did the thing
//   VERIFIED    a check that is not the runner passed, or a person looked and said where
// Only VERIFIED closes an item. That single distinction is most of what this file is for.
//
// THE RULES LIVE IN THE PROGRAM, NOT IN A NOTE YOU HOPE IT READS.
//  - `file` with a KEY that is already open files NOTHING and returns the existing item, so a
//    schedule that fires twice, or a session that is retried, cannot make two of anything.
//  - `take` leases an item to one runner for two hours. A second runner is refused until it
//    expires; `tick` gives back a lease that ran out with no report.
//  - OUTWARD work - a send, a spend, a post, a listing, a sign-up - is filed blocked, is never
//    retried on its own, and cannot be taken or unblocked without your own words quoted on it.
//  - A failure gets a growing gap, not a hammer: one day, then two, then four, up to MAX
//    ATTEMPTS, and after that a person decides what happens.
//  - `sweep --card` cancels the work under a card you answered. `sweep --goal` marks the work
//    under a changed goal stale, so a change to a goal reaches the plan beneath it instead of
//    leaving yesterday's plan running.
//  - An item has a KIND: `do` (the default) or `learn`. A learn item is a question, and it is
//    done when the answer is WRITTEN somewhere a reader can open, so its DONE WHEN must name a
//    file. "We found out X" in a runner's report closes nothing; the file does.
//
// The folder it owns:
//   work/<ID>.md      one item each
//   work/README.md    the format, for you

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const L = require(path.join(__dirname, 'hub-cards.js'));

const HUB = L.hubRoot(__filename);
const DIR = path.join(HUB, 'work');
const STATUSES = ['planned', 'dispatched', 'attempted', 'verified', 'failed', 'blocked', 'stale', 'cancelled'];
const OPEN = ['planned', 'dispatched', 'attempted', 'failed', 'blocked', 'stale'];
// WHO OWNS AN ITEM. `hub` is your assistant, `person` is you, `company:<slug>` is a group of
// agents you set up to do one job. `him`, `her`, `them`, `me` and `you` are all accepted and
// stored as `person`, because an older note of yours should keep running.
const OWNERS = /^(hub|person|company:[a-z0-9-]+)$/;
const PERSON = /^(person|me|you|him|her|them|i)$/i;
const asOwner = (v) => (PERSON.test(v) ? 'person' : v);
const NEEDS = /^(none|person|authorization|capability:.+)$/;
const asNeeds = (v) => (PERSON.test(v) ? 'person' : v);
const KINDS = ['do', 'learn'];
// A learn item is done when its answer is in a file. "Names a file" means: a token with a
// slash in it, ending in .md, .csv, .json or .txt, trailing punctuation ignored.
const namesFile = (s) => String(s || '').split(/\s+/).map(t => t.replace(/[.,;:)"'\]]+$/, ''))
  .some(t => t.includes('/') && /\.(md|csv|json|txt)$/i.test(t));
const ORDER = ['ID', 'STATUS', 'KIND', 'KEY', 'GOAL', 'CARD', 'WHAT', 'DONE WHEN', 'CHECK', 'OWNER', 'NEEDS', 'OUTWARD', 'ATTEMPTS', 'MAX ATTEMPTS',
  'LEASE', 'NEXT TRY', 'STALE AFTER', 'FILED', 'SOURCE', 'RESULT', 'LINK', 'APPROVED'];
const S = L.store(DIR, ORDER);
const { die, say, oneLine, flag, today, q } = L;
const now = () => (process.env.HUB_NOW || new Date().toISOString());
const cmds = {};

function nextId(d) {
  const n = S.all().filter(c => c.id.startsWith('W-' + d.replace(/-/g, ''))).length + 1;
  return `W-${d.replace(/-/g, '')}-${String(n).padStart(2, '0')}`;
}
function leaseOf(c) {
  const m = (c.f.LEASE || '').match(/^(\S+) until (\S+)$/);
  return m ? { runner: m[1], until: m[2] } : null;
}
function leaseLive(c) { const l = leaseOf(c); return l && l.until > now() ? l : null; }
function attemptsOf(c) { return parseInt(c.f.ATTEMPTS || '0', 10) || 0; }
function maxOf(c) { return parseInt(c.f['MAX ATTEMPTS'] || '3', 10) || 3; }

cmds.file = (a) => {
  if (a.learn === 'true') die('--learn needs the question, in quotes');
  const question = oneLine(a.learn);
  const kind = oneLine(a.kind || (question ? 'learn' : 'do'));
  if (!KINDS.includes(kind)) die('--kind must be do or learn');
  const what = oneLine(a.what) || question;
  if (!what) die('--what is required');
  let done = oneLine(a['done-when']);
  const where = oneLine(a.path);
  if (!done && kind === 'learn' && where) done = `the answer to ${q(question || what)} is written in ${where}, with the evidence read`;
  if (kind === 'learn' && !namesFile(done)) die('a learn item is done when the answer is written somewhere a reader can open: its DONE WHEN must name a file (a path ending in .md, .csv, .json or .txt), or give --path <file>');
  if (!done) die('--done-when is required: what a reader will see when this is done, so it can be verified by someone who is not the runner');
  const key = oneLine(a.key || what.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 80));
  const dup = S.all().find(c => c.f.KEY === key && OPEN.includes(c.f.STATUS));
  if (dup) { say(`${dup.id}: already on the register with this key (${dup.f.STATUS}); nothing filed twice`); return; }
  const owner = asOwner(oneLine(a.owner || 'hub'));
  if (!OWNERS.test(owner)) die('--owner must be hub, person or company:<slug>');
  let needs = asNeeds(oneLine(a.needs || 'none'));
  if (!NEEDS.test(needs)) die('--needs must be none, person, authorization or capability:<what is missing>');
  const outward = a.outward === 'yes' ? 'yes' : 'no';
  if (outward === 'yes' && needs === 'none') needs = 'authorization';
  if (owner === 'person' && needs === 'none') needs = 'person';
  const d = a.date || today();
  const id = a.id ? L.safeId(a.id) : nextId(d);
  if (S.exists(id)) die(`${id} already exists`);
  const f = {
    ID: id, STATUS: needs === 'none' ? 'planned' : 'blocked', KIND: kind, KEY: key, GOAL: oneLine(a.goal), CARD: oneLine(a.card), WHAT: what, 'DONE WHEN': done,
    CHECK: oneLine(a.check), OWNER: owner, NEEDS: needs, OUTWARD: outward, ATTEMPTS: '0', 'MAX ATTEMPTS': String(parseInt(a['max-attempts'] || '3', 10) || 3),
    'STALE AFTER': String(parseInt(a['stale-after'] || '7', 10) || 7), FILED: d, SOURCE: oneLine(a.source || 'unknown'),
  };
  const c = { id, f, log: [] };
  L.logLine(c, d, 'FILED', `by ${f.SOURCE}` + (f.GOAL ? ` for ${f.GOAL}` : '') + (f.CARD ? ` under card ${f.CARD}` : ''));
  if (f.STATUS === 'blocked') L.logLine(c, d, 'BLOCKED', `needs ${needs}`);
  S.write(c);
  say(`${id}: ${f.STATUS}` + (f.STATUS === 'blocked' ? ` (needs ${needs})` : '') + (outward === 'yes' ? ' outward: never on its own' : ''));
};

cmds.take = (a) => {
  const c = S.read(a._[0] || die('usage: hub-work take <id> --runner <name> [--approved-by "<your words>"]')) || die('no such work');
  const runner = oneLine(a.runner);
  if (!runner) die('--runner is required: which harness on which machine');
  const d = a.date || today();
  if (!['planned', 'failed', 'stale', 'dispatched'].includes(c.f.STATUS)) die(`${c.id} is ${c.f.STATUS}; only planned, failed or stale work is taken`);
  if (c.f.STATUS === 'failed' && c.f['NEXT TRY'] && c.f['NEXT TRY'] > d && !flag(a, 'now')) die(`${c.id} retries on ${c.f['NEXT TRY']}, not before (a failure gets a gap, not a hammer)`);
  if (attemptsOf(c) >= maxOf(c) && !flag(a, 'now')) die(`${c.id} has used its ${maxOf(c)} attempts; a person decides what happens next`);
  const live = leaseLive(c);
  if (live && live.runner !== runner) die(`${c.id} is held by ${live.runner} until ${live.until}`);
  if (c.f.OUTWARD === 'yes') {
    const ok = oneLine(a['approved-by']);
    if (!ok) die(`${c.id} is outward, so it reaches somebody else: it is taken only with --approved-by "<your words, as you said them>"`);
    c.f.APPROVED = `${d} ${q(ok)}`;
    L.logLine(c, d, 'APPROVED', q(ok));
  }
  const until = new Date(Date.parse(now()) + 2 * 3600 * 1000).toISOString();
  c.f.LEASE = `${runner} until ${until}`;
  c.f.STATUS = 'dispatched';
  L.logLine(c, d, 'DISPATCHED', `${runner}, lease until ${until}`);
  S.write(c);
  say(`${c.id}: dispatched to ${runner} until ${until}`);
};

cmds.attempt = (a) => {
  const c = S.read(a._[0] || die('usage: hub-work attempt <id> --runner <name> (--ok --result "..." | --failed "why")')) || die('no such work');
  const runner = oneLine(a.runner);
  const d = a.date || today();
  const live = leaseLive(c);
  if (live && runner && live.runner !== runner) die(`${c.id} is held by ${live.runner}; ${runner} may not report on it`);
  if (!['dispatched', 'planned'].includes(c.f.STATUS)) die(`${c.id} is ${c.f.STATUS}; an attempt is reported on dispatched work`);
  c.f.ATTEMPTS = String(attemptsOf(c) + 1);
  if (a.failed !== undefined) {
    const why = oneLine(a.failed);
    if (!why) die('--failed needs the reason');
    c.f.STATUS = 'failed';
    c.f.LEASE = '';
    const n = attemptsOf(c);
    if (c.f.OUTWARD === 'yes') { c.f['NEXT TRY'] = ''; L.logLine(c, d, 'FAILED', `attempt ${n}: ${why}; outward, so no retry on its own`); }
    else if (n >= maxOf(c)) { c.f['NEXT TRY'] = ''; L.logLine(c, d, 'FAILED', `attempt ${n} of ${maxOf(c)}: ${why}; attempts used up, a person decides`); }
    else { c.f['NEXT TRY'] = L.addDays(d, 2 ** (n - 1)); L.logLine(c, d, 'FAILED', `attempt ${n} of ${maxOf(c)}: ${why}; retry on ${c.f['NEXT TRY']}`); }
    S.write(c);
    say(`${c.id}: failed (${why.slice(0, 80)})` + (c.f['NEXT TRY'] ? `, retry ${c.f['NEXT TRY']}` : ''));
    return;
  }
  const result = oneLine(a.result);
  if (!result) die('--result is required: what the runner did and where the evidence is');
  c.f.STATUS = 'attempted';
  c.f.RESULT = result;
  L.logLine(c, d, 'ATTEMPTED', `attempt ${attemptsOf(c)} by ${runner || 'unnamed'}: ${result}`);
  S.write(c);
  say(`${c.id}: attempted, not yet verified (run: hub-work verify ${c.id})`);
};

cmds.verify = (a) => {
  const c = S.read(a._[0] || die('usage: hub-work verify <id> [--evidence "what was observed, where"]')) || die('no such work');
  if (!['attempted', 'dispatched', 'planned'].includes(c.f.STATUS)) die(`${c.id} is ${c.f.STATUS}`);
  const d = a.date || today();
  const ev = oneLine(a.evidence);
  if (c.f.CHECK) {
    const r = spawnSync(process.platform === 'win32' ? 'bash' : 'sh', ['-c', c.f.CHECK], { cwd: HUB, encoding: 'utf8', timeout: 120000, env: Object.assign({}, process.env, { HUB_ROOT: HUB }) });
    if (r.status === 0) {
      c.f.STATUS = 'verified'; c.f.LEASE = '';
      L.logLine(c, d, 'VERIFIED', `check passed (${c.f.CHECK})` + (ev ? `; ${ev}` : ''));
      S.write(c);
      say(`${c.id}: verified by its check`);
      return;
    }
    L.logLine(c, d, 'UNVERIFIED', `check failed rc=${r.status}: ${oneLine((r.stderr || r.stdout || '').slice(0, 200)) || 'no output'}`);
    if (c.f.STATUS === 'attempted' && !ev) {
      S.write(c);
      say(`${c.id}: the runner said done, the check says not; stays attempted`);
      process.exit(2);
    }
  }
  if (!ev) die(`${c.id} has ${c.f.CHECK ? 'a failing check' : 'no check'}; verify with --evidence "<what a person observed, where>" or add a CHECK`);
  if (c.f.OWNER === 'hub' && !c.f.CHECK && !/\b(saw|read|opened|screenshot|observed|https?:)/i.test(ev)) die('evidence for hub-owned work names what was observed or a link; "done" is not evidence');
  c.f.STATUS = 'verified'; c.f.LEASE = '';
  L.logLine(c, d, 'VERIFIED', `by observation: ${ev}`);
  S.write(c);
  say(`${c.id}: verified by observation`);
};

cmds.block = (a) => {
  const c = S.read(a._[0] || die('usage: hub-work block <id> --needs person|authorization|capability:<x>')) || die('no such work');
  const needs = asNeeds(oneLine(a.needs));
  if (!NEEDS.test(needs) || needs === 'none') die('--needs must be person, authorization or capability:<what>');
  const d = a.date || today();
  c.f.STATUS = 'blocked'; c.f.NEEDS = needs; c.f.LEASE = '';
  L.logLine(c, d, 'BLOCKED', `needs ${needs}` + (a.why ? `: ${oneLine(a.why)}` : ''));
  S.write(c);
  say(`${c.id}: blocked, needs ${needs}`);
};
cmds.unblock = (a) => {
  const c = S.read(a._[0] || die('usage: hub-work unblock <id> --why "..."')) || die('no such work');
  if (c.f.STATUS !== 'blocked') die(`${c.id} is ${c.f.STATUS}`);
  const why = oneLine(a.why);
  if (!why) die('--why is required: what arrived (your word on it, the missing capability, the approval)');
  const d = a.date || today();
  if (c.f.OUTWARD === 'yes' && !oneLine(a['approved-by'])) die('outward work is unblocked only with --approved-by "<your words>"');
  if (a['approved-by']) { c.f.APPROVED = `${d} ${q(oneLine(a['approved-by']))}`; L.logLine(c, d, 'APPROVED', q(oneLine(a['approved-by']))); }
  c.f.STATUS = 'planned'; c.f.NEEDS = 'none';
  L.logLine(c, d, 'UNBLOCKED', why);
  S.write(c);
  say(`${c.id}: planned again`);
};
// LINK. A finished piece that became a page keeps its address on the item, so the morning
// message and the card can hand it over without anybody digging for the file.
cmds.link = (a) => {
  const c = S.read(a._[0] || die('usage: hub-work link <id> --url https://...')) || die('no such work');
  const url = oneLine(a.url);
  if (!/^https:\/\/\S+$/.test(url)) die('--url must be one https address a reader can open');
  const d = a.date || today();
  c.f.LINK = url;
  L.logLine(c, d, 'PUBLISHED', url);
  S.write(c);
  say(`${c.id}: link recorded`);
};

cmds.cancel = (a) => {
  const c = S.read(a._[0] || die('usage: hub-work cancel <id> --why "..."')) || die('no such work');
  if (!OPEN.includes(c.f.STATUS)) die(`${c.id} is ${c.f.STATUS}`);
  const why = oneLine(a.why);
  if (!why) die('--why is required');
  const d = a.date || today();
  c.f.STATUS = 'cancelled'; c.f.LEASE = '';
  L.logLine(c, d, 'CANCELLED', why);
  S.write(c);
  say(`${c.id}: cancelled (${why.slice(0, 80)})`);
};

// SWEEP. Your answer on a card, or a change to a goal, reaches the work underneath it.
cmds.sweep = (a) => {
  const d = a.date || today();
  const reason = oneLine(a.reason || 'swept');
  let hit = [];
  if (a.card) hit = S.all().filter(c => OPEN.includes(c.f.STATUS) && c.f.CARD === a.card);
  else if (a.goal) hit = S.all().filter(c => OPEN.includes(c.f.STATUS) && c.f.GOAL === a.goal);
  else die('usage: hub-work sweep (--card <id> | --goal <id>) [--cancel|--stale] --reason "..."');
  const cancel = a.card ? !flag(a, 'stale') : flag(a, 'cancel');
  for (const c of hit) {
    c.f.LEASE = '';
    if (cancel) { c.f.STATUS = 'cancelled'; L.logLine(c, d, 'CANCELLED', reason); }
    else { c.f.STATUS = 'stale'; L.logLine(c, d, 'STALE', reason + '; plan it again before taking it'); }
    S.write(c);
  }
  say(hit.length ? `${cancel ? 'cancelled' : 'marked stale'}: ${hit.map(c => c.id).join(', ')}` : `no open work under ${a.card || a.goal}`);
};

// TICK. Time passes: dead leases return to planned, due retries become takeable, old plans go
// stale, and work that has waited on YOU for over two weeks is named for reassessment. It never
// touches outward work, because outward work waits for a person by design.
cmds.tick = (a) => {
  const d = a.date || today();
  const notes = [];
  for (const c of S.all()) {
    if (!OPEN.includes(c.f.STATUS)) continue;
    const l = leaseOf(c);
    if (c.f.STATUS === 'dispatched' && l && l.until <= now()) {
      c.f.STATUS = 'planned'; c.f.LEASE = '';
      L.logLine(c, d, 'RELEASED', `lease of ${l.runner} expired with no attempt reported`);
      notes.push(`${c.id}: lease of ${l.runner} expired, planned again`); S.write(c); continue;
    }
    if (c.f.STATUS === 'failed' && c.f['NEXT TRY'] && c.f['NEXT TRY'] <= d && c.f.OUTWARD !== 'yes' && attemptsOf(c) < maxOf(c)) {
      notes.push(`${c.id}: retry due (attempt ${attemptsOf(c) + 1} of ${maxOf(c)})`);
    }
    if (c.f.STATUS === 'failed' && (!c.f['NEXT TRY'] || attemptsOf(c) >= maxOf(c))) notes.push(`${c.id}: failed, attempts used up or outward; a person decides`);
    const lastEvent = c.log.length ? c.log[c.log.length - 1].date : c.f.FILED;
    const staleAfter = parseInt(c.f['STALE AFTER'] || '7', 10) || 7;
    if (['planned', 'attempted'].includes(c.f.STATUS) && L.daysBetween(lastEvent, d) >= staleAfter) {
      c.f.STATUS = 'stale';
      L.logLine(c, d, 'STALE', `${c.f.STATUS === 'attempted' ? 'attempted' : 'planned'} and nothing happened for ${L.daysBetween(lastEvent, d)} days`);
      notes.push(`${c.id}: stale after ${L.daysBetween(lastEvent, d)} days`); S.write(c); continue;
    }
    if (c.f.STATUS === 'blocked' && asNeeds(c.f.NEEDS) === 'person' && L.daysBetween(lastEvent, d) >= 14) notes.push(`${c.id}: waiting on you for ${L.daysBetween(lastEvent, d)} days; reassess whether it is still wanted, do not ask again the same way`);
    if (c.f.STATUS === 'blocked' && c.f.NEEDS.startsWith('capability:')) notes.push(`${c.id}: needs ${c.f.NEEDS.slice(11)}`);
  }
  if (flag(a, 'json')) { say(JSON.stringify(notes)); return; }
  say(notes.length ? notes.join('\n') : 'tick: nothing to move');
};

cmds.next = (a) => {
  const d = a.date || today();
  const rows = S.all().filter(c => (c.f.STATUS === 'planned' || (c.f.STATUS === 'failed' && c.f['NEXT TRY'] && c.f['NEXT TRY'] <= d && attemptsOf(c) < maxOf(c)))
    && c.f.OUTWARD !== 'yes' && c.f.NEEDS === 'none' && !leaseLive(c) && (!a.goal || c.f.GOAL === a.goal));
  if (flag(a, 'json')) { say(JSON.stringify(rows.map(c => Object.assign({ id: c.id }, c.f)))); return; }
  if (!rows.length) { say('nothing runnable now'); return; }
  for (const c of rows) say(`${c.id.padEnd(16)} ${c.f.STATUS.padEnd(9)} ${(c.f.KIND || 'do').padEnd(5)} ${c.f.WHAT}` + (c.f.GOAL ? `  [${c.f.GOAL}]` : ''));
};
cmds.list = (a) => {
  const rows = (flag(a, 'all') ? S.all() : S.all().filter(c => OPEN.includes(c.f.STATUS))).filter(c => (!a.goal || c.f.GOAL === a.goal) && (!a.status || c.f.STATUS === a.status));
  if (flag(a, 'json')) { say(JSON.stringify(rows.map(c => Object.assign({ id: c.id, log: c.log }, c.f)), null, 2)); return; }
  if (!rows.length) { say('no open work'); return; }
  for (const c of rows) say(`${c.f.STATUS.padEnd(10)} ${(c.f.KIND || 'do').padEnd(5)} ${c.id.padEnd(16)} ${(c.f.OWNER || '').padEnd(10)} ${c.f.WHAT}` + (c.f.NEEDS !== 'none' ? `  needs ${c.f.NEEDS}` : '') + (c.f.GOAL ? `  [${c.f.GOAL}]` : '') + (c.f.CARD ? `  {${c.f.CARD}}` : ''));
};
cmds.show = (a) => { const c = S.read(a._[0] || die('which item?')) || die('no such work'); say(S.render(c).trimEnd()); };
cmds.check = () => {
  const all = S.all();
  const problems = [];
  const keys = {};
  for (const c of all) {
    if (c.id !== c.f.ID) problems.push(`${c.id}: ID field says ${c.f.ID}`);
    if (!STATUSES.includes(c.f.STATUS)) problems.push(`${c.id}: STATUS ${c.f.STATUS}`);
    if (c.f.KIND && !KINDS.includes(c.f.KIND)) problems.push(`${c.id}: KIND ${c.f.KIND} (do or learn; an old card with none is do)`);
    if (!OWNERS.test(asOwner(c.f.OWNER || ''))) problems.push(`${c.id}: OWNER ${c.f.OWNER}`);
    if (!NEEDS.test(asNeeds(c.f.NEEDS || ''))) problems.push(`${c.id}: NEEDS ${c.f.NEEDS}`);
    if (!c.f['DONE WHEN']) problems.push(`${c.id}: no DONE WHEN`);
    if (c.f.STATUS === 'verified' && !c.log.some(l => l.event === 'VERIFIED')) problems.push(`${c.id}: verified without a VERIFIED line`);
    if (c.f.OUTWARD === 'yes' && ['dispatched', 'attempted', 'verified'].includes(c.f.STATUS) && !c.f.APPROVED) problems.push(`${c.id}: outward work moved without your approval on record`);
    if (OPEN.includes(c.f.STATUS)) { (keys[c.f.KEY] = keys[c.f.KEY] || []).push(c.id); }
  }
  for (const [k, ids] of Object.entries(keys)) if (ids.length > 1) problems.push(`key ${k} is open twice: ${ids.join(', ')}`);
  if (!problems.length) { say(`work check: ${all.length} item(s), no problems`); return; }
  for (const p of problems) say('PROBLEM ' + p);
  process.exit(1);
};
cmds.help = () => say(`hub-work: dispatched, attempted and verified are three different things

  file --what "..." --done-when "..." [--key K] [--goal G] [--card C] [--check "<shell, exit 0 when done>"]
       [--owner hub|person|company:<slug>] [--needs none|person|authorization|capability:<x>] [--outward yes|no]
       [--max-attempts 3] [--stale-after 7] [--source "..."]       a second file with the same open KEY files nothing
       [--kind do|learn]                a learn item is a question; its DONE WHEN must name a file the answer is written in
       [--learn "<question>" --path <file>]   sugar: KIND learn, WHAT the question, DONE WHEN "the answer ... is written in <file>"
  take <id> --runner <name> [--approved-by "<your words>"]         two-hour lease; outward only with your words
  attempt <id> --runner <name> --ok --result "..." | --failed "why"   failed: retry in 1, 2, 4 days, never outward
  verify <id> [--evidence "..."]     runs CHECK; verified only on exit 0, or on evidence a person observed
  block <id> --needs ... | unblock <id> --why ... [--approved-by "..."] | cancel <id> --why ...
  sweep --card <id> --reason "..."   your answer on a card cancels the work under it (or --stale)
  sweep --goal <id> [--cancel|--stale] --reason "..."   a goal changed; its work is re-planned
  tick [--date D] [--json]           dead leases, due retries, stale plans, waiting on you over two weeks
  link <id> --url https://...        the page a finished piece became; the note and the card hand it over
  next [--goal G] [--json] | list [--all] [--goal G] [--status S] [--json] | show <id> | check`);

const a = L.parseArgs(process.argv.slice(2));
L.alias(a, 'approved-by-him', 'approved-by');
const cmd = a._.shift() || 'help';
if (!cmds[cmd]) die(`unknown command ${cmd}; try help`);
cmds[cmd](a);
