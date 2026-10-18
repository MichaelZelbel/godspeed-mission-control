import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createHash} from 'node:crypto';

// The deadline recipe as readers get it (18 October 2026). It was made from the author's own by
// replacing "his" with "the user's" everywhere, so it asked "What is true when tthe user's is
// finished?", said "he" for the reader, "Mission Control" with no "your", and sent the assistant to
// mc-day-dossier, a program readers do not have. Both shipped copies are plain English about "the
// person" now, and an unedited copy of an earlier text is still replaced on the next update.
const read=p=>fs.readFileSync(new URL(p,import.meta.url),'utf8').replaceAll('\r','');
const digest=text=>createHash('sha256').update(text).digest('hex');
const INSTALLED='\n\n## Installed personal workspace\n\n';

test('the deadline recipe reads as plain English about the person, in both shipped copies',()=>{
  const source=read('../reusable-recipes/due/SKILL.md'),packaged=read('../recipes/due/SKILL.md');
  assert.ok(packaged.startsWith(source+INSTALLED),'the packaged copy is its source plus the installed-workspace section');
  for(const [name,text] of [['source',source],['packaged',packaged]]){
    assert.match(text,/^---\nname: due\n/,name);
    assert.doesNotMatch(text,/tthe|Tthe/,name+': no "tthe user\'s"');
    assert.doesNotMatch(text,/\b(?:he|his|him)\b/i,name+': the person, never "he"');
    assert.doesNotMatch(text,/Mission Control/,name+': "your mission control", never Mission Control alone');
    assert.doesNotMatch(text,/mc-day-dossier|D-\d{3}|2026-08-29/,name+': no private command, decision number or date');
    assert.doesNotMatch(text,/[–—]/,name+': no long dashes');
    assert.match(text,/1\. \*\*What is true when this is finished\?\*\*/,name);
    assert.match(text.replace(/\s+/g,' '),/you told me you would like this done by <day>/,name);
    assert.match(text.replace(/\s+/g,' '),/a line starting `mission control:` \(or `godspeed:`\)/,name+': the capture line the reader\'s guide names');
  }
  const revisions=JSON.parse(read('../data/recipe-revisions.json'))['due/SKILL.md'];
  assert.ok(revisions.includes(digest(packaged)),'due ships a known revision');
  assert.ok(revisions.includes('44c5368ed4517df4b3922ee6862d23a9a7d548fad832a6252a35b3c0db83acc2'),'the garbled text shipped until today stays known, so an unedited copy is replaced');
});
