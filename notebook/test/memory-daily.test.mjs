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
import {archivePieces,qualifiesMessage,rememberWhatYouSaid} from '../core/memory-daily.mjs';
import {frontMatter} from '../core/world-facts.mjs';

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

test('the daily memory refuses relabeled credentials and employer names from their cited source context',async t=>{
 const root=workspace(t),store=new Store(root),query=new QueryService(store),domains=new Domains(query),row={id:'relabeled-private',at:'2026-11-02T12:00:00Z',text:'My password is swordfish. My employer is Acme.'};archive(root,[row]);
 const result=await rememberWhatYouSaid({root,store,query,domains,notebook:true,now,model:async()=>({facts:[{subject:self,kind:'home-city',value:'swordfish',date:'2026-11-02',citation:{id:row.id,quote:'swordfish'}},{subject:self,kind:'home-city',value:'Acme',date:'2026-11-02',citation:{id:row.id,quote:'Acme'}}]})});
 assert.equal(result.completed,1);assert.equal(query.rows('claims').length,0);const receipt=fs.readFileSync(path.join(root,'routines','remember-what-you-said','runs','2026-11-07',fs.readdirSync(path.join(root,'routines','remember-what-you-said','runs','2026-11-07'))[0]),'utf8');assert.doesNotMatch(receipt,/swordfish|Acme|password|employer/);
});

test('the daily memory refuses citations spanning private sentence punctuation',async t=>{
 const root=workspace(t),store=new Store(root),query=new QueryService(store),domains=new Domains(query),row={id:'spanning-private',at:'2026-11-02T12:00:00Z',text:'My password is swordfish. I moved to Hamburg on 1 November.'},citation={id:'spanning-private',quote:'swordfish. I moved to Hamburg on 1 November'};archive(root,[row]);
 const result=await rememberWhatYouSaid({root,store,query,domains,notebook:true,now,model:async()=>({facts:[{subject:self,kind:'home-city',value:'Hamburg',date:'2026-11-01',citation}],events:[{what:'Moved to Hamburg',day:'2026-11-01',participants:[],citation}]})});
 assert.equal(result.completed,1);assert.equal(query.rows('claims').length,0);assert.equal(query.rows('moments').length,0);const receipt=fs.readFileSync(path.join(root,'routines','remember-what-you-said','runs','2026-11-07',fs.readdirSync(path.join(root,'routines','remember-what-you-said','runs','2026-11-07'))[0]),'utf8');assert.doesNotMatch(receipt,/swordfish|password|Hamburg/);
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

test('a later deadline refusal leaves every selected piece unconsumed until recovery',async t=>{
 const root=workspace(t),store=new Store(root),query=new QueryService(store),domains=new Domains(query),rows=Array.from({length:16},(_,index)=>({id:'deadline-piece-'+String(index).padStart(2,'0'),at:'2026-11-02T12:'+String(index).padStart(2,'0')+':00Z',text:index===15?'I filed the tax return today. '+'.'.repeat(2870):'I recorded item '+index+' '+'.'.repeat(2900)}));archive(root,rows);let calls=0,dueCalls=0;
 const model=async input=>{calls++;const ids=JSON.parse(input.prompt).messages.map(message=>message.id);return ids.includes(rows[15].id)?{events:[{what:'Filed the tax return',day:'2026-11-02',participants:[],deadline_id:'tax',deadline_complete:true,citation:{id:rows[15].id,quote:'I filed the tax return today'}}]}:{facts:[],events:[]};};
 const deadline={slug:'tax',title:'Tax return',doneWhen:'I filed the tax return today'},first=await rememberWhatYouSaid({root,store,query,domains,notebook:true,now,deadlines:[deadline],model,due:async()=>{dueCalls++;return false;}});
 assert.equal(first.completed,1);assert.equal(first.failed,1);assert.equal(calls,2);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'routines','remember-what-you-said','state.json'))).consumed,[]);
 const second=await rememberWhatYouSaid({root,store,query,domains,notebook:true,now,deadlines:[deadline],model,due:async()=>{dueCalls++;return true;}});
 assert.equal(second.completed,2);assert.equal(calls,2,'recovery uses both prepared receipts');assert.equal(dueCalls,2);assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'routines','remember-what-you-said','state.json'))).consumed.sort(),rows.map(row=>row.id).sort());
});

test('a malformed persisted plan is never passed to daily-memory recovery',async t=>{
 const root=workspace(t),store=new Store(root),query=new QueryService(store),domains=new Domains(query),row={id:'malformed-recovery',at:'2026-11-02T12:00:00Z',text:'I moved to Hamburg on 1 November'},piece=archivePieces([{...row,ok:true}])[0];archive(root,[row]);const pending=path.join(root,'routines','remember-what-you-said','pending');fs.mkdirSync(pending,{recursive:true});fs.writeFileSync(path.join(pending,piece.id+'.json'),JSON.stringify({id:piece.id,message_ids:[row.id],plan:{people:[],things:[],effects:[{type:'fact'}]}}));
 await rememberWhatYouSaid({root,store,query,domains,notebook:true,now,model:async()=>answer(row)});
 assert.equal(query.rows('claims').length,1);assert.throws(()=>domains.writeDailyMemory({people:[],things:[],effects:[{type:'fact'}]}),/invalid plan/);
});

test('a message read before a refused deadline is not sent again when a newer message arrives',async t=>{
 const root=workspace(t),store=new Store(root),query=new QueryService(store),domains=new Domains(query),first={id:'read-a',at:'2026-11-02T12:00:00Z',text:'I filed the tax return today. As promised.'},second={id:'read-b',at:'2026-11-03T12:00:00Z',text:'I moved to Hamburg on 1 November'},sent=[];
 const deadline={slug:'tax',title:'Tax return',doneWhen:'I filed the tax return today'},model=async input=>{const ids=JSON.parse(input.prompt).messages.map(message=>message.id);sent.push(ids);return ids.includes('read-a')&&!sent.some((_,index)=>index>0)?{events:[{what:'Filed the tax return',day:'2026-11-02',participants:[],deadline_id:'tax',deadline_complete:true,citation:{id:'read-a',quote:'I filed the tax return today'}}]}:{events:[]};};
 archive(root,[first]);const refused=await rememberWhatYouSaid({root,store,query,domains,notebook:true,now,deadlines:[deadline],model,due:async()=>false});assert.equal(refused.completed,0);
 archive(root,[first,second]);const later=await rememberWhatYouSaid({root,store,query,domains,notebook:true,now,deadlines:[deadline],model,due:async()=>true});
 assert.deepEqual(sent,[['read-a'],['read-b']],'the recovered message goes to the AI once, and only the new one is sent');assert.equal(later.completed,2);
});

test('a starter entity file is reused, not rewritten, when the routine names the same person',async t=>{
 const root=workspace(t),entity=path.join(root,'world','entities','peter-mueller.md'),original='---\nslug: peter-mueller\nname: Peter Mueller\naliases: [Peter, Pete]\nmenerio_id: p-1\n---\nOld friend from school.\n';fs.mkdirSync(path.dirname(entity),{recursive:true});fs.writeFileSync(entity,original);
 const row={id:'peter',at:'2026-11-02T12:00:00Z',text:'Pete just moved to Hamburg, I heard today'};archive(root,[row]);
 for(const [name,id] of [['Peter Mueller','a'],['Pete','b']]){await rememberWhatYouSaid({root,now,model:async()=>({people:[{id,name}],facts:[{subject:{kind:'new-person',id},kind:'home-city',value:'Hamburg',date:'2026-11-02',one_or_many:'one',citation:{id:'peter',quote:'Pete just moved to Hamburg'}}]})});
  fs.rmSync(path.join(root,'routines'),{recursive:true,force:true});}
 assert.equal(fs.readFileSync(entity,'utf8'),original);assert.deepEqual(fs.readdirSync(path.join(root,'world','entities')),['peter-mueller.md']);
 assert.deepEqual(fs.readdirSync(path.join(root,'world','claims')).map(n=>n.split('--')[0]),['peter-mueller'],'an alias fact already filed is not filed twice');
});

test('a world file the starter formats allow is read the way it was written',()=>{
 const text='---\nsubject: me\nattribute: lives-in\nvalue: "you" said it\nnickname: *Bear*\nproject: [draft] memoir\npriority: #1 priority\nowner: null\naliases: [Peter, "Pete"]\n---\nbody\n',{fields,body}=frontMatter(text);
 assert.deepEqual({value:fields.value,nickname:fields.nickname,project:fields.project,priority:fields.priority,owner:fields.owner,aliases:fields.aliases,body},{value:'"you" said it',nickname:'*Bear*',project:'[draft] memoir',priority:'#1 priority',owner:'',aliases:["Peter","Pete"],body:'body'});
});

test('a hand-written entity of any other type is reused for a thing of that name',async t=>{
 const root=workspace(t),dir=path.join(root,'world','entities');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'bluebird-garden.md'),'---\nslug: bluebird-garden\nname: Bluebird Garden\ntype: project\n---\n');
 const row={id:'garden',at:'2026-11-02T12:00:00Z',text:'The Bluebird Garden opened in Hamburg today'};archive(root,[row]);
 await rememberWhatYouSaid({root,now,model:async()=>({things:[{id:'g',name:'Bluebird Garden'}],facts:[{subject:{kind:'new-thing',id:'g'},kind:'city',value:'Hamburg',date:'2026-11-02',one_or_many:'one',citation:{id:'garden',quote:'Bluebird Garden opened in Hamburg'}}]})});
 assert.deepEqual(fs.readdirSync(dir),['bluebird-garden.md']);assert.match(fs.readdirSync(path.join(root,'world','claims'))[0],/^bluebird-garden--/);
});

test('an impossible model date refuses that item and files the rest',async t=>{
 const root=workspace(t),row={id:'dates',at:'2026-11-02T12:00:00Z',text:'I moved to Hamburg on 1 November'};archive(root,[row]);
 const good=answer(row).facts[0],bad={...good,kind:'work-city',value:'Berlin',date:'2026-13-01'};
 const result=await rememberWhatYouSaid({root,now,model:async()=>({facts:[bad,good]})});
 assert.equal(result.completed,1);assert.equal(result.failed,0);assert.equal(fs.readdirSync(path.join(root,'world','claims')).length,1);
 const logs=fs.readdirSync(path.join(root,'routines','remember-what-you-said','runs','2026-11-07')).map(n=>fs.readFileSync(path.join(root,'routines','remember-what-you-said','runs','2026-11-07',n),'utf8')).join('');assert.match(logs,/private-or-invalid/);
});

test('messages of an applied receipt whose deadline piece was refused are not sent again',async t=>{
 const root=workspace(t),store=new Store(root),query=new QueryService(store),domains=new Domains(query),rows=Array.from({length:16},(_,index)=>({id:'p-'+String(index).padStart(2,'0'),at:'2026-11-02T12:'+String(index).padStart(2,'0')+':00Z',text:index===15?'I filed the tax return today. '+'.'.repeat(2870):'I recorded item '+index+' '+'.'.repeat(2900)}));archive(root,rows);const sent=[];
 const model=async input=>{const ids=JSON.parse(input.prompt).messages.map(m=>m.id);sent.push(ids);return ids.includes('p-15')?{events:[{what:'Filed the tax return',day:'2026-11-02',participants:[],deadline_id:'tax',deadline_complete:true,citation:{id:'p-15',quote:'I filed the tax return today'}}]}:{events:[]};};
 const deadline={slug:'tax',title:'Tax return',doneWhen:'I filed the tax return today'},go=due=>rememberWhatYouSaid({root,store,query,domains,notebook:true,now,deadlines:[deadline],model,due});
 await go(async()=>false);const earlier=sent.length;
 archive(root,[...rows,{id:'p-new',at:'2026-11-03T12:00:00Z',text:'A new note today'}]);await go(async()=>true);
 assert.deepEqual(sent.slice(earlier),[['p-new']]);
});
