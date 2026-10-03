import fs from 'node:fs';
import path from 'node:path';
import {atomic,hash,safe} from './records/store.mjs';
export class Connectors {
  constructor(domains){this.domains=domains;this.store=domains.store;this.query=domains.query;}
  config(name){const file=path.join(this.store.state,'connectors',safe(name)+'.json');return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;}
  save(name,value){const file=path.join(this.store.state,'connectors',safe(name)+'.json');atomic(file,JSON.stringify(value));fs.chmodSync(file,0o600);return {configured:true};}
  async health(name,config,url){
    const check=()=>fetch(url,{headers:config.token?{Authorization:'Bearer '+config.token}:{},signal:AbortSignal.timeout(15000)});let response=await check();
    if(response.status===401&&name==='gdrive'&&config.refresh_token&&config.client_id){
      const refreshed=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'refresh_token',refresh_token:config.refresh_token,client_id:config.client_id,...config.client_secret?{client_secret:config.client_secret}:{}}),signal:AbortSignal.timeout(15000)});
      if(refreshed.ok){const data=await refreshed.json();if(typeof data.access_token==='string'&&data.access_token){config={...config,token:data.access_token};this.save(name,config);response=await check();}}
    }return response;
  }
  async request(config,route){const url=new URL(route,config.origin);if(url.origin!==new URL(config.origin).origin)throw new Error('Connector request left its configured service');const r=await fetch(url,{headers:{Authorization:'Bearer '+config.token},signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error('Connector failed with HTTP '+r.status);return r;}
  async invoke(name,input){
    if(name==='configure-connector'){
      if(!['spend-guard','board-export','browser-post'].includes(input.name))throw new Error('Choose a supported optional connector');
      const url=new URL(input.url);if(url.protocol!=='https:'&&!['127.0.0.1','localhost'].includes(url.hostname))throw new Error('Connector transport requires HTTPS');if(url.username||url.password)throw new Error('Keep credentials in the separate token field');
      if(!Number.isFinite(input.threshold??0))throw new Error('Choose a numeric balance threshold');
      return this.save(input.name,{origin:url.origin,route:url.pathname+url.search,token:input.token||null,threshold:input.threshold||0,value_path:input.value_path||'balance'});
    }
    if(name==='run-connector'){
      const config=this.config(input.name);if(!config)throw new Error('Configure this optional connector on its schedule owner first');
      if(input.name==='browser-post'){
        const intent=hash({name:input.name,payload:input.payload}),approval=this.store.get('approvals',input.approval_id);
        if(!approval||approval.status!=='approved'||approval.intent_sha256!==intent||Date.parse(approval.expires_at)<Date.now())throw new Error('This exact outward payload needs a current approval');
        this.store.save('approvals',{id:approval.id,status:'attempted',attempted_at:new Date().toISOString()});
        try{const r=await fetch(new URL(config.route,config.origin),{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.token,'Idempotency-Key':approval.id},body:JSON.stringify(input.payload),signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error('Posting connector returned HTTP '+r.status);const receipt=await r.json();if(!receipt.id&&!receipt.url)throw new Error('Posting connector returned no receipt');this.store.save('approvals',{id:approval.id,status:'verified',receipt});return {receipt,verified:true};}catch(e){this.store.save('approvals',{id:approval.id,status:'needs_review',error:e.message});throw e;}
      }
      const result=await(await this.request(config,config.route)).json();
      if(input.name==='board-export')return {records:result,observed_at:new Date().toISOString()};
      const value=config.value_path.split('.').reduce((v,k)=>v?.[k],result);if(!Number.isFinite(value))throw new Error('Balance response does not contain the configured numeric value');return {balance:value,threshold:config.threshold,needs_attention:value<config.threshold,observed_at:new Date().toISOString()};
    }
    if(name==='gdrive-proxy'){
      if(input.action==='configure'){if(!input.access_token)throw new Error('Supply a Google Drive read-only access token');await this.request({origin:'https://www.googleapis.com',token:input.access_token},'/drive/v3/about?fields=user');return this.save('gdrive',{origin:'https://www.googleapis.com',token:input.access_token,refresh_token:input.refresh_token||null,client_id:input.client_id||null,client_secret:input.client_secret||null,folder_id:input.folder_id||null,sync_enabled:false});}
      const config=this.config('gdrive');
      if(input.action==='status')return {connected:!!config,settings:config?{folder_id:config.folder_id,sync_enabled:config.sync_enabled}:null};
      if(input.action==='disconnect'){if(config)this.save('gdrive',{...config,token:null,sync_enabled:false});return {disconnected:true};}
      if(!config?.token)throw new Error('Configure your chosen Drive read-only credential on this device');
      if(input.action==='save_settings')return this.save('gdrive',{...config,folder_id:input.folder_id||config.folder_id,sync_enabled:!!input.sync_enabled});
      if(['list_folders','list_files'].includes(input.action)){
        const query=input.action==='list_folders'?"mimeType='application/vnd.google-apps.folder' and trashed=false":"'"+String(config.folder_id||'root').replaceAll("'",'')+"' in parents and trashed=false",files=[];let nextPageToken;
        do{const page=await(await this.request(config,'/drive/v3/files?q='+encodeURIComponent(query)+'&fields=files(id,name,mimeType,modifiedTime,size),nextPageToken&pageSize=1000'+(nextPageToken?'&pageToken='+encodeURIComponent(nextPageToken):''))).json();files.push(...page.files||[]);nextPageToken=page.nextPageToken;}while(nextPageToken);return {files};
      }
      throw new Error('Use a read-only token for the candidate Drive connector; account-wide OAuth registration remains with your provider');
    }
    if(name==='gdrive-sync'){
      const config=this.config('gdrive');if(!config?.token||!config.folder_id)throw new Error('Configure a Drive folder before importing');
      const response=await this.invoke('gdrive-proxy',{action:'list_files'}),results=[];
      for(const file of response.files||[]){
        const id='drive-'+hash(file.id).slice(0,24),old=this.store.get('gdrive_imports',id);if(old?.modified_at===file.modifiedTime)continue;
        if(!['text/plain','text/markdown','application/pdf','image/png','image/jpeg'].includes(file.mimeType))continue;
        const bytes=Buffer.from(await(await this.request(config,'/drive/v3/files/'+encodeURIComponent(file.id)+'?alt=media')).arrayBuffer());
        if(bytes.length>100*1024*1024)throw new Error('Drive file exceeds the candidate media limit');
        const originalId='drive-note-'+hash(file.id).slice(0,24),noteId=this.store.get('notes',originalId)?originalId+'-'+hash(file.modifiedTime).slice(0,8):originalId;
        const note=this.store.save('notes',{id:noteId,title:file.name,content:file.mimeType.startsWith('text/')?bytes.toString('utf8'):'Imported document: '+file.name,source_app:'gdrive'});
        if(!file.mimeType.startsWith('text/')){const sha256=hash(bytes),storage_path='drive/'+file.id+'/'+file.name,filename=sha256+'-'+safe(file.name.replace(/[^a-zA-Z0-9_.-]/g,'_'));atomic(path.join(this.domains.mediaRoot,filename),bytes);atomic(path.join(this.domains.mediaRoot,hash(storage_path)+'.mapping.json'),JSON.stringify({path:storage_path,file:filename,sha256,size:bytes.length,contentType:file.mimeType}));this.query.execute({table:'note_attachments',operation:'insert',values:{note_id:note.id,storage_path,filename:file.name,file_type:file.mimeType}});}
        this.store.save('gdrive_imports',{id,source_id:file.id,note_id:note.id,modified_at:file.modifiedTime,sha256:hash(bytes)});if(old)this.store.save('review_queue',{suggestion_type:'source_version',title:'Review the new imported version of '+file.name,payload:{previous_note_id:old.note_id,new_note_id:note.id},status:'pending_review'});results.push(note.id);
      }return {imported:results.length,results};
    }
    if(name.startsWith('github-')){
      if(name==='github-proxy'&&input.action==='version_history'){return {commits:this.query.rows('record_history').filter(h=>h.source_type==='notes'&&h.source_id===input.note_id).map(h=>({sha:h.id,commit:{message:'Saved note revision '+h.snapshot.revision,author:{date:h.recorded_at}}}))};}
      if(name==='github-proxy'&&input.action==='file_at_commit'){const history=this.store.get('record_history',input.commit_sha);if(!history?.snapshot?.content)throw new Error('Saved note revision missing');return {content:history.snapshot.content};}
      if(name==='github-import-vault'){if(!fs.existsSync(path.join(this.store.root,'.git')))throw new Error('Connect private file sync first');return {status:this.domains.sync.reconcile()};}
      if(name==='github-people-sync'&&input.action==='conflicts')return {conflicts:this.domains.sync.pendingConflicts()};
      if(!this.domains.sync)throw new Error('Private file sync is unavailable');return {status:this.domains.sync.reconcile(),integrated_file_sync:true};
    }
    if(name==='send-patch'){const note=this.store.get('notes',input.note_id);if(!note)throw new Error('Note missing');const pending=this.store.save('review_queue',{suggestion_type:'outward_patch',title:'Review proposed patch',payload:input,status:'pending_review',requires_approval:true});return {proposed:true,review_id:pending.id};}
    if(name==='embed-document'){const record=this.store.get(input.record_type||'notes',input.note_id||input.id);if(!record)throw new Error('Record missing');return {indexed:true,mode:'rebuildable-text-index',semantic_search:'provider-ranked-on-request'};}
    if(name==='delete-my-account')return {local_only:true,instructions:'Uninstall candidate software to remove its startup entry. Export or back up knowledge before explicitly deleting your own workspace. No cloud account exists.'};
    throw new Error('Unsupported optional connector '+name);
  }
}
