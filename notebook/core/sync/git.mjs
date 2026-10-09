import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Store, atomic, decode, encode, hash, identityIds } from '../records/store.mjs';
import { identityPlan, identities, readBlobs } from './identity.mjs';
import { shared,durableRoots,durableFiles,devicePrivatePaths,recordsFolder,isRecordPath,deletableTypes,windowsInvalid } from '../file-policy.mjs';
import { candidate, key as nameKey } from '../records/layout.mjs';
import {validateAssistantFiles} from '../assistant-files.mjs';
import {resolveSavedConflict} from '../conflicts.mjs';

// What sync never puts in a repository, whichever repository it is: build
// output, archives, recordings, pictures and the disposable SQLite indexes.
const keptLocal=['sqlite*','png','jpg','mp4','mp3','pdf','zip','tar','gz','tgz','7z','exe','msi','dmg','iso','mov','webm','wav','m4a','tmp'];
export function readSyncConfig(state){try{return JSON.parse(fs.readFileSync(path.join(state,'sync-config.json'),'utf8'));}catch{return null;}}
export const folderModeRefusal='This notebook already syncs through the folder\'s own repository, so a separate repository cannot be connected here';
const posix=file=>file.split(path.sep).join('/');
const readJson=file=>{try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}};
// One path kept for review in conflicts/ (conflicts.mjs): base, local and
// remote as they were, as text unless one of them is binary.
function reviewItem(id,name,versions,remoteCommit,extra={}){
  const bytes=Object.fromEntries(Object.entries(versions).map(([key,v])=>[key,v===null||v===undefined?null:Buffer.isBuffer(v)?v:Buffer.from(v)]));
  const binary=Object.values(bytes).some(v=>v&&(v.includes(0)||!Buffer.from(v.toString('utf8')).equals(v)));
  return {id,path:name,kind:'git',...extra,...(binary?{encoding:'base64',digests:Object.fromEntries(Object.entries(bytes).map(([key,v])=>[key,v&&hash(v)]))}:{}),
    ...Object.fromEntries(Object.entries(bytes).map(([key,v])=>[key,v===null?null:v.toString(binary?'base64':'utf8')])),remote_commit:remoteCommit,at:new Date().toISOString()};
}
// Many records of one kind leaving at once is a mistake somewhere (a bulk
// delete by hand, a program gone wrong), not an edit: more than 25 of one type
// that are also more than a fifth of that type's live records. Until 6 October
// 2026 the folder guard divided by every file under notebook/, history
// snapshots included, so all 40 notes of a notebook holding 160 snapshots went
// on the other machine, and nothing guarded a removal on its way out. Until 7
// October 2026 only the pages a person reads counted, so forty memberships or
// settings went unguarded; now the notebook's own records count too, all but
// the bookkeeping a machine prunes (deletableTypes).
const counted=r=>!r.removed_at&&!deletableTypes.has(r.type)&&!(r.type==='contacts'&&r.merged_into);
const liveCounts=records=>{const counts=new Map();for(const r of records)if(counted(r))counts.set(r.type,(counts.get(r.type)||0)+1);return counts;};
function tooManyRemoved(removed,live){
  for(const [type,n] of liveCounts(removed))if(n>25&&n*5>(live.get(type)||0))return 'Removal of '+n+' notebook records ('+type+') at once needs review';
  return null;
}
// Whether any Git runs on this machine. A lock file is taken from a Git only
// when none does, so a lock a running Git holds (the owner's, an editor's)
// is never taken from it. When it cannot be told, one may be running.
function gitRunning(){
  try{
    if(process.platform==='win32')return /git\.exe/i.test(execFileSync('tasklist',['/FI','IMAGENAME eq git.exe','/FO','CSV','/NH'],{windowsHide:true,encoding:'utf8',timeout:15000}));
    if(fs.existsSync('/proc/self/comm'))return fs.readdirSync('/proc').some(pid=>{if(!/^\d+$/.test(pid))return false;try{return /^git(-|$)/.test(fs.readFileSync('/proc/'+pid+'/comm','utf8').trim());}catch{return false;}});
    return execFileSync('ps',['-A','-o','comm='],{encoding:'utf8',timeout:15000}).split('\n').some(line=>/(^|\/)git(-|$)/.test(line.trim()));
  }catch{return true;}
}
// A lock this old with no Git running is one a killed Git left behind.
const staleLockAge=15*60*1000;
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
  // The notebook commits a page an ignore rule happens to match (a title like
  // "id_rsa rotation"), but a rule that hides pages as such is a mistake.
  const hidden=['Page.md','Projects/Page.md','_system/notes/page.md','_system/jobs/job.json'].map(n=>recordsFolder+'/'+n).filter(name=>{try{probe.git(['check-ignore','-q','--no-index',name]);return true;}catch{return false;}});
  if(hidden.length)throw new Error('The ignore file of the repository hides notebook pages ('+hidden[0]+'); stop ignoring them first');
  const endings=probe.lineEndingProblem();if(endings)throw new Error(endings);
  const old=path.join(store.state,'sync.git');
  if(fs.existsSync(old))fs.renameSync(old,path.join(store.state,'retired-sync.git-'+new Date().toISOString().replace(/[:.]/g,'-')));
  const config={enabled:true,repository:'folder',paths:list};atomic(path.join(store.state,'sync-config.json'),JSON.stringify(config));
  return {...config,remote:url};
}

// The installers' join (`godspeed sync folder` with no paths), run once when a
// computer was set up from a mission control that is already on GitHub. Two
// kinds of repository arrive here. An owner's own mission control repository
// tracks its programs and settings beside the notebook, and sessions and jobs
// commit there (envy and x30, D-288 and D-289): it carries the notebook in
// folder mode, which commits only notebook/. A copy a notebook made through
// Settings (Connect record sync), on the server or on a first computer, tracks
// nothing but what that connection syncs, and nothing else commits all of it.
// Until 8 October 2026 the installer joined that copy in folder mode too: it
// was refused, because its ignore file lets FULL-ALPHA.md and assistant-state/
// through (Settings syncs them), and had it passed, this computer would have
// sent nothing but notebook/. Such a copy is now connected the way Settings
// connects it, with the same full list.
export async function joinRepository(store,options={}){
  const probe=new FileSync(store,options);
  if(!fs.existsSync(path.join(store.root,'.git')))throw new Error('This folder has no repository of its own');
  if(probe.folder||probe.gitDir||probe.foreignRepository())return useFolderRepository(store,undefined,options);
  probe.folderReady();
  // The address as the clone was given it, before any rewriting Git's settings ask for.
  const url=probe.git(['config','--get','remote.'+probe.remote+'.url']);await probe.verifyRemote(url);
  probe.initialize(url);probe.lineEndingsAsCommitted();
  const config={enabled:true};atomic(path.join(store.state,'sync-config.json'),JSON.stringify(config));
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
    this.gitRunning=gitRunning;
  }
  // Notes are named after their titles, so a long title in a deep folder can
  // pass Windows' 260-character path limit, which Git for Windows refuses
  // unless told otherwise. Node writes such a file fine; without this, sync
  // would stop at it on Windows only.
  gitBytes(args,cwd=this.store.root,{env={},timeout=30000,input}={}){if(this.gitDir&&cwd===this.store.root)args=['--git-dir='+this.gitDir,'--work-tree='+this.store.root,...args];if(process.platform==='win32')args=['-c','core.longpaths=true',...args];return execFileSync('git',args,{cwd,windowsHide:true,timeout,maxBuffer:256*1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GCM_INTERACTIVE:'Never',...env},...(input===undefined?{stdio:['ignore','pipe','pipe']}:{input,stdio:['pipe','pipe','pipe']})});}
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
  // A conflict file that does not read is still waiting (and shown as damaged): it never throws the list away.
  pendingConflicts(){const dir=path.join(this.store.root,'conflicts');return fs.existsSync(dir)?fs.readdirSync(dir).filter(n=>{if(!n.endsWith('.json'))return false;try{return !JSON.parse(fs.readFileSync(path.join(dir,n),'utf8')).resolved_at;}catch{return true;}}):[];}
  async verifyRemote(remoteUrl){
    const match=String(remoteUrl).match(/^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);if(!match)throw new Error('Use a GitHub repository address without embedded credentials');
    const response=await fetch('https://api.github.com/repos/'+match[1]+'/'+match[2],{headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(15000)});
    if(response.status===200)throw new Error('This repository is publicly readable. Choose a private repository for your knowledge');if(response.status!==404)throw new Error('Repository privacy could not be verified; no files were uploaded');
    try{this.git(['ls-remote',remoteUrl]);}catch{throw new Error('The private repository could not be read with this device Git credentials; no files were uploaded');}
  }
  initialize(remoteUrl) {
    // Connecting a knowledge repository replaced the folder setting with
    // {"enabled":true} and wrote its ignore file over the owner's.
    if(this.folder)throw new Error(folderModeRefusal);
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
  // A copy cloned while Git wrote Windows line endings (Git for Windows ships
  // core.autocrlf=true, and the installer clones before anything is set) has
  // every text file on disk with CRLF while the repository holds LF. Once
  // connected, this folder reads files as they are (initialize), and a
  // document the other machines changed then met a local copy that differed
  // only in its line endings: kept for review as an edit made here, never
  // taken. Each tracked file that differs from what is committed in nothing
  // but that is given back exactly as committed, once, when the folder joins.
  lineEndingsAsCommitted(){
    const entries=this.names(['ls-files','-s','-z']).map(line=>line.match(/^100(?:644|755) ([0-9a-f]+) 0\t([\s\S]+)$/)).filter(m=>m&&shared(m[2]));
    if(!entries.length)return 0;
    const blobs=readBlobs((args,options)=>this.gitBytes(args,undefined,options),entries.map(m=>m[1]));let restored=0;
    entries.forEach((m,i)=>{
      const blob=blobs[i],file=path.join(this.store.root,...m[2].split('/'));let now;try{now=fs.readFileSync(file);}catch{return;}
      if(!blob||now.equals(blob)||!now.includes(13))return;
      if(Buffer.from(now.toString('latin1').replace(/\r\n/g,'\n'),'latin1').equals(blob)){atomic(file,blob);restored++;}
    });
    // Git's record of each file it checked out is brought up to date, so it
    // does not read the files it was given back as changed.
    if(restored)try{this.git(['update-index','-q','--refresh']);}catch{}
    return restored;
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
      // for one task), and every checkout of another repository and every
      // link inside the folder (keptHere), which stopped every sync on x30.
      const listFile=path.join(this.store.state,'sync-local-only'),own=fs.existsSync(listFile)?fs.readFileSync(listFile,'utf8').split(/\r?\n/).map(l=>l.trim()).filter(l=>l&&!l.startsWith('#')):[];
      const nested=this.keptHere(),large=this.largeFiles();
      if(own.length||nested.length||large.length)write(policy+'# Kept on this machine\n'+own.map(l=>l+'\n').join('')+nested.map(escape).join('')+large.map(escape).join(''));
    }
  }
  // Files too large to upload, inside the notebook's own paths. Folder mode
  // leaves them out of its change set; in plain knowledge mode the committed
  // .gitignore un-ignores whole durable roots (!work/**), and that negation
  // outranks .git/info/exclude, so a per-file ignore cannot hold one back. They
  // are excluded from `git add` by pathspec and from the pending count instead,
  // so one oversized local export stays here and no longer blocks every push
  // for good (SY10, 7 October 2026). gitDir mode already keeps them out by ignore.
  heavyLocalFiles(){return this.gitDir?[]:this.largeFiles();}
  // Checkouts of other repositories (a skill cloned into skills/) and links
  // inside the synced folders. Neither is a document: Git carried a checkout
  // as a gitlink, an empty folder on every other machine, and a link as the
  // name it points to, and a merge that brought either read it as a file and
  // stopped sync for good with EISDIR (7 October 2026). They stay on this
  // machine: never added, never counted as waiting (keptLocal), untracked
  // when an older version committed one (untrackSpecial). Beside an owner's
  // repository they go into the exclude file; this walk is for that file.
  keptHere(){
    const found=[],at=relative=>path.join(this.store.root,...relative.split('/')),walk=relative=>{let entries;try{entries=fs.readdirSync(at(relative),{withFileTypes:true});}catch{return;}
      for(const entry of entries){const child=relative+'/'+entry.name;
        if(entry.isSymbolicLink()){found.push(child);continue;}
        if(!entry.isDirectory()||entry.name==='node_modules'||entry.name.startsWith('.'))continue;
        if(fs.existsSync(path.join(at(child),'.git')))found.push(child);else walk(child);}};
    for(const root of durableRoots){let stat=null;try{stat=fs.lstatSync(at(root));}catch{}if(stat?.isSymbolicLink())found.push(root);else if(stat?.isDirectory())walk(root);}
    return found;
  }
  // Whether a file Git does not track yet stays here: one named what Windows
  // cannot hold (it would stop every Windows machine's sync), a checkout of
  // another repository, which Git lists as one folder ("skills/x/"), or a link.
  keptLocal(name){if(windowsInvalid(name.replace(/\/$/,'')))return true;if(this.gitDir)return false;if(name.endsWith('/'))return true;try{return fs.lstatSync(path.join(this.store.root,...name.split('/'))).isSymbolicLink();}catch{return false;}}
  // A gitlink, a link or a name Windows cannot hold that an older version
  // committed is carried no more; the file stays here. Only a commit brings
  // one, so this looks once per run and after each merge.
  untrackSpecial(roots){
    if(this.specialChecked||!roots.length)return 0;
    const special=this.names(['--literal-pathspecs','ls-files','-s','-z','--',...roots]).map(line=>line.match(/^(\d+) [0-9a-f]+ \d\t([\s\S]+)$/)).filter(m=>m&&(['160000','120000'].includes(m[1])||windowsInvalid(m[2]))).map(m=>m[2]);
    for(let i=0;i<special.length;i+=200)this.git(['-c','core.protectNTFS=false','--literal-pathspecs','rm','--cached','--quiet','--',...special.slice(i,i+200)]);
    this.specialChecked=true;return special.length;
  }
  // The regular files of the tree checked out at `cwd`: a merge's gitlink
  // (an empty folder) or link is not a document to bring in.
  blobFiles(cwd){return this.names(['ls-files','-s','-z'],cwd).map(line=>line.match(/^100(?:644|755) [0-9a-f]+ \d\t([\s\S]+)$/)?.[1]).filter(Boolean);}
  largeFiles(){
    const roots=[...durableRoots,...durableFiles].filter(r=>fs.existsSync(path.join(this.store.root,r)));if(!roots.length)return [];
    return this.gitBytes(['ls-files','-z','--others','--exclude-standard','--',...roots]).toString('utf8').split('\0').filter(name=>{if(!name)return false;try{return fs.statSync(path.join(this.store.root,name)).size>this.largeFile;}catch{return false;}});
  }
  // Through the folder's own repository a saved conflict is already merged
  // (this machine's version stays, both wait for review), so it no longer
  // holds back the rest of the notebook.
  // A save that could not finish and was set aside (store.mjs setAside) is kept for the
  // owner to look at, but every record on disk is whole: it is listed, and does not hold
  // back every other note's sync until someone marks it reviewed.
  validate(){this.store.scan();if(this.store.problems.some(p=>!p.set_aside))throw new Error('Resolve record validation problems before syncing');if(!this.folder||this.inScope('assistant-state/profile.json'))validateAssistantFiles(this.store.root);if(!this.folder&&this.pendingConflicts().length)throw new Error('Resolve saved conflicts before syncing');}
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
    const untracked=this.untrackSpecial(roots.filter(r=>r!=='.gitignore')),heavy=new Set(this.heavyLocalFiles());
    const changes=this.names(['status','--porcelain','-z','--no-renames','--untracked-files=all','--',...roots]),kept=changes.filter(e=>e.startsWith('?? ')).map(e=>e.slice(3)).filter(name=>this.keptLocal(name));
    // Validation guards what a commit uploads. With nothing to commit there is
    // nothing to guard, and reading the whole vault to validate it anyway held
    // the workspace for a second of every idle round on an imported vault.
    if(!staged.length&&!untracked&&!changes.map(e=>e.slice(3)).some(name=>!heavy.has(name)&&!kept.includes(name)))return false;
    this.removalsAsTombstones();
    this.validate();
    // On a file system that ignores case, `git add` files a page whose title
    // changed only in case (Original to ORIGINAL) under the name it already
    // tracks, so the rename never left this machine. Its old entry goes first.
    const respelled=this.respelled(this.names(['--literal-pathspecs','diff','--name-only','-z','--no-renames','--diff-filter=M','--',recordsFolder]));
    for(let i=0;i<respelled.length;i+=200)this.git(['--literal-pathspecs','rm','--cached','--quiet','--',...respelled.slice(i,i+200).map(([old])=>old)]);
    this.git(['add','--',...roots,...[...heavy,...kept].map(name=>':(exclude,literal)'+name.replace(/\/$/,''))]);
    if(this.names(['diff','--cached','--name-only','-z','--diff-filter=d']).some(n=>!shared(n)&&n!=='.gitignore'))throw new Error('A private path was staged; sync stopped');
    if(this.git(['diff','--cached','--name-only']))this.git(['commit','-m','Save Godspeed Mission Control records'],undefined,{env:this.identity(),timeout:120000});
  }
  // A page deleted by hand (in Obsidian, or any editor) left the record's file
  // gone without the tombstone the other machines need, and each of them then
  // refused that removal for good (6 October 2026). The record is kept as a
  // tombstone, as the notebook's remove keeps one, so a reference to it stays
  // valid and the removal reaches every machine. A record moved or renamed by
  // hand is still there, and many at once are stopped instead.
  removalsAsTombstones(){
    let gone;try{gone=this.names(['--literal-pathspecs','diff','--name-only','-z','--no-renames','--diff-filter=D','HEAD','--',recordsFolder]);}catch{return;}
    if(!gone.length)return;
    this.store.scan();
    const records=this.decodedAt('HEAD',gone).filter(r=>!this.store.keyOfUid.has(r.uid)&&!deletableTypes.has(r.type));
    if(!records.length)return;
    const live=liveCounts(this.store.records.values());for(const [type,n] of liveCounts(records))live.set(type,(live.get(type)||0)+n);
    const many=tooManyRemoved(records,live);if(many)throw new Error(many+'; nothing was uploaded. Restore the files, or remove the records in the notebook');
    const at=new Date().toISOString();
    this.store.commit(records.map(r=>this.store.prepare(r.type,{removed_at:r.removed_at||at},r)));
  }
  // The records the files hold at `commit`; files that hold none are left out.
  decodedAt(commit,files){
    return readBlobs((args,options)=>this.gitBytes(args,undefined,options),files.map(name=>commit+':'+name)).map((bytes,i)=>{if(!bytes)return null;try{return decode(bytes.toString('utf8'),files[i]);}catch{return null;}}).filter(Boolean);
  }
  // [name Git has, name on disk] for each notebook page whose file name on
  // disk differs from Git's only in letter case. A folder keeps the spelling
  // Git has, as the store keeps the spelling a folder already has.
  respelled(names){
    const listing=new Map(),entries=dir=>{if(!listing.has(dir)){let list=[];try{list=fs.readdirSync(path.join(this.store.root,...dir.split('/').filter(Boolean)));}catch{}listing.set(dir,list);}return listing.get(dir);};
    return names.filter(isRecordPath).map(name=>{
      const parts=name.split('/'),out=[];
      for(const part of parts){const list=entries(out.join('/')),found=list.includes(part)?part:list.find(e=>nameKey(e)===nameKey(part));if(!found)return null;out.push(found);}
      const file=out.at(-1);return file.normalize('NFC')!==parts.at(-1).normalize('NFC')?[name,[...parts.slice(0,-1),file].join('/')]:null;
    }).filter(Boolean);
  }
  // Git's lock files left behind by a Git that was killed (a shutdown that
  // could not wait, a crash): the index, HEAD, the packed refs and this
  // branch's refs. Each one kept sync waiting for good.
  staleLocks(gitDir){
    const age=file=>{try{return Date.now()-fs.statSync(file).mtimeMs;}catch{return -1;}};
    const old=['index.lock','HEAD.lock','packed-refs.lock','refs/heads/'+this.branch+'.lock','refs/remotes/'+this.remote+'/'+this.branch+'.lock'].map(n=>path.join(gitDir,...n.split('/'))).filter(file=>age(file)>staleLockAge);
    if(!old.length||this.gitRunning())return;
    for(const file of old)if(age(file)>staleLockAge)try{fs.unlinkSync(file);}catch{}
  }
  reconcile(){
    if(this.folder)return this.reconcileFolder();
    try{
        this.staleLocks(this.gitDir||path.join(this.store.root,'.git'));
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
            this.integrate(remoteRef,{fastForward});integrated=true;this.specialChecked=false;
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
        const pending=this.store.withLock(()=>{const heavy=new Set(this.heavyLocalFiles());return new Set([
          ...this.gitBytes(['diff','--name-only','-z']).toString('utf8').split('\0'),
          ...this.gitBytes(['diff','--cached','--name-only','-z']).toString('utf8').split('\0'),
          ...this.gitBytes(['ls-files','--others','--exclude-standard','-z']).toString('utf8').split('\0').filter(name=>!this.keptLocal(name))
        ].filter(name=>name&&!heavy.has(name)&&(shared(name)||(name==='.gitignore'&&!this.gitDir)))).size;});
        this.last={state:pending?'pending':'synced',at:new Date().toISOString(),pending,...(pending?{detail:'New local edits will upload on the next synchronization cycle.'}:{})};
    }catch(error){this.last={state:this.pendingConflicts().length?'conflict':'pending',at:new Date().toISOString(),error:'Sync did not complete; local files remain available',detail:error.message==='Workspace is being written by another process'?'The assistant is saving its state.':String(error.message).split('\n')[0]};}
    atomic(path.join(this.store.state,'sync-status.json'),JSON.stringify(this.last,null,2));return this.last;
  }
  // Whether commit `ancestor` is already part of the history of `descendant`.
  contains(ancestor,descendant){try{this.git(['merge-base','--is-ancestor',ancestor,descendant]);return true;}catch{return false;}}
  // `commit` without `names`, as a commit on it, the same every time: Git on
  // Windows cannot check out a name Windows cannot hold, and from the moment
  // one was in the repository every merge on a Windows machine failed, for
  // good (7 October 2026). A commit from an older version that carries one
  // is taken without it; the machine that made it keeps its file.
  without(commit,names){
    const index=path.join(this.store.state,'sync-without-index'),env={GIT_INDEX_FILE:index},nt=['-c','core.protectNTFS=false'];this.dropIndex(index);
    try{
      this.git([...nt,'read-tree',commit],undefined,{env,timeout:120000});
      for(let i=0;i<names.length;i+=200)this.git([...nt,'--literal-pathspecs','update-index','--force-remove','--',...names.slice(i,i+200)],undefined,{env});
      const date=this.git(['log','-1','--format=%cI',commit]);
      return this.git(['commit-tree',this.git([...nt,'write-tree'],undefined,{env}),'-p',commit,'-m','Leave out names Windows cannot hold'],undefined,{env:{...this.identity(),GIT_AUTHOR_DATE:date,GIT_COMMITTER_DATE:date}});
    }finally{this.dropIndex(index);}
  }
  integrate(remoteRef,{fastForward=false}={}){
    const carried=this.names(['ls-tree','-r','-z','--name-only',remoteRef,'--',...durableRoots,...durableFiles]).filter(windowsInvalid);
    if(carried.length)remoteRef=this.without(remoteRef,carried);
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
      // A second device set up from Settings (a plain folder, `git init`) has
      // no history in common with the notebook it joins either, and until 6
      // October 2026 the merge refused it for good. It builds on that
      // notebook: its same-named files are the starter's, so the notebook's
      // win, and its records are merged by identity, so a note it wrote before
      // joining stays.
      let firstJoin=false;try{this.git(['merge-base','HEAD',remoteRef],dir);}catch{firstJoin=true;}
      const remoteCommit=this.git(['rev-parse',remoteRef]);let merging=false;
      try { this.git(fastForward?['merge','--ff-only',remoteRef]:['merge','--no-edit','--no-ff','--no-commit',...(firstJoin?['--strategy=ort','-X',this.gitDir?'ours':'theirs','-X','no-renames']:['--strategy=resolve']),'--allow-unrelated-histories',remoteRef],dir,{env:this.identity(),timeout:120000});merging=!fastForward; }
      catch(e) {if(!this.names(['diff','--name-only','-z','--diff-filter=U'],dir).length)throw e;merging=true;}
      const base=firstJoin?this.git(['mktree'],dir,{input:''}):this.git(['merge-base',localHead,remoteCommit],dir);
      // A record renamed or moved on either side is merged as one record
      // before any file of it is called a conflict (identity.mjs).
      if(merging&&!(firstJoin&&this.gitDir)){
        const plan=identityPlan({git:(args,options)=>this.gitBytes(args,dir,options),mergeText:(b,l,r)=>this.mergeText(b,l,r),find:(type,id)=>this.store.records.get(type+'/'+id),base,local:localHead,remote:remoteCommit,preferRemote:firstJoin&&!this.gitDir});
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
          // A decision holds while the other machines' version of this file is
          // the one reviewed, whatever else they changed meanwhile. Until 7
          // October 2026 it held only against that exact commit, and the same
          // conflict came back as soon as another machine saved anything.
          const theirs=read(3),reviewed=previous&&Object.hasOwn(previous,'remote')?(previous.remote===null?null:Buffer.from(previous.remote,previous.encoding==='base64'?'base64':'utf8')):undefined;
          const unchanged=reviewed!==undefined&&(theirs===null?reviewed===null:reviewed!==null&&theirs.equals(reviewed));
          if(previous?.resolved_at&&(previous.remote_commit===remoteCommit||unchanged)){
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
      let merged=new Store(dir);
      const lost=()=>[...this.store.records.keys()].filter(key=>!merged.records.has(key));
      const proven=key=>[...merged.records.values()].some(r=>r.uid===this.store.records.get(key).uid&&[...(r.former_ids||[]),...(r.aliases||[])].includes(this.store.records.get(key).id));
      const deletable=key=>deletableTypes.has(key.split('/')[0]),unproven=lost().filter(key=>!proven(key)&&!deletable(key));let accepted=new Set();
      if(unproven.length){
        const many=tooManyRemoved(unproven.map(key=>this.store.records.get(key)),liveCounts(this.store.records.values()));
        const decision=many&&this.massReview(unproven.map(key=>this.store.records.get(key)),remoteCommit,'Remote '+many[0].toLowerCase()+many.slice(1));
        if(many&&!decision)throw new Error('Remote '+many[0].toLowerCase()+many.slice(1)+'; it is kept for review');
        if(decision?.choice==='remote')accepted=new Set(unproven);
        // A removal without a tombstone (from an older version, or Git used
        // by hand) is kept for review instead of stopping every later sync,
        // which until 6 October 2026 it did without saying what to review.
        // Choosing the removal makes the record a tombstone here
        // (conflicts.mjs); choosing to keep it brings it back in this merge.
        const kept=[],open=[];
        for(const key of decision?.choice==='remote'?[]:unproven){
          const name=posix(path.relative(this.store.root,this.store.fileOf.get(key))),id=hash(name).slice(0,24),saved=path.join(this.store.root,'conflicts',id+'.json'),previous=readJson(saved);
          // Removed there, as when it was reviewed: the decision holds.
          if(decision||previous?.resolved_at&&(previous.remote_commit===remoteCommit||previous.remote===null)){kept.push(name);continue;}
          let before=null;try{before=this.gitBytes(['cat-file','blob',base+':'+name],dir);}catch{}
          atomic(saved,JSON.stringify(reviewItem(id,name,{base:before,local:fs.readFileSync(this.store.fileOf.get(key)),remote:null},remoteCommit,{reason:'Removed on another machine without a tombstone'}),null,2));open.push(name);
        }
        if(open.length)throw new Error('Records removed on another machine without a tombstone were kept for review: '+open.join(', '));
        for(const name of kept){atomic(path.join(dir,...name.split('/')),fs.readFileSync(path.join(this.store.root,...name.split('/'))));this.git(['--literal-pathspecs','add','--',name],dir);}
        if(kept.length&&!merging)this.git(['commit','-q','-m','Keep the records chosen on this machine'],dir,{env:this.identity(),timeout:120000});
        if(kept.length)merged=new Store(dir);
      }
      if(merging)this.git(['commit','--no-edit'],dir,{env:this.identity(),timeout:120000});
      validateAssistantFiles(dir);
      if(merged.problems.length)throw new Error('The merged reference graph needs review');
      const removed=lost();
      if(removed.some(key=>!proven(key)&&!deletable(key)&&!accepted.has(key)))throw new Error('Remote removal without a tombstone or proven rename needs review: '+removed.join(', '));
      // A record is brought in where the merge put it, so a rename on another
      // machine renames the file here, and every machine names it the same.
      const inside=(store,file)=>path.relative(store.recordsRoot,file).split(path.sep).join('/'),recordFiles=store=>new Set([...store.fileOf.values()].map(file=>path.relative(store.root,file).split(path.sep).join('/')));
      const localRecords=recordFiles(this.store),mergedRecords=recordFiles(merged),paths=new Map();
      const batch=[...merged.records.entries()].filter(([key,r])=>{
        const mine=this.store.records.get(key),at=inside(merged,merged.fileOf.get(key));paths.set(key,at);
        return mine?._hash!==r._hash||!this.store.fileOf.has(key)||inside(this.store,this.store.fileOf.get(key))!==at;
      }).map(([,r])=>{const value={...r};delete value._hash;return value;});
      // A record's file written since this round read it (Obsidian, an
      // assistant: programs that take no lock) keeps that write, and the
      // merged version is kept for review, as for a document below. Until
      // 7 October 2026 the merged version replaced it and the edit was gone.
      const outside=new Set();
      for(const key of [...batch.map(r=>r.type+'/'+r.id),...removed]){
        const seen=this.store.records.get(key),file=this.store.fileOf.get(key);if(!seen||!file)continue;
        let now=null,same=false;try{now=fs.readFileSync(file);same=hash(encode(decode(now.toString('utf8'),file)))===seen._hash;}catch{}
        if(same)continue;
        outside.add(key);
        const name=posix(path.relative(this.store.root,file)),id=hash(name).slice(0,24),result=merged.records.get(key);
        let before=null;try{before=this.gitBytes(['cat-file','blob',localHead+':'+name]);}catch{}
        atomic(path.join(this.store.root,'conflicts',id+'.json'),JSON.stringify(reviewItem(id,name,{base:before,local:now,remote:result?encode(result):null},remoteCommit,{reason:'Written on this machine while the other machines\' edits were merged'}),null,2));
      }
      const taken=batch.filter(r=>!outside.has(r.type+'/'+r.id)),gonePaths=removed.filter(key=>!outside.has(key));
      if(taken.length||gonePaths.length)this.store.commit(taken,{removeKeys:gonePaths,paths:new Map(taken.map(r=>[r.type+'/'+r.id,paths.get(r.type+'/'+r.id)]))});
      // Everything else is a document: the owner's files, and pages in the
      // notebook folder that are not records. A program that does not take
      // the workspace lock (an assistant writing its journal, an editor) may
      // have written one since this round committed it, and until 6 October
      // 2026 the merged version replaced that write. Such a file stays as it
      // is now, with the merged version kept for review; one the merge left
      // as it was is simply left alone, and the next commit takes the edit.
      const differing=this.blobFiles(dir).filter(n=>shared(n)&&!mergedRecords.has(n)).map(file=>({file,text:fs.readFileSync(path.join(dir,file))})).filter(item=>!fs.existsSync(path.join(this.store.root,item.file))||!fs.readFileSync(path.join(this.store.root,item.file)).equals(item.text));
      const committed=readBlobs((args,options)=>this.gitBytes(args,undefined,options),differing.map(item=>localHead+':'+item.file)),documents=[];
      differing.forEach((item,i)=>{
        const live=path.join(this.store.root,item.file),now=fs.existsSync(live)?fs.readFileSync(live):null,then=committed[i];
        if(now===null?then===null:then&&now.equals(then))return documents.push(item);
        if(then&&then.equals(item.text))return;
        const id=hash(item.file).slice(0,24);
        atomic(path.join(this.store.root,'conflicts',id+'.json'),JSON.stringify(reviewItem(id,item.file,{base:then,local:now,remote:item.text},remoteCommit,{reason:'Written on this machine while the other machines\' edits were merged'}),null,2));
      });
      // A document another machine deleted is deleted here too, when this
      // machine still holds exactly the version both last agreed on. Before,
      // only records carried removals: a deleted rule or skill stayed on every
      // other machine, and the next upload from any of them put it back. A
      // file changed here meanwhile is a modify/delete conflict above instead.
      const gone=this.names(['diff','--name-only','-z','--no-renames','--diff-filter=D',localHead,'HEAD'],dir).filter(n=>{if(!shared(n)||localRecords.has(n)||mergedRecords.has(n)||windowsInvalid(n))return false;try{return fs.lstatSync(path.join(this.store.root,n)).isFile();}catch{return false;}})
        .filter(n=>this.git(['hash-object','--',n])===this.git(['rev-parse',localHead+':'+n]));
      const tracked=this.blobFiles(dir).filter(n=>shared(n)&&!mergedRecords.has(n)).length;
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
  // Copies files out of the way into .godspeed/set-aside/<time>/ and gives
  // the folder back what the last commit holds (or nothing, for a new file).
  // Each name is taken literally: as a pattern "a[1].md" also named a1.md, and
  // the owner's unsaved edit of that file was replaced too.
  setAside(names){
    const folder=path.join(this.store.state,'set-aside',new Date().toISOString().replace(/[:.]/g,'-'));
    for(const name of names){
      const from=path.join(this.store.root,...name.split('/'));if(!fs.existsSync(from))continue;
      const to=path.join(folder,...name.split('/'));fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to);
      let tracked=true;try{this.git(['--literal-pathspecs','ls-files','--error-unmatch','--',name]);}catch{tracked=false;}
      if(tracked)this.git(['--literal-pathspecs','checkout','--',name]);else fs.rmSync(from);
    }
    fs.writeFileSync(path.join(folder,'README.txt'),'These files on this machine stood in the way of the other machines\' changes and were never part of what the notebook commits. They are kept here whole.\n'+names.join('\n')+'\n');
    return folder;
  }
  scopeRoots(){return this.folder.paths.includes('*')?[...durableRoots,...durableFiles]:this.folder.paths;}
  // Git's own hooks belong to the owner's commits and pushes from a person:
  // the notebook's commits must not start the owner's post-commit jobs. Its
  // push still runs the owner's pre-push gate.
  quiet(){const dir=path.join(this.store.state,'no-hooks');fs.mkdirSync(dir,{recursive:true});return ['-c','core.hooksPath='+dir];}
  identity(){return {GIT_AUTHOR_NAME:'Godspeed Mission Control',GIT_AUTHOR_EMAIL:'godspeed@localhost',GIT_COMMITTER_NAME:'Godspeed Mission Control',GIT_COMMITTER_EMAIL:'godspeed@localhost'};}
  // Another program may be in the middle of something with this repository.
  // The notebook waits for the next round instead of acting on half a merge.
  // A lock that a killed Git left behind is cleared first (staleLocks).
  folderReady(){
    if(!fs.existsSync(path.join(this.store.root,'.git')))throw new Error('This folder has no repository of its own');
    const gitDir=this.git(['rev-parse','--absolute-git-dir']);
    this.staleLocks(gitDir);
    const busy=['MERGE_HEAD','rebase-merge','rebase-apply','CHERRY_PICK_HEAD','REVERT_HEAD','BISECT_LOG','index.lock'].find(name=>fs.existsSync(path.join(gitDir,name)));
    if(busy)throw Object.assign(new Error('Git is busy in this folder ('+busy+'); the notebook syncs on the next round'),{code:'GIT_BUSY'});
    let branch;try{branch=this.git(['symbolic-ref','--quiet','--short','HEAD']);}catch{branch='';}
    if(branch!==this.branch)throw new Error('This folder is not on its '+this.branch+' branch; the notebook syncs only there');
  }
  // Whether the owner's Git checks notebook pages out exactly as the notebook
  // stores them. Git for Windows ships core.autocrlf=true, which writes every
  // page it checks out with CRLF unless the repository's attributes say
  // otherwise, so one note read differently on two machines (6 October 2026).
  // The notebook commits its pages byte for byte; the owner's attributes have
  // to keep them so (`notebook/** -text`, or `eol=lf`). The answer is what to
  // change, or null.
  lineEndingProblem(){
    const attr=Object.fromEntries(this.git(['check-attr','text','eol','filter','ident','working-tree-encoding','--',recordsFolder+'/Page.md']).split('\n').map(line=>line.match(/: ([\w-]+): (.*)$/)).filter(Boolean).map(m=>[m[1],m[2]]));
    let config='';try{config=this.git(['config','--get-regexp','^core\\.(autocrlf|eol)$']).toLowerCase();}catch{}
    const value=key=>(config.split('\n').map(line=>line.split(' ')).filter(([k])=>k===key).at(-1)||[])[1]||'';
    const autocrlf=value('core.autocrlf'),eol=value('core.eol')||'native',plain=v=>!v||v==='unspecified'||v==='unset';
    const converts=!plain(attr.filter)||attr.ident==='set'||!plain(attr['working-tree-encoding'])?'a filter':attr.text==='unset'||attr.eol==='lf'?null:attr.eol==='crlf'?'eol=crlf'
      :['true','yes','on','1'].includes(autocrlf)?'core.autocrlf=true':attr.text==='unspecified'||autocrlf==='input'?null:eol==='crlf'||eol==='native'&&process.platform==='win32'?'core.eol='+eol:null;
    return converts&&'Git would change the line endings of notebook pages in this repository ('+converts+'); add "'+recordsFolder+'/** -text" to its .gitattributes first';
  }
  // What changed in the notebook's own paths since its last commit. A page
  // that one of the owner's ignore rules happens to match (a note titled
  // "id_rsa rotation", a folder called __pycache__) is still a notebook page:
  // Git's status leaves it out, and until 6 October 2026 such a page never
  // left the machine while sync said "synced".
  folderChanges(){
    const out=this.gitBytes(['--no-optional-locks','--literal-pathspecs','status','--porcelain','-z','--no-renames','--untracked-files=all','--ignore-submodules=all','--',...this.scopeRoots()]).toString('utf8');
    const ignored=this.inScope(recordsFolder+'/Page.md')&&fs.existsSync(this.store.recordsRoot)?this.names(['--literal-pathspecs','ls-files','-z','--others','--ignored','--exclude-standard','--',recordsFolder]).filter(name=>candidate(name.slice(recordsFolder.length+1))).map(name=>'!! '+name):[];
    return [...out.split('\0').filter(Boolean),...ignored].map(entry=>({code:entry.slice(0,2),name:entry.slice(3)}))
      .filter(({code,name})=>!name.endsWith('/')&&!windowsInvalid(name)&&this.inScope(name)&&(code.includes('D')||(()=>{try{return fs.statSync(path.join(this.store.root,name)).size<=this.largeFile;}catch{return false;}})()))
      .map(({name})=>name);
  }
  dropIndex(index){for(const file of [index,index+'.lock'])fs.rmSync(file,{force:true});}
  // This machine's changes as one commit on `head`, built in an index of its
  // own: the owner's index, branch and staged work stay as they are until
  // that commit is on the other side (moveBranch). Each page goes in byte for
  // byte, whatever line-ending rules the owner's Git applies to its own
  // files, so a note reads the same on every machine; any other file the
  // notebook carries (paths "*") goes through the owner's attributes as a
  // `git add` would. Returns the commit (`head` when nothing changed) and the
  // index lines that make the owner's index match it.
  commitFolder(head,files){
    this.validate();this.guardOutgoing(head,files);
    const lines=this.indexLines(head,files),index=path.join(this.store.state,'sync-commit-index'),env={GIT_INDEX_FILE:index};
    this.dropIndex(index);
    try{
      this.git(['read-tree',head],undefined,{env,timeout:120000});
      this.gitBytes(['-c','core.ignorecase=false','update-index','-z','--index-info'],undefined,{env,input:lines.join('\0')+'\0',timeout:120000});
      const tree=this.git(['write-tree'],undefined,{env});
      if(tree===this.git(['rev-parse',head+'^{tree}']))return {commit:head,lines:[]};
      return {commit:this.git(['commit-tree',tree,'-p',head,'-m','Save notebook records'],undefined,{env:this.identity()}),lines};
    }finally{this.dropIndex(index);}
  }
  // One `update-index --index-info` line per file: its mode and blob, or its
  // removal. A page whose name on disk differs only in case from the name
  // Git has (Original.md and ORIGINAL.md on a file system that ignores case)
  // leaves the old name for the new one; committed under the old name, the
  // rename was lost (6 October 2026).
  indexLines(head,files){
    const zero='0'.repeat(head.length),renamed=new Map(this.respelled(files)),lines=[],present=[];
    for(const name of [...new Set(files.flatMap(n=>renamed.has(n)?[n,renamed.get(n)]:[n]))]){
      const file=path.join(this.store.root,...name.split('/'));let stat=null;
      if(!renamed.has(name))try{stat=fs.lstatSync(file);}catch{}
      if(!stat)lines.push('0 '+zero+'\t'+name);
      else if(stat.isSymbolicLink())lines.push('120000 '+this.git(['hash-object','-w','--stdin'],undefined,{input:fs.readlinkSync(file)})+'\t'+name);
      else present.push([name,stat]);
    }
    // Windows has no executable bit: a file keeps the mode it has in Git.
    const pages=present.filter(([name])=>isRecordPath(name)),others=present.filter(([name])=>!isRecordPath(name)),tracked=new Map();
    if(process.platform==='win32')for(let i=0;i<others.length;i+=200)for(const entry of this.names(['--literal-pathspecs','ls-tree','-z',head,'--',...others.slice(i,i+200).map(([name])=>name)])){const m=entry.match(/^(\d+) \w+ [0-9a-f]+\t([\s\S]+)$/);if(m)tracked.set(m[2],m[1]);}
    const mode=(name,stat)=>isRecordPath(name)?'100644':(process.platform==='win32'?tracked.get(name)==='100755':stat.mode&0o111)?'100755':'100644';
    for(const [group,exact] of [[pages,true],[others,false]]){
      const filters=exact?['--no-filters']:[],batch=group.filter(([name])=>!/[\r\n]/.test(name));
      // Names are read one per line; one with a line break in it goes alone.
      const oids=batch.length?this.git(['hash-object','-w',...filters,'--stdin-paths'],undefined,{input:batch.map(([name])=>name).join('\n')+'\n',timeout:120000}).split('\n'):[];
      batch.forEach(([name,stat],i)=>lines.push(mode(name,stat)+' '+oids[i]+'\t'+name));
      for(const [name,stat] of group.filter(([name])=>/[\r\n]/.test(name)))lines.push(mode(name,stat)+' '+this.git(['hash-object','-w',...filters,'--',name])+'\t'+name);
    }
    return lines;
  }
  // Many records deleted here at once do not leave this machine (tooManyRemoved).
  guardOutgoing(head,files){
    const gone=files.filter(name=>isRecordPath(name)&&!fs.existsSync(path.join(this.store.root,...name.split('/'))));
    if(gone.length<=25)return;
    const removed=this.decodedAt(head,gone).filter(r=>!this.store.keyOfUid.has(r.uid)),live=liveCounts(this.store.records.values());
    for(const [type,n] of liveCounts(removed))live.set(type,(live.get(type)||0)+n);
    const many=tooManyRemoved(removed,live);if(many)throw new Error(many+'; nothing was uploaded. Restore the files, or remove the records in the notebook');
  }
  // Under the lock: this machine's changes as a commit, and what the branch
  // becomes with the other machines' changes, checked before anything moves.
  // Only a commit the other side has is ever put on the owner's branch, so
  // its `git pull --rebase` never meets a merge of the notebook's that is not
  // upstream: until 6 October 2026 a merge left there by a refused push made
  // that pull stop with conflict markers in a note. Returns what to push.
  planFolder(remoteRef){
    const head=this.git(['rev-parse','HEAD']),remoteHead=this.git(['rev-parse',remoteRef]),files=this.folderChanges(),incoming=!this.contains(remoteHead,head);
    if(!files.length&&!incoming)return head===remoteHead?null:{head,local:head,target:head,lines:[],reviews:[]};
    const endings=this.lineEndingProblem();if(endings)throw new Error(endings);
    const {commit:local,lines}=files.length?this.commitFolder(head,files):{commit:head,lines:[]};
    if(!incoming)return local===remoteHead?null:{head,local,target:local,lines,reviews:[]};
    // What the checks compare against is read under this lock, once:
    // committing read it already.
    if(!files.length)this.store.scan();
    // Only the other side moved: the branch takes its commit as it is, or,
    // with records kept here that it removed, that commit with them back.
    if(local===head&&this.contains(head,remoteHead)){const keep=this.checkIncoming(head,remoteHead,remoteHead);if(!keep.length){this.forward(remoteHead,head);return null;}return {head,local:head,target:this.restore(remoteHead,keep,head),lines:[],reviews:[]};}
    const {commit:target,reviews}=this.mergeFolder(local,remoteHead);
    const keep=this.checkIncoming(local,target,remoteHead);
    return {head,local,target:keep.length?this.restore(target,keep,local):target,lines,reviews};
  }
  // Before the branch takes `target`: the notebook this machine would read
  // must still read. Until 6 October 2026 a merged notebook was taken
  // unchecked, and a page deleted on one machine while another linked to it
  // broke every save on both. A problem the change would bring is kept for
  // review and nothing is taken or pushed; a mass removal waits as well.
  checkIncoming(from,target,remoteHead){
    const problems=this.mergedProblems(from,target);
    if(problems.length){
      let base=null;try{base=this.git(['merge-base',from,target]);}catch{}
      const blob=(commit,name)=>{if(!commit)return null;try{return this.gitBytes(['cat-file','blob',commit+':'+name]);}catch{return null;}},items=new Map();
      for(const p of problems){
        // A reference to a record the other side removed: that record is what to look at.
        const key=p.reference?.uid&&this.store.keyOfUid.get(p.reference.uid),name=key&&this.store.fileOf.has(key)?posix(path.relative(this.store.root,this.store.fileOf.get(key))):p.name;
        if(!name||items.has(name))continue;
        const live=path.join(this.store.root,...name.split('/'));
        // A copy of a record (two files with one identity) is marked so: its
        // review is about the copy's own file, never the record it copies.
        items.set(name,reviewItem(hash('check\0'+name+'\0'+remoteHead).slice(0,24),name,{base:blob(base,name),local:fs.existsSync(live)?fs.readFileSync(live):null,remote:blob(target,name)},remoteHead,{kept:'local',reason:p.reference?'The other machines removed this while a record here still refers to it':p.error,...(p.copy_of?{copy_of:p.copy_of}:{})}));
      }
      for(const item of items.values())this.saveReview(item);
      throw Object.assign(new Error('The other machines\' notebook changes would leave '+problems.length+' problem'+(problems.length===1?'':'s')+' here ('+problems[0].error+'); they were not taken, and what to look at is kept for review'),{code:'REVIEW'});
    }
    return this.guardRemovals(from,target,remoteHead);
  }
  // The problems a full read here would report after taking `target`: the
  // files it changes since `from`, read over what the store holds now. Only
  // the ones the change brings count; one already here is no reason to keep
  // out the other machines' edits.
  mergedProblems(from,target){
    const changed=this.names(['diff','--name-only','-z','--no-renames',from,target,'--',recordsFolder]).filter(name=>candidate(name.slice(recordsFolder.length+1)));
    if(!changed.length)return [];
    const now=new Map();for(const [key,file] of this.store.fileOf){const name=posix(path.relative(this.store.root,file));now.set(nameKey(name),{name,record:this.store.records.get(key)});}
    const after=new Map(now),problems=[];for(const name of changed)after.delete(nameKey(name));
    readBlobs((args,options)=>this.gitBytes(args,undefined,options),changed.map(name=>target+':'+name)).forEach((bytes,i)=>{
      if(!bytes)return;const name=changed[i];
      try{after.set(nameKey(name),{name,record:decode(bytes.toString('utf8'),name)});}catch(error){if(error.code!=='NOT_RECORD')problems.push({key:'file:'+nameKey(name),name,error:error.message});}
    });
    const known=new Set(this.graphProblems(now).map(p=>p.key));
    return [...problems,...this.graphProblems(after).filter(p=>!known.has(p.key))];
  }
  // What a full read of these files reports as the store does (Store.derive):
  // one identity in two files, an ambiguous id, a reference to nothing.
  graphProblems(entries){
    const problems=[],uids=new Map(),records=new Map(),aliases=new Map();
    for(const {name,record} of entries.values()){
      const key=record.type+'/'+record.id;
      if(uids.has(record.uid))problems.push({key:'uid:'+record.uid,name,error:'Duplicate UUID',copy_of:uids.get(record.uid)});
      uids.set(record.uid,name);records.set(key,{name,record});
      if(!record.removed_at)for(const alias of identityIds(record)){const id=record.type+'/'+alias.toLowerCase();if(aliases.has(id)&&aliases.get(id)!==key)problems.push({key:'alias:'+id,name,error:'Ambiguous alias'});aliases.set(id,key);}
    }
    const fileOf=new Map([...records.values()].map(({name,record})=>[record.id,name]));
    for(const p of this.store.validateReferences([...records.values()].map(v=>v.record)))problems.push({key:'ref:'+p.record+':'+JSON.stringify(p.reference),name:fileOf.get(p.record),error:p.error,reference:p.reference});
    return problems;
  }
  // A removal from the other machines too large to take unasked is one
  // review: keep the records, and they come back on every machine, or accept
  // the removal. Until 7 October 2026 it only stopped sync, saying neither
  // what to look at nor how to let it through. Returns the decision once
  // there is one; it holds for these records, whatever else the other
  // machines changed meanwhile.
  massReview(records,remoteCommit,message){
    const id=hash('removal\0'+records.map(r=>r.uid).sort().join('\0')).slice(0,24),file=path.join(this.store.root,'conflicts',id+'.json'),previous=readJson(file);
    if(previous?.resolved_at)return previous;
    if(!previous)atomic(file,JSON.stringify({id,kind:'mass-removal',path:message,reason:'Removed on another machine all at once. Keep them, and they come back on every machine, or accept the removal.',records:records.map(r=>({type:r.type,id:r.id,uid:r.uid})),local:records.map(r=>r.type+': '+(r.title||r.name||r.id)).sort().join('\n'),remote:null,remote_commit:remoteCommit,at:new Date().toISOString()},null,2));
    return null;
  }
  // `commit` with `names` as `from` has them: the records kept on this machine.
  restore(commit,names,from){
    const index=path.join(this.store.state,'sync-restore-index'),env={GIT_INDEX_FILE:index};this.dropIndex(index);
    try{
      this.git(['read-tree',commit],undefined,{env,timeout:120000});
      for(let i=0;i<names.length;i+=200)this.gitBytes(['update-index','-z','--index-info'],undefined,{env,input:this.names(['--literal-pathspecs','ls-tree','-z',from,'--',...names.slice(i,i+200)]).join('\0')+'\0',timeout:120000});
      return this.git(['commit-tree',this.git(['write-tree'],undefined,{env}),'-p',commit,'-m','Keep the records chosen on this machine'],undefined,{env:this.identity()});
    }finally{this.dropIndex(index);}
  }
  // A review is written once: one already waiting stays as it is.
  saveReview(item){const file=path.join(this.store.root,'conflicts',item.id+'.json'),previous=readJson(file);if(previous&&!previous.resolved_at)return;atomic(file,JSON.stringify(item,null,2));}
  // A whole folder of records disappearing at once is a mistake somewhere,
  // not an edit. Git keeps them either way; the notebook does not apply it.
  // A record that moved (a rename, a new folder, the conversion to readable
  // files) is still there: only what is gone from every path counts, against
  // the live pages of its type here (tooManyRemoved).
  // Returns the files to keep when a review chose to keep them.
  guardRemovals(from,target,remoteHead){
    const gone=this.names(['diff','--name-only','-z','--no-renames','--diff-filter=D',from,target,'--',recordsFolder]);
    if(gone.length<=25)return [];
    const git=(args,options)=>this.gitBytes(args,undefined,options),kept=new Set(identities(git,target,this.names(['diff','--name-only','-z','--no-renames','--diff-filter=AM',from,target,'--',recordsFolder])));
    const removed=[];readBlobs(git,gone.map(name=>from+':'+name)).forEach((bytes,i)=>{if(!bytes)return;try{const r=decode(bytes.toString('utf8'),gone[i]);if(!kept.has('uid:'+r.uid))removed.push([gone[i],r]);}catch{}});
    const many=tooManyRemoved(removed.map(([,r])=>r),liveCounts(this.store.records.values()));
    if(!many)return [];
    const decision=this.massReview(removed.map(([,r])=>r),remoteHead,many);
    if(!decision)throw Object.assign(new Error(many+'; it is kept for review'),{code:'REVIEW'});
    return decision.choice==='remote'?[]:removed.map(([name])=>name);
  }
  // The owner's branch takes `target`. Git refuses when that would overwrite
  // a file the owner is still editing, so nothing unsaved is lost: the
  // notebook tries again on the next round.
  forward(target,from){
    const run=()=>this.git([...this.quiet(),'merge','--ff-only','--no-stat','-q',target],undefined,{timeout:300000});
    const waiting=error=>{
      // A name Windows cannot hold, committed elsewhere by the owner's own Git.
      const invalid=String(error.stderr||error.message).match(/invalid path '([^']+)'/);
      if(invalid)return new Error('A file named "'+invalid[1]+'" arrived from another machine, and Windows cannot hold that name. Rename it on the machine that made it; the notebook syncs again then');
      return new Error('Waiting for local changes to be saved before the notebook can bring in the other machines\' edits: '+String(error.stderr||error.message).split('\n').filter(l=>/^\s+\S/.test(l)).map(l=>l.trim()).slice(0,3).join(', '));
    };
    try{run();}
    catch(error){
      // On a machine where the notebook is the only one that commits (paths
      // "*"), a file it never commits, such as a brief its own assistant wrote,
      // would block every merge for good: it blocked the test server from 05:02
      // to 12:05 on 6 October 2026. Such a file is moved aside, kept whole, and
      // the merge is tried again. Anywhere else the owner commits it.
      const blocked=String(error.stderr||error.message).split('\n').filter(l=>/^\s+\S/.test(l)).map(l=>l.trim());
      if(!this.folder?.paths?.includes('*')||!blocked.length||blocked.some(name=>this.inScope(name)))throw waiting(error);
      this.setAside(blocked);
      try{run();}catch(again){throw waiting(again);}
    }
    // The notebook server re-reads only files it is told about: the ones
    // this merge changed, before it next writes under the workspace lock.
    let changed=['*'];try{changed=this.names(['diff','--name-only','-z','--no-renames',from,target,'--',recordsFolder]).map(name=>name.slice(recordsFolder.length+1));}catch{}
    this.store.journal(changed);
    this.store.scan(true);
  }
  // After the push: the reviews of the merge first, then the owner's branch
  // moves to the pushed commit. A push the process did not live to see
  // through, or that Git reported as failed, is completed once the other side
  // shows it arrived, or dropped once it shows it did not. While the other
  // side cannot be read (`fetched` false) the plan waits. Returns whether the
  // push was completed.
  finishPush(remoteRef,{pushed=false,fetched=true}={}){
    const file=path.join(this.store.state,'sync-pushing.json'),plan=readJson(file);if(!plan)return false;
    let arrived=pushed;if(!arrived)try{arrived=this.contains(plan.target,this.git(['rev-parse',remoteRef]));}catch{}
    if(!arrived&&!fetched)return false;
    try{
      if(!arrived)return false;
      for(const review of plan.reviews)this.saveReview(review);
      this.moveBranch(plan);return true;
    }finally{fs.rmSync(file,{force:true});}
  }
  // Waits, up to half a minute, while a Git of the owner's holds the index
  // for a moment (an editor's status, a session's add).
  indexFree(){const lock=path.join(this.git(['rev-parse','--absolute-git-dir']),'index.lock');for(const until=Date.now()+30000;fs.existsSync(lock)&&Date.now()<until;)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,100);}
  moveBranch({head,local,target,lines}){
    // The owner committed or pulled meanwhile: the next round, or their own
    // pull, brings the rest.
    if(this.git(['rev-parse','HEAD'])!==head)return;
    if(local!==head){
      this.indexFree();
      this.git(['update-ref','-m','Save notebook records','refs/heads/'+this.branch,local,head]);
      // The owner's index takes exactly these files as committed; whatever
      // else the owner has staged stays staged. A Git of the owner's that
      // takes the index between the two steps is waited for: until 7 October
      // 2026 the branch had moved and the index stayed behind, showing the
      // notebook's commit as staged changes taking it back.
      for(let attempt=0;;attempt++){try{this.gitBytes(['-c','core.ignorecase=false','update-index','-z','--index-info'],undefined,{input:lines.join('\0')+'\0',timeout:120000});break;}catch(error){if(attempt>=2)throw error;this.indexFree();}}
    }
    if(target!==local){this.indexFree();this.forward(target,local);}
  }
  // The workspace lock, waited for a few seconds: a save holding it now is
  // over in moments, and what follows a push should not wait a whole round.
  lockSoon(fn){
    for(const until=Date.now()+10000;;){try{return this.store.withLock(fn);}catch(error){if(error.code!=='WRITER_BUSY'||Date.now()>until)throw error;Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,50);}}
  }
  // The merge of both sides, built in an index of its own without touching
  // this folder, as a commit the owner's branch takes only once it is pushed.
  mergeFolder(head,remoteHead){
    let base;try{base=this.git(['merge-base',head,remoteHead]);}catch{throw new Error('This folder and the shared repository have no history in common');}
    // A lock left beside the index by a Git that was killed is the notebook's own, and goes with it.
    const index=path.join(this.store.state,'sync-merge-index'),env={GIT_INDEX_FILE:index};this.dropIndex(index);
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
    }finally{this.dropIndex(index);}
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
    reviews.push({id:hash(name+'\0'+remoteHead).slice(0,24),path:name,kind:'git',kept,...(encoding==='base64'?{encoding,digests:Object.fromEntries(Object.entries(versions).map(([key,v])=>[key,v&&hash(v)]))}:{}),
      ...Object.fromEntries(Object.entries(versions).map(([key,v])=>[key,v===null?null:v.toString(encoding)])),remote_commit:remoteHead,at:new Date().toISOString()});
    return local||remote;
  }
  reconcileFolder(){
    try{
      this.folderReady();
      let networkError=null;
      try{this.git(['fetch','--no-tags',this.remote,this.branch],undefined,{timeout:120000});}catch(error){networkError=error;}
      const remoteRef=this.remote+'/'+this.branch,pushing=path.join(this.store.state,'sync-pushing.json');
      // Offline nothing is committed: the edits wait as files, which a plain
      // `git pull --rebase` of the owner's leaves alone.
      const plan=this.store.withLock(()=>{this.folderReady();this.finishPush(remoteRef,{fetched:!networkError});return networkError?null:this.planFolder(remoteRef);});
      if(networkError)throw networkError;
      if(plan){
        // Exactly the commit checked under the lock goes out, with whatever
        // the owner has unpushed beneath it, through the owner's push checks.
        atomic(pushing,JSON.stringify(plan));
        // A push reported as failed may still have arrived (the connection
        // dropped after the remote took it, a time limit). Until 7 October
        // 2026 the plan was dropped at once, and with it the reviews of the
        // merge: the other machine's version of a note both changed then
        // lived only in Git's history. The other side is read again instead.
        try{this.git(['push',this.remote,plan.target+':refs/heads/'+this.branch],undefined,{timeout:600000});}
        catch(error){
          let fetched=false;try{this.git(['fetch','--no-tags',this.remote,this.branch],undefined,{timeout:120000});fetched=true;}catch{}
          if(!this.lockSoon(()=>this.finishPush(remoteRef,{fetched})))throw error;
        }
        this.lockSoon(()=>this.finishPush(remoteRef,{pushed:true}));
      }
      const pending=this.folderChanges().length;
      this.last={state:pending?'pending':'synced',at:new Date().toISOString(),pending,...(pending?{detail:'New local edits will upload on the next synchronization cycle.'}:{})};
    }catch(error){this.last={state:error.code==='REVIEW'?'conflict':'pending',at:new Date().toISOString(),error:'Sync did not complete; local files remain available',detail:error.message==='Workspace is being written by another process'?'The assistant is saving its state.':String(error.message).split('\n')[0]};}
    atomic(path.join(this.store.state,'sync-status.json'),JSON.stringify(this.last,null,2));return this.last;
  }
}
