import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {atomic} from '../core/records/store.mjs';
const refuse=(message,status=400)=>Object.assign(new Error(message),{status});
export class MenerioImport {
  constructor(store,mediaRoot,onComplete=()=>{}){
    this.store=store;this.mediaRoot=mediaRoot;this.onComplete=onComplete;
    this.root=path.join(store.state,'menerio-import');fs.mkdirSync(this.root,{recursive:true,mode:0o700});
    this.file=path.join(this.root,'job.json');this.worker=null;
    if(fs.existsSync(this.file)){const job=this.read();if(['preparing','importing'].includes(job.state))this.save({...job,state:'failed',error:'The server restarted during the copy. Preview again to continue safely.'});}
  }
  config(){const file=path.join(this.root,'config.json');return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):{};}
  read(){return fs.existsSync(this.file)?JSON.parse(fs.readFileSync(this.file,'utf8')):null;}
  save(job){atomic(this.file,JSON.stringify(job));fs.chmodSync(this.file,0o600);}
  get mutating(){return this.read()?.state==='importing';}
  status(){const config=this.config();return {prepared:!!config.bundle&&fs.existsSync(config.bundle),connected:!!config.credentials,job:this.read()};}
  async start(input){
    if(this.worker)throw refuse('A copy is already running. Wait for it to finish.',409);
    let job,mode,prepared,credentials;
    if(input.action==='preview'){
      const config=this.config();mode='preview';
      if(input.source==='prepared'){prepared=config.bundle;if(!prepared||!fs.existsSync(prepared))throw refuse('No saved Menerio copy is available on this server. Connect to Menerio below.');}
      else if(input.source==='connected'){credentials=config.credentials;if(!credentials)throw refuse('Connect to your Menerio account first.');}
      else if(input.source==='account'){
        const project=String(input.project||'').trim().replace(/^https:\/\//,'').replace(/\.supabase\.co\/?$/,'');
        if(!/^[a-z0-9]{20}$/.test(project)||typeof input.token!=='string'||input.token.length<20||input.token.length>4096||typeof input.apiKey!=='string'||input.apiKey.length<20||input.apiKey.length>4096)throw refuse('Enter your Menerio project address and both access keys.');
        credentials={project,token:input.token,apiKey:input.apiKey};
      }else throw refuse('Choose a saved copy or connect to Menerio.');
      job={id:randomUUID(),state:'preparing',progress:'Preparing your preview.',startedAt:new Date().toISOString()};
      fs.mkdirSync(path.join(this.root,job.id),{mode:0o700});
    }else if(input.action==='apply'){
      job=this.read();if(!job||job.id!==input.id||job.state!=='ready')throw refuse('Prepare a new preview before importing.',409);
      if(Date.now()-Date.parse(job.startedAt)>86400000)throw refuse('This preview expired. Prepare a new preview.',409);
      job={...job,state:'importing',progress:'Saving a backup before importing.'};mode='apply';
    }else throw refuse('Choose preview or import.');
    this.save(job);
    this.worker=new Worker(new URL('./menerio-import-worker.mjs',import.meta.url),{workerData:{mode,root:this.store.root,device:this.store.device,mediaRoot:this.mediaRoot,jobRoot:path.join(this.root,job.id),prepared,credentials}});
    this.worker.on('message',message=>{
      const current=this.read();if(current.id!==job.id)return;
      if(message.progress)this.save({...current,progress:message.progress});
      if(message.ready)this.save({...current,state:'ready',progress:'Your preview is ready.',summary:message.summary,copyDate:message.copyDate});
      if(message.complete){try{this.onComplete();}catch{}this.save({...current,state:'complete',progress:'Your Menerio content has been copied.',summary:message.summary});}
      if(message.failed)this.save({...current,state:'failed',error:message.error});
    });
    this.worker.on('error',()=>this.save({...this.read(),state:'failed',error:'The copy stopped unexpectedly. Preview again to continue safely.'}));
    this.worker.on('exit',()=>{this.worker=null;const current=this.read();if(['preparing','importing'].includes(current.state))this.save({...current,state:'failed',error:'The copy stopped unexpectedly. Preview again to continue safely.'});});
    return job;
  }
  async close(){if(this.worker)await this.worker.terminate();}
}
