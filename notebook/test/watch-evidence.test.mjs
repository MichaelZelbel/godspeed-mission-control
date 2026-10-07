import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store,hash} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {procedure} from '../core/procedures.mjs';

test('watch repairs one malformed quote, compares the newest baseline, and stays quiet on repetition',async()=>{
 const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-watch-'))),query=new QueryService(store),url='https://example.invalid/fictional',topic=store.save('watch_topics',{title:'Fictional test',url,criteria:'Only a changed test day'});
 store.save('watch_observations',{id:'z-old',topic_id:topic.id,url,status:200,content:'Monday',sha256:hash('Monday'),observed_at:'2026-10-01T00:00:00Z'});
 store.save('watch_observations',{id:'a-new',topic_id:topic.id,url,status:200,content:'Tuesday',sha256:hash('Tuesday'),observed_at:'2026-10-02T00:00:00Z'});
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response('Thursday');let calls=0;
 const provider=async input=>{calls++;assert.equal(input.context.previous,'Tuesday');return calls===1?{meaningful:true,evidence:'Moved to Thursday',follow_up:'Review the plan'}:{meaningful:true,evidence:'Thursday',follow_up:'Review the plan'};};
 try{
  const result=await procedure({kind:'watch',id:'watch'},{store,query,provider});assert.equal(result.verified,true);assert.equal(calls,2);assert.equal(result.silent,false);
  const repeated=await procedure({kind:'watch',id:'watch'},{store,query,provider});assert.equal(repeated.silent,true);assert.equal(calls,2);assert.equal(query.rows('notes').length,1);
 }finally{globalThis.fetch=original;}
});
