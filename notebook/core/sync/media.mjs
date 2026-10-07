import fs from 'node:fs';
import path from 'node:path';
import { atomic,hash,safe } from '../records/store.mjs';
export class MediaSync {
  constructor(store,mediaRoot){this.store=store;this.root=mediaRoot;this.configPath=path.join(store.state,'pair.json');this.last=null;this.hashes=new Map();}
  // The sha256 of a downloaded media file, cached by its size and mtime so an
  // unchanged file is not re-read and re-hashed on every idle reconcile round.
  // Re-hashing 200 MB of already-downloaded media stalled the server event loop
  // for over a second every minute (SY12, 2026-10-07). A changed size or mtime
  // recomputes it, so a real local change is still caught.
  fileHash(file){
    const stat=fs.statSync(file),cached=this.hashes.get(file);
    if(cached&&cached.size===stat.size&&cached.mtimeMs===stat.mtimeMs)return cached.sha;
    const sha=hash(fs.readFileSync(file));this.hashes.set(file,{size:stat.size,mtimeMs:stat.mtimeMs,sha});return sha;
  }
  config(){return fs.existsSync(this.configPath)?JSON.parse(fs.readFileSync(this.configPath,'utf8')):null;}
  manifest(){return fs.readdirSync(this.root).filter(n=>n.endsWith('.mapping.json')).map(n=>JSON.parse(fs.readFileSync(path.join(this.root,n),'utf8')));}
  async pair(origin,code){
    const url=new URL(origin);if(url.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(url.hostname))throw new Error('Pairing requires HTTPS');
    const response=await fetch(new URL('/api/pair/claim',url),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code}),signal:AbortSignal.timeout(15000)});
    const result=await response.json();if(!response.ok)throw new Error(result.error||'Pairing failed');
    atomic(this.configPath,JSON.stringify({origin:url.origin,key:result.key,offline:'all'}));fs.chmodSync(this.configPath,0o600);return {paired:true};
  }
  async request(route,options={}){
    const config=this.config();if(!config)throw new Error('Pair this device with a candidate VPS first');
    const response=await fetch(new URL(route,config.origin),{...options,headers:{...options.headers,'X-Godspeed-Pair-Key':config.key},signal:AbortSignal.timeout(120000)});
    if(!response.ok)throw new Error('Media transfer failed with HTTP '+response.status);return response;
  }
  async reconcile(){
    try{
      const config=this.config();if(!config)return {state:'unpaired'};
      const remote=await(await this.request('/api/media/manifest')).json(),local=this.manifest();let downloaded=0,uploaded=0;
      for(const mapping of remote.data){
        if(mapping.removed_at){
          const prior=local.find(m=>m.path===mapping.path);
          if(!prior||prior.sha256===mapping.sha256){atomic(path.join(this.root,hash(mapping.path)+'.mapping.json'),JSON.stringify(mapping));continue;}
          // The review is made once, and a decision on it stays: saved again
          // every round, a dismissed review came back as pending every minute
          // with a new history file each time (6 October 2026). Once decided,
          // this machine's mapping records it and the round leaves it alone.
          const id='media-delete-conflict-'+hash([mapping.path,prior.sha256,mapping.sha256]).slice(0,24);
          if(prior.removal_review===id)continue;
          const review=this.store.get('review_queue',id);
          if(!review)this.store.save('review_queue',{id,suggestion_type:'media_conflict',title:'Review removed media with an offline edited version',payload:{local:prior,remote:mapping},status:'pending_review'});
          else if(review.status!=='pending_review')atomic(path.join(this.root,hash(prior.path)+'.mapping.json'),JSON.stringify({...prior,removal_review:id}));
          continue;
        }
        if(config.offline==='selected'&&!config.selected?.includes(mapping.path))continue;
        if(fs.existsSync(path.join(this.root,safe(mapping.file)))){if(this.fileHash(path.join(this.root,mapping.file))!==mapping.sha256)throw new Error('Local media integrity mismatch');}
        else {const bytes=Buffer.from(await(await this.request('/api/media/blob/'+encodeURIComponent(mapping.file))).arrayBuffer());if(hash(bytes)!==mapping.sha256)throw new Error('Downloaded media integrity mismatch');atomic(path.join(this.root,safe(mapping.file)),bytes);downloaded++;}
        const prior=local.find(m=>m.path===mapping.path);
        if(prior?.removed_at&&prior.sha256===mapping.sha256){await this.request('/api/media/tombstone',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(prior)});continue;}
        if(prior&&prior.sha256!==mapping.sha256){const id='media-conflict-'+hash([mapping.path,prior.sha256,mapping.sha256]).slice(0,24);if(!this.store.get('review_queue',id))this.store.save('review_queue',{id,suggestion_type:'media_conflict',title:'Keep both media versions for '+mapping.path,payload:{local:prior,remote:mapping},status:'pending_review'});continue;}
        atomic(path.join(this.root,hash(mapping.path)+'.mapping.json'),JSON.stringify(mapping));
      }
      for(const mapping of local.filter(m=>!m.removed_at&&!remote.data.some(r=>r.path===m.path))){
        const bytes=fs.readFileSync(path.join(this.root,safe(mapping.file)));if(hash(bytes)!==mapping.sha256)throw new Error('Upload integrity mismatch');
        await this.request('/api/media/transfer',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mapping,data:bytes.toString('base64')})});uploaded++;
      }
      this.last={state:'synced',at:new Date().toISOString(),downloaded,uploaded};
    }catch(e){this.last={state:'pending',at:new Date().toISOString(),error:e.message};}
    atomic(path.join(this.store.state,'media-sync-status.json'),JSON.stringify(this.last));return this.last;
  }
}
