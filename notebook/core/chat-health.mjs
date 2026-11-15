import fs from 'node:fs';
import path from 'node:path';
import {atomic} from './records/store.mjs';
import {runChild} from './child-process.mjs';
import {assistantEnvironment,scrubGitEnvironment} from './assistant-files.mjs';
import {hermesPython} from './runtime.mjs';
import {telegramInHermes} from './starting-routines.mjs';
import {telegramAPI} from './telegram-api.mjs';
import {foreignCheckout} from './hermes-update.mjs';
import {now as clockNow} from '../../third-party/addons/godspeed-coach/lib/clock.mjs';

// THE CHAT'S OWN HEALTH CHECK (issue #384). On 10 November 2026 the Telegram chat stayed dead for
// hours after something outside Godspeed changed the Hermes code under it: the gateway process was
// alive, so every check that asked "is it running" passed. This one asks the chat a real question
// through the running gateway (`hermes chat -q`, which hands its turn to the gateway rather than
// starting a second one) and tells the owner from here, the notebook, through their own bot, because
// Hermes' own sending is the thing that is broken. A bell is saved too, which needs no chat at all.
export const CHAT_HEALTH_FILE='chat-health.json';
export const CHECK_EVERY=60*60*1000;
export const CHECK_QUESTION='Reply with the single word OK.';
const RETRY_AFTER=30000,TURN_LIMIT=180000,SEND_LIMIT=35000,KEEP_FAILURES=20;
const PARTS_BEHIND='source-update completion failed';
const ENV_VALUE=name=>new RegExp('^\\s*'+name+'\\s*=\\s*(\\S+)','m');
const OWNER=/^[1-9][0-9]*$/;

export const CHAT_HEALTH_WORDS={
 down:'Your Telegram chat is not answering right now. Godspeed will tell you here when it answers again. Until then, messages you send it may get no answer; restarting the server usually brings it back.',
 up:'Your Telegram chat answers again. If you sent something while it was down, send it again if you still need an answer.',
 'not-ours':'Your Telegram chat runs on a copy of Hermes that belongs to another account on this server, so Godspeed cannot keep it up to date or repair it when something else changes it. Ask whoever set up the server to install Hermes for your assistant\'s own account.',
 'parts-behind':'Hermes on this server was updated, but the parts it needs were not, so your chat may stop answering. Whoever owns that Hermes copy should run: hermes update',
};
const BELL_TITLES={down:'Your Telegram chat is not answering','not-ours':'Your Telegram chat runs on a Hermes copy Godspeed does not own','parts-behind':'Hermes on this server is missing parts it needs'};

export function readChatHealth(store){
 try{const value=JSON.parse(fs.readFileSync(path.join(store.state,CHAT_HEALTH_FILE),'utf8'));return value&&typeof value==='object'&&!Array.isArray(value)?value:null;}catch{return null;}
}

// What /health says about the chat; null until the first check. Its `ok` stays the notebook's own:
// the supervisor must not restart the notebook because the chat is down.
export function chatStatus(store){
 const record=readChatHealth(store);
 return record?{answered:record.answered===true,checked_at:record.at||null,failing_since:record.failing_since||null,problems:record.problems||[],delivery_failures:record.delivery_failures||[]}:null;
}

// What one check comes to, given the record of the last one. Pure: the record to keep and what to
// do. `told` means the owner heard "not answering" and has not yet heard "answers again", so a
// failed message of either kind is asked for again on the next check, and neither is said twice.
export function nextChatHealth(prev,result,now){
 prev=prev||{};
 const failing=!result.answered,problems=[...new Set(result.problems||[])],toldProblems=(prev.told_problems||[]).filter(p=>problems.includes(p));
 const entry={at:now.toISOString(),answered:!failing,failing_since:failing?prev.failing_since||now.toISOString():null,told:prev.told===true,problems,told_problems:toldProblems,delivery_failures:prev.delivery_failures||[]};
 const actions=[];
 if(failing&&!entry.told)actions.push({tell:'down'});
 if(!failing&&prev.failing_since)actions.push({resolve:'down'});
 if(!failing&&entry.told)actions.push({tell:'up'});
 for(const problem of problems)if(!toldProblems.includes(problem))actions.push({tell:problem});
 for(const problem of new Set([...(prev.problems||[]),...(prev.told_problems||[])]))if(!problems.includes(problem))actions.push({resolve:problem});
 return {entry,actions};
}

export class ChatHealth{
 constructor({store,descriptor,lifecycle=null,run=runChild,fetcher=globalThis.fetch,now=clockNow,getuid=()=>process.getuid?.(),api='https://api.telegram.org',wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  Object.assign(this,{store,descriptor,lifecycle,run,fetcher,now,getuid,api,wait});
  this.started=now().getTime();
 }
 home(){return this.descriptor?.home;}
 // The test turn takes no lifecycle lease (the daily update would then skip its day); it waits out an
 // update, the assistant's or Godspeed's, instead.
 updating(){return !!this.lifecycle?.updating||fs.existsSync(path.join(this.store.state,'hermes-update.lock'));}
 // One check at a time: a failing one takes over 30 s and the scheduler ticks every 30 s, and a
 // second check would read the same record and warn the owner again.
 tick(){
  if(this.checking)return Promise.resolve(null);
  this.checking=this.check().finally(()=>{this.checking=null;});
  return this.checking;
 }
 async check(){
  if(!this.home()||!telegramInHermes(this.home()))return null;
  const prev=readChatHealth(this.store),now=this.now(),last=prev?Date.parse(prev.at):this.started;
  if(now.getTime()-(Number.isFinite(last)?last:0)<CHECK_EVERY||this.updating())return null;
  const {entry,actions}=nextChatHealth(prev,await this.probe(),now);
  for(const action of actions)await this.carryOut(action,entry);
  entry.delivery_failures=entry.delivery_failures.slice(-KEEP_FAILURES);
  atomic(path.join(this.store.state,CHAT_HEALTH_FILE),JSON.stringify(entry,null,2)+'\n');
  return entry;
 }
 async turn(day){
  const env=scrubGitEnvironment(assistantEnvironment({home:this.home(),workspace:this.store.root}));
  const args=['chat','-q',CHECK_QUESTION,'-Q','--continue','godspeed-chat-check-'+day,'--create-if-missing'];
  try{const result=await this.run(this.descriptor.executable,args,{cwd:this.store.root,env,timeoutMs:TURN_LIMIT,maxBytes:1024*1024,windowsHide:true,shell:false})||{};return {code:result.code??0,stdout:String(result.stdout||''),stderr:String(result.stderr||'')};}
  catch(error){return {code:typeof error?.code==='number'?error.code:1,stdout:String(error?.stdout||''),stderr:String(error?.stderr||'')};}
 }
 async probe(){
  const day=this.now().toISOString().slice(0,10),answered=t=>t.code===0&&/\bOK\b/i.test(t.stdout);
  const attempts=[await this.turn(day)];
  if(!answered(attempts[0])){await this.wait(RETRY_AFTER);attempts.push(await this.turn(day));}
  const problems=[];
  const source=this.descriptor?.sourceRoot||hermesPython({executable:this.descriptor?.executable,home:this.home()}).source;
  if(foreignCheckout(source,this.getuid))problems.push('not-ours');
  if(attempts.some(t=>t.stderr.includes(PARTS_BEHIND)))problems.push('parts-behind');
  return {answered:answered(attempts.at(-1)),problems};
 }
 // One message to the owner's own private chat with their bot, without the gateway. Nothing about
 // the token or Telegram's answer is ever kept.
 async say(text){
  let env='';try{env=fs.readFileSync(path.join(this.home(),'.env'),'utf8');}catch{}
  const value=name=>ENV_VALUE(name).exec(env)?.[1]?.replace(/^["']|["']$/g,'');
  const token=value('TELEGRAM_BOT_TOKEN'),owner=value('TELEGRAM_ALLOWED_USERS');
  if(!token||!OWNER.test(owner||''))return {ok:false,reason:'no-owner'};
  try{
   const response=await this.fetcher(`${telegramAPI(this.api)}/bot${token}/sendMessage`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({chat_id:owner,text}),signal:AbortSignal.timeout(SEND_LIMIT)});
   const body=await response.json().catch(()=>({}));
   return response.ok&&body.ok?{ok:true}:{ok:false,reason:'refused'};
  }catch{return {ok:false,reason:'network'};}
 }
 async bell(record){try{await this.store.saveAsync('notifications',record,undefined,{timeoutMs:30000});}catch(error){console.error('Godspeed Mission Control: the chat check could not save its bell: '+String(error?.message||error));}}
 async carryOut(action,entry){
  const at=this.now().toISOString();
  if(action.resolve){await this.bell({id:'chat-health-'+action.resolve,status:'resolved',resolved_at:at});return;}
  const kind=action.tell;
  if(kind!=='up')await this.bell({id:'chat-health-'+kind,status:'pending',kind:'chat-health-'+kind,title:BELL_TITLES[kind],body:CHAT_HEALTH_WORDS[kind],link:'/dashboard/settings'});
  const said=await this.say(CHAT_HEALTH_WORDS[kind]);
  if(!said.ok){entry.delivery_failures=[...entry.delivery_failures,{at,kind,reason:said.reason}];return;}
  if(kind==='down')entry.told=true;
  else if(kind==='up')entry.told=false;
  else entry.told_problems=[...entry.told_problems,kind];
 }
}
