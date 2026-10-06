import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { threadId } from 'node:worker_threads';
import { randomUUID, createHash } from 'node:crypto';
import { durable,durableRoots,durableFiles,recordsFolder,legacyRecordsFolder,isRecordPath } from '../file-policy.mjs';
import { encode as encodeFile, decode as decodeFile, safe as safeName, candidate, fits, folderFor, nameFor, candidateName, systemPath, isReadable, key as nameKey, childrenOf, own } from './layout.mjs';

export const hash = value => createHash('sha256').update(Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const slug = value => String(value).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'record';
// For new ids and names: German letters spelled out and accents dropped, so a note called
// "Orthopäde Termin" is orthopaede-termin-..., not orthopa-de-termin-... (6 October 2026).
// slug() itself stays as it was, because facts keep the keys it made.
export const readableSlug = value => slug(String(value).replace(/[äÄ]/g, 'ae').replace(/[öÖ]/g, 'oe').replace(/[üÜ]/g, 'ue').replace(/ß/g, 'ss').normalize('NFKD').replace(/[\u0300-\u036f]/g, ''));
export const safe = safeName;
const sleep=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
// Windows scanners can briefly hold a file during an atomic swap or a delete.
export function retrying(work,ms=1500){
  const deadline=Date.now()+ms;
  for(;;){try{return work();}catch(error){
    if(process.platform!=='win32'||!['EPERM','EACCES','EBUSY'].includes(error.code)||Date.now()>=deadline)throw error;
    sleep(25);
  }}
}
// A rename is on disk only once the folder that names the file is: Linux keeps
// it in memory until that folder is synced (until 6 October 2026 only the file
// itself was). Windows cannot open a folder for this, and NTFS needs it not.
export function syncFolder(dir){
  if(process.platform==='win32')return;
  let fd;try{fd=fs.openSync(dir,'r');fs.fsyncSync(fd);}catch{}finally{if(fd!==undefined)try{fs.closeSync(fd);}catch{}}
}
// `sync: false` leaves the folder to the caller, who syncs each folder once
// after many writes (a transaction) instead of once per file.
export function atomic(file, text, { sync = true } = {}) {
  const dir = path.dirname(file); fs.mkdirSync(dir, { recursive: true });
  const tmp = file + '.' + randomUUID() + '.tmp';
  const fd = fs.openSync(tmp, 'wx');
  try {
    try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    retrying(()=>fs.renameSync(tmp,file));
  } catch (error) {
    // A temporary file left in notebook/ would be committed by sync as if it
    // were the owner's (until 6 October 2026 a failed write left it there).
    try{retrying(()=>fs.unlinkSync(tmp),500);}catch{}
    throw error;
  }
  if (sync) syncFolder(dir);
}
// ---- The writer lock ----------------------------------------------------
// One writer at a time, across every program that opens the workspace: the
// server, the sync worker, the command line, the backup thread. The lock file
// names its writer by process, thread and a token of this one acquisition.
const busy=()=>Object.assign(new Error('Workspace is being written by another process'),{code:'WRITER_BUSY'});
const heldLocks=new Set();
// Whether the writer a lock names is gone. Until 6 October 2026 only a process
// that no longer existed counted, so a lock whose number now belonged to an
// unrelated program (after a restart) blocked every save for good, and an
// empty one (a crash between creating and naming it) stopped the workspace
// from opening at all.
function lockIsStale(text,stat){
  let owner=null;try{owner=JSON.parse(text);}catch{}
  // A writer that has just created the lock may not have written its name
  // yet; one still nameless after ten seconds died in between.
  if(!owner||typeof owner!=='object'||!Number.isInteger(owner.pid)||owner.pid<=0)return Date.now()-stat.mtimeMs>=10000;
  const at=Number.isFinite(Date.parse(owner.at))?Date.parse(owner.at):stat.mtimeMs;
  // Written before this computer started: whoever has that number now is not its writer.
  if(at<Date.now()-os.uptime()*1000-60000)return true;
  if(owner.pid===process.pid){
    // This program's own number from before it started is a restarted
    // container's, which reuses numbers; a lock this very thread wrote and no
    // longer holds was left by a release that failed. Any other is another
    // thread of this program (the backup), alive.
    if(at<Date.now()-process.uptime()*1000-1000)return true;
    return typeof owner.token==='string'&&owner.thread===threadId&&!heldLocks.has(owner.token);
  }
  // EPERM: alive but not ours to signal (on Windows, the server the installer's task started).
  try{process.kill(owner.pid,0);return false;}catch(error){return error.code==='ESRCH';}
}
// The lock as it is now, read so that a file replaced while it was read is never taken for the one found.
function lookAt(lock){
  const before=fs.statSync(lock,{bigint:true}),text=fs.readFileSync(lock,'utf8'),after=fs.statSync(lock,{bigint:true});
  if(before.ino!==after.ino||before.mtimeNs!==after.mtimeNs||before.size!==after.size)return null;
  return {text,ino:after.ino,mtimeMs:Number(after.mtimeMs)};
}
// Takes over a lock its writer left behind, one program at a time. Until 6
// October 2026 two programs that both found the same dead writer each removed
// "its" lock, the second removing the first one's fresh lock, and then both
// wrote at once. Now the lock is read again under a short-lived break lock and
// removed only if it is still the very file, with the very bytes, found dead.
// Whatever races here reads as busy, which withLockAsync retries: true means
// the lock is gone and acquisition may be tried once more.
function takeOver(lock){
  let seen;try{seen=lookAt(lock);}catch(error){return error.code==='ENOENT';}
  if(!seen||!lockIsStale(seen.text,seen))return false;
  const breaker=lock+'.break',mine=randomUUID();let fd;
  try{fd=fs.openSync(breaker,'wx');}catch(error){
    // A break lock is held for a moment; one older than ten seconds belongs to
    // a program that died holding it. It is removed, and the next try breaks.
    if(error.code==='EEXIST')try{if(Date.now()-fs.statSync(breaker).mtimeMs>10000)fs.unlinkSync(breaker);}catch{}
    return false;
  }
  try{
    fs.writeFileSync(fd,mine);
    let again;try{again=lookAt(lock);}catch(error){return error.code==='ENOENT';}
    if(!again||again.ino!==seen.ino||again.text!==seen.text||!lockIsStale(again.text,again))return false;
    try{fs.unlinkSync(lock);}catch(error){return error.code==='ENOENT';}
    return true;
  }catch{return false;}
  finally{try{fs.closeSync(fd);}catch{}try{if(fs.readFileSync(breaker,'utf8')===mine)fs.unlinkSync(breaker);}catch{}}
}
// Releasing the lock must not fail on a scanner's brief hold: a lock left
// behind names this process, which is alive, so every later write elsewhere
// would wait on it. Only this acquisition's own lock is removed, never one
// another writer has put there since.
function release(lock,token,ino){
  let text,stat;try{stat=fs.statSync(lock,{bigint:true});text=fs.readFileSync(lock,'utf8');}catch(error){if(error.code==='ENOENT')return;throw error;}
  let owner=null;try{owner=JSON.parse(text);}catch{}
  if(owner?.token!==token&&!(owner===null&&ino&&stat.ino===ino))return;
  try{retrying(()=>fs.unlinkSync(lock),3000);}catch(error){if(error.code!=='ENOENT')throw error;}
}
// A record's file: readable Markdown with YAML frontmatter for what a person
// reads, JSON for machine bookkeeping (see layout.mjs). decode() throws an
// error whose code is NOT_RECORD for an owner's own Markdown page.
export const encode = encodeFile;
export const decode = decodeFile;
const posix = file => file.split(path.sep).join('/');
// The ids a record answered to before (a rename, a merge). Until 6 October
// 2026 they went into `aliases`, which for a person are nicknames and for a
// note Obsidian's alternative titles: two people called "Lexi" were then one
// identity twice, and the second could not be saved. Ids already written into
// aliases are still found, but names are never checked for uniqueness.
export const identityIds = record => [record.id, ...(record.former_ids || [])];
export const answersTo = (record, id) => record.id === id || (record.former_ids || []).includes(id) || (record.aliases || []).includes(id);
// A copy that shares the (immutable) strings: what structuredClone did per
// record and per read, at a fraction of the cost, since a note's text is
// most of its size.
// Own keys only, each set as data: a "__proto__" key is copied as a key, not
// made the copy's prototype (until 6 October 2026 it was).
export function copy(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(copy);
  const out = {}; for (const key of Object.keys(value)) own(out, key, copy(value[key])); return out;
}
// The records the store holds are frozen: they live as long as their files
// do not change, so code that changed one in place instead of a copy would
// change what the next save writes. It fails loudly instead.
// GODSPEED_FREEZE_RECORDS=0 turns this off.
const freezing = process.env.GODSPEED_FREEZE_RECORDS !== '0';
function deepFreeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const key of Object.keys(value)) deepFreeze(value[key]); } return value; }
// What is wrong with a set of records as a whole. Each problem carries a key
// that names it, so a write can tell the problems it would add from those the
// notebook already has.
function integrity(records){
  const problems=[],uids=new Map(records.map(r=>[r.uid,r]));
  const keys=new Set(records.flatMap(r=>[r.type+'/'+r.id,...[...(r.former_ids||[]),...(r.aliases||[])].map(a=>r.type+'/'+a)]));
  for(const r of records)for(const ref of r.references||[]){
    const target=ref.uid?uids.get(ref.uid):null;
    if(!(ref.uid?target&&target.type===ref.type&&answersTo(target,ref.id):keys.has(ref.type+'/'+ref.id)))problems.push({record:r.id,error:'Missing or inconsistent reference',reference:ref,key:['reference',r.type,r.id,ref.type,ref.id,ref.uid||'',ref.field||''].join('\0')});
  }
  const ids=new Set(),aliases=new Map();
  for(const r of records){
    if(ids.has(r.uid))problems.push({error:'Duplicate UUID',key:'uid\0'+r.uid});ids.add(r.uid);
    if(!r.removed_at)for(const alias of identityIds(r)){const key=r.type+'/'+String(alias).toLowerCase();if(aliases.has(key)&&aliases.get(key)!==r.uid)problems.push({error:'Ambiguous case-insensitive identity or alias',alias,key:'alias\0'+key});aliases.set(key,r.uid);}
  }
  return {problems,keys:new Set(problems.map(p=>p.key))};
}
const referenceProblems=checked=>checked.problems.filter(p=>p.error==='Missing or inconsistent reference').map(({key,...problem})=>problem);
// One durable file or folder copied into a backup. `copied` notes the file
// each copy was taken from, by its identity, size and times; one taken from a
// file unchanged since is not copied again. `seen` collects what is there now.
function copyInto(root,destination,name,copied,seen=null){
  const source=path.join(root,...name.split('/')),target=path.join(destination,...name.split('/'));let info;
  try{info=fs.lstatSync(source,{bigint:true});}catch(error){if(error.code==='ENOENT'||error.code==='ENOTDIR')return;throw error;}
  if(info.isSymbolicLink())throw new Error('Archive cannot follow symbolic links');
  if(info.isDirectory()){fs.mkdirSync(target,{recursive:true});for(const child of fs.readdirSync(source))copyInto(root,destination,name+'/'+child,copied,seen);return;}
  if(!info.isFile())return;
  seen?.add(name);
  if(sameFile(copied.get(name),info))return;
  fs.copyFileSync(source,target);
  // A file that changed while it was copied is copied again on the next look.
  let after=null;try{after=fs.lstatSync(source,{bigint:true});}catch{}
  copied.set(name,sameFile(info,after)?info:null);
}
const sameFile=(a,b)=>!!a&&!!b&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
// A file's bytes, or null when there is none.
function readOrNull(file){try{return fs.readFileSync(file);}catch(error){if(error.code==='ENOENT'||error.code==='ENOTDIR')return null;throw error;}}
const MISSING='missing';
function stateOf(file){try{return hash(fs.readFileSync(file));}catch(error){return error.code==='ENOENT'||error.code==='ENOTDIR'?MISSING:error.code==='EISDIR'?'folder':'unreadable';}}
const finished=dir=>fs.existsSync(path.join(dir,'completed'))||fs.existsSync(path.join(dir,'rolled-back'));
// The order transactions were prepared in, which is the order they are
// replayed in. One prepared before 6 October 2026 is placed by when it was.
let sequence=0;
const nextOrder=()=>String(Date.now()).padStart(15,'0')+'-'+String(++sequence).padStart(9,'0');
function preparedOrder(dir){
  const file=path.join(dir,'prepared');
  try{const order=JSON.parse(fs.readFileSync(file,'utf8'))?.order;if(typeof order==='string')return order;}catch{}
  try{return String(Math.floor(fs.statSync(file).mtimeMs)).padStart(15,'0')+'-0';}catch{return '';}
}
export class Store {
  constructor(root, { device = 'local', failAfter = null, watch = false } = {}) {
    this.root = path.resolve(root); this.device = safe(device); this.failAfter = failAfter;
    this.recordsRoot = path.join(this.root, recordsFolder); this.state = path.join(this.root, '.godspeed');
    fs.mkdirSync(this.state, { recursive: true });
    this.withLock(() => { this.moveLegacyRecords(); fs.mkdirSync(this.recordsRoot, { recursive: true }); this.recover(); });
    if (watch) this.watch(); else this.scan();
  }
  // Records lived in records/ until 2026-10-05. A workspace that still has that
  // folder, and no notebook folder yet, has it renamed once, before any pending
  // transaction is replayed into it.
  moveLegacyRecords() {
    const legacy = path.join(this.root, legacyRecordsFolder);
    if (fs.existsSync(this.recordsRoot) || !fs.existsSync(legacy) || !fs.lstatSync(legacy).isDirectory()) return;
    fs.renameSync(legacy, this.recordsRoot);
  }
  withLock(fn) {
    const lock = path.join(this.state, 'workspace.lock'), token = randomUUID();
    let fd;
    for (let tries = 0; ; tries++) {
      try { fd = fs.openSync(lock, 'wx'); break; } catch (e) {
        // Windows answers EPERM while a just-released lock file is still held by a
        // scanner or another process's handle: a busy workspace, retried by
        // withLockAsync, not an error the owner sees (until 6 October 2026 it was).
        if (process.platform === 'win32' && ['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw busy();
        if (e.code !== 'EEXIST') throw e;
        if (tries || !takeOver(lock)) throw busy();
      }
    }
    // The file is the lock, not its open handle, which is closed at once: a
    // workspace move renames the folder under the lock, and Windows refuses to
    // rename a folder that holds an open file.
    let ino;
    try { ino = fs.fstatSync(fd, { bigint: true }).ino; fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, thread: threadId, token, at: new Date().toISOString() })); fs.fsyncSync(fd); }
    catch (error) { try { fs.closeSync(fd); } catch {} try { release(lock, token, ino); } catch {} throw error; }
    fs.closeSync(fd);
    heldLocks.add(token); this.holding = (this.holding || 0) + 1;
    try { return fn(); }
    finally { this.holding--; heldLocks.delete(token); release(lock, token, ino); }
  }
  // Waits until the writer lock is free, or its writer gone ('stale': the next
  // acquisition takes it over).
  async waitForWriter({signal,timeoutMs=30000}={}) {
    const lock=path.join(this.state,'workspace.lock'),until=Date.now()+timeoutMs;
    for(;;){
      signal?.throwIfAborted();
      let seen=null;try{seen=lookAt(lock);}catch(error){if(error.code==='ENOENT'){signal?.throwIfAborted();return;}}
      if(seen&&lockIsStale(seen.text,seen))return 'stale';
      if(Date.now()>=until)throw Error('Workspace is still being written. Your request has not been repeated.');
      await new Promise(resolve=>setTimeout(resolve,25));
    }
  }
  async withLockAsync(fn,{signal,timeoutMs=30000}={}) {
    const deadline=Date.now()+timeoutMs;
    for(;;){
      signal?.throwIfAborted();let entered=false;
      try{return this.withLock(()=>{entered=true;return fn();});}
      catch(error){
        // Retry only acquisition. Once a transaction callback has started, its
        // failure is uncertain and must never replay its work automatically.
        if(entered||error.code!=='WRITER_BUSY')throw error;
        const remaining=deadline-Date.now();if(remaining<=0)throw Error('Workspace is still being written. Your request has not been repeated.');
        // A stale lock another program is taking over this very moment: a short pause, not a busy loop.
        if(await this.waitForWriter({signal,timeoutMs:remaining})==='stale')await new Promise(resolve=>setTimeout(resolve,5+Math.random()*20));
      }
    }
  }
  // Where a record's file is now, or where a new one would be written.
  file(record) {
    if (!this.records) this.scan();
    const current = this.fileOf.get(record.type + '/' + record.id);
    if (current) return current;
    return path.join(this.recordsRoot, ...this.planPaths([record]).targets.get(record.type + '/' + record.id).split('/'));
  }
  // One read of the vault serves every step inside. A note save read all of it
  // four times - once to find the record, once per get, twice in the commit -
  // and on a real workspace that was almost the whole cost of saving. Nothing
  // else can write while the caller holds the workspace lock, so re-reading
  // between those steps could not learn anything new. A write still refreshes
  // the view itself, through scan(true), before anyone reads what it wrote.
  snapshot(fn) {
    if (this.snapshotDepth) return fn();
    this.scan(); this.snapshotDepth = 1;
    try { return fn(); } finally { this.snapshotDepth = 0; }
  }
  // A program that watches the vault (the notebook server) may let reads reuse
  // the last full read for `reuseFor` milliseconds, and calls invalidate() on
  // every change it sees. Reads made while this process holds the writer lock
  // always read the vault as it is, so a write never acts on a reused view.
  invalidate() { this.stale = true; }
  scan(force = false) {
    if (this.snapshotDepth && !force && this.records) return this.records;
    // A store that watches the folder (the notebook server) re-reads only the
    // files the watcher or another writer's change journal named. Reading all
    // of them per request is what held the server: on a real imported
    // workspace (16,000 files, 114 MB) a read took longer than the two
    // seconds it was allowed to be reused, so an open dashboard kept the
    // server reading for 138 of 240 seconds and the health check waited 30.
    if (!force && this.watching && this.records) { this.readJournal(); if (!this.dirtyAll) { this.applyDirty(); return this.records; } force = true; }
    if (!force && this.reuseFor && this.records && !this.holding && !this.stale && Date.now() - this.scannedAt < this.reuseFor) return this.records;
    this.stale = false; this.scannedAt = Date.now(); this.dirtyAll = false; this.dirty?.clear();
    // How often the vault was actually read, which is what a save costs.
    this.reads = (this.reads || 0) + 1;
    // Every record file under notebook/, at any depth. Dot folders (an
    // editor's own settings, its trash) and linked folders are not the
    // notebook's.
    const files=[],walk=(dir,relative)=>{
      let entries;try{entries=fs.readdirSync(dir,{withFileTypes:true});}catch(error){if(error.code==='ENOENT'||error.code==='ENOTDIR')return;throw error;}
      for(const entry of entries){
        if(entry.name.startsWith('.')||entry.isSymbolicLink())continue;
        const name=relative?relative+'/'+entry.name:entry.name,file=path.join(dir,entry.name);
        if(entry.isDirectory())walk(file,name);else if(entry.isFile()&&candidate(name))files.push([file,name]);
      }
    };
    walk(this.recordsRoot,'');
    const prior=this.entries||new Map(),entries=new Map();
    for(const [file,name] of files){const entry=this.readEntry(file,name,prior.get(file));if(entry)entries.set(file,entry);}
    this.entries=entries;
    return this.derive();
  }
  // One file as the store holds it: its text and either its record, the fact
  // that it is an owner's own page, or the problem that keeps it from being
  // read. The text is kept so that a file reported as changed but holding the
  // same bytes costs one read and nothing more. Always actual bytes: metadata
  // misses in-place edits and restored timestamps.
  readEntry(file,name,previous){
    let text;try{text=fs.readFileSync(file,'utf8');}catch(error){if(error.code==='ENOENT'||error.code==='EISDIR'||error.code==='ENOTDIR')return null;return {name,problem:error.message};}
    if(previous&&previous.text===text&&previous.name===name)return previous;
    try{const record=decode(text,file);record._hash=hash(encode(record));if(freezing)deepFreeze(record);return {name,text,record};}
    catch(error){
      // An owner's own page in the notebook folder is not a record. A file
      // that held a record a moment ago and lost its frontmatter is.
      if(error.code==='NOT_RECORD'&&(previous?.record||previous?.lost))return {name,text,lost:true,problem:'This file held a record and lost its frontmatter'};
      if(error.code==='NOT_RECORD')return {name,text,document:true};
      return {name,text,problem:error.message};
    }
  }
  // The store's view from what it holds per file. No file is read here.
  derive(){
    const before=this.records;
    const records = new Map(), problems = [], uids = new Map(), aliases = new Map(), fileOf = new Map(), keyOfUid = new Map(), documents = new Set();
    // Which file names are in use, compared as a file system that ignores case
    // would (null for a page that is not a record), and who holds each file.
    const pathIndex=new Map(),keyOfFile=new Map(),index=(name,key)=>{const k=nameKey(name),list=pathIndex.get(k);if(list)list.push(key);else pathIndex.set(k,[key]);};
    for(const [file,entry] of this.entries){
      if(entry.document){documents.add(file);index(entry.name,null);continue;}
      if(entry.problem){problems.push({file,error:entry.problem});continue;}
      try{
        const record=entry.record,key=record.type+'/'+record.id;
        if (uids.has(record.uid)) problems.push({ file, error: 'Duplicate UUID', other: uids.get(record.uid) });
        uids.set(record.uid, key); records.set(key, record); fileOf.set(key, file); keyOfUid.set(record.uid, key); keyOfFile.set(file, key); index(entry.name, key);
        for (const alias of record.removed_at ? [] : identityIds(record)) {
          const akey = record.type + '/' + alias.toLowerCase();
          if (aliases.has(akey) && aliases.get(akey) !== key) problems.push({ file, error: 'Ambiguous alias', alias });
          aliases.set(akey, key);
        }
      }catch(e){problems.push({file,error:e.message});}
    }
    this.records = records; this.fileOf = fileOf; this.keyOfUid = keyOfUid; this.pathIndex = pathIndex; this.keyOfFile = keyOfFile; this.documents = documents; this.problems = problems; this.lastScan = new Date().toISOString();
    const checked=integrity([...records.values()]);this.integrityFor=records;this.integrityNow=checked;
    this.problems.push(...referenceProblems(checked),...this.setAsideProblems());
    this.byTypeCache=null;this.byTypeFor=records;
    if(before&&this.listeners?.size)this.announce(before,records);
    return records;
  }
  // Kept under its old name for the tests that count what the store holds.
  get decodedCache(){return this.entries;}
  // Records of one type, without filtering every record of every type.
  ofType(type){
    // A transaction's or a guard's view (Object.create of the store) holds a
    // records map of its own and changes it in place: no cache for those.
    if(this.byTypeFor!==this.records)return [...this.records.values()].filter(r=>r.type===type);
    if(!this.byTypeCache){this.byTypeCache=new Map();for(const record of this.records.values()){let list=this.byTypeCache.get(record.type);if(!list)this.byTypeCache.set(record.type,list=[]);list.push(record);}}
    return this.byTypeCache.get(type)||[];
  }
  // Who wants to hear which records changed (the search index): the records
  // now current, and the records gone or removed since the last view.
  onChange(listener){(this.listeners||=new Set()).add(listener);return ()=>this.listeners.delete(listener);}
  announce(before,after){
    const changed=[],gone=[];
    for(const [key,record] of after){const old=before.get(key);if(!old||old._hash!==record._hash)changed.push(record);}
    for(const [key,record] of before)if(!after.has(key)||after.get(key).uid!==record.uid)gone.push(record);
    if(!changed.length&&!gone.length)return;
    for(const listener of this.listeners)try{listener({changed,gone});}catch{}
  }
  // ---- Watching the folder -------------------------------------------------
  // The notebook server watches notebook/ and tells the store which files
  // changed; the store then reads only those. Writers in other processes (the
  // sync worker, the command line) also append the files they wrote to a
  // change journal, so a write made under the workspace lock sees them at
  // once, before the watcher has delivered its events.
  watch(){
    if(this.watching)return;
    this.dirty=new Set();this.dirtyAll=false;
    this.journalFile=path.join(this.state,'changes.log');
    // Watch first, then note the journal, then read everything: a change made
    // in between is at worst read twice, never missed.
    const start=()=>{
      try{
        this.watcher=fs.watch(this.recordsRoot,{recursive:true},(event,name)=>this.touched(name==null?null:String(name)));
        this.watcher.on('error',()=>{this.dirtyAll=true;try{this.watcher.close();}catch{}this.watcher=null;this.rewatch=setTimeout(start,1000);this.rewatch.unref?.();});
      }catch{this.dirtyAll=true;this.rewatch=setTimeout(start,1000);this.rewatch.unref?.();}
    };
    fs.mkdirSync(this.recordsRoot,{recursive:true});start();
    this.journalAt=this.journalPosition();
    this.scan(true);this.watching=true;
  }
  unwatch(){this.watching=false;clearTimeout(this.rewatch);try{this.watcher?.close();}catch{}this.watcher=null;}
  // A path relative to notebook/; null means "something changed, I cannot
  // say what" (an overflowing watcher), which costs one full read.
  touched(name){
    if(name==null){this.dirtyAll=true;return;}
    const relative=name.split('\\').join('/').replace(/^\/+/,'');
    if(!relative){this.dirtyAll=true;return;}
    if(relative.split('/').some(part=>part.startsWith('.')))return;
    this.dirty.add(relative);
  }
  applyDirty(){
    if(!this.dirty.size)return false;
    const names=[...this.dirty];this.dirty.clear();
    const byKey=new Map();for(const [file,entry] of this.entries){const k=nameKey(entry.name);byKey.set(k,[...(byKey.get(k)||[]),file]);}
    // A name as its folder spells it now, or null. On a file system that
    // ignores case, plan.md still opens after another program renamed it
    // Plan.md, so a name only counts once its folder lists it that way: until
    // 6 October 2026 the store then held the record under both spellings, as
    // a duplicate.
    const listings=new Map(),listing=dir=>{if(!listings.has(dir)){let list=null;try{list=fs.readdirSync(dir);}catch{}listings.set(dir,list);}return listings.get(dir);};
    const spelled=name=>{let dir=this.recordsRoot;const out=[];for(const part of name.split('/')){const list=listing(dir),real=list&&(list.includes(part)?part:list.find(n=>nameKey(n)===nameKey(part)));if(!real)return null;out.push(real);dir=path.join(dir,real);}return out.join('/');};
    const absolute=name=>path.join(this.recordsRoot,...name.split('/')),affected=new Map();
    const walk=(dir,relative)=>{let list;try{list=fs.readdirSync(dir,{withFileTypes:true});}catch{return;}for(const e of list){if(e.name.startsWith('.')||e.isSymbolicLink())continue;const n=relative+'/'+e.name,f=path.join(dir,e.name);if(e.isDirectory())walk(f,n);else if(e.isFile()&&candidate(n))affected.set(f,n);}};
    for(const name of names){
      const key=nameKey(name);for(const file of byKey.get(key)||[])affected.set(file,this.entries.get(file).name);
      const real=spelled(name);
      let stat=null;if(real)try{stat=fs.lstatSync(absolute(real));}catch(error){if(error.code!=='ENOENT'&&error.code!=='ENOTDIR')throw error;}
      if(stat?.isFile()){if(candidate(real))affected.set(absolute(real),real);continue;}
      if(stat?.isSymbolicLink())continue;
      // A folder: renamed, moved, deleted or new. Everything known under it
      // and everything now in it is read again.
      const prefix=key+'/';for(const [file,entry] of this.entries)if(nameKey(entry.name).startsWith(prefix))affected.set(file,entry.name);
      if(stat?.isDirectory())walk(absolute(real),real);
    }
    let changed=false;
    const read=(file,name)=>{const previous=this.entries.get(file),entry=this.readEntry(file,name,previous);if(entry===previous)return;changed=true;if(entry)this.entries.set(file,entry);else this.entries.delete(file);};
    for(const [file,name] of affected){
      const real=spelled(name);
      if(real===name){read(file,name);continue;}
      // Gone, or spelled otherwise now: the old spelling holds nothing any more.
      if(this.entries.delete(file))changed=true;
      if(real&&candidate(real)&&!affected.has(absolute(real)))read(absolute(real),real);
    }
    if(changed){this.dirtyChanges=(this.dirtyChanges||0)+1;this.derive();}
    return changed;
  }
  // A watching store learns of an edit made outside the notebook (Obsidian,
  // the assistant editing a file) only once the watcher's event has been
  // handled, which can be after a save of the same record arrived. Under the
  // lock, exactly the files a write will overwrite or delete are read again
  // first, so the save is compared with what is really there and the version
  // it replaces goes into the history (until 6 October 2026 such an edit was
  // overwritten, with no conflict and no history copy). True if any changed.
  freshen(files){
    if(!this.watching||!this.entries)return false;
    let changed=false,vanished=false;
    for(const file of new Set(files)){
      const previous=file&&this.entries.get(file);if(!previous)continue;
      const entry=this.readEntry(file,previous.name,previous);if(entry===previous)continue;
      changed=true;if(entry)this.entries.set(file,entry);else{this.entries.delete(file);vanished=true;}
    }
    // A file that went (renamed in Obsidian, say) is looked for everywhere.
    if(vanished)this.scan(true);else if(changed)this.derive();
    return changed;
  }
  journalPosition(){try{const fd=fs.openSync(this.journalFile||path.join(this.state,'changes.log'),'r');try{const head=Buffer.alloc(64),n=fs.readSync(fd,head,0,64,0);return {epoch:head.subarray(0,n).toString('utf8').split('\n')[0],size:fs.fstatSync(fd).size};}finally{fs.closeSync(fd);}}catch(error){if(error.code==='ENOENT')return {epoch:null,size:0};throw error;}}
  readJournal(){
    const now=this.journalPosition(),was=this.journalAt||{epoch:null,size:0};
    if(now.epoch===was.epoch&&now.size===was.size)return;
    this.journalAt=now;
    if(now.epoch!==was.epoch&&was.epoch!==null||now.size<was.size){this.dirtyAll=true;return;}
    const from=now.epoch===was.epoch?was.size:0,fd=fs.openSync(this.journalFile,'r');
    try{
      const buffer=Buffer.alloc(now.size-from);fs.readSync(fd,buffer,0,buffer.length,from);
      for(const line of buffer.toString('utf8').split('\n')){
        if(!line||line.startsWith('#'))continue;
        const tab=line.indexOf('\t'),writer=line.slice(0,tab),name=line.slice(tab+1);
        if(writer===this.writerId)continue;
        if(name==='*'){this.dirtyAll=true;return;}
        this.touched(name);
      }
    }finally{fs.closeSync(fd);}
  }
  // Tell every watching store which files under notebook/ this process
  // wrote ('*' for "anything may have changed"). Writers hold the workspace
  // lock, so lines never interleave. A journal past four megabytes starts
  // over under a new epoch, which a reader answers with one full read.
  journal(names){
    if(!names.length)return;
    const file=path.join(this.state,'changes.log');
    let epoch=null;try{const stat=fs.statSync(file);if(stat.size<4*1024*1024)epoch=true;}catch(error){if(error.code!=='ENOENT')throw error;}
    if(!epoch)fs.writeFileSync(file,'#'+randomUUID()+'\n');
    // Tagged per store, not per process: two stores in one process (an
    // import beside the server) must still see each other's writes.
    this.writerId||=process.pid+'-'+randomUUID().slice(0,8);
    fs.appendFileSync(file,names.map(name=>this.writerId+'\t'+name+'\n').join(''));
  }
  // The watcher's safety net, run now and then in the background: a file
  // whose size or time differs from what the store read is read again.
  async verify(){
    if(!this.watching)return 0;
    const io=fs.promises,seen=new Set();let marked=0;
    const walk=async(dir,relative)=>{
      let list;try{list=await io.readdir(dir,{withFileTypes:true});}catch{return;}
      for(const e of list){
        if(e.name.startsWith('.')||e.isSymbolicLink())continue;
        const name=relative?relative+'/'+e.name:e.name,file=path.join(dir,e.name);
        if(e.isDirectory()){await walk(file,name);continue;}
        if(!e.isFile()||!candidate(name))continue;
        seen.add(file);
        let stat;try{stat=await io.stat(file);}catch{continue;}
        const entry=this.entries.get(file);
        // The first look at a file only notes its size and time, unless it
        // changed around the time it was read.
        if(!entry||entry.size!==undefined&&(entry.size!==stat.size||entry.mtimeMs!==stat.mtimeMs)||entry.size===undefined&&stat.mtimeMs>(this.scannedAt||0)-3000){this.touched(name);marked++;}
        if(entry){entry.size=stat.size;entry.mtimeMs=stat.mtimeMs;}
      }
    };
    await walk(this.recordsRoot,'');
    for(const [file,entry] of this.entries)if(!seen.has(file)){this.touched(entry.name);marked++;}
    return marked;
  }
  validateReferences(records) { return referenceProblems(integrity(records)); }
  // Callers get copies: a record they change is theirs, never the view's.
  list(type, { removed = false } = {}) { this.scan(); return this.ofType(type).filter(r => removed || !r.removed_at).map(copy); }
  get(type, id) { this.scan(); const record = this.records.get(type + '/' + id) || this.ofType(type).find(r => (r.former_ids || []).includes(id)) || this.ofType(type).find(r => (r.aliases || []).includes(id)); return record && copy(record); }
  prepare(type, value, old = null) {
    const now = new Date().toISOString(), uid = old?.uid || value.uid || randomUUID();
    const id = old?.id || value.id || readableSlug(value.name || value.title || type) + '-' + uid.slice(0, 8);
    const record = { tags: [], aliases: [], references: [], metadata: {}, user_id: 'owner', ...old, ...value,
      format: 1, type: safe(type), id: safe(id), uid, device: old?.device || this.device,
      revision: (old?.revision || 0) + 1, created_at: old?.created_at || value.created_at || now, updated_at: now };
    delete record._hash;
    if (type === 'notes') Object.assign(record, { is_favorite: false, is_pinned: false, is_trashed: false,
      folder_path: '', structured_fields: {}, related: [], ai_visibility: 'visible', ...record });
    return record;
  }
  save(type, value, expectedHash) {
    return this.withLock(() => this.saveUnderLock(type,value,expectedHash));
  }
  saveAsync(type,value,expectedHash,options) {
    return this.withLockAsync(()=>this.saveUnderLock(type,value,expectedHash),options);
  }
  // Stage a complete record operation under one writer lock and publish once.
  // Reads through the staged view see earlier changes, without nested locks.
  transaction(work) {
    return this.withLock(()=>{
      this.scan();const before=new Map(this.records),changed=new Map(),files=new Map(),view=Object.create(this);
      view.records=new Map(before);view.scan=()=>view.records;view.withLock=fn=>fn();
      view.get=(type,id)=>view.records.get(type+'/'+id)||[...view.records.values()].find(r=>r.type===type&&(r.former_ids||[]).includes(id))||[...view.records.values()].find(r=>r.type===type&&(r.aliases||[]).includes(id))||null;
      view.list=(type,{removed=false}={})=>[...view.records.values()].filter(r=>r.type===type&&(removed||!r.removed_at));
      view.commit=(records,options={})=>{for(const item of options.files||[])files.set(item.file,item);for(const raw of records){const record={...raw};delete record._hash;const key=record.type+'/'+record.id;changed.set(key,record);view.records.set(key,{...record,_hash:hash(encode(record))});}};
      const result=work(view,changed,before,files);
      if(result&&typeof result.then==='function')throw Error('Record transactions must finish synchronously');
      // A record edited outside since the work read it is not overwritten unseen.
      if(this.freshen([...changed.keys()].map(key=>this.fileOf.get(key))))for(const [key,record] of changed){const seen=before.get(key),now=this.records.get(key);if(seen&&now&&seen._hash!==now._hash)this.conflict(record.type,record,copy(now));}
      this.commit([...changed.values()],{files:[...files.values()]});return result;
    });
  }
  saveUnderLock(type,value,expectedHash) {
      let old = value.id ? this.get(type, value.id) : null;
      if (old && this.freshen([this.fileOf.get(old.type + '/' + old.id)])) old = this.get(type, value.id);
      if (expectedHash !== undefined && expectedHash !== (old?._hash || null)) {
        this.conflict(type,value,old);
      }
      if (type === 'moments' && old) throw new Error('Events are append-only; add a correction event');
      const record = this.prepare(type, value, old); this.commit([record]); return record;
  }
  conflict(type,value,old,base=null){
    const conflict = { id: randomUUID(), type, record_id: old?.id||value.id, kind:'stale-write',base,local:{...old,...value}, remote: old, at: new Date().toISOString() };
    atomic(path.join(this.root, 'conflicts', conflict.id + '.json'), JSON.stringify(conflict, null, 2));
    const error = new Error('This record changed. Both versions were saved for review.'); error.code = 'CONFLICT'; throw error;
  }
  // The file each of these records is written to, relative to notebook/. A
  // record keeps a file that still fits it; otherwise it goes to its folder
  // under its own name, with " 2", " 3" for a name another file there already
  // has, compared as a file system that ignores case would. Renaming a parent
  // (a collection) also moves the records placed under it: `moved`.
  planPaths(records,{removeKeys=[],forced=null,proposed=null,cascade=true}={}){
    if(!this.records)this.scan();
    const keyOf=r=>r.type+'/'+r.id,relative=file=>posix(path.relative(this.recordsRoot,file));
    const view=proposed||new Map([...this.records,...records.map(r=>[keyOf(r),r])]),find=(type,id)=>view.get(type+'/'+id);
    const batch=new Map(records.map(r=>[keyOf(r),r])),moved=[];
    if(cascade)for(const record of records)for(const child of childrenOf.get(record.type)||[])for(const [k,r] of this.records){
      if(r.type!==child.type||r[child.field]!==record.id||batch.has(k))continue;
      const file=this.fileOf.get(k);if(!file||fits(r,relative(file),find))continue;
      const copy={...r};delete copy._hash;moved.push(copy);batch.set(k,copy);
    }
    const all=[...records,...moved],moving=new Set([...removeKeys,...all.map(keyOf)]);
    // A structural rename gives a record a new id; its file is the old one's.
    const currentOf=r=>{const file=this.fileOf.get(keyOf(r));if(file)return file;const old=this.keyOfUid?.get(r.uid);return old&&moving.has(old)?this.fileOf.get(old):undefined;};
    const freed=new Set(),listings=new Map(),claimed=new Map();
    for(const k of moving)if(this.fileOf.has(k))freed.add(this.fileOf.get(k));
    // Who holds a file name: a record not moving, a page (null), or nobody.
    const takenBy=k=>{if(claimed.has(k))return claimed.get(k);const holder=(this.pathIndex?.get(k)||[]).find(h=>h===null||!moving.has(h));return holder;};
    const entries=dir=>{if(!listings.has(dir)){let names=[];try{names=fs.readdirSync(path.join(this.recordsRoot,...dir.split('/').filter(Boolean)));}catch(error){if(error.code!=='ENOENT'&&error.code!=='ENOTDIR')throw error;}listings.set(dir,names);}return listings.get(dir);};
    // Anything else already there (a folder, a picture, a file being moved in
    // the same write is not) keeps its name.
    const onDisk=rel=>{const dir=path.posix.dirname(rel),base=path.posix.basename(rel),folder=dir==='.'?'':dir;return entries(folder).some(name=>nameKey(name)===nameKey(base)&&!freed.has(path.join(this.recordsRoot,...folder.split('/').filter(Boolean),name)));};
    // A folder that exists, or that this write already uses, in another letter
    // case is used as it is spelled: two spellings would be one folder on
    // Windows and macOS. A folder holding nothing but files moving out of it
    // (the one-folder-per-type layout being converted) does not count.
    const absolute=dir=>path.join(this.recordsRoot,...dir.split('/').filter(Boolean)),kept=new Map();
    const holds=dir=>{if(!kept.has(dir)){let names=[];try{names=fs.readdirSync(absolute(dir),{withFileTypes:true});}catch{}kept.set(dir,names.some(e=>e.isDirectory()?holds((dir?dir+'/':'')+e.name):!freed.has(path.join(absolute(dir),e.name))));}return kept.get(dir);};
    const folders=new Map();
    const spelled=folder=>folder.split('/').filter(Boolean).reduce((done,part)=>{
      const here=(done?done+'/':'')+part,claimed=folders.get(nameKey(here));if(claimed)return claimed;
      const match=entries(done).find(name=>nameKey(name)===nameKey(part)&&holds((done?done+'/':'')+name));return (done?done+'/':'')+(match||part);
    },'');
    const targets=new Map(),claim=(k,rel)=>{targets.set(k,rel);claimed.set(nameKey(rel),k);const parts=rel.split('/');for(let i=1;i<parts.length;i++)if(!folders.has(nameKey(parts.slice(0,i).join('/'))))folders.set(nameKey(parts.slice(0,i).join('/')),parts.slice(0,i).join('/'));};
    if(forced)for(const r of all)if(forced.has(keyOf(r)))claim(keyOf(r),forced.get(keyOf(r)));
    for(const r of all){
      const k=keyOf(r);if(targets.has(k))continue;
      const current=currentOf(r);if(!current)continue;
      const rel=relative(current),holder=takenBy(nameKey(rel));
      if(fits(r,rel,find)&&(holder===undefined||holder===k))claim(k,rel);
    }
    for(const r of all){
      const k=keyOf(r);if(targets.has(k))continue;
      if(!isReadable(r)){claim(k,systemPath(r));continue;}
      const folder=spelled(folderFor(r,find)),name=nameFor(r);
      for(let n=1;;n++){const rel=(folder?folder+'/':'')+candidateName(name,n);if(takenBy(nameKey(rel))===undefined&&!onDisk(rel)){claim(k,rel);break;}}
    }
    return {targets,moved};
  }
  // Records whose file is not where the layout puts it, or not in the form it
  // writes today, oldest first: what converting a workspace changes.
  layoutChanges(){
    this.scan();
    const relative=file=>posix(path.relative(this.recordsRoot,file)),find=(type,id)=>this.records.get(type+'/'+id);
    const pending=[...this.records.entries()].filter(([k,r])=>{const file=this.fileOf.get(k);return !fits(r,relative(file),find)||fs.readFileSync(file,'utf8')!==encode(r);})
      .map(([,r])=>r).sort((a,b)=>String(a.created_at||'').localeCompare(String(b.created_at||''))||a.type.localeCompare(b.type)||a.uid.localeCompare(b.uid))
      .map(r=>{const copy={...r};delete copy._hash;return copy;});
    const {targets}=this.planPaths(pending);
    return pending.map(r=>({record:r,type:r.type,id:r.id,from:relative(this.fileOf.get(r.type+'/'+r.id)),to:targets.get(r.type+'/'+r.id)}));
  }
  // `paths` places records at given files (relative to notebook/), for a
  // merge or a conversion that already decided where each one is; then
  // nothing else moves (`cascade` false).
  commit(records,{removeKeys=[],files=[],paths=null,cascade=!paths}={}) {
    this.scan();
    if(this.watching)this.freshen([...records.flatMap(r=>[this.fileOf.get(r.type+'/'+r.id),this.fileOf.get(this.keyOfUid?.get(r.uid))]),...removeKeys.map(k=>this.fileOf.get(k))]);
    const history=[];
    for(const record of records){
      const old=this.records.get(record.type+'/'+record.id)||removeKeys.map(k=>this.records.get(k)).find(r=>r?.uid===record.uid);
      if(old&&record.type!=='record_history'&&old._hash!==hash(encode(record))){
        const snapshot={...old};delete snapshot._hash;
        const id=old.uid+'-'+old.revision+'-'+old._hash.slice(0,12);
        if(!this.records.has('record_history/'+id)&&!records.some(r=>r.type==='record_history'&&r.id===id)){
          const digest=hash(id),uid=digest.slice(0,8)+'-'+digest.slice(8,12)+'-5'+digest.slice(13,16)+'-a'+digest.slice(17,20)+'-'+digest.slice(20,32);
          history.push({format:1,type:'record_history',id,uid,revision:1,device:'history',created_at:old.updated_at,updated_at:old.updated_at,recorded_at:old.updated_at,source_uid:old.uid,source_type:old.type,source_id:old.id,snapshot,references:[],aliases:[]});
        }
      }
    }
    records=[...records,...history];
    const proposed = new Map(this.records);
    for(const key of removeKeys)proposed.delete(key);
    for (const record of records) proposed.set(record.type + '/' + record.id, record);
    // Only what this write would break is refused. Until 6 October 2026 the
    // whole notebook had to be right, so one reference broken elsewhere (one
    // that arrived through sync, say) refused every later save of anything.
    const checked=integrity([...proposed.values()]),known=(this.integrityFor===this.records&&this.integrityNow||integrity([...this.records.values()])).keys;
    const errors=checked.problems.filter(p=>!known.has(p.key)).map(({key,...problem})=>problem);
    if (errors.length) throw new Error('Reference validation failed: ' + JSON.stringify(errors));
    const {targets,moved}=this.planPaths(records,{removeKeys,forced:paths,proposed,cascade});records=[...records,...moved];
    const fileAt=record=>path.join(this.recordsRoot,...targets.get(record.type+'/'+record.id).split('/')),written=new Set(records.map(fileAt)),relative=file=>posix(path.relative(this.root,file));
    // The old file of a moved or removed record goes first: on a file system
    // that ignores case, renaming plan.md to Plan.md would otherwise delete
    // the file it had just written.
    // Nor is a file deleted that another record still holds: a conversion
    // writes in groups, and a later group may still be reading from there.
    const batch=new Set([...records.map(r=>r.type+'/'+r.id),...removeKeys]),held=file=>{const k=this.keyOfFile?.get(file);return k!==undefined&&!batch.has(k);};
    const items=[],dropped=new Set(),drop=file=>{if(!file||written.has(file)||held(file)||dropped.has(file)||!fs.existsSync(file))return;dropped.add(file);items.push({file:relative(file),delete:true});};
    for(const record of records)drop(this.fileOf.get(record.type+'/'+record.id));
    for(const key of removeKeys)drop(this.fileOf.get(key));
    for(const record of records)items.push({file:relative(fileAt(record)),text:encode(record)});
    for(const item of files){if(!durable(item.file))throw Error('File is outside durable state');items.push({file:item.file,text:item.text});}
    const staged=this.stage(items);
    this.publish(staged);this.prune(staged.manifest.filter(item=>item.delete).map(item=>path.resolve(this.root,item.file)));this.refreshView(records,removeKeys,targets,checked);
  }
  // A folder left empty by a record moving or going away goes too, up to the
  // notebook folder: Git never carries an empty folder, so it would only stay
  // on this machine.
  prune(files){
    for(const file of files)for(let dir=path.dirname(file);dir.startsWith(this.recordsRoot+path.sep);dir=path.dirname(dir)){
      try{fs.rmdirSync(dir);}catch{break;}
    }
  }
  // The commit wrote exactly these files under the writer lock, so the view is
  // brought up to date from them instead of reading the whole vault again,
  // which doubled the cost of every save. Each record is decoded from the very
  // text that went to disk, so the view holds what a fresh read would find.
  refreshView(records, removeKeys = [], targets = null, checked = null) {
    if (!this.records||!targets) return this.scan(true);
    // The indexes of files belong to this store alone and change in place.
    const view = new Map(this.records), fileOf = this.fileOf, keyOfUid = this.keyOfUid, pathIndex = this.pathIndex, keyOfFile = this.keyOfFile, written = new Set(), dropped = new Set();
    const nameOf = file => nameKey(posix(path.relative(this.recordsRoot, file)));
    const release = (key, file) => { if (keyOfFile.get(file) === key) keyOfFile.delete(file); const k = nameOf(file), rest = (pathIndex.get(k) || []).filter(h => h !== key); if (rest.length) pathIndex.set(k, rest); else pathIndex.delete(k); };
    for (const key of removeKeys) { if (fileOf.has(key)) { dropped.add(fileOf.get(key)); release(key, fileOf.get(key)); } view.delete(key); fileOf.delete(key); }
    for (const record of records) {
      const key = record.type + '/' + record.id, file = path.join(this.recordsRoot, ...targets.get(key).split('/')), text = encode(record), fresh = decode(text, file);
      if (fileOf.has(key)) { if (fileOf.get(key) !== file) dropped.add(fileOf.get(key)); release(key, fileOf.get(key)); }
      fresh._hash = hash(encode(fresh)); if (freezing) deepFreeze(fresh); view.set(key, fresh); fileOf.set(key, file); keyOfUid.set(fresh.uid, key); written.add(file);
      keyOfFile.set(file, key); pathIndex.set(nameOf(file), [...(pathIndex.get(nameOf(file)) || []).filter(h => h !== key && h !== null), key]);
      this.entries?.set(file, { name: posix(path.relative(this.recordsRoot, file)), text, record: fresh }); this.documents?.delete(file);
    }
    for (const file of dropped) if (!written.has(file)) this.entries?.delete(file);
    if (removeKeys.length) for (const [uid, key] of keyOfUid) if (!view.has(key)) keyOfUid.delete(uid);
    // The commit checked the references of the new state before writing; a
    // reference broken before it, and left as it was, is still reported.
    this.problems = [...(this.problems || []).filter(p => p.file && !written.has(p.file) && !dropped.has(p.file) && p.error !== 'Missing or inconsistent reference'), ...(checked ? referenceProblems(checked) : [])];
    const before = this.records;
    this.records = view; this.fileOf = fileOf; this.keyOfUid = keyOfUid; this.pathIndex = pathIndex; this.keyOfFile = keyOfFile; this.lastScan = new Date().toISOString(); this.byTypeCache = null; this.byTypeFor = view;
    this.integrityFor = checked ? view : null; this.integrityNow = checked;
    if (this.listeners?.size) this.announce(before, view);
    return view;
  }
  // ---- Transactions --------------------------------------------------------
  // A write is staged whole in .godspeed/transactions/<id>, marked prepared,
  // put in place file by file, then marked completed and discarded. A
  // program that dies in between leaves it prepared, and the next program to
  // open the workspace finishes it (recover).
  //
  // The file a transaction item names. One an older version prepared still
  // names records/; it is replayed into the folder those records moved to.
  target(item){
    const name=String(item.file).replaceAll('\\','/').replace(new RegExp('^'+legacyRecordsFolder+'/'),recordsFolder+'/'),file=path.resolve(this.root,name);
    if(!file.startsWith(this.root+path.sep)||!(durable(name)||/^conflicts\/[\w-]+\.json$/.test(name)))throw new Error('Invalid transaction target');
    return {name,file};
  }
  // Each file a transaction writes is one it may write, inside the workspace,
  // not a folder, with every folder above it a folder; those missing are made
  // now. Returns the folders made.
  checkTargets(items){
    const made=[],seen=new Set();
    try{
      for(const item of items){
        const {name,file}=this.target(item);if(item.delete)continue;
        let at=this.root;
        for(const part of path.relative(this.root,path.dirname(file)).split(path.sep).filter(Boolean)){
          at=path.join(at,part);if(seen.has(at))continue;
          let stat=null;try{stat=fs.statSync(at);}catch(error){if(error.code!=='ENOENT')throw error;}
          if(stat&&!stat.isDirectory())throw new Error('Invalid transaction target: '+posix(path.relative(this.root,at))+' is a file where a folder is needed');
          if(!stat){try{fs.mkdirSync(at);}catch(error){throw new Error('Invalid transaction target: the folder '+posix(path.relative(this.root,at))+' cannot be made ('+error.code+')');}made.push(at);}
          seen.add(at);
        }
        let stat=null;try{stat=fs.statSync(file);}catch(error){if(error.code!=='ENOENT')throw error;}
        if(stat?.isDirectory())throw new Error('Invalid transaction target: '+name+' is a folder');
      }
      return made;
    }catch(error){for(const folder of made.reverse())try{fs.rmdirSync(folder);}catch{}throw error;}
  }
  // Stages a transaction: each item's new bytes and what its target held
  // before, so a failed write can be undone and a replay can tell a target
  // someone changed since. Every target is checked before the transaction is
  // marked prepared: a target that cannot be written is a write refused,
  // never a prepared transaction stuck for good (until 6 October 2026 one
  // was, and every later start of the workspace failed on it).
  stage(items){
    const tx=randomUUID(),dir=path.join(this.state,'transactions',tx),manifest=[],deleted=new Set();let made=[];
    try{
      made=this.checkTargets(items);fs.mkdirSync(dir,{recursive:true});
      items.forEach((entry,i)=>{
        const {file}=this.target(entry),key=nameKey(entry.file),item={file:entry.file};
        // On a file system that ignores case, a target an earlier delete in
        // this transaction removes under another spelling is gone by then.
        const aliased=!entry.delete&&deleted.has(key)&&!(fs.existsSync(path.dirname(file))&&fs.readdirSync(path.dirname(file)).includes(path.basename(file)));
        const before=aliased?null:readOrNull(file);
        if(entry.delete){item.delete=true;deleted.add(key);}
        else{atomic(path.join(dir,i+'.after'),entry.text,{sync:false});Object.assign(item,{staged:i+'.after',hash:hash(entry.text)});}
        if(before){atomic(path.join(dir,i+'.before'),before,{sync:false});Object.assign(item,{existed:true,before:i+'.before',before_hash:hash(before)});}else item.existed=false;
        manifest.push(item);
      });
      syncFolder(dir);atomic(path.join(dir,'manifest.json'),JSON.stringify(manifest));
      atomic(path.join(dir,'prepared'),JSON.stringify({tx,order:nextOrder()}));
      return {dir,manifest,made};
    }catch(error){try{fs.rmSync(dir,{recursive:true,force:true});}catch{}for(const folder of made.reverse())try{fs.rmdirSync(folder);}catch{}throw error;}
  }
  // Puts a prepared transaction in place. A failure while this program lives
  // (a file another program holds, a full disk) is undone from the
  // before-images and the transaction discarded, so it can never be replayed
  // later over newer saves: until 6 October 2026 it stayed prepared, and the
  // next program to open the workspace replayed it over everything saved
  // since. Only if undoing fails as well does it stay prepared, for recover()
  // to judge. failAfter stands for the program dying half-way: nothing is
  // undone then.
  publish({dir,manifest,made}){
    try{this.applyTransaction(dir,manifest);}
    catch(error){
      if(!error.crash)try{this.rollBack(dir,manifest,made);}catch{}
      // What this store holds may no longer be what is on disk.
      this.invalidate();if(this.watching)for(const item of manifest){const {name}=this.target(item);if(isRecordPath(name))this.touched(name.slice(recordsFolder.length+1));}
      throw error;
    }
  }
  applyTransaction(dir, manifest) {
    const targets=manifest.map(item=>this.target(item));
    for (let i = 0; i < manifest.length; i++) {
      const item = manifest[i], {file} = targets[i];
      if(item.delete){try{retrying(()=>fs.unlinkSync(file));}catch(error){if(error.code!=='ENOENT')throw error;}continue;}
      const text = fs.readFileSync(path.join(dir, item.staged));
      if (hash(text) !== item.hash) throw new Error('Corrupt transaction stage');
      atomic(file, text, { sync: false });
      if (this.failAfter === i + 1) throw Object.assign(new Error('Injected crash'), { crash: true });
    }
    for (const folder of new Set(targets.map(t => path.dirname(t.file)))) syncFolder(folder);
    // Other watching stores learn of these files at once; one that does not
    // (the journal could not be written) still hears of them from its watcher.
    try{this.journal(targets.map(t=>t.name).filter(name=>name.startsWith(recordsFolder+'/')).map(name=>name.slice(recordsFolder.length+1)));}catch{}
    atomic(path.join(dir, 'completed'), new Date().toISOString());
    this.discardCompletedTransaction(dir);
  }
  // Undoes what a failed transaction did, last item first: a file it wrote
  // gets its before-image back, or goes if it did not exist before (only while
  // it still holds what this transaction wrote); a file it deleted comes back.
  // A file holding anything else was changed by someone else meanwhile, and is
  // left as it is.
  rollBack(dir,manifest,made=[]){
    for(let i=manifest.length-1;i>=0;i--){
      const item=manifest[i],{file}=this.target(item),current=readOrNull(file),now=current&&hash(current),left=item.delete?current===null:now===item.hash;
      if(item.existed){
        if(now===item.before_hash||!left&&current!==null)continue;
        const bytes=fs.readFileSync(path.join(dir,item.before));if(hash(bytes)!==item.before_hash)throw new Error('Corrupt transaction stage');
        atomic(file,bytes,{sync:false});
      }else if(!item.delete&&left)retrying(()=>fs.unlinkSync(file));
    }
    for(const folder of [...made].reverse())try{fs.rmdirSync(folder);}catch{}
    atomic(path.join(dir,'rolled-back'),new Date().toISOString());
    this.discardCompletedTransaction(dir);
  }
  discardCompletedTransaction(dir) {
    const root=path.resolve(this.state,'transactions'),name=path.basename(dir);
    if(path.dirname(path.resolve(dir))!==root||! /^(?:\.completed-)?[a-f0-9-]{36}$/.test(name))throw new Error('Invalid transaction cleanup path');
    if(!name.startsWith('.completed-')&&!finished(dir))return;
    // Rename out of the recovery namespace before deleting any payload. A crash
    // during cleanup can then never replay partially deleted staging files.
    const discarded=name.startsWith('.completed-')?dir:path.join(root,'.completed-'+name);
    try{if(discarded!==dir)fs.renameSync(dir,discarded);fs.rmSync(discarded,{recursive:true});}catch{}
  }
  // Finishes what a program that died half-way had prepared, oldest first,
  // but only where that cannot undo anything saved since: every file it names
  // must still be as it found it or as it leaves it. One that fails that (a
  // later save, an edit, a sync changed one of its files), or that names a
  // file it may not write, is set aside, kept and reported, and the
  // workspace opens anyway. Until 6 October 2026 every prepared transaction
  // was replayed, in no particular order, over whatever was there, and one
  // that could not be replayed stopped every later start.
  recover() {
    const root = path.join(this.state, 'transactions'); if (!fs.existsSync(root)) return;
    const pending=[];
    for (const name of fs.readdirSync(root)) {
      const dir = path.join(root, name);
      if(name.startsWith('.completed-')||finished(dir)){this.discardCompletedTransaction(dir);continue;}
      if(fs.existsSync(path.join(dir,'prepared')))pending.push({dir,name,order:preparedOrder(dir)});
    }
    pending.sort((a,b)=>a.order.localeCompare(b.order)||a.name.localeCompare(b.name));
    for(const {dir} of pending){
      let manifest=null;try{manifest=JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8'));}catch{}
      const stale=Array.isArray(manifest)?this.staleness(dir,manifest):'its list of files cannot be read';
      if(stale)this.setAside(dir,stale);else this.applyTransaction(dir,manifest);
    }
  }
  // Why replaying a prepared transaction would change more than it meant to,
  // or null. Every file it names must hold what it found or what it leaves; on
  // a file system that ignores case, items naming one file under two
  // spellings (a rename by letter case) share their states.
  staleness(dir,manifest){
    let targets;try{targets=manifest.map(item=>this.target(item));}catch{return 'it names a file it may not write';}
    for(const {name,file} of targets)for(let at=path.dirname(file);at.startsWith(this.root+path.sep);at=path.dirname(at)){let stat=null;try{stat=fs.statSync(at);}catch{}if(stat&&!stat.isDirectory())return 'a file stands where the folder of '+name+' must be';}
    // Prepared by a version before 6 October 2026, which kept no before-image
    // of a page it was about to create, and none at all for whole files.
    let legacyCommit=false;try{legacyCommit=fs.readFileSync(path.join(dir,'prepared'),'utf8')!=='prepared';}catch{}
    const states=new Map(),allow=(key,state)=>{if(state===undefined)return;let set=states.get(key);if(!set)states.set(key,set=new Set());set.add(state);};
    for(let i=0;i<manifest.length;i++){
      const item=manifest[i],{name}=targets[i],key=nameKey(name);
      if(!item.delete){let staged=null;try{staged=fs.readFileSync(path.join(dir,item.staged));}catch{}if(!staged||hash(staged)!==item.hash)return 'its copy of '+name+' is damaged';}
      allow(key,item.delete?MISSING:item.hash);
      if(item.existed===true)allow(key,item.before_hash);
      else if(item.existed===false)allow(key,MISSING);
      else{const before=readOrNull(path.join(dir,i+'.before'));allow(key,before?hash(before):!item.delete&&legacyCommit&&isRecordPath(name)?MISSING:undefined);}
    }
    for(const {name,file} of targets)if(!states.get(nameKey(name)).has(stateOf(file)))return name+' was changed after this save was prepared';
    return null;
  }
  // Kept, never deleted, out of the recovery namespace, and reported until
  // someone has looked at it (a file named reviewed in its folder).
  setAside(dir,reason){
    try{
      atomic(path.join(dir,'set-aside.json'),JSON.stringify({at:new Date().toISOString(),reason},null,2));
      const root=path.join(this.state,'transactions-set-aside');fs.mkdirSync(root,{recursive:true});
      let target=path.join(root,path.basename(dir));for(let n=2;fs.existsSync(target);n++)target=path.join(root,path.basename(dir)+'-'+n);
      fs.renameSync(dir,target);
    }catch{(this.unmovable||=new Set()).add(dir);}
  }
  setAsideProblems(){
    if(!this.state)return [];
    const root=path.join(this.state,'transactions-set-aside');let names=[];try{names=fs.readdirSync(root);}catch{}
    return [...names.map(name=>path.join(root,name)),...(this.unmovable||[])].filter(dir=>!fs.existsSync(path.join(dir,'reviewed')))
      .map(dir=>({file:dir,set_aside:path.basename(dir),error:'A save that could not finish was set aside instead of replayed, because a file it would change was changed after it. It is kept for review'}));
  }
  // Whole files written through the same transactions (sync's pages, a
  // resolved conflict, a restore). Deletes go first, as in commit(): on a
  // file system that ignores case, a page renamed by letter case would
  // otherwise lose the file just written.
  publishFiles(items){
    for(const item of items)if(!durable(item.file)&&!/^conflicts\/[\w-]+\.json$/.test(item.file))throw new Error('File is outside durable state');
    this.publish(this.stage([...items.filter(item=>item.delete).map(item=>({file:item.file,delete:true})),...items.filter(item=>!item.delete).map(item=>({file:item.file,text:item.text}))]));
  }
  structural(type, id, action, options = {}) {
    return this.withLock(() => {
      const old = this.get(type, id); if (!old) throw new Error('Record not found');
      if(type==='moments'&&action!=='rename')throw new Error('Events are append-only; use an explicit event correction');
      if (action === 'display-name') { const next = this.prepare(type, { name: options.name }, old); this.commit([next]); return next; }
      if(action==='rename'){
        const nextId=safe(options.id);if(nextId.toLowerCase()===old.id.toLowerCase())throw new Error('A path rename must change its spelling beyond case');
        const next={...this.prepare(type,{former_ids:[...new Set([...(old.former_ids||[]),old.id])]},old),id:nextId};
        const changed=[...this.records.values()].filter(r=>r.uid!==old.uid&&(r.references||[]).some(ref=>ref.uid===old.uid||ref.type===type&&ref.id===old.id)).map(r=>{
          const patch=structuredClone(r);for(const ref of patch.references)if(ref.uid===old.uid||ref.type===type&&ref.id===old.id){ref.uid=old.uid;ref.id=nextId;if(ref.field){const keys=ref.field.split('.');let object=patch;for(const key of keys.slice(0,-1))object=object[key]??={};const key=keys.at(-1);object[key]=Array.isArray(object[key])?object[key].map(v=>v===old.id?nextId:v):nextId;}}
          return this.prepare(r.type,patch,r);
        });
        this.commit([next,...changed],{removeKeys:[type+'/'+old.id]});return next;
      }
      if (action === 'remove') { const next = this.prepare(type, { removed_at: new Date().toISOString() }, old); this.commit([next]); return next; }
      if (action === 'merge') {
        const target = this.get(type, options.target); if (!target || old.uid === target.uid) throw new Error('Invalid merge target');
        const changed = [...this.records.values()].filter(r => (r.references || []).some(ref => ref.uid === old.uid || (ref.type === type && ref.id === id)))
          .map(r => {
            const patch = structuredClone(r);
            for (const ref of r.references) if (ref.field && (ref.uid === old.uid || (ref.type === type && ref.id === id))) {
              const keys=ref.field.split('.');let object=patch;
              for(const key of keys.slice(0,-1))object=object[key]??=( {} );
              const key=keys.at(-1);object[key]=Array.isArray(object[key])?[...new Set(object[key].map(v=>v===old.id?target.id:v))]:target.id;
            }
            return this.prepare(r.type, { ...patch, references: r.references.map(ref => ref.uid === old.uid || (ref.type === type && ref.id === id) ? { ...ref, uid: target.uid, id: target.id } : ref) }, r);
          });
        const tombstone = this.prepare(type, { removed_at: new Date().toISOString(), merged_into: target.uid }, old);
        // The merged record answers to the source's ids; a person merged into
        // another also keeps their name and nicknames as nicknames.
        const names = type === 'contacts' ? [old.name, ...(old.aliases || [])].filter(n => typeof n === 'string' && n.trim() && n !== target.name) : (old.aliases || []);
        const merged = this.prepare(type, { aliases: [...new Set([...(target.aliases || []), ...names])], former_ids: [...new Set([...(target.former_ids || []), ...identityIds(old)])], merged_sources: [...(target.merged_sources || []), old.uid] }, target);
        // The removed source retains its own id; aliases resolve by UUID provenance.
        this.commit([...changed.filter(r => r.uid !== old.uid && r.uid !== target.uid), tombstone, merged]); return merged;
      }
      throw new Error('Unknown structural operation');
    });
  }
  // A backup holds the writer lock only for the moment that makes it one
  // consistent copy. Every durable file is copied first without the lock;
  // then, under it, each is looked at again (which file it is, its size and
  // times) and only those changed meanwhile are copied once more, those gone
  // removed. The notebook replaces a file by renaming a new one over it, so a
  // changed file is always a different file. Counting, media, hashes and the
  // manifest follow without the lock. Until 6 October 2026 the whole copy and
  // hash ran under it, which at 16,000 records held every other save back for
  // seven minutes, and the server's saves gave up after thirty seconds.
  backup(destination,{finalize}={}) {
    if (fs.existsSync(destination)) throw new Error('Backup destination already exists');
    fs.mkdirSync(destination, { recursive: true });
    const roots=[...durableRoots,...durableFiles,'conflicts'],copied=new Map();let at;
    for(const name of roots)copyInto(this.root,destination,name,copied);
    this.withLock(()=>{
      this.recover();const seen=new Set();
      for(const name of roots)copyInto(this.root,destination,name,copied,seen);
      for(const name of copied.keys())if(!seen.has(name)){fs.rmSync(path.join(destination,...name.split('/')),{force:true});copied.delete(name);}
      at=new Date().toISOString();
    });
    atomic(path.join(destination, 'backup.json'), JSON.stringify({ format: 1, at, records: Store.inspect(destination).records.size }));
    finalize?.(destination);
    return destination;
  }
  // A workspace or a backup, only read: no lock, no state folder, nothing
  // recovered or moved, a records/ folder from before 2026-10-05 read where it
  // is. Restoring checks a backup this way: until 6 October 2026 it opened the
  // backup as a workspace, which wrote into it (a lock, its state folder, and
  // records/ renamed to notebook/), so the same backup could not be restored
  // twice, nor one on read-only media at all.
  static inspect(root) {
    const view = Object.create(Store.prototype);
    view.root = path.resolve(root); view.device = 'local'; view.state = path.join(view.root, '.godspeed'); view.recordsRoot = path.join(view.root, recordsFolder);
    const legacy = path.join(view.root, legacyRecordsFolder);
    if (!fs.existsSync(view.recordsRoot) && fs.existsSync(legacy)) view.recordsRoot = legacy;
    view.withLock = () => { throw new Error('This copy is only read'); };
    view.scan(); return view;
  }
  restore(source) {
    if (this.scan().size) throw new Error('Restore requires an empty workspace');
    for(const name of [...durableRoots.filter(r=>r!==recordsFolder),...durableFiles])if(fs.existsSync(path.join(this.root,name)))throw new Error('Restore requires empty durable state');
    const manifest = JSON.parse(fs.readFileSync(path.join(source, 'backup.json'), 'utf8')); if (manifest.format !== 1) throw new Error('Unsupported backup format');
    return this.withLock(() => {
      const checked=Store.inspect(source);if(checked.problems.length)throw new Error('Backup records need review');
      // A backup from before 2026-10-05 holds records/; its files go to notebook/.
      const legacy=checked.recordsRoot!==path.join(checked.root,recordsFolder),as=relative=>legacy?relative.replace(new RegExp('^'+legacyRecordsFolder+'/'),recordsFolder+'/'):relative;
      const items=[];const visit=(relative)=>{
        const target=path.join(source,relative),info=fs.lstatSync(target);if(info.isSymbolicLink())throw new Error('Restore cannot follow symbolic links');
        if(info.isDirectory())for(const name of fs.readdirSync(target))visit(path.posix.join(relative,name));
        else{const name=as(relative);if(durable(name)||/^conflicts\/[\w-]+\.json$/.test(name))items.push({file:name,text:fs.readFileSync(target)});}
      };
      for(const name of [...durableRoots,...durableFiles,'conflicts',...(legacy?[legacyRecordsFolder]:[])])if(fs.existsSync(path.join(source,name)))visit(name);
      this.publishFiles(items);
      this.scan(); if (this.problems.length) throw new Error('Restored records need review'); return this.records.size;
    });
  }
}
