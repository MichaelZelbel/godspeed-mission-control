import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { durable,durableRoots,durableFiles,recordsFolder,legacyRecordsFolder } from '../file-policy.mjs';
import { encode as encodeFile, decode as decodeFile, safe as safeName, candidate, fits, folderFor, nameFor, candidateName, systemPath, isReadable, key as nameKey, childrenOf } from './layout.mjs';

export const hash = value => createHash('sha256').update(Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
export const slug = value => String(value).normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'record';
export const safe = safeName;
export function atomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + randomUUID() + '.tmp';
  const fd = fs.openSync(tmp, 'wx');
  try { fs.writeFileSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const deadline=Date.now()+1500;
  for(;;){try{fs.renameSync(tmp,file);break;}catch(error){
    if(process.platform!=='win32'||!['EPERM','EACCES','EBUSY'].includes(error.code)||Date.now()>=deadline)throw error;
    // Windows scanners can briefly hold the destination during an atomic swap.
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,25);
  }}
}
// A record's file: readable Markdown with YAML frontmatter for what a person
// reads, JSON for machine bookkeeping (see layout.mjs). decode() throws an
// error whose code is NOT_RECORD for an owner's own Markdown page.
export const encode = encodeFile;
export const decode = decodeFile;
const posix = file => file.split(path.sep).join('/');
// A copy that shares the (immutable) strings: what structuredClone did per
// record and per read, at a fraction of the cost, since a note's text is
// most of its size.
export function copy(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(copy);
  const out = {}; for (const key in value) out[key] = copy(value[key]); return out;
}
// The records the store holds are frozen: they live as long as their files
// do not change, so code that changed one in place instead of a copy would
// change what the next save writes. It fails loudly instead.
// GODSPEED_FREEZE_RECORDS=0 turns this off.
const freezing = process.env.GODSPEED_FREEZE_RECORDS !== '0';
function deepFreeze(value) { if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.freeze(value); for (const key in value) deepFreeze(value[key]); } return value; }
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
    const lock = path.join(this.state, 'workspace.lock');
    let fd;
    try { fd = fs.openSync(lock, 'wx'); } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let owner;
      try { owner = JSON.parse(fs.readFileSync(lock, 'utf8')); } catch { throw new Error('Workspace lock requires recovery'); }
      // EPERM: the writer is alive but not ours to signal (on Windows, the server started by
      // the installer's task). That is a busy workspace, not an error.
      try { process.kill(owner.pid, 0); } catch (error) {
        if (error.code === 'ESRCH') { fs.unlinkSync(lock); return this.withLock(fn); }
        if (error.code !== 'EPERM') throw error;
      }
      throw Object.assign(new Error('Workspace is being written by another process'),{code:'WRITER_BUSY'});
    }
    this.holding = (this.holding || 0) + 1;
    try { fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() })); fs.fsyncSync(fd); return fn(); }
    finally { this.holding--; fs.closeSync(fd); fs.unlinkSync(lock); }
  }
  async waitForWriter({signal,timeoutMs=30000}={}) {
    const lock=path.join(this.state,'workspace.lock'),until=Date.now()+timeoutMs;
    while(fs.existsSync(lock)){
      signal?.throwIfAborted();
      let owner;try{owner=JSON.parse(fs.readFileSync(lock,'utf8'));}catch(error){if(error.code==='ENOENT')continue;}
      if(owner?.pid)try{process.kill(owner.pid,0);}catch(error){if(error.code==='ESRCH')return;if(error.code!=='EPERM')throw error;}
      if(Date.now()>=until)throw Error('Workspace is still being written. Your request has not been repeated.');
      await new Promise(resolve=>setTimeout(resolve,25));
    }
    signal?.throwIfAborted();
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
        await this.waitForWriter({signal,timeoutMs:remaining});
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
        for (const alias of record.removed_at ? [] : [record.id, ...(record.aliases || [])]) {
          const akey = record.type + '/' + alias.toLowerCase();
          if (aliases.has(akey) && aliases.get(akey) !== key) problems.push({ file, error: 'Ambiguous alias', alias });
          aliases.set(akey, key);
        }
      }catch(e){problems.push({file,error:e.message});}
    }
    this.records = records; this.fileOf = fileOf; this.keyOfUid = keyOfUid; this.pathIndex = pathIndex; this.keyOfFile = keyOfFile; this.documents = documents; this.problems = problems; this.lastScan = new Date().toISOString();
    this.problems.push(...this.validateReferences([...records.values()]));
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
    const byName=new Map();for(const [file,entry] of this.entries)byName.set(entry.name,file);
    const affected=new Map();
    for(const name of names){
      const known=byName.get(name);
      if(known){affected.set(known,name);continue;}
      const absolute=path.join(this.recordsRoot,...name.split('/'));
      let stat=null;try{stat=fs.lstatSync(absolute);}catch(error){if(error.code!=='ENOENT'&&error.code!=='ENOTDIR')throw error;}
      if(stat?.isFile()){if(candidate(name))affected.set(absolute,name);continue;}
      if(stat?.isSymbolicLink())continue;
      // A folder: renamed, moved, deleted or new. Everything known under it
      // and everything now in it is read again.
      const prefix=name+'/';for(const [file,entry] of this.entries)if(entry.name.startsWith(prefix))affected.set(file,entry.name);
      if(stat?.isDirectory()){
        const walk=(dir,relative)=>{let list;try{list=fs.readdirSync(dir,{withFileTypes:true});}catch{return;}for(const e of list){if(e.name.startsWith('.')||e.isSymbolicLink())continue;const n=relative+'/'+e.name,f=path.join(dir,e.name);if(e.isDirectory())walk(f,n);else if(e.isFile()&&candidate(n))affected.set(f,n);}};
        walk(absolute,name);
      }
    }
    let changed=false;
    for(const [file,name] of affected){
      const previous=this.entries.get(file),entry=this.readEntry(file,name,previous);
      if(entry===previous)continue;
      changed=true;if(entry)this.entries.set(file,entry);else this.entries.delete(file);
    }
    if(changed){this.dirtyChanges=(this.dirtyChanges||0)+1;this.derive();}
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
  validateReferences(records) {
    const problems = [], uids = new Map(records.map(r => [r.uid,r]));
    const keys = new Set(records.flatMap(r => [r.type + '/' + r.id, ...(r.aliases || []).map(a => r.type + '/' + a)]));
    for (const r of records) for (const ref of r.references || []) {
      const target=ref.uid?uids.get(ref.uid):null;
      if (!(ref.uid ? target&&target.type===ref.type&&[target.id,...target.aliases||[]].includes(ref.id) : keys.has(ref.type + '/' + ref.id))) problems.push({ record: r.id, error: 'Missing or inconsistent reference', reference: ref });
    }
    return problems;
  }
  // Callers get copies: a record they change is theirs, never the view's.
  list(type, { removed = false } = {}) { this.scan(); return this.ofType(type).filter(r => removed || !r.removed_at).map(copy); }
  get(type, id) { this.scan(); const record = this.records.get(type + '/' + id) || this.ofType(type).find(r => (r.aliases || []).includes(id)); return record && copy(record); }
  prepare(type, value, old = null) {
    const now = new Date().toISOString(), uid = old?.uid || value.uid || randomUUID();
    const id = old?.id || value.id || slug(value.name || value.title || type) + '-' + uid.slice(0, 8);
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
      view.get=(type,id)=>view.records.get(type+'/'+id)||[...view.records.values()].find(r=>r.type===type&&(r.aliases||[]).includes(id))||null;
      view.list=(type,{removed=false}={})=>[...view.records.values()].filter(r=>r.type===type&&(removed||!r.removed_at));
      view.commit=(records,options={})=>{for(const item of options.files||[])files.set(item.file,item);for(const raw of records){const record={...raw};delete record._hash;const key=record.type+'/'+record.id;changed.set(key,record);view.records.set(key,{...record,_hash:hash(encode(record))});}};
      const result=work(view,changed,before,files);
      if(result&&typeof result.then==='function')throw Error('Record transactions must finish synchronously');
      this.commit([...changed.values()],{files:[...files.values()]});return result;
    });
  }
  saveUnderLock(type,value,expectedHash) {
      const old = value.id ? this.get(type, value.id) : null;
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
    const errors = this.validateReferences([...proposed.values()]);
    const ids = new Set(),aliases=new Map();
    for (const r of proposed.values()) {
      if (ids.has(r.uid)) errors.push({ error: 'Duplicate UUID' }); ids.add(r.uid);
      if(!r.removed_at)for(const alias of [r.id,...r.aliases||[]]){const key=r.type+'/'+alias.toLowerCase();if(aliases.has(key)&&aliases.get(key)!==r.uid)errors.push({error:'Ambiguous case-insensitive identity or alias',alias});aliases.set(key,r.uid);}
    }
    if (errors.length) throw new Error('Reference validation failed: ' + JSON.stringify(errors));
    const {targets,moved}=this.planPaths(records,{removeKeys,forced:paths,proposed,cascade});records=[...records,...moved];
    const fileAt=record=>path.join(this.recordsRoot,...targets.get(record.type+'/'+record.id).split('/')),written=new Set(records.map(fileAt));
    const tx = randomUUID(), dir = path.join(this.state, 'transactions', tx); fs.mkdirSync(dir, { recursive: true });
    const manifest=[];
    // The old file of a moved or removed record goes first: on a file system
    // that ignores case, renaming plan.md to Plan.md would otherwise delete
    // the file it had just written.
    // Nor is a file deleted that another record still holds: a conversion
    // writes in groups, and a later group may still be reading from there.
    const batch=new Set([...records.map(r=>r.type+'/'+r.id),...removeKeys]),held=file=>{const k=this.keyOfFile?.get(file);return k!==undefined&&!batch.has(k);};
    const drop=file=>{if(!file||written.has(file)||held(file)||!fs.existsSync(file))return;atomic(path.join(dir,manifest.length+'.before'),fs.readFileSync(file));manifest.push({file:posix(path.relative(this.root,file)),delete:true});};
    for(const record of records)drop(this.fileOf.get(record.type+'/'+record.id));
    for(const key of removeKeys)drop(this.fileOf.get(key));
    for (const record of records) {
      const file = fileAt(record), relative = posix(path.relative(this.root, file)), text = encode(record), i = manifest.length;
      atomic(path.join(dir, i + '.after'), text);
      if (fs.existsSync(file)) atomic(path.join(dir, i + '.before'), fs.readFileSync(file));
      manifest.push({ file: relative, staged: i + '.after', hash: hash(text) });
    }
    for(const item of files){if(!durable(item.file))throw Error('File is outside durable state');const staged=manifest.length+'.after';atomic(path.join(dir,staged),item.text);manifest.push({file:item.file,staged,hash:hash(item.text)});}
    atomic(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    atomic(path.join(dir, 'prepared'), tx);
    this.applyTransaction(dir, manifest); this.prune(manifest.filter(item=>item.delete).map(item=>path.resolve(this.root,item.file))); this.refreshView(records, removeKeys, targets);
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
  refreshView(records, removeKeys = [], targets = null) {
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
    // The commit validated every reference of the new state before writing.
    this.problems = (this.problems || []).filter(p => p.file && !written.has(p.file) && !dropped.has(p.file) && p.error !== 'Missing or inconsistent reference');
    const before = this.records;
    this.records = view; this.fileOf = fileOf; this.keyOfUid = keyOfUid; this.pathIndex = pathIndex; this.keyOfFile = keyOfFile; this.lastScan = new Date().toISOString(); this.byTypeCache = null; this.byTypeFor = view;
    if (this.listeners?.size) this.announce(before, view);
    return view;
  }
  applyTransaction(dir, manifest) {
    for (let i = 0; i < manifest.length; i++) {
      // A transaction an older version prepared still names records/; it is
      // replayed into the folder those records were moved to.
      const item = manifest[i], name = item.file.replaceAll('\\','/').replace(new RegExp('^'+legacyRecordsFolder+'/'), recordsFolder+'/'), file = path.resolve(this.root, name);
      if (!file.startsWith(this.root + path.sep)||!(durable(name)||/^conflicts\/[\w-]+\.json$/.test(name))) throw new Error('Invalid transaction target');
      if(item.delete){if(fs.existsSync(file))fs.unlinkSync(file);continue;}
      const text = fs.readFileSync(path.join(dir, item.staged));
      if (hash(text) !== item.hash) throw new Error('Corrupt transaction stage');
      atomic(file, text);
      if (this.failAfter === i + 1) throw new Error('Injected crash');
    }
    this.journal(manifest.map(item=>item.file.replaceAll('\\','/').replace(new RegExp('^'+legacyRecordsFolder+'/'), recordsFolder+'/')).filter(name=>name.startsWith(recordsFolder+'/')).map(name=>name.slice(recordsFolder.length+1)));
    atomic(path.join(dir, 'completed'), new Date().toISOString());
    this.discardCompletedTransaction(dir);
  }
  discardCompletedTransaction(dir) {
    const root=path.resolve(this.state,'transactions'),name=path.basename(dir);
    if(path.dirname(path.resolve(dir))!==root||! /^(?:\.completed-)?[a-f0-9-]{36}$/.test(name))throw new Error('Invalid transaction cleanup path');
    if(!name.startsWith('.completed-')&&!fs.existsSync(path.join(dir,'completed')))return;
    // Rename out of the recovery namespace before deleting any payload. A crash
    // during cleanup can then never replay partially deleted staging files.
    const discarded=name.startsWith('.completed-')?dir:path.join(root,'.completed-'+name);
    try{if(discarded!==dir)fs.renameSync(dir,discarded);fs.rmSync(discarded,{recursive:true});}catch{}
  }
  recover() {
    const root = path.join(this.state, 'transactions'); if (!fs.existsSync(root)) return;
    for (const name of fs.readdirSync(root)) {
      const dir = path.join(root, name);
      if(name.startsWith('.completed-')||fs.existsSync(path.join(dir,'completed'))){this.discardCompletedTransaction(dir);continue;}
      if (fs.existsSync(path.join(dir, 'prepared')) && !fs.existsSync(path.join(dir, 'completed'))) this.applyTransaction(dir, JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8')));
    }
  }
  publishFiles(items){
    const dir=path.join(this.state,'transactions',randomUUID());fs.mkdirSync(dir,{recursive:true});
    const manifest=items.map((item,i)=>{if(!durable(item.file)&&!/^conflicts\/[\w-]+\.json$/.test(item.file))throw new Error('File is outside durable state');if(item.delete)return {file:item.file,delete:true};atomic(path.join(dir,i+'.after'),item.text);return {file:item.file,staged:i+'.after',hash:hash(item.text)};});
    atomic(path.join(dir,'manifest.json'),JSON.stringify(manifest));atomic(path.join(dir,'prepared'),'prepared');this.applyTransaction(dir,manifest);
  }
  structural(type, id, action, options = {}) {
    return this.withLock(() => {
      const old = this.get(type, id); if (!old) throw new Error('Record not found');
      if(type==='moments'&&action!=='rename')throw new Error('Events are append-only; use an explicit event correction');
      if (action === 'display-name') { const next = this.prepare(type, { name: options.name }, old); this.commit([next]); return next; }
      if(action==='rename'){
        const nextId=safe(options.id);if(nextId.toLowerCase()===old.id.toLowerCase())throw new Error('A path rename must change its spelling beyond case');
        const next={...this.prepare(type,{aliases:[...new Set([...(old.aliases||[]),old.id])]},old),id:nextId};
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
        const merged = this.prepare(type, { aliases: [...new Set([...(target.aliases || []), old.id, ...(old.aliases || [])])], merged_sources: [...(target.merged_sources || []), old.uid] }, target);
        // The removed source retains its own id; aliases resolve by UUID provenance.
        this.commit([...changed.filter(r => r.uid !== old.uid && r.uid !== target.uid), tombstone, merged]); return merged;
      }
      throw new Error('Unknown structural operation');
    });
  }
  backup(destination,{finalize}={}) {
    if (fs.existsSync(destination)) throw new Error('Backup destination already exists');
    return this.withLock(() => {
      this.recover(); fs.mkdirSync(destination, { recursive: true });
      for (const root of [...durableRoots,...durableFiles,'conflicts']) if (fs.existsSync(path.join(this.root, root))) fs.cpSync(path.join(this.root, root), path.join(destination, root), { recursive: true });
      atomic(path.join(destination, 'backup.json'), JSON.stringify({ format: 1, at: new Date().toISOString(), records: this.scan().size }));
      finalize?.(destination);
      return destination;
    });
  }
  restore(source) {
    if (this.scan().size) throw new Error('Restore requires an empty workspace');
    for(const name of [...durableRoots.filter(r=>r!==recordsFolder),...durableFiles])if(fs.existsSync(path.join(this.root,name)))throw new Error('Restore requires empty durable state');
    const manifest = JSON.parse(fs.readFileSync(path.join(source, 'backup.json'), 'utf8')); if (manifest.format !== 1) throw new Error('Unsupported backup format');
    return this.withLock(() => {
      const checked=new Store(source);if(checked.problems.length)throw new Error('Backup records need review');
      const items=[];const visit=(relative)=>{
        const target=path.join(source,relative),info=fs.lstatSync(target);if(info.isSymbolicLink())throw new Error('Restore cannot follow symbolic links');
        if(info.isDirectory())for(const name of fs.readdirSync(target))visit(path.posix.join(relative,name));
        else if(durable(relative)||/^conflicts\/[\w-]+\.json$/.test(relative))items.push({file:relative,text:fs.readFileSync(target)});
      };
      for(const name of [...durableRoots,...durableFiles,'conflicts'])if(fs.existsSync(path.join(source,name)))visit(name);
      this.publishFiles(items);
      this.scan(); if (this.problems.length) throw new Error('Restored records need review'); return this.records.size;
    });
  }
}
