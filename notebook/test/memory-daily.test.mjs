import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Store} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {qualifiesMessage,rememberWhatYouSaid} from '../core/memory-daily.mjs';

const now=new Date('2026-11-07T04:00:00Z');
const workspace=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-memory-daily-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));fs.mkdirSync(path.join(root,'prompts','archive'),{recursive:true});return root;};
const archive=(root,rows)=>fs.writeFileSync(path.join(root,'prompts','archive','laptop-2026-11.jsonl'),rows.map(JSON.stringify).join('\n')+'\n');
const self={kind:'self'};
const answer=row=>({facts:[{subject:self,kind:'home-city',value:'Hamburg',date:'2026-11-01',one_or_many:'one',confidence:'certain',citation:{id:row.id,quote:'I moved to Hamburg on 1 November'}}],people:[],things:[],events:[]});

test('the daily memory files a dated quoted fact once and retains the fact it replaces',async t=>{
 const root=workspace(t),store=new Store(root),query=new QueryService(store),domains=new Domains(query);domains.writeFact({label:'Home city',value:'Kiel',valid_from:'2026-01-01'});
 const row={id:'moved',at:'2026-11-01T12:00:00Z',text:'I moved to Hamburg on 1 November'};archive(root,[row]);let calls=0;
 const run=await rememberWhatYouSaid({root,store,query,domains,notebook:true,now,model:async()=>{calls++;return answer(row);}});
 assert.equal(run.completed,1);assert.equal(calls,1);const facts=query.rows('claims').filter(f=>f.attribute==='lives-in');assert.equal(facts.length,2);assert.equal(facts.find(f=>f.value==='Kiel').valid_to,'2026-11-01');assert.equal(facts.find(f=>f.value==='Hamburg').evidence_quote,row.text);
 await rememberWhatYouSaid({root,store,query,domains,notebook:true,now,model:async()=>{calls++;return answer(row);}});assert.equal(calls,1,'a consumed archive row is never sent again');
});

test('concurrent daily-memory runs submit one archive piece once',async t=>{
 const root=workspace(t),row={id:'once',at:'2026-11-02T12:00:00Z',text:'I moved to Hamburg on 1 November'};archive(root,[row]);let calls=0,entered,release;const started=new Promise(resolve=>entered=resolve),gate=new Promise(resolve=>release=resolve),model=async()=>{calls++;entered();await gate;return answer(row);};
 const first=rememberWhatYouSaid({root,now,model});await started;const second=rememberWhatYouSaid({root,now,model});await new Promise(resolve=>setTimeout(resolve,30));assert.equal(calls,1,'the waiting run has not sent the same private message');release();const [one,two]=await Promise.all([first,second]);assert.equal(calls,1);assert.equal(one.completed+two.completed,1);
});

test('an interrupted notebook event recovers every participant before consuming its receipt',async t=>{
 const root=workspace(t),row={id:'event-recovery',at:'2026-11-02T12:00:00Z',text:'Alex and the project launched today'},reply={people:[{id:'alex',name:'Alex'}],things:[{id:'project',name:'Project'}],events:[{what:'Alex and the project launched',day:'2026-11-02',participants:[{kind:'new-person',id:'alex'},{kind:'new-thing',id:'project'}],citation:{id:'event-recovery',quote:'Alex and the project launched today'}}]};archive(root,[row]);const store=new Store(root),query=new QueryService(store),domains=new Domains(query);let calls=0;store.failAfter=3;
 const interrupted=await rememberWhatYouSaid({root,store,query,domains,notebook:true,now,model:async()=>{calls++;return reply;}});assert.equal(interrupted.completed,0);assert.equal(interrupted.failed,1);assert.equal(fs.readdirSync(path.join(root,'routines','remember-what-you-said','pending')).length,1,'the receipt remains pending after its moment is written');
 store.failAfter=null;const recoveredStore=new Store(root),recoveredQuery=new QueryService(recoveredStore),recoveredDomains=new Domains(recoveredQuery);const recovered=await rememberWhatYouSaid({root,store:recoveredStore,query:recoveredQuery,domains:recoveredDomains,notebook:true,now,model:async()=>{calls++;return reply;}});assert.equal(recovered.completed,1);assert.equal(calls,1,'receipt recovery does not send the archive piece again');assert.equal(recoveredQuery.rows('moments').length,1);assert.equal(recoveredQuery.rows('moment_participants').length,1);assert.equal(recoveredQuery.rows('moment_entities').length,1);
});

test('invalid quotes and machine prompts are refused without filing them',async t=>{
 const root=workspace(t),store=new Store(root),query=new QueryService(store),domains=new Domains(query);const human={id:'human',at:'2026-11-02T12:00:00Z',text:'I moved to Hamburg on 1 November'},machine={id:'machine',at:'2026-11-02T13:00:00Z',text:'[CRON RUN] never send this'};archive(root,[human,machine]);
 const result=await rememberWhatYouSaid({root,store,query,domains,notebook:true,now,model:async()=>({facts:[{subject:self,kind:'home-city',value:'Hamburg',date:'2026-11-01',citation:{id:'human',quote:'not in the message'}}]})});
 assert.equal(result.completed,1);assert.equal(query.rows('claims').length,0);const state=JSON.parse(fs.readFileSync(path.join(root,'routines','remember-what-you-said','state.json')));assert.ok(state.consumed.includes('machine'));assert.ok(state.consumed.includes('human'));
});

test('the daily memory refuses credential fields and impossible dates without retaining credentials',async t=>{
 const root=workspace(t),store=new Store(root),query=new QueryService(store),domains=new Domains(query),ordinary='I moved to Hamburg on 1 November',secret='My password is swordfish',key='My key is swordfish, for the front door',spellings=['api_key','apikey','private_key','privatekey'],credentialFacts=spellings.map(kind=>{const quote=`My ${kind} is swordfish`;return {subject:'self',kind,value:'swordfish',date:'2026-11-02',citation:{id:'private',quote}};}),row={id:'private',at:'2026-11-02T12:00:00Z',text:[ordinary,secret,key,...credentialFacts.map(({citation})=>citation.quote)].join('. ')+'.'};archive(root,[row]);
 const result=await rememberWhatYouSaid({root,store,query,domains,notebook:true,now,model:async()=>({people:[{id:'person-key',name:'Key'}],things:[{id:'thing-key',name:'Key'}],facts:[{subject:self,kind:'password',value:'swordfish',date:'2026-11-02',citation:{id:row.id,quote:ordinary}},{subject:self,kind:'home-city',value:'api key',date:'2026-11-02',citation:{id:row.id,quote:ordinary}},{subject:self,kind:'home-city',value:'key',date:'2026-11-02',citation:{id:row.id,quote:ordinary}},{subject:self,kind:'key',value:'swordfish',date:'2026-11-02',citation:{id:row.id,quote:key}},{subject:self,kind:'home-city',value:'Hamburg',date:'2026-11-02',citation:{id:row.id,quote:secret}},{subject:self,kind:'home-city',value:'Hamburg',date:'2026-02-31',citation:{id:row.id,quote:ordinary}},...credentialFacts.map(item=>({...item,subject:self}))],events:[{what:'Updated my password',day:'2026-11-02',participants:[],citation:{id:row.id,quote:ordinary}},{what:'My key is swordfish',day:'2026-11-02',participants:[{kind:'new-person',id:'person-key'}],citation:{id:row.id,quote:key}},{what:'Moved to Hamburg',day:'2026-11-02',participants:[],citation:{id:row.id,quote:secret}},{what:'Moved to Hamburg',day:'2026-02-31',participants:[],citation:{id:row.id,quote:ordinary}}]})});
 assert.equal(result.completed,1);assert.equal(query.rows('claims').length,0);assert.equal(query.rows('moments').length,0);const receipt=fs.readFileSync(path.join(root,'routines','remember-what-you-said','runs','2026-11-07',fs.readdirSync(path.join(root,'routines','remember-what-you-said','runs','2026-11-07'))[0]),'utf8');assert.doesNotMatch(receipt,/swordfish|password|api key|My key|api_key|apikey|private_key|privatekey/);
});

test('the daily memory preserves likely confidence in notebook claims',async t=>{
 const root=workspace(t),store=new Store(root),query=new QueryService(store),domains=new Domains(query),row={id:'likely',at:'2026-11-02T12:00:00Z',text:'I may have moved to Hamburg on 1 November'};archive(root,[row]);
 await rememberWhatYouSaid({root,store,query,domains,notebook:true,now,model:async()=>({facts:[{subject:self,kind:'home-city',value:'Hamburg',date:'2026-11-01',confidence:'likely',citation:{id:row.id,quote:row.text}}]})});
 assert.equal(query.rows('claims').find(claim=>claim.value==='Hamburg').confidence,'likely');
});

test('the daily memory resolves subjects by typed IDs, not matching display names',async t=>{
 const root=workspace(t),store=new Store(root),query=new QueryService(store),domains=new Domains(query),row={id:'same-name',at:'2026-11-02T12:00:00Z',text:'My cat Robin moved to Hamburg'};store.save('contacts',{id:'person-robin',name:'Robin'});store.save('entities',{id:'thing-robin',name:'Robin'});archive(root,[row]);
 await rememberWhatYouSaid({root,store,query,domains,notebook:true,now,model:async()=>({facts:[{subject:{kind:'entity',id:'thing-robin'},kind:'home-city',value:'Hamburg',citation:{id:row.id,quote:row.text}}],events:[{what:'Robin moved to Hamburg',day:'2026-11-02',participants:[{kind:'entity',id:'thing-robin'}],citation:{id:row.id,quote:row.text}}]})});
 const claim=query.rows('claims').find(item=>item.value==='Hamburg');assert.equal(claim.subject_type,'entity');assert.equal(claim.subject_id,'thing-robin');assert.equal(query.rows('moment_entities')[0].entity_id,'thing-robin');assert.equal(query.rows('moment_participants').length,0);
});

test('the first run sends only the seven-day archive window',async t=>{
 const root=workspace(t),old={id:'old',at:'2026-10-31T12:00:00Z',text:'I moved to Oldtown on 31 October'},current={id:'current',at:'2026-11-02T12:00:00Z',text:'I moved to Hamburg on 1 November'};archive(root,[old,current]);let request;
 await rememberWhatYouSaid({root,now,model:async input=>{request=JSON.parse(input.prompt);return answer(current);}});
 assert.deepEqual(request.messages.map(message=>message.id),['current']);
});

test('the daily memory sends ordered archive pieces no larger than 40,000 bytes',async t=>{
 const root=workspace(t),rows=Array.from({length:16},(_,index)=>({id:'piece-'+String(index).padStart(2,'0'),at:'2026-11-02T12:'+String(index).padStart(2,'0')+':00Z',text:'I recorded item '+index+' '+'.'.repeat(2900)}));archive(root,rows);const requests=[];
 await rememberWhatYouSaid({root,now,model:async input=>{const request=JSON.parse(input.prompt);requests.push(request.messages);return {facts:[],events:[]};}});
 assert.ok(requests.length>1);assert.ok(requests.every(messages=>Buffer.byteLength(JSON.stringify(messages))<=40000));assert.deepEqual(requests.flat().map(message=>message.id),rows.map(row=>row.id));
});

test('the daily memory matches every machine-banner form the archive collector rejects',()=>{
 const cases=[['[WORK ORDER from the company] do this',true],['[CONTEXT COMPACTION - REFERENCE ONLY] context',true],['[IMPORTANT: scheduled work] context',true],['[ABC] scheduled work',true],['[AB] a message the person typed',false],['[CRON RUN] scheduled work',true],['[Cron delivery: morning-brief] brief',true],['[Webhook delivery: mc-notice] notice',true],['[Sam] a message the person typed',false],['[Replying to: "x"] a message the person typed',false],['[cron delivery: lower case] a message the person typed',false],['[Cron deliveries: ordinary words] a message the person typed',false],['a prefix [CRON RUN] a message the person typed',false]];
 const script=`import importlib.machinery, importlib.util, json, sys
loader=importlib.machinery.SourceFileLoader('collector',sys.argv[1])
spec=importlib.util.spec_from_loader(loader.name,loader)
collector=importlib.util.module_from_spec(spec)
loader.exec_module(collector)
print(json.dumps([bool(collector.MACHINE_BANNER.match(text)) for text in json.load(sys.stdin)]))`;
 const collector=spawnSync(process.env.PYTHON||'python3',['-c',script,fileURLToPath(new URL('../../tools/mc-prompt-archive',import.meta.url))],{input:JSON.stringify(cases.map(([text])=>text)),encoding:'utf8'});assert.equal(collector.status,0,collector.stderr);assert.deepEqual(JSON.parse(collector.stdout),cases.map(([,machine])=>machine));
 for(const [index,[text,machine]] of cases.entries())assert.equal(qualifiesMessage({id:'banner-'+index,at:'2026-11-02T12:00:00Z',text}).reason==='machine-prompt',machine,text);
});

test('a failed model piece remains eligible for the next night',async t=>{
 const root=workspace(t),row={id:'retry',at:'2026-11-02T12:00:00Z',text:'I moved to Hamburg on 1 November'};archive(root,[row]);let calls=0;
 const failed=await rememberWhatYouSaid({root,now,model:async()=>{calls++;throw Error('offline');}});assert.equal(failed.failed,1);assert.equal(calls,3);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'routines','remember-what-you-said','state.json'))).consumed,[]);
 const done=await rememberWhatYouSaid({root,now,model:async()=>answer(row)});assert.equal(done.completed,1);assert.ok(fs.existsSync(path.join(root,'world','claims')),'a starter writes the world fallback');
});

test('a refused deadline leaves its prepared piece unread and recovery does not ask the model again',async t=>{
 const root=workspace(t),store=new Store(root),query=new QueryService(store),domains=new Domains(query),row={id:'done',at:'2026-11-02T12:00:00Z',text:'I filed the tax return today; keep this private detail out of the receipt'};archive(root,[row]);
 const reply={facts:[{subject:self,kind:'home-city',value:'Hamburg',date:'2026-11-02',citation:{id:'done',quote:'I filed the tax return today'}}],events:[{what:'Filed the tax return',day:'2026-11-02',participants:[],deadline_id:'tax',deadline_complete:true,citation:{id:'done',quote:'I filed the tax return today'}}]};let calls=0;
 const first=await rememberWhatYouSaid({root,store,query,domains,notebook:true,now,deadlines:[{slug:'tax',title:'Tax return',doneWhen:'I filed the tax return today'}],model:async()=>{calls++;return reply;},due:async()=>false});
 assert.equal(first.completed,0);assert.equal(query.rows('claims').length,0);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'routines','remember-what-you-said','state.json'))).consumed,[]);
 assert.doesNotMatch(fs.readFileSync(path.join(root,'routines','remember-what-you-said','pending',fs.readdirSync(path.join(root,'routines','remember-what-you-said','pending'))[0]),'utf8'),/private detail/,'the pending receipt retains IDs and quotes only');
 const second=await rememberWhatYouSaid({root,store,query,domains,notebook:true,now,deadlines:[{slug:'tax',title:'Tax return',doneWhen:'I filed the tax return today'}],model:async()=>{calls++;return reply;},due:async()=>true});
 assert.equal(second.completed,1);assert.equal(calls,1);assert.equal(query.rows('claims').length,1);
});
