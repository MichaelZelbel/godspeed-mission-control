import {Worker} from 'node:worker_threads';
import fs from 'node:fs';
import path from 'node:path';
import {partialOf} from './archives.mjs';

// A backup runs in a separate thread, so health and reads go on; it holds the
// workspace writer lock only for the moment of its snapshot (Store.backup),
// so saves go on too.
export class BackupRunner{
 constructor(store,mediaRoot){this.store=store;this.mediaRoot=mediaRoot;this.active=null;}
 run(){
  if(this.active)return this.active.promise;
  const destination=path.join(this.store.state,'backups',Date.now().toString());
  const worker=new Worker(new URL('./backup-worker.mjs',import.meta.url),{execArgv:[],workerData:{root:this.store.root,device:this.store.device,mediaRoot:this.mediaRoot,destination}});
  const active={worker,promise:null};this.active=active;
  active.promise=new Promise((resolve,reject)=>{
   let settled=false;
   const finish=(error,result)=>{if(settled)return;settled=true;if(this.active===active)this.active=null;error?reject(error):resolve(result);};
   worker.once('message',message=>message.error?finish(Error(message.error)):finish(null,message.result));
   worker.once('error',error=>finish(error));
   // A thread that stopped part-way leaves its unfinished copy, which goes.
   worker.once('exit',code=>{if(settled)return;try{fs.rmSync(partialOf(destination),{recursive:true,force:true});}catch{}finish(Error('Backup stopped before it was complete (exit '+code+'). Nothing of it was kept.'));});
  });
  return active.promise;
 }
}
