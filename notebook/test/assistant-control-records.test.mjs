import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {mcp} from '../server/mcp.mjs';
import {assistantMutationContext} from '../core/assistant-mutations.mjs';
import {toolScope} from '../core/api-keys.mjs';

const fixture=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-control-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const store=new Store(root),query=new QueryService(store),domains=new Domains(query);return {store,query,domains};};
const call=async(env,name,args,scopes)=>{const r=await mcp({id:1,method:'tools/call',params:{name,arguments:args}},{...env,scopes});return {error:!!r.result.isError,text:r.result.content[0].text};};
const all=['notes','contacts','world','collections','media','profile','actions','stats'];

// 6 October 2026 review: save_record turned off hide_sensitive_from_ai, forged an
// approval, opened an anonymous public share and planted standing instructions,
// with no key on the owner's computer and with the server assistant's key.
for(const scopes of [undefined,all])test('the assistant cannot rewrite the records that restrict it'+(scopes?' (all-scope key)':' (no key)'),async t=>{
 const env=fixture(t),{store}=env;
 const sensitive=store.save('notes',{title:'Fictional therapy',content:'Fictional sensitive text',is_sensitive:true});
 const visible=store.save('notes',{title:'Fictional shopping',content:'Fictional groceries'});
 const attempts=[
  ['mcp_preferences',{hide_sensitive_from_ai:false}],
  ['approvals',{status:'approved',title:'Fictional self-approval',job_id:'x',payload_hash:'y'}],
  ['shared_notes',{note_id:visible.id,share_token:'fictional-attacker-token',is_active:true}],
  ['agent_instructions',{title:'Fictional standing order',content:'Fictional instruction',is_active:true}],
  ['settings',{id:'installation',delivery:'telegram'}],['jobs',{kind:'selftest',owner:'local',paused:false}],
  ['permissions',{role:'owner'}],['user_roles',{role:'admin'}],['mcp_api_tokens',{name:'x'}],['telegram_connections',{chat:'x'}],
  ['import_mappings',{source:'x'}],['job_receipts',{state:'verified'}],['command_receipts',{state:'verified'}],
  ['claims',{subject_type:'self',attribute:'fictional',value:'x'}],['fact_slots',{subject_type:'self',attribute:'fictional',show_to_agent:true}],
 ];
 const before=store.records.size;
 for(const [type,value] of attempts){const r=await call(env,'save_record',{type,value},scopes);assert.equal(r.error,true,type+' was written: '+r.text);}
 assert.equal(store.records.size,before);
 assert.match((await call(env,'save_record',{type:'agent_instructions',value:{content:'x'}},scopes)).text,/owner/i);
 assert.equal((await call(env,'get_note',{id:sensitive.id},scopes)).error,true);
 // Ordinary records still save.
 const note=await call(env,'save_record',{type:'notes',value:{title:'Fictional plan',content:'Fictional body'}},scopes);assert.equal(note.error,false,note.text);
 const person=await call(env,'save_record',{type:'contacts',value:{name:'Fictional Person'}},scopes);assert.equal(person.error,false,person.text);
});

test('every assistant path is refused a control record, including renames and removals',async t=>{
 const env=fixture(t),{store}=env,saved=(type,value)=>{const r=store.save(type,value);return store.get(type,r.id);},instruction=saved('agent_instructions',{title:'Owner rule',content:'Fictional owner instruction',is_active:true});
 const share=saved('shared_notes',{note_id:'none',share_token:'fictional-token',is_active:true});
 for(const [type,record] of [['agent_instructions',instruction],['shared_notes',share]]){
  const r=await call(env,'structural_change',{type,id:record.id,action:'remove',expected_hash:record._hash});assert.equal(r.error,true,type+' removed');
  assert.equal(store.get(type,record.id).removed_at,undefined);
 }
 const pref=saved('mcp_preferences',{hide_sensitive_from_ai:true});
 const r=await call(env,'save_record',{type:'mcp_preferences',value:{id:pref.id,hide_sensitive_from_ai:false},expected_hash:pref._hash});assert.equal(r.error,true);
 assert.equal(store.get('mcp_preferences',pref.id).hide_sensitive_from_ai,true);
 // A collection's capture instructions are instructions to assistants too.
 const collection=saved('collections',{name:'Fictional books',field_schema:[{key:'title',label:'Title',type:'text',primary:true}],agent_instructions:'Owner guidance'});
 const changed=await call(env,'save_record',{type:'collections',value:{id:collection.id,agent_instructions:'Fictional planted guidance'},expected_hash:collection._hash});
 assert.equal(changed.error,true);assert.equal(store.get('collections',collection.id).agent_instructions,'Owner guidance');
 const renamed=await call(env,'save_record',{type:'collections',value:{id:collection.id,name:'Fictional novels'},expected_hash:collection._hash});assert.equal(renamed.error,false,renamed.text);
});

test('explicit personal operations still keep their own schedules and settings',async t=>{
 const env=fixture(t),{store}=env;
 let r=await call(env,'personal_operation',{type:'journal-switch',enabled:false},all);assert.equal(r.error,false,r.text);
 store.save('jobs',{id:'fictional-routine',kind:'selftest',owner:'local',paused:false,next_run:new Date().toISOString(),interval_ms:60000});const job=store.get('jobs','fictional-routine');
 r=await call(env,'personal_operation',{type:'routine-change',id:job.id,paused:true,expected:job._hash},all);assert.equal(r.error,false,r.text);
 assert.equal(store.get('jobs',job.id).paused,true);
});

test('a key\'s missing scope for a written record means no',t=>{
 const env=fixture(t);
 const scoped=Object.assign(Object.create(Object.getPrototypeOf(env.domains)),env.domains,{toolScope:type=>toolScope('save_record',{type})});
 const guard=assistantMutationContext({...env,domains:scoped,scopes:all},{},'capture_note');
 // A decision record belongs to no scope a key can hold.
 assert.throws(()=>guard.store.save('decisions',{title:'Fictional decision',state:'selected'}),/key/);
 assert.equal(env.store.list('decisions').length,0);
});
