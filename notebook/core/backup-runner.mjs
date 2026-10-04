import {Worker} from 'node:worker_threads';
import path from 'node:path';

// Capture retains the workspace writer lock in a separate thread. Health and
// reads can continue; competing writes wait rather than altering the snapshot.
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
   worker.once('exit',code=>{if(!settled)finish(Error('Backup stopped before verification (exit '+code+'). Its retained partial copy has not been removed.'));});
  });
  return active.promise;
 }
}
