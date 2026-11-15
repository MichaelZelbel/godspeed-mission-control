import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {createService} from '../server/main.mjs';

test('word matches and note reads complete while meaning search is still waiting',async()=>{
  const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-search-progressive-')));
  const note=store.save('notes',{title:'Tax Reporting',content:'The current filing plan. '+ 'Details '.repeat(300)});
  store.save('notes',{title:'Tax Reporting discarded',content:'Old filing plan.',is_trashed:true});
  const app=await createService({root:store.root,port:0}),base='http://127.0.0.1:'+app.address.port;
  const original=app.index.meaning;let release,started,meaningCalls=0;
  const began=new Promise(resolve=>{started=resolve;}),pending=new Promise(resolve=>{release=resolve;});
  app.index.meaning={ready:true,search:async()=>{meaningCalls++;started();return pending;}};
  try {
    const hybrid=fetch(base+'/api/search?q=Tax%20Reporting&types=notes');await began;
    const words=await(await fetch(base+'/api/search?q=Tax%20Reporting&types=notes&mode=words&format=notes',{signal:AbortSignal.timeout(2000)})).json();
    assert.equal(words.mode,'words');assert.equal(meaningCalls,1,'the word pass never asks AI');
    assert.equal(words.data.length,1);assert.equal(words.data[0].id,note.id);
    assert.equal(words.data[0].content,undefined,'a preview cannot stand in for editable text');
    assert.ok(words.data[0].content_preview.length<=800);assert.equal(words.data[0].updated_at,note.updated_at);
    const read=await(await fetch(base+'/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({table:'notes',filters:[['eq','id',note.id]],single:true}),signal:AbortSignal.timeout(2000)})).json();
    assert.equal(read.data.id,note.id);assert.equal(read.data.content,note.content);
    release([]);assert.equal((await(await hybrid).json()).mode,'words and meaning');
  }finally{release([]);app.index.meaning=original;await app.close();}
});

test('Exact word search adds compound matches without enabling AI',async()=>{
  const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-search-compound-')));
  const indexed=store.save('notes',{title:'Report checklist',content:'The ordinary report note.'});
  const compound=store.save('notes',{title:'Jahresreport',content:'The annual filing checklist.'});
  const app=await createService({root:store.root,port:0}),base='http://127.0.0.1:'+app.address.port;
  try{
    const first=await(await fetch(base+'/api/search?q=report&types=notes&mode=words&format=notes')).json();
    assert.equal(first.mode,'words');assert.ok(first.data.some(n=>n.id===indexed.id));assert.ok(!first.data.some(n=>n.id===compound.id));
    const expanded=await(await fetch(base+'/api/search?q=report&types=notes&mode=words&format=notes&expand=1')).json();
    assert.equal(expanded.mode,'words');assert.ok(expanded.data.some(n=>n.id===indexed.id));assert.ok(expanded.data.some(n=>n.id===compound.id));
    assert.equal(app.index.meaning?.ready??false,false);
  }finally{await app.close();}
});
