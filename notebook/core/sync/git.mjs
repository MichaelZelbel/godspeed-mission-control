import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Store, atomic, decode, hash } from '../records/store.mjs';
import { durable,durableRoots,durableFiles } from '../file-policy.mjs';
import {validateAssistantFiles} from '../assistant-files.mjs';
import {resolveSavedConflict} from '../conflicts.mjs';

export class FileSync {
  constructor(store,{branch='main',remote='origin'}={}) {
    if(!/^[\w/.-]+$/.test(branch)||branch.startsWith('-')||!/^\w+$/.test(remote))throw new Error('Invalid sync configuration');
    this.store=store;this.branch=branch;this.remote=remote;this.last=null;
  }
  gitBytes(args,cwd=this.store.root){return execFileSync('git',args,{cwd,windowsHide:true,timeout:30000,maxBuffer:256*1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never'},stdio:['ignore','pipe','pipe']});}
  git(args,cwd=this.store.root){return this.gitBytes(args,cwd).toString('utf8').trim();}
  pendingConflicts(){const dir=path.join(this.store.root,'conflicts');return fs.existsSync(dir)?fs.readdirSync(dir).filter(n=>n.endsWith('.json')&&!JSON.parse(fs.readFileSync(path.join(dir,n),'utf8')).resolved_at):[];}
  async verifyRemote(remoteUrl){
    const match=String(remoteUrl).match(/^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);if(!match)throw new Error('Use a GitHub repository address without embedded credentials');
    const response=await fetch('https://api.github.com/repos/'+match[1]+'/'+match[2],{headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(15000)});
    if(response.status===200)throw new Error('This repository is publicly readable. Choose a private repository for your knowledge');if(response.status!==404)throw new Error('Repository privacy could not be verified; no files were uploaded');
    try{this.git(['ls-remote',remoteUrl]);}catch{throw new Error('The private repository could not be read with this device Git credentials; no files were uploaded');}
  }
  initialize(remoteUrl) {
    if(!remoteUrl||!/^(https:\/\/github\.com\/|git@github\.com:)/.test(remoteUrl))throw new Error('Use a private GitHub repository URL');
    if(!fs.existsSync(path.join(this.store.root,'.git'))){this.git(['init','-b',this.branch]);this.git(['config','user.name','Godspeed Mission Control']);this.git(['config','user.email','godspeed@localhost']);}
    this.git(['config','core.autocrlf','false']);this.git(['config','core.eol','lf']);if(process.platform==='win32')this.git(['config','core.longpaths','true']);
    atomic(path.join(this.store.root,'.gitignore'),'*\n'+durableRoots.map(r=>'!'+r+'/\n!'+r+'/**\n').join('')+durableFiles.map(r=>'!'+r+'\n').join('')+'**/.*\n!.gitignore\n**/secrets/\n**/node_modules/\n**/*.sqlite*\n**/*.png\n**/*.jpg\n**/*.mp4\n**/*.mp3\n**/*.pdf\n');
    try {this.git(['remote','get-url',this.remote]);}catch{this.git(['remote','add',this.remote,remoteUrl]);}
  }
  validate(){this.store.scan();if(this.store.problems.length)throw new Error('Resolve record validation problems before syncing');validateAssistantFiles(this.store.root);if(this.pendingConflicts().length)throw new Error('Resolve saved conflicts before syncing');}
  commitLocal(){
    this.validate();
    const staged=this.git(['diff','--cached','--name-only']);
    if(staged.split('\n').some(n=>n&&!durable(n)&&n!=='.gitignore'))throw new Error('Sync repository contains staged files outside durable state');
    this.git(['add','--',...durableRoots.filter(r=>fs.existsSync(path.join(this.store.root,r))),...durableFiles.filter(r=>fs.existsSync(path.join(this.store.root,r))),'.gitignore']);
    if(this.git(['diff','--cached','--name-only']).split('\n').some(n=>n&&!durable(n)&&n!=='.gitignore'))throw new Error('A private path was staged; sync stopped');
    if(this.git(['diff','--cached','--name-only']))this.git(['commit','-m','Save Godspeed Mission Control records']);
  }
  reconcile(){
    try{
        // Fetch and upload can wait on a disconnected network or credential
        // helper. Local edits must remain available during those waits.
        let remoteExists=true,networkError=null;
        try{this.git(['fetch',this.remote,this.branch]);}catch(error){
          try{if(this.git(['ls-remote','--heads',this.remote,this.branch]))networkError=error;else remoteExists=false;}catch{networkError=error;}
        }
        this.store.withLock(()=>{
        this.commitLocal();
        if(!networkError&&remoteExists){
        const remoteRef=this.remote+'/'+this.branch,head=this.git(['rev-parse','HEAD']),remoteHead=this.git(['rev-parse',remoteRef]);
        if(head!==remoteHead){
          this.integrate(remoteRef);
          // Transactions publish the canonical record representation. Older
          // clones can contain CRLF blobs, so commit that local integration
          // before upload rather than leave a false pending edit behind.
          this.commitLocal();
        }
        }
        this.validate();
        });
        if(networkError)throw networkError;
        this.git(['push',this.remote,'HEAD:refs/heads/'+this.branch]);
        const pending=this.store.withLock(()=>new Set([
          ...this.gitBytes(['diff','--name-only','-z']).toString('utf8').split('\0'),
          ...this.gitBytes(['diff','--cached','--name-only','-z']).toString('utf8').split('\0'),
          ...this.gitBytes(['ls-files','--others','--exclude-standard','-z']).toString('utf8').split('\0')
        ].filter(name=>name&&(durable(name)||name==='.gitignore'))).size);
        this.last={state:pending?'pending':'synced',at:new Date().toISOString(),pending,...(pending?{detail:'New local edits will upload on the next synchronization cycle.'}:{})};
    }catch(error){this.last={state:this.pendingConflicts().length?'conflict':'pending',at:new Date().toISOString(),error:'Sync did not complete; local files remain available',detail:error.message==='Workspace is being written by another process'?'The assistant is saving its state.':String(error.message).split('\n')[0]};}
    atomic(path.join(this.store.state,'sync-status.json'),JSON.stringify(this.last,null,2));return this.last;
  }
  integrate(remoteRef){
    const integrationRoot=path.join(this.store.state,'sync-worktrees'),dir=path.join(integrationRoot,randomUUID());fs.mkdirSync(integrationRoot,{recursive:true});
    if(!path.resolve(dir).startsWith(path.resolve(integrationRoot)+path.sep))throw new Error('Unsafe sync staging path');
    this.git(['worktree','add','--detach',dir,'HEAD']);
    try {
      // Independently created profiles can look like renames to Git. Their paths
      // are durable identities, so merging must never infer a move from content.
      try { this.git(['merge','--no-edit','--no-ff','--strategy=resolve','--allow-unrelated-histories',remoteRef],dir); }
      catch(e) {
        const conflicted=this.git(['diff','--name-only','--diff-filter=U'],dir).split('\n').filter(Boolean);
        if(!conflicted.length)throw e;
        const remoteCommit=this.git(['rev-parse',remoteRef]), unresolved=[];
        for(const name of conflicted){
          const stages=this.git(['ls-files','--stage','--',name],dir).split('\n').map(line=>Number(line.match(/^\d+ [a-f0-9]+ (\d)\t/)?.[1])).filter(Boolean);
          const read=stage=>stages.includes(stage)?this.gitBytes(['show',':'+stage+':'+name],dir):null;
          const id=hash(name).slice(0,24),saved=path.join(this.store.root,'conflicts',id+'.json');
          const previous=fs.existsSync(saved)?JSON.parse(fs.readFileSync(saved,'utf8')):null;
          if(previous?.resolved_at&&previous.remote_commit===remoteCommit){
            const live=path.resolve(this.store.root,name),target=path.resolve(dir,name);
            if(!durable(name)||!live.startsWith(this.store.root+path.sep)||!target.startsWith(dir+path.sep))throw new Error('Invalid conflict path');
            atomic(target,fs.readFileSync(live));this.git(['add','--',name],dir);continue;
          }
          const versions={base:read(1),local:read(2),remote:read(3)},binary=Object.values(versions).some(v=>v&&(v.includes(0)||!Buffer.from(v.toString('utf8')).equals(v)));
          const conflict={id,path:name,kind:'git',...(binary?{encoding:'base64',digests:Object.fromEntries(Object.entries(versions).map(([key,v])=>[key,v&&hash(v)]))}:{}),...Object.fromEntries(Object.entries(versions).map(([key,v])=>[key,v===null?null:v.toString(binary?'base64':'utf8')])),remote_commit:remoteCommit,at:new Date().toISOString()};
          atomic(path.join(this.store.root,'conflicts',id+'.json'),JSON.stringify(conflict,null,2));
          unresolved.push(name);
        }
        if(unresolved.length)throw new Error('Concurrent edits were preserved for review');
        this.git(['commit','--no-edit'],dir);
      }
      const merged=new Store(dir);
      validateAssistantFiles(dir);
      if(merged.problems.length)throw new Error('The merged reference graph needs review');
      const removed=[...this.store.records.keys()].filter(key=>!merged.records.has(key));
      if(removed.some(key=>![...merged.records.values()].some(r=>r.uid===this.store.records.get(key).uid&&(r.aliases||[]).includes(this.store.records.get(key).id))))throw new Error('Remote removal without a tombstone or proven rename needs review: '+removed.join(', '));
      const batch=[...merged.records.values()].filter(r=>this.store.records.get(r.type+'/'+r.id)?._hash!==r._hash).map(r=>{const value={...r};delete value._hash;return value;});
      if(batch.length||removed.length)this.store.commit(batch,{removeKeys:removed});
      const documents=this.git(['ls-files'],dir).split('\n').filter(n=>durable(n)&&!n.startsWith('records/')).map(file=>({file,text:fs.readFileSync(path.join(dir,file))})).filter(item=>!fs.existsSync(path.join(this.store.root,item.file))||!fs.readFileSync(path.join(this.store.root,item.file)).equals(item.text));
      if(documents.length)this.store.publishFiles(documents);
      const commit=this.git(['rev-parse','HEAD'],dir);
      // Files are already published through the recoverable transaction. Move only Git's head/index.
      this.git(['reset','--mixed',commit]);
    } finally {this.git(['worktree','remove','--force',dir]);}
  }
  resolve(id,choice,mergedText=null,expectedHash){
    return resolveSavedConflict(this.store,{id,choice,text:mergedText,expected_hash:expectedHash},{legacyLocalCheck:true});
  }
}
