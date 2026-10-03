import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {retrievedContext} from '../core/chat-context.mjs';
test('meaning-expanded retrieval selects a synonym source and excludes hidden sources',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-meaning-'))),query=new QueryService(store);
 const n=store.save('notes',{title:'Fictional bicycle outing',content:'We discussed riding bicycles by the river.'});store.save('notes',{title:'Hidden bicycle outing',content:'Hidden words',ai_visibility:'hidden'});
 const context=await retrievedContext(query,{message:'Find my cycling conversation'},async()=>JSON.stringify({terms:['bicycle','bicycles','riding']}));
 assert.equal(context.notes.length,1);assert.equal(context.notes[0].id,n.id);assert.equal(context.retrieval.method,'keyword and meaning-expanded selection');
});
