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
