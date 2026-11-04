import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {fileURLToPath} from 'node:url';import {execFileSync} from 'node:child_process';
import {Store} from '../core/records/store.mjs';import {QueryService} from '../core/query.mjs';import {chatContext} from '../core/chat-context.mjs';
import {queueNotice,readNotices} from '../core/notices.mjs';import {sayNotice,REPORT_CONTRACT} from '../core/background-reports.mjs';

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
 assert.deepEqual(saved.report.facts,notice.facts);assert.equal(saved.report.step,notice.step);assert.ok(saved.sent_at);
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
 assert.deepEqual([persisted.report.facts,persisted.report.step],[notice.facts,notice.step],'the second report keeps the facts and the waiting step');
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

test('what a Settings routine delivers is recorded unchanged, for local and Telegram delivery, before Hermes delivers it',t=>{
 if(!python)return t.skip('needs Python');
 const {store,run}=wiredProvider(t),words='Your weekly review is ready. Reply "ok" and I will start.';
 const out=run([[{id:'j1',name:'Weekly review',skill:'weekly-review',deliver:'telegram',resolved:{targets:{'telegram':[{platform:'telegram'}]},lane:'telegram'}},words,false],[{id:'j2',name:'Morning brief',skills:['morning-brief'],deliver:'local',resolved:{targets:{},lane:'local'}},'Good morning.',false],
  [{id:'j3',name:'Own script',script:'x.py',deliver:'telegram',resolved:{targets:{'telegram':[{platform:'telegram'}]},lane:'telegram'}},'Printed by its script.',false],[{id:'j4',name:'Failing',skill:'coach',deliver:'telegram',resolved:{targets:{'telegram':[{platform:'telegram'}]},lane:'telegram'}},'It failed.',true],[{id:'j5',name:'Targeted',skill:'coach',deliver:'telegram:123',resolved:{targets:{'telegram:123':[{platform:'telegram'}]},lane:'telegram:123'}},'To a chat.',false],
  [{id:'j6',name:'Origin',skill:'coach',deliver:'origin',resolved:{targets:{'origin':[{platform:'telegram'}]},lane:'origin'}},'From origin.',false]]);
 assert.deepEqual(out.errors,[null,null,null,null,null,null]);assert.deepEqual(out.delivered,[words,'Good morning.','Printed by its script.','It failed.','To a chat.','From origin.']);
 store.scan?.();const saved=[...new Store(store.root,{device:'pc'}).records.values()].filter(r=>r.id.startsWith('background-report-')).sort((a,b)=>a.content<b.content?-1:1);
 assert.deepEqual(saved.map(r=>[r.content,r.delivered_to,r.conversation_id,r.report.routine]),[['From origin.','telegram','telegram-owner','Origin'],['Good morning.','notebook',null,'Morning brief'],['It failed.','telegram','telegram-owner','Failing'],['To a chat.','telegram','telegram-owner','Targeted'],[words,'telegram','telegram-owner','Weekly review']]);
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
 const saved=[...new Store(store.root,{device:'pc'}).records.values()].filter(r=>r.id.startsWith('background-report-')).sort((a,b)=>a.content<b.content?-1:1);
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
