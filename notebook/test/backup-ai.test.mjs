import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {backupEntryFor,fallbackChain,setHermesBackup,clearHermesBackup,connectBackupAI,connectHermesBackup,removeBackupAI,backupStatus,
 readBackupEndpoint,readUsage,noteMainFailed,noteMainAnswered,noteBackupAnswered,withBackup,fallsBack,CARRYING_AFTER_MS,BACKUP_FILE} from '../core/backup-ai.mjs';
import {deleteConfigValue} from '../core/hermes-config.mjs';
import {connectRoutineAI,routineAIStatus} from '../core/routine-ai.mjs';
import {readNotices} from '../core/notices.mjs';

// A backup AI the person connects themselves (discussion #20): kept as Hermes' one fallback entry and
// as a second saved address, used only when the main one fails, and only for that request.
const temporary=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'godspeed-backup-ai-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
const place=t=>{const root=temporary(t),home=path.join(root,'hermes'),state=path.join(root,'.godspeed');fs.mkdirSync(home,{recursive:true});fs.mkdirSync(state,{recursive:true});return {root,home,state,config:path.join(home,'config.yaml')};};
const openrouter={url:'https://openrouter.ai/api/v1/chat/completions',key:'sk-or-fictional-backup',model:'fictional/backup-model'};

test('an address from the Settings form becomes one Hermes fallback entry with its key inside',()=>{
 assert.deepEqual(backupEntryFor(openrouter),{provider:'openrouter',model:'fictional/backup-model',base_url:'https://openrouter.ai/api/v1',api_key:'sk-or-fictional-backup'});
 assert.deepEqual(backupEntryFor({url:'https://api.openai.com/v1',key:'sk-fictional',model:'gpt-fictional'}),{provider:'openai-api',model:'gpt-fictional',base_url:'https://api.openai.com/v1',api_key:'sk-fictional'});
 assert.deepEqual(backupEntryFor({url:'https://llm.example.org/v1/chat/completions',key:'k1',model:'m'}),{provider:'custom',model:'m',base_url:'https://llm.example.org/v1',api_key:'k1'});
 assert.throws(()=>backupEntryFor({...openrouter,key:'has a space'}),/space or a quotation mark/);
 assert.throws(()=>backupEntryFor({...openrouter,model:' '}),/Name the model/);
});

test('the fallback chain is read in every form Hermes and people write it, without its keys',()=>{
 assert.deepEqual(fallbackChain('model:\n  provider: openai-codex\n'),[]);
 assert.deepEqual(fallbackChain('fallback_providers: [{"provider":"openrouter","model":"a/b","base_url":"https://openrouter.ai/api/v1/","api_key":"secret"}]\n'),
  [{provider:'openrouter',model:'a/b',base_url:'https://openrouter.ai/api/v1',key:true}]);
 // The block list `hermes fallback add` writes, indented or not, and a later top-level key.
 const block='model:\n  provider: anthropic\nfallback_providers:\n- provider: openrouter\n  model: x/one\n  key_env: MY_KEY\n- provider: anthropic\n  model: "claude-two"\ntimezone: UTC\n';
 assert.deepEqual(fallbackChain(block),[{provider:'openrouter',model:'x/one',key:true},{provider:'anthropic',model:'claude-two',key:false}]);
 assert.deepEqual(fallbackChain('fallback_providers:\n  - provider: openai-codex\n    model: gpt-fictional # the plan\n'),[{provider:'openai-codex',model:'gpt-fictional',key:false}]);
 // The older single section, and a JSON string as `hermes config set` stores one.
 assert.deepEqual(fallbackChain('fallback_model:\n  provider: openrouter\n  model: old/one\n'),[{provider:'openrouter',model:'old/one',key:false}]);
 assert.deepEqual(fallbackChain('fallback_providers: \'[{"provider": "xai", "model": "grok-fictional"}]\'\n'),[{provider:'xai',model:'grok-fictional',key:false}]);
 assert.deepEqual(fallbackChain('fallback_providers: [{provider: deepseek, model: deepseek-fictional}]\n'),[{provider:'deepseek',model:'deepseek-fictional',key:false}]);
 // Entries without a provider or a model are skipped, as Hermes skips them; a repeat counts once.
 assert.deepEqual(fallbackChain('fallback_providers:\n- provider: openrouter\n- model: lonely\nfallback_model:\n  provider: x\n  model: y\n'),[{provider:'x',model:'y',key:false}]);
 assert.deepEqual(fallbackChain('fallback_providers: [{"provider":"x","model":"y"}]\nfallback_model:\n  provider: x\n  model: y\n'),[{provider:'x',model:'y',key:false}]);
 assert.deepEqual(fallbackChain('fallback_providers: []\n'),[]);
});

test('setting the backup replaces the chain, keeps everything else in config.yaml, and removing it takes only it',t=>{
 const {home,config}=place(t);
 fs.writeFileSync(config,'# owner notes\nmodel:\n  provider: openai-codex\n  default: gpt-fictional\nfallback_model:\n  provider: old\n  model: older\nfallback_providers:\n- provider: one\n  model: first\n- provider: two\n  model: second\n\n# about the clock\ntimezone: "Europe/Berlin"\n');
 setHermesBackup(home,{provider:'openrouter',model:'fictional/backup-model',base_url:'https://openrouter.ai/api/v1/',api_key:'sk-or-fictional'});
 const text=fs.readFileSync(config,'utf8');
 assert.deepEqual(fallbackChain(text),[{provider:'openrouter',model:'fictional/backup-model',base_url:'https://openrouter.ai/api/v1',key:true}]);
 for(const kept of ['# owner notes','provider: openai-codex','default: gpt-fictional','# about the clock','timezone: "Europe/Berlin"'])assert.ok(text.includes(kept),kept);
 assert.ok(!text.includes('older')&&!text.includes('first'),'the chain set before is replaced, and the older single fallback goes too');
 if(process.platform!=='win32')assert.equal(fs.statSync(config).mode&0o777,0o600);
 assert.throws(()=>setHermesBackup(home,{provider:'auto',model:'x'}),/service and model/);
 assert.throws(()=>setHermesBackup(home,{provider:'openrouter',model:'x',api_key:'a b'}),/space or a quotation mark/);
 assert.equal(clearHermesBackup(home),true);
 const after=fs.readFileSync(config,'utf8');
 assert.equal(after,'# owner notes\nmodel:\n  provider: openai-codex\n  default: gpt-fictional\n\n# about the clock\ntimezone: "Europe/Berlin"\n');
 assert.equal(clearHermesBackup(home),false,'nothing left to remove');
});

test('a key is removed with its whole section, and the lines around it stay',()=>{
 assert.equal(deleteConfigValue('a: 1\nfallback_providers:\n  - provider: x\n    model: y\nb: 2\n',['fallback_providers']),'a: 1\nb: 2\n');
 assert.equal(deleteConfigValue('a: 1\nfallback_providers: [{"provider":"x"}]\n',['fallback_providers']),'a: 1\n');
 assert.equal(deleteConfigValue('agent:\n  keep: 1\n  drop:\n    - one\n  also: 2\n',['agent','drop']),'agent:\n  keep: 1\n  also: 2\n');
 assert.equal(deleteConfigValue('a: 1\n',['missing']),'a: 1\n');
});

test('connecting in Settings writes both places, Settings reads it back, and the main connection is untouched',t=>{
 const {home,state,config}=place(t);
 connectRoutineAI({home,state,config:{url:'https://api.openai.com/v1/chat/completions',key:'sk-main-fictional',model:'gpt-main'}});
 const mainBefore=routineAIStatus({home,state}),envBefore=fs.readFileSync(path.join(home,'.env'),'utf8');
 assert.deepEqual(backupStatus({home,state}).configured,false);
 const status=connectBackupAI({home,state,config:openrouter});
 assert.equal(status.configured,true);
 assert.deepEqual({provider:status.backup.provider,model:status.backup.model,via:status.backup.via},{provider:'openrouter',model:'fictional/backup-model',via:'settings'});
 assert.deepEqual(readBackupEndpoint(state),openrouter,'the notebook\'s own second address');
 assert.equal(fs.readFileSync(path.join(home,'.env'),'utf8'),envBefore,'the backup\'s key never goes into .env');
 const mainAfter=routineAIStatus({home,state});
 assert.deepEqual([mainAfter.provider,mainAfter.model,mainAfter.source,mainAfter.key],[mainBefore.provider,mainBefore.model,mainBefore.source,mainBefore.key]);
 assert.ok(!JSON.stringify(status).includes('sk-or-fictional-backup'),'Settings never gets the key back');
 assert.match(fs.readFileSync(config,'utf8'),/^model:\n  provider: "openai-api"/m);
 // One set in Hermes itself (hermes fallback add) is shown as Hermes' own.
 setHermesBackup(home,{provider:'anthropic',model:'claude-fictional'});
 assert.equal(backupStatus({home,state}).backup.via,'hermes');
 // Removing takes both places and leaves the main connection.
 const removed=removeBackupAI({home,state});
 assert.equal(removed.removed,true);assert.equal(removed.configured,false);
 assert.deepEqual(fallbackChain(fs.readFileSync(config,'utf8')),[]);assert.equal(readBackupEndpoint(state),null);
 assert.equal(routineAIStatus({home,state}).model,'gpt-main');
});

test('without Hermes the backup is the second saved address only',t=>{
 const {state}=place(t);
 const status=connectBackupAI({home:null,state,config:{url:'https://llm.example.org/v1',key:'k-backup',model:'backup-m'}});
 assert.equal(status.configured,true);assert.equal(status.backup.provider,'api');assert.equal(status.backup.base_url,'https://llm.example.org/v1');
 assert.deepEqual(JSON.parse(fs.readFileSync(path.join(state,BACKUP_FILE),'utf8')),{url:'https://llm.example.org/v1/chat/completions',key:'k-backup',model:'backup-m'});
 if(process.platform!=='win32')assert.equal(fs.statSync(path.join(state,BACKUP_FILE)).mode&0o777,0o600);
 assert.throws(()=>connectBackupAI({home:null,state,config:{url:'nonsense',key:'k',model:'m'}}),/starting with https/);
 removeBackupAI({home:null,state});assert.equal(backupStatus({home:null,state}).configured,false);
});

test('a backup any Hermes provider can be (the Telegram chat): a plan sign-in or a key',t=>{
 const {home,state,config}=place(t);
 const status=connectHermesBackup({home,state,entry:{provider:'openai-codex',model:'gpt-fictional'}});
 assert.equal(status.backup.via,'telegram');assert.equal(status.backup.provider,'openai-codex');
 connectHermesBackup({home,state,entry:{provider:'anthropic',model:'claude-fictional',api_key:'sk-ant-fictional'}});
 assert.deepEqual(fallbackChain(fs.readFileSync(config,'utf8')),[{provider:'anthropic',model:'claude-fictional',key:true}]);
});

test('the main one answers first; the backup only when it failed, and only for that request',async t=>{
 const {state}=place(t);let mainCalls=0,backupCalls=0,mainFails=true;
 const main=async input=>{mainCalls++;if(mainFails)throw Error('Model provider failed with HTTP 503: overloaded');return 'main answer '+input.n;};
 const backup=async input=>{backupCalls++;return 'backup answer '+input.n;};
 // No backup connected: today's behaviour, the main one's own error.
 const alone=withBackup(main,()=>null,{state});
 await assert.rejects(alone({n:1}),/HTTP 503/);assert.equal(backupCalls,0);
 const both=withBackup(main,()=>backup,{state,model:()=>'backup-m'});
 assert.equal(await both({n:2}),'backup answer 2');
 assert.equal(readUsage(state).answers,1);assert.ok(readUsage(state).main_failing_since);assert.match(readUsage(state).last_main_error,/HTTP 503/);
 // The next request tries the main one first again.
 mainFails=false;assert.equal(await both({n:3}),'main answer 3');
 assert.equal(mainCalls,3);assert.equal(backupCalls,1);assert.equal(readUsage(state).main_failing_since,undefined,'the main one is back');
 // A stopped request, or one that ran out of time, is not sent again; a failed backup gives the main one's words.
 mainFails=true;const controller=new AbortController();controller.abort();
 await assert.rejects(both({n:4,signal:controller.signal}),/HTTP 503/);assert.equal(backupCalls,1);
 const slow=withBackup(async()=>{throw Error('The scheduled AI call exceeded five minutes. This attempt failed.');},()=>backup,{state});
 await assert.rejects(slow({}),/five minutes/);assert.equal(backupCalls,1);
 const broken=withBackup(main,()=>async()=>{throw Error('backup down too');},{state});
 await assert.rejects(broken({}),/HTTP 503/);
 assert.equal(fallsBack(Error('Reply stopped')),false);assert.equal(fallsBack(Error('Model provider failed with HTTP 401')),true);
});

test('the person is told once when the main one has been failing for an hour and the backup carries the work',t=>{
 const {state}=place(t),start=new Date('2026-10-22T08:00:00Z');
 noteMainFailed(state,Error('HTTP 429'),start);
 noteBackupAnswered(state,{model:'backup-m'},new Date(start.getTime()+10*60000));
 assert.equal(readNotices({state}).length,0,'ten minutes is a passing fault');
 noteMainFailed(state,Error('HTTP 429 again'),new Date(start.getTime()+30*60000));
 assert.equal(readUsage(state).main_failing_since,start.toISOString(),'the stretch starts at the first failure');
 noteBackupAnswered(state,{model:'backup-m'},new Date(start.getTime()+CARRYING_AFTER_MS));
 noteBackupAnswered(state,{model:'backup-m'},new Date(start.getTime()+2*CARRYING_AFTER_MS));
 const notices=readNotices({state});
 assert.equal(notices.length,1,'once for this stretch');
 assert.match(notices[0].text,/Your main AI has not been answering for more than an hour, so your backup AI \(backup-m\) is doing the work for now\./);
 assert.ok(!/—/.test(notices[0].text));
 // The main one came back; a new stretch later is told again.
 noteMainAnswered(state);
 const later=new Date(start.getTime()+24*CARRYING_AFTER_MS);noteMainFailed(state,Error('HTTP 500'),later);
 noteBackupAnswered(state,{model:'backup-m'},new Date(later.getTime()+CARRYING_AFTER_MS));
 assert.equal(readNotices({state}).length,2);
 assert.equal(readUsage(state).answers,4);
});

test('the backup gets only the time the request has left',async t=>{
 const {state}=place(t);let seen;
 const slowFailure=async()=>{await new Promise(r=>setTimeout(r,60));throw Error('Model provider failed with HTTP 504');};
 const backup=async input=>{seen=input;return 'backup';};
 const both=withBackup(slowFailure,()=>backup,{state});
 assert.equal(await both({timeout_ms:20000,contract:'x'}),'backup');
 assert.ok(seen.signal instanceof AbortSignal&&!seen.signal.aborted,'a limit of its own, still running');assert.equal(seen.contract,'x');
 seen=null;
 const nearlyOut=withBackup(async()=>{await new Promise(r=>setTimeout(r,30));throw Error('HTTP 502');},()=>backup,{state});
 await assert.rejects(nearlyOut({timeout_ms:5020}),/HTTP 502/);assert.equal(seen,null,'too little time left to try the backup');
});

test('the notebook server tries the backup address for its own calls when the main address fails',async t=>{
 const http=await import('node:http');
 const previous=process.env.GODSPEED_ORIGINAL_RUNTIME;delete process.env.GODSPEED_ORIGINAL_RUNTIME;
 t.after(()=>{if(previous!==undefined)process.env.GODSPEED_ORIGINAL_RUNTIME=previous;});
 const serve=reply=>new Promise(resolve=>{const seen=[];const server=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;seen.push(JSON.parse(body));const [status,data]=reply();res.statusCode=status;res.setHeader('content-type','application/json');res.end(JSON.stringify(data));});server.listen(0,'127.0.0.1',()=>{t.after(()=>new Promise(r=>server.close(r)));resolve({url:'http://127.0.0.1:'+server.address().port+'/v1',seen});});});
 let mainUp=true;
 const main=await serve(()=>mainUp?[200,{choices:[{message:{content:'Connected'}}]}]:[401,{error:{message:'invalid api key'}}]),backup=await serve(()=>[200,{choices:[{message:{content:'Connected'}}]}]);
 const root=temporary(t),{createService}=await import('../server/main.mjs');
 const service=await createService({root,port:0}),base='http://127.0.0.1:'+service.address.port;
 const call=async(route,body)=>{const r=await fetch(base+'/api/'+route,{method:body?'POST':'GET',headers:{'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};};
 try{
  assert.equal((await call('backup-ai')).data.configured,false);
  assert.equal((await call('provider',{url:main.url,key:'main-key',model:'main-model'})).status,200);
  // The main AI's service is not a backup, also with another model or key: it fails with the main AI.
  for(const again of [{url:main.url,key:'main-key',model:'main-model'},{url:main.url,key:'other-key',model:'other-model'}]){
   const same=await call('backup-ai',again);assert.equal(same.status,400);assert.match(same.data.error,/That is the service your main AI uses already\. A backup steps in when the main AI fails, so it has to be another service\./);
  }
  const added=await call('backup-ai',{url:backup.url,key:'backup-key',model:'backup-model'});
  assert.equal(added.status,200,JSON.stringify(added.data));
  assert.deepEqual([added.data.configured,added.data.hermes,added.data.backup.provider,added.data.backup.model],[true,false,'api','backup-model']);
  assert.ok(!JSON.stringify(added.data).includes('backup-key'));
  assert.equal(backup.seen.length,1,'tested before it was saved');
  // Nor can the main AI move to the backup's service: the backup would be no backup.
  const swap=await call('provider',{url:backup.url,key:'backup-key',model:'other-model'});
  assert.equal(swap.status,400);assert.match(swap.data.error,/That is the service your backup AI uses\. Remove the backup first/);
  // The main address fails: the notebook's own request is answered by the backup.
  mainUp=false;
  assert.equal(await service.domains.provider({kind:'fictional-small-job',contract:'Reply with Connected.'}),'Connected');
  assert.equal(backup.seen.length,2);assert.equal(backup.seen[1].model,'backup-model');
  const status=(await call('backup-ai')).data;assert.equal(status.usage.answers,1);assert.ok(status.usage.main_failing_since);
  // Removed, it is gone: the main one's failure is said again.
  const removed=await call('backup-ai/remove',{});assert.equal(removed.data.removed,true);assert.equal(removed.data.configured,false);
  await assert.rejects(service.domains.provider({kind:'fictional-small-job',contract:'Reply with Connected.'}),/HTTP 401/);
  assert.equal(backup.seen.length,2);
  const bad=await call('backup-ai',{url:backup.url,key:'two words',model:'m'});assert.equal(bad.status,400);
 }finally{await service.close();}
});
