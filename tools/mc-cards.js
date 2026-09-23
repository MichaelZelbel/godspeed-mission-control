'use strict';
//
// mc-cards.js - the one card format that goals.js, forecast.js and work.js all share.
//
// WHAT A CARD IS. One file. A block of `KEY: value` lines at the top, then a heading `## Log`
// and under it one dated line per thing that happened. Nothing else. A text editor repairs it,
// git can show you what changed in it, and any assistant can read it with no software at all.
// That is the whole reason the format is this plain: the programs here are a convenience, and
// the folder has to keep working on the day you stop using them.
//
// This file is a library, not a command. You never run it. It sits beside the three programs
// that do, and it holds the parser once so they cannot drift apart.
//
// WHERE IS MY MISSION CONTROL? `GODSPEED_ROOT` if it is set, else the first folder at or above the folder you
// are standing in that looks like a mission control (it has a `rules/` or an `observations/` folder), else
// Mission Control this machine was joined to, recorded in `~/.godspeed/device.env`. So typing one of these
// inside your mission control always works, and a job the schedule starts with almost no environment can
// still find the folder.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function isGodspeed(d) {
  return !!d && (fs.existsSync(path.join(d, 'rules')) || fs.existsSync(path.join(d, 'observations')));
}
function walkUp(from) {
  let d = from;
  for (let i = 0; i < 8; i++) {
    if (isGodspeed(d)) return d;
    const up = path.dirname(d);
    if (up === d) break;
    d = up;
  }
  return null;
}
function recordedGodspeed() {
  try {
    const home = process.env.HOME || process.env.USERPROFILE || '';
    const t = fs.readFileSync(path.join(home, '.godspeed', 'device.env'), 'utf8');
    const m = t.replace(/\r/g, '').match(/^[ \t]*(?:export[ \t]+)?GODSPEED_DIR=(.*)$/m);
    const d = m ? m[1].trim().replace(/^["']|["']$/g, '') : '';
    return isGodspeed(d) ? d : null;
  } catch (e) { return null; }
}
function godspeedRoot(fromFile) {
  if (process.env.GODSPEED_ROOT && isGodspeed(process.env.GODSPEED_ROOT)) return process.env.GODSPEED_ROOT;
  // These programs are installed OUTSIDE your mission control, so walking up from this file only finds one
  // on a machine where they happen to sit inside a mission control. The folder you are standing in is the
  // answer that works for a person typing the command; device.env is the answer for a schedule.
  return walkUp(process.cwd()) || walkUp(path.dirname(fs.realpathSync(fromFile))) || recordedGodspeed() || process.cwd();
}

const today = () => (process.env.GODSPEED_TODAY || new Date().toISOString().slice(0, 10));
const isoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
function addDays(iso, n) {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a, b) { return Math.round((new Date(b + 'T00:00:00Z') - new Date(a + 'T00:00:00Z')) / 86400000); }
function readText(p) {
  try { return fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n'); } catch (e) { return ''; }
}
const oneLine = (s) => String(s || '').replace(/\s+/g, ' ').trim();
const die = (m) => { process.stderr.write('ERROR: ' + m + '\n'); process.exit(1); };
const say = (s) => process.stdout.write(s + '\n');
// Somebody who pipes this into `head` closes the pipe early. That is not an error and it does
// not deserve a page of red text.
process.stdout.on('error', (e) => { if (e && e.code === 'EPIPE') process.exit(0); throw e; });

function parseArgs(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const v = (argv[i + 1] !== undefined && !String(argv[i + 1]).startsWith('--')) ? argv[++i] : 'true';
      o[k] = v;
    } else o._.push(a);
  }
  return o;
}
const flag = (a, k) => a[k] === 'true';
// An option that was renamed keeps answering to its old name, so a note you wrote for yourself
// last year still runs.
function alias(a, oldName, newName) { if (a[oldName] !== undefined && a[newName] === undefined) a[newName] = a[oldName]; }

// A card in memory: {id, f: {KEY: value}, log: [{date, event, rest}]}
function parseCard(text) {
  const [head, ...rest] = text.split(/^## Log\s*$/m);
  const f = {};
  for (const line of head.split('\n')) {
    const m = line.match(/^([A-Z][A-Z0-9 _-]*?):\s?(.*)$/);
    if (m && f[m[1].trim()] === undefined) f[m[1].trim()] = m[2].trim();
  }
  const log = [];
  for (const line of rest.join('## Log').split('\n')) {
    const m = line.match(/^- (\d{4}-\d{2}-\d{2}) (\S+)(?: (.*))?$/);
    if (m) log.push({ date: m[1], event: m[2], rest: m[3] || '' });
  }
  return { f, log };
}
function renderCard(c, order) {
  const keys = order.filter(k => c.f[k] !== undefined && c.f[k] !== '')
    .concat(Object.keys(c.f).filter(k => !order.includes(k) && c.f[k] !== ''));
  const head = keys.map(k => `${k}: ${c.f[k]}`).join('\n');
  const log = c.log.map(l => `- ${l.date} ${l.event}${l.rest ? ' ' + l.rest : ''}`).join('\n');
  return head + '\n\n## Log\n' + log + (log ? '\n' : '');
}
function safeId(id) {
  const s = String(id || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$/.test(s)) die(`"${s}" is not an id (letters, digits, dot, dash, underscore)`);
  return s;
}

// A store: one folder, one file per card. The folder's README.md is never a card, so the
// explanation of a folder can live inside it.
function store(dir, order) {
  const cardPath = (id) => path.join(dir, id + '.md');
  return {
    dir,
    path: cardPath,
    read(id) {
      const p = cardPath(safeId(id));
      if (!fs.existsSync(p)) return null;
      const c = parseCard(readText(p));
      c.id = id;
      return c;
    },
    write(c) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(cardPath(c.id), renderCard(c, order), 'utf8');
    },
    all() {
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).filter(f => f.endsWith('.md') && f !== 'README.md').sort()
        .map(f => { const c = parseCard(readText(path.join(dir, f))); c.id = f.replace(/\.md$/, ''); return c; })
        .filter(c => c.f.ID);
    },
    exists(id) { return fs.existsSync(cardPath(id)); },
    render(c) { return renderCard(c, order); },
  };
}
function logLine(c, date, event, rest) { c.log.push({ date, event, rest: oneLine(rest) }); }
const q = (s) => JSON.stringify(String(s || ''));

// WORDS THAT SHOULD NOT BE IN SOMETHING A PERSON READS. Two are built in and are about
// machinery leaking into a sentence: a long hexadecimal id, and a path to a folder on a server.
// The rest are yours. Put them in `rules/machine-words.txt` in your mission control, one per line. A plain
// word is matched whole and in either case; a line written between two slashes is a regular
// expression; a `#` starts a comment; anything after two or more spaces is the name this
// program uses when it finds one.
//
// It only ever WARNS, in `goals check`. These cards are read by your assistant, not sent to
// you, so a false alarm here must never be able to stop anything.
const BASE_MACHINE = [
  [/\b[0-9a-f]{12,}\b/i, 'a long hexadecimal id'],
  [/\/(?:root|home|srv|var|usr|etc|opt|tmp)\/[\w./-]+/, 'a path to a folder on a server'],
];
function machineWords(godspeed) {
  const out = BASE_MACHINE.slice();
  const text = readText(path.join(godspeed, 'rules', 'machine-words.txt'));
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/ {2,}/);
    const p = (parts[0] || '').trim();
    const label = (parts[1] || '').trim();
    if (!p) continue;
    try {
      let re;
      if (p.length > 2 && p.charAt(0) === '/' && p.lastIndexOf('/') > 0) {
        const end = p.lastIndexOf('/');
        re = new RegExp(p.slice(1, end), p.slice(end + 1) || 'i');
      } else {
        re = new RegExp('\\b' + p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
      }
      out.push([re, label || 'a word you asked it not to use']);
    } catch (e) { /* a line that is not a usable pattern is skipped, never fatal */ }
  }
  return out;
}

// ASKING THE PROGRAM NEXT DOOR. `goals` tells `work` and `forecast` when a goal changed. They
// are installed side by side, so next door is the first place to look. A sibling that is not
// there is NOT an error: the caller says so in its own output and carries on, because each of
// these three is useful without the other two.
function sibling(fromFile, godspeed, name) {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  const dirs = [
    path.dirname(fs.realpathSync(fromFile)),
    path.join(home, '.local', 'bin'),
    path.join(godspeed, 'agents', 'mc-cli'),
  ];
  for (const d of dirs) {
    const p = path.join(d, name + '.js');
    try { if (fs.statSync(p).isFile()) return p; } catch (e) { /* look in the next folder */ }
  }
  return null;
}
function runNode(fromFile, godspeed, name, args, env) {
  const bin = sibling(fromFile, godspeed, name);
  if (!bin) return { ok: false, missing: true, out: '', err: `${name} is not installed on this computer` };
  const r = spawnSync(process.execPath, [bin].concat(args), {
    encoding: 'utf8', env: Object.assign({}, process.env, { GODSPEED_ROOT: godspeed }, env || {}), timeout: 60000,
  });
  return { ok: r.status === 0, missing: false, out: r.stdout || '', err: r.stderr || '' };
}

module.exports = {
  godspeedRoot, today, isoDate, addDays, daysBetween, readText, oneLine, die, say, parseArgs, flag, alias,
  parseCard, renderCard, safeId, store, logLine, q, machineWords, sibling, runNode,
};
