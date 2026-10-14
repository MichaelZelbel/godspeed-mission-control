import fs from 'node:fs';
import path from 'node:path';
import {execFile,execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {FileSync,readSyncConfig} from './sync/git.mjs';
import {shared} from './file-policy.mjs';

// EARLIER VERSIONS OF THE FILES ON THE IDENTITY PAGE, KEPT AS GIT HISTORY.
//
// Every change made on the page (or by the assistant through the same path) becomes a commit of
// its own, with a message saying what changed, and nothing is ever rewritten: undo and restore are
// new commits that bring back an older text. Where the commit goes:
//
// - Into the repository the notebook syncs through, when that repository carries the file: the
//   folder's own repository (folder mode, when the file is in its paths) or the knowledge
//   repository Settings connected. The commit is built in an index of its own on top of HEAD and
//   the branch moves to it, so the next sync round pushes it with its message, and the owner's
//   index takes exactly these files (as sync/git.mjs moveBranch does); nothing else the owner
//   staged or changed is touched. This runs under the workspace lock, like sync's own commits.
// - Otherwise into a history of this machine's own, .godspeed/identity-history.git, which never
//   leaves it: a mission control with no repository, or a file its repository does not carry.
//
// The versions shown are read from all of them (and from the folder's own repository even when
// the notebook does not sync through it, read only), newest first, one entry per change.
const execFileAsync=promisify(execFile);
const ZERO='0'.repeat(40);
const sameText=(a,b)=>a!==null&&b!==null&&a.toString('utf8').replace(/\r\n/g,'\n')===b.toString('utf8').replace(/\r\n/g,'\n');
export const COMMIT_PREFIX='Identity: ';

export class ShelfHistory{
  constructor(store){this.store=store;}
  privateDir(){return path.join(this.store.state,'identity-history.git');}
  // A private repository's own git, never the owner's settings or hooks.
  privateGit(args,{env={},input,encoding='utf8'}={}){
    const out=execFileSync('git',['--git-dir='+this.privateDir(),...args],{cwd:this.store.state,windowsHide:true,timeout:60000,maxBuffer:64*1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:'0',...env},...(input===undefined?{stdio:['ignore','pipe','pipe']}:{input,stdio:['pipe','pipe','pipe']})});
    return encoding?out.toString(encoding).trim():out;
  }
  ensurePrivate(){
    const dir=this.privateDir();
    if(!fs.existsSync(path.join(dir,'HEAD'))){fs.mkdirSync(dir,{recursive:true});execFileSync('git',['init','--bare','--quiet','--initial-branch=main',dir],{windowsHide:true,stdio:'ignore'});}
  }
  // The repository a change to `files` is committed to, as a runner of git commands.
  carrier(files){
    const config=readSyncConfig(this.store.state);
    if(config?.enabled){
      const sync=new FileSync(this.store);
      try{
        if(sync.folder){
          if(files.every(name=>sync.inScope(name))){sync.folderReady();return {kind:'folder',sync,git:(args,o)=>sync.gitBytes(args,undefined,o)};}
        }else if(files.every(name=>shared(name))&&(sync.gitDir||fs.existsSync(path.join(this.store.root,'.git'))))return {kind:'knowledge',sync,git:(args,o)=>sync.gitBytes(args,undefined,o)};
      }catch(error){return {kind:'private',reason:String(error.message).split('\n')[0],git:(args,o)=>this.privateGit(args,{...o,encoding:null})};}
    }
    return {kind:'private',git:(args,o)=>this.privateGit(args,{...o,encoding:null})};
  }
  // Commits `changes` ([{file, before, after}], Buffers or null for no file) with `message`.
  // Called under the workspace lock, after the files were written. When the repository did not
  // hold the text a file had before this change (an edit made outside the page and not committed
  // yet), that text is committed first, so the change can always be undone. A repository that
  // cannot take the commit (Git busy, the folder not on its branch) leaves it to this machine's
  // own history, and the answer says why.
  record(changes,message,{body}={}){
    const files=changes.map(c=>c.file),chosen=this.carrier(files);
    try{return {...this.commitInto(chosen,changes,message,body),...(chosen.reason?{note:chosen.reason}:{})};}
    catch(error){
      if(chosen.kind==='private')throw error;
      const fallback={kind:'private',git:(args,o)=>this.privateGit(args,{...o,encoding:null})};
      return {...this.commitInto(fallback,changes,message,body),note:String(error.message).split('\n')[0]};
    }
  }
  commitInto(chosen,changes,message,body){
    if(chosen.kind==='private')this.ensurePrivate();
    const git=(args,o)=>chosen.git(args,o).toString('utf8').trim(),raw=(args,o)=>chosen.git(args,o);
    let ref;try{ref=git(['symbolic-ref','-q','HEAD']);}catch{throw Error('The repository is not on a branch');}
    let head='';try{head=git(['rev-parse','-q','--verify','HEAD^{commit}']);}catch{}
    const index=path.join(this.store.state,'identity-commit-index'),env={GIT_INDEX_FILE:index};
    const drop=()=>{for(const file of [index,index+'.lock'])fs.rmSync(file,{force:true});};
    const blobAt=(commit,file)=>{if(!commit)return null;try{return raw(['cat-file','blob',commit+':'+file]);}catch{return null;}};
    const modeAt=(commit,file)=>{if(!commit)return '100644';try{const line=git(['ls-tree',commit,'--',file]);return line.startsWith('100755')?'100755':'100644';}catch{return '100644';}};
    const blob=(file,bytes)=>chosen.kind==='private'?git(['hash-object','-w','--no-filters','--stdin'],{input:bytes}):git(['hash-object','-w','--path='+file,'--stdin'],{input:bytes});
    const lines=(commit,items)=>items.map(({file,bytes})=>bytes===null?'0 '+ZERO+'\t'+file:modeAt(commit,file)+' '+blob(file,bytes)+'\t'+file);
    const commitTree=(base,items,text,extra)=>{
      drop();
      try{
        if(base)git(['read-tree',base],{env});else git(['read-tree','--empty'],{env});
        const entries=lines(base,items);
        raw(['update-index','-z','--index-info'],{env,input:entries.join('\0')+'\0'});
        const tree=git(['write-tree'],{env});
        if(base&&tree===git(['rev-parse',base+'^{tree}']))return {commit:base,entries:[]};
        const identity={GIT_AUTHOR_NAME:'Godspeed Mission Control',GIT_AUTHOR_EMAIL:'godspeed@localhost',GIT_COMMITTER_NAME:'Godspeed Mission Control',GIT_COMMITTER_EMAIL:'godspeed@localhost'};
        return {commit:git(['commit-tree',tree,...(base?['-p',base]:[]),'-m',text,...(extra?['-m',extra]:[])],{env:identity}),entries};
      }finally{drop();}
    };
    // The text each file had before, when the repository does not hold it yet.
    const earlier=changes.filter(c=>c.before!==null&&!sameText(blobAt(head,c.file),c.before)||c.before===null&&blobAt(head,c.file)!==null);
    let base=head,keptEntries=[];
    if(earlier.length){const kept=commitTree(base,earlier.map(c=>({file:c.file,bytes:c.before})),COMMIT_PREFIX+'kept the version from before the next change');base=kept.commit;keptEntries=kept.entries;}
    const made=commitTree(base,changes.map(c=>({file:c.file,bytes:c.after})),message,body);
    if(made.commit===head)return {kind:chosen.kind,commit:null,unchanged:true};
    if(chosen.kind==='folder')chosen.sync.indexFree();
    git(['update-ref','-m',message,ref,made.commit,head||ZERO]);
    // The owner's index takes these files as committed, so Git does not show them changed.
    if(chosen.kind!=='private'){
      const final=new Map([...keptEntries,...made.entries].map(line=>[line.slice(line.indexOf('\t')+1),line]));
      try{raw(['-c','core.ignorecase=false','update-index','-z','--index-info'],{input:[...final.values()].join('\0')+'\0'});}catch{}
    }
    return {kind:chosen.kind,commit:made.commit,message};
  }
  // The repositories to read versions from: [{key, git(args) async}].
  readers(){
    const out=[],seen=new Set(),root=this.store.root,config=readSyncConfig(this.store.state);
    const add=(key,dir,gitArgs)=>{if(seen.has(dir))return;seen.add(dir);out.push({key,git:async(args,{input}={})=>{
      const child=execFileAsync('git',[...gitArgs,...args],{cwd:root,windowsHide:true,timeout:60000,maxBuffer:128*1024*1024,encoding:'buffer',env:{...process.env,GIT_TERMINAL_PROMPT:'0'}});
      if(input!==undefined){child.child.stdin.end(input);}
      return (await child).stdout;
    }});};
    const own=path.join(this.store.state,'sync.git');
    if(config?.enabled&&config.repository!=='folder'&&fs.existsSync(own))add('sync',own,['--git-dir='+own,'--work-tree='+root]);
    if(fs.existsSync(path.join(root,'.git')))add('folder',path.join(root,'.git'),[]);
    if(fs.existsSync(path.join(this.privateDir(),'HEAD')))add('machine',this.privateDir(),['--git-dir='+this.privateDir()]);
    return out;
  }
  // Every recorded version of `file`, newest first, one per change: {id, at, author, message,
  // body, text} (text null where the file did not exist). Up to `limit` commits per repository.
  async versions(file,{limit=60}={}){
    const all=[];
    for(const reader of this.readers()){
      let log;try{log=(await reader.git(['log','-n',String(limit),'--format=%H%x1f%cI%x1f%an%x1f%s%x1f%b%x1e','--',file])).toString('utf8');}catch{continue;}
      const commits=log.split('\x1e').map(entry=>entry.replace(/^\n+/,'')).filter(Boolean).map(entry=>{const [commit,at,author,subject,body]=entry.split('\x1f');return {commit,at,author,message:subject,body:(body||'').trim()};});
      if(!commits.length)continue;
      let batch;try{batch=await reader.git(['cat-file','--batch'],{input:commits.map(c=>c.commit+':'+file).join('\n')+'\n'});}catch{continue;}
      let at=0;const read=[];
      for(const c of commits){
        const nl=batch.indexOf(10,at),headerLine=batch.subarray(at,nl).toString('utf8');at=nl+1;
        if(/ missing$/.test(headerLine)){read.push({...c,repository:reader.key,text:null});continue;}
        const size=Number(headerLine.split(' ')[2]);read.push({...c,repository:reader.key,text:batch.subarray(at,at+size).toString('utf8')});at+=size+1;
      }
      // Oldest first, in the repository's own order: two commits of one second keep theirs.
      read.reverse().forEach((v,i)=>all.push({...v,order:i}));
    }
    // The same commit read from two repositories is one version.
    const unique=[...new Map(all.map(v=>[v.commit,v])).values()].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)||(a.repository===b.repository?a.order-b.order:0));
    return unique;
  }
}
