#!/usr/bin/env node
// Test for tools/judge-brief.js with stand-in judges: no assistant is called.
// Run: node tools/test-judge-brief.js
'use strict';
const j = require('./judge-brief.js');
let failures = 0;
function check(name, ok, detail) {
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name);
  if (!ok) { failures++; console.log('  ' + String(detail || '').split('\n').join('\n  ')); }
}
const say = verdicts => () => JSON.stringify(verdicts);
const good = { understand: true, like: true, pitch: false, backfire: false, true: true };
const bad = Object.assign({}, good, { like: false, why: 'a pitch' });

const BRIEF = 'Morning.\n\nThree things only you can move today:\n\n1. Cancel the mailboxes.\n\n' +
  '2. Pick one line, post it on LinkedIn:\n"My AI has earned its way in slowly, unlike the new one."\n' +
  '"Somewhere, a CFO just fainted over this one."\n"Europe writes the rulebook while others speedrun the game ;-)"\n\n' +
  '3. Reply keep or drop.\n\nThat is the morning.\n';
const L1 = 'My AI has earned its way in slowly, unlike the new one.';
const L2 = 'Somewhere, a CFO just fainted over this one.';
const L3 = 'Europe writes the rulebook while others speedrun the game ;-)';
const V = [Object.assign({ item: 2, line: L1 }, bad), Object.assign({ item: 2, line: L2, rank: 2 }, good),
  Object.assign({ item: 2, line: L3, rank: 1 }, good)];

let r = j.socialReview(BRIEF, say(V));
check('a failing line is cut and only the best passing line stays',
  !r.text.includes('earned its way') && r.text.includes('speedrun') && !r.text.includes('CFO'), r.text);
check('the rest of the brief is untouched', r.text.includes('1. Cancel') && r.text.includes('3. Reply') &&
  r.text.includes('That is the morning.'), r.text);

r = j.socialReview(BRIEF, say(V.map(v => Object.assign({}, v, bad))));
check('no passing line: the item goes and the items are renumbered',
  !r.text.includes('LinkedIn') && r.text.includes('2. Reply') && r.text.includes('Two things only you'), r.text);

r = j.socialReview(BRIEF, () => { throw new Error('offline'); });
check('an assistant that cannot be reached cuts every line to post',
  !r.text.includes('LinkedIn') && r.report.every(x => !x.pass), JSON.stringify(r.report));

const votes = [V, V.map(v => Object.assign({}, v, bad)), V];
let k = 0;
r = j.socialReview(BRIEF, () => JSON.stringify(votes[k++]));
check('two of three votes pass a line', r.text.includes('speedrun') && r.report.some(x => x.votes === '2 of 3'),
  JSON.stringify(r.report));

const EARLIER = [{ date: '2026-09-23', text: 'Anthropic put out Claude Opus 5.5, matching the top model for less.\nhttps://a.example/opus\n' }];
const NEWS = 'Thursday.\n\nClaude Opus 5.5 is out, matching the top model for less money.\nhttps://b.example/opus-again\n\n1. Cancel.\n';
r = j.newsReview(NEWS, say([{ p: 1, told: '2026-09-23', told_quote: 'Anthropic put out Claude Opus 5.5, matching the top model' }]),
  EARLIER, '2026-09-24');
check('the same story under another link goes, on a quote found in the earlier brief', !r.text.includes('Opus'), r.text);
r = j.newsReview(NEWS, say([{ p: 1, told: '2026-09-23', told_quote: 'Opus 5.5 was already in the brief yesterday for sure' }]),
  EARLIER, '2026-09-24');
check('a quote the earlier brief never had cuts nothing', r.text.includes('Opus'), r.text);

const BEFORE = 'Two model launches this week.\n\nxAI shipped Grok.\nhttps://x.example/grok\n\n' +
  'OpenAI answered with GPT-6.\nhttps://o.example/gpt6\n';
const AFTER = 'Two model launches this week.\n\nOpenAI answered with GPT-6.\nhttps://o.example/gpt6\n';
const FIXED = AFTER.replace('Two model launches', 'One model launch').replace('answered with', 'shipped');
let t = j.touchUp(BEFORE, AFTER, () => FIXED);
check('after a cut, the words pointing at it are corrected', t.text.trim() === FIXED.trim(), t.why);
t = j.touchUp(BEFORE, AFTER, () => FIXED + 'See also https://new.example\n');
check('an edit that adds a link is refused', t.text === AFTER, t.why);
t = j.touchUp(BEFORE, AFTER, () => 'An entirely new text written from scratch with many more words than a small fix ' +
  'would ever need to change.\n' + AFTER);
check('an edit that rewrites much is refused', t.text === AFTER, t.why);

process.exit(failures ? 1 : 0);
