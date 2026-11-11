import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {Store} from '../core/records/store.mjs';import {installStarter} from '../core/starter-workspace.mjs';
import {NativeScheduler} from '../core/native-scheduler.mjs';
import {ChatHealth,CHAT_HEALTH_FILE,CHAT_HEALTH_WORDS,CHECK_EVERY,CHECK_QUESTION,chatStatus,nextChatHealth} from '../core/chat-health.mjs';

for(const key of Object.keys(process.env))if(/^(GODSPEED_|HERMES_)/.test(key))delete process.env[key];

// THE CHAT'S OWN HEALTH CHECK (#384). The test turn and Telegram are stand-ins; the record, the bells
// and the clock are real. Everything here is made up.
const TOKEN='123456789:AAHinventedtokeninventedtokeninvented',OWNER='4242',HOUR=CHECK_EVERY;
const START=Date.parse('2026-11-11T08:00:00Z');
function fixture(t,{env=`TELEGRAM_BOT_TOKEN=${TOKEN}\nTELEGRAM_ALLOWED_USERS=${OWNER}\n`,answers=[],uid}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-chat-health-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 installStarter(root);const home=path.join(root,'hermes-home'),source=path.join(root,'hermes-agent');fs.mkdirSync(home);fs.mkdirSync(source);
 fs.writeFileSync(path.join(home,'.env'),env);
 const store=new Store(root,{device:'pc'}),turns=[],sent=[];let clock=START,telegram=async()=>({ok:true,json:async()=>({ok:true})});
 const health=new ChatHealth({store,descriptor:{executable:'/usr/local/bin/hermes',home,sourceRoot:source},
  run:async(executable,args,options)=>{turns.push({executable,args,options});return answers.shift()||{code:0,stdout:'OK\n',stderr:''};},
  fetcher:async(url,init)=>{sent.push({url,body:JSON.parse(init.body)});return telegram(url,init);},
  now:()=>new Date(clock),getuid:()=>uid??fs.statSync(source).uid,wait:async()=>{}});
 return {root,store,health,turns,sent,answers,
  later:(ms=HOUR)=>{clock+=ms;},telegram:fn=>{telegram=fn;},
  said:()=>sent.map(s=>s.body.text),record:()=>JSON.parse(fs.readFileSync(path.join(store.state,CHAT_HEALTH_FILE),'utf8')),
  bell:kind=>store.get('notifications','chat-health-'+kind)};
}
const FAILED={code:1,stdout:'',stderr:'ImportError: cannot import name x\n'};
const failTwice=f=>f.answers.push(FAILED,FAILED);

test('a chat that answers: one test turn through the gateway, nothing said, the record says it answered',async t=>{
 const f=fixture(t);f.later();
 const entry=await f.health.tick();
 assert.equal(entry.answered,true);assert.deepEqual(f.said(),[]);
 assert.deepEqual(f.turns.map(x=>x.args),[['chat','-q',CHECK_QUESTION,'-Q','--continue','godspeed-chat-check-2026-11-11','--create-if-missing']]);
 assert.equal(f.turns[0].options.cwd,f.root);assert.equal(f.turns[0].options.env.HERMES_HOME,path.join(f.root,'hermes-home'));
 assert.deepEqual(chatStatus(f.store),{answered:true,checked_at:new Date(START+HOUR).toISOString(),failing_since:null,problems:[]});
 assert.equal(f.bell('down'),undefined);
});

test('a chat that stops answering: the owner is told once, in their chat and with a bell, until it answers again; then once that it does',async t=>{
 const f=fixture(t);f.later();failTwice(f);
 await f.health.tick();
 assert.equal(f.turns.length,2,'one retry before it counts');
 assert.deepEqual(f.said(),[CHAT_HEALTH_WORDS.down]);
 assert.equal(f.sent[0].url,`https://api.telegram.org/bot${TOKEN}/sendMessage`);assert.equal(f.sent[0].body.chat_id,OWNER);
 assert.equal(f.bell('down').status,'pending');
 const since=f.record().failing_since;assert.equal(f.record().told,true);
 f.later();failTwice(f);await f.health.tick();
 assert.equal(f.said().length,1,'not said again while it stays down');assert.equal(f.record().failing_since,since);
 f.later();await f.health.tick();
 assert.deepEqual(f.said(),[CHAT_HEALTH_WORDS.down,CHAT_HEALTH_WORDS.up]);
 assert.equal(f.bell('down').status,'resolved');
 assert.deepEqual([f.record().answered,f.record().failing_since,f.record().told],[true,null,false]);
 f.later();await f.health.tick();assert.equal(f.said().length,2,'silent while it works');
});

test('a message Telegram refuses is recorded as a failed delivery and said on the next check; the bell is there either way',async t=>{
 const f=fixture(t);f.later();failTwice(f);f.telegram(async()=>({ok:false,status:403,json:async()=>({ok:false,description:'Forbidden: bot was blocked by the user'})}));
 await f.health.tick();
 assert.equal(f.bell('down').status,'pending');
 assert.equal(f.record().told,false);
 assert.deepEqual(f.record().delivery_failures.map(x=>[x.kind,x.reason]),[['down','refused']]);
 f.telegram(async()=>{throw Error('getaddrinfo EAI_AGAIN');});f.later();failTwice(f);await f.health.tick();
 assert.deepEqual(f.record().delivery_failures.map(x=>x.reason),['refused','network']);
 f.telegram(async()=>({ok:true,json:async()=>({ok:true})}));f.later();failTwice(f);await f.health.tick();
 assert.equal(f.record().told,true);assert.equal(f.said().filter(text=>text===CHAT_HEALTH_WORDS.down).length,3);
 assert.doesNotMatch(fs.readFileSync(path.join(f.store.state,CHAT_HEALTH_FILE),'utf8'),/AAHinvented|Forbidden|EAI_AGAIN/);
});

test('an "answers again" that could not be delivered is said on the next check',async t=>{
 const f=fixture(t);f.later();failTwice(f);await f.health.tick();
 f.telegram(async()=>({ok:false,status:502,json:async()=>({})}));f.later();await f.health.tick();
 assert.equal(f.record().told,true);assert.equal(f.bell('down').status,'resolved');
 f.telegram(async()=>({ok:true,json:async()=>({ok:true})}));f.later();await f.health.tick();
 assert.equal(f.said().filter(text=>text===CHAT_HEALTH_WORDS.up).length,2);assert.equal(f.record().told,false);
});

test('Hermes running with dependencies behind its code is said once, and resolved when it is gone',async t=>{
 const f=fixture(t);f.later();f.answers.push({code:0,stdout:'OK\n',stderr:'source-update completion failed: permission denied; running with the previous dependencies\n'});
 await f.health.tick();
 assert.deepEqual(f.said(),[CHAT_HEALTH_WORDS['parts-behind']]);assert.deepEqual(f.record().problems,['parts-behind']);assert.equal(f.bell('parts-behind').status,'pending');
 f.later();f.answers.push({code:0,stdout:'OK\n',stderr:'source-update completion failed: x\n'});await f.health.tick();
 assert.equal(f.said().length,1);
 f.later();await f.health.tick();
 assert.equal(f.said().length,1,'no message when it is gone');assert.equal(f.bell('parts-behind').status,'resolved');assert.deepEqual(f.record().problems,[]);
});

test('a Hermes copy another account owns is said once',async t=>{
 const f=fixture(t,{uid:987654});f.later();await f.health.tick();f.later();await f.health.tick();
 assert.deepEqual(f.said(),[CHAT_HEALTH_WORDS['not-ours']]);assert.deepEqual(chatStatus(f.store).problems,['not-ours']);
});

test('no check within the hour, during a Hermes update, or without Telegram',async t=>{
 const f=fixture(t);
 assert.equal(await f.health.tick(),null,'the first check waits an hour after start');
 f.later();await f.health.tick();f.later(HOUR-60000);assert.equal(await f.health.tick(),null);assert.equal(f.turns.length,1);
 f.later(60000);fs.writeFileSync(path.join(f.store.state,'hermes-update.lock'),'1');assert.equal(await f.health.tick(),null);
 fs.rmSync(path.join(f.store.state,'hermes-update.lock'));f.health.lifecycle={reason:'assistant update'};assert.equal(await f.health.tick(),null);
 assert.equal(f.turns.length,1);
 const g=fixture(t,{env:'OPENAI_API_KEY=x\n'});g.later();assert.equal(await g.health.tick(),null);assert.equal(g.turns.length,0);assert.equal(chatStatus(g.store),null);
});

test('several allowed users name no single owner: nothing is sent, the bell still is, and the failure is recorded',async t=>{
 const f=fixture(t,{env:`TELEGRAM_BOT_TOKEN=${TOKEN}\nTELEGRAM_ALLOWED_USERS=4242,5353\n`});f.later();failTwice(f);await f.health.tick();
 assert.deepEqual(f.sent,[]);assert.equal(f.bell('down').status,'pending');assert.deepEqual(f.record().delivery_failures.map(x=>x.reason),['no-owner']);
});

test('nextChatHealth: an outage is told once and its recovery once',()=>{
 const at=new Date(START);
 assert.deepEqual(nextChatHealth(null,{answered:true,problems:[]},at).actions,[]);
 assert.deepEqual(nextChatHealth({failing_since:'x',told:true},{answered:false,problems:[]},at).actions,[]);
 assert.deepEqual(nextChatHealth({failing_since:'x',told:false},{answered:false,problems:[]},at).actions,[{tell:'down'}]);
 assert.deepEqual(nextChatHealth({failing_since:'x',told:true},{answered:true,problems:[]},at).actions,[{resolve:'down'},{tell:'up'}]);
 assert.deepEqual(nextChatHealth({problems:['not-ours'],told_problems:['not-ours']},{answered:true,problems:['not-ours']},at).actions,[]);
});

test('the routine tick runs the chat check first, and a check that throws does not stop the routines',async t=>{
 const f=fixture(t),calls=[],scheduler=new NativeScheduler(f.store,{home:f.health.descriptor.home,executable:f.health.descriptor.executable,run:async(_executable,args)=>{calls.push(args.join(' '));return {stdout:''};}});
 scheduler.chatHealth={tick:async()=>{calls.push('chat check');throw Error('the check broke');}};
 const said=console.error;console.error=()=>{};t.after(()=>{console.error=said;});
 await scheduler.tick();
 assert.equal(calls[0],'chat check');assert.ok(calls.includes('cron tick'));
});
