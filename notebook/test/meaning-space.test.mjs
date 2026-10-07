import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {SearchIndex} from '../core/index/search.mjs';import {MeaningIndex} from '../core/index/meaning.mjs';

// Vectors were kept under the model's name alone. The same model asked for a
// different size (Settings, or GODSPEED_EMBEDDINGS_DIMENSIONS) re-embedded
// nothing, so meaning search found nothing while it said "indexed: 2,
// pending: 0", and once some notes were embedded again the sizes mixed and
// search failed with "Invalid typed array length".
const embedOf=size=>async texts=>({vectors:texts.map(t=>{const v=new Float32Array(size);v[0]=/knie|knee|orthop|mrt/i.test(t)?1:0;v[1]=/milk|bread|einkauf/i.test(t)?1:0;v[size-1]+=0.01;const n=Math.hypot(...v)||1;return v.map(x=>x/n);})});
const config=(dimensions,url='https://embeddings.example/v1')=>({url,model:'text-embedding-3-small',...(dimensions?{dimensions}:{})});
const fixture=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-meaning-space-'));const store=new Store(root);const knee=store.save('notes',{title:'Orthopäde Termin',content:'Montag 9 Uhr, MRT besprechen.'});store.save('notes',{title:'Einkauf',content:'Milk and bread.'});const index=new SearchIndex(store);t.after(()=>{index.close();fs.rmSync(root,{recursive:true,force:true});});return {store,index,knee};};
const titles=result=>result.rows.map(r=>r.title),top=result=>result.rows[0]?.title+' by '+result.rows[0]?.matched;

test('the same model at another size is embedded again, and search keeps working',async t=>{
 const {store,index,knee}=fixture(t);
 index.meaning=new MeaningIndex(index,{config:config(1536),embed:embedOf(1536)});await index.meaning.step();
 assert.equal(top(await index.searchHybrid('knee doctor')),'Orthopäde Termin by meaning');
 index.meaning=new MeaningIndex(index,{config:config(512),embed:embedOf(512)});
 assert.equal(await index.meaning.step(),2,'every note is embedded at the new size');
 let result=await index.searchHybrid('knee doctor');assert.equal(result.mode,'words and meaning');assert.equal(top(result),'Orthopäde Termin by meaning');
 assert.equal(index.meaning.status.pending,0);assert.equal(index.meaning.status.indexed,2);
 store.save('notes',{id:knee.id,content:'Montag 9 Uhr, MRT und Knie besprechen.'});index.update([store.get('notes',knee.id)]);await index.meaning.step();
 result=await index.searchHybrid('knee doctor');assert.equal(result.note??null,null);assert.equal(top(result),'Orthopäde Termin by meaning');
 assert.deepEqual([...new Set(index.db.prepare('SELECT length(vec)/4 AS size FROM vectors').all().map(r=>r.size))],[512]);
});

test('another service under the same model name is embedded again',async t=>{
 const {index}=fixture(t);
 index.meaning=new MeaningIndex(index,{config:config(null,'https://one.example/v1'),embed:embedOf(64)});await index.meaning.step();
 index.meaning=new MeaningIndex(index,{config:config(null,'http://localhost:11434/v1'),embed:embedOf(64)});
 assert.equal(await index.meaning.step(),2);
});

test('a service that answers at a size other than the one asked for is refused, not stored',async t=>{
 const {index}=fixture(t);
 index.meaning=new MeaningIndex(index,{config:config(512),embed:embedOf(1536)});
 await assert.rejects(index.meaning.step(),/512/);
 assert.equal(index.db.prepare('SELECT COUNT(*) AS n FROM vectors').get().n,0);assert.match(index.meaning.status.last_error,/512/);
});

test('stored vectors of a size the service no longer gives are rebuilt instead of breaking search',async t=>{
 const {index}=fixture(t);
 // No size was configured, and the service changed what it gives.
 index.meaning=new MeaningIndex(index,{config:config(null),embed:embedOf(256)});await index.meaning.step();
 index.meaning.embed=embedOf(128);index.meaning.queryCache.clear();
 const result=await index.searchHybrid('knee doctor');assert.equal(result.mode,'words');assert.match(result.note,/again/);
 assert.equal(await index.meaning.step(),2,'every note is embedded at the size the service now gives');
 assert.equal(top(await index.searchHybrid('knee doctor')),'Orthopäde Termin by meaning');
});

// Every round read every text to learn which few had changed: over a second
// for 9,000 documents on Michael's laptop, twice every 20 seconds, on the
// thread that answers the browser (7 October 2026).
test('a round with nothing new reads no text, and a changed note reads only its own',async t=>{
 const {store,index,knee}=fixture(t);
 index.meaning=new MeaningIndex(index,{config:config(64),embed:embedOf(64)});await index.meaning.step();
 assert.ok(index.meaning.documents().every(d=>!('body' in d)),'the list of documents carries no text');
 const read=[],text=index.meaning.text.bind(index.meaning);index.meaning.text=doc=>{read.push(doc.uid);return text(doc);};
 assert.equal(await index.meaning.step(),0);assert.deepEqual(read,[]);
 store.save('notes',{id:knee.id,content:'Montag 9 Uhr, MRT und Knie besprechen.'});index.update([store.get('notes',knee.id)]);
 assert.equal(await index.meaning.step(),1);assert.equal(read.length,1);
 assert.equal(top(await index.searchHybrid('knee doctor')),'Orthopäde Termin by meaning');
});
