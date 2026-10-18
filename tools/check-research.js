#!/usr/bin/env node
// check-research.js - did tonight's research for one goal leave work a reader can trust?
// Type it as `mc-check-research`.
//
// WHY. A research run that is only asked to be careful is careful on the first night. On
// 2026-08-07 a summary picked a story and invented a quote; the quote check caught it and threw
// the story away. So the shape of a night is checked by a program: a day record exists, the
// brief was rewritten, every person has a link, every claim has its source and the exact
// sentence, every opening has a closing date. With --fetch, every quote read tonight is looked
// for on its own page. mc-research sends a night that fails back once with these lines.
//
// Usage: mc-check-research --goal <id> [--date YYYY-MM-DD] [--godspeed DIR]
//                          [--mode daily|founding] [--before-people N] [--fetch]
'use strict';
const fs = require('fs');
const path = require('path');
const { blocks, limitOf, tidyRecords, RECORD_FIELDS } = require(path.join(__dirname, 'goals.js'));

function opt(name, dflt) { const i = process.argv.indexOf('--' + name); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt; }
const has = (name) => process.argv.includes('--' + name);
const ROOT = opt('godspeed', process.env.GODSPEED_ROOT || process.cwd());
const GOAL = opt('goal', '');
const DATE = opt('date', process.env.GODSPEED_TODAY || new Date().toISOString().slice(0, 10));
const MODE = opt('mode', 'daily');
const BEFORE = parseInt(opt('before-people', '-1'), 10);
if (!GOAL) { console.error('usage: mc-check-research --goal <id> [--date D] [--mode daily|founding] [--before-people N] [--fetch [--fetch-max N]]'); process.exit(2); }
const DIR = path.join(ROOT, 'goals', 'research', GOAL);
const read = (p) => { try { return fs.readFileSync(p, 'utf8').replace(/\r/g, ''); } catch (e) { return null; } };
const problems = [];
const notes = [];
if (!fs.existsSync(DIR)) { console.log(`PROBLEM no research folder at goals/research/${GOAL}; mc-goals research ${GOAL} makes it`); process.exit(1); }

const day = read(path.join(DIR, 'days', `${DATE}.md`));
if (day === null) problems.push(`days/${DATE}.md is missing: a night that writes no day record did not run`);
else {
  for (const h of ['## Searched', '## Found', '## Changed in the files']) if (!day.includes(h)) problems.push(`days/${DATE}.md has no "${h}" section`);
  if (day.split(/\s+/).filter(Boolean).length < 150) problems.push(`days/${DATE}.md is under 150 words: say what was searched, what was read and what it changed`);
}
const brief = read(path.join(DIR, 'brief.md'));
if (brief === null) problems.push('brief.md is missing');
else if (!new RegExp(`^UPDATED: ${DATE}$`, 'm').test(brief)) problems.push(`brief.md does not say UPDATED: ${DATE}; rewrite it from tonight's files`);
// The one reading of the limit that check-moves and the trial check share (goals.js limitOf).
if (brief !== null && /^STATUS: current$/m.test(brief) && !limitOf(brief)) {
  problems.push('brief.md has no LIMIT: line under ## The limit now; name the one thing that limits this goal now, from the claims and cases');
}

const URL_RE = /https?:\/\/\S+/;
// A quote is checked by its letters and digits only, so markup, punctuation and spacing on the
// page never decide it. A quote with fewer than 12 of them left (or none: QUOTE: "") would be
// found on any page at all, so it is a problem, never a pass (final review, 2026-10-13).
const norm = (s) => s.toLowerCase().replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
const quoteKey = (q) => norm(String(q).replace(/^"|"$/g, ''));
const MIN_QUOTE = 12;
const SPEC = {
  'people.md': ['PERSON', ['LINK', 'WHY', 'OFFER', 'STATUS'], { LINK: URL_RE, STATUS: /^(unverified|verified \d{4}-\d{2}-\d{2})$/ }],
  'cases.md': ['CASE', ['START', 'DID', 'RESULT', 'SOURCE'], { SOURCE: URL_RE }],
  'claims.md': ['CLAIM', ['STATUS', 'SOURCE', 'QUOTE', 'MEANS'], { SOURCE: URL_RE, STATUS: /^(supported|contested|refuted) \d{4}-\d{2}-\d{2}$/ }],
  'openings.md': ['OPENING', ['UNTIL', 'SOURCE', 'MOVE'], { SOURCE: URL_RE, UNTIL: /^\d{4}-\d{2}-\d{2}$/ }],
};
const parsed = {};
for (const [file, [key, required, shapes]] of Object.entries(SPEC)) {
  const text = read(path.join(DIR, file));
  if (text === null) { problems.push(`${file} is missing`); parsed[file] = []; continue; }
  const rows = blocks(text, key);
  parsed[file] = rows;
  // Records the program cannot read are named, with the form it reads (18 October 2026): a night
  // that wrote every person as one bullet line saw only "it holds 0" and did not know why.
  const loose = RECORD_FIELDS[file] ? tidyRecords(text, key, RECORD_FIELDS[file][1]) : null;
  if (loose && loose.after > rows.length) {
    problems.push(`${file}: ${loose.after - rows.length} of its records are not in the file's form, so they do not count. Write one field on a line, the record's first line "${key}: <name>", then ${RECORD_FIELDS[file][1].filter(f => f !== key).map(f => `"${f}: ..."`).join(', ')}, and a blank line between records; no bullets, bold or tables. mc-goals research ${GOAL} --tidy rewrites them in that form`);
  }
  const seen = new Set();
  for (const r of rows) {
    const name = r[key] || '(no name)';
    const low = name.toLowerCase();
    if (seen.has(low)) problems.push(`${file}: "${name}" is listed twice; keep one block and merge what the other knew`);
    seen.add(low);
    for (const k of required) if (!r[k]) problems.push(`${file}: "${name}" has no ${k}`);
    for (const [k, re] of Object.entries(shapes)) if (r[k] && !re.test(r[k])) problems.push(`${file}: "${name}" ${k} is "${r[k]}", which is not the form the file header names`);
    // A claim with no QUOTE at all is named above; any quote written is held to its length.
    if (r.QUOTE && quoteKey(r.QUOTE).length < MIN_QUOTE) {
      problems.push(`${file}: "${name}" quote too short to check: fewer than ${MIN_QUOTE} letters and digits (a to z, 0 to 9) are left of it, and that is found on any page; copy the whole sentence from the source, or remove the block`);
    }
  }
}
const people = parsed['people.md'].length;
if (MODE === 'daily' && BEFORE >= 0 && BEFORE < 100 && people - BEFORE < 5) problems.push(`people.md: the list holds ${people} of 100 and tonight added ${people - BEFORE} people; add at least five verified ones a night until it holds 100`);
if (MODE === 'founding' && BEFORE >= 0 && people < 30 && people <= BEFORE) problems.push(`people.md: a founding night must add people until the list holds 30; it holds ${people}`);

async function quotes() {
  // A quote too short to check is a problem already (above) and is never looked for on a page.
  const tonight = [...parsed['claims.md'], ...parsed['openings.md']].filter(r => r.SOURCE && r.SOURCE.includes(`(read ${DATE})`) && r.QUOTE && quoteKey(r.QUOTE).length >= MIN_QUOTE);
  // --fetch-max N: at most N pages are read, so the check's time is bounded (15 s a page) and the
  // nightly budget can reserve it; the rest are named, never silently passed.
  const maxArg = process.argv.indexOf('--fetch-max');
  const max = maxArg > 0 ? Number(process.argv[maxArg + 1]) : Infinity;
  if (Number.isFinite(max) && max >= 0 && tonight.length > max) {
    for (const r of tonight.slice(max)) notes.push(`${r.CLAIM ? 'claims.md' : 'openings.md'}: "${r.CLAIM || r.OPENING}" page not read again tonight (the check reads at most ${max} pages)`);
  }
  for (const r of tonight.slice(0, Number.isFinite(max) && max >= 0 ? max : undefined)) {
    const url = (r.SOURCE.match(URL_RE) || [''])[0];
    const name = r.CLAIM || r.OPENING;
    const file = r.CLAIM ? 'claims.md' : 'openings.md';
    const want = quoteKey(r.QUOTE).slice(0, 80);
    let body = null, why = '';
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(15000), headers: { 'user-agent': 'Mozilla/5.0 (research check)' } });
      if (res.ok && /text|html|json/.test(res.headers.get('content-type') || '')) body = await res.text(); else why = `HTTP ${res.status}`;
    } catch (e) { why = String(e.name || e.message || e); }
    if (body === null) { notes.push(`${file}: "${name}" page could not be read (${why}); the quote stays as the run wrote it`); continue; }
    if (!norm(body).includes(want)) {
      // A page that is a script shell or a login wall serves 200 and no readable text: that is a
      // page we cannot read, not a quote that is wrong.
      const visible = body.replace(/<(script|style|noscript)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]+>/g, ' ');
      const words = visible.split(/\s+/).filter(Boolean).length;
      if (words < 100 || /enable javascript|javascript is (required|disabled)/i.test(visible)) {
        notes.push(`${file}: "${name}" page served no readable text (${words} visible words); the quote stays as the run wrote it`);
        continue;
      }
    }
    if (!norm(body).includes(want)) problems.push(`${file}: "${name}" quote not found on its page (${url}); open the page again, copy the sentence exactly, or remove the block`);
  }
}

(async () => {
  if (has('fetch')) await quotes();
  for (const n of notes) console.log('NOTE ' + n);
  if (problems.length) { for (const p of problems) console.log('PROBLEM ' + p); process.exit(1); }
  console.log(`OK ${GOAL} ${DATE}`);
})();
