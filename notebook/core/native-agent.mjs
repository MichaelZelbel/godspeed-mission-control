import {spawn} from 'node:child_process';
import {hash} from './records/store.mjs';
import {assistantEnvironment} from './assistant-files.mjs';
import {hermesResponse,hermesFailureMessage} from './runtime.mjs';

// A transport adapter only: Hermes owns its conversation, tools and agent loop.
export function nativeAgent({executable,home,cwd,spawnProcess=spawn}){
 return input=>new Promise((resolve,reject)=>{
  const args=['chat','--query-file','-','--quiet','--oneshot','--in',cwd,'--continue','godspeed-notebook-'+hash(input.conversation_id||input.note_id||'general').slice(0,24),'--create-if-missing','--no-restore-cwd'];
  if(input.model)args.push('--model',input.model);
  if(input.effort)args.push('--reasoning',input.effort);
  const child=spawnProcess(executable,args,{cwd,windowsHide:true,detached:process.platform!=='win32',shell:false,env:assistantEnvironment({home,workspace:cwd}),stdio:['pipe','pipe','pipe']});
  let output='',diagnostic='',settled=false;
  const stop=()=>{if(process.platform==='win32')spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else try{process.kill(-child.pid,'SIGTERM');}catch{child.kill('SIGTERM');}};
  const finish=(error,result)=>{if(settled)return;settled=true;input.signal?.removeEventListener('abort',abort);error?reject(error):resolve(result);};
  const abort=()=>{stop();finish(new Error('Reply stopped'));};
  input.signal?.addEventListener('abort',abort,{once:true});
  if(input.signal?.aborted){abort();return;}
  child.on('error',()=>finish(new Error('The Godspeed assistant could not start')));
  child.stdout.on('data',data=>{output+=data;if(output.length>4*1024*1024){stop();finish(new Error('Assistant output exceeded its limit'));}});
  child.stderr.on('data',data=>diagnostic=(diagnostic+data).slice(-32768));
  child.on('close',code=>{const reply=hermesResponse(output);finish(code||!reply?new Error(hermesFailureMessage(diagnostic+'\n'+reply)):null,{reply});});
  child.stdin.end(String(input.message||''));
 });
}
