import fs from 'node:fs';
import path from 'node:path';
import {atomic} from './records/store.mjs';
import {setConfigValue,readConfigValue,deleteConfigValue} from './hermes-config.mjs';
import {hermesProvider} from './runtime.mjs';
import {hermesHelper,runHermesHelper} from './addon-model.mjs';
import {fallbackChain,noteMainAnswered,noteMainFailed} from './backup-ai.mjs';

// THE AI THE ROUTINES THINK WITH (18 October 2026). Every installer ends with "connect your own AI
// account in Settings", and until this change that form powered only the notebook's own small jobs
// and its chat: the six routines a first goal starts are Hermes jobs, and Hermes reads its model and
// key from its own home (config.yaml and .env), which the form never touched. A reader who did what
// the installer said got routines that failed every morning. Now what the form connects is written
// into Hermes as well, so the chat, the routines and the notebook use one AI, and Settings says
// plainly whether the routines can reach it.
//
// A Hermes that already has a sign-in of its own (the Windows app, `hermes model`) keeps it: the
// form writes into Hermes only when the person ticks "Use it for the routines too", which is ticked
// for them only when the routines have no AI yet or use the one this form connected before.

const RECORD='routine-ai.json';
const unquote=v=>typeof v==='string'?v.replace(/^["']|["']$/g,'').trim():'';
// The endpoint's address without /chat/completions, the form Hermes and every OpenAI-compatible
// library want as their base address.
export function baseAddress(url){return String(url||'').trim().replace(/\/chat\/completions\/?$/,'').replace(/\/+$/,'');}

// What Hermes needs for an endpoint the Settings form connects (Hermes hermes_cli/auth.py and
// runtime_provider_backends.py): OpenRouter is Hermes' own provider "openrouter" with
// OPENROUTER_API_KEY; OpenAI's API is "openai-api" with OPENAI_API_KEY; any other
// OpenAI-compatible address is "custom", whose key Hermes reads from model.api_key.
export function hermesSettingsFor({url,key,model}){
 const base=baseAddress(url);let host;
 try{host=new URL(base).hostname.toLowerCase();}catch{throw Error('Give the address of an AI service, starting with https://');}
 if(!key||/[\s"'\\]/.test(key))throw Error('The key has a space or a quotation mark in it. Copy it again from your AI account.');
 if(!model||!String(model).trim())throw Error('Name the model the routines should use');
 model=String(model).trim();
 if(host==='openrouter.ai'||host.endsWith('.openrouter.ai'))return {provider:'openrouter',base_url:'https://openrouter.ai/api/v1',model,env:{OPENROUTER_API_KEY:key}};
 if(host==='api.openai.com')return {provider:'openai-api',base_url:'https://api.openai.com/v1',model,env:{OPENAI_API_KEY:key}};
 return {provider:'custom',base_url:base,model,api_key:key};
}

// One NAME=value line of Hermes' .env, changed in place or added; every other line stays.
export function setEnvValue(text,name,value){
 const lines=String(text||'').replace(/\r\n/g,'\n').split('\n');let found=false;
 const out=lines.map(line=>{if(new RegExp('^\\s*(?:export\\s+)?'+name+'\\s*=').test(line)){if(found)return null;found=true;return name+'='+value;}return line;}).filter(l=>l!==null);
 if(!found){while(out.length&&out.at(-1)==='')out.pop();out.push(name+'='+value);}
 return out.join('\n').replace(/\n*$/,'\n');
}
const envValue=(text,name)=>{const m=new RegExp('^\\s*(?:export\\s+)?'+name+'\\s*=\\s*(.*)$','m').exec(String(text||''));return m?unquote(m[1]):'';};
const read=file=>{try{return fs.readFileSync(file,'utf8').replace(/^\uFEFF/,'');}catch{return '';}};
const writePrivate=(file,text)=>{atomic(file,text);if(process.platform!=='win32')try{fs.chmodSync(file,0o600);}catch{}};
export function readRecord(state){try{const r=JSON.parse(fs.readFileSync(path.join(state,RECORD),'utf8'));return r&&typeof r==='object'?r:{};}catch{return {};}}
export const writeRecord=(state,record)=>atomic(path.join(state,RECORD),JSON.stringify(record,null,2)+'\n');

// Writes the endpoint into Hermes' own home: the model section of config.yaml and the key in .env
// (or, for a custom address, in config.yaml, which is private to this account).
export function connectRoutineAI({home,state,config,now=new Date()}){
 const want=hermesSettingsFor(config),configFile=path.join(home,'config.yaml'),envFile=path.join(home,'.env');
 fs.mkdirSync(home,{recursive:true});
 // "model: some-name" on one line (Hermes reads it as the default model) becomes a section first,
 // since the keys below go under it.
 let text=read(configFile).replace(/\r\n/g,'\n').replace(/^model:[ \t]*(?!\{\}|#|$)[^\n]*$/m,'model:');
 text=setConfigValue(text,['model','provider'],JSON.stringify(want.provider));
 text=setConfigValue(text,['model','default'],JSON.stringify(want.model));
 text=setConfigValue(text,['model','base_url'],JSON.stringify(want.base_url));
 // A key written for a custom address stays only while one is in use: another provider reads its own.
 text=setConfigValue(text,['model','api_key'],want.api_key?JSON.stringify(want.api_key):'""');
 writePrivate(configFile,text);
 if(want.env){let env=read(envFile);for(const [name,value] of Object.entries(want.env))env=setEnvValue(env,name,value);writePrivate(envFile,env);}
 const record={...readRecord(state),connected:{provider:want.provider,model:want.model,base_url:want.base_url,at:now.toISOString()}};
 delete record.check;writeRecord(state,record);
 return routineAIStatus({home,state});
}

// What the routines think with, read from Hermes' own home, and the last check of it.
//   source: settings (this form connected it), hermes (a sign-in of Hermes' own) or none
//   key: true when the key the provider reads is there, false when it is missing, null when the
//        provider signs in another way (an app sign-in Hermes keeps in auth.json)
export function routineAIStatus({home,state}){
 const config=read(path.join(home,'config.yaml')),env=read(path.join(home,'.env'));
 const provider=unquote(readConfigValue(config,['model','provider'])||''),model=unquote(readConfigValue(config,['model','default'])||readConfigValue(config,['model','model'])||'');
 const base_url=unquote(readConfigValue(config,['model','base_url'])||'');
 const record=readRecord(state),ours=record.connected&&record.connected.provider===provider&&record.connected.model===model;
 const keyName={openrouter:'OPENROUTER_API_KEY','openai-api':'OPENAI_API_KEY',anthropic:'ANTHROPIC_API_KEY',gemini:'GEMINI_API_KEY'}[provider];
 const key=keyName?!!(envValue(env,keyName)||(keyName==='GEMINI_API_KEY'&&envValue(env,'GOOGLE_API_KEY'))):provider==='custom'?!!unquote(readConfigValue(config,['model','api_key'])||''):null;
 const named=!!model&&!!provider&&provider!=='auto';
 return {provider:provider||null,model:model||null,base_url:base_url||null,source:!named?'none':ours?'settings':'hermes',key,check:record.check||null};
}

// THE CHECK: one short request through Hermes, as the routines make theirs (the model and key
// from Hermes' own home, no tools), so "the routines can reach the AI" is something seen, not
// assumed. Its result is kept beside the notebook's other machine state.
export async function checkRoutineAI({executable,home,cwd,state,sourceRoot,spawnProcess,now=()=>new Date(),ask=askDirectly}){
 const started=now();let check;
 // WITH A BACKUP AI IN HERMES' CHAIN (core/backup-ai.mjs), a request through Hermes is answered by
 // the backup whenever the main one fails, so "the routines reached it" would hide a main connection
 // that is broken. Then each is asked on its own, through the helper godspeed-model uses (the
 // assistant's own model settings and credentials, no tools, never the other one).
 const backup=fallbackChain(read(path.join(home,'config.yaml')))[0];
 if(backup){
  const one=async route=>{try{await ask({executable,home,cwd,sourceRoot,spawnProcess,route});return {ok:true};}catch(error){return {ok:false,error:String(error?.message||error).slice(0,300)};}};
  const main=await one('main'),second=await one('backup');
  if(main.ok)noteMainAnswered(state);else noteMainFailed(state,main.error,started);
  check={at:started.toISOString(),ok:main.ok,...(main.ok?{}:{error:main.error}),backup:{...second,model:backup.model}};
  writeRecord(state,{...readRecord(state),check});
  return {...routineAIStatus({home,state}),check};
 }
 try{
  const ask=hermesProvider({executable,home,cwd,sourceRoot,spawnProcess});
  const reply=await ask({kind:'connection-test',contract:'Reply with the single word Connected.',timeout_ms:300000});
  check={at:started.toISOString(),ok:true,reply:String(reply).slice(0,80)};
 }catch(error){check={at:started.toISOString(),ok:false,error:String(error?.message||error).slice(0,300)};}
 writeRecord(state,{...readRecord(state),check});
 return {...routineAIStatus({home,state}),check};
}
// One short request to the main connection or the backup, by name, or to the models of a ChatGPT
// plan just signed in ("plan", the first that answers; assistant-files/addon-model.py).
export async function askDirectly({executable,home,cwd,sourceRoot,spawnProcess,route,timeoutMs=route==='plan'?480000:120000}){
 const connection=hermesHelper({verified:true,executable,home,sourceRoot},path.join(path.resolve(cwd),'.godspeed'));
 return runHermesHelper({connection,root:cwd,spawnProcess,deadline:Date.now()+timeoutMs,
  request:{system:'Reply with the single word Connected.',prompt:'Are you there?',timeout_ms:Math.min(timeoutMs,120000),max_tokens:128,route}});
}

// A CHATGPT PLAN AS THE MAIN AI, signed in from Settings (core/plan-signin.mjs): the model section
// names the plan and the model that answered. An address or key left from an earlier main AI goes,
// since the plan has its own. Nothing is written before a model of the plan answered.
export function connectPlanMain({home,state,model,now=new Date()}){
 if(!model||!String(model).trim())throw Error('Name the model the routines should use');
 const configFile=path.join(home,'config.yaml');fs.mkdirSync(home,{recursive:true});
 let text=read(configFile).replace(/\r\n/g,'\n').replace(/^model:[ \t]*(?!\{\}|#|$)[^\n]*$/m,'model:');
 text=setConfigValue(text,['model','provider'],JSON.stringify('openai-codex'));
 text=setConfigValue(text,['model','default'],JSON.stringify(String(model).trim()));
 text=deleteConfigValue(deleteConfigValue(text,['model','base_url']),['model','api_key']);
 writePrivate(configFile,text);
 const record={...readRecord(state),connected:{provider:'openai-codex',model:String(model).trim(),base_url:null,at:now.toISOString()}};
 delete record.check;writeRecord(state,record);
 return routineAIStatus({home,state});
}
