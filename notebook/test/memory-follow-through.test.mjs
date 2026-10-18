import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';import {jobExecutor} from '../core/runtime.mjs';import {chatContext} from '../core/chat-context.mjs';
const fixture=()=>{const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-memory-'))),query=new QueryService(store);return {store,query};};
test('conversation capture creates validated review proposals once; confirmed correction removes stale agent context',async()=>{
 const {store,query}=fixture();store.save('conversation_messages',{role:'user',conversation_id:'fictional',content:'I prefer fictional blue notebooks.'});let calls=0;
 const provider=async()=>{calls++;return JSON.stringify({suggestions:[{type:'add_claim',title:'Fictional notebook preference',payload:{label:'Notebook preference',value:'Blue',subject_type:'self'},evidence_quote:'I prefer fictional blue notebooks.'}]});};
 const run=jobExecutor(provider,query);await run({kind:'memory-capture',id:'capture'},{store,settings:{}});assert.equal(query.rows('review_queue').length,1);await run({kind:'memory-capture',id:'capture'},{store,settings:{}});assert.equal(calls,1);
 const domains=new Domains(query);domains.writeFact({label:'Notebook preference',value:'Blue',valid_from:'2026-09-01'});domains.writeFact({label:'Notebook preference',value:'Green',valid_from:'2026-10-01'});
 const context=chatContext(query,{message:'What is my notebook preference?'});assert.ok(context.world_claims.every(c=>c.value!=='Blue'));assert.ok(JSON.stringify(context).includes('Green'));
});
