#!/usr/bin/env node
// tools/judge-brief.js  (installed as mc-judge-brief)
//
// The judge that decides what in a morning brief reaches you. It only cuts.
//
//   mc-judge-brief <file> [--history DIR] [--dry]
//
// Run it on the brief AFTER mc-check-brief passes and BEFORE the brief is sent. It rewrites
// the file in place (--dry only prints) and prints one line per decision.
//
// WHAT IT DOES
//   1. Every line you are handed to post, comment or send (a quoted line of five words or
//      more) is judged by your own assistant in a fresh, empty session, three times, with the
//      cocktail-party questions below. A line needs two passes out of three. Of each item it
//      keeps at most the best passing line; an item with none left goes, and the items after
//      it are numbered again. An assistant that cannot be reached cuts: an empty slot beats a
//      line nobody judged.
//   2. Every news paragraph with a link is checked against the briefs of the last 45 days:
//      the same story under another address goes. It goes only on a quote the program finds
//      word for word in that earlier brief, so a judge that misremembers cuts nothing.
//   3. After a cut, words that pointed at what was cut ("three things", "the post below")
//      are corrected, and the edit is kept only if it added no link, no line to post and no
//      item, and changed at most twelve words.
//
// WHY (2026-09-24). The author's own brief offered three LinkedIn lines that his AI, asked
// afterwards, called confusing and a pitch at once. It knew; nothing asked it before the
// send. A rule in a recipe is one of forty things a writer juggles. A judge asked one question
// in a clean session answers it. It runs in an empty folder so it sees nothing but the lines.
//
// WHICH ASSISTANT: the one mc-run would use on this machine (GODSPEED_RUNNER, then your
// ~/.godspeed/device.env, then hermes, claude, codex). GODSPEED_JUDGE_CMD, when set, is run
// instead with the prompt file as its last argument (for tests).
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const cb = require('./check-brief.js');

const QUESTIONS = [
  'You are a judge. Answer only what you are asked, in the exact format asked, and read no files.',
  '',
  'Social media is a cocktail party: you break into a group of strangers and say something nice',
  'and witty that they understand and that everybody can agree on. From there you strike up a',
  'conversation on the basis of being liked and trusted a little.',
  'Judge each line as a stranger on LinkedIn who does not know its author and sees the line with',
  "only what 'seen_with' says (a comment is read under the post it answers; a post appears alone):",
  '1. UNDERSTAND: with only that, would they get what is meant at once? They know nothing about the',
  '   author, their products, projects or earlier posts. Every "my AI", "theirs", "the country",',
  '   "the new one", product or event must be clear. A line that turns on how an AI works inside',
  '   (its search, memory, notes, files, hit rates) fails unless anyone gets it at once.',
  '   A confused mind always says no.',
  '2. LIKE: would they actually smile, laugh or nod? Not "it is clever": the bar is high. Insider',
  '   words (AGI, alignment, agents, memory, architecture) are not funny to strangers. A comment',
  '   that warmly and genuinely answers the question a post asks needs no joke.',
  '3. PITCH: does it read as marketing, "look at me, look at what I built"?',
  '4. BACKFIRE: could anyone read it as mocking a person or company, cynical, or tone-deaf',
  '   (children, money scandals, tragedy)? Would a reply thread turn against the author? Does it',
  '   make the author’s own AI, setup or work look broken, unreliable or embarrassing?',
  "5. TRUE: every specific claim about others (a number, a named event, what a named company or",
  "   person did) must appear in 'facts_given'. What the author says about their own life, and",
  '   common knowledge, passes.',
  '6. AGREE: would nearly everyone in that group nod along? No argument picked, no side taken',
  '   against someone, no contrarian "actually", nothing that starts a fight in the replies.',
  '7. SUBSTANCE: does it give them something? A concrete detail of their own experience, a real',
  '   number, a view they had not quite heard, or a joke that truly lands. A generic tip, a platitude,',
  '   a restatement of the post, or a polite question anyone could ask fails, however pleasant.',
  'A line passes only if it passes all seven.',
].join('\n');

function ask(prompt) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mc-judge-'));
  try {
    const pf = path.join(dir, 'prompt.txt');
    fs.writeFileSync(pf, prompt);
    let r;
    if (process.env.GODSPEED_JUDGE_CMD) {
      r = spawnSync(process.env.GODSPEED_JUDGE_CMD + ' "' + pf + '"', { shell: true, encoding: 'utf8', timeout: 600000 });
    } else {
      // An empty folder that looks like a mission control, holding only this recipe: the judge
      // starts clean, reads none of your files, and writes nothing into your folder.
      fs.mkdirSync(path.join(dir, 'rules'));
      fs.mkdirSync(path.join(dir, 'skills'));
      fs.writeFileSync(path.join(dir, 'skills', 'brief-judge.md'), 'Judge what follows. Answer with JSON only.\n');
      const out = path.join(dir, 'answer.txt');
      r = spawnSync('bash', [path.join(__dirname, 'mc-run'), 'brief-judge', '--godspeed', dir, '--cwd', dir,
        '--prompt-file', pf, '--out', out, '--timeout', '600'], { encoding: 'utf8', timeout: 660000 });
      if (fs.existsSync(out)) r.stdout = fs.readFileSync(out, 'utf8');
    }
    if (r.error || r.status !== 0 || !String(r.stdout || '').trim()) throw new Error('the assistant could not be reached');
    return String(r.stdout);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function jsonFrom(text) {
  const m = String(text).match(/\[[\s\S]*\]/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (e) { return null; }
}
const norm = s => String(s || '').replace(/[‘’“”"']/g, '').toLowerCase().split(/\s+/).filter(Boolean).join(' ');
const outsideLinks = s => String(s).replace(/https?:\/\/\S+/g, ' ');
const SOCIAL = /\b(post|repost|comment|linkedin|reply|dm|message|send (?:this|him|her|them)|x\.com|twitter)\b/i;
const COMMENT = /\b(comment|repost|reply|respond|under (?:his|her|their|the) post)\b/i;
const paragraphs = text => text.split(/\n\s*\n/);
const itemNo = p => { const m = p.match(/^\s*(\d)\.\s/); return m ? Number(m[1]) : null; };

function renumber(text) {
  let n = 0;
  const paras = paragraphs(text).map(p => (itemNo(p) !== null ? p.replace(/^\s*\d\./, String(++n) + '.') : p));
  let out = paras.join('\n\n');
  const words = { 1: 'One thing', 2: 'Two things', 3: 'Three things' };
  if (n) out = out.replace(/\b(?:One thing|Two things|Three things)(?= only you)/g, words[n]);
  else out = out.replace(/^.*\b(?:One thing|Two things|Three things) only you.*\n?/gm, '');
  return out.replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

function cutLines(text, keep) {
  const out = [];
  for (let p of paragraphs(text)) {
    const n = itemNo(p);
    if (n !== null && keep.has(n)) {
      const kept = keep.get(n);
      if (!kept.length) continue;
      for (const line of cb.postLines(p)) {
        if (kept.includes(line)) continue;
        p = p.split('\n').filter(r => !r.includes(line) || /^\s*\d\.\s/.test(r)).join('\n');
        p = p.split('"' + line + '"').join('').split('“' + line + '”').join('');
      }
      p = p.replace(/\bpick one (?:line|of them)\b,?\s*(?:and\s*)?/i, '');
    }
    out.push(p);
  }
  return renumber(out.join('\n\n'));
}

function socialReview(text, askFn, votes = 3) {
  const report = [];
  const items = paragraphs(text).filter(p => itemNo(p) !== null && cb.postLines(p).length && SOCIAL.test(p));
  if (!items.length) return { text, report };
  const table = items.map(p => {
    let around = outsideLinks(p);
    for (const l of cb.postLines(p)) around = around.split(l).join('');
    around = around.replace(/\s+/g, ' ').slice(0, 900);
    return { item: itemNo(p), lines: cb.postLines(p),
      seen_with: COMMENT.test(around) ? 'the post it answers, described as: ' + around : 'nothing: it appears alone in their feed',
      facts_given: around };
  });
  const prompt = QUESTIONS + '\n\nThe lines:\n' + JSON.stringify(table, null, 1) +
    '\n\nAnswer with a JSON list only, one entry per line, lines copied exactly: [{"item": 1, "line": "<exact line>", ' +
    '"understand": true, "like": true, "pitch": false, "backfire": false, "true": true, "agree": true, "substance": true, "why": "<one sentence>", "rank": 1}]. ' +
    'rank orders the passing lines of one item, 1 = best. Be the strict stranger, not the author.';
  const found = [];
  for (let i = 0; i < votes; i++) {
    let v = null;
    try { v = jsonFrom(askFn(prompt)); } catch (e) { v = null; }
    if (Array.isArray(v)) found.push(v);
  }
  const keep = new Map();
  for (const t of table) {
    const passing = [];
    for (const line of t.lines) {
      const vs = found.map(vote => vote.find(v => v && norm(v.line) === norm(line)));
      const oks = vs.map(v => !!v && v.understand === true && v.like === true && v.pitch === false &&
        v.backfire === false && v.true === true && v.agree === true && v.substance === true);
      const pass = oks.filter(Boolean).length >= 2;
      const why = (vs.find((v, i) => v && !oks[i]) || vs.find(Boolean) || {}).why ||
        (found.length ? 'no verdict' : 'your assistant could not be reached, so nothing unjudged goes out');
      report.push({ item: t.item, line, pass, votes: oks.filter(Boolean).length + ' of ' + found.length, why });
      if (pass) passing.push([-oks.filter(Boolean).length, vs.reduce((s, v, i) => s + (oks[i] ? Number(v.rank) || 99 : 99), 0), line]);
    }
    passing.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    keep.set(t.item, passing.slice(0, 1).map(x => x[2]));
  }
  return { text: cutLines(text, keep), report };
}

function newsReview(text, askFn, earlier, day) {
  const all = paragraphs(text);
  const paras = all.map((p, i) => [i, p]).filter(([, p]) => itemNo(p) === null && /https?:\/\//.test(p));
  if (!paras.length || !earlier.length) return { text, report: [] };
  const prompt = 'You are a judge. Answer only in the exact format asked, and read no files.\nToday is ' + day +
    '. Below are the news paragraphs of this morning\'s brief and every brief of the last 45 days. For each paragraph: ' +
    'was the same story (the same event, launch or finding, whatever the link) already in an earlier brief? A real new ' +
    'development of it is not the same story.\nAnswer with a JSON list only: [{"p": 0, "told": "2026-09-23" or null, ' +
    '"told_quote": "<at least six words copied exactly from that earlier brief>"}].\n\nPARAGRAPHS:\n' +
    JSON.stringify(paras.map(([i, p]) => ({ p: i, text: p })), null, 1) + '\n\nEARLIER BRIEFS:\n' +
    JSON.stringify(earlier.slice(-30).map(h => ({ date: h.date, brief: h.text.slice(0, 2600) })), null, 1);
  let verdicts = [];
  try { verdicts = jsonFrom(askFn(prompt)) || []; } catch (e) { verdicts = []; }
  const byDate = new Map(earlier.map(h => [h.date, norm(h.text)]));
  const judged = new Set(paras.map(([i]) => i));
  const drop = new Set();
  const report = [];
  for (const v of Array.isArray(verdicts) ? verdicts : []) {
    if (!v || !judged.has(v.p)) continue;
    const q = norm(v.told_quote);
    const told = v.told && q.split(' ').length >= 6 && (byDate.get(String(v.told)) || '').includes(q);
    if (told) drop.add(v.p);
    report.push({ p: v.p, told: told ? v.told : null });
  }
  if (!drop.size) return { text, report };
  return { text: all.filter((_, i) => !drop.has(i)).join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n', report };
}

function touchUp(before, after, askFn) {
  const kept = new Set(after.split('\n').map(l => l.trim()));
  const cut = before.split('\n').map(l => l.trim()).filter(l => l && !kept.has(l));
  if (!cut.length) return { text: after, why: 'nothing was cut' };
  const prompt = 'Parts of the message below were removed before sending. The removed parts:\n' +
    cut.slice(0, 40).map(c => '- ' + c).join('\n') + '\n\nEdit ONLY words in the message that now refer to something ' +
    'removed: a count that is now wrong ("two launches", "three things"), a word that points at a removed thing ' +
    '("answered", "the post below", "also"). Keep every other word, line break, link and quotation exactly as it is. ' +
    'Add nothing new. If nothing refers to a removed part, return the message unchanged. Answer with the full ' +
    'message only.\n\n' + after;
  let edited;
  try { edited = String(askFn(prompt) || '').replace(/^```\w*\n|\n```\s*$/g, '').trim() + '\n'; }
  catch (e) { return { text: after, why: 'the assistant could not be reached' }; }
  const links = t => (t.match(/https?:\/\/[^\s<>"\]]+/g) || []).sort().join('\n');
  const lines = t => cb.postLines(t).sort().join('\n');
  const nums = t => paragraphs(t).map(itemNo).filter(n => n !== null).join(',');
  if (!edited.trim() || links(edited) !== links(after) || lines(edited) !== lines(after) || nums(edited) !== nums(after)) {
    return { text: after, why: 'the edit changed a link, a line to post or an item; kept the brief as it was' };
  }
  const a = after.split(/\s+/), b = edited.split(/\s+/);
  // Changed words, counted as the edit distance between the two word lists.
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  const changed = d[a.length][b.length];
  if (changed > 12) return { text: after, why: 'the edit changed ' + changed + ' words; kept the brief as it was' };
  return { text: edited, why: 'edited ' + changed + ' word(s)' };
}

function judge(text, askFn, earlier, day) {
  const before = text;
  const news = newsReview(text, askFn, earlier, day);
  const social = socialReview(news.text, askFn);
  const touched = social.text === before ? { text: before, why: 'nothing was cut' } : touchUp(before, social.text, askFn);
  return { text: touched.text, news: news.report, social: social.report, touch_up: touched.why };
}

function main(argv) {
  const args = argv.slice(2);
  const hi = args.indexOf('--history');
  let dir = null;
  if (hi >= 0) { dir = args[hi + 1]; args.splice(hi, 2); }
  const dry = args.includes('--dry');
  const file = args.filter(a => a !== '--dry')[0];
  if (!file || !fs.existsSync(file)) {
    process.stderr.write('usage: mc-judge-brief <file> [--history DIR] [--dry]\n');
    return 2;
  }
  const named = (path.basename(file).match(/^(\d{4}-\d{2}-\d{2})/) || [])[1];
  const day = named || new Date().toISOString().slice(0, 10);
  if (!dir) dir = named ? path.dirname(file) : 'brief';
  const r = judge(fs.readFileSync(file, 'utf8'), ask, cb.history(dir, day), day);
  for (const s of r.social) console.log((s.pass ? 'kept   ' : 'CUT    ') + '"' + s.line + '" (' + s.votes + '): ' + s.why);
  for (const n of r.news) if (n.told) console.log('CUT    a news paragraph already told on ' + n.told);
  if (r.touch_up !== 'nothing was cut') console.log('after the cuts: ' + r.touch_up);
  if (!dry) fs.writeFileSync(file, r.text);
  return 0;
}

if (require.main === module) process.exit(main(process.argv));
module.exports = { judge, socialReview, newsReview, touchUp, cutLines, renumber };
