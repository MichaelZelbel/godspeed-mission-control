import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Store,hash} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {Scheduler} from '../core/jobs/scheduler.mjs';
import {openStep,answerStep,answerChosen,heard,readStep,waitingSteps} from '../core/waiting-steps.mjs';

for(const key of Object.keys(process.env))if(/^GODSPEED_/.test(key))delete process.env[key];
const script=fileURLToPath(new URL('../bin/godspeed-step.mjs',import.meta.url));
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-steps-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new Store(root,{device:'vps'});store.save('settings',{id:'installation',owner:'vps',timezone:'UTC',delivery:'notebook'});
 return {root,store};
}
const ask=(store,about,chat='telegram',extra={})=>openStep(store,{about,question:'Shall I go on?',yes:'I will restart it now.',no:'I will leave it as it is.',by:'routine:test',chat,...extra});

test('one step waiting: a yes approves it and the reply says what happens; a no rejects it',t=>{
 const {store}=fixture(t),{id}=ask(store,'The bot stopped.');
 const first=heard(store,{chat:'telegram',words:'Yes!'});
 assert.equal(first.kind,'answered');assert.equal(first.reply,'I will restart it now.');
 const step=store.get('approvals',id);assert.equal(step.status,'approved');assert.equal(step.user_words,'Yes!');assert.ok(step.answered_at);
 const other=ask(store,'The disk is full.');
 assert.equal(heard(store,{chat:'telegram',words:'lass es'}).kind,'answered');
 assert.equal(store.get('approvals',other.id).status,'rejected');
});

test('a step answered twice stays answered once',t=>{
 const {store}=fixture(t),{id}=ask(store,'The bot stopped.');
 const first=answerStep(store,id,'yes',{chat:'telegram',words:'yes'}),at=store.get('approvals',id).answered_at;
 const second=answerStep(store,id,'no',{chat:'telegram',words:'no'});
 assert.equal(first.already,false);assert.equal(second.already,true);
 assert.equal(store.get('approvals',id).status,'approved');assert.equal(store.get('approvals',id).answered_at,at);
});

test('two waiting: a yes gets one question naming both, and the owner\'s choice approves the named one only',t=>{
 const {store}=fixture(t),a=ask(store,'The bot stopped.'),b=ask(store,'The disk is full.');
 const asked=heard(store,{chat:'telegram',words:'yes'});
 assert.equal(asked.kind,'ask');assert.match(asked.context,/The bot stopped\./);assert.match(asked.context,/The disk is full\./);
 assert.ok(!asked.context.includes(a.id)&&!asked.context.includes(b.id));
 assert.deepEqual(store.list('approvals').map(r=>r.status),['pending','pending']);
 assert.throws(()=>answerChosen(store,{chat:'telegram',id:a.id}),/not just chosen/);
 const chose=heard(store,{chat:'telegram',words:'the bot one'});
 assert.equal(chose.kind,'choose');assert.match(chose.context,new RegExp(a.id));
 assert.throws(()=>answerChosen(store,{chat:'telegram',id:'step-other'}),/not just chosen/);
 assert.throws(()=>answerChosen(store,{chat:'telegram',id:a.id,scheduled:true}),/scheduled run/);
 answerChosen(store,{chat:'telegram',id:a.id});
 assert.equal(store.get('approvals',a.id).status,'approved');assert.equal(store.get('approvals',a.id).user_words,'the bot one');assert.equal(store.get('approvals',b.id).status,'pending');
 assert.throws(()=>answerChosen(store,{chat:'telegram',id:b.id}),/not just chosen/);
});

test('none waiting: a yes changes nothing; a message that is not a plain answer never matches',t=>{
 const {store}=fixture(t);
 assert.equal(heard(store,{chat:'telegram',words:'yes'}).kind,'none');
 const {id}=ask(store,'The bot stopped.');
 assert.equal(heard(store,{chat:'telegram',words:'yes, but later please'}).kind,'none');
 assert.equal(store.get('approvals',id).status,'pending');
});

test('a yes is matched only for the last question in that chat and before the owner wrote there since',async t=>{
 const {store}=fixture(t),a=ask(store,'The bot stopped.');
 assert.equal(heard(store,{chat:'notebook',words:'yes'}).kind,'ask');
 assert.equal(heard(store,{chat:'telegram',words:'how are you'}).kind,'none');
 assert.equal(heard(store,{chat:'telegram',words:'yes'}).kind,'ask');
 assert.equal(store.get('approvals',a.id).status,'pending');
 assert.equal(heard(store,{chat:'telegram',words:'yes'}).kind,'answered');
});

test('a legacy pending approval is read as a waiting step and offered, never matched directly',t=>{
 const {store}=fixture(t);store.save('approvals',{id:'old',status:'pending',title:'Send the fictional post'});
 assert.equal(readStep(store.get('approvals','old')).about,'Send the fictional post');
 assert.equal(waitingSteps(store).length,1);
 const result=heard(store,{chat:'telegram',words:'yes'});
 assert.equal(result.kind,'ask');assert.match(result.context,/Send the fictional post/);
});

test('a scheduled run answers for nobody, and a step text holding a code is refused',t=>{
 const {store}=fixture(t),{id}=ask(store,'The bot stopped.');
 assert.equal(heard(store,{chat:'telegram',words:'yes',scheduled:true}).kind,'none');
 assert.equal(store.get('approvals',id).status,'pending');
 assert.throws(()=>ask(store,'Reply "approve 59f1d506" to allow it'),/code/);
 assert.throws(()=>ask(store,'Use /approve now'),/code/);
 assert.throws(()=>ask(store,'Step 59f1d506 waits'),/code/);
 assert.throws(()=>ask(store,'x'.repeat(301)),/300/);
});

test('the notebook chat answers a plain yes itself and hands every other message to the assistant',async t=>{
 const {store}=fixture(t),calls=[],domains=new Domains(new QueryService(store));
 domains.nativeAgent=async input=>{calls.push(input);return {reply:'ordinary'};};
 const conversation={conversation_id:'notebook:general'};
 assert.equal((await domains.invoke('conversation-chat',{...conversation,message:'ja',request_id:'r0'})).reply,'ordinary');
 const {message,id}=ask(store,'The bot stopped.','notebook');
 assert.match(message,/The bot stopped\./);
 const chat=store.get('note_conversations',store.list('note_conversations')[0].id);assert.equal(chat.state.messages.at(-1).content,message);
 const answered=await domains.invoke('conversation-chat',{...conversation,message:'ja',request_id:'r1'});
 assert.equal(answered.reply,'I will restart it now.');assert.equal(calls.length,1);assert.equal(store.get('approvals',id).status,'approved');
 assert.equal((await domains.invoke('conversation-chat',{...conversation,message:'ja',request_id:'r1'})).reply,'I will restart it now.');
 ask(store,'One','notebook');ask(store,'Two','notebook');
 await domains.invoke('conversation-chat',{...conversation,message:'yes',request_id:'r2'});
 assert.equal(calls.length,2);assert.match(calls[1].step_context,/One/);
});

test('a payload changed after the yes does not run, and the scheduler is unchanged',async t=>{
 const {store}=fixture(t),at=new Date(Date.now()-1000).toISOString(),payload={message:'Fictional post'};
 store.save('jobs',{id:'post',kind:'browser-post',owner:'vps',next_run:at,paused:false,state:'awaiting_approval',interval_ms:60000,outward:true,payload});
 const {id}=ask(store,'A post waits.','telegram',{job:'post'});
 assert.equal(heard(store,{chat:'telegram',words:'yes'}).kind,'answered');
 const job=store.get('jobs','post');assert.equal(job.state,'pending');assert.equal(job.approval_id,id);
 store.save('jobs',{id:'post',payload:{message:'Changed after the yes'}});
 let runs=0;const scheduler=new Scheduler(store,{device:'vps',executor:async()=>{runs++;return {verified:true,silent:true};}});
 await scheduler.tick();assert.equal(runs,0);assert.equal(store.get('jobs','post').state,'awaiting_approval');
 store.save('jobs',{id:'post',payload,state:'pending'});await scheduler.tick();assert.equal(runs,1);
});

test('a yes for a payload that changed since the question does not release the job',t=>{
 const {store}=fixture(t);
 store.save('jobs',{id:'post',kind:'browser-post',owner:'vps',paused:false,state:'awaiting_approval',outward:true,payload:{a:1}});
 const {id}=ask(store,'A post waits.','telegram',{job:'post'});
 store.save('jobs',{id:'post',payload:{a:2}});
 answerStep(store,id,'yes',{chat:'telegram',words:'yes'});
 assert.equal(store.get('jobs','post').state,'awaiting_approval');assert.equal(store.get('jobs','post').approval_id,undefined);
});

test('godspeed-step opens, reads and answers; a scheduled run cannot answer',t=>{
 const {root}=fixture(t),run=(args,{input='',env={}}={})=>spawnSync(process.execPath,[script,...args,'--godspeed',root],{input,encoding:'utf8',env:{...process.env,...env}});
 const opened=run(['open','--about','The bot stopped.','--question','Restart it?','--yes','I restart it.','--no','I leave it.','--by','routine:test','--chat','telegram']);
 assert.equal(opened.status,0,opened.stderr);const {id,message}=JSON.parse(opened.stdout);assert.equal(message,'The bot stopped. Restart it?');
 assert.equal(JSON.parse(run(['get',id]).stdout).status,'waiting');
 assert.equal(JSON.parse(run(['heard','--chat','telegram'],{input:'how are you'}).stdout).kind,'none');
 assert.equal(JSON.parse(run(['heard','--chat','telegram'],{input:'yes'}).stdout).kind,'ask');
 assert.equal(JSON.parse(run(['heard','--chat','telegram'],{input:'yes'}).stdout).kind,'answered');
 assert.equal(JSON.parse(run(['get',id]).stdout).status,'yes');
 const refused=run(['answer',id,'--chat','telegram'],{env:{GODSPEED_SCHEDULED_RUN:'1'}});assert.equal(refused.status,1);assert.match(refused.stderr,/scheduled run/);
 assert.equal(JSON.parse(run(['heard','--chat','telegram'],{input:'yes',env:{GODSPEED_SCHEDULED_RUN:'1'}}).stdout).kind,'none');
 const bad=run(['open','--about','Reply "approve 59f1d506"','--question','q','--yes','y','--no','n','--by','routine:test']);assert.equal(bad.status,1);
});
