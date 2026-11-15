import {Worker} from 'node:worker_threads';
// The immutable backup and empty restoration are separate from live records.
// Their synchronous byte checks must not stop chat, health or scheduling.
export class RecoveryRunner{
 constructor(store){this.store=store;this.active=null;}
 run(source){
  if(this.active){if(this.active.source===source)return this.active.promise;return Promise.reject(Error('A separate recovery copy is already being checked. Your request has not been repeated.'));}
  const worker=new Worker(new URL('./recovery-worker.mjs',import.meta.url),{execArgv:[],workerData:{source,state:this.store.state,device:this.store.device}});
  const active={source,worker,promise:null};this.active=active;
  active.promise=new Promise((resolve,reject)=>{
   let settled=false;
   const finish=(error,result)=>{if(settled)return;settled=true;if(this.active===active)this.active=null;error?reject(error):resolve(result);};
   worker.once('message',message=>message.error?finish(Error(message.error)):finish(null,message.result));
   worker.once('error',error=>finish(error));
   worker.once('exit',code=>{if(!settled)finish(Error('Recovery worker stopped before returning a verified copy (exit '+code+'). Retained copies have not been removed.'));});
  });
  return active.promise;
 }
}
