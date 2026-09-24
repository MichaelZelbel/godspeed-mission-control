#!/usr/bin/env node
// tools/check-brief.js  (installed as mc-check-brief)
//
// Refuse a morning brief that sends the reader to a file instead of handing
// them the thing, that repeats what an earlier brief already told them, or
// that hands them a text to post without quotes a judge could find.
//
//   mc-check-brief <file>                a brief about to be written or sent ("-" = stdin)
//   mc-check-brief <file> --history DIR  the folder of earlier briefs (default: the file's
//                                        own folder when its name starts with a date, else brief/)
//
// Exit 1 and say exactly what to change when the text breaks one of the rules
// below. Exit 0, silent, when the brief is something a person on a phone can
// act on and has not read before.
//
// WHY. A brief that says "open skills/morning-brief/x.md and paste the text"
// reads fine on the computer where the file lives, and is a dead errand on a
// phone, in a chat app, or six months later on a machine the file never
// reached. The promise "no paths, the text rides inside the brief" was made
// in prose many times and broke every time, because prose is remembered by
// sessions and a script is not. This is the script.
//
// WHAT IT REFUSES:
//   path       anything that looks like a file location: lead/drafts/x.md,
//              /home/you/godspeed/..., C:\godspeed\...  A "Sources:" line is the one
//              exemption: provenance is allowed to name its file, because nobody
//              is asked to open it.
//   no link    "read it", "open the draft", "skim the thread" with no https
//              address anywhere in the same brief. An instruction to read
//              something must carry the something.
//   repeat     a link, or a line to post, that a brief from the last 45 days
//              already carried (the dated files in brief/). The same story told
//              twice wastes the one minute the brief has.
//   old name   the product's former three-letter name (h-u-b), used for your mission control.
//   unquoted   a text to post or send ("send this as is", "post it") with no
//              quoted line: mc-judge-brief finds the lines it judges by their
//              quotes, so a text without them would reach you unjudged.
//
// WHY THE LAST THREE (2026-09-24). The author's own morning brief repeated the
// same two stories on two mornings, offered three LinkedIn lines his own AI
// called confusing the moment he asked, and called his system by its former
// name, after about ten fixes written as rules in prose. Rules in a recipe are
// one of forty things a writer juggles; a script reads every brief.
//
// Links are stripped before matching paths, because a link is the fix, not the
// fault. The script never rewrites anything; it refuses, and the writer
// (usually your assistant, running the brief recipe) fixes the text.
'use strict';
const fs = require('fs');
const path = require('path');

const URL_RE = /https?:\/\/\S+/g;
const PATHISH = [
  /\b[\w.@-]+(?:\/[\w.@-]+)+\.[a-zA-Z0-9]{1,6}\b/,            // lead/drafts/x.md
  /(?<![\w/])\/(?:home|Users|var|etc|root|srv|opt|tmp)\/\S+/, // /home/you/...
  /\b[A-Za-z]:[\\/][\w\\/.~-]+/,                              // C:\godspeed\... C:/godspeed/...
];
const READ_THIS = /\b(read|open|skim)\s+(it|the\s+(draft|script|piece|post|page|file|thread|link))\b/i;
const QUOTED = /["\u201c]([^"\u201c\u201d]{25,}?)["\u201d]/g;
const READY = /\b(?:as is|as-is|ready to send|ready to post|post (?:it|this|one|a line)|paste (?:it|this)|send (?:him|her|them|this)|copy (?:it|this))\b/i;
// The former name as it was used for the product: "your", "my" or "the" before the word. A
// coworking one, or somebody else's product that ends in the word, is not ours.
const FORMER = /\b(?:your|my|the)\s+[Hh][Uu][Bb]\b/gi;
const DATED = /^(\d{4}-\d{2}-\d{2})/;
const HISTORY_DAYS = 45;

function linksOf(text) { return text.match(URL_RE) || []; }
function identity(u) {
  u = u.replace(/[.,;)]+$/, '');
  try {
    const x = new URL(u);
    const q = [...x.searchParams.entries()].filter(([k]) => !/^utm_/i.test(k) && !/^(fbclid|gclid)$/i.test(k)).sort();
    return x.hostname.replace(/^www\./, '').toLowerCase() + x.pathname.replace(/\/+$/, '') +
      (q.length ? '?' + new URLSearchParams(q).toString() : '');
  } catch (e) { return u; }
}
function postLines(text) {
  const out = [];
  for (const m of text.matchAll(QUOTED)) if (m[1].trim().split(/\s+/).length >= 5) out.push(m[1].trim());
  return out;
}
function words(s) {
  return new Set(String(s).toLowerCase().replace(/[^a-z0-9\u00e4\u00f6\u00fc\u00df ]+/g, ' ').split(/\s+/).filter(w => w.length > 3));
}
function similar(a, b) {
  const wa = words(a), wb = words(b);
  if (!wa.size || !wb.size) return false;
  let both = 0;
  for (const w of wa) if (wb.has(w)) both++;
  return both / (wa.size + wb.size - both) >= 0.7;
}
function items(text) {
  return text.split(/\n\s*\n/).filter(p => /^\s*\d\.\s/.test(p));
}

// Every earlier brief in `dir` from the HISTORY_DAYS before `day`, oldest first.
function history(dir, day) {
  if (!dir || !fs.existsSync(dir)) return [];
  const start = new Date(Date.parse(day) - HISTORY_DAYS * 86400000).toISOString().slice(0, 10);
  return fs.readdirSync(dir).map(n => [n, (n.match(DATED) || [])[1]])
    .filter(([n, d]) => d && d < day && d >= start && /\.(md|txt)$/.test(n)).sort()
    .map(([n, d]) => ({ date: d, text: fs.readFileSync(path.join(dir, n), 'utf8') }));
}

function repeats(text, earlier) {
  const faults = [];
  const seen = new Map();
  for (const h of earlier) for (const u of linksOf(h.text)) seen.set(identity(u), h.date);
  for (const u of linksOf(text)) {
    const d = seen.get(identity(u));
    if (d) {
      faults.push('REFUSED: the brief of ' + d + ' already carried this link:\n    ' + u.replace(/[.,;)]+$/, '') +
        '\n    Leave the story out, or tell what is new about it with a new source.');
    }
  }
  const old = [];
  for (const h of earlier) for (const l of postLines(h.text)) old.push([h.date, l]);
  for (const l of postLines(text)) {
    const hit = old.find(([, o]) => similar(l, o));
    if (hit) {
      faults.push('REFUSED: the brief of ' + hit[0] + ' already offered this line to post:\n    "' + l +
        '"\n    A line you did not post the first time is not better the second. Write a new one or none.');
    }
  }
  return faults;
}

function formerName(text) {
  const faults = [];
  text.split('\n').forEach((line, i) => {
    const bare = line.replace(URL_RE, '');
    for (const m of bare.matchAll(FORMER)) {
      faults.push('REFUSED, line ' + (i + 1) + ': "' + m[0] + '" was the former name of your mission control:\n    ' +
        line.trim() + '\n    Call it Mission Control.');
      return;
    }
  });
  return faults;
}

function unquoted(text) {
  return items(text).filter(p => READY.test(p.replace(URL_RE, '')) && !postLines(p).length).map(p =>
    'REFUSED: this item hands over a text to post or send without quotes:\n    ' + p.trim().split('\n')[0] +
    '\n    Put every text to post, comment or send in double quotes, each option on its own line,\n' +
    '    so mc-judge-brief can find and judge it.');
}

function check(text, earlier) {
  const faults = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    const bare = line.replace(URL_RE, '');
    if (bare.trim().replace(/^\*+/, '').toLowerCase().startsWith('sources:')) return;
    for (const re of PATHISH) {
      const m = bare.match(re);
      if (m) {
        faults.push(
          'REFUSED, line ' + (i + 1) + ': this sends the reader to a file on a machine:\n' +
          '    ' + line.trim() + '\n' +
          '    Put the full text to act on inside the brief itself. Where a file must\n' +
          '    exist, publish it and carry the address. A path is not something a phone\n' +
          '    can open.');
        return;
      }
    }
  });
  if (READ_THIS.test(text) && !/https?:\/\/\S+/.test(text)) {
    faults.push(
      'REFUSED: the brief says "' + text.match(READ_THIS)[0] + '" and carries nothing to ' +
      'read.\n    An instruction to read something must carry the thing or a link to it.');
  }
  return faults.concat(repeats(text, earlier || []), formerName(text), unquoted(text));
}

function main(argv) {
  const args = argv.slice(2);
  const hi = args.indexOf('--history');
  let dir = null;
  if (hi >= 0) { dir = args[hi + 1]; args.splice(hi, 2); }
  const arg = args[0];
  if (!arg) {
    process.stderr.write('usage: mc-check-brief <file> [--history DIR]   ("-" reads stdin)\n');
    return 2;
  }
  const text = arg === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(arg, 'utf8');
  const named = arg === '-' ? null : (path.basename(arg).match(DATED) || [])[1];
  const day = named || new Date().toISOString().slice(0, 10);
  if (!dir) dir = named ? path.dirname(arg) : 'brief';
  const faults = check(text, history(dir, day));
  if (!faults.length) return 0;
  process.stdout.write(faults.join('\n\n') + '\n');
  return 1;
}

if (require.main === module) process.exit(main(process.argv));
module.exports = { check, history, postLines, identity, similar, items, linksOf };
