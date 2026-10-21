import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runChild} from './child-process.mjs';
import {assistantEnvironment} from './assistant-files.mjs';

const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const helper=fileURLToPath(new URL('../assistant-files/addon-model.py',import.meta.url));
export function modelInput(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['system','prompt','timeout_ms','max_tokens'].includes(k)))throw Error('A model request accepts system, prompt and optional time and output budgets');
 for(const key of ['system','prompt'])if(typeof input[key]!=='string'||!input[key].trim()||Buffer.byteLength(input[key])>256000)throw Error('Provide bounded system and prompt text');
 const timeout_ms=input.timeout_ms??120000,max_tokens=input.max_tokens??2048;
 if(!Number.isInteger(timeout_ms)||timeout_ms<1000||timeout_ms>240000||!Number.isInteger(max_tokens)||max_tokens<128||max_tokens>8192)throw Error('Choose a supported model request budget');
 return {system:input.system,prompt:input.prompt,timeout_ms,max_tokens};
}
export function modelConnection(root){
 const state=path.join(path.resolve(root),'.godspeed'),descriptorFile=path.join(state,'assistant.json');
 if(fs.existsSync(descriptorFile)){
  const descriptor=read(descriptorFile);
  if(!descriptor.verified||!path.isAbsolute(descriptor.home||'')||!path.isAbsolute(descriptor.executable||''))throw Error('Connect the Godspeed assistant before using an add-on');
  const executable=descriptor.executable,folder=path.dirname(executable),windows=/\.exe$/i.test(executable);
  const candidates=[path.join(folder,windows?'python.exe':'python3'),path.join(folder,windows?'python.exe':'python')];
  const python=candidates.find(p=>fs.existsSync(p));
  if(!python)throw Error('The connected Godspeed assistant Python runtime was not found');
  const sourceRoot=descriptor.sourceRoot||path.resolve(folder,'../..');
  return {kind:'hermes',state,descriptor,python,sourceRoot};
 }
 const file=path.join(state,'provider.json');
 if(!fs.existsSync(file))throw Error('Connect a model in Godspeed before using an add-on');
 const provider=read(file),url=new URL(provider.url);
 if(!provider.key||!provider.model||url.protocol!=='https:'&&!['127.0.0.1','localhost','::1'].includes(url.hostname))throw Error('The Godspeed model connection is incomplete');
 return {kind:'api',state,provider};
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
export async function addonModel({root,input,describe=false,spawnProcess}={}){
 const connection=modelConnection(root),request=describe?{describe:true}:modelInput(input),started=Date.now(),deadline=started+(request.timeout_ms||20000);
 const execute=async()=>{
  if(connection.kind==='hermes'){
   const {descriptor,python,sourceRoot}=connection;
   const env=assistantEnvironment({home:descriptor.home,workspace:path.resolve(root)});
   env.PYTHONPATH=[sourceRoot,env.PYTHONPATH].filter(Boolean).join(path.delimiter);
   const result=await runChild(python,[helper],{cwd:sourceRoot,env,input:JSON.stringify(request),timeoutMs:Math.max(1,deadline-Date.now()),maxBytes:1024*1024,spawnProcess});
   let parsed;try{parsed=JSON.parse(result.stdout.trim());}catch{throw Error('The Godspeed model connection returned an invalid answer');}
   if(result.code||parsed.error)throw Error('The selected Godspeed model could not answer. Check its connection and usage allowance.');
   if(typeof parsed.provider!=='string'||typeof parsed.model!=='string'||(!describe&&(typeof parsed.text!=='string'||!parsed.text.trim())))throw Error('The Godspeed model connection returned an invalid answer');
   return parsed;
  }
  const {provider}=connection,metadata={provider:'configured-api',model:provider.model};
  if(describe)return {configured:true,...metadata};
  const response=await fetch(provider.url,{method:'POST',headers:{authorization:'Bearer '+provider.key,'content-type':'application/json'},body:JSON.stringify({model:provider.model,messages:[{role:'system',content:request.system},{role:'user',content:request.prompt}],max_tokens:request.max_tokens}),signal:AbortSignal.timeout(Math.max(1,deadline-Date.now()))});
  if(!response.ok)throw Error('The selected Godspeed model could not answer (HTTP '+response.status+'). Check its connection and usage allowance.');
  const data=await response.json(),message=data.choices?.[0]?.message;
  if(message?.tool_calls?.length||typeof message?.content!=='string'||!message.content.trim())throw Error('The selected Godspeed model returned no usable text');
  return {text:message.content,...metadata};
 };
 if(describe)return execute();
 try{const result=await locked(connection.state,deadline,execute);receipt(connection.state,{at:new Date().toISOString(),state:'answered',provider:result.provider,model:result.model,duration_ms:Date.now()-started});return result;}
 catch(error){receipt(connection.state,{at:new Date().toISOString(),state:'failed',duration_ms:Date.now()-started});if(['TIMEOUT','OUTPUT_LIMIT','ABORTED'].includes(error.code))throw Error('The Godspeed model request did not finish within its limit');throw error;}
}
