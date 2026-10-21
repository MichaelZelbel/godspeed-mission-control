import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {atomic,hash,retrying} from './records/store.mjs';
import {inUpdateCopy,updateCopyRoots,updateCopyFiles,updateUntouchedRoots,devicePrivate,devicePrivatePaths} from './file-policy.mjs';
import {partialOf,requireSpace,readBackupManifest} from './archives.mjs';

// THE COPY AN UPDATE MAKES BEFORE IT CHANGES ANYTHING (21 October 2026).
//
// Until then every update first made a full copy of every durable folder and the media: on one
// computer 8.33 GB, about sixteen minutes, and with 5.4 GB free the update refused to start
// ("Creating a backup needs 8.33 GB free"). Nine such copies (36 GB) had piled up there. Most
// of it was work/ (recordings, installers, build copies), which no update writes, and most of
// the rest was already in the folder's own Git history.
//
// Now the copy holds only what an update can change (file-policy.mjs: every durable path but
// work/, never the assistant's undo archive) and the media, and in a folder that is the top of
// its own Git repository only the part of it Git does not already hold:
//   - the commit the folder stood at, kept by a ref of its own (refs/godspeed/update-copies/<name>)
//     so no Git cleanup can lose it, and
//   - the files whose bytes on disk are not the commit's (changed, new, ignored, or checked out
//     with other line endings), byte for byte, and the names of committed files that were deleted.
// A folder without a repository of its own (a new reader, or a folder inside another
// repository) gets those paths copied whole. Either way the copy is checked file by file
// (backup.json), built under a .partial- name and renamed once complete, so one that stops
// part-way leaves nothing, and a ref made for it goes again.
//
// Restoring (archives.mjs restore and restoreSeparateCopy) checks the saved files, takes the
// commit's files byte for byte from the repository (never through its own index or folder),
// leaves out the deleted ones, lays the saved files over them, and then restores that like any
// backup. On the computer it was made on; elsewhere, restore --repository names a clone.

export const updateCopyFormat=2;
export const updateCopyRefs='refs/godspeed/update-copies/';
const pathspecs=[...updateCopyRoots,...updateCopyFiles];
// Git's own filter before ours (inUpdateCopy decides): what no copy ever holds.
const excluded=[':(exclude)work',...devicePrivatePaths.map(p=>':(exclude)'+p),':(exclude,glob)**/node_modules/**',':(exclude,glob)**/.*',':(exclude,glob)**/.*/**'];

function git(cwd,args,{env={},input}={}){
  const run=spawnSync('git',['-C',cwd,...args],{encoding:'buffer',windowsHide:true,maxBuffer:1<<30,timeout:600000,input:input===undefined?undefined:Buffer.from(input,'utf8'),
    // Never a prompt, and never a write to the owner's index (status and diff refresh it otherwise).
    env:{...process.env,GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0',...env}});
  if(run.error)throw run.error;
  if(run.status!==0)throw Object.assign(Error(String(run.stderr||'').trim().split('\n')[0]||('git '+args[0]+' failed')),{code:'GIT_FAILED'});
  return run.stdout;
}
const list=buffer=>buffer.toString('utf8').split('\0').filter(Boolean);
const text=buffer=>buffer.toString('utf8').trim();
const real=p=>{try{return fs.realpathSync.native(p);}catch{return path.resolve(p);}};
const samePath=(a,b)=>{const x=path.resolve(real(a)),y=path.resolve(real(b));return process.platform==='win32'?x.toLowerCase()===y.toLowerCase():x===y;};
// A ref name from a copy's folder name: Git refuses spaces, ~^:?*[\ and a few sequences.
export const refFor=name=>updateCopyRefs+(String(name).replace(/[^A-Za-z0-9._-]+/g,'-').replace(/\.+/g,'.').replace(/^[.-]+|[.-]+$/g,'')||'copy');

// The commit a folder stands at when it is the top of its own repository; null when it is not
// (no Git, no repository, inside another repository, no commit yet, a repository Git refuses).
export function folderCommit(root){
  try{
    const top=text(git(root,['rev-parse','--show-toplevel']));
    if(!top||!samePath(top,root))return null;
    return text(git(root,['rev-parse','--verify','-q','HEAD^{commit}']))||null;
  }catch{return null;}
}

// Every file under a folder, as workspace names, without following links. Dot names, the
// assistant's undo archive and work/ are not entered at all.
const skipped=name=>name.split('/').some(part=>part.startsWith('.')||/^(node_modules|secrets)$/i.test(part))||devicePrivate(name)||updateUntouchedRoots.some(root=>name===root||name.startsWith(root+'/'));
function walk(root,name,out,links){
  const at=path.join(root,...name.split('/'));let info;
  try{info=fs.lstatSync(at);}catch{return;}
  if(info.isSymbolicLink()){links.push(name);return;}
  if(info.isDirectory()){if(!skipped(name))for(const child of fs.readdirSync(at))walk(root,name+'/'+child,out,links);return;}
  if(info.isFile())out.push(name);
}
function regularFiles(root,names){
  const files=[],links=[];
  for(const raw of new Set(names)){const name=raw.replace(/\/+$/,'');if(name)walk(root,name,files,links);}
  return {files:[...new Set(files)].filter(inUpdateCopy).sort(),links:[...new Set(links)].filter(inUpdateCopy).sort()};
}

// A file's Git blob name from its bytes as they are on disk, with no line-ending or other filter:
// what the copy compares first, so every file it leaves to the commit comes back byte for byte.
const blobName=(bytes,algorithm)=>createHash(algorithm).update('blob '+bytes.length+'\0').update(bytes).digest('hex');
const statKey=info=>info.ino+':'+info.size+':'+info.mtimeNs+':'+info.ctimeNs;

// A file whose bytes are not the commit's, but which Git itself calls unchanged: a checkout on a
// computer whose Git turns LF into CRLF (Git for Windows' own default) writes every text file so.
// Saving each would make the copy as big as before there, so such a file is left to the commit
// when Git's own checkout of it (checkout-index, through a private index) gives exactly its bytes,
// which settle() tries once per file; one that does not (mixed line endings) is saved. Restoring
// writes it back the same way and checks it against its bytes as they were (the blob name in
// "converted"); should Git's settings have changed since, the commit's own bytes are written,
// which Git counts as the same file.
function gitUnchanged(root,names,committed,hashed){
  const ask=names.filter(name=>!name.includes('\n')&&hashed.get(name)?.clean===undefined);
  if(ask.length){
    const answers=git(root,['hash-object','--stdin-paths'],{input:ask.join('\n')+'\n'}).toString('utf8').trim().split(/\r?\n/);
    ask.forEach((name,at)=>{hashed.get(name).clean=answers[at]||null;});
  }
  return names.filter(name=>!name.includes('\n')&&hashed.get(name).clean===committed.get(name).oid);
}
function checkOut(repo,commit,names,into){
  const index=path.join(path.dirname(into),'.index-'+randomUUID()),env={GIT_INDEX_FILE:index};
  try{git(repo,['read-tree',commit],{env});git(repo,['checkout-index','-f','-z','--stdin','--prefix='+into.split(path.sep).join('/')+'/'],{env,input:names.join('\0')});}
  finally{fs.rmSync(index,{force:true});}
}
// Moves into view.files each converted file Git's checkout does not give back byte for byte.
function settle(root,view,hashed,scratch){
  if(!view.commit)return view;
  const algorithm=view.commit.length===64?'sha256':'sha1',names=Object.keys(view.converted),ask=names.filter(name=>hashed.get(name).exact===undefined);
  if(ask.length){
    const into=path.join(scratch,'.check-'+randomUUID());fs.mkdirSync(into,{recursive:true});
    try{checkOut(root,view.commit,ask,into);for(const name of ask){let oid=null;try{oid=blobName(fs.readFileSync(path.join(into,...name.split('/'))),algorithm);}catch{}hashed.get(name).exact=oid===hashed.get(name).oid;}}
    finally{fs.rmSync(into,{recursive:true,force:true});}
  }
  const inexact=names.filter(name=>!hashed.get(name).exact);
  for(const name of inexact)delete view.converted[name];
  if(inexact.length)view.files=[...new Set([...view.files,...regularFiles(root,inexact).files])].sort();
  return view;
}

// What the copy holds right now: in a repository, what is not byte for byte in the commit;
// otherwise all of it. hashed remembers blob names by file, so a second look reads only what changed.
function look(root,hashed=new Map()){
  const commit=folderCommit(root);
  if(!commit){
    const {files,links}=regularFiles(root,pathspecs.filter(name=>fs.existsSync(path.join(root,name))));
    return {commit:null,files,links,absent:[],converted:{}};
  }
  const algorithm=commit.length===64?'sha256':'sha1',specs=['--',...pathspecs,...excluded];
  const committed=new Map();
  for(const line of list(git(root,['ls-tree','-r','-z',commit,'--',...pathspecs]))){
    const at=line.indexOf('\t'),[mode,,oid]=line.slice(0,at).split(' '),name=line.slice(at+1);
    if(inUpdateCopy(name)||mode==='160000')committed.set(name,{mode,oid});
  }
  // Staged but not committed, untracked, ignored, and the checkouts of other repositories Git
  // carries as links (mode 160000), whose files are in no history of this folder.
  const extra=[...list(git(root,['ls-files','-z','-s',...specs])).map(line=>{const at=line.indexOf('\t');return {mode:line.slice(0,6),name:line.slice(at+1)};}).filter(entry=>entry.mode==='160000'||!committed.has(entry.name)).map(entry=>entry.name+(entry.mode==='160000'?'/':'')),
    ...list(git(root,['ls-files','-z','--others',...specs]))];
  const absent=[],differ=[];
  for(const [name,entry] of committed){
    if(entry.mode==='160000'){extra.push(name+'/');continue;}
    let info;try{info=fs.lstatSync(path.join(root,...name.split('/')),{bigint:true});}catch{absent.push(name);continue;}
    // A committed link is not restored (Store.restore follows none); a file now in its place is saved.
    if(!info.isFile()){if(entry.mode!=='120000'){absent.push(name);extra.push(name+'/');}continue;}
    if(entry.mode==='120000'){extra.push(name);continue;}
    const key=statKey(info);let known=hashed.get(name);
    if(known?.key!==key){known={key,oid:blobName(fs.readFileSync(path.join(root,...name.split('/'))),algorithm)};hashed.set(name,known);}
    if(known.oid!==entry.oid)differ.push(name);
  }
  const same=new Set(gitUnchanged(root,differ,committed,hashed)),converted={};
  for(const name of differ)if(same.has(name))converted[name]=hashed.get(name).oid;else extra.push(name);
  const {files,links}=regularFiles(root,extra);
  return {commit,files,links,absent:absent.filter(inUpdateCopy).sort(),converted};
}

const sameFile=(a,b)=>!!a&&!!b&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
function copyOne(root,destination,name,copied){
  const source=path.join(root,...name.split('/')),target=path.join(destination,...name.split('/'));let info;
  try{info=fs.lstatSync(source,{bigint:true});}catch(error){if(error.code==='ENOENT'||error.code==='ENOTDIR')return false;throw error;}
  if(!info.isFile())return false;
  if(sameFile(copied.get(name),info))return true;
  fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);
  // A file that changed while it was copied is copied again on the next look.
  let after=null;try{after=fs.lstatSync(source,{bigint:true});}catch{}
  copied.set(name,sameFile(info,after)?info:null);return true;
}
function size(root,names){let bytes=0,count=0;for(const name of names){try{bytes+=fs.statSync(path.join(root,...name.split('/'))).size;count++;}catch{}}return {bytes,count};}
function mediaFiles(mediaRoot){const out=[],links=[];if(fs.existsSync(mediaRoot))for(const child of fs.readdirSync(mediaRoot))walk(mediaRoot,child,out,links);return out;}

// Makes the copy at destination, a new folder. Returns what it holds.
export function makeUpdateCopy(store,mediaRoot,destination){
  destination=path.resolve(destination);
  if(fs.existsSync(destination))throw new Error('Backup destination already exists');
  const root=store.root,hashed=new Map(),first=look(root,hashed),media=mediaFiles(mediaRoot);
  // Room for the files it saves, for those Git converted (checked once and saved should Git not
  // give them back exactly), and for the media.
  const own=size(root,[...first.files,...Object.keys(first.converted)]),pictures=size(mediaRoot,media);
  requireSpace(destination,own.bytes+pictures.bytes,own.count+pictures.count,'Creating a backup');
  const partial=partialOf(destination),name=path.basename(destination);fs.rmSync(partial,{recursive:true,force:true});
  let ref=null,pinned=false;
  try{
    fs.mkdirSync(partial,{recursive:true});
    settle(root,first,hashed,partial);
    // The files are copied without the writer lock and checked again under it, so saves go on
    // while it copies and the copy still holds the folder as it was at one moment (as Store.backup).
    const copied=new Map();for(const file of first.files)copyOne(root,partial,file,copied);
    let now,at,records;
    store.withLockSoon(()=>{
      store.recover();now=settle(root,look(root,hashed),hashed,partial);
      const seen=new Set();for(const file of now.files)if(copyOne(root,partial,file,copied))seen.add(file);
      for(const file of [...copied.keys()])if(!seen.has(file)){fs.rmSync(path.join(partial,...file.split('/')),{force:true});copied.delete(file);}
      at=new Date().toISOString();records=store.scan(true).size;
    });
    if(fs.existsSync(mediaRoot))fs.cpSync(mediaRoot,path.join(partial,'media'),{recursive:true});
    if(now.commit){ref=refFor(name);git(root,['update-ref','-m','Godspeed Mission Control: before an update',ref,now.commit]);pinned=true;}
    const files=[...copied.keys()].sort().map(file=>({path:file,sha256:hash(fs.readFileSync(path.join(partial,...file.split('/'))))}));
    for(const file of mediaFiles(path.join(partial,'media')))files.push({path:'media/'+file,sha256:hash(fs.readFileSync(path.join(partial,'media',...file.split('/'))))});
    const manifest={format:now.commit?updateCopyFormat:1,kind:'update-copy',at,records,workspace:root,scope:{roots:updateCopyRoots,files:updateCopyFiles},
      ...(now.commit?{git:{commit:now.commit,ref},absent:now.absent,converted:now.converted}:{}),...(now.links.length?{links_not_copied:now.links}:{}),files};
    atomic(path.join(partial,'backup.json'),JSON.stringify(manifest,null,2));
    retrying(()=>fs.renameSync(partial,destination),5000);
    const bytes=size(destination,files.map(f=>f.path)).bytes;
    return {path:destination,kind:now.commit?'git':'files',commit:now.commit,ref,files:files.length,bytes,records,absent:now.absent.length};
  }catch(error){
    try{fs.rmSync(partial,{recursive:true,force:true});}catch{}
    if(pinned)try{git(root,['update-ref','-d',ref]);}catch{}
    throw error;
  }
}

// Where an update copy's commit is: the folder it was made from, or the one named.
function repositoryOf(manifest,repository){
  const repo=path.resolve(repository||manifest.workspace||'.'),commit=manifest.git.commit;
  try{git(repo,['cat-file','-e',commit+'^{commit}']);return repo;}
  catch{throw Error('This copy keeps the files that had not changed in the Git history of '+repo+', at commit '+commit.slice(0,12)+', and that commit is not there. Restore it on the computer it was made on, or name the repository that has the commit with --repository.');}
}

// Lays an update copy out as a whole backup in `into` (a new folder): the commit's files, less
// the deleted ones, with the saved files over them, and a manifest of every file. Only read: the
// copy, the repository's index and its working folder stay exactly as they were.
export function materializeUpdateCopy(source,into,{repository}={}){
  const manifest=readBackupManifest(source);
  if(manifest.format!==updateCopyFormat)throw Error('Only a copy made before an update with Git is laid out this way');
  for(const entry of manifest.files){
    const target=path.resolve(source,String(entry?.path));
    if(!target.startsWith(path.resolve(source)+path.sep)||!fs.existsSync(target)||hash(fs.readFileSync(target))!==entry.sha256)throw new Error('Backup integrity mismatch');
  }
  const repo=repositoryOf(manifest,repository),commit=manifest.git.commit;
  if(fs.existsSync(into))throw Error('The folder to lay the copy out in already exists');
  // Room for the commit's files, the saved ones and the media (ls-tree takes plain paths only).
  const tree=list(git(repo,['ls-tree','-r','-l','-z',commit,'--',...pathspecs])).map(line=>{const at=line.indexOf('\t'),[mode,,oid,bytes]=line.slice(0,at).split(/\s+/);return {mode,oid,name:line.slice(at+1),bytes:Number(bytes)||0};}).filter(entry=>inUpdateCopy(entry.name));
  const stored=size(source,manifest.files.map(f=>f.path));
  requireSpace(into,tree.reduce((sum,entry)=>sum+entry.bytes,0)+stored.bytes,tree.length+stored.count,'Restoring a copy made before an update');
  fs.mkdirSync(into,{recursive:true});
  // Each committed file as its bytes were on disk (the copy compared exactly those), straight from
  // the object store. The owner's index and folder are never used, and no hook runs.
  const absent=new Set((manifest.absent||[]).filter(inUpdateCopy));
  const wanted=tree.filter(entry=>/^100(644|755)$/.test(entry.mode)&&!absent.has(entry.name));
  const raw=entries=>{for(let at=0;at<entries.length;at+=2000){
    const batch=entries.slice(at,at+2000),out=git(repo,['cat-file','--batch'],{input:batch.map(entry=>entry.oid+'\n').join('')});
    let offset=0;
    for(const entry of batch){
      const end=out.indexOf(10,offset),header=out.subarray(offset,end).toString('utf8').split(' ');
      if(header[0]!==entry.oid||header[1]!=='blob')throw Error('The repository could not hand back '+entry.name+' of commit '+commit.slice(0,12));
      const bytes=Number(header[2]),file=path.join(into,...entry.name.split('/'));
      fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,out.subarray(end+1,end+1+bytes));
      offset=end+1+bytes+1;
    }
  }};
  raw(wanted);
  // The files Git checked out with other line endings, written back the same way (gitUnchanged).
  const converted=manifest.converted&&typeof manifest.converted==='object'?manifest.converted:{};
  const again=wanted.filter(entry=>typeof converted[entry.name]==='string'&&!entry.name.includes('\n'));
  if(again.length){
    checkOut(repo,commit,again.map(entry=>entry.name),into);
    const algorithm=commit.length===64?'sha256':'sha1';
    raw(again.filter(entry=>{try{return blobName(fs.readFileSync(path.join(into,...entry.name.split('/'))),algorithm)!==converted[entry.name];}catch{return true;}}));
  }
  for(const entry of manifest.files){
    const target=path.join(into,...entry.path.split('/'));
    fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(path.join(source,...entry.path.split('/')),target);
  }
  const files=[],links=[];for(const child of fs.readdirSync(into))walk(into,child,files,links);
  atomic(path.join(into,'backup.json'),JSON.stringify({format:1,kind:'update-copy-laid-out',at:manifest.at,records:manifest.records,source:path.resolve(source),commit,files:files.sort().map(name=>({path:name,sha256:hash(fs.readFileSync(path.join(into,...name.split('/'))))}))},null,2));
  return into;
}

// Runs work(folder) on a whole backup: the source itself, or an update copy laid out beside
// `scratch` for the length of the work and removed afterwards, also when it fails.
export function asWholeBackup(source,scratch,work,options={}){
  const manifest=readBackupManifest(source);
  if(manifest.format!==updateCopyFormat)return work(source,manifest);
  const into=path.join(scratch,'.laid-out-'+Date.now()+'-'+randomUUID().slice(0,8));
  try{materializeUpdateCopy(source,into,options);return work(into,readBackupManifest(into));}
  finally{try{fs.rmSync(into,{recursive:true,force:true});}catch{}}
}
