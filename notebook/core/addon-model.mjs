import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runChild} from './child-process.mjs';
import {assistantEnvironment} from './assistant-files.mjs';
import {readBackupEndpoint,noteMainAnswered,noteMainFailed,noteBackupAnswered} from './backup-ai.mjs';
import {hermesPythons} from './runtime.mjs';

const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^﻿/,''));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const helper=fileURLToPath(new URL('../assistant-files/addon-model.py',import.meta.url));
export function modelInput(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['system','prompt','timeout_ms','max_tokens'].includes(k)))throw Error('A model request accepts system, prompt and optional time and output budgets');
 for(const key of ['system','prompt'])if(typeof input[key]!=='string'||!input[key].trim()||Buffer.byteLength(input[key])>256000)throw Error('Provide bounded system and prompt text');
 const timeout_ms=input.timeout_ms??120000,max_tokens=input.max_tokens??2048;
 if(!Number.isInteger(timeout_ms)||timeout_ms<1000||timeout_ms>240000||!Number.isInteger(max_tokens)||max_tokens<128||max_tokens>8192)throw Error('Choose a supported model request budget');
 return {system:input.system,prompt:input.prompt,timeout_ms,max_tokens};
}
// WHEN HERMES ITSELF DID NOT LOAD, no AI was asked, so it is neither a usage limit nor a sign-in
// (26 October 2026). An add-on paused with "Check its connection and usage allowance" when the
// Python it ran on lacked a module Hermes needs, and the search went to the subscription. `why` is
// one of a few fixed phrases, naming at most a module, never the program's own text.
export function hermesNotLoaded(why){
 return Object.assign(Error('Godspeed could not load its AI program (Hermes) on this computer: '+why+'. No AI was asked, so this is not a usage limit or a sign-in problem.'),{reason:'runtime',why});
}
const missingModule=name=>typeof name==='string'&&/^[A-Za-z_][A-Za-z0-9_.]{0,99}$/.test(name)?'the Python module '+name+' is missing':'';
// THE PYTHON HERMES RUNS ON: beside its executable, in the packaged server runtime's own venv, or
// where the native launcher points (core/runtime.mjs, hermesPythons), every one of them a
// candidate in that order. runHermesHelper takes the first that loads Hermes for this account. One
// that did when the first did not is remembered in assistant-python.json, for this executable as
// it is now (its modification time), so the next request starts with it, at no extra cost.
// remember:false leaves that out, for the installer's check of an executable (assistantCheck).
const memoryFile=state=>path.join(state,'assistant-python.json');
export function hermesHelper(descriptor,state,{remember=true}={}){
 if(!descriptor?.verified||!path.isAbsolute(descriptor.home||'')||!path.isAbsolute(descriptor.executable||''))throw Error('Connect the Godspeed assistant before using an add-on');
 const executable=descriptor.executable,folder=path.dirname(executable),windows=/\.exe$/i.test(executable);
 const packaged=path.resolve(folder,'..'),packagedPython=path.join(packaged,'.venv','bin','python3');
 const beside=[path.join(folder,windows?'python.exe':'python3'),path.join(folder,windows?'python.exe':'python'),packagedPython].filter(p=>fs.existsSync(p));
 // Native Hermes also ships a shell launcher that selects a package-manager Python. The
 // notebook's model picker already follows that launcher; add-ons use the same resolver.
 const installed=hermesPythons({...descriptor,platform:windows?'win32':'linux'});
 const candidates=[];
 for(const python of beside)candidates.push({python,sourceRoot:descriptor.sourceRoot||(python===packagedPython?packaged:path.resolve(folder,'../..'))});
 for(const python of installed.pythons)if(!candidates.some(c=>c.python===python))candidates.push({python,sourceRoot:descriptor.sourceRoot||installed.source});
 if(!candidates.length)throw hermesNotLoaded('no Python for it was found');
 const first=candidates[0].python;let remembered=null;
 if(remember&&state)try{
  const memory=read(memoryFile(state)),known=candidates.find(c=>c.python===memory.python);
  if(known&&memory.executable===executable&&memory.mtime===fs.statSync(executable).mtimeMs){remembered=known.python;candidates.splice(candidates.indexOf(known),1);candidates.unshift(known);}
 }catch{}
 return {kind:'hermes',state,descriptor,python:candidates[0].python,sourceRoot:candidates[0].sourceRoot,candidates,first,remembered,remember};
}
// The memory follows what happened: the one that loaded when it was not the first, nothing when the
// first loaded or none did. Never a reason for a request to fail.
function rememberPython(connection,python){
 const {state,descriptor,first,remembered,remember}=connection;
 if(!remember||!state||python===remembered)return;
 const file=memoryFile(state);
 try{
  if(!python||python===first){fs.rmSync(file,{force:true});return;}
  const temporary=file+'.'+process.pid+'.tmp';
  fs.writeFileSync(temporary,JSON.stringify({executable:descriptor.executable,mtime:fs.statSync(descriptor.executable).mtimeMs,python}),{mode:0o600});fs.renameSync(temporary,file);
 }catch{}
}
export function modelConnection(root){
 const state=path.join(path.resolve(root),'.godspeed'),descriptorFile=path.join(state,'assistant.json');
 if(fs.existsSync(descriptorFile))return hermesHelper(read(descriptorFile),state);
 const file=path.join(state,'provider.json');
 if(!fs.existsSync(file))throw Error('Connect a model in Godspeed before using an add-on');
 const provider=read(file);
 if(!validEndpoint(provider))throw Error('The Godspeed model connection is incomplete');
 // The backup the person connected in Settings, the second saved address (core/backup-ai.mjs).
 const backup=readBackupEndpoint(state);
 return {kind:'api',state,provider,backup:backup&&validEndpoint(backup)?backup:null};
}
function validEndpoint(provider){
 let url;try{url=new URL(provider.url);}catch{return false;}
 return !!provider.key&&!!provider.model&&(url.protocol==='https:'||['127.0.0.1','localhost','::1'].includes(url.hostname));
}
// One request through the Hermes helper (assistant-files/addon-model.py). request.route, which an
// add-on cannot send (modelInput), names the main connection or the backup for the Settings check.
// A Python that could not start, or that answered "runtime" (Hermes did not load, so nothing was
// asked yet), hands the request to the next one of the same Hermes; any other answer is final, so
// no request is ever sent twice. onLoaded hears which Python loaded Hermes.
export async function runHermesHelper({connection,root,request,deadline,spawnProcess,onLoaded=()=>{}}){
 const {descriptor}=connection,candidates=connection.candidates||[{python:connection.python,sourceRoot:connection.sourceRoot}];
 const invalid=()=>Error('The Godspeed model connection returned an invalid answer');
 let why='';
 for(const {python,sourceRoot} of candidates){
  const env=assistantEnvironment({home:descriptor.home,workspace:path.resolve(root)});
  env.PYTHONPATH=[sourceRoot,env.PYTHONPATH].filter(Boolean).join(path.delimiter);
  let result;
  try{result=await runChild(python,[helper],{cwd:sourceRoot,env,input:JSON.stringify(request),timeoutMs:Math.max(1,deadline-Date.now()),maxBytes:1024*1024,spawnProcess});}
  catch(error){if(error.code==='SPAWN_FAILED'){why=why||'its Python could not start';continue;}throw error;}
  let parsed;try{parsed=JSON.parse(result.stdout.trim());}catch{throw invalid();}
  if(!parsed||typeof parsed!=='object')throw invalid();
  if(parsed.reason==='runtime'){why=why||missingModule(parsed.missing);continue;}
  rememberPython(connection,python);onLoaded(python);
  if(result.code||parsed.error)throw Object.assign(Error(parsed.reason==='limit'?'The AI account reached a usage limit. It answers again once the limit resets.':parsed.reason==='sign-in'?'The AI account needs to be signed in again, or its key was refused.':'The selected Godspeed model could not answer. Check its connection and usage allowance.'),{reason:parsed.reason||'model',loaded:true});
  if(typeof parsed.provider!=='string'||typeof parsed.model!=='string'||(!request.describe&&(typeof parsed.text!=='string'||!parsed.text.trim())))throw invalid();
  return parsed;
 }
 rememberPython(connection,null);
 throw hermesNotLoaded(why||'it stopped while starting');
}
// WHETHER THIS HERMES LOADS FOR THIS ACCOUNT, without asking any AI: the add-on connection's own
// check (godspeed-model --check), for an executable the installer found (scripts/choose-assistant.mjs).
// {loads, direct, configured, why}: direct when the executable's own first Python loaded it,
// configured when a provider and model are chosen in its home.
export async function assistantCheck({root,executable,home,spawnProcess,timeoutMs=60000}){
 let connection,loaded=null;
 try{
  connection=hermesHelper({verified:true,executable,home},path.join(path.resolve(root),'.godspeed'),{remember:false});
  await runHermesHelper({connection,root,request:{describe:true},deadline:Date.now()+timeoutMs,spawnProcess,onLoaded:python=>loaded=python});
  return {loads:true,direct:loaded===connection.first,configured:true};
 }catch(error){
  if(error.loaded)return {loads:true,direct:loaded===connection.first,configured:false};
  return {loads:false,why:error.why||(error.code==='TIMEOUT'?'it did not load within '+Math.round(timeoutMs/1000)+' seconds':'its check did not finish')};
 }
}
async function locked(state,deadline,fn){
 fs.mkdirSync(state,{recursive:true});const file=path.join(state,'model-request.lock');let owned=false;
 while(!owned){
  if(Date.now()>=deadline)throw Error('Godspeed is busy with another model request; retry later');
  try{const fd=fs.openSync(file,'wx',0o600);fs.writeFileSync(fd,JSON.stringify({pid:process.pid}));fs.closeSync(fd);owned=true;}
  catch(error){
   if(error.code!=='EEXIST')throw error;
   try{const {pid}=read(file);if(Number.isInteger(pid)&&pid>0){try{process.kill(pid,0);}catch(error){if(error.code==='ESRCH')fs.unlinkSync(file);}}}catch{}
   if(!owned)await pause(100);
  }
 }
 try{return await fn();}finally{if(owned)try{fs.unlinkSync(file);}catch{}}
}
function receipt(state,entry){
 const file=path.join(state,'model-requests.jsonl');
 try{if(fs.existsSync(file)&&fs.statSync(file).size>1000000)fs.renameSync(file,file+'.1');fs.appendFileSync(file,JSON.stringify(entry)+'\n',{mode:0o600});}catch{}
}
async function askEndpoint(endpoint,request,deadline){
 const response=await fetch(endpoint.url,{method:'POST',headers:{authorization:'Bearer '+endpoint.key,'content-type':'application/json'},body:JSON.stringify({model:endpoint.model,messages:[{role:'system',content:request.system},{role:'user',content:request.prompt}],max_tokens:request.max_tokens}),signal:AbortSignal.timeout(Math.max(1,deadline-Date.now()))});
 if(!response.ok)throw Error('The selected Godspeed model could not answer (HTTP '+response.status+'). Check its connection and usage allowance.');
 const data=await response.json(),message=data.choices?.[0]?.message;
 if(message?.tool_calls?.length||typeof message?.content!=='string'||!message.content.trim())throw Error('The selected Godspeed model returned no usable text');
 return message.content;
}
const timedOut=error=>['TIMEOUT','OUTPUT_LIMIT','ABORTED'].includes(error?.code)||error?.name==='TimeoutError'||error?.name==='AbortError';
export async function addonModel({root,input,describe=false,spawnProcess}={}){
 const connection=modelConnection(root),request=describe?{describe:true}:modelInput(input),started=Date.now(),deadline=started+(request.timeout_ms||20000);
 const execute=async()=>{
  if(connection.kind==='hermes'){
   // The helper tries the main connection, then the backup the person connected (addon-model.py).
   const parsed=await runHermesHelper({connection,root,request,deadline,spawnProcess});
   if(!describe){if(parsed.backup){noteMainFailed(connection.state,Error('The main connection did not answer an add-on request'));noteBackupAnswered(connection.state,{provider:parsed.provider,model:parsed.model});}else noteMainAnswered(connection.state);}
   return parsed;
  }
  const {provider,backup}=connection,metadata={provider:'configured-api',model:provider.model};
  if(describe)return {configured:true,...metadata,...(backup?{backup:{provider:'configured-api',model:backup.model}}:{})};
  try{const text=await askEndpoint(provider,request,deadline);noteMainAnswered(connection.state);return {text,...metadata};}
  catch(error){
   // Only a backup the person connected, only for this request, and not after the time ran out.
   if(!backup||timedOut(error)||Date.now()>=deadline)throw error;
   noteMainFailed(connection.state,error);
   const text=await askEndpoint(backup,request,deadline);
   noteBackupAnswered(connection.state,{provider:'configured-api',model:backup.model});
   return {text,provider:'configured-api',model:backup.model,backup:true};
  }
 };
 if(describe)return execute();
 try{const result=await locked(connection.state,deadline,execute);receipt(connection.state,{at:new Date().toISOString(),state:'answered',provider:result.provider,model:result.model,...(result.backup?{backup:true}:{}),duration_ms:Date.now()-started});return result;}
 catch(error){receipt(connection.state,{at:new Date().toISOString(),state:'failed',duration_ms:Date.now()-started});if(timedOut(error))throw Error('The Godspeed model request did not finish within its limit');throw error;}
}
