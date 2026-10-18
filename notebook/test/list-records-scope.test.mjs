import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';import {mcp} from '../server/mcp.mjs';

// list_records and search_knowledge may return only the owner's own content
// types, each with a real visibility rule. Bookkeeping and link types embed
// other records' content (record_history.snapshot, notifications.body,
// review_queue.payload) that visibleRows does not inspect, so they are refused.
const fixture=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-listscope-'));t.after(()=>{try{store.unwatch?.();}catch{}fs.rmSync(root,{recursive:true,force:true});});const store=new Store(root,{device:'fixture'}),query=new QueryService(store);return {store,query,domains:new Domains(query)};};
const call=(ctx,type,scopes)=>mcp({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'list_records',arguments:{type}}},{...ctx,scopes}).then(r=>r.result.content[0].text);

test('list_records refuses bookkeeping types that would leak a hidden record',async t=>{
 const ctx=fixture(t),{store}=ctx;
 const note=store.save('notes',{title:'Lunch',content:'Secret lunch note',ai_visibility:'hidden'});
 store.save('notes',{id:note.id,content:'Secret lunch note, edited'},note._hash); // makes a record_history snapshot
 const person=store.save('contacts',{name:'Carol Hidden',ai_visibility:'hidden'});
 store.save('review_queue',{title:'Carol Hidden: condition',status:'pending_review',payload:{contact_id:person.id,value:'CONFIDENTIAL'}});
 store.save('notifications',{title:'x',record_id:note.id,body:'Secret lunch note'});
 for(const scopes of [undefined,['profile'],['notes'],['profile','notes','contacts','world','collections','media','stats','actions']]){
  for(const type of ['record_history','notifications','review_queue','contact_topic_events','note_connections']){
   const text=await call(ctx,type,scopes);
   assert.match(text,/reads the owner's own content/,type+' '+JSON.stringify(scopes));
  }
 }
 // And the hidden content never appears.
 assert.doesNotMatch(await call(ctx,'record_history',undefined),/Secret lunch note|CONFIDENTIAL/);
});

test('list_records still returns the owner\'s own visible content',async t=>{
 const ctx=fixture(t),{store}=ctx;
 store.save('notes',{title:'Groceries',content:'milk, bread'});
 const hidden=store.save('notes',{title:'Private',content:'hidden body',ai_visibility:'hidden'});
 const text=await call(ctx,'notes',undefined),rows=JSON.parse(text);
 assert.ok(rows.some(r=>r.title==='Groceries'),'visible note returned');
 assert.ok(!rows.some(r=>r.id===hidden.id),'hidden note filtered');
});
