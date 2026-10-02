import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Store, atomic, decode, hash } from '../records/store.mjs';
import { durable,durableRoots,durableFiles } from '../file-policy.mjs';

export class FileSync {
  constructor(store,{branch='main',remote='origin'}={}) {
    if(!/^[\w/.-]+$/.test(branch)||branch.startsWith('-')||!/^\w+$/.test(remote))throw new Error('Invalid sync configuration');
    this.store=store;this.branch=branch;this.remote=remote;this.last=null;
  }
  git(args,cwd=this.store.root){return execFileSync('git',args,{cwd,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();}
  pendingConflicts(){const dir=path.join(this.store.root,'conflicts');return fs.existsSync(dir)?fs.readdirSync(dir).filter(n=>n.endsWith('.json')&&!JSON.parse(fs.readFileSync(path.join(dir,n),'utf8')).resolved_at):[];}
  initialize(remoteUrl) {
    if(!remoteUrl||!/^(https:\/\/github\.com\/|git@github\.com:)/.test(remoteUrl))throw new Error('Use a private GitHub repository URL');
    if(!fs.existsSync(path.join(this.store.root,'.git'))){this.git(['init','-b',this.branch]);this.git(['config','user.name','Godspeed Mission Control']);this.git(['config','user.email','godspeed@localhost']);}
    atomic(path.join(this.store.root,'.gitignore'),'*\n'+durableRoots.map(r=>'!'+r+'/\n!'+r+'/**\n').join('')+durableFiles.map(r=>'!'+r+'\n').join('')+'!.gitignore\n**/.env\n**/.env.*\n**/secrets/\n**/node_modules/\n**/*.sqlite*\n**/*.png\n**/*.jpg\n**/*.mp4\n**/*.mp3\n**/*.pdf\n');
    try {this.git(['remote','get-url',this.remote]);}catch{this.git(['remote','add',this.remote,remoteUrl]);}
  }
  validate(){this.store.scan();if(this.store.problems.length)throw new Error('Resolve record validation problems before syncing');if(this.pendingConflicts().length)throw new Error('Resolve saved conflicts before syncing');}
  commitLocal(){
    this.validate();
    const staged=this.git(['diff','--cached','--name-only']);
    if(staged.split('\n').some(n=>n&&!durable(n)&&n!=='.gitignore'))throw new Error('Sync repository contains staged files outside durable state');
    this.git(['add','--',...durableRoots.filter(r=>fs.existsSync(path.join(this.store.root,r))),...durableFiles.filter(r=>fs.existsSync(path.join(this.store.root,r))),'.gitignore']);
    if(this.git(['diff','--cached','--name-only']).split('\n').some(n=>n&&!durable(n)&&n!=='.gitignore'))throw new Error('A private path was staged; sync stopped');
    if(this.git(['diff','--cached','--name-only']))this.git(['commit','-m','Save Godspeed Mission Control records']);
  }
  reconcile(){
    return this.store.withLock(()=>{
      try{
        this.commitLocal();
        try{this.git(['fetch',this.remote,this.branch]);}catch(error){
          if(this.git(['ls-remote','--heads',this.remote,this.branch]))throw error;
          this.git(['push',this.remote,'HEAD:refs/heads/'+this.branch]);
          this.last={state:'synced',at:new Date().toISOString(),pending:0};atomic(path.join(this.store.state,'sync-status.json'),JSON.stringify(this.last));return this.last;
        }
        const remoteRef=this.remote+'/'+this.branch,head=this.git(['rev-parse','HEAD']),remoteHead=this.git(['rev-parse',remoteRef]);
        if(head!==remoteHead)this.integrate(remoteRef);
        this.validate();this.git(['push',this.remote,'HEAD:refs/heads/'+this.branch]);
        this.last={state:'synced',at:new Date().toISOString(),pending:0};
      }catch(e){this.last={state:this.pendingConflicts().length?'conflict':'pending',at:new Date().toISOString(),error:'Sync did not complete; local files remain available',detail: String(e.message).split('\n')[0]};}
      atomic(path.join(this.store.state,'sync-status.json'),JSON.stringify(this.last,null,2));return this.last;
    });
  }
  integrate(remoteRef){
    const integrationRoot=path.join(this.store.state,'sync-worktrees'),dir=path.join(integrationRoot,randomUUID());fs.mkdirSync(integrationRoot,{recursive:true});
    if(!path.resolve(dir).startsWith(path.resolve(integrationRoot)+path.sep))throw new Error('Unsafe sync staging path');
    this.git(['worktree','add','--detach',dir,'HEAD']);
    try {
      try { this.git(['merge','--no-edit','--no-ff','--allow-unrelated-histories',remoteRef],dir); }
      catch(e) {
        const conflicted=this.git(['diff','--name-only','--diff-filter=U'],dir).split('\n').filter(Boolean);
        if(!conflicted.length)throw e;
        const remoteCommit=this.git(['rev-parse',remoteRef]), unresolved=[];
        for(const name of conflicted){
          const read=stage=>{try{return this.git(['show',':'+stage+':'+name],dir);}catch{return null;}};
          const id=hash(name).slice(0,24),saved=path.join(this.store.root,'conflicts',id+'.json');
          const previous=fs.existsSync(saved)?JSON.parse(fs.readFileSync(saved,'utf8')):null;
          if(previous?.resolved_at&&previous.remote_commit===remoteCommit){
            const live=path.resolve(this.store.root,name),target=path.resolve(dir,name);
            if(!durable(name)||!live.startsWith(this.store.root+path.sep)||!target.startsWith(dir+path.sep))throw new Error('Invalid conflict path');
            atomic(target,fs.readFileSync(live,'utf8'));this.git(['add','--',name],dir);continue;
          }
          const conflict={id,path:name,kind:'git',base:read(1),local:read(2),remote:read(3),remote_commit:remoteCommit,at:new Date().toISOString()};
          atomic(path.join(this.store.root,'conflicts',id+'.json'),JSON.stringify(conflict,null,2));
          unresolved.push(name);
        }
        if(unresolved.length)throw new Error('Concurrent edits were preserved for review');
        this.git(['commit','--no-edit'],dir);
      }
      const merged=new Store(dir);
      if(merged.problems.length)throw new Error('The merged reference graph needs review');
      const removed=[...this.store.records.keys()].filter(key=>!merged.records.has(key));
      if(removed.some(key=>![...merged.records.values()].some(r=>r.uid===this.store.records.get(key).uid&&(r.aliases||[]).includes(this.store.records.get(key).id))))throw new Error('Remote removal without a tombstone or proven rename needs review');
      const batch=[...merged.records.values()].filter(r=>this.store.records.get(r.type+'/'+r.id)?._hash!==r._hash).map(r=>{const value={...r};delete value._hash;return value;});
      if(batch.length||removed.length)this.store.commit(batch,{removeKeys:removed});
      const documents=this.git(['ls-files'],dir).split('\n').filter(n=>durable(n)&&!n.startsWith('records/')).map(file=>({file,text:fs.readFileSync(path.join(dir,file),'utf8')})).filter(item=>!fs.existsSync(path.join(this.store.root,item.file))||fs.readFileSync(path.join(this.store.root,item.file),'utf8')!==item.text);
      if(documents.length)this.store.publishFiles(documents);
      const commit=this.git(['rev-parse','HEAD'],dir);
      // Files are already published through the recoverable transaction. Move only Git's head/index.
      this.git(['reset','--mixed',commit]);
    } finally {this.git(['worktree','remove','--force',dir]);}
  }
  resolve(id,choice,mergedText=null){
    const file=path.join(this.store.root,'conflicts',id+'.json');if(!/^[\w-]+$/.test(id))throw new Error('Invalid conflict id');
    const conflict=JSON.parse(fs.readFileSync(file,'utf8'));if(conflict.resolved_at)return conflict;
    if(conflict.kind!=='git')throw new Error('Use the record editor to resolve a stale-write conflict');
    const text=choice==='merged'?mergedText:choice==='local'?conflict.local:choice==='remote'?conflict.remote:null;
    if(text===null)throw new Error('Choose a retained version or write a merged record');
    const target=path.resolve(this.store.root,conflict.path);if(!durable(conflict.path)||!target.startsWith(this.store.root+path.sep))throw new Error('Conflict target is not durable state');
    this.store.withLock(()=>{if(conflict.path.startsWith('records/'))this.store.commit([decode(text,target)]);else this.store.publishFiles([{file:conflict.path,text}]);});conflict.resolved_at=new Date().toISOString();conflict.choice=choice;atomic(file,JSON.stringify(conflict,null,2));return conflict;
  }
}
