import fs from 'node:fs';
import path from 'node:path';
import {atomic} from './records/store.mjs';
import {setConfigValue,deleteConfigValue} from './hermes-config.mjs';
import {hermesSettingsFor,baseAddress,readRecord,writeRecord} from './routine-ai.mjs';
import {queueNotice} from './notices.mjs';

// A BACKUP AI, CHOSEN BY THE PERSON (22 October 2026, discussion #20 of the public repository).
// Until now a mission control had exactly one AI connection, and when it failed (an outage, a used-up
// allowance, a sign-in that ran out) every routine that needs an AI stopped until the person fixed it.
// Now the person can connect ONE second AI themselves, in Settings or, on a server, in Telegram with
// /backupai. It is never added by Godspeed on its own, so the promise that Godspeed never moves
// someone's work to another provider, paid model or subscription by itself still holds.
//
// Where it is kept, so that every road to the AI follows the same order (main first, the backup only
// when the main one failed, and only for that one request):
//   - Hermes' own config.yaml, as the one entry of its fallback chain (`fallback_providers`). Hermes
//     tries it for the chat, Telegram and the routines when the main model fails, per turn, and
//     says so in a line of its own ("Provider fallback: ... unavailable; using ..."). An API key goes
//     into the entry itself (`api_key`), never into .env, where a main connection of the same
//     service keeps its own key: config.yaml is private to the assistant's account, as model.api_key
//     already is for a custom address.
//   - <mission control>/.godspeed/provider-backup.json, beside provider.json, for an address the
//     Settings form connected: the notebook's own small jobs and godspeed-model on an installation
//     without Hermes use it.
// What the backup did is kept in .godspeed/backup-ai.json: since when the main one has been failing,
// how often and when the backup answered. Settings shows it, and once the main one has been failing
// for an hour while the backup carries the work, the person is told once (core/notices.mjs).
export const BACKUP_FILE='provider-backup.json';
export const USAGE_FILE='backup-ai.json';
export const CARRYING_AFTER_MS=60*60*1000;

const read=file=>{try{return fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');}catch{return '';}};
const writePrivate=(file,text)=>{fs.mkdirSync(path.dirname(file),{recursive:true});atomic(file,text);if(process.platform!=='win32')try{fs.chmodSync(file,0o600);}catch{}};
const unquote=v=>String(v??'').trim().replace(/^(["'])(.*)\1$/,'$2');

// The Hermes fallback entry for an address the Settings form connects: the same provider names the
// main connection gets (routine-ai.mjs), with the key inside the entry.
export function backupEntryFor({url,key,model}){
 const want=hermesSettingsFor({url,key,model});
 return {provider:want.provider,model:want.model,base_url:want.base_url,api_key:String(key)};
}

// HERMES' FALLBACK CHAIN, READ FROM config.yaml THE WAY IT IS WRITTEN: our own one-line form
// (fallback_providers: [{"provider": ...}], JSON, which is YAML too), the block list Hermes' own
// `hermes fallback` writes, a JSON string `hermes config set` stores, and the older single
// `fallback_model:` section. Entries without both a provider and a model are skipped, as Hermes
// skips them (hermes_cli/fallback_config.py). Keys are never returned, only whether there is one.
function flowValue(own){
 for(const text of [own,own.replace(/\s+#.*$/,'')]){
  try{let value=JSON.parse(text);if(typeof value==='string')value=JSON.parse(value);return value;}catch{}
  try{return JSON.parse(unquote(text));}catch{}
 }
 // A YAML flow list of mappings without quotes, as a person might type it: [{provider: x, model: y}].
 const items=[...own.matchAll(/\{([^}]*)\}/g)].map(m=>Object.fromEntries(m[1].split(',').map(pair=>pair.split(/:(.*)/s)).filter(p=>p.length>1).map(([k,v])=>[k.trim(),unquote(v)])));
 return items.length?items:null;
}
function blockValue(lines){
 // lines: the lines under the key, already without the key itself.
 const items=[];let current=null;
 for(const raw of lines){
  if(!raw.trim()||/^\s*#/.test(raw))continue;
  const item=/^\s*-\s+(.*)$/.exec(raw),body=item?item[1]:raw.trim();
  if(item){current={};items.push(current);}
  if(!current){current={};items.push(current);}
  const pair=/^([A-Za-z_][\w-]*)\s*:\s*(.*?)\s*$/.exec(body);
  if(pair)current[pair[1]]=unquote(pair[2].replace(/\s+#.*$/,''));
 }
 return items;
}
export function fallbackChain(text){
 const lines=String(text||'').replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').split('\n'),out=[],seen=new Set();
 for(const key of ['fallback_providers','fallback_model']){
  const at=lines.findIndex(line=>new RegExp('^'+key+':(?:[ \\t]+.*)?$').test(line));
  if(at===-1)continue;
  const own=lines[at].slice(key.length+1).trim();
  let value;
  if(own&&!own.startsWith('#'))value=flowValue(own);
  else{let end=at+1;while(end<lines.length&&(!lines[end].trim()||/^[ \t]|^-(\s|$)|^#/.test(lines[end])))end++;value=blockValue(lines.slice(at+1,end));if(key==='fallback_model')value=value.length?[Object.assign({},...value)]:[];}
  for(const entry of Array.isArray(value)?value:value&&typeof value==='object'?[value]:[]){
   if(!entry||typeof entry!=='object')continue;
   const provider=unquote(entry.provider),model=unquote(entry.model),base_url=unquote(entry.base_url).replace(/\/+$/,'');
   if(!provider||!model)continue;
   const id=[provider.toLowerCase(),model.toLowerCase(),base_url.toLowerCase()].join('\n');if(seen.has(id))continue;seen.add(id);
   out.push({provider,model,...(base_url?{base_url}:{}),key:!!(unquote(entry.api_key)||unquote(entry.key_env)||unquote(entry.api_key_env))});
  }
 }
 return out;
}

// The one backup goes into Hermes as the whole fallback chain: a chain set by hand before is
// replaced, since the person just chose this one, and the older single fallback_model goes with it.
export function setHermesBackup(home,entry){
 const clean={provider:String(entry.provider||'').trim(),model:String(entry.model||'').trim()};
 if(!clean.provider||!clean.model||clean.provider==='auto')throw Error('Name the backup AI\'s service and model');
 if(entry.base_url)clean.base_url=String(entry.base_url).trim().replace(/\/+$/,'');
 if(entry.api_key){if(/[\s"'\\]/.test(entry.api_key))throw Error('The key has a space or a quotation mark in it. Copy it again from your AI account.');clean.api_key=String(entry.api_key);}
 const file=path.join(home,'config.yaml');
 let text=deleteConfigValue(read(file),['fallback_model']);
 text=setConfigValue(text,['fallback_providers'],JSON.stringify([clean]));
 writePrivate(file,text);
 return clean;
}
export function clearHermesBackup(home){
 const file=path.join(home,'config.yaml'),before=read(file);if(!before)return false;
 const text=deleteConfigValue(deleteConfigValue(before,['fallback_providers']),['fallback_model']);
 if(text===before)return false;
 writePrivate(file,text);return true;
}

// The address the Settings form connected, for the notebook's own small jobs and an installation
// without Hermes. Same shape as provider.json.
export function readBackupEndpoint(state){
 try{const saved=JSON.parse(read(path.join(state,BACKUP_FILE)));return saved?.url&&saved.key&&saved.model?saved:null;}catch{return null;}
}
const endpointOf=({url,key,model})=>{const address=String(url||'').trim();return {url:/\/chat\/completions\/?$/.test(address)?address:baseAddress(address)+'/chat/completions',key:String(key||'').trim(),model:String(model||'').trim()};};

// Connecting from the Settings form: the address goes to both places, Hermes' chain (when this
// installation runs its routines through Hermes) and the notebook's own file.
export function connectBackupAI({home,state,config,now=new Date()}){
 const endpoint=endpointOf(config),entry=home?backupEntryFor(endpoint):null;
 if(!home)hermesSettingsFor(endpoint);// the same checks of the address, key and model
 if(home)setHermesBackup(home,entry);
 writePrivate(path.join(state,BACKUP_FILE),JSON.stringify(endpoint));
 noteConnected(state,{provider:entry?.provider||'api',model:endpoint.model,base_url:baseAddress(endpoint.url),via:'settings',now});
 return backupStatus({home,state});
}
// Connecting any Hermes provider: a ChatGPT plan (Settings or Telegram) or a key of any service (Telegram).
// The notebook's own address for an earlier backup goes: this one is reached through Hermes.
export function connectHermesBackup({home,state,entry,via='telegram',now=new Date()}){
 const clean=setHermesBackup(home,entry);
 try{fs.unlinkSync(path.join(state,BACKUP_FILE));}catch{}
 noteConnected(state,{provider:clean.provider,model:clean.model,base_url:clean.base_url||null,via,now});
 return backupStatus({home,state});
}
function noteConnected(state,{provider,model,base_url,via,now}){
 const record=readRecord(state);record.backup={provider,model,base_url:base_url||null,via,at:now.toISOString()};delete record.backup_check;writeRecord(state,record);
 // A new backup starts with a clean slate: what the previous one did is not this one's.
 writeUsage(state,{});
}
export function removeBackupAI({home,state}){
 const hermes=home?clearHermesBackup(home):false;
 let file=false;try{fs.unlinkSync(path.join(state,BACKUP_FILE));file=true;}catch{}
 const record=readRecord(state);const had=!!record.backup;delete record.backup;delete record.backup_check;if(had)writeRecord(state,record);
 writeUsage(state,{});
 return {removed:hermes||file||had,...backupStatus({home,state})};
}

// WHAT SETTINGS SHOWS: the backup (Hermes' chain first, else the notebook's own address), where it
// came from (settings, telegram, or hermes for one set in Hermes itself, `hermes fallback`), and
// what it did.
export function backupStatus({home,state}){
 const record=readRecord(state).backup||null,usage=readUsage(state);let backup=null,more=0;
 const chain=home?fallbackChain(read(path.join(home,'config.yaml'))):[];
 if(chain.length){
  const [first]=chain;more=chain.length-1;
  const ours=record&&record.provider===first.provider&&record.model===first.model;
  backup={provider:first.provider,model:first.model,base_url:first.base_url||null,via:ours?record.via:'hermes',at:ours?record.at:null};
 }else{
  const endpoint=readBackupEndpoint(state);
  if(endpoint)backup={provider:'api',model:endpoint.model,base_url:baseAddress(endpoint.url),via:'settings',at:record?.at||null};
 }
 return {configured:!!backup,backup,more,usage:{answers:usage.answers||0,last_answer_at:usage.last_answer_at||null,main_failing_since:usage.main_failing_since||null,last_main_error:usage.last_main_error||null},check:readRecord(state).backup_check||null};
}

// WHAT THE BACKUP DID. Several programs write it (the notebook, godspeed-model for an add-on), so a
// count lost to two writing at the same moment is possible and harmless; the times are what matter.
export function readUsage(state){try{const u=JSON.parse(read(path.join(state,USAGE_FILE)));return u&&typeof u==='object'?u:{};}catch{return {};}}
function writeUsage(state,usage){try{fs.mkdirSync(state,{recursive:true});atomic(path.join(state,USAGE_FILE),JSON.stringify(usage,null,2)+'\n');}catch{}}
const plainError=error=>String(error?.message||error||'').replace(/\s+/g,' ').slice(0,240);
export function noteMainAnswered(state){
 const usage=readUsage(state);if(!usage.main_failing_since)return;
 delete usage.main_failing_since;delete usage.last_main_error;writeUsage(state,usage);
}
export function noteMainFailed(state,error,now=new Date()){
 const usage=readUsage(state);usage.main_failing_since??=now.toISOString();usage.last_main_error=plainError(error);writeUsage(state,usage);
}
// The backup answered. Once the main one has been failing for an hour, the person is told once
// for that stretch, where the routines' results go and on the notebook's bell.
export function noteBackupAnswered(state,{provider,model}={},now=new Date()){
 const usage=readUsage(state);usage.answers=(usage.answers||0)+1;usage.last_answer_at=now.toISOString();usage.last_answer={provider:provider||null,model:model||null};
 const since=usage.main_failing_since;
 if(since&&now-Date.parse(since)>=CARRYING_AFTER_MS&&usage.told_for!==since){
  try{if(queueNotice({state},{id:'backup-ai-'+since,text:carryingWords(model)}))usage.told_for=since;}catch{}
 }
 writeUsage(state,usage);
}
export function carryingWords(model){
 return 'Your main AI has not been answering for more than an hour, so your backup AI'+(model?' ('+model+')':'')+' is doing the work for now. Nothing is lost. To fix the main one, open Settings in your notebook and look at Your AI.';
}

// THE NOTEBOOK'S OWN CALLS (provider.json, an address the Settings form connected): the main one
// first; only when it failed, and only for that request, the backup. A request the person stopped,
// or one that ran out of its time, is not tried again: the time it had is used up, and running it a
// second time could outlast the supervisor's patience (supervisor-health.mjs).
// backup: a function that returns the backup provider at the moment it is needed, or null, so a
// backup connected or removed in Settings counts from the next request on.
export function fallsBack(error,input){
 if(input?.signal?.aborted)return false;
 return !/Reply stopped|did not finish within|exceeded five minutes|exceeded its limit/i.test(String(error?.message||''));
}
// The backup gets only the time the request has left (input.timeout_ms, ten minutes when unnamed,
// as runtime.mjs gives a request), so main and backup together never outlast the request's own
// limit; with less than five seconds left it is not tried.
export function withBackup(main,backup,{state,model}={}){
 if(!main||typeof backup!=='function')return main;
 const run=async input=>{
  let first;const started=Date.now();
  try{const answer=await main(input);if(state)noteMainAnswered(state);return answer;}
  catch(error){first=error;}
  const left=(Number(input?.timeout_ms)||600000)-(Date.now()-started);
  const second=fallsBack(first,input)&&left>=5000?backup():null;
  if(!second)throw first;
  if(state)noteMainFailed(state,first);
  let answer;
  const limit=AbortSignal.timeout(left),signal=input?.signal?AbortSignal.any([input.signal,limit]):limit;
  try{answer=await second({...input,signal});}catch{throw first;}
  if(state)noteBackupAnswered(state,{provider:'api',model:typeof model==='function'?model():model});
  return answer;
 };
 return Object.assign(run,main);
}
