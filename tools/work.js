#!/usr/bin/env node
'use strict';
//
// work.js - what your mission control decided to do, tracked from planned to verified, so a job is not lost
// between sessions, not run twice when something fires twice, and never called done because a
// model said it was done. Type it as `mc-work`.
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
//  - A STANDING PERMISSION (2026-10-12). Outward work filed with `--may <kind>` rides on a MAY line
//    the person's own words put on its goal card (`mc-goals allow`). In notice mode it goes out at
//    its GOES OUT time unless the person stops it first (`stop`); in alone mode when it is ready.
//    Past the kind's weekly limit it is filed blocked, needing a fresh yes. A permission taken off
//    the card stops everything still queued under it. GOES OUT is UTC, written YYYY-MM-DDTHH:MM.
//  - SHOWN BEFORE IT GOES (2026-10-13). The person can stop only a step they saw, and they see
//    the day's steps in one morning message. So a notice step goes out only once `announce` has
//    marked it ANNOUNCED (the morning message showed it) on or before its day. One filed after
//    the morning message, or never shown, moves to the next day's 18:00 UTC instead of going
//    out unseen. A step that later got a yes for itself was seen by definition.
//
// The folder it owns:
//   work/<ID>.md      one item each
//   work/README.md    the format, for you

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const L = require(path.join(__dirname, 'mc-cards.js'));

const GODSPEED = L.godspeedRoot(__filename);
const DIR = path.join(GODSPEED, 'work');
const STATUSES = ['planned', 'dispatched', 'attempted', 'verified', 'failed', 'blocked', 'stale', 'cancelled'];
const OPEN = ['planned', 'dispatched', 'attempted', 'failed', 'blocked', 'stale'];
// WHO OWNS AN ITEM. `godspeed` is your assistant, `person` is you, `company:<slug>` is a group of
// agents you set up to do one job. `him`, `her`, `them`, `me` and `you` are all accepted and
// stored as `person`, because an older note of yours should keep running.
const OWNERS = /^(godspeed|person|company:[a-z0-9-]+)$/;
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
  'LEASE', 'NEXT TRY', 'STALE AFTER', 'FILED', 'SOURCE', 'RESULT', 'LINK', 'APPROVED', 'MAY', 'GOES OUT', 'ANNOUNCED'];
const S = L.store(DIR, ORDER);
const { die, say, oneLine, flag, today, q } = L;
const now = () => (process.env.GODSPEED_NOW || new Date().toISOString());
const cmds = {};

// ---------------------------------------------------------------------------
// standing permissions: read from the goal card through goals.js, so the MAY line has one parser
// ---------------------------------------------------------------------------
// goals.js is loaded only when a permission is needed, so everything else here keeps working on a
// computer where it is not installed; there, a step on a standing permission does not go out.
let goalsJs;
function goalsLib() {
  if (goalsJs === undefined) { try { goalsJs = require(path.join(__dirname, 'goals.js')); } catch (e) { goalsJs = null; } }
  return goalsJs;
}
// The standing permissions a goal's steps go out under, { holder, lines } (goals.js standingOf):
// the goal's own MAY lines, or, for a strategy or project with none, those of the first outcome on
// its SERVES line that has some; holder is the goal whose card carries them, where the weekly limit
// is counted (2026-10-13). null when the goal has no card, or goals.js is not here.
const standings = {};
function standing(goal) {
  const g = goalsLib();
  if (!g || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(String(goal || ''))) return null;
  if (!(goal in standings)) {
    const p = path.join(GODSPEED, 'goals', `${goal}.md`);
    standings[goal] = g.standingOf ? g.standingOf(GODSPEED, goal)
      : fs.existsSync(p) ? { holder: goal, lines: L.readText(p).split('\n').map(g.parseMay).filter(Boolean) } : null;
  }
  return standings[goal];
}
function goalMay(goal) { const st = standing(goal); return st ? st.lines : null; }
// A CHECK THAT LOOKS AT NOTHING CHECKS NOTHING (final review, 2026-10-13). A step that goes out
// without a yes each time is verified by its CHECK, and `true`, `:`, `exit 0`, `true;` or `echo ok`
// pass whatever happened. So the check must hold at least one command that looks at something:
// any command but the ones below, and test or [ ] only when it tests a file or a value that comes
// from a command or a variable. sh -c '...' and bash -c '...' are read inside.
const NO_LOOK = new Set(['true', 'false', ':', 'exit', 'return', 'echo', 'printf', 'sleep', 'cd', 'pwd', 'export', 'set', 'unset', 'wait', '/bin/true', '/usr/bin/true', '/bin/false']);
function looksAtSomething(check) {
  return String(check || '').split(/;|&&|\|\||\||&|\n/).some(segment => {
    const seg = segment.trim().replace(/^[({!\s'"]+|[)}\s'"]+$/g, '');
    const words = seg.split(/\s+/).filter(Boolean);
    while (words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[0])) words.shift();
    const cmd = words[0] || '';
    if (!cmd || NO_LOOK.has(cmd)) return false;
    if (/^(?:ba)?sh$/.test(path.basename(cmd)) && words[1] === '-c') return looksAtSomething(words.slice(2).join(' '));
    if (/^(?:test|\[|\[\[)$/.test(cmd)) return /\$|\s-(?:[efsdrwxLhpSbcgukOGN]|nt|ot|ef)\s/.test(` ${seg} `);
    return true;
  });
}
const isStanding = (c) => /^standing /.test(c.f.APPROVED || '');
const standingText = (m) => `standing ${m.kind}: "${m.words}"`;
// The permission this item was filed under is still on its goal card: the same kind, in the same
// words, given on or before the day the item was filed. A permission taken back and given again
// in other words, or later, does not carry a step queued before it (review, 2026-10-13).
function standingHolds(c) {
  const lines = c.f.MAY ? goalMay(c.f.GOAL) : null;
  return !!lines && lines.some(m => m.kind === c.f.MAY && c.f.APPROVED === standingText(m) && (c.f.FILED || '') >= m.date);
}
// Statuses in which a standing item could still go out on its permission.
const MAY_SEND = ['planned', 'dispatched', 'stale', 'failed'];
// Statuses in which a step has not gone out yet, so `stop` can still keep it back.
const UNSENT = ['planned', 'blocked', 'stale', 'failed'];
const nowMinute = () => now().slice(0, 16);
const GOES_OUT_FORM = /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/;
// Not yet due: a GOES OUT still ahead, or one that is not in its form (edited by hand, say
// "2026-09-13 18:00"), which is never read as due; check names it (review, 2026-10-13).
const goesOutBad = (c) => !!c.f['GOES OUT'] && !GOES_OUT_FORM.test(c.f['GOES OUT']);
const notYetDue = (c) => !!c.f['GOES OUT'] && (goesOutBad(c) || c.f['GOES OUT'] > nowMinute());
// The default time a notice step goes out: 18:00 UTC on the day it was filed, or the next 18:00
// UTC when that has already passed, so the person always has the day to stop it.
function defaultGoesOut(d) {
  const n = nowMinute();
  let day = d;
  if (`${day}T18:00` <= n) { day = n.slice(0, 10); if (`${day}T18:00` <= n) day = L.addDays(day, 1); }
  return `${day}T18:00`;
}
// SHOWN BEFORE IT GOES (Rulings 19 and 21, 2026-10-13). A notice step on a standing yes goes out
// only once the morning message showed it: ANNOUNCED on or before the day of its GOES OUT. A step
// with a yes of its own (unblock --approved-by) was seen by the person who gave it.
const needsShowing = (c) => !!c.f['GOES OUT'] && isStanding(c);
const shown = (c) => L.isoDate(c.f.ANNOUNCED) && !goesOutBad(c) && c.f.ANNOUNCED <= c.f['GOES OUT'].slice(0, 10);
const unshown = (c) => needsShowing(c) && !shown(c);
// The next day's 18:00 UTC after a GOES OUT that passed unseen, and never one already past.
function laterSlot(goesOut) {
  const n = nowMinute();
  let day = L.addDays(goesOut.slice(0, 10), 1);
  if (n.slice(0, 10) > day) day = n.slice(0, 10);
  if (`${day}T18:00` <= n) day = L.addDays(day, 1);
  return `${day}T18:00`;
}
// A planned step whose time passed before anyone was shown it does not sit there overdue: it moves
// to the next day's 18:00 UTC, so the next morning message shows it. Run by tick, and lazily by
// going-out, next, announce and stop --today, so it never sits stale. dry: say, write nothing.
function moveUnshown(d, dry) {
  const moved = [];
  for (const c of S.all()) {
    if (c.f.STATUS !== 'planned' || !unshown(c) || goesOutBad(c) || c.f['GOES OUT'] > nowMinute() || !standingHolds(c)) continue;
    const at = laterSlot(c.f['GOES OUT']);
    moved.push({ id: c.id, at });
    if (dry) continue;
    c.f['GOES OUT'] = at;
    L.logLine(c, d, 'NOT', `SHOWN: goes out ${at} instead`);   // reads "NOT SHOWN: goes out ... instead"
    S.write(c);
  }
  return moved;
}
// Every step that goes out on a day, numbered once for the whole day: a step that went out or was
// stopped keeps its number, so "stop 2" in the afternoon means the same step as the 2 in the
// morning message. The steps the morning message showed come first, in time order, so one filed
// after it is numbered after them and moves no shown step's number.
function dayList(d) {
  const rank = (c) => (needsShowing(c) && !shown(c) ? 1 : 0);
  return S.all().filter(c => !goesOutBad(c) && (c.f['GOES OUT'] || '').slice(0, 10) === d)
    .sort((x, y) => rank(x) - rank(y) || x.f['GOES OUT'].localeCompare(y.f['GOES OUT']) || x.id.localeCompare(y.id))
    .map((c, i) => ({ n: i + 1, c }));
}
// THE COMING STEPS, WHEREVER THE PERSON LIVES (2026-10-13, final review I8). going-out, announce
// and stop --today used today's UTC date. Where the morning message comes after 18:00 UTC (7 am
// from about UTC+8 eastward), the day's steps were already filed for the next UTC day, so the
// message listed the passed day and the steps were never shown and never went out. And in Europe a
// step due at 18:00 UTC that the runner takes the next morning could no longer be stopped then.
// So, without --date:
//   - the steps are those of the next 18:00 UTC slot: the day of the next 18:00 UTC still ahead,
//     numbered as dayList numbers it, then the day after it, numbered on from there. That day
//     changes only at 18:00 UTC, when its steps go out, so "stop 2" means the same step all the
//     person's day, wherever they live;
//   - going-out lists those not gone out whose GOES OUT is within the next 24 hours;
//   - stop --today stops every step not gone out whose GOES OUT is within 24 hours of now, before
//     or after, so a step past its time that the runner has not taken yet is still stopped;
//   - announce marks the UTC date it ran on, the date GOES OUT is compared with (the routines set
//     GODSPEED_TODAY to the person's own date, which in the far east is a day ahead).
const DAY_MS = 24 * 3600 * 1000;
const minuteFrom = (ms) => new Date(Date.parse(now()) + ms).toISOString().slice(0, 16);
function slotDay() { const n = nowMinute(), d = n.slice(0, 10); return `${d}T18:00` > n ? d : L.addDays(d, 1); }
function comingList() {
  const slot = slotDay(), first = dayList(slot);
  return first.concat(dayList(L.addDays(slot, 1)).map(r => ({ n: r.n + first.length, c: r.c })));
}

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
  const owner = asOwner(oneLine(a.owner || 'godspeed'));
  if (!OWNERS.test(owner)) die('--owner must be godspeed, person or company:<slug>');
  let needs = asNeeds(oneLine(a.needs || 'none'));
  if (!NEEDS.test(needs)) die('--needs must be none, person, authorization or capability:<what is missing>');
  const outward = a.outward === 'yes' ? 'yes' : 'no';
  if (outward === 'yes' && needs === 'none') needs = 'authorization';
  if (owner === 'person' && needs === 'none') needs = 'person';
  const d = a.date || today();
  // UNDER A STANDING PERMISSION (2026-10-12): the goal card's MAY line for this kind is the yes,
  // up to its weekly limit. Counted are the steps filed on that permission in the seven days to
  // this one, not the ones stopped; past the limit the step waits for a fresh yes like any other.
  let may = null, goesOut = '', standingWords = '', overLimit = false, holder = null;
  if (a.may !== undefined) {
    const kindWanted = a.may === 'true' ? '' : oneLine(a.may);
    if (!kindWanted) die('--may needs the kind of step, as the goal card names it (mc-goals may <goal>)');
    if (outward !== 'yes') die('--may is for outward steps; inward work needs no permission');
    const goal = oneLine(a.goal);
    if (!goal) die('--may needs --goal: a standing permission belongs to a goal');
    const st = standing(goal);
    if (!st) die(`no goal card goals/${goal}.md to read a standing permission from` + (goalsLib() ? '' : ' (goals.js is not installed beside this program)'));
    const all = st.lines;
    const via = st.holder && st.holder !== goal ? ` (it has none of its own and uses those of ${st.holder}, the outcome it serves)` : '';
    may = all.find(m => m.kind === kindWanted);
    if (!may) die(`${goal} has no standing permission "${kindWanted}"${via}; its kinds are: ${all.map(m => m.kind).join(', ') || 'none'}`);
    holder = st.holder;
    // A step that goes out without a yes each time is checked live after it lands (and keeps
    // its UNDO, which mc-work-run enforces): the check is what verify runs.
    // A bare --check reads as the word true, which checks nothing, so it is refused too, and so is
    // any check that looks at nothing (true;, :;, exit 0, echo ok: see looksAtSomething).
    if (!oneLine(a.check) || oneLine(a.check) === 'true') die('--may needs --check "<shell that exits 0 when the step is live>": a step that goes out without a yes each time is checked live after it lands');
    if (!looksAtSomething(oneLine(a.check))) die(`--may needs a --check that looks at the live place (a page, a file, an API): "${oneLine(a.check)}" passes whatever happened, so it checks nothing`);
    // The limit belongs to the MAY line, so it is counted on the goal that holds it: a strategy's
    // steps and its outcome's own share the outcome's weekly limit (2026-10-13).
    const weekAgo = L.addDays(d, -6);
    const used = S.all().filter(w => w.f.MAY === may.kind && w.f.STATUS !== 'cancelled' && isStanding(w)
      && (w.f.GOAL === goal || (standing(w.f.GOAL) || {}).holder === holder)
      && (w.f.FILED || '') >= weekAgo && (w.f.FILED || '') <= d).length;
    if (used >= may.perWeek) overLimit = true;
    else {
      if (needs === 'authorization') needs = 'none';
      standingWords = standingText(may);
      if (may.mode === 'notice') {
        const at = a['goes-out'] === undefined ? '' : oneLine(a['goes-out']);
        if (a['goes-out'] !== undefined && !GOES_OUT_FORM.test(at)) die('--goes-out is YYYY-MM-DDTHH:MM in UTC, like 2026-10-13T18:00');
        if (at && at <= nowMinute()) die(`--goes-out ${at} UTC has already passed; a step that goes out unless stopped must leave time to stop it`);
        goesOut = at || defaultGoesOut(d);
      }
    }
  }
  const id = a.id ? L.safeId(a.id) : nextId(d);
  if (S.exists(id)) die(`${id} already exists`);
  const f = {
    ID: id, STATUS: needs === 'none' ? 'planned' : 'blocked', KIND: kind, KEY: key, GOAL: oneLine(a.goal), CARD: oneLine(a.card), WHAT: what, 'DONE WHEN': done,
    CHECK: oneLine(a.check), OWNER: owner, NEEDS: needs, OUTWARD: outward, ATTEMPTS: '0', 'MAX ATTEMPTS': String(parseInt(a['max-attempts'] || '3', 10) || 3),
    'STALE AFTER': String(parseInt(a['stale-after'] || '7', 10) || 7), FILED: d, SOURCE: oneLine(a.source || 'unknown'),
    APPROVED: standingWords, MAY: may ? may.kind : '', 'GOES OUT': goesOut,
  };
  const c = { id, f, log: [] };
  L.logLine(c, d, 'FILED', `by ${f.SOURCE}` + (f.GOAL ? ` for ${f.GOAL}` : '') + (f.CARD ? ` under card ${f.CARD}` : ''));
  const of = holder && holder !== f.GOAL ? ` of ${holder}` : '';
  if (f.STATUS === 'blocked') L.logLine(c, d, 'BLOCKED', overLimit
    ? `this week's ${may.perWeek} ${may.kind} steps${of} are used; this one needs a fresh yes`
    : `needs ${needs}`);
  S.write(c);
  const how = overLimit ? ` outward: this week's ${may.perWeek} ${may.kind} steps${of} are used, so this one needs a fresh yes`
    : standingWords && goesOut ? ` outward: goes out at ${goesOut} UTC unless stopped (standing ${may.kind}${of})`
    : standingWords ? ` outward: goes out when ready and is reported after (standing ${may.kind}${of})`
    : outward === 'yes' ? ' outward: never on its own' : '';
  say(`${id}: ${f.STATUS}` + (f.STATUS === 'blocked' ? ` (needs ${needs})` : '') + how);
};

cmds.take = (a) => {
  const c = S.read(a._[0] || die('usage: mc-work take <id> --runner <name> [--approved-by "<your words>"]')) || die('no such work');
  const runner = oneLine(a.runner);
  if (!runner) die('--runner is required: which harness on which machine');
  const d = a.date || today();
  if (!['planned', 'failed', 'stale', 'dispatched'].includes(c.f.STATUS)) die(`${c.id} is ${c.f.STATUS}; only planned, failed or stale work is taken`);
  if (c.f.STATUS === 'failed' && c.f['NEXT TRY'] && c.f['NEXT TRY'] > d && !flag(a, 'now')) die(`${c.id} retries on ${c.f['NEXT TRY']}, not before (a failure gets a gap, not a hammer)`);
  if (attemptsOf(c) >= maxOf(c) && !flag(a, 'now')) die(`${c.id} has used its ${maxOf(c)} attempts; a person decides what happens next`);
  const live = leaseLive(c);
  if (live && live.runner !== runner) die(`${c.id} is held by ${live.runner} until ${live.until}`);
  if (goesOutBad(c)) die(`${c.id} has GOES OUT "${c.f['GOES OUT']}", which is not YYYY-MM-DDTHH:MM (UTC); it does not go out until that is written right`);
  if (notYetDue(c) && !flag(a, 'now')) die(`${c.id} goes out at ${c.f['GOES OUT']} UTC unless stopped; not before`);
  if (isStanding(c) && !standingHolds(c)) die(`${c.id} was filed on the standing permission ${c.f.MAY || '(none named)'} of ${c.f.GOAL || 'its goal'}, which is no longer on the goal card in the words it was filed under; it waits for a fresh yes (unblock --approved-by)`);
  if (unshown(c)) die(`${c.id} has not been shown in a morning message, so the person could not stop it; it does not go out until it was (mc-work announce)`);
  if (c.f.OUTWARD === 'yes') {
    // Approved once is approved for this item: a yes already on record (from `unblock
    // --approved-by`) lets the runner take it, so a move the person said yes to actually lands
    // instead of waiting for someone to carry it out by hand (2026-09-24).
    const ok = oneLine(a['approved-by']);
    if (!ok && !c.f.APPROVED) die(`${c.id} is outward, so it reaches somebody else: it is taken only with --approved-by "<your words, as you said them>"`);
    if (ok) { c.f.APPROVED = `${d} ${q(ok)}`; L.logLine(c, d, 'APPROVED', q(ok)); }
  }
  const until = new Date(Date.parse(now()) + 2 * 3600 * 1000).toISOString();
  c.f.LEASE = `${runner} until ${until}`;
  c.f.STATUS = 'dispatched';
  L.logLine(c, d, 'DISPATCHED', `${runner}, lease until ${until}`);
  S.write(c);
  say(`${c.id}: dispatched to ${runner} until ${until}`);
};

cmds.attempt = (a) => {
  const c = S.read(a._[0] || die('usage: mc-work attempt <id> --runner <name> (--ok --result "..." | --failed "why")')) || die('no such work');
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
  say(`${c.id}: attempted, not yet verified (run: mc-work verify ${c.id})`);
};

cmds.verify = (a) => {
  const c = S.read(a._[0] || die('usage: mc-work verify <id> [--evidence "what was observed, where"]')) || die('no such work');
  if (!['attempted', 'dispatched', 'planned'].includes(c.f.STATUS)) die(`${c.id} is ${c.f.STATUS}`);
  const d = a.date || today();
  const ev = oneLine(a.evidence);
  if (c.f.CHECK) {
    const r = spawnSync(process.platform === 'win32' ? 'bash' : 'sh', ['-c', c.f.CHECK], { cwd: GODSPEED, encoding: 'utf8', timeout: 120000, env: Object.assign({}, process.env, { GODSPEED_ROOT: GODSPEED }) });
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
  if (c.f.OWNER === 'godspeed' && !c.f.CHECK && !/\b(saw|read|opened|screenshot|observed|https?:)/i.test(ev)) die('evidence for mc-owned work names what was observed or a link; "done" is not evidence');
  c.f.STATUS = 'verified'; c.f.LEASE = '';
  L.logLine(c, d, 'VERIFIED', `by observation: ${ev}`);
  S.write(c);
  say(`${c.id}: verified by observation`);
};

cmds.block = (a) => {
  const c = S.read(a._[0] || die('usage: mc-work block <id> --needs person|authorization|capability:<x>')) || die('no such work');
  const needs = asNeeds(oneLine(a.needs));
  if (!NEEDS.test(needs) || needs === 'none') die('--needs must be person, authorization or capability:<what>');
  const d = a.date || today();
  c.f.STATUS = 'blocked'; c.f.NEEDS = needs; c.f.LEASE = '';
  L.logLine(c, d, 'BLOCKED', `needs ${needs}` + (a.why ? `: ${oneLine(a.why)}` : ''));
  S.write(c);
  say(`${c.id}: blocked, needs ${needs}`);
};
cmds.unblock = (a) => {
  const c = S.read(a._[0] || die('usage: mc-work unblock <id> --why "..."')) || die('no such work');
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
  const c = S.read(a._[0] || die('usage: mc-work link <id> --url https://...')) || die('no such work');
  const url = oneLine(a.url);
  if (!/^https:\/\/\S+$/.test(url)) die('--url must be one https address a reader can open');
  const d = a.date || today();
  c.f.LINK = url;
  L.logLine(c, d, 'PUBLISHED', url);
  S.write(c);
  say(`${c.id}: link recorded`);
};

cmds.cancel = (a) => {
  const c = S.read(a._[0] || die('usage: mc-work cancel <id> --why "..."')) || die('no such work');
  if (!OPEN.includes(c.f.STATUS)) die(`${c.id} is ${c.f.STATUS}`);
  const why = oneLine(a.why);
  if (!why) die('--why is required');
  const d = a.date || today();
  c.f.STATUS = 'cancelled'; c.f.LEASE = '';
  L.logLine(c, d, 'CANCELLED', why);
  S.write(c);
  say(`${c.id}: cancelled (${why.slice(0, 80)})`);
};

// STOP. The person's word against a step that would go out unless stopped: one step by its id, or
// every step of the day that has not gone out yet. Their words are kept on each. A step that
// already went out cannot be stopped here, only undone.
function stopOne(c, d, words) {
  c.f.STATUS = 'cancelled'; c.f.LEASE = '';
  L.logLine(c, d, 'STOPPED', q(words));
  S.write(c);
  say(`${c.id}: stopped`);
}
cmds.stop = (a) => {
  const words = a.words === 'true' ? '' : oneLine(a.words);
  if (!words) die('--words is required: what the person said, as they said it');
  const d = a.date || today();
  if (flag(a, 'today')) {
    moveUnshown(today());
    // --date D: the steps of that UTC day. Without it: every step within 24 hours of now (above).
    const from = minuteFrom(-DAY_MS), to = minuteFrom(DAY_MS);
    const day = a.date ? dayList(a.date).map(r => r.c)
      : S.all().filter(c => !goesOutBad(c) && c.f['GOES OUT'] && c.f['GOES OUT'] >= from && c.f['GOES OUT'] <= to);
    const targets = day.filter(c => UNSENT.includes(c.f.STATUS));
    const going = day.filter(c => c.f.STATUS === 'dispatched');
    for (const c of targets) stopOne(c, d, words);
    for (const c of going) say(`${c.id} is going out right now; it cannot be stopped, only undone`);
    if (!targets.length && !going.length) say(a.date ? `nothing is waiting to go out on ${d}` : 'nothing is waiting to go out in the next 24 hours');
    return;
  }
  const c = S.read(a._[0] || die('usage: mc-work stop <id> --words "..." | stop --today --words "..."')) || die('no such work');
  if (c.f.STATUS === 'cancelled') { say(`${c.id}: already stopped`); return; }
  if (!UNSENT.includes(c.f.STATUS)) die(`${c.id} is ${c.f.STATUS}: ${c.f.STATUS === 'dispatched' ? 'it is going out right now' : 'it already went out'}, so it cannot be stopped, only undone`);
  stopOne(c, d, words);
};
// GOING OUT. The steps that go out on a day unless stopped, numbered (see dayList). A step that
// went out or was stopped is not listed, and the others keep the number they had. A step not yet
// shown in a morning message carries announced "" and is marked: it goes only once shown.
cmds['going-out'] = (a) => {
  moveUnshown(today());
  // --date D: the steps of that UTC day. Without it: the coming steps (comingList, above) that go
  // out within the next 24 hours.
  const to = minuteFrom(DAY_MS);
  const rows = (a.date ? dayList(a.date) : comingList().filter(r => r.c.f['GOES OUT'] <= to))
    .filter(r => ['planned', 'dispatched'].includes(r.c.f.STATUS));
  if (flag(a, 'json')) {
    say(JSON.stringify(rows.map(({ n, c }) => ({ n, id: c.id, at: c.f['GOES OUT'], what: c.f.WHAT, goal: c.f.GOAL || '', link: c.f.LINK || '', status: c.f.STATUS, announced: c.f.ANNOUNCED || '' }))));
    return;
  }
  if (!rows.length) { say(a.date ? `nothing goes out on ${a.date}` : 'nothing goes out in the next 24 hours'); return; }
  const utcToday = nowMinute().slice(0, 10);
  for (const { n, c } of rows) {
    const at = c.f['GOES OUT'], when = a.date || at.slice(0, 10) === utcToday ? at.slice(11) : `${at.slice(0, 10)} ${at.slice(11)}`;
    say(`${n}. ${c.f.WHAT} (${c.f.GOAL ? c.f.GOAL + ', ' : ''}${when} UTC)` + (c.f.STATUS === 'dispatched' ? ' going out now' : '')
      + (unshown(c) ? '; not shown in a morning message yet, so it waits until one has shown it' : ''));
  }
};
// ANNOUNCE. The morning message marks each step it showed, so it can go out at its time: the
// person saw it and could stop it. An id it cannot mark is named with the reason (exit 1).
cmds.announce = (a) => {
  const ids = a._;
  if (!ids.length) die('usage: mc-work announce <id> [<id>...] [--date D]: the steps the morning message showed');
  // ANNOUNCED is compared with the UTC date of GOES OUT, so it is the UTC date it ran on (above).
  const d = a.date || nowMinute().slice(0, 10);
  moveUnshown(today());
  let missed = 0;
  for (const id of ids) {
    const c = /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) ? S.read(id) : null;
    const why = !c ? 'no such work'
      : !UNSENT.includes(c.f.STATUS) ? `is ${c.f.STATUS}`
      : !c.f['GOES OUT'] ? 'has no GOES OUT (it goes out alone, or only with a yes of its own)'
      : goesOutBad(c) ? `has GOES OUT "${c.f['GOES OUT']}", not YYYY-MM-DDTHH:MM (UTC)` : '';
    if (why) { missed++; say(`${id}: ${why}, not marked`); continue; }
    c.f.ANNOUNCED = d;
    L.logLine(c, d, 'ANNOUNCED', 'in the morning message');
    S.write(c);
    say(`${c.id}: shown, goes out at ${c.f['GOES OUT']} UTC unless stopped`);
  }
  if (missed) process.exit(1);
};

// WENT OUT. A step of a kind the person allowed to go out alone is not shown before it goes; it is
// reported after (final review M1, 2026-10-13): the morning message lists the ones verified the day
// before. Notice steps are not listed: the morning message showed them before they went.
cmds['went-out'] = (a) => {
  const d = a.date || L.addDays(today(), -1);
  const rows = S.all().filter(c => isStanding(c) && c.f.MAY && !c.f['GOES OUT'] && c.f.STATUS === 'verified'
    && c.log.some(l => l.event === 'VERIFIED' && l.date === d));
  if (flag(a, 'json')) {
    say(JSON.stringify(rows.map(c => ({ id: c.id, what: c.f.WHAT, goal: c.f.GOAL || '', kind: c.f.MAY, link: c.f.LINK || '', verified: d }))));
    return;
  }
  if (!rows.length) { say(`nothing went out without asking on ${d}`); return; }
  for (const c of rows) say(`${c.id}: ${c.f.WHAT} (${c.f.GOAL ? c.f.GOAL + ', ' : ''}standing ${c.f.MAY})` + (c.f.LINK ? ` ${c.f.LINK}` : ''));
};

// SWEEP. Your answer on a card, or a change to a goal, reaches the work underneath it.
cmds.sweep = (a) => {
  const d = a.date || today();
  const reason = oneLine(a.reason || 'swept');
  let hit = [];
  if (a.card) hit = S.all().filter(c => OPEN.includes(c.f.STATUS) && c.f.CARD === a.card);
  else if (a.goal) hit = S.all().filter(c => OPEN.includes(c.f.STATUS) && c.f.GOAL === a.goal);
  else die('usage: mc-work sweep (--card <id> | --goal <id>) [--cancel|--stale] --reason "..."');
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
  const notes = moveUnshown(d).map(m => `${m.id}: not shown in a morning message, so it goes out at ${m.at} instead`);
  for (const c of S.all()) {
    if (!OPEN.includes(c.f.STATUS)) continue;
    const l = leaseOf(c);
    if (c.f.STATUS === 'dispatched' && l && l.until <= now()) {
      c.f.STATUS = 'planned'; c.f.LEASE = '';
      L.logLine(c, d, 'RELEASED', `lease of ${l.runner} expired with no attempt reported`);
      notes.push(`${c.id}: lease of ${l.runner} expired, planned again`); S.write(c); continue;
    }
    // A permission taken back: what was queued on it waits for a fresh yes instead of going out.
    if (['planned', 'stale', 'failed'].includes(c.f.STATUS) && isStanding(c) && !standingHolds(c)) {
      const why = `the standing permission ${c.f.MAY || '(none named)'} is no longer on ${c.f.GOAL || 'its goal'} in the words it was filed under; it needs a fresh yes`;
      c.f.STATUS = 'blocked'; c.f.NEEDS = 'authorization'; c.f.LEASE = '';
      L.logLine(c, d, 'BLOCKED', why);
      notes.push(`${c.id}: ${why}`); S.write(c); continue;
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
  // --dry-run (mc-work-run's own dry run) writes nothing: a step that passed its time unseen is
  // still left out, it is only not moved to the next day here.
  moveUnshown(today(), flag(a, 'dry-run'));
  const rows = S.all().filter(c => (c.f.STATUS === 'planned' || (c.f.STATUS === 'failed' && c.f['NEXT TRY'] && c.f['NEXT TRY'] <= d && attemptsOf(c) < maxOf(c)))
    && (c.f.OUTWARD !== 'yes' || (c.f.APPROVED && c.f.STATUS === 'planned')) && c.f.NEEDS === 'none' && !leaseLive(c) && (!a.goal || c.f.GOAL === a.goal)
    // a step that goes out unless stopped waits for its time (UTC) and for a morning message to
    // have shown it, and one whose standing permission was taken back does not go out on it at all
    && !notYetDue(c) && !unshown(c) && !(isStanding(c) && !standingHolds(c)));
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
    // A standing approval holds only while its MAY line is on the goal card: a permission taken
    // back must not keep sending.
    if (isStanding(c) && MAY_SEND.includes(c.f.STATUS)) {
      if (!c.f.MAY) problems.push(`${c.id}: a standing approval with no MAY kind; it cannot be traced to a permission on a goal card`);
      else if (!standingHolds(c)) problems.push(`${c.id}: its standing permission ${c.f.MAY} is no longer on ${c.f.GOAL || 'its goal'} in the words it was filed under; it must not go out on it`);
    }
    if (c.f['GOES OUT'] && !GOES_OUT_FORM.test(c.f['GOES OUT'])) problems.push(`${c.id}: GOES OUT ${c.f['GOES OUT']} is not YYYY-MM-DDTHH:MM (UTC)`);
    if (c.f.ANNOUNCED && !L.isoDate(c.f.ANNOUNCED)) problems.push(`${c.id}: ANNOUNCED ${c.f.ANNOUNCED} is not a date; the step does not go out until a morning message marks it`);
    if (OPEN.includes(c.f.STATUS)) { (keys[c.f.KEY] = keys[c.f.KEY] || []).push(c.id); }
  }
  for (const [k, ids] of Object.entries(keys)) if (ids.length > 1) problems.push(`key ${k} is open twice: ${ids.join(', ')}`);
  if (!problems.length) { say(`work check: ${all.length} item(s), no problems`); return; }
  for (const p of problems) say('PROBLEM ' + p);
  process.exit(1);
};
cmds.help = () => say(`mc-work: dispatched, attempted and verified are three different things

  file --what "..." --done-when "..." [--key K] [--goal G] [--card C] [--check "<shell, exit 0 when done>"]
       [--owner godspeed|person|company:<slug>] [--needs none|person|authorization|capability:<x>] [--outward yes|no]
       [--max-attempts 3] [--stale-after 7] [--source "..."]       a second file with the same open KEY files nothing
       [--kind do|learn]                a learn item is a question; its DONE WHEN must name a file the answer is written in
       [--learn "<question>" --path <file>]   sugar: KIND learn, WHAT the question, DONE WHEN "the answer ... is written in <file>"
       [--outward yes --goal G --may <kind> --check "<live check>" [--goes-out YYYY-MM-DDTHH:MM]]
                                        outward work on a standing permission of goal G (mc-goals allow; a strategy
                                        or project with none of its own uses its outcome's, and shares that
                                        outcome's weekly limit, mc-goals may G): its APPROVED
                                        quotes the person's words, and it must carry a CHECK that exits 0 once the
                                        step is live and looks at the live place (true, :, exit 0, echo ... are
                                        refused) (mc-work-run also needs its UNDO copy, before.txt, to call it
                                        done). It goes out only while that permission is on the card in the same
                                        words, given on or before the day it was filed. notice kind: goes out at
                                        GOES OUT unless stopped (a GOES OUT not in its form is never due);
                                        GOES OUT is UTC, default 18:00 UTC on the day it is filed (the next day once
                                        that has passed), and never a time already past. alone kind: goes out when
                                        ready. Past the kind's weekly limit it is filed blocked, needing a fresh yes
  take <id> --runner <name> [--approved-by "<your words>"]         two-hour lease; outward only with your words
                                        (or a standing permission still on its goal card); never before GOES OUT
  announce <id> [<id>...] [--date D]    the morning message showed these steps: ANNOUNCED. A notice step goes out
                                        only once shown (on or before its day), because the person can stop only
                                        what they saw; one never shown moves to the next day's 18:00 UTC (NOT SHOWN).
                                        ANNOUNCED is the UTC date it ran on, unless --date names one
  stop <id> --words "<their words>"     keeps one step back from going out (cancelled, STOPPED with the words)
  stop --today --words "..." [--date D] every step not gone out yet whose GOES OUT is within 24 hours of now,
                                        before or after (with --date: every one of that UTC day)
  going-out [--date D] [--json]         the steps that go out unless stopped, numbered (UTC times): those of the
                                        next 18:00 UTC slot's day, then the day after, that go out within the next
                                        24 hours (with --date: that UTC day). The shown ones first in time order,
                                        so "stop 2" means the same one until that slot's 18:00 UTC, wherever the
                                        person lives; JSON carries announced (its date, or "" when not shown yet)
  went-out [--date D] [--json]          the steps that went out alone on a standing permission and were verified
                                        on day D (default yesterday): what the morning message reports after
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
