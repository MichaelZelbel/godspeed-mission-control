import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runChild} from './child-process.mjs';
import {assistantEnvironment} from './assistant-files.mjs';
import {readBackupEndpoint,noteMainAnswered,noteMainFailed,noteBackupAnswered} from './backup-ai.mjs';
import {hermesPython} from './runtime.mjs';

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
// The Python Hermes runs on, beside its executable or in the packaged server runtime's own venv.
export function hermesHelper(descriptor,state){
 if(!descriptor?.verified||!path.isAbsolute(descriptor.home||'')||!path.isAbsolute(descriptor.executable||''))throw Error('Connect the Godspeed assistant before using an add-on');
 const executable=descriptor.executable,folder=path.dirname(executable),windows=/\.exe$/i.test(executable);
 const packaged=path.resolve(folder,'..'),packagedPython=path.join(packaged,'.venv','bin','python3');
 const candidates=[path.join(folder,windows?'python.exe':'python3'),path.join(folder,windows?'python.exe':'python'),packagedPython];
 const legacy=candidates.find(p=>fs.existsSync(p));
 // Native Hermes also ships a shell launcher that selects a package-manager Python. The
 // notebook's model picker already follows that launcher; add-ons use the same resolver.
 const installed=legacy?null:hermesPython({...descriptor,platform:windows?'win32':'linux'});
 const python=legacy||installed?.python;
 if(!python)throw Error('The connected Godspeed assistant Python runtime was not found');
 const sourceRoot=descriptor.sourceRoot||installed?.source||(python===packagedPython?packaged:path.resolve(folder,'../..'));
 return {kind:'hermes',state,descriptor,python,sourceRoot};
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
export async function runHermesHelper({connection,root,request,deadline,spawnProcess}){
 const {descriptor,python,sourceRoot}=connection;
 const env=assistantEnvironment({home:descriptor.home,workspace:path.resolve(root)});
 env.PYTHONPATH=[sourceRoot,env.PYTHONPATH].filter(Boolean).join(path.delimiter);
 const result=await runChild(python,[helper],{cwd:sourceRoot,env,input:JSON.stringify(request),timeoutMs:Math.max(1,deadline-Date.now()),maxBytes:1024*1024,spawnProcess});
 let parsed;try{parsed=JSON.parse(result.stdout.trim());}catch{throw Error('The Godspeed model connection returned an invalid answer');}
 if(result.code||parsed.error)throw Error(parsed.reason==='limit'?'The AI account reached a usage limit. It answers again once the limit resets.':parsed.reason==='sign-in'?'The AI account needs to be signed in again, or its key was refused.':'The selected Godspeed model could not answer. Check its connection and usage allowance.');
 if(typeof parsed.provider!=='string'||typeof parsed.model!=='string'||(!request.describe&&(typeof parsed.text!=='string'||!parsed.text.trim())))throw Error('The Godspeed model connection returned an invalid answer');
 return parsed;
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
