import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Store } from '../core/records/store.mjs';
import { QueryService } from '../core/query.mjs';
import { controlledWorker } from '../core/controlled-worker.mjs';

function fixture(t) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'worker-source-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new Store(root),query=new QueryService(store);
 const source=store.save('notes',{title:'Fictional confirmed rain rule',content:'Stop watering when wet.'});
 const other=store.save('notes',{title:'Fictional unrelated briefing',content:'No rain rule here.'});
 return {store,query,source,other,goal:{title:'Use Fictional confirmed rain rule before preparing the checklist'},decision:{},item:{id:'fictional-work',check:'Quote the current saved rain rule.'}};
}
test('a source named by its ordinary title must actually be read',async t=>{
 const f=fixture(t);
 const provider=async request=>request.context.tool_results.length?{deliverable:'I claim I used the rain rule.'}:{tool_calls:[{name:'read_note',id:f.other.id}]};
 await assert.rejects(controlledWorker({...f,provider}),/did not read every required source/);
});
test('a source corrected during work cannot be applied from its old version',async t=>{
 const f=fixture(t);
 const provider=async request=>{
  if(!request.context.tool_results.length)return {tool_calls:[{name:'read_note',id:f.source.id}]};
  f.store.save('notes',{id:f.source.id,content:'Correction: stop watering when wet and isolate power before calibration.'});
  return {deliverable:'Old instruction: stop watering when wet.'};
 };
 await assert.rejects(controlledWorker({...f,provider}),/source note changed after its read/);
});
test('reading the corrected source again permits the current instruction',async t=>{
 const f=fixture(t);
 const provider=async request=>{
  if(!request.context.tool_results.length)return {tool_calls:[{name:'read_note',id:f.source.id}]};
  if(request.context.tool_results.length===1){f.store.save('notes',{id:f.source.id,content:'Stop watering when wet; isolate power before calibration.'});return {tool_calls:[{name:'read_note',id:f.source.id}]};}
  return {deliverable:request.context.tool_results.at(-1).result.content};
 };
 const result=await controlledWorker({...f,provider});
 assert.match(result.content,/isolate power/);
 assert.equal(result.tool_results.length,2);
});
