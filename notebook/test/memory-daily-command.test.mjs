import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {notebookNoteText} from '../core/notebook-note.mjs';
import {STARTING_ROUTINES} from '../core/starting-routines.mjs';
import {main} from '../scripts/memory-daily.mjs';

const model=fileURLToPath(new URL('./fixtures/memory-daily-model.mjs',import.meta.url));
const due=fileURLToPath(new URL('./fixtures/memory-daily-due.mjs',import.meta.url));
const workspace=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-memory-command-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'prompts','archive'),{recursive:true});return root;};
const archive=(root,rows)=>fs.writeFileSync(path.join(root,'prompts','archive','fixture.jsonl'),rows.map(JSON.stringify).join('\n')+'\n');
const response=value=>JSON.stringify(value);
const run=async(root,{env={},...options}={})=>{
 const before={};for(const [key,value] of Object.entries(env)){before[key]=process.env[key];if(value===undefined)delete process.env[key];else process.env[key]=value;}
 try{return await main({root,modelCommand:model,dueCommand:due,...options});}finally{for(const [key,value] of Object.entries(before)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
};
const fact=(id,quote,value='Hamburg')=>({facts:[{subject:'self',kind:'home-city',value,date:'2026-11-01',one_or_many:'one',citation:{id,quote}}]});

test('the command files a quoted notebook fact once through its model-command boundary',async t=>{
 const root=workspace(t),log=path.join(root,'model.log'),row={id:'hamburg',at:'2026-11-01T12:00:00Z',text:'I moved to Hamburg on 1 November'};fs.writeFileSync(path.join(root,'NOTEBOOK.md'),notebookNoteText);archive(root,[row]);
 const store=new Store(root),query=new QueryService(store),domains=new Domains(query);domains.writeFact({label:'Home city',value:'Kiel',valid_from:'2026-01-01'});
 const env={FIXTURE_MEMORY_MODEL_LOG:log,FIXTURE_MEMORY_MODEL_RESPONSE:response(fact(row.id,row.text))};const first=await run(root,{env});assert.equal(first.completed,1);
 const facts=new QueryService(new Store(root)).rows('claims').filter(item=>item.attribute==='lives-in');assert.equal(facts.find(item=>item.value==='Kiel').valid_to,'2026-11-01');assert.equal(facts.find(item=>item.value==='Hamburg').evidence_quote,row.text);
 await run(root,{env});assert.equal(fs.readFileSync(log,'utf8').trim().split('\n').length,1,'the archive command receives a consumed row only once');
});

test('the command refuses invalid evidence, redacted names, unknown subjects, and machine prompts',async t=>{
 const root=workspace(t),row={id:'human',at:'2026-11-02T12:00:00Z',text:'I moved to Hamburg on 1 November'},machine={id:'machine',at:'2026-11-02T13:00:00Z',text:'[CRON RUN] never save this'};fs.writeFileSync(path.join(root,'NOTEBOOK.md'),notebookNoteText);new Store(root).save('contacts',{id:'acme',name:'Acme Corp'});archive(root,[row,machine]);
 const answer={people:[{name:'Acme Corp'}],facts:[{subject:'Acme Corp',kind:'home-city',value:'Hamburg',citation:{id:row.id,quote:row.text}},{subject:'nobody-known',kind:'home-city',value:'Hamburg',citation:{id:row.id,quote:row.text}},{subject:'self',kind:'home-city',value:'Acme Corp',citation:{id:row.id,quote:row.text}},{subject:'self',kind:'home-city',value:'Hamburg',citation:{id:row.id,quote:'invented'}}],events:[{what:'Visited the park',day:'2026-11-02',participants:['Acme Corp'],citation:{id:row.id,quote:row.text}}]};
 const result=await run(root,{env:{GODSPEED_REDACT_TERMS:'Acme Corp',FIXTURE_MEMORY_MODEL_RESPONSE:response(answer)}});assert.equal(result.completed,1);const query=new QueryService(new Store(root));assert.equal(query.rows('claims').length,0);assert.equal(query.rows('moments').length,0);
 const runs=path.join(root,'routines','remember-what-you-said','runs'),receipts=fs.readdirSync(runs).flatMap(day=>fs.readdirSync(path.join(runs,day)).map(name=>fs.readFileSync(path.join(runs,day,name),'utf8'))).join('\n');assert.match(receipts,/machine-prompt/);assert.match(receipts,/unknown-subject/);assert.match(receipts,/private-or-invalid/);assert.match(receipts,/quote/);
});

test('the starter fallback deduplicates current facts and events',async t=>{
 const root=workspace(t),first={id:'first',at:'2026-11-02T12:00:00Z',text:'I moved to Hamburg on 1 November and visited the park'},second={...first,id:'second',at:'2026-11-03T12:00:00Z'};archive(root,[first]);
 const answer=row=>({people:[{name:'Alex'}],facts:[{subject:'self',kind:'home-city',value:'Hamburg',citation:{id:row.id,quote:'I moved to Hamburg on 1 November'}}],events:[{what:'Visited the park',day:'2026-11-02',participants:['Alex'],citation:{id:row.id,quote:'visited the park'}}]});
 await run(root,{env:{FIXTURE_MEMORY_MODEL_RESPONSE:response(answer(first))}});archive(root,[first,second]);await run(root,{env:{FIXTURE_MEMORY_MODEL_RESPONSE:response(answer(second))}});assert.ok(fs.existsSync(path.join(root,'world','entities','alex.md')));assert.equal(fs.readdirSync(path.join(root,'world','claims')).length,1);assert.equal(fs.readdirSync(path.join(root,'world','events')).length,1);
});

test('deadline evidence closes only an exact stated done-when and refusal keeps its row unread',async t=>{
 const root=workspace(t),modelLog=path.join(root,'model.log'),dueLog=path.join(root,'due.log'),row={id:'tax',at:'2026-11-02T12:00:00Z',text:'I filed the tax return today'};archive(root,[row]);
 const state=JSON.stringify([{slug:'tax',state:'open',title:'Tax return',doneWhen:'I filed the tax return today'}]),answer={events:[{what:'Filed the tax return',day:'2026-11-02',deadline_id:'tax',citation:{id:row.id,quote:row.text}}]};
 const env={FIXTURE_MEMORY_MODEL_LOG:modelLog,FIXTURE_MEMORY_DUE_LOG:dueLog,FIXTURE_MEMORY_DUE_STATE:state,FIXTURE_MEMORY_MODEL_RESPONSE:response(answer),FIXTURE_MEMORY_DUE_REFUSE:'1'};const refused=await run(root,{env});assert.equal(refused.completed,0);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'routines','remember-what-you-said','state.json'),'utf8')).consumed,[]);
 delete env.FIXTURE_MEMORY_DUE_REFUSE;const completed=await run(root,{env});assert.equal(completed.completed,1);assert.equal(fs.readFileSync(dueLog,'utf8').trim(),'tax\ntax');assert.equal(fs.readFileSync(modelLog,'utf8').trim().split('\n').length,1);
 const unsafe=workspace(t),plan={events:[{what:'Plan to file tax return',day:'2026-11-02',deadline_id:'tax',citation:{id:row.id,quote:'I plan to file the tax return tomorrow'}}]};archive(unsafe,[{...row,text:'I plan to file the tax return tomorrow'}]);await run(unsafe,{env:{FIXTURE_MEMORY_DUE_STATE:state,FIXTURE_MEMORY_MODEL_RESPONSE:response(plan)}});assert.ok(!fs.existsSync(path.join(unsafe,'world','events')),'a plan cannot close or file a completed event');
});

test('failed model and deadline-state commands do not consume archive rows, while no AI remains quiet',async t=>{
 const routine=STARTING_ROUTINES.find(item=>item.key==='memory-daily');assert.deepEqual({name:routine?.name,schedule:routine?.schedule},{name:'Remember what you said',schedule:'40 3 * * *'});
 const root=workspace(t),row={id:'retry',at:'2026-11-02T12:00:00Z',text:'I moved to Hamburg on 1 November'};archive(root,[row]);const log=path.join(root,'model.log');
 const failed=await run(root,{env:{FIXTURE_MEMORY_MODEL_FAIL:'1',FIXTURE_MEMORY_MODEL_LOG:log}});assert.equal(failed.failed,1);assert.equal(fs.readFileSync(log,'utf8').trim().split('\n').length,3);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'routines','remember-what-you-said','state.json'),'utf8')).consumed,[]);
 await assert.rejects(run(root,{env:{FIXTURE_MEMORY_DUE_STATE_FAIL:'1',FIXTURE_MEMORY_MODEL_LOG:log}}),/deadline state/);assert.equal(fs.readFileSync(log,'utf8').trim().split('\n').length,3);
 const noAi=workspace(t);archive(noAi,[row]);const skipped=await run(noAi,{env:{FIXTURE_MEMORY_MODEL_CHECK_FAIL:'1'}});assert.equal(skipped.skipped,true);assert.ok(!fs.existsSync(path.join(noAi,'routines','remember-what-you-said','state.json')));
 fs.mkdirSync(path.join(noAi,'.godspeed'),{recursive:true});fs.writeFileSync(path.join(noAi,'.godspeed','provider.json'),'{}');await assert.rejects(run(noAi,{env:{FIXTURE_MEMORY_MODEL_CHECK_FAIL:'1'}}),/configured Godspeed model/);
});
