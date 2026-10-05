import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Store, atomic, decode, hash } from '../records/store.mjs';
import { shared,durableRoots,durableFiles,devicePrivatePaths } from '../file-policy.mjs';
import {validateAssistantFiles} from '../assistant-files.mjs';
import {resolveSavedConflict} from '../conflicts.mjs';

export class FileSync {
  constructor(store,{branch='main',remote='origin',largeFile=50*1024*1024}={}) {
    if(!/^[\w/.-]+$/.test(branch)||branch.startsWith('-')||!/^\w+$/.test(remote))throw new Error('Invalid sync configuration');
    this.store=store;this.branch=branch;this.remote=remote;this.largeFile=largeFile;this.last=null;
    // A folder that already belongs to its own repository (an existing mission
    // control shared across machines) keeps that repository untouched. The
    // knowledge repository then lives beside it in the private state folder,
    // with this folder as its work tree, so the ignore file, the index and the
    // remotes of the owner's repository are never rewritten.
    const own=path.join(store.state,'sync.git');this.gitDir=fs.existsSync(own)?own:null;
  }
  gitBytes(args,cwd=this.store.root){if(this.gitDir&&cwd===this.store.root)args=['--git-dir='+this.gitDir,'--work-tree='+this.store.root,...args];return execFileSync('git',args,{cwd,windowsHide:true,timeout:30000,maxBuffer:256*1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never'},stdio:['ignore','pipe','pipe']});}
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
    if(!this.gitDir&&this.foreignRepository()){
      const dir=path.join(this.store.state,'sync.git');fs.mkdirSync(this.store.state,{recursive:true});
      this.git(['init','--bare','--initial-branch='+this.branch,dir],this.store.state);this.git(['config','core.bare','false'],dir);this.gitDir=dir;
      this.git(['config','user.name','Godspeed Mission Control']);this.git(['config','user.email','godspeed@localhost']);
    }
    if(!this.gitDir&&!fs.existsSync(path.join(this.store.root,'.git'))){this.git(['init','-b',this.branch]);this.git(['config','user.name','Godspeed Mission Control']);this.git(['config','user.email','godspeed@localhost']);}
    this.git(['config','core.autocrlf','false']);this.git(['config','core.eol','lf']);if(process.platform==='win32')this.git(['config','core.longpaths','true']);
    this.writeIgnoreFile();
    try {this.git(['remote','get-url',this.remote]);}catch{this.git(['remote','add',this.remote,remoteUrl]);}
  }
  // The folder's repository is someone else's when it tracks files that sync
  // would untrack (programs, settings, hooks). Adopting it would rewrite its
  // ignore file and untrack those files for every other clone that pulls it.
  foreignRepository(){
    if(!fs.existsSync(path.join(this.store.root,'.git')))return false;
    return this.gitBytes(['ls-files','-z']).toString('utf8').split('\0').some(name=>name&&name!=='.gitignore'&&!shared(name));
  }
  // The ignore file is derived from the policy, so it is rewritten whenever the
  // policy has moved on rather than only when sync is first configured. An
  // installation configured before a path became private carried an ignore file
  // that let `git add` put it straight back.
  // Every parent of a nested durable root needs its own negation: Git does not
  // look inside a directory it has been told to ignore, so "!routines/journal/"
  // without "!routines/" meant the journal and the headache log could never be
  // staged, and `git add` stopped the whole sync over it. The parent negation
  // only lets Git descend; the leading "*" still ignores its other children.
  ignoreText(){return '*\n'+[...new Set(durableRoots.flatMap(r=>r.split('/').map((_,i,parts)=>parts.slice(0,i+1).join('/'))))].map(r=>'!'+r+'/\n').join('')+durableRoots.map(r=>'!'+r+'/**\n').join('')+durableFiles.map(r=>'!'+r+'\n').join('')+devicePrivatePaths.map(r=>r+'/\n').join('')+'**/.*\n!.gitignore\n**/secrets/\n**/node_modules/\n**/*.sqlite*\n**/*.png\n**/*.jpg\n**/*.mp4\n**/*.mp3\n**/*.pdf\n'+
    // Installers, archives and recordings are build output and copies, not
    // knowledge. An owner's work/ folder held 4 GB of them, one file 1 GB: every
    // `git add` ran into the time limit, and GitHub refuses any file over 100 MB.
    '**/*.zip\n**/*.tar\n**/*.gz\n**/*.tgz\n**/*.7z\n**/*.exe\n**/*.msi\n**/*.dmg\n**/*.iso\n**/*.mov\n**/*.webm\n**/*.wav\n**/*.m4a\n';}
  writeIgnoreFile(){
    // Beside an owner's repository the policy goes into the knowledge
    // repository's own exclude file; the folder's .gitignore is the owner's.
    const file=this.gitDir?path.join(this.gitDir,'info','exclude'):path.join(this.store.root,'.gitignore'),policy=this.ignoreText();
    const write=text=>{if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==text)atomic(file,text);};
    write(policy);
    // An owner's folder holds whatever its owner keeps there. A single file too
    // large to upload stays on this machine instead of stopping every sync, and
    // the list is made against the policy alone so it never hides itself.
    if(this.gitDir){const large=this.largeFiles();if(large.length)write(policy+'# Too large to synchronize, kept on this machine\n'+large.map(n=>'/'+n.replace(/[*?[\]\\]/g,'\\$&')+'\n').join(''));}
  }
  largeFiles(){
    const roots=[...durableRoots,...durableFiles].filter(r=>fs.existsSync(path.join(this.store.root,r)));if(!roots.length)return [];
    return this.gitBytes(['ls-files','-z','--others','--exclude-standard','--',...roots]).toString('utf8').split('\0').filter(name=>{if(!name)return false;try{return fs.statSync(path.join(this.store.root,name)).size>this.largeFile;}catch{return false;}});
  }
  validate(){this.store.scan();if(this.store.problems.length)throw new Error('Resolve record validation problems before syncing');validateAssistantFiles(this.store.root);if(this.pendingConflicts().length)throw new Error('Resolve saved conflicts before syncing');}
  // A path that was synced before it became device-private stays in the index
  // and Git keeps hashing it on every status and every add. Untrack it once,
  // leaving the file itself on disk, so an existing installation gets the same
  // fast commit as a new one.
  untrackPrivate(){
    const tracked=this.gitBytes(['ls-files','-z']).toString('utf8').split('\0').filter(name=>name&&name!=='.gitignore'&&!shared(name));
    for(let i=0;i<tracked.length;i+=200)this.git(['rm','--cached','--quiet','-r','--',...tracked.slice(i,i+200)]);
    return tracked.length;
  }
  commitLocal(){
    if(this.pendingConflicts().length)throw new Error('Resolve saved conflicts before syncing');
    this.writeIgnoreFile();
    this.untrackPrivate();
    // --diff-filter=d leaves out removals: untracking a path that became
    // device-private is the one staged change about a private path that is
    // correct, and the guard must not read it as an attempt to sync one.
    const staged=this.git(['diff','--cached','--name-only','--diff-filter=d']);
    if(staged.split('\n').some(n=>n&&!shared(n)&&n!=='.gitignore'))throw new Error('Sync repository contains staged files outside durable state');
    const roots=[...durableRoots.filter(r=>fs.existsSync(path.join(this.store.root,r))),...durableFiles.filter(r=>fs.existsSync(path.join(this.store.root,r))),...(this.gitDir?[]:['.gitignore'])];
    // Validation guards what a commit uploads. With nothing to commit there is
    // nothing to guard, and reading the whole vault to validate it anyway held
    // the workspace for a second of every idle round on an imported vault.
    if(!staged&&!this.git(['status','--porcelain','--untracked-files=all','--',...roots]))return false;
    this.validate();
    this.git(['add','--',...roots]);
    if(this.git(['diff','--cached','--name-only','--diff-filter=d']).split('\n').some(n=>n&&!shared(n)&&n!=='.gitignore'))throw new Error('A private path was staged; sync stopped');
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
        this.commitLocal();let integrated=false;
        if(!networkError&&remoteExists){
        const remoteRef=this.remote+'/'+this.branch,head=this.git(['rev-parse','HEAD']),remoteHead=this.git(['rev-parse',remoteRef]);
        // When the remote already holds everything here there is nothing to
        // merge, and when this side is only behind it takes the remote commit
        // as it is. A merge commit in either case gave the other device a new
        // head to merge in turn, and two devices kept doing that forever.
        if(head!==remoteHead&&!this.contains(remoteHead,head)){
          const fastForward=this.contains(head,remoteHead);
          // A device on an older version still wraps every head it receives in
          // a merge of its own. Its content is what is here already, so this
          // side moves to it without rebuilding the workspace from it.
          if(fastForward&&this.git(['rev-parse',head+'^{tree}'])===this.git(['rev-parse',remoteHead+'^{tree}']))this.git(['reset','--soft',remoteHead]);
          else {
            this.integrate(remoteRef,{fastForward});integrated=true;
            // Transactions publish the canonical record representation. Older
            // clones can contain CRLF blobs, so commit that local integration
            // before upload rather than leave a false pending edit behind.
            this.commitLocal();
          }
        }
        }
        // Only an integration changes the workspace after commitLocal looked.
        if(integrated)this.validate();
        });
        if(networkError)throw networkError;
        this.git(['push',this.remote,'HEAD:refs/heads/'+this.branch]);
        const pending=this.store.withLock(()=>new Set([
          ...this.gitBytes(['diff','--name-only','-z']).toString('utf8').split('\0'),
          ...this.gitBytes(['diff','--cached','--name-only','-z']).toString('utf8').split('\0'),
          ...this.gitBytes(['ls-files','--others','--exclude-standard','-z']).toString('utf8').split('\0')
        ].filter(name=>name&&(shared(name)||(name==='.gitignore'&&!this.gitDir)))).size);
        this.last={state:pending?'pending':'synced',at:new Date().toISOString(),pending,...(pending?{detail:'New local edits will upload on the next synchronization cycle.'}:{})};
    }catch(error){this.last={state:this.pendingConflicts().length?'conflict':'pending',at:new Date().toISOString(),error:'Sync did not complete; local files remain available',detail:error.message==='Workspace is being written by another process'?'The assistant is saving its state.':String(error.message).split('\n')[0]};}
    atomic(path.join(this.store.state,'sync-status.json'),JSON.stringify(this.last,null,2));return this.last;
  }
  // Whether commit `ancestor` is already part of the history of `descendant`.
  contains(ancestor,descendant){try{this.git(['merge-base','--is-ancestor',ancestor,descendant]);return true;}catch{return false;}}
  integrate(remoteRef,{fastForward=false}={}){
    const integrationRoot=path.join(this.store.state,'sync-worktrees'),dir=path.join(integrationRoot,randomUUID());fs.mkdirSync(integrationRoot,{recursive:true});
    if(!path.resolve(dir).startsWith(path.resolve(integrationRoot)+path.sep))throw new Error('Unsafe sync staging path');
    const localHead=this.git(['rev-parse','HEAD']);
    // The merge compares against this view, so it is read under the lock it
    // runs in, whatever commitLocal did or skipped before it.
    this.store.scan(true);
    this.git(['worktree','add','--detach',dir,'HEAD']);
    try {
      // Independently created profiles can look like renames to Git. Their paths
      // are durable identities, so merging must never infer a move from content.
      // The first join of an adopted mission control meets a knowledge
      // repository that grew from the starter, with no history in common. Its
      // same-named files are the starter's templates, and the owner's folder is
      // the reason it was adopted, so the folder's version wins once. After
      // this merge both sides share a base and every later edit is reviewed.
      let firstJoin=false;if(this.gitDir){try{this.git(['merge-base','HEAD',remoteRef],dir);}catch{firstJoin=true;}}
      try { this.git(fastForward?['merge','--ff-only',remoteRef]:['merge','--no-edit','--no-ff',...(firstJoin?['--strategy=ort','-X','ours','-X','no-renames']:['--strategy=resolve']),'--allow-unrelated-histories',remoteRef],dir); }
      catch(e) {
        const conflicted=this.git(['diff','--name-only','--diff-filter=U'],dir).split('\n').filter(Boolean);
        if(!conflicted.length)throw e;
        const remoteCommit=this.git(['rev-parse',remoteRef]), unresolved=[];
        for(const name of conflicted){
          // A path that no longer leaves this machine has no meaningful remote
          // side: what the remote carries is only what was uploaded before the
          // policy changed. Taking it out of the merge keeps this machine's own
          // copy and stops carrying it. Saving a conflict instead blocked every
          // later synchronization over a file nobody can review, and the next
          // merge wrote the conflict again, so clearing them never held.
          if(!shared(name)){this.git(['rm','--force','--quiet','--ignore-unmatch','--',name],dir);continue;}
          const stages=this.git(['ls-files','--stage','--',name],dir).split('\n').map(line=>Number(line.match(/^\d+ [a-f0-9]+ (\d)\t/)?.[1])).filter(Boolean);
          const read=stage=>stages.includes(stage)?this.gitBytes(['show',':'+stage+':'+name],dir):null;
          const id=hash(name).slice(0,24),saved=path.join(this.store.root,'conflicts',id+'.json');
          const previous=fs.existsSync(saved)?JSON.parse(fs.readFileSync(saved,'utf8')):null;
          if(previous?.resolved_at&&previous.remote_commit===remoteCommit){
            const live=path.resolve(this.store.root,name),target=path.resolve(dir,name);
            if(!shared(name)||!live.startsWith(this.store.root+path.sep)||!target.startsWith(dir+path.sep))throw new Error('Invalid conflict path');
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
      const documents=this.git(['ls-files'],dir).split('\n').filter(n=>shared(n)&&!n.startsWith('records/')).map(file=>({file,text:fs.readFileSync(path.join(dir,file))})).filter(item=>!fs.existsSync(path.join(this.store.root,item.file))||!fs.readFileSync(path.join(this.store.root,item.file)).equals(item.text));
      // A document another machine deleted is deleted here too, when this
      // machine still holds exactly the version both last agreed on. Before,
      // only records carried removals: a deleted rule or skill stayed on every
      // other machine, and the next upload from any of them put it back. A
      // file changed here meanwhile is a modify/delete conflict above instead.
      const gone=this.git(['diff','--name-only','--no-renames','--diff-filter=D',localHead,'HEAD'],dir).split('\n').filter(n=>n&&shared(n)&&!n.startsWith('records/')&&fs.existsSync(path.join(this.store.root,n)))
        .filter(n=>this.git(['hash-object','--',n])===this.git(['rev-parse',localHead+':'+n]));
      const tracked=this.git(['ls-files'],dir).split('\n').filter(n=>shared(n)&&!n.startsWith('records/')).length;
      if(gone.length>25&&gone.length*5>tracked+gone.length)throw new Error('Remote removal of '+gone.length+' files needs review');
      if(documents.length||gone.length)this.store.publishFiles([...documents,...gone.map(file=>({file,delete:true}))]);
      const commit=this.git(['rev-parse','HEAD'],dir);
      // Files are already published through the recoverable transaction. Move only Git's head/index.
      this.git(['reset','--mixed',commit]);
    } finally {this.git(['worktree','remove','--force',dir]);}
  }
  resolve(id,choice,mergedText=null,expectedHash){
    return resolveSavedConflict(this.store,{id,choice,text:mergedText,expected_hash:expectedHash},{legacyLocalCheck:true});
  }
}
