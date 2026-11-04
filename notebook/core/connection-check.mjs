import fs from 'node:fs';
import path from 'node:path';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {CONNECTION_NAMES} from './connection-names.mjs';
import {atomic} from './records/store.mjs';
import {queueNotice} from './notices.mjs';
import {routineAIStatus,askDirectly} from './routine-ai.mjs';
import {FileSync,readSyncConfig} from './sync/git.mjs';
import {telegramInHermes} from './starting-routines.mjs';
import {addDays} from '../../third-party/addons/godspeed-coach/lib/clock.mjs';

// THE DAILY CONNECTION CHECK (4 November 2026, #200). Godspeed only noticed a broken connection (the
// AI it thinks with, the Telegram bot, the GitHub sync, Gmail) when something failed in front of the
// owner: the briefing did not arrive, or a reply failed without saying why. Once a day, early in the
// morning (scripts/connection-check.mjs, the routine "Daily connection check"), this makes one
// harmless call to each connection that is set up. A connection that needs the owner's login or key
// is said once, with a deadline that the routine closes itself on the first day the call works
// again; any other failure (the network, the service being down) is said only on its second failure
// in a row. Nothing here sends, posts or changes anything, and no call costs more than one short
// request to the AI.
//
// Until #198 (reports in the chat's voice) and #199 (a no-sign-in Git helper) are on main, the words
// go through the notebook's notices (tellOwner, the one place to change) and the GitHub read uses
// the sync's own settings, which already refuse to ask for a sign-in (FileSync.gitBytes).
//
// A probe answers only {set_up, ok, kind}; kind is 'sign-in' (login or key refused) or 'other'. No
// service text, address or key ever leaves a probe, so none can reach a record, a message or a log.
export const CONNECTIONS={
 ai:{...CONNECTION_NAMES.ai,probe:deps=>aiProbe(deps),
  signIn:'Your AI did not accept its sign-in or key this morning, so your routines and your chat cannot think until it is fixed. To fix it, open Settings in your notebook and connect your AI again under Your AI.'},
 telegram:{...CONNECTION_NAMES.telegram,probe:deps=>telegramProbe(deps),
  signIn:'Telegram refused your bot\'s key this morning, so nothing from your mission control reaches you on Telegram and your messages there go unanswered. To fix it, get the bot\'s current key from BotFather and connect Telegram again in Settings.'},
 github:{...CONNECTION_NAMES.github,probe:deps=>githubProbe(deps),
  signIn:'GitHub did not let this computer read your notebook\'s repository this morning, so your notebook stops syncing with your other computers. To fix it, open Settings in your notebook and press Connect record sync again; GitHub\'s sign-in page opens.'},
 mail:{...CONNECTION_NAMES.mail,probe:deps=>mailProbe(deps),
  signIn:'Gmail did not accept the app password this morning, so your assistants cannot search your mail or save drafts. To fix it, ask your assistant: Connect Gmail for me.'},
};
const NAMES=Object.keys(CONNECTIONS);
export const RECORD_FILE='connection-check.json';
const WORKED_FOLDER='connection-check';
const DEADLINE_DAYS=3;
const ENV_TOKEN=/^\s*TELEGRAM_BOT_TOKEN\s*=\s*(\S+)/m;
const GIT_SIGN_IN=/Authentication failed|could not read Username|terminal prompts disabled|Permission denied \(publickey\)|Repository not found|Invalid username or password|returned error: 40[13]/i;
const kit=fileURLToPath(new URL('../../',import.meta.url));
const dueScript=path.join(kit,'tools','due.js');

// Whether this install has what the check is for: Telegram or Gmail connected. It decides only
// whether the routine starts on or paused (NativeScheduler.followConnectionCheck).
export function mailImap(){return createRequire(import.meta.url)('../../tools/mc-mail-imap.js');}
export function mailConnected(imap=mailImap){try{return imap().status().state!=='not connected';}catch{return false;}}
export const connectionCheckWanted=(home,imap)=>telegramInHermes(home)||mailConnected(imap);

export const telegramKind=(status,body)=>[401,404].includes(status)||body?.error_code===401?'sign-in':'other';
export const gitKind=stderr=>GIT_SIGN_IN.test(String(stderr||''))?'sign-in':'other';
export const aiKind=error=>error?.reason==='sign-in'?'sign-in':'other';
export const mailKind=state=>state==='disconnected'?'sign-in':'other';

const outcome=(ok,kind)=>ok?{set_up:true,ok:true}:{set_up:true,ok:false,kind};
const NOT_SET_UP={set_up:false};

export const aiProbe=({store,home,hermes,hermesSource,ask=askDirectly})=>async()=>{
 if(!hermes||!path.isAbsolute(hermes)||routineAIStatus({home,state:store.state}).source==='none')return NOT_SET_UP;
 try{await ask({executable:hermes,home,cwd:store.root,sourceRoot:hermesSource||undefined,route:'main'});return outcome(true);}
 catch(error){return outcome(false,aiKind(error));}
};
export const telegramProbe=({home,fetcher=fetch,api='https://api.telegram.org'})=>async()=>{
 let token;try{token=ENV_TOKEN.exec(fs.readFileSync(path.join(home,'.env'),'utf8'))?.[1]?.replace(/^["']|["']$/g,'');}catch{}
 if(!token)return NOT_SET_UP;
 try{
  const response=await fetcher(`${api}/bot${token}/getMe`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(15000)});
  const body=await response.json().catch(()=>({}));
  return response.ok&&body.ok?outcome(true):outcome(false,telegramKind(response.status,body));
 }catch{return outcome(false,'other');}
};
// ls-remote only reads the remote; FileSync.gitBytes sets GIT_TERMINAL_PROMPT=0, so it never asks.
export const githubProbe=({store,run=args=>new FileSync(store).git(args,undefined,{timeout:60000})})=>async()=>{
 const sync=readSyncConfig(store.state);
 if(!sync||sync.enabled===false)return NOT_SET_UP;
 try{run(['ls-remote','--heads','origin','main']);return outcome(true);}
 catch(error){return outcome(false,gitKind(error?.stderr));}
};
export const mailProbe=({imap=mailImap}={})=>async()=>{
 let tool;try{tool=imap();if(tool.status().state==='not connected')return NOT_SET_UP;}catch{return NOT_SET_UP;}
 try{const result=await tool.check();return result.state==='connected'&&!result.error?outcome(true):outcome(false,mailKind(result.state));}
 catch{return outcome(false,'other');}
};
export const defaultProbes=deps=>Object.fromEntries(NAMES.map(name=>[name,CONNECTIONS[name].probe(deps)]));

const otherWords=name=>`Your mission control could not reach ${CONNECTIONS[name].label} yesterday or today, so ${CONNECTIONS[name].stops} may not be working. Nothing needs your sign-in: it is tried again tomorrow. If this computer's internet works, the service may be down.`;
const deadlineKey=(name,day)=>`${name}:${day}`;
const deadlineSlug=(name,day)=>`connection-${name}-${day}`;

// What one connection's result today comes to, given its entry from the last check. Pure: the
// entry to keep and the things to do, in words the caller carries out.
export function nextState(prev={},result,day){
 const carried=prev.deadline?{deadline:prev.deadline}:{};
 // An unset day keeps a pending sign-in whole (what was told, since when, its deadline), so the next day neither repeats the message nor forgets to recover.
 if(!result.set_up){
  const pending=prev.kind==='sign-in'?{kind:prev.kind,told:prev.told,failing_since:prev.failing_since}:{};
  return {entry:{set_up:false,...pending,...carried},actions:[]};
 }
 if(result.ok)return {entry:{set_up:true,ok:true},actions:prev.deadline||prev.kind==='sign-in'?[{do:'recover'}]:[]};
 if(result.kind==='sign-in'){
  if(prev.kind==='sign-in'&&prev.told||prev.deadline)return {entry:{...prev,set_up:true,ok:false,kind:'sign-in',told:true},actions:prev.deadline?[]:[{do:'deadline'}]};
  return {entry:{set_up:true,ok:false,kind:'sign-in',failing_since:day,told:true},actions:[{do:'sign-in'},{do:'deadline'}]};
 }
 // A pending sign-in outlives a day of network trouble: only a working probe resolves it.
 if(prev.kind==='sign-in')return {entry:{...prev,set_up:true,ok:false},actions:prev.deadline?[]:[{do:'deadline'}]};
 const sameDay=prev.kind==='other'&&prev.last_failed_day===day,again=sameDay||prev.kind==='other'&&prev.last_failed_day===addDays(day,-1);
 const failedDays=again?prev.failed_days+(sameDay?0:1):1,told=again&&prev.told;
 return {entry:{set_up:true,ok:false,kind:'other',failing_since:again?prev.failing_since:day,failed_days:failedDays,last_failed_day:day,told:told||failedDays>=2,...carried},
  actions:failedDays>=2&&!told?[{do:'other'}]:[]};
}

// The one place the owner is told; #198's report in the chat's voice replaces this body.
export function tellOwner(store,{id,text}){return queueNotice(store,{id,text});}

// tools/due.js as its own process, as every other deadline change is made: it takes the
// workspace lock itself, so nothing here may hold it (addon-deadlines.mjs, due).
export function runDue(store,day,args){
 const run=spawnSync(process.execPath,[dueScript,...args,'--godspeed',store.root],{cwd:store.root,encoding:'utf8',timeout:60000,windowsHide:true,shell:false,env:{...process.env,GODSPEED_TODAY:day}});
 try{store.scan(true);}catch{}
 return {status:run.status,out:String(run.stdout||run.stderr||'').trim()};
}
const bell=async(store,record)=>{try{await store.saveAsync('notifications',record,undefined,{timeoutMs:30000});}catch{}};

export function readCheckRecord(store){try{const data=JSON.parse(fs.readFileSync(path.join(store.state,RECORD_FILE),'utf8'));return data&&typeof data.connections==='object'&&data.connections?data:{connections:{}};}catch{return {connections:{}};}}

// Runs every probe once, in turn, and does what each result calls for. A probe that throws counts
// as a failure that needs no sign-in. Keeps its record in .godspeed/connection-check.json and, when a deadline could not be made or closed, throws after writing it so the next run retries and the routine reports the failure.
export async function checkConnections({store,day,probes,due=runDue,now=()=>new Date()}){
 const before=readCheckRecord(store),connections={},failures=[];
 for(const name of NAMES){
  let result;try{result=await probes[name]();}catch{result=outcome(false,'other');}
  const worked=path.join(store.state,WORKED_FOLDER,name+'.worked'),{entry,actions}=nextState(before.connections[name],result,day);
  connections[name]=entry;
  const label=CONNECTIONS[name].label;
  for(const action of actions){
   if(action.do==='recover'){
    fs.mkdirSync(path.dirname(worked),{recursive:true});fs.writeFileSync(worked,'');
    const slug=before.connections[name]?.deadline?.slug;
    if(slug&&due(store,day,['done',slug,'--evidence','The daily connection check reached '+label+' again.']).status!==0){connections[name]=before.connections[name];failures.push(name);continue;}
    await bell(store,{id:'connection-'+name,status:'resolved',resolved_at:now().toISOString()});
   }
   if(action.do==='other')tellOwner(store,{id:`connection-${name}-other-${entry.failing_since}`,text:otherWords(name)});
   if(action.do==='sign-in'){
    fs.rmSync(worked,{force:true});
    tellOwner(store,{id:`connection-${name}-${day}`,text:CONNECTIONS[name].signIn});
    await bell(store,{id:'connection-'+name,status:'pending',title:`${label} needs your sign-in`,body:CONNECTIONS[name].signIn,link:'/dashboard/settings'});
   }
   if(action.do==='deadline'){
    const since=entry.failing_since,slug=deadlineSlug(name,since),key=deadlineKey(name,since);
    const made=due(store,day,['add',slug,'--title',`Connect ${label} again`,'--target',day,'--to',addDays(day,DEADLINE_DAYS),
     '--done-when',`The daily connection check reaches ${label} again; it closes this itself.`,'--cost',`Until then ${CONNECTIONS[name].stops}.`,
     '--self-check','file-newer','--self-check-arg',`.godspeed/${WORKED_FOLDER}/${name}.worked`,'--addon','connection-check','--addon-key',key]);
    if(made.status===0)entry.deadline={slug,key};else failures.push(name);
   }
  }
 }
 const record={at:now().toISOString(),day,connections};
 atomic(path.join(store.state,RECORD_FILE),JSON.stringify(record,null,2)+'\n');
 if(failures.length)throw new Error('A deadline could not be changed for: '+failures.join(', '));
 return record;
}
