import fs from 'node:fs';
import {spawn} from 'node:child_process';
const MAX_CHILD_TREE=100;

function processRow(pid){
 try{
  const fields=fs.readFileSync('/proc/'+pid+'/stat','utf8').match(/^\d+ \(.*\) (.*)$/s)?.[1].trim().split(/\s+/);
  return fields?{pid:Number(pid),parent:Number(fields[1])}:null;
 }catch{return null;}
}
// A process has gone by the time its close event arrives. Take this bounded
// snapshot when a caller admits a child so a failed external routine can still
// say which process tree it actually started.
export function childTree(pid){
 if(process.platform!=='linux')return Number.isInteger(pid)?[{pid,parent:null}]:[];
 const root=processRow(pid);if(!root)return [];
 let rows;try{rows=fs.readdirSync('/proc').filter(name=>/^\d+$/.test(name)).map(processRow).filter(Boolean);}catch{return [root];}
 const tree=[root];
 for(let index=0;index<tree.length&&tree.length<MAX_CHILD_TREE;index++)for(const row of rows)if(row.parent===tree[index].pid&&!tree.some(entry=>entry.pid===row.pid)){tree.push(row);if(tree.length===MAX_CHILD_TREE)break;}
 return tree;
}

// One way to run a helper program (Hermes, Python, an assistant CLI) and hear
// back from it. Until 6 October 2026 each caller wrote its own: a program that
// stopped before reading a long prompt broke the pipe, and the unhandled pipe
// error ended the whole notebook server; a reply was decoded piece by piece,
// so an umlaut split across two pieces became two broken characters; and on
// Linux a stopped program was only asked to stop, never made to.

// Stops the program and whatever it started. Windows: taskkill on the tree.
// Linux: the program leads its own process group (detached), so the group is
// asked to stop and, after a grace period, killed.
export function stopTree(child,{graceMs=5000,spawnProcess=spawn}={}){
 if(!child?.pid)return;
 if(process.platform==='win32'){try{spawnProcess('taskkill',['/pid',String(child.pid),'/T','/F'],{windowsHide:true,stdio:'ignore'}).on?.('error',()=>{});}catch{}return;}
 const signal=name=>{try{process.kill(-child.pid,name);}catch{try{child.kill(name);}catch{}}};
 signal('SIGTERM');
 const timer=setTimeout(()=>signal('SIGKILL'),graceMs);timer.unref?.();
}
// Resolves {code,signal,stdout,stderr} once the program has ended, whatever its
// exit code; rejects only when it could not start, ran out of time, said too
// much, or was stopped. The error's code says which: SPAWN_FAILED, TIMEOUT,
// OUTPUT_LIMIT, ABORTED. stdout and stderr are decoded once, at the end.
export function runChild(executable,args,{cwd,env,input,timeoutMs=0,maxBytes=4*1024*1024,signal,spawnProcess=spawn,graceMs=5000,onStart}={}){
 return new Promise((resolve,reject)=>{
  if(signal?.aborted)return reject(Object.assign(new Error('Stopped'),{code:'ABORTED'}));
  let child;
  try{child=spawnProcess(executable,args,{cwd,env,windowsHide:true,shell:false,detached:process.platform!=='win32',stdio:[input===undefined?'ignore':'pipe','pipe','pipe']});}
  catch(error){return reject(Object.assign(new Error('The program could not start'),{code:'SPAWN_FAILED',cause:error}));}
  const started={pid:child.pid,tree:onStart?childTree(child.pid):[]};
  try{onStart?.(started);}catch{}
  const out=[],err=[];let bytes=0,errBytes=0,settled=false,timer=null;
  const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);error?reject(error):resolve(value);};
  const output=()=>({stdout:Buffer.concat(out).toString('utf8'),stderr:Buffer.concat(err).toString('utf8').slice(-32768)});
  const fail=(code,message)=>{stopTree(child,{graceMs,spawnProcess});finish(Object.assign(new Error(message),{code,...started,...output()}));};
  const abort=()=>fail('ABORTED','Stopped');
  signal?.addEventListener('abort',abort,{once:true});
  if(timeoutMs>0)timer=setTimeout(()=>fail('TIMEOUT','The program did not finish in time'),timeoutMs);
  child.on('error',error=>finish(Object.assign(new Error('The program could not start'),{code:'SPAWN_FAILED',cause:error})));
  child.stdout?.on('data',chunk=>{bytes+=chunk.length;if(bytes>maxBytes)fail('OUTPUT_LIMIT','The program said more than its limit');else out.push(Buffer.from(chunk));});
  // Only the last 32 KB of diagnostics are kept; they can hold credentials, so
  // callers classify them and never store them.
  child.stderr?.on('data',chunk=>{err.push(Buffer.from(chunk));errBytes+=chunk.length;while(errBytes>32768&&err.length>1)errBytes-=err.shift().length;});
  child.on('close',(code,exitSignal)=>finish(null,{code,signal:exitSignal,...started,...output()}));
  if(child.stdin){
   // A program that ends before reading its input breaks the pipe (EPIPE, or
   // EOF on Windows). That is its failure to report through 'close', never a
   // reason to bring the server down.
   child.stdin.on('error',()=>{});
   try{child.stdin.end(input);}catch{}
  }
 });
}
// execFile's contract for callers that want it: stdout on exit code 0, an
// error naming the exit code otherwise.
export async function runCommand(executable,args,{timeout,maxBuffer,...options}={}){
 const result=await runChild(executable,args,{...options,timeoutMs:timeout||0,maxBytes:maxBuffer||4*1024*1024});
 if(result.code!==0)throw Object.assign(new Error('Command failed with exit code '+result.code),{code:result.code,signal:result.signal,pid:result.pid,tree:result.tree,stdout:result.stdout,stderr:result.stderr});
 return result;
}
