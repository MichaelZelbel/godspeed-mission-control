import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';

// The import's people step (enrich-people, limit 500) and the profile page's
// suggestions (generate-profile-suggestions) sent every note in one prompt:
// 16,000 notes on the real notebook, trashed ones included, which no model
// takes (7 October 2026). They send the newest visible, untrashed notes, at
// most the limit (500 at most), each cut short, and a bounded whole.
for(const name of ['enrich-people','generate-profile-suggestions'])test(name+' sends a bounded batch of the newest visible notes',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-enrich-batch-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root),query=new QueryService(store);let sent;
  const domains=new Domains(query,{provider:async request=>{sent=request.source;return {suggestions:[]};}});
  const long='Met Anna at the market. '.repeat(400),start=Date.parse('2026-01-01T00:00:00Z');
  store.transaction(view=>view.commit(Array.from({length:620},(_,i)=>{const at=new Date(start+i*60000).toISOString();return store.prepare('notes',{title:'Note '+i,content:i%50?'Short note '+i:long,created_at:at,updated_at:at,...(i===619?{is_trashed:true}:{}),...(i===618?{ai_visibility:'hidden'}:{})});})));
  await domains.invoke(name,name==='enrich-people'?{limit:500}:{});
  const titles=sent.notes.map(n=>n.title);
  assert.ok(sent.notes.length<=500&&sent.notes.length>0,'at most 500 notes, got '+sent.notes.length);
  assert.ok(!titles.includes('Note 619'),'no trashed note');
  assert.ok(!titles.includes('Note 618'),'no hidden note');
  assert.equal(titles[0],'Note 617','the newest first');
  assert.ok(sent.notes.every(n=>String(n.content).length<=4000),'each note is cut short');
  assert.ok(JSON.stringify(sent).length<=400000,'the whole prompt is bounded, got '+JSON.stringify(sent).length);
});

test('enrich-people honours a smaller limit',async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-enrich-limit-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const store=new Store(root),query=new QueryService(store);let sent;
  const domains=new Domains(query,{provider:async request=>{sent=request.source;return {suggestions:[]};}});
  for(let i=0;i<5;i++)store.save('notes',{title:'Note '+i,content:'About Anna '+i});
  await domains.invoke('enrich-people',{limit:2});
  assert.equal(sent.notes.length,2);
});
