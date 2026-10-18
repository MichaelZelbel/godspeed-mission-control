import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';
// Git and its credential/network waits run outside the notebook event loop.
// One runner shares a single in-flight operation with timer and manual callers.
export class SyncRunner {
 constructor(root,{worker=fileURLToPath(new URL('../../scripts/sync-worker.mjs',import.meta.url)),onResult=()=>{}}={}){this.root=root;this.worker=worker;this.onResult=onResult;this.pending=null;this.child=null;this.starts=0;this.closed=false;}
 async configure(url){if(this.pending)await this.pending;const result=await this.run('configure',url);if(result.configuration_error)throw Error(result.configuration_error);return result;}
 run(action='reconcile',url=''){
  if(this.closed)return Promise.resolve({state:'pending',error:'Synchronization is stopping; local files remain available'});
  if(this.pending){if(action==='configure'&&this.actionKey!==JSON.stringify([action,url]))return Promise.reject(Error('Another sync configuration is being verified'));return this.pending;}
  this.actionKey=JSON.stringify([action,url]);
  this.starts++;
  this.pending=new Promise(resolve=>{
   const child=this.child=spawn(process.execPath,[this.worker,this.root,action,url],{windowsHide:true,detached:process.platform!=='win32',shell:false,stdio:['ignore','pipe','ignore']});let output='',settled=false;
   const finish=result=>{if(settled)return;settled=true;this.child=null;this.pending=null;try{this.onResult(result);}catch{}resolve(result);};
   child.stdout.on('data',chunk=>{if(output.length<65536)output+=chunk;});
   child.on('error',()=>finish({state:'pending',error:'Synchronization could not start; local files remain available'}));
   child.on('close',code=>{try{if(code)throw Error();finish(JSON.parse(output.trim().split(/\r?\n/).at(-1)));}catch{finish({state:'pending',error:'Synchronization did not complete; local files remain available'});}});
  });return this.pending;
 }
 // A worker stopped in the middle of a Git command leaves Git's lock files
 // behind, and they kept every later round waiting (6 October 2026). It is
 // given `grace` to finish its round, which is seconds when nothing is slow,
 // and only then stopped by force.
 async close({grace=15000}={}){
  this.closed=true;if(!this.child)return;const child=this.child,pending=this.pending;
  let timer;const finished=await Promise.race([pending.then(()=>true),new Promise(resolve=>{timer=setTimeout(()=>resolve(false),grace);})]);clearTimeout(timer);
  if(finished||!this.child)return;
  if(process.platform==='win32')spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'});else{try{process.kill(-child.pid,'SIGTERM');}catch{}const kill=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},1500);await pending;clearTimeout(kill);try{process.kill(-child.pid,'SIGKILL');}catch{}return;}await pending;
 }
}
