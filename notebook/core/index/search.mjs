import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {durableRoots,durableFiles,shared} from '../file-policy.mjs';
import {hash,decode,encode} from '../records/store.mjs';

export class SearchIndex {
  constructor(store) {
    this.store = store; this.file = path.join(store.state, 'search.sqlite');
    const open=()=>{this.db = new DatabaseSync(this.file);this.db.exec('CREATE TABLE IF NOT EXISTS documents (uid TEXT PRIMARY KEY, type TEXT, id TEXT, title TEXT, body TEXT)');};
    try{open();}catch(error){try{this.db?.close();}catch{}if(fs.existsSync(this.file))fs.renameSync(this.file,this.file+'.corrupt-'+Date.now());for(const suffix of ['-wal','-shm'])if(fs.existsSync(this.file+suffix))fs.renameSync(this.file+suffix,this.file+'.corrupt-'+Date.now()+suffix);open();this.recovered=true;}
    this.rebuild();
  }
  rebuild() {
    this.generation=(this.generation||0)+1;
    this.store.scan(); const documents=[];
    for (const r of this.store.records.values()) if (!r.removed_at) documents.push([r.uid,r.type,r.id,r.title||r.name||r.id,JSON.stringify(r)]);
    const visit=relative=>{const absolute=path.join(this.store.root,relative);if(!fs.existsSync(absolute))return;const stat=fs.lstatSync(absolute);if(stat.isSymbolicLink())return;if(stat.isDirectory()){for(const name of fs.readdirSync(absolute))if(shared(relative+'/'+name))visit(relative+'/'+name);}else if(stat.size<=512*1024&&/\.(md|json|jsonl|txt)$/.test(relative))documents.push(['file-'+hash(relative),'workspace_file',relative,relative,fs.readFileSync(absolute,'utf8')]);};
    for(const name of [...durableRoots.filter(r=>r!=='records'),...durableFiles])visit(name);
    return this.replace(documents);
  }
  // Compare content read from disk with what the index holds, never size or
  // timestamps, and write only the rows that differ. Hashing every document to
  // learn whether anything changed, and rewriting all of them when something
  // had, held the server's only thread for two and a half seconds on a real
  // imported vault (16,500 documents, 89 MB), after every save. Returns the
  // number of rows written.
  replace(documents) {
    const next=new Map(documents.map(document=>[document[0],document]));
    if(!this.indexed){
      this.db.exec('BEGIN; DELETE FROM documents;');
      try {
        const insert = this.db.prepare('INSERT OR REPLACE INTO documents VALUES(?,?,?,?,?)');
        for(const document of next.values())insert.run(...document);
        this.db.exec('COMMIT');
      } catch (e) { this.db.exec('ROLLBACK'); throw e; }
      this.indexed=next;this.lastRebuild=new Date().toISOString();return next.size;
    }
    const changed=[...next.values()].filter(document=>{const old=this.indexed.get(document[0]);return !old||document.some((value,i)=>value!==old[i]);});
    const removed=[...this.indexed.keys()].filter(uid=>!next.has(uid));
    this.lastRebuild=new Date().toISOString();
    if(!changed.length&&!removed.length)return 0;
    this.db.exec('BEGIN');
    try {
      const remove=this.db.prepare('DELETE FROM documents WHERE uid=?'),insert=this.db.prepare('INSERT OR REPLACE INTO documents VALUES(?,?,?,?,?)');
      for(const uid of removed)remove.run(uid);
      for(const document of changed)insert.run(...document);
      this.db.exec('COMMIT');
    } catch (e) { this.db.exec('ROLLBACK'); this.indexed=null; throw e; }
    this.indexed=next;return changed.length+removed.length;
  }
  rebuildBackground() {
    if(this.closed)return Promise.resolve(false);
    if(this.pending){this.again=true;return this.pending;}
    this.pending=(async()=>{
      let changed=false;
      do {
        this.again=false;
        const generation=this.generation,documents=await this.readBackground();
        if(this.closed)break;
        // A foreground writer/rebuild may run while file reads yield. Never
        // replace its newer index with the earlier background collection.
        if(generation!==this.generation){this.again=true;continue;}
        changed=this.replace(documents)>0||changed;
      }while(this.again&&!this.closed);
      return changed;
    })().finally(()=>{this.pending=null;});
    return this.pending;
  }
  // Put the records a write just changed straight into the index, so a search
  // run immediately afterwards finds them. Rebuilding instead reads every
  // record and every workspace file: before the answer it cost a note save
  // more than the save, and after it, it cost the next search that much.
  // Writing the few rows that changed costs neither.
  update(records) {
    this.generation=(this.generation||0)+1;
    const remove=this.db.prepare('DELETE FROM documents WHERE uid=?'),insert=this.db.prepare('INSERT OR REPLACE INTO documents VALUES(?,?,?,?,?)');
    this.db.exec('BEGIN');
    try {
      for(const record of records){
        if(!record?.uid||!record?.type)continue;
        remove.run(record.uid);this.indexed?.delete(record.uid);
        if(!record.removed_at){const document=[record.uid,record.type,record.id,record.title||record.name||record.id,JSON.stringify(record)];insert.run(...document);this.indexed?.set(record.uid,document);}
      }
      this.db.exec('COMMIT');
    } catch(error) { this.db.exec('ROLLBACK'); this.indexed=null; throw error; }
    // What the index holds is tracked row by row, so the next refresh compares
    // against these rows and writes only what still differs.
    this.lastRebuild=new Date().toISOString();
  }
  // Every file is read in one step that cannot be interrupted, and the loop
  // then hands the event loop back. A read that spans an await keeps the file
  // open, and on Windows an open record file makes the atomic rename behind a
  // note save fail: the save waits for a handle that only this same thread
  // could close, so it waited out its whole deadline and refused the edit.
  // Pausing between files is what keeps the server answering during the read.
  async breathe() {
    if (++this.readsSinceBreath < 25) return;
    this.readsSinceBreath = 0;
    await new Promise(resolve => setImmediate(resolve));
  }
  readText(file) {
    try { return fs.readFileSync(file, 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async readBackground() {
    const documents=[],records=new Map(),io=fs.promises;
    this.readsSinceBreath=0;
    const entries=async folder=>{try{return await io.readdir(folder,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return [];throw error;}};
    for(const dir of await entries(this.store.recordsRoot)){
      if(!dir.isDirectory()||dir.isSymbolicLink())continue;
      for(const entry of await entries(path.join(this.store.recordsRoot,dir.name))){
        if(this.closed)return [];
        if(!entry.isFile()||!/\.(json|md)$/.test(entry.name))continue;
        const file=path.join(this.store.recordsRoot,dir.name,entry.name);
        await this.breathe();
        try{const text=this.readText(file);if(text===null)continue;const record=decode(text,file);record._hash=hash(encode(record));records.set(record.type+'/'+record.id,record);}catch{/* Invalid records are excluded just as in Store.scan. */}
      }
    }
    for(const r of records.values())if(!r.removed_at)documents.push([r.uid,r.type,r.id,r.title||r.name||r.id,JSON.stringify(r)]);
    const visit=async relative=>{
      if(this.closed)return;
      const absolute=path.join(this.store.root,relative);let stat;
      try{stat=await io.lstat(absolute);}catch(error){if(error.code==='ENOENT')return;throw error;}
      if(stat.isSymbolicLink())return;
      if(stat.isDirectory()){for(const entry of await entries(absolute))if(shared(relative+'/'+entry.name))await visit(relative+'/'+entry.name);}
      else if(stat.size<=512*1024&&/\.(md|json|jsonl|txt)$/.test(relative)){
        await this.breathe();
        const text=this.readText(absolute);
        if(text!==null)documents.push(['file-'+hash(relative),'workspace_file',relative,relative,text]);
      }
    };
    for(const name of [...durableRoots.filter(r=>r!=='records'),...durableFiles])await visit(name);
    return documents;
  }
  search(query) {
    const escaped = String(query).replace(/[\\%_]/g, '\\$&');
    return this.db.prepare("SELECT uid,type,id,title FROM documents WHERE body LIKE ? ESCAPE '\\' LIMIT 200").all('%' + escaped + '%');
  }
  close() { this.closed=true;this.db.close(); }
}
