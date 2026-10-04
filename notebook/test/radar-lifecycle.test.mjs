import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {Domains} from '../core/domains.mjs';import {procedure} from '../core/procedures.mjs';
import {personalOperation} from '../core/personal-operations.mjs';
function fixture(){const store=new Store(fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-radar-verdict-'))),query=new QueryService(store),domains=new Domains(query,{provider:async()=>{throw Error('Explicit user verdict must not ask a model');}});let n=0;const note=store.save('notes',{title:'Fictional radar proposal',source_app:'radar',content:'Exact retained proposal and source quote',radar:{verdict:null,change:'A fictional dated source adapter',experiment:'Compare the fictional source dates',check:'Both saved dates match their source',rollback:'Restore the retained fictional adapter',end_date:'2026-12-01',source_hash:'fictional-original'}});return {store,query,domains,note,run:(message,request_id='fictional-'+n++)=>domains.invoke('conversation-chat',{conversation_id:'fictional-radar-user',message,request_id})};}
test('actual user verdict JSON is retained exactly and retry queues no second approval task',async()=>{
 const f=fixture(),reason='Fictional decision: "Try source dates"\nRetain the old adapter.',message='/radar verdict '+f.note.id+' '+JSON.stringify({verdict:'Trial',reason});
 const first=await f.run(message,'same-verdict'),again=await f.run(message,'same-verdict');assert.deepEqual(again,first);
 await f.run(message,'new-request-same-decision');
 assert.equal(f.store.list('radar_decisions').length,1);assert.equal(f.store.list('radar_decisions')[0].reason,reason);assert.equal(f.store.list('radar_trials').length,1);
 const work=f.store.list('work_items')[0];assert.equal(work.state,'awaiting_approval');assert.equal(work.allowed_action,null);assert.equal(work.requires_separate_execution_approval,true);
 assert.equal(f.store.list('notifications').length,0);
});
test('normal source selection retains radar and contribution choices without enabling those routines',()=>{
 const f=fixture(),topic=personalOperation(f.domains,{type:'watch-add',title:'Fictional selected release notes',url:'https://example.invalid/releases',criteria:'An actual source change',minutes:1440,radar:true,lead:true});
 assert.equal(topic.radar,true);assert.equal(topic.lead,true);assert.equal(f.store.get('jobs','radar'),undefined);assert.equal(f.store.get('jobs','lead'),undefined);
 assert.throws(()=>personalOperation(f.domains,{type:'watch-add',title:'Fictional rejected private address',url:'https://example.invalid?api_key=fictional-token',criteria:'Change',minutes:1440,radar:true}),/without credentials/);
 assert.equal(f.store.list('watch_topics').length,1);
});
test('expired trials, hidden proposals and stale displayed revisions cannot get an adopted decision',async()=>{
 const f=fixture(),displayedHash=f.store.get('notes',f.note.id)._hash;f.store.save('notes',{id:f.note.id,radar:{...f.note.radar,end_date:'2020-01-01'}});
 await assert.rejects(f.run('/radar verdict '+f.note.id+' '+JSON.stringify({verdict:'Trial',reason:'Fictional trial'})),/future end date/);
 await assert.rejects(f.run('/radar verdict '+f.note.id+' '+JSON.stringify({verdict:'Adopt',reason:'Fictional adoption',expected_hash:displayedHash})),/current version/);
 f.store.save('notes',{id:f.note.id,ai_visibility:'hidden'});await assert.rejects(f.run('/radar verdict '+f.note.id+' '+JSON.stringify({verdict:'Adopt',reason:'Fictional adoption'})),/assistant-visible/);
 assert.equal(f.store.list('radar_decisions').length,0);assert.equal(f.store.list('work_items').length,0);
});
test('a changed verdict cancels only its unexecuted pending action and keeps the original trial evidence',async()=>{
 const f=fixture();await f.run('/radar verdict '+f.note.id+' '+JSON.stringify({verdict:'Trial',reason:'Fictional test'}));const original=f.store.list('work_items')[0];
 await f.run('/radar verdict '+f.note.id+' '+JSON.stringify({verdict:'Caution',reason:'Fictional evidence does not justify the change'}));
 assert.equal(f.store.get('work_items',original.id).state,'cancelled');assert.equal(f.store.get('notes',f.note.id).radar.implementation_work_id,undefined);
 assert.equal(f.store.list('radar_decisions').length,2);assert.equal(f.store.list('radar_trials').length,1);assert.ok(f.store.list('record_history').some(h=>h.source_id===f.note.id&&h.snapshot.radar.verdict==='Trial'));
 assert.equal(f.store.list('radar_trials')[0].state,'superseded-before-implementation');
});
test('a failed reported trial requires actual separate evidence and never becomes verified success',async()=>{
 const f=fixture();await f.run('/radar verdict '+f.note.id+' '+JSON.stringify({verdict:'Trial',reason:'Fictional comparison'}));const evidence=f.store.save('notes',{title:'Fictional actual test observation',content:'The fictional target dropped the saved historical date.'});
 const observed_at=new Date().toISOString(),input={passed:false,evidence_note_id:evidence.id,quote:evidence.content,observed_at};
 await f.run('/radar result '+f.note.id+' '+JSON.stringify(input));const trial=f.store.list('radar_trials')[0],result=f.store.get('radar_trial_results',trial.result_id);
 assert.equal(trial.outcome,'reported-failure');assert.equal(result.verification,'reported');assert.equal(result.evidence_hash,f.store.get('notes',evidence.id)._hash);assert.equal(result.passed,false);
 await assert.rejects(f.run('/radar result '+f.note.id+' '+JSON.stringify({...input,quote:'Invented success'})),/existing visible evidence/);
 assert.equal(f.store.list('radar_trial_results').length,1);assert.equal(f.store.list('work_items')[0].state,'awaiting_approval');
});
test('three actual completed radar reads archive Assess without deleting the source or making another proposal',async t=>{
 const f=fixture(),server=http.createServer((req,res)=>res.end('Fictional exact primary source bytes'));
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 f.store.save('watch_topics',{title:'Fictional lifecycle source',radar:true,url:'http://127.0.0.1:'+server.address().port});
 await f.run('/radar verdict '+f.note.id+' '+JSON.stringify({verdict:'Assess',reason:'Watch for actual evidence'}));
 const provider=async()=>({kind:'quiet',reason:'No qualifying new change in the actual source'});
 await procedure({id:'fictional-radar',kind:'radar'},{...f,provider});assert.equal(f.store.get('notes',f.note.id).radar.lifecycle,'assess');
 await procedure({id:'fictional-radar',kind:'radar'},{...f,provider});assert.equal(f.store.get('notes',f.note.id).radar.lifecycle,'assess');
 await procedure({id:'fictional-radar',kind:'radar'},{...f,provider});const archived=f.store.get('notes',f.note.id);
 assert.equal(archived.radar.lifecycle,'archived');assert.equal(archived.radar.assessment_run_ids.length,3);assert.match(archived.content,/Exact retained proposal/);assert.match(archived.content,/Archived after three/);
 assert.equal(f.store.list('watch_observations').length,3);assert.equal(f.store.list('notifications').length,0);assert.ok(f.store.list('record_history').some(r=>r.source_id===f.note.id));
});
