import {spawn} from 'node:child_process';
import {runChild,stopTree} from './child-process.mjs';
import {assistantEnvironment} from './assistant-files.mjs';

// A CHATGPT PLAN, SIGNED IN FROM SETTINGS (22 October 2026), for the main AI and the backup AI alike:
// one sign-in, used by both forms under Your AI. Until now the notebook's Settings took only an API
// key, and a ChatGPT plan was signed in outside it (the Hermes app on Windows, `hermes model` in a
// terminal), while the one-line server's Telegram setup signed it in in the chat. Now every
// installation with Hermes offers the same choices in Settings, and the backup offers exactly the
// main AI's (discussion #20: "set up the same way as the main connection").
//
// It is Hermes' own device sign-in, the command the Telegram setup runs
// (`hermes auth add openai-codex --type oauth --no-browser`): Hermes prints an address and a code,
// the person types the code there, and Hermes keeps the sign-in in its own home. Then the plan's
// models are tried in Hermes' order and the first that answers is the one saved (the helper's "plan"
// route, assistant-files/addon-model.py), so nothing is saved that does not answer. What happens
// after (the main AI, or the backup) is the caller's: onSignedIn(as) returns {model}.
export const PLAN_PROVIDER='openai-codex';
const ANSI=/\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\r/g;
const DASHED=/\b([A-Z0-9]{4,6}-[A-Z0-9]{4,6})\b/;

// The address and code a device sign-in printed, or null while either is missing (the same reading as
// find_device_code in docker/rootfs/usr/local/bin/godspeed-telegram-setup).
export function findDeviceCode(raw){
 const text=String(raw||'').replace(ANSI,'');
 const url=(text.match(/https?:\/\/[^\s'"<>]+/)||[])[0]?.replace(/[.,);]+$/,'')||null;
 let code=null;const lines=text.split('\n').map(l=>l.trim());
 for(let i=0;i<lines.length&&!code;i++){
  const m=/code[^:()]*:\s*([A-Za-z0-9]+(?:-[A-Za-z0-9]+)*)\s*$/i.exec(lines[i]);
  if(m&&!/^http/i.test(m[1])){code=m[1];break;}
  if(/code:?$/i.test(lines[i])){const next=lines.slice(i+1).find(Boolean)||'';if(next&&!/^http/i.test(next))code=next.split(/\s+/)[0];}
 }
 if(!code)code=(DASHED.exec(text)||[])[1]||null;
 return url&&code?{url,code}:null;
}

export class PlanSignIn{
 constructor({executable,home,cwd,onSignedIn,spawnProcess=spawn,run=runChild,minutes=16,codeWaitMs=90000,stopChild=child=>stopTree(child,{spawnProcess})}){
  Object.assign(this,{executable,home,cwd,onSignedIn,spawnProcess,run,minutes,codeWaitMs,stopChild});
  this.status={state:'idle'};this.child=null;this.timers=[];
 }
 env(){return {...assistantEnvironment({home:this.home,workspace:this.cwd}),PYTHONUNBUFFERED:'1'};}
 // What Settings shows: never the program's own output, only the address, the code and plain words.
 view(){const {state,as,url,code,error,model}=this.status;return {state,...(as?{as}:{}),...(url?{url,code}:{}),...(error?{error}:{}),...(model?{model}:{})};}
 busy(){return ['starting','waiting','connecting'].includes(this.status.state);}
 // Whether Hermes holds a ChatGPT plan sign-in already, as the Telegram setup asks (chatgpt_done).
 async signedIn(){
  try{const r=await this.run(this.executable,['auth','list'],{cwd:this.cwd,env:this.env(),timeoutMs:60000,maxBytes:256*1024,spawnProcess:this.spawnProcess});
   return r.code===0&&/^openai-codex \([0-9]+ credential/m.test(r.stdout.replace(ANSI,''));}catch{return false;}
 }
 async start(as){
  if(!['main','backup'].includes(as))throw Error('Choose whether the plan is your main AI or your backup');
  if(this.busy()){if(this.status.as!==as)throw Error('A ChatGPT sign-in for your '+(this.status.as==='backup'?'backup AI':'main AI')+' is under way. Finish or cancel it first.');return this.view();}
  this.clear();this.status={state:'starting',as};
  if(await this.signedIn()){this.connect(as);return this.view();}
  let output='';
  const child=this.child=this.spawnProcess(this.executable,['auth','add',PLAN_PROVIDER,'--type','oauth','--no-browser'],{cwd:this.cwd,env:this.env(),windowsHide:true,shell:false,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
  const heard=chunk=>{output=(output+chunk).slice(-16384);if(this.status.state==='starting'&&this.child===child){const found=findDeviceCode(output);if(found)this.status={state:'waiting',as,...found};}};
  child.stdout?.on('data',heard);child.stderr?.on('data',heard);
  child.on('error',()=>{if(this.child===child)this.fail(as,'The sign-in could not start. Check that your assistant is installed, then try again.');});
  child.on('close',async()=>{
   if(this.child!==child)return;this.child=null;this.clear();
   if(this.status.state==='failed')return;
   if(await this.signedIn())return this.connect(as);
   this.fail(as,this.status.state==='waiting'?'The code ran out, or the sign-in did not go through. Nothing is broken: start again for a new code.':'ChatGPT gave no sign-in code this time. Nothing is broken: try again in a minute.');
  });
  // A code lasts fifteen minutes; one that never came is given up sooner.
  this.timers.push(setTimeout(()=>{if(this.child===child&&this.status.state==='starting'){this.fail(as,'ChatGPT gave no sign-in code this time. Nothing is broken: try again in a minute.');this.stop(child);}},this.codeWaitMs));
  this.timers.push(setTimeout(()=>{if(this.child===child){this.fail(as,'The code ran out. Nothing is broken: start again for a new code.');this.stop(child);}},this.minutes*60000));
  for(const timer of this.timers)timer.unref?.();
  return this.view();
 }
 async connect(as){
  this.status={state:'connecting',as};
  try{const result=await this.onSignedIn(as);this.status={state:'connected',as,model:result?.model};}
  catch(error){this.fail(as,String(error?.message||error).slice(0,300));}
 }
 fail(as,error){this.status={state:'failed',as,error};}
 cancel(){const child=this.child;this.child=null;this.clear();if(child)this.stop(child);this.status={state:'idle'};return this.view();}
 stop(child){if(this.child===child)this.child=null;this.stopChild(child);}
 clear(){for(const timer of this.timers)clearTimeout(timer);this.timers=[];}
}
