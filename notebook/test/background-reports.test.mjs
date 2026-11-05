import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {chatContext} from '../core/chat-context.mjs';
import {queueNotice,readNotices} from '../core/notices.mjs';import {openStep,heard} from '../core/waiting-steps.mjs';import {sayNotice,recordRoutine,delivered,REPORT_CONTRACT} from '../core/background-reports.mjs';

// BACKGROUND REPORTS (4 November 2026, #198): a notice is written with the chat's guidance, recorded
// where the chat reads it, and the chat's next reply is told about it.
const python=['python3','python'].find(p=>{try{execFileSync(p,['--version'],{stdio:'ignore'});return true;}catch{return false;}});
function setup(t,{telegram=true}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-reports-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const home=path.join(root,'.hermes-home');fs.mkdirSync(home);fs.mkdirSync(path.join(root,'profile'));
 fs.writeFileSync(path.join(home,'SOUL.md'),'Fictional persona: warm and brief.');fs.writeFileSync(path.join(root,'AGENTS.md'),'Fictional manual: explain from zero.');
 if(telegram)fs.writeFileSync(path.join(home,'.env'),'TELEGRAM_BOT_TOKEN=123:abc\n');
 return {root,home,store:new Store(root,{device:'pc'})};
}
const provider=(reports,seen=[])=>async input=>{seen.push(input);return JSON.stringify({reports});};
const records=store=>[...store.records.values()].filter(r=>r.type==='conversation_messages'&&r.id.startsWith('background-report-'));
const notice={id:'backup-1',text:"Last night's backup failed.",about:'last night\'s backup',facts:['The backup could not reach the disk.'],step:'step-9f3a2c'};

test('a queued notice is written with the chat\'s guidance and recorded',async t=>{
 const {store,home}=setup(t),seen=[];
 const {text}=await sayNotice(store,{notice,home,provider:provider([{about:'last night\'s backup',text:'Your backup did not run last night, because the disk was out of reach.'}],seen)});
 assert.equal(text,'Your backup did not run last night, because the disk was out of reach.');
 assert.match(seen[0].guidance.who_it_is,/warm and brief/);assert.match(seen[0].guidance.manual,/explain from zero/);
 assert.doesNotMatch(seen[0].contract,/word for word/i);assert.equal(seen[0].contract,REPORT_CONTRACT);
 const [saved,...none]=records(store);assert.equal(none.length,0);
 assert.deepEqual([saved.role,saved.source_app,saved.conversation_id,saved.delivered_to,saved.report.written],['assistant','background','telegram-owner','telegram','assistant']);
 assert.deepEqual(saved.report.facts,notice.facts);assert.deepEqual(saved.report.steps,[notice.step]);assert.ok(saved.sent_at);
});

test('the next chat turn\'s context contains the report, and so does the plugin\'s block',async t=>{
 const {root,store,home}=setup(t);
 const {text}=await sayNotice(store,{notice,home,provider:provider([{about:'backup',text:'Your backup did not run last night.'}])});
 const context=chatContext(new QueryService(store),{conversation_id:'telegram-owner',message:'what is this about?'});
 assert.ok(context.messages.some(m=>m.role==='assistant'&&m.content===text));
 if(!python)return t.skip('needs Python');
 const plugin=fileURLToPath(new URL('../assistant-files/godspeed-context/__init__.py',import.meta.url));
 const block=(platform,hours=0)=>execFileSync(python,['-I','-c','import importlib.util,sys,time;s=importlib.util.spec_from_file_location("p",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(m.reports_block(sys.argv[2],sys.argv[3],time.time()+float(sys.argv[4])*3600))',plugin,root,platform,String(hours)],{encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'}}).trim();
 const now=block('telegram');
 assert.match(now,/^\[godspeed-reports\]/);assert.match(now,/Your backup did not run last night\./);assert.match(now,/A step waits for their yes\./);assert.ok(!now.includes('step-9f3a2c'),'the step id is never shown');
 assert.equal(block('cli'),'None','a report sent to Telegram is not for the notebook\'s chat');
 assert.equal(block('telegram',25),'None','a day later it is no longer listed');
 const dir=path.join(root,'plugin');fs.mkdirSync(dir);fs.copyFileSync(plugin,path.join(dir,'__init__.py'));fs.writeFileSync(path.join(dir,'mission-control.txt'),root);
 const hook=platform=>JSON.parse(execFileSync(python,['-I','-c','import importlib.util,sys,json;s=importlib.util.spec_from_file_location("p",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(json.dumps(m.on_pre_llm_call(user_message="what is this about?",platform=sys.argv[2])))',path.join(dir,'__init__.py'),platform],{encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'}}).trim());
 const reply=hook('telegram').context;
 assert.match(reply,/\[godspeed-reports\]/);assert.ok(reply.includes(text),'the next reply is told what was delivered');
 assert.equal(hook('cron'),null,'a scheduled run is not told');
});

test('two unrelated facts become two reports, said one at a time',async t=>{
 const {store,home}=setup(t),seen=[];
 const two=provider([{about:'backup',text:'Your backup failed.'},{about:'voice',text:'Your voice replies stopped.'}],seen);
 assert.equal((await sayNotice(store,{notice,home,provider:two})).text,'Your backup failed.');
 const second=readNotices(store).find(n=>n.id==='backup-1~2');
 assert.equal(second.text,'Your voice replies stopped.');assert.equal(second.written,true);
 assert.deepEqual(second.facts,notice.facts);assert.equal(second.step,notice.step);
 assert.equal((await sayNotice(store,{notice:second,home,provider:two})).text,'Your voice replies stopped.');
 assert.equal(seen.length,1,'a report already written asks the AI nothing');assert.equal(records(store).length,2);
 const [,persisted]=records(store).sort((a,b)=>a.sent_at<b.sent_at?-1:1);
 assert.deepEqual([persisted.report.facts,persisted.report.steps],[notice.facts,[notice.step]],'the second report keeps the facts and the waiting step');
});

test('with the AI unavailable or refused, the plain text goes out and is recorded',async t=>{
 const {store,home}=setup(t,{telegram:false});
 const cases=[null,async()=>{throw Error('down');},provider([{about:'backup',text:'Reply approve 59f1d506 to go on.'}]),provider([{about:'backup',text:'The step step-9f3a2c waits.'}]),async()=>'not json'];
 for(const ai of cases)assert.equal((await sayNotice(store,{notice,home,provider:ai})).text,notice.text);
 const saved=records(store);assert.equal(saved.length,cases.length);
 assert.ok(saved.every(r=>r.report.written==='fallback'&&r.content===notice.text&&r.conversation_id===null&&r.delivered_to==='notebook'));
});

test('a notice queued with no facts is written from its text',t=>{
 const {store}=setup(t);queueNotice(store,{id:'n1',text:' Plain. '});
 assert.deepEqual(readNotices(store)[0].facts,['Plain.']);
});

test('the plugin lists at most the five newest reports, newest first',async t=>{
 if(!python)return t.skip('needs Python');
 const {root,store,home}=setup(t),{recordReport}=await import('../core/background-reports.mjs');
 // Saved oldest-last by name, so neither file order nor id order is the time order.
 for(const [i,minutes] of [3,40,10,60,25,5].entries())await recordReport(store,{text:'Report '+minutes,delivery:'telegram',written:'assistant',at:new Date(Date.now()-minutes*60000+i)});
 const plugin=fileURLToPath(new URL('../assistant-files/godspeed-context/__init__.py',import.meta.url));
 const block=execFileSync(python,['-I','-c','import importlib.util,sys;s=importlib.util.spec_from_file_location("p",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(m.reports_block(sys.argv[2],sys.argv[3]))',plugin,root,'telegram'],{encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'}});
 const seen=[...block.matchAll(/Report (\d+)/g)].map(m=>Number(m[1]));
 assert.deepEqual(seen,[3,5,10,25,40],'five, the most recent first; the oldest left out');
});

test('the plugin lists a waiting step on a report persisted with the scalar step',async t=>{
 if(!python)return t.skip('needs Python');
 const {root,store}=setup(t),{recordReport}=await import('../core/background-reports.mjs');
 const saved=await recordReport(store,{text:'Report old',delivery:'telegram',written:'assistant',steps:['step-9f3a2c']});
 const file=path.join(root,'notebook','_system','conversation_messages',saved.id+'.json'),record=JSON.parse(fs.readFileSync(file,'utf8'));
 const {steps,...report}=record.report;fs.writeFileSync(file,JSON.stringify({...record,report:{...report,step:steps[0]}}));
 const plugin=fileURLToPath(new URL('../assistant-files/godspeed-context/__init__.py',import.meta.url));
 const block=execFileSync(python,['-I','-c','import importlib.util,sys;s=importlib.util.spec_from_file_location("p",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(m.reports_block(sys.argv[2],sys.argv[3]))',plugin,root,'telegram'],{encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'}});
 assert.ok(!JSON.parse(fs.readFileSync(file,'utf8')).report.steps);assert.match(block,/A step waits for their yes\./);
});

// A routine made in Settings (--skill ... --deliver) is recorded by the wrapper the scheduler plugin
// puts on Hermes' delivery: what the job delivered is recorded unchanged, before it is delivered.
const CRON_STUB=`
import sys,types,json
for name in ("cron","cron.scheduler_provider","cron.scheduler"):sys.modules[name]=types.ModuleType(name)
sys.modules["cron"].scheduler=sys.modules["cron.scheduler"]
class Built:pass
sys.modules["cron.scheduler_provider"].InProcessCronScheduler=Built
delivered=[]
S=sys.modules["cron.scheduler"]
# Opaque: what Hermes resolved is supplied by each case as job["resolved"] = {lane, targets by lane part}.
S._normalize_deliver_value=lambda d:d
S._delivery_lane_value=lambda job,*,for_failure=False:job["resolved"]["lane"]
S._resolve_delivery_targets=lambda job,*,for_failure=False:job["resolved"]["targets"].get(job["deliver"],[])
for name in ("gateway","gateway.platforms","gateway.platforms.base","cron.scheduler_delivery"):sys.modules[name]=types.ModuleType(name)
class BasePlatformAdapter:
 @staticmethod
 def extract_media(text):
  lines=text.split("\\n");return [l for l in lines if l.startswith("MEDIA:")],"\\n".join(l for l in lines if not l.startswith("MEDIA:"))
sys.modules["gateway.platforms.base"].BasePlatformAdapter=BasePlatformAdapter
sys.modules["cron.scheduler_delivery"]._redact_cron_payload=lambda text,what:text.replace("sk-secret-123","[redacted]")
sys.modules["cron.scheduler"]._deliver_result=lambda job,content,adapters=None,loop=None,*,for_failure=False:delivered.append(content)
import importlib.util
s=importlib.util.spec_from_file_location("godspeed_notebook",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
class Ctx:
 def register_cron_scheduler(self,x):pass
m.register(Ctx());m.register(Ctx())
deliver=sys.modules["cron.scheduler"]._deliver_result
jobs=json.loads(sys.argv[2]);errors=[deliver(job,text,for_failure=failed) for job,text,failed in jobs]
print(json.dumps({"errors":errors,"delivered":delivered}))
`;
function wiredProvider(t,{node=process.execPath}={}){
 const {root,home,store}=setup(t),dir=path.join(home,'plugins','godspeed_notebook');fs.mkdirSync(dir,{recursive:true});
 fs.copyFileSync(fileURLToPath(new URL('../assistant-files/godspeed-cron-provider.py',import.meta.url)),path.join(dir,'__init__.py'));
 fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify({node,script:fileURLToPath(new URL('../scripts/background-report.mjs',import.meta.url)),root}));
 return {store,run:jobs=>JSON.parse(execFileSync(python,['-I','-c',CRON_STUB,path.join(dir,'__init__.py'),JSON.stringify(jobs)],{encoding:'utf8'}))};
}

test('what a Settings routine delivers is recorded as Hermes will send it, for local and Telegram delivery, before Hermes delivers it',t=>{
 if(!python)return t.skip('needs Python');
 const {store,run}=wiredProvider(t),words='Your weekly review is ready. Reply "ok" and I will start.';
 const out=run([[{id:'j1',name:'Weekly review',skill:'weekly-review',deliver:'telegram',resolved:{targets:{'telegram':[{platform:'telegram'}]},lane:'telegram'}},words,false],[{id:'j2',name:'Morning brief',skills:['morning-brief'],deliver:'local',resolved:{targets:{},lane:'local'}},'Good morning.',false],
  [{id:'j3',name:'Own script',script:'x.py',deliver:'telegram',resolved:{targets:{'telegram':[{platform:'telegram'}]},lane:'telegram'}},'Printed by its script.',false],[{id:'j4',name:'Failing',skill:'coach',deliver:'telegram',resolved:{targets:{'telegram':[{platform:'telegram'}]},lane:'telegram'}},'It failed.',true],[{id:'j5',name:'Targeted',skill:'coach',deliver:'telegram:123',resolved:{targets:{'telegram:123':[{platform:'telegram'}]},lane:'telegram:123'}},'To a chat.',false],
  [{id:'j6',name:'Origin',skill:'coach',deliver:'origin',resolved:{targets:{'origin':[{platform:'telegram'}]},lane:'origin'}},'From origin.',false]]);
 assert.deepEqual(out.errors,[null,null,null,null,null,null]);assert.deepEqual(out.delivered,[words,'Good morning.','Printed by its script.','It failed.','To a chat.','From origin.']);
 store.scan?.();const saved=[...new Store(store.root,{device:'pc'}).records.values()].filter(r=>r.id.startsWith('background-report-')).sort((a,b)=>a.content<b.content?-1:1);
 assert.deepEqual(saved.map(r=>[r.content,r.delivered_to,r.conversation_id,r.report.routine]),[['From origin.','telegram','telegram-owner','Origin'],['Good morning.','notebook',null,'Morning brief'],['It failed.','telegram','telegram-owner','Failing'],['To a chat.','telegram','telegram-owner','Targeted'],[words,'telegram','telegram-owner','Weekly review']]);
});

const TELEGRAM_JOB={id:'j1',name:'Asker',skill:'ask',deliver:'telegram',resolved:{targets:{'telegram':[{platform:'telegram'}]},lane:'telegram'}};
const openAsk=(store,about)=>openStep(store,{about,question:'Shall I go on?',yes:'I will restart it now.',no:'I will leave it as it is.',by:'routine:test',chat:'telegram'});

test('a question Hermes really delivers through the wrapper is answered by a bare yes, with no stamping by hand',t=>{
 if(!python)return t.skip('needs Python');
 const {store,run}=wiredProvider(t),one=openAsk(store,'The bot stopped.'),two=openAsk(store,'The disk is full.'),third=openAsk(store,'The bot stopped.');
 assert.equal(heard(new Store(store.root,{device:'pc'}),{chat:'telegram',words:'yes'}).kind,'none');
 const out=run([[TELEGRAM_JOB,one.message+'\n'+two.message,false]]);
 assert.deepEqual(out.errors,[null]);
 const fresh=new Store(store.root,{device:'pc'});
 assert.ok(fresh.get('approvals',one.id).sent_at&&fresh.get('approvals',two.id).sent_at);
 assert.equal(fresh.get('approvals',third.id).sent_at,undefined,'an unseen step with equal words is not certified by another record');
 assert.equal(heard(fresh,{chat:'telegram',words:'yes'}).kind,'ask');
});

const staleDelivery=(store,words,report)=>{const id='background-report-20200101T000000Z-stale000';
 store.commit([store.prepare('conversation_messages',{id,role:'assistant',content:words,source_app:'background',conversation_id:'telegram-owner',delivered_to:'telegram',sent_at:'2020-01-01T00:00:00.000Z',report})]);return id;};

test('an older undelivered record with the same words is not the receipt of a newer delivery',t=>{
 if(!python)return t.skip('needs Python');
 const {store,run}=wiredProvider(t),old=openAsk(store,'The disk is full.'),fresh=openAsk(store,'The bot stopped.');
 staleDelivery(store,fresh.message,{steps:[old.id],routine:'older'});
 assert.deepEqual(run([[TELEGRAM_JOB,fresh.message,false]]).errors,[null]);
 const after=new Store(store.root,{device:'pc'});
 assert.ok(after.get('approvals',fresh.id).sent_at);assert.equal(after.get('approvals',old.id).sent_at,undefined);
});

test('a delivery record persisted with the single step it once named still makes that step answerable',t=>{
 const {store}=setup(t),step=openAsk(store,'The bot stopped.');
 staleDelivery(store,step.message,{step:step.id,routine:'before the upgrade'});
 assert.equal(delivered(store,step.message).length,1);
 assert.ok(new Store(store.root,{device:'pc'}).get('approvals',step.id).sent_at);
});

test('a delivery whose receipt cannot be used says so, and still reports that the words went out',t=>{
 if(!python)return t.skip('needs Python');
 const bin=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-node-'));t.after(()=>fs.rmSync(bin,{recursive:true,force:true}));
 const node=path.join(bin,'node');fs.writeFileSync(node,`#!/bin/sh\ncase " $* " in *" delivered "*) echo broken >&2; exit 1;; esac\nexec ${process.execPath} "$@"\n`,{mode:0o755});
 const {store,run}=wiredProvider(t,{node}),one=openAsk(store,'The bot stopped.');
 const out=run([[TELEGRAM_JOB,one.message,false]]);
 assert.match(out.errors[0],/^Delivered, but a question in it could not be marked as answerable.*broken/);assert.deepEqual(out.delivered,[one.message]);
});

test('a Settings routine\'s result that cannot be recorded is not delivered',t=>{
 if(!python)return t.skip('needs Python');
 const {run}=wiredProvider(t,{node:path.join(os.tmpdir(),'no-such-node')});
 const out=run([[{id:'j1',name:'Weekly review',skill:'weekly-review',deliver:'telegram',resolved:{targets:{'telegram':[{platform:'telegram'}]},lane:'telegram'}},'Words.',false]]);
 assert.match(out.errors[0],/Not delivered: it could not be recorded/);assert.deepEqual(out.delivered,[]);
});

test('a failure is recorded in the lane Hermes sends failures to, not the normal lane',t=>{
 if(!python)return t.skip('needs Python');
 const {store,run}=wiredProvider(t);
 const out=run([[{id:'j1',name:'To notebook',skill:'coach',deliver:'local',failure_deliver:'telegram',resolved:{targets:{'telegram':[{platform:'telegram'}]},lane:'telegram'}},'Failed A.',true],[{id:'j2',name:'To Telegram',skill:'coach',deliver:'telegram',failure_deliver:'local',resolved:{targets:{},lane:'local'}},'Failed B.',true],
  [{id:'j3',name:'Failure silenced',skill:'coach',deliver:'telegram',failure_deliver:'origin',resolved:{targets:{},lane:'origin'}},'Failed C.',true],[{id:'j4',name:'Blank lane',skill:'coach',deliver:'local',failure_deliver:' ',resolved:{targets:{},lane:'local'}},'Failed D.',true],
  [{id:'j5',name:'Composite',skill:'coach',deliver:'local',failure_deliver:'telegram,local',resolved:{targets:{telegram:[{platform:'telegram'}]},lane:'telegram,local'}},'Failed E.',true],[{id:'j6',name:'Origin',skill:'coach',deliver:'local',failure_deliver:'origin',origin_platform:'telegram',resolved:{targets:{'origin':[{platform:'telegram'}]},lane:'origin'}},'Failed F.',true],
  [{id:'j7',name:'Elsewhere',skill:'coach',deliver:'local',failure_deliver:'discord',resolved:{targets:{'discord':[{platform:'discord'}]},lane:'discord'}},'Failed G.',true]]);
 assert.deepEqual(out.errors,[null,null,null,null,null,null,null]);
 const saved=[...new Store(store.root,{device:'pc'}).records.values()].filter(r=>r.id.startsWith('background-report-')).sort((a,b)=>a.content+a.delivered_to<b.content+b.delivered_to?-1:1);
 assert.deepEqual(saved.map(r=>[r.content,r.delivered_to]),[['Failed A.','telegram'],['Failed B.','notebook'],['Failed D.','notebook'],['Failed E.','notebook'],['Failed E.','telegram'],['Failed F.','telegram']]);
});

test('a composite lane is recorded once for each destination Hermes resolves',t=>{
 if(!python)return t.skip('needs Python');
 const {store,run}=wiredProvider(t);
 const out=run([[{id:'j1',name:'Both',skill:'coach',deliver:'telegram,local',resolved:{targets:{telegram:[{platform:'telegram'}]},lane:'telegram,local'}},'To both.',false],
  [{id:'j2',name:'Twice',skill:'coach',deliver:'telegram:1,telegram:2',resolved:{targets:{'telegram:1':[{platform:'telegram'}],'telegram:2':[{platform:'telegram'}]},lane:'telegram:1,telegram:2'}},'To two chats.',false]]);
 assert.deepEqual(out.errors,[null,null]);assert.deepEqual(out.delivered,['To both.','To two chats.']);
 const saved=[...new Store(store.root,{device:'pc'}).records.values()].filter(r=>r.id.startsWith('background-report-')).sort((a,b)=>a.content+a.delivered_to<b.content+b.delivered_to?-1:1);
 assert.deepEqual(saved.map(r=>[r.content,r.delivered_to]),[['To both.','notebook'],['To both.','telegram'],['To two chats.','telegram']]);
});

test('a Settings routine\'s record holds the words Hermes sends: media out, credentials redacted',t=>{
 if(!python)return t.skip('needs Python');
 const {store,run}=wiredProvider(t);
 const out=run([[{id:'j1',name:'Secret',skill:'coach',deliver:'telegram',resolved:{targets:{telegram:[{platform:'telegram'}]},lane:'telegram'}},'Key is sk-secret-123.\nMEDIA:/tmp/x.png',false]]);
 assert.deepEqual(out.errors,[null]);
 const [saved,...none]=[...new Store(store.root,{device:'pc'}).records.values()].filter(r=>r.id.startsWith('background-report-'));
 assert.equal(none.length,0);assert.equal(saved.content,'Key is [redacted].');
});

test('a composite lane is recorded together or not at all',async t=>{
 const {store,home}=setup(t),{main}=await import('../scripts/background-report.mjs');
 await assert.rejects(main(['record','--godspeed',store.root,'--home',home,'--routine','R','--delivery','notebook,bogus'],'Words.'));
 assert.equal(records(new Store(store.root,{device:'pc'})).length,0);
 await main(['record','--godspeed',store.root,'--home',home,'--routine','R','--delivery','notebook,telegram'],'Words.');
 assert.equal(records(new Store(store.root,{device:'pc'})).length,2);
});

test('a Settings routine sent as media alone is recorded, so the next reply knows it',t=>{
 if(!python)return t.skip('needs Python');
 const {store,run}=wiredProvider(t);
 const out=run([[{id:'j1',name:'Chart',skill:'coach',deliver:'telegram',resolved:{targets:{telegram:[{platform:'telegram'}]},lane:'telegram'}},'MEDIA:/tmp/x.png',false]]);
 assert.deepEqual(out.errors,[null]);assert.deepEqual(out.delivered,['MEDIA:/tmp/x.png']);
 const [saved,...none]=[...new Store(store.root,{device:'pc'}).records.values()].filter(r=>r.id.startsWith('background-report-'));
 assert.equal(none.length,0);assert.match(saved.content,/file/);
});

test('a composite record that fails while being staged leaves no destination recorded',t=>{
 const {store,home}=setup(t);let prepared=0;const prepare=store.prepare.bind(store);
 store.prepare=(...args)=>{if(++prepared===2)throw new Error('disk full');return prepare(...args);};
 assert.throws(()=>recordRoutine(store,{routine:'R',text:'Words.',home,delivery:['notebook','telegram']}),/disk full/);
 assert.equal(records(new Store(store.root,{device:'pc'})).length,0);
});

test('a locally delivered Settings result is in the notebook chat\'s next reply',t=>{
 if(!python)return t.skip('needs Python');
 const {store,run}=wiredProvider(t),root=store.root;
 run([[{id:'j2',name:'Morning brief',skill:'morning-brief',deliver:'local',resolved:{targets:{},lane:'local'}},'Good morning from Settings.',false]]);
 const plugin=fileURLToPath(new URL('../assistant-files/godspeed-context/__init__.py',import.meta.url)),dir=path.join(root,'plugin');
 fs.mkdirSync(dir);fs.copyFileSync(plugin,path.join(dir,'__init__.py'));fs.writeFileSync(path.join(dir,'mission-control.txt'),root);
 const hook=platform=>execFileSync(python,['-I','-c','import importlib.util,sys,json;s=importlib.util.spec_from_file_location("p",sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);print(json.dumps(m.on_pre_llm_call(user_message="hi",platform=sys.argv[2])))',path.join(dir,'__init__.py'),platform],{encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'}}).trim();
 const reply=JSON.parse(hook('cli')).context;
 assert.match(reply,/\[godspeed-reports\]/);assert.ok(reply.includes('Good morning from Settings.'));
 assert.equal(JSON.parse(hook('telegram'))?.context??null,null,'a notebook report is not for Telegram');
});

// AN ADOPTED MISSION CONTROL (4 November 2026, #225): the question of a waiting step reaches the owner
// through the notice sender and Hermes' wrapper, and a plain yes then approves it.
test('on an adopted mission control a waiting step\'s question is delivered by the notice sender and a plain yes approves it',async t=>{
 if(!python)return t.skip('needs Python');
 const {installStarter}=await import('../core/starter-workspace.mjs'),{routineFiles,writeRoutineFiles}=await import('../core/starting-routines.mjs');
 const {root,home,store}=setup(t);
 fs.mkdirSync(path.join(root,'rules'),{recursive:true});fs.writeFileSync(path.join(root,'AGENTS.md'),'# My own mission control\n');fs.writeFileSync(path.join(root,'rules','mine.md'),'Mine.\n');installStarter(root);
 const wire=fileURLToPath(new URL('../scripts/wire-assistant.mjs',import.meta.url));
 execFileSync(process.execPath,[wire,home],{env:{...process.env,GODSPEED_WORKSPACE:root,GODSPEED_PORT:'41992',GODSPEED_DEVICE:'local',GODSPEED_ORIGINAL_RUNTIME:'on'},windowsHide:true});
 assert.match(fs.readFileSync(path.join(home,'config.yaml'),'utf8'),/provider: "?godspeed_notebook"?/);
 writeRoutineFiles(home,routineFiles({root,home,state:store.state,timezone:'Europe/Berlin'}));
 const send=()=>execFileSync(python,[path.join(home,'scripts','godspeed-notices.py')],{cwd:path.join(home,'scripts'),encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'}}).trim();
 assert.equal(send(),'','the sender has started, with nothing queued');
 const opened=openAsk(store,'The bot stopped.');queueNotice(store,{id:'step-question',text:opened.message,step:opened.id});
 const words=send();
 assert.match(words,/Shall I go on\?/);
 const dir=path.join(home,'plugins','godspeed_notebook');
 const out=JSON.parse(execFileSync(python,['-I','-c',CRON_STUB,path.join(dir,'__init__.py'),JSON.stringify([[{...TELEGRAM_JOB,name:'Godspeed notices',script:'godspeed-notices.py'},words,false]])],{encoding:'utf8'}));
 assert.deepEqual(out.errors,[null]);
 const fresh=new Store(root,{device:'pc'});
 assert.ok(fresh.get('approvals',opened.id).sent_at,'certified once Hermes delivered it');
 const answer=heard(fresh,{chat:'telegram',words:'yes'});assert.equal(answer.kind,'answered');assert.equal(fresh.get('approvals',opened.id).status,'approved');
});
