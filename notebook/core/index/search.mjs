import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {durableRoots,durableFiles,durable} from '../file-policy.mjs';
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
    const visit=relative=>{const absolute=path.join(this.store.root,relative);if(!fs.existsSync(absolute))return;const stat=fs.lstatSync(absolute);if(stat.isSymbolicLink())return;if(stat.isDirectory()){for(const name of fs.readdirSync(absolute))if(durable(relative+'/'+name))visit(relative+'/'+name);}else if(stat.size<=512*1024&&/\.(md|json|jsonl|txt)$/.test(relative))documents.push(['file-'+hash(relative),'workspace_file',relative,relative,fs.readFileSync(absolute,'utf8')]);};
    for(const name of [...durableRoots.filter(r=>r!=='records'),...durableFiles])visit(name);
    return this.replace(documents);
  }
  replace(documents) {
    // Fingerprint content read from disk, never size or timestamps. Avoid writing
    // thousands of identical SQLite rows on every background refresh.
    documents.sort((a,b)=>a[0].localeCompare(b[0]));
    const fingerprint=hash(documents);
    if(fingerprint===this.fingerprint){this.lastRebuild=new Date().toISOString();return false;}
    this.db.exec('BEGIN; DELETE FROM documents;');
    try {
      const insert = this.db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)');
      for(const document of documents)insert.run(...document);
      this.db.exec('COMMIT'); this.fingerprint=fingerprint;this.lastRebuild = new Date().toISOString();return true;
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
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
        changed=this.replace(documents)||changed;
      }while(this.again&&!this.closed);
      return changed;
    })().finally(()=>{this.pending=null;});
    return this.pending;
  }
  async readBackground() {
    const documents=[],records=new Map(),io=fs.promises;
    const entries=async folder=>{try{return await io.readdir(folder,{withFileTypes:true});}catch(error){if(error.code==='ENOENT')return [];throw error;}};
    for(const dir of await entries(this.store.recordsRoot)){
      if(!dir.isDirectory()||dir.isSymbolicLink())continue;
      for(const entry of await entries(path.join(this.store.recordsRoot,dir.name))){
        if(this.closed)return [];
        if(!entry.isFile()||!/\.(json|md)$/.test(entry.name))continue;
        const file=path.join(this.store.recordsRoot,dir.name,entry.name);
        try{const record=decode(await io.readFile(file,'utf8'),file);record._hash=hash(encode(record));records.set(record.type+'/'+record.id,record);}catch{/* Invalid records are excluded just as in Store.scan. */}
      }
    }
    for(const r of records.values())if(!r.removed_at)documents.push([r.uid,r.type,r.id,r.title||r.name||r.id,JSON.stringify(r)]);
    const visit=async relative=>{
      if(this.closed)return;
      const absolute=path.join(this.store.root,relative);let stat;
      try{stat=await io.lstat(absolute);}catch(error){if(error.code==='ENOENT')return;throw error;}
      if(stat.isSymbolicLink())return;
      if(stat.isDirectory()){for(const entry of await entries(absolute))if(durable(relative+'/'+entry.name))await visit(relative+'/'+entry.name);}
      else if(stat.size<=512*1024&&/\.(md|json|jsonl|txt)$/.test(relative)){
        try{documents.push(['file-'+hash(relative),'workspace_file',relative,relative,await io.readFile(absolute,'utf8')]);}catch(error){if(error.code!=='ENOENT')throw error;}
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
