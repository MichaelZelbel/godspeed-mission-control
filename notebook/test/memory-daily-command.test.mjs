import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {spawn} from 'node:child_process';
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
const memoryScript=fileURLToPath(new URL('../scripts/memory-daily.mjs',import.meta.url));
const workspace=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-memory-command-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'prompts','archive'),{recursive:true});return root;};
const archive=(root,rows)=>fs.writeFileSync(path.join(root,'prompts','archive','fixture.jsonl'),rows.map(JSON.stringify).join('\n')+'\n');
const response=value=>JSON.stringify(value);
const self={kind:'self'};
const run=async(root,{env={},...options}={})=>{
 const before={};for(const [key,value] of Object.entries(env)){before[key]=process.env[key];if(value===undefined)delete process.env[key];else process.env[key]=value;}
 try{return await main({root,modelCommand:model,dueCommand:due,...options});}finally{for(const [key,value] of Object.entries(before)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
};
const runScript=root=>new Promise((resolve,reject)=>{const child=spawn(process.execPath,[memoryScript],{cwd:root,env:{...process.env,GODSPEED_WORKSPACE:root},stdio:['ignore','ignore','pipe'],windowsHide:true});let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error(stderr)));});
const fact=(id,quote,value='Hamburg')=>({facts:[{subject:self,kind:'home-city',value,date:'2026-11-01',one_or_many:'one',citation:{id,quote}}]});

test('the command files a quoted notebook fact once through its model-command boundary',async t=>{
 const root=workspace(t),log=path.join(root,'model.log'),row={id:'hamburg',at:'2026-11-01T12:00:00Z',text:'I moved to Hamburg on 1 November'};fs.writeFileSync(path.join(root,'NOTEBOOK.md'),notebookNoteText);archive(root,[row]);
 const store=new Store(root),query=new QueryService(store),domains=new Domains(query);domains.writeFact({label:'Home city',value:'Kiel',valid_from:'2026-01-01'});
 const env={FIXTURE_MEMORY_MODEL_LOG:log,FIXTURE_MEMORY_MODEL_RESPONSE:response(fact(row.id,row.text))};const first=await run(root,{env});assert.equal(first.completed,1);
 const facts=new QueryService(new Store(root)).rows('claims').filter(item=>item.attribute==='lives-in');assert.equal(facts.find(item=>item.value==='Kiel').valid_to,'2026-11-01');assert.equal(facts.find(item=>item.value==='Hamburg').evidence_quote,row.text);
 await run(root,{env});assert.equal(fs.readFileSync(log,'utf8').trim().split('\n').length,1,'the archive command receives a consumed row only once');
});

test('two daily-memory command processes submit one archive piece once',async t=>{
 const root=workspace(t),row={id:'process-once',at:'2026-11-02T12:00:00Z',text:'I moved to Hamburg on 1 November'};archive(root,[row]);let requests=0,firstRequest,secondStarted;const requested=new Promise(resolve=>firstRequest=resolve),second=new Promise(resolve=>secondStarted=resolve);
 const server=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;requests++;if(requests===1){firstRequest(JSON.parse(body));await second;await new Promise(resolve=>setTimeout(resolve,300));}res.end(JSON.stringify({choices:[{message:{content:response({facts:[],events:[]})}}]}));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 fs.mkdirSync(path.join(root,'.godspeed'),{recursive:true});fs.writeFileSync(path.join(root,'.godspeed','provider.json'),JSON.stringify({url:'http://127.0.0.1:'+server.address().port+'/v1/chat/completions',key:'fixture-key',model:'fixture-model'}));
 const first=runScript(root);const request=await requested;const secondRun=runScript(root);secondStarted();await Promise.all([first,secondRun]);assert.equal(requests,1);assert.deepEqual(JSON.parse(request.messages[1].content).messages.map(message=>message.id),[row.id]);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'routines','remember-what-you-said','state.json'),'utf8')).consumed,[row.id]);
});

test('the command rejects a later notebook message that repeats a current fact',async t=>{
 const root=workspace(t),first={id:'first-hamburg',at:'2026-11-02T12:00:00Z',text:'I moved to Hamburg on 1 November'},second={id:'second-hamburg',at:'2026-11-03T12:00:00Z',text:'I still live in Hamburg'};fs.writeFileSync(path.join(root,'NOTEBOOK.md'),notebookNoteText);archive(root,[first]);await run(root,{env:{FIXTURE_MEMORY_MODEL_RESPONSE:response(fact(first.id,first.text))}});archive(root,[first,second]);await run(root,{env:{FIXTURE_MEMORY_MODEL_RESPONSE:response(fact(second.id,second.text))}});
 const query=new QueryService(new Store(root));assert.equal(query.rows('claims').filter(item=>item.value==='Hamburg').length,1);const receipts=fs.readdirSync(path.join(root,'routines','remember-what-you-said','runs')).flatMap(day=>fs.readdirSync(path.join(root,'routines','remember-what-you-said','runs',day)).map(name=>fs.readFileSync(path.join(root,'routines','remember-what-you-said','runs',day,name),'utf8'))).join('\n');assert.match(receipts,/"reason": "duplicate"/);
});

test('the command refuses invalid evidence, redacted names, unknown subjects, and machine prompts',async t=>{
 const root=workspace(t),row={id:'human',at:'2026-11-02T12:00:00Z',text:'I moved to Hamburg on 1 November'},machine={id:'machine',at:'2026-11-02T13:00:00Z',text:'[CRON RUN] never save this'};fs.writeFileSync(path.join(root,'NOTEBOOK.md'),notebookNoteText);new Store(root).save('contacts',{id:'acme',name:'Acme Corp'});archive(root,[row,machine]);
 const answer={people:[{id:'new-acme',name:'Acme Corp'}],facts:[{subject:{kind:'contact',id:'acme'},kind:'home-city',value:'Hamburg',citation:{id:row.id,quote:row.text}},{subject:{kind:'contact',id:'nobody-known'},kind:'home-city',value:'Hamburg',citation:{id:row.id,quote:row.text}},{subject:self,kind:'home-city',value:'Acme Corp',citation:{id:row.id,quote:row.text}},{subject:self,kind:'home-city',value:'Hamburg',citation:{id:row.id,quote:'invented'}}],events:[{what:'Visited the park',day:'2026-11-02',participants:[{kind:'contact',id:'acme'}],citation:{id:row.id,quote:row.text}}]};
 const result=await run(root,{env:{GODSPEED_REDACT_TERMS:'Acme Corp',FIXTURE_MEMORY_MODEL_RESPONSE:response(answer)}});assert.equal(result.completed,1);const query=new QueryService(new Store(root));assert.equal(query.rows('claims').length,0);assert.equal(query.rows('moments').length,0);
 const runs=path.join(root,'routines','remember-what-you-said','runs'),receipts=fs.readdirSync(runs).flatMap(day=>fs.readdirSync(path.join(runs,day)).map(name=>fs.readFileSync(path.join(runs,day,name),'utf8'))).join('\n');assert.match(receipts,/machine-prompt/);assert.match(receipts,/unknown-subject/);assert.match(receipts,/private-or-invalid/);assert.match(receipts,/quote/);
});

test('the command refuses ordinary employer material in every filed field and receipt',async t=>{
 for(const employerText of ['I started working at Google today.','I joined Google today.','I Joined Google today.']){
 const root=workspace(t),ordinary={id:'ordinary',at:'2026-11-02T12:00:00Z',text:'I visited the park today.'},employer={id:'employer',at:'2026-11-02T12:01:00Z',text:employerText};fs.writeFileSync(path.join(root,'NOTEBOOK.md'),notebookNoteText);archive(root,[ordinary,employer]);
 const answer={people:[{id:'person',name:'Google'}],things:[{id:'thing',name:'Google'}],facts:[{subject:self,kind:'employer',value:'a project',citation:{id:ordinary.id,quote:ordinary.text}},{subject:self,kind:'home-city',value:'Google',citation:{id:ordinary.id,quote:ordinary.text}},{subject:self,kind:'home-city',value:'Hamburg',citation:{id:employer.id,quote:employer.text}}],events:[{what:'Met Google about a project',day:'2026-11-02',participants:[],citation:{id:ordinary.id,quote:ordinary.text}},{what:'Visited the park',day:'2026-11-02',participants:[],citation:{id:employer.id,quote:employer.text}},{what:'Visited the park',day:'2026-11-02',participants:[{kind:'new-person',id:'person'},{kind:'new-thing',id:'thing'}],citation:{id:ordinary.id,quote:ordinary.text}}]};await run(root,{env:{FIXTURE_MEMORY_MODEL_RESPONSE:response(answer)}});
 const query=new QueryService(new Store(root));assert.equal(query.rows('claims').length,0);assert.equal(query.rows('moments').length,0);assert.equal(query.rows('contacts').length,0);assert.equal(query.rows('entities').length,0);const runs=path.join(root,'routines','remember-what-you-said','runs'),receipt=fs.readdirSync(runs).flatMap(day=>fs.readdirSync(path.join(runs,day)).map(name=>fs.readFileSync(path.join(runs,day,name),'utf8'))).join('\n');assert.match(receipt,/private-or-invalid/);assert.doesNotMatch(receipt,/Google/);
 }
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

test('the starter fallback round-trips colon-bearing fact values before deduplicating',async t=>{
 const root=workspace(t),first={id:'first-colon',at:'2026-11-02T12:00:00Z',text:'I moved to Hamburg: Germany on 1 November'},second={id:'second-colon',at:'2026-11-03T12:00:00Z',text:'I still live in Hamburg: Germany'};const answer=row=>({facts:[{subject:self,kind:'home-city',value:'Hamburg: Germany',citation:{id:row.id,quote:row.text}}]});archive(root,[first]);await run(root,{env:{FIXTURE_MEMORY_MODEL_RESPONSE:response(answer(first))}});const claims=path.join(root,'world','claims'),written=fs.readFileSync(path.join(claims,fs.readdirSync(claims)[0]),'utf8');assert.match(written,/value: "Hamburg: Germany"/);archive(root,[first,second]);await run(root,{env:{FIXTURE_MEMORY_MODEL_RESPONSE:response(answer(second))}});assert.equal(fs.readdirSync(claims).length,1);
});

test('the starter fallback recognizes a BOM-marked current claim',async t=>{
 const root=workspace(t),row={id:'bom-claim',at:'2026-11-02T12:00:00Z',text:'I moved to Hamburg on 1 November'},claims=path.join(root,'world','claims');fs.mkdirSync(claims,{recursive:true});fs.writeFileSync(path.join(claims,'hamburg.md'),'\ufeff---\nsubject: me\nattribute: lives-in\nvalue: Hamburg\nvalid_from: 2026-11-01\n---\nI moved to Hamburg on 1 November\n');archive(root,[row]);await run(root,{env:{FIXTURE_MEMORY_MODEL_RESPONSE:response(fact(row.id,row.text))}});assert.equal(fs.readdirSync(claims).length,1);
});

test('the starter fallback keeps a current new thing fact across archive runs',async t=>{
 const root=workspace(t),first={id:'first-thing',at:'2026-11-02T12:00:00Z',text:'The Robin project moved to Hamburg on 1 November'},second={...first,id:'second-thing',at:'2026-11-03T12:00:00Z'};archive(root,[first]);
 const answer=row=>({things:[{id:'robin-project',name:'Robin project'}],facts:[{subject:{kind:'new-thing',id:'robin-project'},kind:'home-city',value:'Hamburg',citation:{id:row.id,quote:row.text}}]});
 await run(root,{env:{FIXTURE_MEMORY_MODEL_RESPONSE:response(answer(first))}});archive(root,[first,second]);await run(root,{env:{FIXTURE_MEMORY_MODEL_RESPONSE:response(answer(second))}});
 assert.equal(fs.readdirSync(path.join(root,'world','claims')).length,1);
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

test('the notebook keeps distinct same-day events with the same participants',async t=>{
 const root=workspace(t),row={id:'equivalent-events',at:'2026-11-02T12:00:00Z',text:'I met Robin at the market to discuss a bright summer project today. I met Robin at the market to discuss a changing winter plan tonight.'};fs.writeFileSync(path.join(root,'NOTEBOOK.md'),notebookNoteText);new Store(root).save('contacts',{id:'robin',name:'Robin'});archive(root,[row]);
 const answer={events:[{what:'Met Robin at the market to discuss a bright summer project today',day:'2026-11-02',participants:[{kind:'contact',id:'robin'}],citation:{id:row.id,quote:'I met Robin at the market to discuss a bright summer project today'}},{what:'Met Robin at the market to discuss a changing winter plan tonight',day:'2026-11-02',participants:[{kind:'contact',id:'robin'}],citation:{id:row.id,quote:'I met Robin at the market to discuss a changing winter plan tonight'}}]};
 await run(root,{env:{FIXTURE_MEMORY_MODEL_RESPONSE:response(answer)}});assert.equal(new QueryService(new Store(root)).rows('moments').length,2);
});

test('the notebook keeps same-message events with distinct participant sets',async t=>{
 const root=workspace(t),row={id:'participant-sets',at:'2026-11-02T12:00:00Z',text:'I met Robin and discussed the project at the market today.'};fs.writeFileSync(path.join(root,'NOTEBOOK.md'),notebookNoteText);archive(root,[row]);
 const answer={people:[{id:'robin',name:'Robin'}],things:[{id:'project',name:'Project'}],events:[{what:'Met at the market',day:'2026-11-02',participants:[{kind:'new-person',id:'robin'}],citation:{id:row.id,quote:row.text}},{what:'Met at the market',day:'2026-11-02',participants:[{kind:'new-thing',id:'project'}],citation:{id:row.id,quote:row.text}}]};await run(root,{env:{FIXTURE_MEMORY_MODEL_RESPONSE:response(answer)}});
 const query=new QueryService(new Store(root));assert.equal(query.rows('moments').length,2);assert.equal(query.rows('moment_participants').length,1);assert.equal(query.rows('moment_entities').length,1);
});

test('the notebook files response-local people and things in equivalent events once',async t=>{
 for(const [type,collection] of [['new-person','people'],['new-thing','things']]){
  const root=workspace(t),first={id:type+'-first',at:'2026-11-02T12:00:00Z',text:'I met Robin at the market to discuss a bright summer project today.'},second={id:type+'-second',at:'2026-11-02T18:00:00Z',text:'I met Robin at the market to discuss a bright summer project tonight.'};fs.writeFileSync(path.join(root,'NOTEBOOK.md'),notebookNoteText);archive(root,[first]);
  const event=(row,id,what)=>({[collection]:[{id,name:'Robin'}],events:[{what,day:'2026-11-02',participants:[{kind:type,id}],citation:{id:row.id,quote:row.text}}]});
  await run(root,{env:{FIXTURE_MEMORY_MODEL_RESPONSE:response(event(first,'robin-first','Met Robin at the market to discuss a bright summer project today'))}});
  archive(root,[first,second]);await run(root,{env:{FIXTURE_MEMORY_MODEL_RESPONSE:response(event(second,'robin-second','Met Robin at the market to discuss a bright summer project today'))}});
  assert.equal(new QueryService(new Store(root)).rows('moments').length,1,type);
 }
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

test('the executable exits unsuccessfully when one archive piece fails',async t=>{
 const root=workspace(t),rows=Array.from({length:16},(_,index)=>({id:'piece-'+String(index).padStart(2,'0'),at:'2026-11-02T12:'+String(index).padStart(2,'0')+':00Z',text:'I recorded item '+index+' '+'.'.repeat(2900)}));archive(root,rows);
 const server=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const request=JSON.parse(body),failed=request.messages?.[1]?.content?.includes('piece-00');res.statusCode=failed?503:200;res.end(JSON.stringify(failed?{error:{message:'fixture failure'}}:{choices:[{message:{content:response({facts:[],events:[]})}}]}));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 fs.mkdirSync(path.join(root,'.godspeed'),{recursive:true});fs.writeFileSync(path.join(root,'.godspeed','provider.json'),JSON.stringify({url:'http://127.0.0.1:'+server.address().port+'/v1/chat/completions',key:'fixture-key',model:'fixture-model'}));
 const script=fileURLToPath(new URL('../scripts/memory-daily.mjs',import.meta.url)),child=spawn(process.execPath,[script],{cwd:root,env:{...process.env,GODSPEED_WORKSPACE:root},stdio:['ignore','ignore','pipe']});let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);const code=await new Promise(resolve=>child.on('close',resolve));
 assert.equal(code,1,stderr);assert.ok(fs.readdirSync(path.join(root,'routines','remember-what-you-said','runs')).length>0,'later pieces completed');
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
