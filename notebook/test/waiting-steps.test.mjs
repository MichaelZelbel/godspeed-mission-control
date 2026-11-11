import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {Store,hash} from '../core/records/store.mjs';
import {QueryService} from '../core/query.mjs';
import {Domains} from '../core/domains.mjs';
import {cardSent,recordReport,recordRoutine,delivered} from '../core/background-reports.mjs';
import {Telegram} from '../core/telegram.mjs';
import {Scheduler} from '../core/jobs/scheduler.mjs';
import {openStep,ROUTES,CHATS,chatOf,ASKER_KINDS,answerStep,answerChosen,heard,stampReply,readStep,waitingSteps} from '../core/waiting-steps.mjs';

for(const key of Object.keys(process.env))if(/^GODSPEED_/.test(key))delete process.env[key];
const script=fileURLToPath(new URL('../bin/godspeed-step.mjs',import.meta.url));
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-steps-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const store=new Store(root,{device:'vps'});store.save('settings',{id:'installation',owner:'vps',timezone:'UTC',delivery:'notebook'});
 return {root,store};
}
// `words` is the question as a routine or reply would print it itself: a Telegram step's own
// message is empty, since the gateway's card asks it.
const open=(store,about,chat='telegram',extra={})=>{
 const opened=openStep(store,{about,question:'Shall I go on?',yes:'I will restart it now.',no:'I will leave it as it is.',by:'routine:test',chat,...extra});
 return opened.outcome==='asked'?{...opened,words:store.get('approvals',opened.id).about+' Shall I go on?'}:opened;
};
// Words that carry a question reach the owner the way Hermes delivers a notice: the delivery record names the step.
const deliver=async(store,{id,words})=>{await recordReport(store,{text:words,about:'',steps:[id],routine:'notice',written:'assistant',delivery:'telegram'});delivered(store,words);};
// A Telegram question reaches the owner as the gateway's card.
const ask=async(...args)=>{const opened=open(...args);if(args[2]!=='notebook')assert.equal(await cardSent(args[0],opened.id),true);return opened;};
const handOff=(store,id)=>path.join(store.state,'step-questions',id+'.json');

test('one step waiting: a yes approves it and the reply says what happens; a no rejects it',async t=>{
 const {store}=fixture(t),{id}=await ask(store,'The bot stopped.');
 const first=heard(store,{chat:'telegram',words:'Yes!'});
 assert.equal(first.kind,'answered');assert.equal(first.reply,'I will restart it now.');
 const step=store.get('approvals',id);assert.equal(step.status,'approved');assert.equal(step.user_words,'Yes!');assert.ok(step.answered_at);
 const other=await ask(store,'The disk is full.');
 assert.equal(heard(store,{chat:'telegram',words:'lass es'}).kind,'answered');
 assert.equal(store.get('approvals',other.id).status,'rejected');
});

test('a later message sent in the same millisecond still moves a bare yes on',async t=>{
 const {store}=fixture(t),{id}=await ask(store,'The bot stopped.'),RealDate=Date,fixed=Date.parse(store.get('approvals',id).sent_at);
 global.Date=class extends RealDate{constructor(...a){super(...(a.length?a:[fixed]));}static now(){return fixed;}};
 try{await recordReport(store,{text:'Your calendar changed.',steps:[],delivery:'telegram'});delivered(store,'Your calendar changed.');}finally{global.Date=RealDate;}
 assert.equal(heard(store,{chat:'telegram',words:'yes'}).kind,'ask');assert.equal(store.get('approvals',id).status,'pending');
});

test('a later ordinary Telegram message makes a bare yes a worded question, not an answer to the older step',async t=>{
 const {store}=fixture(t),{id}=await ask(store,'The bot stopped.');
 await recordReport(store,{text:'Your calendar changed.',steps:[],delivery:'telegram'});delivered(store,'Your calendar changed.');
 const reply=heard(store,{chat:'telegram',words:'yes'});
 assert.equal(reply.kind,'ask');assert.equal(store.get('approvals',id).status,'pending');
});

test('a later ordinary Telegram message makes a bare no a worded question too',async t=>{
 const {store}=fixture(t),{id}=await ask(store,'The bot stopped.');
 await recordReport(store,{text:'Your calendar changed.',steps:[],delivery:'telegram'});delivered(store,'Your calendar changed.');
 assert.equal(heard(store,{chat:'telegram',words:'no'}).kind,'ask');assert.equal(store.get('approvals',id).status,'pending');
});

test('a scheduler delivery, a command reply or a failure notice sent after the question also moves a bare yes or no on',async t=>{
 const sends=[async(bot,store)=>{const note=store.save('notes',{id:'n1',content:'Result.'});await bot.deliver('run-1',{record_id:note.id});},
  bot=>bot.tick(),
  bot=>bot.failureNotice('telegram-8','Sorry.')];
 for(const [i,send] of sends.entries()){
  const {store}=fixture(t),{id}=await ask(store,'The bot stopped.');
  const text=i===1?'/status':'';
  const transport=async url=>({ok:true,json:async()=>url.endsWith('/getUpdates')?{ok:true,result:text?[{update_id:9,message:{text,chat:{id:1,type:'private'},from:{id:1}}}]:[]}:{ok:true,result:{message_id:3}}});
  const bot=new Telegram({store,domains:{},token:'x',owner:1,transport});
  await send(bot,store);
  assert.equal(heard(store,{chat:'telegram',words:i%2?'no':'yes'}).kind,'ask',String(i));assert.equal(store.get('approvals',id).status,'pending');
 }
});

test('a Telegram receipt reserved after the question was certified is newer, whenever it chose its position',async t=>{
 const {store}=fixture(t),opened=open(store,'The bot stopped.');
 await recordReport(store,{text:opened.words,about:'',steps:[opened.id],routine:'notice',written:'assistant',delivery:'telegram'});
 const bot=new Telegram({store,domains:{},token:'x',owner:1,transport:async()=>({ok:true,json:async()=>({ok:true,result:{message_id:3}})})});
 const lock=store.withLockAsync.bind(store);let certified=false;
 store.withLockAsync=(fn,options)=>{if(!certified&&store.get('command_receipts','telegram-8-failure-notice')?.state==='verified'){certified=true;delivered(store,opened.words);}return lock(fn,options);};
 await bot.failureNotice('telegram-8','Sorry.');
 assert.ok(certified);
 assert.equal(heard(store,{chat:'telegram',words:'yes'}).kind,'ask');assert.equal(store.get('approvals',opened.id).status,'pending');
});

test('a Hermes receipt of two questions certifies both or neither, and a later receipt makes a bare yes ask',async t=>{
 const {store}=fixture(t),a=open(store,'The bot stopped.'),b=open(store,'The disk is full.'),words=a.words+'\n'+b.words;
 const [receipt]=await recordRoutine(store,{routine:'asker',text:words,delivery:'telegram'});
 const commit=store.commit.bind(store);store.commit=changes=>{if(changes.some(r=>r.id===receipt))throw new Error('disk');return commit(changes);};
 assert.throws(()=>delivered(store,words,[receipt]));
 store.commit=commit;
 assert.deepEqual(waitingSteps(store).map(s=>s.id),[],'no prefix of the message became answerable');
 const lock=store.withLock.bind(store);let later=false;
 store.withLock=fn=>{if(!later){later=true;store.saveUnderLock('conversation_messages',{role:'assistant',content:'Later.',delivered_to:'telegram',delivered_at:new Date(Date.now()+5).toISOString()});}return lock(fn);};
 delivered(store,words,[receipt]);
 assert.deepEqual(waitingSteps(store).map(s=>s.id).sort(),[a.id,b.id].sort());
 assert.equal(heard(store,{chat:'telegram',words:'yes'}).kind,'ask');
});

test('a Telegram step hands its question to the buttons when it opens, and words that carry it take the hand-off back',async t=>{
 const {store}=fixture(t),a=open(store,'The bot stopped.');
 const item=JSON.parse(fs.readFileSync(handOff(store,a.id),'utf8'));
 assert.equal(item.text,a.words);
 assert.ok(Date.parse(item.expires_at)>Date.now());
 stampReply(store,{words:a.words,since:'',messageId:7});
 assert.ok(store.get('approvals',a.id).sent_at);
 assert.equal(fs.existsSync(handOff(store,a.id)),false,'the question went out in words, so no card follows');
});

test('a direct Telegram reply of two questions certifies both or neither',async t=>{
 const {store}=fixture(t),a=open(store,'The bot stopped.'),b=open(store,'The disk is full.');
 const commit=store.commit.bind(store);store.commit=changes=>{if(changes.some(r=>r.id===b.id))throw new Error('disk');return commit(changes);};
 assert.throws(()=>stampReply(store,{words:a.words+'\n'+b.words,since:'',messageId:7}));
 assert.deepEqual(waitingSteps(store).map(s=>s.id),[],'no prefix of the reply became answerable');
 store.commit=commit;
 stampReply(store,{words:a.words+'\n'+b.words,since:'',messageId:7});
 assert.deepEqual(waitingSteps(store).map(s=>s.id).sort(),[a.id,b.id].sort());
});

test('a question sent but not registered tells the owner, and is not sent again',async t=>{
 const {store}=fixture(t);let a,sent=[];
 const domains={invoke:async()=>{a=open(store,'The bot stopped.');return {reply:a.words};}};
 const updates=[{update_id:1,message:{from:{id:123,is_bot:false},chat:{id:123,type:'private'},text:'hi'}}];
 const transport=async(url,o)=>({ok:true,json:async()=>{if(url.endsWith('getUpdates'))return {ok:true,result:updates};sent.push(JSON.parse(o.body).text);return {ok:true,result:{message_id:sent.length}};}});
 const commit=store.commit.bind(store);store.commit=changes=>{if(changes.some(r=>r.sent_at))throw new Error('disk');return commit(changes);};
 await new Telegram({store,domains,token:'synthetic-bot',owner:'123',transport}).tick();
 assert.equal(sent.length,2);assert.equal(sent[0],a.words);assert.match(sent[1],/could not register/);
 assert.equal(store.get('command_receipts','telegram-1').state,'needs_review');
});

test('a step answered twice stays answered once',async t=>{
 const {store}=fixture(t),{id}=await ask(store,'The bot stopped.');
 const first=answerStep(store,id,'yes',{chat:'telegram',words:'yes'}),at=store.get('approvals',id).answered_at;
 const second=answerStep(store,id,'no',{chat:'telegram',words:'no'});
 assert.equal(first.already,false);assert.equal(second.already,true);
 assert.equal(store.get('approvals',id).status,'approved');assert.equal(store.get('approvals',id).answered_at,at);
});

test('two waiting: a yes gets one question naming both, and the owner\'s choice approves the named one only',async t=>{
 const {store}=fixture(t),a=await ask(store,'The bot stopped.'),b=await ask(store,'The disk is full.');
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

test('none waiting: a yes changes nothing; a message that is not a plain answer never matches',async t=>{
 const {store}=fixture(t);
 assert.equal(heard(store,{chat:'telegram',words:'yes'}).kind,'none');
 const {id}=await ask(store,'The bot stopped.');
 assert.equal(heard(store,{chat:'telegram',words:'yes, but later please'}).kind,'none');
 assert.equal(store.get('approvals',id).status,'pending');
});

test('a yes is matched only for the last question in that chat and before the owner wrote there since',async t=>{
 const {store}=fixture(t),a=await ask(store,'The bot stopped.');
 assert.equal(heard(store,{chat:'notebook',words:'yes'}).kind,'none');
 assert.equal(heard(store,{chat:'telegram',words:'how are you'}).kind,'none');
 assert.equal(heard(store,{chat:'telegram',words:'yes'}).kind,'ask');
 assert.equal(store.get('approvals',a.id).status,'pending');
 assert.equal(heard(store,{chat:'telegram',words:'yes'}).kind,'answered');
});

test('a legacy pending approval is read as a waiting step and offered, never matched directly',async t=>{
 const {store}=fixture(t);store.save('approvals',{id:'old',status:'pending',title:'Send the fictional post'});
 assert.equal(readStep(store.get('approvals','old')).about,'Send the fictional post');
 assert.equal(waitingSteps(store).length,1);
 const result=heard(store,{chat:'telegram',words:'yes'});
 assert.equal(result.kind,'ask');assert.match(result.context,/Send the fictional post/);
});

test('a scheduled run answers for nobody, and a step text holding a code is refused',async t=>{
 const {store}=fixture(t),{id}=await ask(store,'The bot stopped.');
 assert.equal(heard(store,{chat:'telegram',words:'yes',scheduled:true}).kind,'none');
 assert.equal(store.get('approvals',id).status,'pending');
 await assert.rejects(()=>ask(store,'Reply "approve 59f1d506" to allow it'),/code/);
 await assert.rejects(()=>ask(store,'Use /approve now'),/code/);
 await assert.rejects(()=>ask(store,'Reply approve 4711 to go ahead.'),/code/);
 await assert.rejects(()=>ask(store,'approve 12345 to restart?'),/code/);
 await assert.rejects(()=>ask(store,'Step 59f1d506 waits'),/code/);
 await assert.rejects(()=>ask(store,'x'.repeat(301)),/300/);
});

test('the notebook chat answers a plain yes itself and hands every other message to the assistant',async t=>{
 const {store}=fixture(t),calls=[],domains=new Domains(new QueryService(store));
 domains.nativeAgent=async input=>{calls.push(input);return {reply:'ordinary'};};
 const conversation={conversation_id:'notebook:general'};
 assert.equal((await domains.invoke('conversation-chat',{...conversation,message:'ja',request_id:'r0'})).reply,'ordinary');
 const {message,id}=await ask(store,'The bot stopped.','notebook');
 assert.match(message,/The bot stopped\./);
 const chat=store.get('note_conversations',store.list('note_conversations')[0].id);assert.equal(chat.state.messages.at(-1).content,message);
 const answered=await domains.invoke('conversation-chat',{...conversation,message:'ja',request_id:'r1'});
 assert.equal(answered.reply,'I will restart it now.');assert.equal(calls.length,1);assert.equal(store.get('approvals',id).status,'approved');
 assert.equal((await domains.invoke('conversation-chat',{...conversation,message:'ja',request_id:'r1'})).reply,'I will restart it now.');
 await ask(store,'One','notebook');await ask(store,'Two','notebook');
 await domains.invoke('conversation-chat',{...conversation,message:'yes',request_id:'r2'});
 assert.equal(calls.length,2);assert.match(calls[1].step_context,/One/);
});

test('a committed answer still reaches the owner when the chat note fails, and a failed match asks for the answer again',async t=>{
 const {store}=fixture(t),calls=[],domains=new Domains(new QueryService(store)),conversation={conversation_id:'notebook:general'};
 domains.nativeAgent=async input=>{calls.push(input);return {reply:'ordinary'};};
 const {id}=await ask(store,'The bot stopped.','notebook');
 const save=store.saveAsync.bind(store);store.saveAsync=async(type,...rest)=>{if(type==='conversation_messages')throw Error('disk full');return save(type,...rest);};
 const answered=await domains.invoke('conversation-chat',{...conversation,message:'yes',request_id:'f1'});
 assert.equal(answered.reply,'I will restart it now.');assert.equal(store.get('approvals',id).status,'approved');
 store.saveAsync=save;
 const list=store.list.bind(store);store.list=type=>{if(type==='approvals')throw Error('unreadable');return list(type);};
 const retry=await domains.invoke('conversation-chat',{...conversation,message:'yes',request_id:'f2'});
 assert.match(retry.reply,/send your answer again/);assert.ok(!/unreadable/.test(retry.reply));assert.equal(calls.length,0);
 assert.equal((await domains.invoke('conversation-chat',{...conversation,message:'hello',request_id:'f3'})).reply,'ordinary');
});

test('a payload changed after the yes does not run, and the scheduler is unchanged',async t=>{
 const {store}=fixture(t),at=new Date(Date.now()-1000).toISOString(),payload={message:'Fictional post'};
 store.save('jobs',{id:'post',kind:'browser-post',owner:'vps',next_run:at,paused:false,state:'awaiting_approval',interval_ms:60000,outward:true,payload});
 const {id}=await ask(store,'A post waits.','telegram',{job:'post'});
 assert.equal(heard(store,{chat:'telegram',words:'yes'}).kind,'answered');
 const job=store.get('jobs','post');assert.equal(job.state,'pending');assert.equal(job.approval_id,id);
 store.save('jobs',{id:'post',payload:{message:'Changed after the yes'}});
 let runs=0;const scheduler=new Scheduler(store,{device:'vps',executor:async()=>{runs++;return {verified:true,silent:true};}});
 await scheduler.tick();assert.equal(runs,0);assert.equal(store.get('jobs','post').state,'awaiting_approval');
 store.save('jobs',{id:'post',payload,state:'pending'});await scheduler.tick();assert.equal(runs,1);
});

test('a yes for a payload that changed since the question does not release the job',async t=>{
 const {store}=fixture(t);
 store.save('jobs',{id:'post',kind:'browser-post',owner:'vps',paused:false,state:'awaiting_approval',outward:true,payload:{a:1}});
 const {id}=await ask(store,'A post waits.','telegram',{job:'post'});
 store.save('jobs',{id:'post',payload:{a:2}});
 answerStep(store,id,'yes',{chat:'telegram',words:'yes'});
 assert.equal(store.get('jobs','post').state,'awaiting_approval');assert.equal(store.get('jobs','post').approval_id,undefined);
});

test('godspeed-step opens, reads and answers; a scheduled run cannot answer',async t=>{
 const {root,store}=fixture(t),run=(args,{input='',env={}}={})=>spawnSync(process.execPath,[script,...args,'--godspeed',root],{input,encoding:'utf8',env:{...process.env,GODSPEED_STEP_SEND_WAIT:'0',...env}});
 const opened=run(['open','--about','The bot stopped.','--question','Restart it?','--yes','I restart it.','--no','I leave it.','--by','routine:test','--chat','telegram']);
 assert.equal(opened.status,0,opened.stderr);const {outcome,id,message}=JSON.parse(opened.stdout);
 assert.equal(outcome,'asked');assert.equal(message,'','the gateway card asks a Telegram question, so the asker says nothing');
 assert.equal(JSON.parse(fs.readFileSync(handOff(store,id),'utf8')).text,'The bot stopped. Restart it?');
 assert.equal(JSON.parse(run(['get',id]).stdout).status,'waiting');
 const selfSent=run(['sent',id],{env:{GODSPEED_SCHEDULED_RUN:'1'}});assert.equal(selfSent.status,1);assert.match(selfSent.stderr,/scheduled run/);
 assert.equal(store.get('approvals',id).sent_at,undefined);
 assert.equal(JSON.parse(run(['heard','--chat','telegram'],{input:'yes'}).stdout).kind,'none');
 assert.deepEqual(JSON.parse(run(['sent',id]).stdout),{sent:true});
 assert.deepEqual(JSON.parse(run(['sent',id]).stdout),{sent:false},'a question goes out once');
 assert.equal(JSON.parse(run(['heard','--chat','telegram'],{input:'how are you'}).stdout).kind,'none');
 assert.equal(JSON.parse(run(['heard','--chat','telegram'],{input:'yes'}).stdout).kind,'ask');
 assert.equal(JSON.parse(run(['heard','--chat','telegram'],{input:'yes'}).stdout).kind,'answered');
 assert.equal(JSON.parse(run(['get',id]).stdout).status,'yes');
 const refused=run(['answer',id,'--chat','telegram'],{env:{GODSPEED_SCHEDULED_RUN:'1'}});assert.equal(refused.status,1);assert.match(refused.stderr,/scheduled run/);
 assert.equal(JSON.parse(run(['heard','--chat','telegram'],{input:'yes',env:{GODSPEED_SCHEDULED_RUN:'1'}}).stdout).kind,'none');
 const notebook=JSON.parse(run(['open','--about','The disk is full.','--question','Clean it?','--yes','y','--no','n','--by','routine:test','--chat','notebook']).stdout);
 assert.equal(notebook.message,'The disk is full. Clean it?');
 const bad=run(['open','--about','Reply "approve 59f1d506"','--question','q','--yes','y','--no','n','--by','routine:test']);assert.equal(bad.status,1);
 const short=run(['open','--about','Reply approve 4711 to go ahead.','--question','Restart it?','--yes','y','--no','n','--by','routine:test']);assert.equal(short.status,1);assert.match(short.stderr,/code to type/);
});

test('a step whose question was not sent cannot be reached by a bare yes, and a delivery of other words or to another chat does not send it',async t=>{
 const {store}=fixture(t),{id,words}=open(store,'The bot stopped.'),other=open(store,'The disk is full.');
 assert.equal(heard(store,{chat:'telegram',words:'yes'}).kind,'none');assert.equal(store.get('approvals',id).status,'pending');
 await recordReport(store,{text:'Something else entirely.',step:null,delivery:'telegram'});
 await recordReport(store,{text:words,steps:[id],delivery:'notebook'});delivered(store,words);
 assert.equal(heard(store,{chat:'telegram',words:'yes'}).kind,'none');
 await deliver(store,{id,words});
 assert.equal(heard(store,{chat:'telegram',words:'yes'}).kind,'answered');
 assert.equal(store.get('approvals',other.id).sent_at,undefined);
});

test('a notebook step whose question could not be written is withdrawn and the error is raised',async t=>{
 const {store}=fixture(t);
 store.save('note_conversations',{id:'chat-'+hash('general').slice(0,24),context_key:'general',state:{messages:5}});
 assert.throws(()=>open(store,'The bot stopped.','notebook'));
 assert.deepEqual(store.list('approvals').map(r=>r.status),['withdrawn']);
 assert.equal(heard(store,{chat:'notebook',words:'yes'}).kind,'none');
});

test('every chat a step can be asked in has one conversation that routes back to it, and every asker kind opens a step',async t=>{
 for(const chat of CHATS)assert.equal(chatOf(ROUTES[chat].conversation),chat);
 assert.equal(chatOf('notebook:person:x'),null);
 const {store}=fixture(t);
 for(const kind of ASKER_KINDS)assert.ok(open(store,'About '+kind,'telegram',{by:kind+':x'}).id);
});

test('a visible older question is answered even when a newer one in the same chat was never sent',async t=>{
 const {store}=fixture(t),a=await ask(store,'The bot stopped.'),b=open(store,'The disk is full.');
 const result=heard(store,{chat:'telegram',words:'yes'});
 assert.equal(result.kind,'answered');assert.equal(store.get('approvals',a.id).status,'approved');assert.equal(store.get('approvals',b.id).status,'pending');
});

test('a chat-note that cannot be saved after the answer does not hide the committed answer',async t=>{
 const {root,store}=fixture(t);await ask(store,'The bot stopped.');
 fs.mkdirSync(path.join(root,'.godspeed','waiting-step-chats.json'),{recursive:true});
 const result=heard(store,{chat:'telegram',words:'yes'});
 assert.equal(result.kind,'answered');assert.equal(store.list('approvals')[0].status,'approved');
});

test('one direct reply certifies one step: the one opened in that turn whose words it holds',async t=>{
 const {store}=fixture(t);let opened=[],sends=0;
 const domains={invoke:async(_,{message})=>{
  if(message==='how is it going'){opened=[open(store,'The bot stopped.'),open(store,'The bot stopped.')];return {reply:opened[0].words};}
  return {reply:'Nice weather. '+opened[0].words};}};
 const updates=[{update_id:1,message:{from:{id:123,is_bot:false},chat:{id:123,type:'private'},text:'how is it going'}}];
 const transport=async url=>({ok:true,json:async()=>url.endsWith('getUpdates')?{ok:true,result:updates}:{ok:true,result:{message_id:100+ ++sends}}});
 const telegram=new Telegram({store,domains,token:'synthetic-bot',owner:'123',transport,loginLink:path=>'https://x.test'+path});
 await telegram.tick();
 assert.equal(store.get('approvals',opened[0].id).sent_message_id,101);assert.equal(store.get('approvals',opened[1].id).sent_at,undefined);
 assert.deepEqual(waitingSteps(store).map(s=>s.id),[opened[0].id]);
});

test('a direct reply that prints two questions certifies both, even when the receipt write fails after the send',async t=>{
 const {store}=fixture(t);let a,b,sends=0;
 const domains={invoke:async()=>{a=open(store,'The bot stopped.');b=open(store,'The disk is full.');return {reply:a.words+'\n'+b.words};}};
 const updates=[{update_id:1,message:{from:{id:123,is_bot:false},chat:{id:123,type:'private'},text:'how is it going'}}];
 const transport=async url=>({ok:true,json:async()=>url.endsWith('getUpdates')?{ok:true,result:updates}:{ok:true,result:{message_id:100+ ++sends}}});
 const telegram=new Telegram({store,domains,token:'synthetic-bot',owner:'123',transport});
 const save=store.saveAsync.bind(store);
 store.saveAsync=(kind,record)=>{if(kind==='command_receipts'&&record.state==='verified')throw new Error('disk');return save(kind,record);};
 await telegram.tick();
 assert.equal(sends,1);
 assert.deepEqual(waitingSteps(store).map(s=>s.id).sort(),[a.id,b.id].sort());
 assert.equal(heard(store,{chat:'telegram',words:'yes'}).kind,'ask');
});

test('an unrelated reply, an older step and a command reply cannot certify a step',async t=>{
 const {store}=fixture(t),old=open(store,'The bot stopped.');
 let fresh;const domains={invoke:async()=>{fresh=open(store,'The disk is full.');return {reply:'Nothing to report. '+old.words};}};
 const updates=[{update_id:1,message:{from:{id:123,is_bot:false},chat:{id:123,type:'private'},text:'hello'}},{update_id:2,message:{from:{id:123,is_bot:false},chat:{id:123,type:'private'},text:'/notebook'}}];
 const transport=async url=>({ok:true,json:async()=>url.endsWith('getUpdates')?{ok:true,result:updates}:{ok:true,result:{message_id:7}}});
 await new Telegram({store,domains,token:'synthetic-bot',owner:'123',transport,loginLink:path=>'https://x.test'+path}).tick();
 assert.equal(store.get('approvals',old.id).sent_at,undefined);assert.equal(store.get('approvals',fresh.id).sent_at,undefined);
 assert.equal(heard(store,{chat:'telegram',words:'yes'}).kind,'none');
});

test('only steps asked in the receiving chat count, whatever waits in the other chat or has no chat',async t=>{
 const {store}=fixture(t);store.save('approvals',{id:'old',status:'pending',title:'Send the fictional post'});
 const a=await ask(store,'The bot stopped.'),b=await ask(store,'The disk is full.'),n=await ask(store,'Notebook one.','notebook');
 assert.equal(heard(store,{chat:'notebook',words:'yes'}).kind,'answered');
 assert.equal(store.get('approvals',n.id).status,'approved');
 assert.deepEqual(heard(store,{chat:'telegram',words:'yes'}).steps.map(s=>s.id),[a.id,b.id]);
});

test('a Hermes routine that prints a step question makes it answerable only after Hermes delivered the words',async t=>{
 const {store}=fixture(t),{words,id}=open(store,'The bot stopped.');
 await recordRoutine(store,{routine:'asker',text:words,delivery:'telegram'});
 assert.deepEqual(store.list("conversation_messages")[0].report.steps,[id]);
 assert.equal(heard(store,{chat:'telegram',words:'yes'}).kind,'none');
 delivered(store,'Other words');
 assert.equal(heard(store,{chat:'telegram',words:'yes'}).kind,'none');
 delivered(store,words);
 assert.equal(heard(store,{chat:'telegram',words:'yes'}).kind,'answered');
});

test('two equal-text records certify one delivery each, in order, and a delivery names the whole step set of its record',async t=>{
 const {store}=fixture(t),a=open(store,'The bot stopped.'),b=open(store,'The bot stopped.'),c=open(store,'The disk is full.');
 const first=await recordRoutine(store,{routine:'asker',text:a.words,delivery:'telegram'});
 assert.equal(first.length,1);
 assert.deepEqual(delivered(store,a.words,first),first);
 assert.deepEqual(delivered(store,a.words,first),[],'a receipt is used once');
 assert.deepEqual(waitingSteps(store).map(s=>s.id),[a.id],'only the step its record named became answerable');
 const both=await recordRoutine(store,{routine:'asker',text:b.words+'\n'+c.words,delivery:'telegram'});
 assert.deepEqual(store.get('conversation_messages',both[0]).report.steps,[b.id,c.id]);
 delivered(store,b.words+'\n'+c.words);
 assert.deepEqual(heard(store,{chat:'telegram',words:'yes'}).steps.map(s=>s.id).sort(),[a.id,b.id,c.id].sort(),'a two-question message makes both answerable, so a bare yes asks which');
});

test('a direct reply is stamped with the words actually sent, so a progress photo or a cut reply cannot certify an unseen question',async t=>{
 const {store}=fixture(t),sent=[];
 let long,short,uid=1;const domains={invoke:async()=>{
  if(uid===1){long=open(store,'Long one.');return {reply:'x'.repeat(4000)+' '+long.words,habit:{progress:{version:1}}};}
  short=open(store,'Short one.');return {reply:'Nice. '+short.words,habit:{progress:{version:1}}};}};
 const transport=async(url,input)=>{
  if(url.endsWith('getUpdates'))return {ok:true,json:async()=>({ok:true,result:[{update_id:uid,message:{from:{id:123,is_bot:false},chat:{id:123,type:'private'},text:'hi'}}]})};
  sent.push([url.split('/').pop(),input instanceof Object&&input.body instanceof FormData?input.body.get('caption'):JSON.parse(input.body).text]);
  return {ok:true,json:async()=>({ok:true,result:{message_id:9}})};};
 const telegram=new Telegram({store,domains,token:'synthetic-bot',owner:'123',transport,renderProgress:async()=>Buffer.from('png')});
 await telegram.tick();
 assert.equal(sent.at(-1)[0],'sendMessage');assert.ok(!sent.at(-1)[1].includes('Long one.'));assert.equal(store.get('approvals',long.id).sent_at,undefined);
 uid=2;
 await telegram.tick();
 assert.equal(sent.at(-1)[0],'sendPhoto');assert.equal(sent.at(-1)[1],'Nice. '+short.words);assert.ok(store.get('approvals',short.id).sent_at);
});

test('a button press answers only a Telegram question that has gone out; a delivery that stamps nothing leaves the hand-off',async t=>{
 const {root,store}=fixture(t),notebook=open(store,'The disk is full.','notebook'),unsent=open(store,'The bot stopped.');
 const press=id=>spawnSync(process.execPath,[script,'press',id,'yes','--godspeed',root],{encoding:'utf8'});
 for(const {id} of [notebook,unsent]){
  assert.equal(press(id).status,1);
  assert.equal(store.get('approvals',id).status,'pending');
 }
 delivered(store,'Something nobody asked about.');
 assert.deepEqual(fs.readdirSync(path.join(store.state,'step-questions')),[unsent.id+'.json']);
 assert.equal(await cardSent(store,unsent.id),true);
 assert.equal(press(unsent.id).status,0);
 assert.equal(store.get('approvals',unsent.id).status,'approved');
});

// Issue #220: the gate every waiting step passes before it is asked.
test('a quiet restart is done and nothing is asked',async t=>{
 const {store}=fixture(t),result=open(store,'The gateway needs a restart.','telegram',{quietly:'restart'});
 assert.equal(result.outcome,'quiet');assert.equal(waitingSteps(store).length,0);
 assert.equal(store.list('approvals').length,0);
 assert.throws(()=>open(store,'x','telegram',{quietly:'delete'}),/Quietly is one of/);
 assert.throws(()=>open(store,'Send the mail.','telegram',{quietly:'retry',outward:true}),/never done quietly/);
});

test('a subject decided earlier answers from the decision until the owner\'s expiry',async t=>{
 const {store}=fixture(t),first=await ask(store,'Turn off the old programs?','telegram',{subject:'old-programs'});
 assert.equal(heard(store,{chat:'telegram',words:'yes'}).kind,'answered');
 const dated=store.get('approvals',first.id);store.commit([store.prepare('approvals',{expires_at:'2999-01-01T00:00:00.000Z'},dated)]);
 const again=open(store,'Turn off the old programs, again?','telegram',{subject:'old-programs'});
 assert.equal(again.outcome,'decided');assert.equal(again.answer,'yes');assert.equal(again.decision.user_words,'yes');
 assert.equal(waitingSteps(store).length,0);
 assert.equal(open(store,'Something else.','telegram',{subject:'other'}).outcome,'asked');
 const expired=store.get('approvals',first.id);store.commit([store.prepare('approvals',{expires_at:'2000-01-01T00:00:00.000Z'},expired)]);
 assert.equal(open(store,'Turn off the old programs, once more?','telegram',{subject:'old-programs'}).outcome,'asked');
});

test('a rejected step is asked again only when it changed, and then says what changed',async t=>{
 const {store}=fixture(t);await ask(store,'Delete the cache.','telegram',{subject:'cache'});
 heard(store,{chat:'telegram',words:'no'});
 assert.equal(open(store,'Delete the cache.','telegram',{subject:'cache'}).answer,'no');
 const changed=open(store,'Delete the cache, now twice the size.','telegram',{subject:'cache'});
 assert.equal(changed.outcome,'asked');assert.match(changed.words,/You said no to "Delete the cache\." before\. What changed: Delete the cache, now twice/);
});

test('an outward step with an earlier unrelated decision is still asked',async t=>{
 const {store}=fixture(t);await ask(store,'Restart the bot?','telegram',{subject:'bot'});
 heard(store,{chat:'telegram',words:'yes'});
 assert.equal(open(store,'Send the mail.','telegram',{subject:'mail',outward:true}).outcome,'asked');
 assert.equal(open(store,'Send the mail to everyone.','telegram',{subject:'bot',outward:true}).outcome,'asked');
});

test('an optional extra after an instruction is never asked',async t=>{
 const {store}=fixture(t),extra={instruction:'Stop them'};
 assert.equal(open(store,'Also clean up the logs.','telegram',{extra:{...extra,within:false}}).outcome,'dropped');
 assert.equal(open(store,'Also stop the helper.','telegram',{extra:{...extra,within:true}}).outcome,'do');
 assert.equal(open(store,'Also send a note.','telegram',{extra:{...extra,within:true},outward:true}).outcome,'dropped');
 assert.equal(waitingSteps(store).length,0);assert.equal(store.list('approvals').length,0);
});

test('godspeed-step open carries quiet, subject and optional-extra gates and refuses unknown options',async t=>{
 const {root,store}=fixture(t),run=args=>spawnSync(process.execPath,[script,'open','--about','The gateway is old.','--question','Restart it?','--yes','y','--no','n','--by','routine:test','--chat','telegram',...args,'--godspeed',root],{encoding:'utf8'});
 assert.equal(JSON.parse(run(['--quietly','restart']).stdout).outcome,'quiet');
 assert.equal(JSON.parse(run(['--extra','Stop them']).stdout).outcome,'dropped');
 assert.equal(JSON.parse(run(['--extra','Stop them','--within']).stdout).outcome,'do');
 assert.equal(waitingSteps(store).length,0);
 const refused=run(['--quiet','restart']);assert.equal(refused.status,1);assert.match(refused.stderr,/Unknown option --quiet/);
 assert.equal(JSON.parse(run(['--extra','-- Stop them']).stdout).outcome,'dropped');
 for(const missing of [['--extra','--within'],['--subject']]){const bad=run(missing);assert.equal(bad.status,1);assert.match(bad.stderr,/needs a value/);}
 assert.equal(waitingSteps(store).length,0);
});

test('the scenario asker drives the real godspeed-step open with every flag it emits',async t=>{
 const {root,store}=fixture(t),home=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-asker-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 fs.mkdirSync(path.join(home,'bin'));
 // The notebook's own report wiring: the real background-report.mjs, as wire-assistant.mjs writes it.
 fs.mkdirSync(path.join(home,'plugins','godspeed_notebook'),{recursive:true});
 fs.writeFileSync(path.join(home,'plugins','godspeed_notebook','report.json'),JSON.stringify({node:process.execPath,script:fileURLToPath(new URL('../scripts/background-report.mjs',import.meta.url)),root}));
 fs.writeFileSync(path.join(home,'bin','godspeed-step'),`#!/bin/sh\nprintf '%s\\n' "$@" >> argv.log\nprintf '@@\\n' >> argv.log\nexec "${process.execPath}" "${script}" "$@" --godspeed "${root}"\n`,{mode:0o755});
 const full={about:'a',question:'q',yes:'y',no:'n'};
 const asks=[{...full,quiet:'restart'},{...full,optional_after:'Stop them'},{...full,subject:'gw'},{...full,about:'-- restart the gateway'}];
 fs.writeFileSync(path.join(home,'.scenario-asks.json'),JSON.stringify(asks));
 const done=spawnSync('python3',[fileURLToPath(new URL('../../scenarios/scenario-asker.py',import.meta.url))],{cwd:home,encoding:'utf8',env:{...process.env,HERMES_HOME:home,GODSPEED_STEP_SEND_WAIT:'0'}});
 assert.equal(done.status,0,done.stderr);
 const calls=fs.readFileSync(path.join(home,'argv.log'),'utf8').split('@@\n').filter(Boolean).map(c=>c.trim().split('\n'));
 assert.ok(calls[0].includes('--quietly')&&calls[0].includes('restart'));
 assert.ok(calls[1].includes('--extra')&&calls[1].includes('Stop them')&&!calls[1].includes('--within'));
 assert.ok(calls[2].includes('--subject')&&calls[2].includes('gw'));
 // The run prints nothing: each question goes out as its own card from the gateway, which makes it answerable.
 assert.equal(done.stdout,'');
 assert.equal(store.list('conversation_messages').filter(r=>r.report?.routine==='Scenario asker').length,0);
 const pending=store.list('approvals').filter(a=>a.status==='pending');
 assert.equal(pending.length,2);
 assert.ok(pending.every(a=>!a.sent_at&&fs.existsSync(handOff(store,a.id))));
 for(const a of pending)assert.equal(await cardSent(store,a.id),true);
 for(const a of pending){
  assert.ok(store.get('approvals',a.id).sent_at);
  assert.ok(store.list('conversation_messages').some(r=>r.delivered_at&&r.report?.steps?.includes(a.id)),'the card is recorded as the message that asked it');
 }
});

test('godspeed-step open for Telegram returns once the gateway sent its card',async t=>{
 const {root,store}=fixture(t);
 const child=spawn(process.execPath,[script,'open','--about','The bot stopped.','--question','Restart it?','--yes','y','--no','n','--by','routine:test','--chat','telegram','--godspeed',root],{env:{...process.env,GODSPEED_STEP_SEND_WAIT:'10'}});
 let out='';child.stdout.on('data',d=>out+=d);
 const exited=new Promise(resolve=>child.on('exit',resolve)),started=Date.now();
 let id;
 while(!id&&Date.now()-started<5000){
  id=fs.readdirSync(store.state).includes('step-questions')?fs.readdirSync(path.join(store.state,'step-questions'))[0]?.replace(/\.json$/,''):undefined;
  if(!id)await new Promise(r=>setTimeout(r,50));
 }
 assert.ok(id,'the hand-off is written while open waits');
 assert.equal(child.exitCode,null,'open has not returned before the card went out');
 assert.equal(await cardSent(store,id),true);
 assert.equal(await exited,0);
 assert.ok(Date.now()-started<8000,'open returned well before its bound');
 assert.equal(JSON.parse(out).id,id);
});

test('only a waiting Telegram question that has not gone out can be marked sent, and nothing is recorded otherwise',async t=>{
 const {store}=fixture(t),answered=open(store,'The bot stopped.'),sent=await ask(store,'The disk is full.'),notebook=open(store,'The fan is loud.','notebook');
 answerStep(store,answered.id,'yes',{chat:'notebook',words:'yes'});
 assert.equal(fs.existsSync(handOff(store,answered.id)),false,'answering takes the hand-off back');
 const before=store.list('conversation_messages').length;
 for(const {id} of [answered,sent,notebook])assert.equal(await cardSent(store,id),false);
 assert.equal(store.get('approvals',answered.id).sent_at,undefined);
 assert.equal(store.list('conversation_messages').length,before);
});

test('the scenario asker records a question before it prints it, and prints nothing when the record is refused',async t=>{
 const {root}=fixture(t),home=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-asker-'));t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
 fs.mkdirSync(path.join(home,'bin'));fs.mkdirSync(path.join(home,'plugins','godspeed_notebook'),{recursive:true});
 fs.writeFileSync(path.join(home,'recorder.mjs'),`import fs from 'node:fs';fs.readFileSync(0,'utf8');console.error('refused');process.exit(1);
`);
 fs.writeFileSync(path.join(home,'plugins','godspeed_notebook','report.json'),JSON.stringify({node:process.execPath,script:path.join(home,'recorder.mjs'),root}));
 // A stand-in godspeed-step that says a message, as the real one does for an asked question.
 fs.writeFileSync(path.join(home,'bin','godspeed-step'),`#!/bin/sh
printf '{"message":"Shall I restart it?"}\n'
`,{mode:0o755});
 fs.writeFileSync(path.join(home,'.scenario-asks.json'),JSON.stringify([{about:'a',question:'q',yes:'y',no:'n'}]));
 const done=spawnSync('python3',[fileURLToPath(new URL('../../scenarios/scenario-asker.py',import.meta.url))],{cwd:home,encoding:'utf8',env:{...process.env,HERMES_HOME:home}});
 assert.equal(done.status,1);
 assert.equal(done.stdout,'');
 assert.match(done.stderr,/could not be recorded/);
});

test('a bundled report is split and each finding is checked',async t=>{
 const {store}=fixture(t),base={question:'Shall I go on?',yes:'Done.',no:'Left.',by:'routine:test',chat:'notebook'};
 const results=[{...base,about:'The gateway needs a restart.',quietly:'restart'},{...base,about:'The disk is nearly full.'}].map(finding=>openStep(store,finding));
 assert.deepEqual(results.map(r=>r.outcome),['quiet','asked']);
});

test('a step finished quietly, answered from an earlier decision or dropped has no button to press',async t=>{
 const {root,store}=fixture(t),press=id=>spawnSync(process.execPath,[script,'press',id,'yes','--godspeed',root],{encoding:'utf8'});
 const base={question:'Shall I go on?',yes:'Done.',no:'Left.',by:'routine:test',chat:'telegram'};
 const outcomes=[{about:'The gateway needs a restart.',quietly:'restart'},{about:'Also tidy the shelf.',extra:{instruction:'Tidy',within:false}}].map(f=>openStep(store,{...base,...f}));
 assert.deepEqual(outcomes.map(r=>r.outcome),['quiet','dropped']);
 assert.equal(store.list('approvals').length,0);
 assert.equal(press('step-none').status,1);
 assert.equal(store.list('approvals').length,0);
});

test('the scenario asker reads the report wiring keys the installer writes',()=>{
 const writer=fs.readFileSync(new URL('../scripts/wire-assistant.mjs',import.meta.url),'utf8'),asker=fs.readFileSync(new URL('../../scenarios/scenario-asker.py',import.meta.url),'utf8'),cron=fs.readFileSync(new URL('../assistant-files/godspeed-cron-provider.py',import.meta.url),'utf8');
 assert.match(writer,/JSON\.stringify\(\{node:process\.execPath,script:[^}]*background-report\.mjs'\),root\}\)/);
 for(const key of ['node','script','root']){assert.ok(asker.includes('wiring["'+key+'"]'),'the asker reads '+key);assert.ok(cron.includes('wiring["'+key+'"]'),'the cron provider reads '+key);}
});
