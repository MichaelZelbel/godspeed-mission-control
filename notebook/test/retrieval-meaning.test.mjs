import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {retrievedContext} from '../core/chat-context.mjs';
import {Domains} from '../core/domains.mjs';

test('search without a model excludes hidden and trashed notes',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-search-private-'))),domains=new Domains(new QueryService(store));
 const visible=store.save('notes',{title:'Fictional cycling',content:'Bicycle ride'});store.save('notes',{title:'Hidden cycling',content:'Bicycle ride',ai_visibility:'hidden'});store.save('notes',{title:'Trashed cycling',content:'Bicycle ride',is_trashed:true});
 const result=await domains.invoke('search-notes-semantic',{query:'cycling'});assert.deepEqual(result.notes.map(n=>n.id),[visible.id]);
});

test('model search expands meaning and ranks bounded candidates without sending all note bodies',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-search-bounded-'))),query=new QueryService(store);const target=store.save('notes',{title:'Fictional bicycle outing',content:'Riding bicycles beside the river.'});
 for(let i=0;i<100;i++)store.save('notes',{title:'Unrelated '+i,content:'z'.repeat(10000)});
 const calls=[],domains=new Domains(query,{provider:async input=>{calls.push(input);return input.kind==='retrieval-expansion'?{terms:['bicycle','bicycles','riding']}:{matches:[{id:target.id,score:0.9}]};}});
 const result=await domains.invoke('search-notes-semantic',{query:'cycling'});assert.equal(result.notes[0].id,target.id);assert.ok(JSON.stringify(calls.at(-1)).length<50000);assert.equal(calls.at(-1).notes.length,1);
});
test('meaning-expanded retrieval selects a synonym source and excludes hidden sources',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-meaning-'))),query=new QueryService(store);
 const n=store.save('notes',{title:'Fictional bicycle outing',content:'We discussed riding bicycles by the river.'});store.save('notes',{title:'Hidden bicycle outing',content:'Hidden words',ai_visibility:'hidden'});
 const context=await retrievedContext(query,{message:'Find my cycling conversation'},async()=>JSON.stringify({terms:['bicycle','bicycles','riding']}));
 assert.equal(context.notes.length,1);assert.equal(context.notes[0].id,n.id);assert.equal(context.retrieval.method,'keyword and meaning-expanded selection');
});
