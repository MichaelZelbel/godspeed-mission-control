#!/usr/bin/env node
'use strict';
require('./test-guard.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const {spawnSync} = require('child_process');
const DATE = '2026-10-11', GOAL = 'write-the-first-draft', LEARN = 'W-20261011-02', APPLY = 'W-20261011-04';
function fixture(t, fields = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-apply-target-'));
  t.after(() => fs.rmSync(root, {recursive:true, force:true}));
  fs.mkdirSync(path.join(root, 'rules'));
  const write = (file, text) => { const full = path.join(root, file); fs.mkdirSync(path.dirname(full), {recursive:true}); fs.writeFileSync(full, text); };
  write(`goals/${GOAL}.md`, `ID: ${GOAL}\nKIND: outcome\nSTATUS: adopted\nLEAD: draft words | total | wc -w drafts/story.md\n\n## Log\n- ${DATE} READ 0 (draft word count)\n`);
  write(`routines/next-action/${DATE}/attention.txt`, `active:\n  ${GOAL} outcome deadline in seven days\nquiet today:\n`);
  const card = {...{ID:APPLY, STATUS:'blocked', KIND:'do', KEY:'apply-write-first-draft', GOAL, WHAT:'Write a first draft', CHECK:'test -s drafts/story.md', OWNER:'godspeed', NEEDS:'authorization', OUTWARD:'yes', FILED:DATE}, ...fields};
  write(`work/${card.ID}.md`, Object.entries(card).filter(([,v]) => v !== null).map(([k,v]) => `${k}: ${v}`).join('\n') + '\n\n## Log\n');
  const moves = `### 1. Write a first draft\nAPPLY: ${card.ID}\nGOAL: ${GOAL}\nBET: 0 -> 200\nWHERE: drafts/story.md\nNOW: no draft\nAFTER: The prepared story text is ready to be saved as the first draft.\nWHO DID THIS: Ursula Le Guin, her public writing advice\nHOW IT LANDS: save the prepared story text\nUNDO: restore the previous draft\nPERMISSION: ship list\n`;
  const moveFile = `routines/next-action/${DATE}/moves.md`; write(moveFile, moves);
  const run = (script, args) => spawnSync(process.execPath, [path.join(__dirname, script), ...args], {encoding:'utf8', env:{...process.env, GODSPEED_ROOT:root, GODSPEED_TODAY:DATE}});
  return {root, card, run, check:() => run('check-moves.js', ['--godspeed',root,'--date',DATE,'--per-goal','1']), bets:() => run('goals.js',['bets','--moves',path.join(root,moveFile),'--date',DATE]), goal:() => fs.readFileSync(path.join(root,`goals/${GOAL}.md`),'utf8')};
}
function rejectedAtBoth(f, pattern) {
  const checked = f.check(); assert.equal(checked.status, 1, checked.stdout + checked.stderr); assert.match(checked.stdout, pattern);
  const recorded = f.bets(); assert.match(recorded.stdout, /0 bet\(s\) recorded/); assert.match(recorded.stdout, pattern);
  assert.doesNotMatch(f.goal(), / BET /);
}
test('the observed draft move cannot point at the idea-hunt learn item, even though its ID exists', t => {
  rejectedAtBoth(fixture(t, {ID:LEARN, KIND:'learn', KEY:'idea-hunt-story', WHAT:'Search for unused story ideas', CHECK:null, STATUS:'planned', NEEDS:'none', OUTWARD:'no'}), /KIND learn|must.*do/);
});
test('a valid same-goal draft action is accepted without granting its ship-list approval', t => {
  const f = fixture(t), file = path.join(f.root,`work/${APPLY}.md`), before = fs.readFileSync(file,'utf8');
  assert.equal(f.check().status,0); assert.match(f.bets().stdout,/1 bet\(s\) recorded/); assert.match(f.goal(),new RegExp(` BET ${APPLY} 0 -> 200`));
  assert.equal(fs.readFileSync(file,'utf8'),before);
  const take = f.run('work.js',['take',APPLY,'--runner','fixture','--date',DATE]);
  assert.notEqual(take.status,0); assert.match(fs.readFileSync(file,'utf8'),/^STATUS: blocked/m); assert.match(fs.readFileSync(file,'utf8'),/^NEEDS: authorization$/m); assert.doesNotMatch(fs.readFileSync(file,'utf8'),/^APPROVED:/m);
});
test('a valid action from another goal cannot supply this move or its bet', t => {
  rejectedAtBoth(fixture(t,{GOAL:'another-goal'}), /GOAL.*another-goal|belongs to another-goal/);
});
test('an action without its live-result check cannot supply a move bet', t => {
  rejectedAtBoth(fixture(t,{CHECK:null}), /CHECK/);
});
test('a ship-list move cannot reference a preparation item instead of its apply item', t => {
  rejectedAtBoth(fixture(t,{KEY:'make-draft'}), /KEY.*apply-/);
});
test('legacy action cards without KIND retain the existing do default', t => {
  const f = fixture(t,{KIND:null}); assert.equal(f.check().status,0); assert.match(f.bets().stdout,/1 bet\(s\) recorded/);
});
