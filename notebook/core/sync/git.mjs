import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Store, atomic, decode, hash } from '../records/store.mjs';
import { identityPlan, identities } from './identity.mjs';
import { shared,durableRoots,durableFiles,devicePrivatePaths,recordsFolder,isRecordPath } from '../file-policy.mjs';
import {validateAssistantFiles} from '../assistant-files.mjs';
import {resolveSavedConflict} from '../conflicts.mjs';

// What sync never puts in a repository, whichever repository it is: build
// output, archives, recordings, pictures and the disposable SQLite indexes.
const keptLocal=['sqlite*','png','jpg','mp4','mp3','pdf','zip','tar','gz','tgz','7z','exe','msi','dmg','iso','mov','webm','wav','m4a','tmp'];
export function readSyncConfig(state){try{return JSON.parse(fs.readFileSync(path.join(state,'sync-config.json'),'utf8'));}catch{return null;}}
// The paths the notebook commits when it syncs through the folder's own
// repository. "*" means every shared path, for a folder nobody else commits to.
export function folderPaths(paths){
  const list=paths===undefined?[recordsFolder]:paths;
  if(!Array.isArray(list)||!list.length||list.some(p=>typeof p!=='string'||!(p==='*'||p===recordsFolder||durableRoots.includes(p)||durableFiles.includes(p))))throw new Error('Invalid sync configuration');
  return [...new Set(list)];
}

// Switches a mission control that is its own repository to carry the notebook
// in that repository. It checks first and changes nothing of the owner's: the
// repository must be private, on its branch, and already ignore what the
// notebook keeps on each machine (its state, its review copies). The knowledge
// repository an older version kept beside it is set aside, not deleted.
export async function useFolderRepository(store,paths,{branch='main',remote='origin'}={}){
  const list=folderPaths(paths?.length?paths:undefined),probe=new FileSync(store,{branch,remote});probe.folder={paths:list};probe.gitDir=null;
  probe.folderReady();
  const url=probe.git(['remote','get-url',remote]);await probe.verifyRemote(url);
  const local=['.godspeed/probe','conflicts/probe.json','FULL-ALPHA.md',...(probe.inScope('assistant-state/probe/x.json')?[]:['assistant-state/probe/x.json'])];
  const visible=local.filter(name=>{try{probe.git(['check-ignore','-q','--no-index',name]);return false;}catch{return true;}});
  if(visible.length)throw new Error('Add these to the ignore file of the repository first: '+visible.map(n=>n.split('/')[0]+(n.includes('/')?'/':'')).join(', '));
  const old=path.join(store.state,'sync.git');
  if(fs.existsSync(old))fs.renameSync(old,path.join(store.state,'retired-sync.git-'+new Date().toISOString().replace(/[:.]/g,'-')));
  const config={enabled:true,repository:'folder',paths:list};atomic(path.join(store.state,'sync-config.json'),JSON.stringify(config));
  return {...config,remote:url};
}

export class FileSync {
  constructor(store,{branch='main',remote='origin',largeFile=50*1024*1024}={}) {
    if(!/^[\w/.-]+$/.test(branch)||branch.startsWith('-')||!/^\w+$/.test(remote))throw new Error('Invalid sync configuration');
    this.store=store;this.branch=branch;this.remote=remote;this.largeFile=largeFile;this.last=null;
    // A mission control that is already its own repository, cloned to the
    // owner's machines, can carry the notebook in that same repository: one
    // folder (notebook/) committed by the notebook, everything else committed
    // by whoever owns it there (sessions, scheduled jobs, other machines). One
    // carrier means a file never reaches a machine twice by two routes.
    const config=readSyncConfig(store.state);
    this.folder=config?.repository==='folder'?{paths:folderPaths(config.paths)}:null;
    // Otherwise a folder that already belongs to its own repository keeps that
    // repository untouched. The knowledge repository then lives beside it in
    // the private state folder, with this folder as its work tree, so the
    // ignore file, the index and the remotes of the owner's repository are
    // never rewritten.
    const own=path.join(store.state,'sync.git');this.gitDir=!this.folder&&fs.existsSync(own)?own:null;
  }
  gitBytes(args,cwd=this.store.root,{env={},timeout=30000,input}={}){if(this.gitDir&&cwd===this.store.root)args=['--git-dir='+this.gitDir,'--work-tree='+this.store.root,...args];return execFileSync('git',args,{cwd,windowsHide:true,timeout,maxBuffer:256*1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never',...env},...(input===undefined?{stdio:['ignore','pipe','pipe']}:{input,stdio:['pipe','pipe','pipe']})});}
  git(args,cwd=this.store.root,options){return this.gitBytes(args,cwd,options).toString('utf8').trim();}
  // File names exactly as Git has them. Its line output quotes a name with an
  // umlaut or an emoji, and notes are named after their titles; `args` must
  // ask for -z.
  names(args,cwd=this.store.root,options){return this.gitBytes(args,cwd,options).toString('utf8').split('\0').filter(Boolean);}
  // A text merged line by line, or null when both sides changed the same lines.
  mergeText(base,local,remote){
    const dir=path.join(this.store.state,'sync-merge');fs.mkdirSync(dir,{recursive:true});
    const files=[['local',local],['base',base],['remote',remote]].map(([key,text])=>{const file=path.join(dir,key);fs.writeFileSync(file,text);return file;});
    try{return this.gitBytes(['merge-file','-p','-q',...files]).toString('utf8');}catch{return null;}
  }
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
    '**/*.zip\n**/*.tar\n**/*.gz\n**/*.tgz\n**/*.7z\n**/*.exe\n**/*.msi\n**/*.dmg\n**/*.iso\n**/*.mov\n**/*.webm\n**/*.wav\n**/*.m4a\n'+
    // A notebook page is named after its title, so a note called
    // "backup.sqlite" is backup.sqlite.md and must not be taken for a database.
    '!'+recordsFolder+'/**/[!.]*.md\n';}
  writeIgnoreFile(){
    // Beside an owner's repository the policy goes into the knowledge
    // repository's own exclude file; the folder's .gitignore is the owner's.
    const file=this.gitDir?path.join(this.gitDir,'info','exclude'):path.join(this.store.root,'.gitignore'),policy=this.ignoreText();
    const write=text=>{if(!fs.existsSync(file)||fs.readFileSync(file,'utf8')!==text)atomic(file,text);};
    write(policy);
    // An owner's folder holds whatever its owner keeps there. A single file too
    // large to upload stays on this machine instead of stopping every sync, and
    // the list is made against the policy alone so it never hides itself.
    if(this.gitDir){
      const escape=n=>'/'+n.replace(/[*?[\]\\]/g,'\\$&')+'\n';
      // What this machine keeps to itself: one path or pattern per line in
      // .godspeed/sync-local-only (trial installs, build copies, a login kept
      // for one task), and every checkout of another repository inside the
      // folder, which Git refuses to add and which stopped every sync on x30.
      const listFile=path.join(this.store.state,'sync-local-only'),own=fs.existsSync(listFile)?fs.readFileSync(listFile,'utf8').split(/\r?\n/).map(l=>l.trim()).filter(l=>l&&!l.startsWith('#')):[];
      const nested=this.nestedRepositories(),large=this.largeFiles();
      if(own.length||nested.length||large.length)write(policy+'# Kept on this machine\n'+own.map(l=>l+'\n').join('')+nested.map(n=>escape(n+'/')).join('')+large.map(escape).join(''));
    }
  }
  nestedRepositories(){
    const found=[],walk=relative=>{let entries;try{entries=fs.readdirSync(path.join(this.store.root,relative),{withFileTypes:true});}catch{return;}
      for(const entry of entries){if(!entry.isDirectory()||entry.name==='node_modules'||entry.name.startsWith('.'))continue;const child=relative+'/'+entry.name;
        if(fs.existsSync(path.join(this.store.root,child,'.git')))found.push(child);else walk(child);}};
    for(const root of durableRoots)if(fs.existsSync(path.join(this.store.root,root)))walk(root);
    return found;
  }
  largeFiles(){
    const roots=[...durableRoots,...durableFiles].filter(r=>fs.existsSync(path.join(this.store.root,r)));if(!roots.length)return [];
    return this.gitBytes(['ls-files','-z','--others','--exclude-standard','--',...roots]).toString('utf8').split('\0').filter(name=>{if(!name)return false;try{return fs.statSync(path.join(this.store.root,name)).size>this.largeFile;}catch{return false;}});
  }
  // Through the folder's own repository a saved conflict is already merged
  // (this machine's version stays, both wait for review), so it no longer
  // holds back the rest of the notebook.
  validate(){this.store.scan();if(this.store.problems.length)throw new Error('Resolve record validation problems before syncing');if(!this.folder||this.inScope('assistant-state/profile.json'))validateAssistantFiles(this.store.root);if(!this.folder&&this.pendingConflicts().length)throw new Error('Resolve saved conflicts before syncing');}
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
    const staged=this.names(['diff','--cached','--name-only','-z','--diff-filter=d']);
    if(staged.some(n=>!shared(n)&&n!=='.gitignore'))throw new Error('Sync repository contains staged files outside durable state');
    const roots=[...durableRoots.filter(r=>fs.existsSync(path.join(this.store.root,r))),...durableFiles.filter(r=>fs.existsSync(path.join(this.store.root,r))),...(this.gitDir?[]:['.gitignore'])];
    // Validation guards what a commit uploads. With nothing to commit there is
    // nothing to guard, and reading the whole vault to validate it anyway held
    // the workspace for a second of every idle round on an imported vault.
    if(!staged.length&&!this.git(['status','--porcelain','--untracked-files=all','--',...roots]))return false;
    this.validate();
    this.git(['add','--',...roots]);
    if(this.names(['diff','--cached','--name-only','-z','--diff-filter=d']).some(n=>!shared(n)&&n!=='.gitignore'))throw new Error('A private path was staged; sync stopped');
    if(this.git(['diff','--cached','--name-only']))this.git(['commit','-m','Save Godspeed Mission Control records']);
  }
  reconcile(){
    if(this.folder)return this.reconcileFolder();
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
      const remoteCommit=this.git(['rev-parse',remoteRef]);let merging=false;
      try { this.git(fastForward?['merge','--ff-only',remoteRef]:['merge','--no-edit','--no-ff','--no-commit',...(firstJoin?['--strategy=ort','-X','ours','-X','no-renames']:['--strategy=resolve']),'--allow-unrelated-histories',remoteRef],dir);merging=!fastForward; }
      catch(e) {if(!this.names(['diff','--name-only','-z','--diff-filter=U'],dir).length)throw e;merging=true;}
      // A record renamed or moved on either side is merged as one record
      // before any file of it is called a conflict (identity.mjs).
      if(merging&&!firstJoin){
        const plan=identityPlan({git:(args,options)=>this.gitBytes(args,dir,options),mergeText:(b,l,r)=>this.mergeText(b,l,r),find:(type,id)=>this.store.records.get(type+'/'+id),base:this.git(['merge-base',localHead,remoteCommit],dir),local:localHead,remote:remoteCommit});
        if(plan){
          for(const name of plan.deletes){fs.rmSync(path.join(dir,name),{force:true});this.git(['--literal-pathspecs','rm','--cached','--quiet','--ignore-unmatch','--',name],dir);}
          for(const [name,text] of plan.writes){atomic(path.join(dir,name),text);this.git(['--literal-pathspecs','add','--',name],dir);}
          for(const review of plan.reviews)atomic(path.join(this.store.root,'conflicts',review.id+'.json'),JSON.stringify(review,null,2));
        }
      }
      const conflicted=merging?this.names(['diff','--name-only','-z','--diff-filter=U'],dir):[];
      if(conflicted.length){
        const unresolved=[];
        for(const name of conflicted){
          // A path that no longer leaves this machine has no meaningful remote
          // side: what the remote carries is only what was uploaded before the
          // policy changed. Taking it out of the merge keeps this machine's own
          // copy and stops carrying it. Saving a conflict instead blocked every
          // later synchronization over a file nobody can review, and the next
          // merge wrote the conflict again, so clearing them never held.
          if(!shared(name)){this.git(['--literal-pathspecs','rm','--force','--quiet','--ignore-unmatch','--',name],dir);continue;}
          const stages=this.git(['--literal-pathspecs','ls-files','--stage','--',name],dir).split('\n').map(line=>Number(line.match(/^\d+ [a-f0-9]+ (\d)\t/)?.[1])).filter(Boolean);
          const read=stage=>stages.includes(stage)?this.gitBytes(['show',':'+stage+':'+name],dir):null;
          const id=hash(name).slice(0,24),saved=path.join(this.store.root,'conflicts',id+'.json');
          const previous=fs.existsSync(saved)?JSON.parse(fs.readFileSync(saved,'utf8')):null;
          if(previous?.resolved_at&&previous.remote_commit===remoteCommit){
            const live=path.resolve(this.store.root,name),target=path.resolve(dir,name);
            if(!shared(name)||!live.startsWith(this.store.root+path.sep)||!target.startsWith(dir+path.sep))throw new Error('Invalid conflict path');
            atomic(target,fs.readFileSync(live));this.git(['--literal-pathspecs','add','--',name],dir);continue;
          }
          const versions={base:read(1),local:read(2),remote:read(3)},binary=Object.values(versions).some(v=>v&&(v.includes(0)||!Buffer.from(v.toString('utf8')).equals(v)));
          const conflict={id,path:name,kind:'git',...(binary?{encoding:'base64',digests:Object.fromEntries(Object.entries(versions).map(([key,v])=>[key,v&&hash(v)]))}:{}),...Object.fromEntries(Object.entries(versions).map(([key,v])=>[key,v===null?null:v.toString(binary?'base64':'utf8')])),remote_commit:remoteCommit,at:new Date().toISOString()};
          atomic(path.join(this.store.root,'conflicts',id+'.json'),JSON.stringify(conflict,null,2));
          unresolved.push(name);
        }
        if(unresolved.length)throw new Error('Concurrent edits were preserved for review');
      }
      if(merging)this.git(['commit','--no-edit'],dir);
      const merged=new Store(dir);
      validateAssistantFiles(dir);
      if(merged.problems.length)throw new Error('The merged reference graph needs review');
      const removed=[...this.store.records.keys()].filter(key=>!merged.records.has(key));
      if(removed.some(key=>![...merged.records.values()].some(r=>r.uid===this.store.records.get(key).uid&&(r.aliases||[]).includes(this.store.records.get(key).id))))throw new Error('Remote removal without a tombstone or proven rename needs review: '+removed.join(', '));
      // A record is brought in where the merge put it, so a rename on another
      // machine renames the file here, and every machine names it the same.
      const inside=(store,file)=>path.relative(store.recordsRoot,file).split(path.sep).join('/'),recordFiles=store=>new Set([...store.fileOf.values()].map(file=>path.relative(store.root,file).split(path.sep).join('/')));
      const localRecords=recordFiles(this.store),mergedRecords=recordFiles(merged),paths=new Map();
      const batch=[...merged.records.entries()].filter(([key,r])=>{
        const mine=this.store.records.get(key),at=inside(merged,merged.fileOf.get(key));paths.set(key,at);
        return mine?._hash!==r._hash||!this.store.fileOf.has(key)||inside(this.store,this.store.fileOf.get(key))!==at;
      }).map(([,r])=>{const value={...r};delete value._hash;return value;});
      if(batch.length||removed.length)this.store.commit(batch,{removeKeys:removed,paths:new Map(batch.map(r=>[r.type+'/'+r.id,paths.get(r.type+'/'+r.id)]))});
      // Everything else is a document: the owner's files, and pages in the
      // notebook folder that are not records.
      const documents=this.names(['ls-files','-z'],dir).filter(n=>shared(n)&&!mergedRecords.has(n)).map(file=>({file,text:fs.readFileSync(path.join(dir,file))})).filter(item=>!fs.existsSync(path.join(this.store.root,item.file))||!fs.readFileSync(path.join(this.store.root,item.file)).equals(item.text));
      // A document another machine deleted is deleted here too, when this
      // machine still holds exactly the version both last agreed on. Before,
      // only records carried removals: a deleted rule or skill stayed on every
      // other machine, and the next upload from any of them put it back. A
      // file changed here meanwhile is a modify/delete conflict above instead.
      const gone=this.names(['diff','--name-only','-z','--no-renames','--diff-filter=D',localHead,'HEAD'],dir).filter(n=>shared(n)&&!localRecords.has(n)&&!mergedRecords.has(n)&&fs.existsSync(path.join(this.store.root,n)))
        .filter(n=>this.git(['hash-object','--',n])===this.git(['rev-parse',localHead+':'+n]));
      const tracked=this.names(['ls-files','-z'],dir).filter(n=>shared(n)&&!mergedRecords.has(n)).length;
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

  // ---- Through the folder's own repository --------------------------------
  // The repository belongs to its owner: sessions commit and pull in it,
  // scheduled jobs pull with --rebase, other machines push to it. The notebook
  // is one more user of it with one rule: it commits only its own paths and
  // never rewrites what anyone else wrote. It never edits the ignore file, the
  // owner's config or the hooks, never stages anything else and never rebases;
  // it merges, and a merge it cannot settle inside its own paths is left to Git
  // and to the owner.
  inScope(name){
    // A notebook page is always the notebook's, whatever its title ends in:
    // a note called "backup.sqlite" is backup.sqlite.md.
    const page=name.startsWith(recordsFolder+'/')&&name.endsWith('.md');
    if(!shared(name)||(!page&&keptLocal.some(ext=>new RegExp('\\.'+ext.replace('*','.*')+'$','i').test(name))))return false;
    const paths=this.folder.paths;return paths.includes('*')||paths.some(p=>name===p||name.startsWith(p+'/'));
  }
  scopeRoots(){return this.folder.paths.includes('*')?[...durableRoots,...durableFiles]:this.folder.paths;}
  // Git's own hooks belong to the owner's commits and pushes from a person:
  // the notebook's commits must not start the owner's post-commit jobs. Its
  // push still runs the owner's pre-push gate.
  quiet(){const dir=path.join(this.store.state,'no-hooks');fs.mkdirSync(dir,{recursive:true});return ['-c','core.hooksPath='+dir];}
  identity(){return {GIT_AUTHOR_NAME:'Godspeed Mission Control',GIT_AUTHOR_EMAIL:'godspeed@localhost',GIT_COMMITTER_NAME:'Godspeed Mission Control',GIT_COMMITTER_EMAIL:'godspeed@localhost'};}
  // Another program may be in the middle of something with this repository.
  // The notebook waits for the next round instead of acting on half a merge.
  folderReady(){
    if(!fs.existsSync(path.join(this.store.root,'.git')))throw new Error('This folder has no repository of its own');
    const gitDir=this.git(['rev-parse','--absolute-git-dir']);
    const busy=['MERGE_HEAD','rebase-merge','rebase-apply','CHERRY_PICK_HEAD','REVERT_HEAD','BISECT_LOG','index.lock'].find(name=>fs.existsSync(path.join(gitDir,name)));
    if(busy)throw Object.assign(new Error('Git is busy in this folder ('+busy+'); the notebook syncs on the next round'),{code:'GIT_BUSY'});
    let branch;try{branch=this.git(['symbolic-ref','--quiet','--short','HEAD']);}catch{branch='';}
    if(branch!==this.branch)throw new Error('This folder is not on its '+this.branch+' branch; the notebook syncs only there');
  }
  // What changed in the notebook's own paths since its last commit.
  folderChanges(){
    const out=this.gitBytes(['--no-optional-locks','--literal-pathspecs','status','--porcelain','-z','--no-renames','--untracked-files=all','--ignore-submodules=all','--',...this.scopeRoots()]).toString('utf8');
    return out.split('\0').filter(Boolean).map(entry=>({code:entry.slice(0,2),name:entry.slice(3)}))
      .filter(({code,name})=>!name.endsWith('/')&&this.inScope(name)&&(code.includes('D')||(()=>{try{return fs.statSync(path.join(this.store.root,name)).size<=this.largeFile;}catch{return false;}})()))
      .map(({name})=>name);
  }
  // A partial commit of exactly these paths: whatever the owner has staged for
  // other paths stays staged and out of this commit.
  commitFolder(){
    const files=this.folderChanges();if(!files.length)return false;
    this.validate();
    const list=path.join(this.store.state,'sync-paths');atomic(list,files.join('\0')+'\0');
    const options={env:this.identity(),timeout:120000};
    this.git([...this.quiet(),'--literal-pathspecs','add','-A','--pathspec-from-file='+list,'--pathspec-file-nul'],undefined,options);
    try{this.git([...this.quiet(),'--literal-pathspecs','commit','--only','--no-status','-m','Save notebook records','--pathspec-from-file='+list,'--pathspec-file-nul'],undefined,options);}
    // Another commit (a session's) may have taken these paths first.
    catch(error){if(this.folderChanges().length)throw error;}
    return true;
  }
  // Brings in what the other machines pushed. When only they moved, the folder
  // fast-forwards to their commit. When both moved, the merge is built in an
  // index of its own, without touching this folder, and the folder then
  // fast-forwards to that merge. Git refuses the fast-forward when it would
  // overwrite a file the owner is still editing, so nothing unsaved is lost:
  // the notebook tries again on the next round.
  integrateFolder(remoteRef){
    const head=this.git(['rev-parse','HEAD']),remoteHead=this.git(['rev-parse',remoteRef]);
    if(head===remoteHead||this.contains(remoteHead,head))return null;
    let target=remoteHead,reviews=[];
    if(!this.contains(head,remoteHead))({commit:target,reviews}=this.mergeFolder(head,remoteHead));
    this.guardRemovals(head,target);
    try{this.git([...this.quiet(),'merge','--ff-only','--no-stat','-q',target],undefined,{timeout:300000});}
    catch(error){throw new Error('Waiting for local changes to be saved before the notebook can bring in the other machines\' edits: '+String(error.stderr||error.message).split('\n').filter(l=>/^\s+\S/.test(l)).map(l=>l.trim()).slice(0,3).join(', '));}
    for(const review of reviews)atomic(path.join(this.store.root,'conflicts',review.id+'.json'),JSON.stringify(review,null,2));
    this.store.scan(true);
    return target;
  }
  // A whole folder of records disappearing at once is a mistake somewhere,
  // not an edit. Git keeps them either way; the notebook does not apply it.
  // A record that moved (a rename, a new folder, the conversion to readable
  // files) is still there: only what is gone from every path counts.
  guardRemovals(head,target){
    const gone=this.names(['diff','--name-only','-z','--no-renames','--diff-filter=D',head,target,'--',recordsFolder]);
    if(gone.length<=25)return;
    const git=(args,options)=>this.gitBytes(args,undefined,options),kept=new Set(identities(git,target,this.names(['diff','--name-only','-z','--no-renames','--diff-filter=AM',head,target,'--',recordsFolder])));
    const removed=identities(git,head,gone).filter(id=>!kept.has(id)).length;
    if(removed<=25)return;
    const total=this.names(['ls-tree','-r','-z','--name-only',head,'--',recordsFolder]).length;
    if(removed*5>total)throw new Error('Removal of '+removed+' notebook records needs review');
  }
  mergeFolder(head,remoteHead){
    let base;try{base=this.git(['merge-base',head,remoteHead]);}catch{throw new Error('This folder and the shared repository have no history in common');}
    const index=path.join(this.store.state,'sync-merge-index'),env={GIT_INDEX_FILE:index};fs.rmSync(index,{force:true});
    try{
      this.git(['read-tree','-m','-i','--aggressive',base,head,remoteHead],undefined,{env,timeout:120000});
      // A record renamed or moved on either side is merged as one record
      // before its files are merged one by one (identity.mjs).
      const plan=identityPlan({git:(args,options)=>this.gitBytes(args,undefined,options),mergeText:(b,l,r)=>this.mergeText(b,l,r),find:(type,id)=>this.store.records.get(type+'/'+id),base,local:head,remote:remoteHead});
      const planned=new Set(plan?[...plan.writes.keys(),...plan.deletes]:[]);
      const entries=new Map();
      for(const line of this.gitBytes(['ls-files','-u','-z'],undefined,{env}).toString('utf8').split('\0').filter(Boolean)){
        const [, mode,oid,stage,name]=line.match(/^(\d+) ([0-9a-f]+) (\d)\t([\s\S]+)$/);
        if(!entries.has(name))entries.set(name,{});entries.get(name)[stage]={mode,oid};
      }
      const reviews=[...(plan?.reviews||[])];
      for(const [name,stages] of entries){
        if(planned.has(name))continue;
        const resolved=this.settle(name,stages,remoteHead,reviews);
        this.git(['update-index','--force-remove','--',name],undefined,{env});
        if(resolved)this.git(['update-index','--add','--cacheinfo',resolved.mode+','+resolved.oid+','+name],undefined,{env});
      }
      for(const name of planned)this.git(['update-index','--force-remove','--',name],undefined,{env});
      for(const [name,text] of plan?.writes||[]){const oid=this.git(['hash-object','-w','--stdin'],undefined,{input:text});this.git(['update-index','--add','--cacheinfo','100644,'+oid+','+name],undefined,{env});}
      const tree=this.git(['write-tree'],undefined,{env});
      const commit=this.git(['commit-tree',tree,'-p',head,'-p',remoteHead,'-m','Merge the other machines\' notebook records'],undefined,{env:this.identity()});
      return {commit,reviews};
    }finally{fs.rmSync(index,{force:true});}
  }
  // One path both sides changed. A clean line merge is taken as Git would take
  // it. Otherwise, inside the notebook's own paths, this machine's version
  // stays (or the surviving one, when the other side deleted it) and both
  // versions are kept for review, never conflict markers in a note. Outside
  // them the owner's files are not the notebook's to settle, and the whole
  // merge waits for Git.
  settle(name,{1:base,2:local,3:remote},remoteHead,reviews){
    const blob=entry=>entry?this.gitBytes(['cat-file','blob',entry.oid]):null;
    if(local&&remote&&local.oid===remote.oid)return {mode:local.mode!==(base?.mode)?local.mode:remote.mode,oid:local.oid};
    if(!local&&!remote)return null;
    const versions={base:blob(base),local:blob(local),remote:blob(remote)},binary=Object.values(versions).some(v=>v&&v.includes(0));
    if(local&&remote&&!binary){
      const dir=path.join(this.store.state,'sync-merge');fs.mkdirSync(dir,{recursive:true});
      const files=['local','base','remote'].map(key=>{const file=path.join(dir,key);fs.writeFileSync(file,versions[key]||'');return file;});
      let merged=null;try{merged=this.gitBytes(['merge-file','-p','-q',...files]);}catch{}
      // A record must still read as one after the line merge; a page in the
      // notebook folder that is not a record merges like any file.
      const record=text=>{try{decode(text.toString('utf8'),name);return true;}catch{return false;}};
      if(merged!==null&&(!isRecordPath(name)||record(merged)||![versions.local,versions.remote].some(v=>v&&record(v)))){
        fs.writeFileSync(files[1],merged);return {mode:local.mode,oid:this.git(['hash-object','-w','--no-filters',files[1]])};
      }
    }
    if(!this.inScope(name))throw Object.assign(new Error('Files outside the notebook changed on this machine and on another ('+name+'); Git has to settle them first'),{code:'OWNER_CONFLICT'});
    const kept=local?'local':'remote',encoding=binary||Object.values(versions).some(v=>v&&!Buffer.from(v.toString('utf8')).equals(v))?'base64':'utf8';
    reviews.push({id:hash(name+' '+remoteHead).slice(0,24),path:name,kind:'git',kept,...(encoding==='base64'?{encoding,digests:Object.fromEntries(Object.entries(versions).map(([key,v])=>[key,v&&hash(v)]))}:{}),
      ...Object.fromEntries(Object.entries(versions).map(([key,v])=>[key,v===null?null:v.toString(encoding)])),remote_commit:remoteHead,at:new Date().toISOString()});
    return local||remote;
  }
  reconcileFolder(){
    try{
      this.folderReady();
      let networkError=null;
      try{this.git(['fetch','--no-tags',this.remote,this.branch],undefined,{timeout:120000});}catch(error){networkError=error;}
      this.store.withLock(()=>{this.folderReady();this.commitFolder();if(!networkError)this.integrateFolder(this.remote+'/'+this.branch);});
      if(networkError)throw networkError;
      // Upload only what the other side lacks. Whatever else this folder holds
      // unpushed (the owner's own commits) goes with it, through the owner's
      // own push checks.
      const head=this.git(['rev-parse','HEAD']),remoteHead=this.git(['rev-parse',this.remote+'/'+this.branch]);
      if(head!==remoteHead&&this.contains(remoteHead,head))this.git(['push',this.remote,'HEAD:refs/heads/'+this.branch],undefined,{timeout:600000});
      const pending=this.folderChanges().length;
      this.last={state:pending?'pending':'synced',at:new Date().toISOString(),pending,...(pending?{detail:'New local edits will upload on the next synchronization cycle.'}:{})};
    }catch(error){this.last={state:'pending',at:new Date().toISOString(),error:'Sync did not complete; local files remain available',detail:error.message==='Workspace is being written by another process'?'The assistant is saving its state.':String(error.message).split('\n')[0]};}
    atomic(path.join(this.store.state,'sync-status.json'),JSON.stringify(this.last,null,2));return this.last;
  }
}
