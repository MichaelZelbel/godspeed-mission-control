import fs from 'node:fs';
import path from 'node:path';
import {atomic,hash,safe} from './records/store.mjs';
export class Connectors {
  constructor(domains){this.domains=domains;this.store=domains.store;this.query=domains.query;}
  config(name){const file=path.join(this.store.state,'connectors',safe(name)+'.json');return fs.existsSync(file)?JSON.parse(fs.readFileSync(file,'utf8')):null;}
  save(name,value){const file=path.join(this.store.state,'connectors',safe(name)+'.json');atomic(file,JSON.stringify(value));fs.chmodSync(file,0o600);return {configured:true};}
  async request(config,route){const url=new URL(route,config.origin);if(url.origin!==new URL(config.origin).origin)throw new Error('Connector request left its configured service');const r=await fetch(url,{headers:{Authorization:'Bearer '+config.token},signal:AbortSignal.timeout(30000)});if(!r.ok)throw new Error('Connector failed with HTTP '+r.status);return r;}
  async invoke(name,input){
    if(name==='gdrive-proxy'){
      if(input.action==='configure'){if(!input.access_token)throw new Error('Supply a Google Drive read-only access token');await this.request({origin:'https://www.googleapis.com',token:input.access_token},'/drive/v3/about?fields=user');return this.save('gdrive',{origin:'https://www.googleapis.com',token:input.access_token,folder_id:input.folder_id||null,sync_enabled:false});}
      const config=this.config('gdrive');
      if(input.action==='status')return {connected:!!config,settings:config?{folder_id:config.folder_id,sync_enabled:config.sync_enabled}:null};
      if(input.action==='disconnect'){if(config)this.save('gdrive',{...config,token:null,sync_enabled:false});return {disconnected:true};}
      if(!config?.token)throw new Error('Configure your chosen Drive read-only credential on this device');
      if(input.action==='save_settings')return this.save('gdrive',{...config,folder_id:input.folder_id||config.folder_id,sync_enabled:!!input.sync_enabled});
      if(input.action==='list_folders')return await(await this.request(config,"/drive/v3/files?q="+encodeURIComponent("mimeType='application/vnd.google-apps.folder' and trashed=false")+'&fields=files(id,name),nextPageToken')).json();
      if(input.action==='list_files')return await(await this.request(config,'/drive/v3/files?q='+encodeURIComponent("'"+String(config.folder_id||'root').replaceAll("'",'')+"' in parents and trashed=false")+'&fields=files(id,name,mimeType,modifiedTime,size),nextPageToken')).json();
      throw new Error('Use a read-only token for the candidate Drive connector; account-wide OAuth registration remains with your provider');
    }
    if(name==='gdrive-sync'){
      const config=this.config('gdrive');if(!config?.token||!config.folder_id)throw new Error('Configure a Drive folder before importing');
      const response=await this.invoke('gdrive-proxy',{action:'list_files'}),results=[];
      if(response.nextPageToken)throw new Error('This folder needs pagination before a complete import; choose a smaller folder');
      for(const file of response.files||[]){
        const id='drive-'+hash(file.id).slice(0,24),old=this.store.get('gdrive_imports',id);if(old?.modified_at===file.modifiedTime)continue;
        if(!['text/plain','text/markdown','application/pdf','image/png','image/jpeg'].includes(file.mimeType))continue;
        const bytes=Buffer.from(await(await this.request(config,'/drive/v3/files/'+encodeURIComponent(file.id)+'?alt=media')).arrayBuffer());
        if(bytes.length>100*1024*1024)throw new Error('Drive file exceeds the candidate media limit');
        const noteId='drive-note-'+hash(file.id).slice(0,24);if(this.store.get('notes',noteId))throw new Error('Imported source changed. Review a new version rather than replacing local edits');
        const note=this.store.save('notes',{id:noteId,title:file.name,content:file.mimeType.startsWith('text/')?bytes.toString('utf8'):'Imported document: '+file.name,source_app:'gdrive'});
        if(!file.mimeType.startsWith('text/')){const sha256=hash(bytes),storage_path='drive/'+file.id+'/'+file.name,filename=sha256+'-'+safe(file.name.replace(/[^a-zA-Z0-9_.-]/g,'_'));atomic(path.join(this.domains.mediaRoot,filename),bytes);atomic(path.join(this.domains.mediaRoot,hash(storage_path)+'.mapping.json'),JSON.stringify({path:storage_path,file:filename,sha256,size:bytes.length,contentType:file.mimeType}));this.query.execute({table:'note_attachments',operation:'insert',values:{note_id:note.id,storage_path,filename:file.name,file_type:file.mimeType}});}
        this.store.save('gdrive_imports',{id,source_id:file.id,note_id:note.id,modified_at:file.modifiedTime,sha256:hash(bytes)});results.push(note.id);
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
