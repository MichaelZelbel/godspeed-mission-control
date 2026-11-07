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
import {recordRunningNotebook} from '../core/running-notebook.mjs';
import {main,resultExitCode} from '../scripts/memory-daily.mjs';

const model=fileURLToPath(new URL('./fixtures/memory-daily-model.mjs',import.meta.url));
const due=fileURLToPath(new URL('./fixtures/memory-daily-due.mjs',import.meta.url));
const workspace=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-memory-command-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'prompts','archive'),{recursive:true});return root;};
const archive=(root,rows)=>fs.writeFileSync(path.join(root,'prompts','archive','fixture.jsonl'),rows.map(JSON.stringify).join('\n')+'\n');
const response=value=>JSON.stringify(value);
const self={kind:'self'};
const run=async(root,{env={},...options}={})=>{
 const before={};for(const [key,value] of Object.entries(env)){before[key]=process.env[key];if(value===undefined)delete process.env[key];else process.env[key]=value;}
 try{return await main({root,modelCommand:model,dueCommand:due,...options});}finally{for(const [key,value] of Object.entries(before)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
};
const fact=(id,quote,value='Hamburg')=>({facts:[{subject:self,kind:'home-city',value,date:'2026-11-01',one_or_many:'one',citation:{id,quote}}]});

test('the command files a quoted notebook fact once through its model-command boundary',async t=>{
 const root=workspace(t),log=path.join(root,'model.log'),row={id:'hamburg',at:'2026-11-01T12:00:00Z',text:'I moved to Hamburg on 1 November'};fs.writeFileSync(path.join(root,'NOTEBOOK.md'),notebookNoteText);archive(root,[row]);
 const store=new Store(root),query=new QueryService(store),domains=new Domains(query);domains.writeFact({label:'Home city',value:'Kiel',valid_from:'2026-01-01'});
 const env={FIXTURE_MEMORY_MODEL_LOG:log,FIXTURE_MEMORY_MODEL_RESPONSE:response(fact(row.id,row.text))};const first=await run(root,{env});assert.equal(first.completed,1);
 const facts=new QueryService(new Store(root)).rows('claims').filter(item=>item.attribute==='lives-in');assert.equal(facts.find(item=>item.value==='Kiel').valid_to,'2026-11-01');assert.equal(facts.find(item=>item.value==='Hamburg').evidence_quote,row.text);
 await run(root,{env});assert.equal(fs.readFileSync(log,'utf8').trim().split('\n').length,1,'the archive command receives a consumed row only once');
});

test('the command refuses invalid evidence, redacted names, unknown subjects, and machine prompts',async t=>{
 const root=workspace(t),row={id:'human',at:'2026-11-02T12:00:00Z',text:'I moved to Hamburg on 1 November'},machine={id:'machine',at:'2026-11-02T13:00:00Z',text:'[CRON RUN] never save this'};fs.writeFileSync(path.join(root,'NOTEBOOK.md'),notebookNoteText);new Store(root).save('contacts',{id:'acme',name:'Acme Corp'});archive(root,[row,machine]);
 const answer={people:[{id:'new-acme',name:'Acme Corp'}],facts:[{subject:{kind:'contact',id:'acme'},kind:'home-city',value:'Hamburg',citation:{id:row.id,quote:row.text}},{subject:{kind:'contact',id:'nobody-known'},kind:'home-city',value:'Hamburg',citation:{id:row.id,quote:row.text}},{subject:self,kind:'home-city',value:'Acme Corp',citation:{id:row.id,quote:row.text}},{subject:self,kind:'home-city',value:'Hamburg',citation:{id:row.id,quote:'invented'}}],events:[{what:'Visited the park',day:'2026-11-02',participants:[{kind:'contact',id:'acme'}],citation:{id:row.id,quote:row.text}}]};
 const result=await run(root,{env:{GODSPEED_REDACT_TERMS:'Acme Corp',FIXTURE_MEMORY_MODEL_RESPONSE:response(answer)}});assert.equal(result.completed,1);const query=new QueryService(new Store(root));assert.equal(query.rows('claims').length,0);assert.equal(query.rows('moments').length,0);
 const runs=path.join(root,'routines','remember-what-you-said','runs'),receipts=fs.readdirSync(runs).flatMap(day=>fs.readdirSync(path.join(runs,day)).map(name=>fs.readFileSync(path.join(runs,day,name),'utf8'))).join('\n');assert.match(receipts,/machine-prompt/);assert.match(receipts,/unknown-subject/);assert.match(receipts,/private-or-invalid/);assert.match(receipts,/quote/);
});

test('the command reads the harvest redaction file before requesting a model',async t=>{
 const root=workspace(t),home=path.join(root,'home'),log=path.join(root,'model.log'),redacted={id:'redacted',at:'2026-11-02T12:00:00Z',text:'I moved to Hamburg on 1 November'},allowed={id:'allowed',at:'2026-11-02T13:00:00Z',text:'I moved to Berlin on 1 November'};fs.mkdirSync(path.join(home,'.godspeed'),{recursive:true});fs.writeFileSync(path.join(home,'.godspeed','redact.txt'),'Hamburg\n');archive(root,[redacted,allowed]);
 await run(root,{env:{HOME:home,FIXTURE_MEMORY_MODEL_LOG:log,FIXTURE_MEMORY_MODEL_RESPONSE:response({facts:[]})}});
 const request=JSON.parse(fs.readFileSync(log,'utf8'));assert.deepEqual(JSON.parse(request.prompt).messages.map(message=>message.id),['allowed']);
});

test('the starter fallback deduplicates current facts and events',async t=>{
 const root=workspace(t),first={id:'first',at:'2026-11-02T12:00:00Z',text:'I moved to Hamburg on 1 November and visited the park'},second={...first,id:'second',at:'2026-11-03T12:00:00Z'};archive(root,[first]);
 const answer=row=>({people:[{id:'alex',name:'Alex'}],facts:[{subject:self,kind:'home-city',value:'Hamburg',citation:{id:row.id,quote:'I moved to Hamburg on 1 November'}}],events:[{what:'Visited the park',day:'2026-11-02',participants:[{kind:'new-person',id:'alex'}],citation:{id:row.id,quote:'visited the park'}}]});
 await run(root,{env:{FIXTURE_MEMORY_MODEL_RESPONSE:response(answer(first))}});archive(root,[first,second]);await run(root,{env:{FIXTURE_MEMORY_MODEL_RESPONSE:response(answer(second))}});assert.ok(fs.existsSync(path.join(root,'world','entities','alex.md')));assert.equal(fs.readdirSync(path.join(root,'world','claims')).length,1);assert.equal(fs.readdirSync(path.join(root,'world','events')).length,1);
});

test('the starter fallback files equivalent facts and events from one response once',async t=>{
 const root=workspace(t),first={id:'first',at:'2026-11-02T12:00:00Z',text:'I moved to Hamburg on 1 November and visited the park'},second={id:'second',at:'2026-11-02T12:01:00Z',text:'I now live in Hamburg and went to the park'};archive(root,[first,second]);
 const answer={facts:[{subject:self,kind:'home-city',value:'Hamburg',citation:{id:first.id,quote:'I moved to Hamburg on 1 November'}},{subject:self,kind:'home-city',value:'Hamburg',citation:{id:second.id,quote:'I now live in Hamburg'}}],events:[{what:'Visited the park',day:'2026-11-02',participants:[],citation:{id:first.id,quote:'visited the park'}},{what:'Visited the park',day:'2026-11-02',participants:[],citation:{id:second.id,quote:'went to the park'}}]};
 await run(root,{env:{FIXTURE_MEMORY_MODEL_RESPONSE:response(answer)}});
 assert.equal(fs.readdirSync(path.join(root,'world','claims')).length,1);assert.equal(fs.readdirSync(path.join(root,'world','events')).length,1);
});

test('the starter fallback keeps same-named people and things distinct',async t=>{
 const root=workspace(t),row={id:'robin',at:'2026-11-02T12:00:00Z',text:'Robin lives in Kiel and the Robin project moved to Hamburg'};archive(root,[row]);
 const answer={people:[{id:'person-robin',name:'Robin'}],things:[{id:'thing-robin',name:'Robin'}],facts:[{subject:{kind:'new-person',id:'person-robin'},kind:'home-city',value:'Kiel',citation:{id:row.id,quote:row.text}},{subject:{kind:'new-thing',id:'thing-robin'},kind:'home-city',value:'Hamburg',citation:{id:row.id,quote:row.text}}],events:[{what:'Robin project moved to Hamburg',day:'2026-11-02',participants:[{kind:'new-thing',id:'thing-robin'}],citation:{id:row.id,quote:row.text}}]};
 await run(root,{env:{FIXTURE_MEMORY_MODEL_RESPONSE:response(answer)}});
 assert.ok(fs.existsSync(path.join(root,'world','entities','robin.md')));assert.ok(fs.existsSync(path.join(root,'world','entities','thing-robin.md')));
 assert.match(fs.readdirSync(path.join(root,'world','claims')).map(name=>fs.readFileSync(path.join(root,'world','claims',name),'utf8')).join('\n'),/subject: thing-robin/);assert.match(fs.readFileSync(path.join(root,'world','events',fs.readdirSync(path.join(root,'world','events'))[0]),'utf8'),/participants: \[thing-robin\]/);
});

test('deadline evidence closes only a complete assertion of the stated done-when and refusal keeps its row unread',async t=>{
 const root=workspace(t),modelLog=path.join(root,'model.log'),dueLog=path.join(root,'due.log'),row={id:'tax',at:'2026-11-02T12:00:00Z',text:'I have filed the tax return today.'};archive(root,[row]);
 const state=JSON.stringify([{slug:'tax',state:'open',title:'Tax return',doneWhen:'I filed the tax return today'}]),answer={events:[{what:'Filed the tax return',day:'2026-11-02',participants:[],deadline_id:'tax',deadline_complete:true,citation:{id:row.id,quote:row.text}}]};
 const env={FIXTURE_MEMORY_MODEL_LOG:modelLog,FIXTURE_MEMORY_DUE_LOG:dueLog,FIXTURE_MEMORY_DUE_STATE:state,FIXTURE_MEMORY_MODEL_RESPONSE:response(answer),FIXTURE_MEMORY_DUE_REFUSE:'1'};const refused=await run(root,{env});assert.equal(refused.completed,0);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'routines','remember-what-you-said','state.json'),'utf8')).consumed,[]);
 assert.match(fs.readFileSync(modelLog,'utf8'),/deadline_complete\?:true/);
 delete env.FIXTURE_MEMORY_DUE_REFUSE;const completed=await run(root,{env});assert.equal(completed.completed,1);assert.deepEqual(fs.readFileSync(dueLog,'utf8').trim().split('\n').map(JSON.parse),[['done','tax','--evidence',row.text,'--godspeed',root],['done','tax','--evidence',row.text,'--godspeed',root]]);assert.equal(fs.readFileSync(modelLog,'utf8').trim().split('\n').length,1);
 const promiseState=JSON.stringify([{slug:'tax',state:'open',title:'Tax return',doneWhen:'submit the tax return'}]);for(const quote of ['I promise I will submit the tax return tomorrow','I planned to submit the tax return']){const unsafe=workspace(t),unsafeDue=path.join(unsafe,'due.log'),plan={events:[{what:'Plan to submit tax return',day:'2026-11-02',participants:[],deadline_id:'tax',deadline_complete:true,citation:{id:row.id,quote}}]};archive(unsafe,[{...row,text:quote}]);await run(unsafe,{env:{FIXTURE_MEMORY_DUE_STATE:promiseState,FIXTURE_MEMORY_DUE_LOG:unsafeDue,FIXTURE_MEMORY_MODEL_RESPONSE:response(plan)}});assert.ok(!fs.existsSync(path.join(unsafe,'world','events')),quote+' cannot close or file a completed event');assert.ok(!fs.existsSync(unsafeDue),quote+' never reaches the irreversible deadline command');}
 const future=workspace(t),futureDue=path.join(future,'due.log'),futureQuote='I will file the tax return tomorrow',futurePlan={events:[{what:'Future tax return',day:'2026-11-02',participants:[],deadline_id:'tax',deadline_complete:true,citation:{id:'future',quote:futureQuote}}]};archive(future,[{id:'future',at:'2026-11-02T12:00:00Z',text:futureQuote}]);await run(future,{env:{FIXTURE_MEMORY_DUE_STATE:JSON.stringify([{slug:'tax',state:'open',title:'Tax return',doneWhen:futureQuote}]),FIXTURE_MEMORY_DUE_LOG:futureDue,FIXTURE_MEMORY_MODEL_RESPONSE:response(futurePlan)}});assert.ok(!fs.existsSync(path.join(future,'world','events')),'a future promise matching done-when does not become an event');assert.ok(!fs.existsSync(futureDue),'a future promise matching done-when never reaches the irreversible deadline command');
 const shortCondition=workspace(t),shortDue=path.join(shortCondition,'due.log'),shortRow={id:'fence',at:'2026-11-02T12:00:00Z',text:'I plan to get it painted this weekend.'},shortPlan={events:[{what:'Plan to paint the fence',day:'2026-11-02',participants:[],deadline_id:'fence',deadline_complete:true,citation:{id:shortRow.id,quote:'painted'}}]};archive(shortCondition,[shortRow]);await run(shortCondition,{env:{FIXTURE_MEMORY_DUE_STATE:JSON.stringify([{slug:'fence',state:'open',title:'Paint the fence',doneWhen:'painted'}]),FIXTURE_MEMORY_DUE_LOG:shortDue,FIXTURE_MEMORY_MODEL_RESPONSE:response(shortPlan)}});assert.ok(!fs.existsSync(path.join(shortCondition,'world','events')),'a partial citation cannot turn a plan into an event');assert.ok(!fs.existsSync(shortDue),'a partial citation never reaches due');
 for(const deadline_complete of [undefined,false]){const missing=workspace(t),missingDue=path.join(missing,'due.log'),event={what:'Filed the tax return',day:'2026-11-02',participants:[],deadline_id:'tax',citation:{id:'missing',quote:'I filed the tax return today'}};if(deadline_complete!==undefined)event.deadline_complete=deadline_complete;archive(missing,[{id:'missing',at:'2026-11-02T12:00:00Z',text:'I filed the tax return today'}]);await run(missing,{env:{FIXTURE_MEMORY_DUE_STATE:state,FIXTURE_MEMORY_DUE_LOG:missingDue,FIXTURE_MEMORY_MODEL_RESPONSE:response({events:[event]})}});assert.ok(!fs.existsSync(path.join(missing,'world','events')),'a missing or false completion signal files no event');assert.ok(!fs.existsSync(missingDue),'a missing or false completion signal never reaches due');}
});

test('failed model and deadline-state commands do not consume archive rows, while no AI remains quiet',async t=>{
 const routine=STARTING_ROUTINES.find(item=>item.key==='memory-daily');assert.deepEqual({name:routine?.name,schedule:routine?.schedule},{name:'Remember what you said',schedule:'40 3 * * *'});
 const root=workspace(t),row={id:'retry',at:'2026-11-02T12:00:00Z',text:'I moved to Hamburg on 1 November'};archive(root,[row]);const log=path.join(root,'model.log');
 const failed=await run(root,{env:{FIXTURE_MEMORY_MODEL_FAIL:'1',FIXTURE_MEMORY_MODEL_LOG:log}});assert.equal(failed.failed,1);assert.equal(fs.readFileSync(log,'utf8').trim().split('\n').length,3);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'routines','remember-what-you-said','state.json'),'utf8')).consumed,[]);
 await assert.rejects(run(root,{env:{FIXTURE_MEMORY_DUE_STATE_FAIL:'1',FIXTURE_MEMORY_MODEL_LOG:log}}),/deadline state/);assert.equal(fs.readFileSync(log,'utf8').trim().split('\n').length,3);
 const noAi=workspace(t);archive(noAi,[row]);const skipped=await run(noAi,{env:{FIXTURE_MEMORY_MODEL_CHECK_FAIL:'1'}});assert.equal(skipped.skipped,true);assert.ok(!fs.existsSync(path.join(noAi,'routines','remember-what-you-said','state.json')));
 fs.mkdirSync(path.join(noAi,'.godspeed'),{recursive:true});fs.writeFileSync(path.join(noAi,'.godspeed','assistant.json'),'{}');const unconfigured=await run(noAi,{env:{FIXTURE_MEMORY_MODEL_UNCONFIGURED:'1'}});assert.equal(unconfigured.skipped,true);assert.ok(!fs.existsSync(path.join(noAi,'routines','remember-what-you-said','state.json')));
});

test('the command reports a failed archive piece when later pieces complete',async t=>{
 const root=workspace(t),rows=Array.from({length:16},(_,index)=>({id:'piece-'+String(index).padStart(2,'0'),at:'2026-11-02T12:'+String(index).padStart(2,'0')+':00Z',text:'I recorded item '+index+' '+'.'.repeat(2900)}));archive(root,rows);
 const result=await run(root,{env:{FIXTURE_MEMORY_MODEL_FAIL_CONTAINING:'piece-00',FIXTURE_MEMORY_MODEL_RESPONSE:response({facts:[],events:[]})}});
 assert.equal(result.failed,1);assert.ok(result.completed>0);assert.equal(resultExitCode(result),1);assert.equal(resultExitCode({failed:0}),0);
});

test('a Windows external assistant configuration is checked instead of silently skipped',async t=>{
 const root=workspace(t),external=path.join(root,'notebook-state'),config=path.join(external,'assistant.json'),row={id:'external',at:'2026-11-02T12:00:00Z',text:'I moved to Hamburg on 1 November'},log=path.join(root,'model.log');fs.mkdirSync(external);fs.writeFileSync(config,'{}');recordRunningNotebook({root,assistantConfig:config,platform:'win32'});archive(root,[row]);
 await assert.rejects(run(root,{env:{FIXTURE_MEMORY_MODEL_CHECK_FAIL:'1'}}),/configured Godspeed model/);
 const result=await run(root,{env:{FIXTURE_MEMORY_MODEL_LOG:log,FIXTURE_MEMORY_MODEL_RESPONSE:response(fact(row.id,row.text))}});assert.equal(result.completed,1);assert.equal(fs.readFileSync(log,'utf8').trim().split('\n').length,1);
});

test('malformed successful deadline state stops before a model request or cursor write',async t=>{
 for(const state of ['{}','not json']){
  const root=workspace(t),row={id:'deadline-'+state,at:'2026-11-02T12:00:00Z',text:'I moved to Hamburg on 1 November'},log=path.join(root,'model.log');archive(root,[row]);
  await assert.rejects(run(root,{env:{FIXTURE_MEMORY_DUE_STATE:state,FIXTURE_MEMORY_MODEL_LOG:log}}),/deadline state/);
  assert.ok(!fs.existsSync(log));assert.ok(!fs.existsSync(path.join(root,'routines','remember-what-you-said','state.json')));
 }
});
