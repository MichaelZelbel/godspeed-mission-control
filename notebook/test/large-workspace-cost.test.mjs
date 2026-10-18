import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {SearchIndex} from '../core/index/search.mjs';

// Measured on the test server after a full Menerio import: 15,900 records,
// 63 MB of record text. The decoded-record cache stopped at 16 MB, so two
// thirds of the vault were decoded, re-encoded and hashed again on every read,
// and every request the dashboard made cost a second of the server's only
// thread.
const root=()=>fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-large-'));

test('a vault larger than sixteen megabytes is read from the cache the second time',()=>{
  const store=new Store(root()),body='x'.repeat(250000);
  store.withLock(()=>store.commit(Array.from({length:40},(_,i)=>store.prepare('notes',{id:'large-'+i,title:'Large '+i,content:body}))));
  store.scan(true);
  assert.equal(store.decodedCache.size,40,'only '+store.decodedCache.size+' of 40 records stayed cached, so the rest are decoded again on every read');
});

test('a write updates the view it already holds instead of reading the whole vault again',()=>{
  const store=new Store(root());
  store.save('notes',{id:'one',title:'One',content:'start'});
  const reads=store.reads;
  // The dashboard's write path: one snapshot read, then the commit.
  store.withLock(()=>store.snapshot(()=>store.commit([store.prepare('notes',{content:'edited'},store.get('notes','one'))])));
  assert.equal(store.reads-reads,1,'a write read the whole vault '+(store.reads-reads)+' times; the one read before it is enough');
  // What the view holds must be exactly what a fresh read of the files finds,
  // the replaced version kept in the history included.
  const fresh=new Store(store.root);
  assert.equal(store.records.get('notes/one').content,'edited');
  assert.deepEqual(new Map([...store.records].sort()),new Map([...fresh.records].sort()));
  assert.ok([...fresh.records.values()].some(r=>r.type==='record_history'&&r.source_id==='one'&&r.snapshot.content==='start'),'the earlier version is kept in the history');
});

test('refreshing the search index after a save rewrites only what changed',async()=>{
  const store=new Store(root());
  store.withLock(()=>store.commit(Array.from({length:50},(_,i)=>store.prepare('notes',{id:'n'+i,title:'Note '+i,content:'body '+i}))));
  const index=new SearchIndex(store);
  try{
    const saved=store.save('notes',{id:'n7',content:'zimtschnecke'},store.get('notes','n7')._hash);
    index.update([store.records.get('notes/n7')]);
    const rows=[],replace=index.replace.bind(index);index.replace=documents=>{const n=replace(documents);rows.push(n);return n;};
    await index.rebuildBackground();
    assert.ok(rows.length===1&&Number.isInteger(rows[0])&&rows[0]<=1,'a background refresh after one save rewrote '+rows+' index rows');
    assert.ok(index.search('zimtschnecke').some(r=>r.id===saved.id),'the saved words stay findable');
    assert.equal(await index.rebuildBackground(),false,'a refresh with nothing new changes nothing');
    assert.equal(rows[1],0,'a refresh with nothing new writes nothing');
  }finally{index.close();}
});

// The open dashboard refetches its lists in bursts: a dozen requests at once,
// each of which read the whole vault, held the server for seven to nine
// seconds on the imported workspace, and a note save queued behind them.
test('a burst of dashboard reads reads the vault once and still sees another program\'s change',async()=>{
  const {createService}=await import('../server/main.mjs');
  const dir=root(),service=await createService({root:dir,port:0}),base='http://127.0.0.1:'+service.address.port;
  const select=async id=>(await(await fetch(base+'/api/query',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({table:'notes',filters:[['eq','id',id]],selection:'*',maybeSingle:true})})).json()).data;
  try{
    service.store.save('notes',{id:'burst',title:'Burst',content:'before'});
    await select('burst');const reads=service.store.reads;
    for(let i=0;i<10;i++)await select('burst');
    assert.ok(service.store.reads-reads<=1,'ten reads in a row read the whole vault '+(service.store.reads-reads)+' times');
    // Another program (the sync worker, the assistant) writes a record file.
    const other=new Store(dir);other.save('notes',{id:'burst',content:'changed elsewhere'},other.get('notes','burst')._hash);
    let seen;for(let i=0;i<60&&seen?.content!=='changed elsewhere';i++){await new Promise(r=>setTimeout(r,50));seen=await select('burst');}
    assert.equal(seen?.content,'changed elsewhere','a change made by another program must reach the next reads');
  }finally{await service.close();}
});

test('a write always reads the vault as it is, even when reads may reuse the last one',()=>{
  const dir=root(),store=new Store(dir);store.reuseFor=60000;
  store.save('notes',{id:'w',title:'W',content:'one'});store.scan();
  const other=new Store(dir);other.save('notes',{id:'w',content:'two'},other.get('notes','w')._hash);
  assert.equal(store.withLock(()=>store.snapshot(()=>store.get('notes','w').content)),'two','under the workspace lock the view must be read fresh');
});
