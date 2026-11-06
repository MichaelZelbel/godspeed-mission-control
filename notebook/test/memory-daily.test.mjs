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
const answer=row=>({facts:[{subject:'self',kind:'home-city',value:'Hamburg',date:'2026-11-01',one_or_many:'one',confidence:'certain',citation:{id:row.id,quote:'I moved to Hamburg on 1 November'}}],people:[],things:[],events:[]});

test('the daily memory files a dated quoted fact once and retains the fact it replaces',async t=>{
 const root=workspace(t),store=new Store(root),query=new QueryService(store),domains=new Domains(query);domains.writeFact({label:'Home city',value:'Kiel',valid_from:'2026-01-01'});
 const row={id:'moved',at:'2026-11-01T12:00:00Z',text:'I moved to Hamburg on 1 November'};archive(root,[row]);let calls=0;
 const run=await rememberWhatYouSaid({root,store,query,domains,notebook:true,now,model:async()=>{calls++;return answer(row);}});
 assert.equal(run.completed,1);assert.equal(calls,1);const facts=query.rows('claims').filter(f=>f.attribute==='lives-in');assert.equal(facts.length,2);assert.equal(facts.find(f=>f.value==='Kiel').valid_to,'2026-11-01');assert.equal(facts.find(f=>f.value==='Hamburg').evidence_quote,row.text);
 await rememberWhatYouSaid({root,store,query,domains,notebook:true,now,model:async()=>{calls++;return answer(row);}});assert.equal(calls,1,'a consumed archive row is never sent again');
});

test('invalid quotes and machine prompts are refused without filing them',async t=>{
 const root=workspace(t),store=new Store(root),query=new QueryService(store),domains=new Domains(query);const human={id:'human',at:'2026-11-02T12:00:00Z',text:'I moved to Hamburg on 1 November'},machine={id:'machine',at:'2026-11-02T13:00:00Z',text:'[CRON RUN] never send this'};archive(root,[human,machine]);
 const result=await rememberWhatYouSaid({root,store,query,domains,notebook:true,now,model:async()=>({facts:[{subject:'self',kind:'home-city',value:'Hamburg',date:'2026-11-01',citation:{id:'human',quote:'not in the message'}}]})});
 assert.equal(result.completed,1);assert.equal(query.rows('claims').length,0);const state=JSON.parse(fs.readFileSync(path.join(root,'routines','remember-what-you-said','state.json')));assert.ok(state.consumed.includes('machine'));assert.ok(state.consumed.includes('human'));
});

test('the daily memory refuses credential fields and impossible dates without retaining credentials',async t=>{
 const root=workspace(t),store=new Store(root),query=new QueryService(store),domains=new Domains(query),ordinary='I moved to Hamburg on 1 November',secret='My password is swordfish',key='My key is swordfish, for the front door',row={id:'private',at:'2026-11-02T12:00:00Z',text:ordinary+'. '+secret+'. '+key+'.'};archive(root,[row]);
 const result=await rememberWhatYouSaid({root,store,query,domains,notebook:true,now,model:async()=>({people:[{name:'Key'}],things:[{name:'Key'}],facts:[{subject:'self',kind:'password',value:'swordfish',date:'2026-11-02',citation:{id:row.id,quote:ordinary}},{subject:'self',kind:'home-city',value:'api key',date:'2026-11-02',citation:{id:row.id,quote:ordinary}},{subject:'self',kind:'home-city',value:'key',date:'2026-11-02',citation:{id:row.id,quote:ordinary}},{subject:'self',kind:'key',value:'swordfish',date:'2026-11-02',citation:{id:row.id,quote:key}},{subject:'self',kind:'home-city',value:'Hamburg',date:'2026-11-02',citation:{id:row.id,quote:secret}},{subject:'self',kind:'home-city',value:'Hamburg',date:'2026-02-31',citation:{id:row.id,quote:ordinary}}],events:[{what:'Updated my password',day:'2026-11-02',citation:{id:row.id,quote:ordinary}},{what:'My key is swordfish',day:'2026-11-02',participants:['Key'],citation:{id:row.id,quote:key}},{what:'Moved to Hamburg',day:'2026-11-02',citation:{id:row.id,quote:secret}},{what:'Moved to Hamburg',day:'2026-02-31',citation:{id:row.id,quote:ordinary}}]})});
 assert.equal(result.completed,1);assert.equal(query.rows('claims').length,0);assert.equal(query.rows('moments').length,0);const receipt=fs.readFileSync(path.join(root,'routines','remember-what-you-said','runs','2026-11-07',fs.readdirSync(path.join(root,'routines','remember-what-you-said','runs','2026-11-07'))[0]),'utf8');assert.doesNotMatch(receipt,/swordfish|password|api key|My key/);
});

test('the daily memory preserves likely confidence in notebook claims',async t=>{
 const root=workspace(t),store=new Store(root),query=new QueryService(store),domains=new Domains(query),row={id:'likely',at:'2026-11-02T12:00:00Z',text:'I may have moved to Hamburg on 1 November'};archive(root,[row]);
 await rememberWhatYouSaid({root,store,query,domains,notebook:true,now,model:async()=>({facts:[{subject:'self',kind:'home-city',value:'Hamburg',date:'2026-11-01',confidence:'likely',citation:{id:row.id,quote:row.text}}]})});
 assert.equal(query.rows('claims').find(claim=>claim.value==='Hamburg').confidence,'likely');
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
 const reply={facts:[{subject:'self',kind:'home-city',value:'Hamburg',date:'2026-11-02',citation:{id:'done',quote:'I filed the tax return today'}}],events:[{what:'Filed the tax return',day:'2026-11-02',deadline_id:'tax',deadline_complete:true,citation:{id:'done',quote:'I filed the tax return today'}}]};let calls=0;
 const first=await rememberWhatYouSaid({root,store,query,domains,notebook:true,now,deadlines:[{slug:'tax',title:'Tax return',doneWhen:'I filed the tax return today'}],model:async()=>{calls++;return reply;},due:async()=>false});
 assert.equal(first.completed,0);assert.equal(query.rows('claims').length,0);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'routines','remember-what-you-said','state.json'))).consumed,[]);
 assert.doesNotMatch(fs.readFileSync(path.join(root,'routines','remember-what-you-said','pending',fs.readdirSync(path.join(root,'routines','remember-what-you-said','pending'))[0]),'utf8'),/private detail/,'the pending receipt retains IDs and quotes only');
 const second=await rememberWhatYouSaid({root,store,query,domains,notebook:true,now,deadlines:[{slug:'tax',title:'Tax return',doneWhen:'I filed the tax return today'}],model:async()=>{calls++;return reply;},due:async()=>true});
 assert.equal(second.completed,1);assert.equal(calls,1);assert.equal(query.rows('claims').length,1);
});
