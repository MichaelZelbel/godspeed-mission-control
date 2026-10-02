import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {durableRoots,durableFiles,durable} from '../file-policy.mjs';
import {hash} from '../records/store.mjs';

export class SearchIndex {
  constructor(store) {
    this.store = store; this.file = path.join(store.state, 'search.sqlite');
    const open=()=>{this.db = new DatabaseSync(this.file);this.db.exec('CREATE TABLE IF NOT EXISTS documents (uid TEXT PRIMARY KEY, type TEXT, id TEXT, title TEXT, body TEXT)');};
    try{open();}catch(error){try{this.db?.close();}catch{}if(fs.existsSync(this.file))fs.renameSync(this.file,this.file+'.corrupt-'+Date.now());for(const suffix of ['-wal','-shm'])if(fs.existsSync(this.file+suffix))fs.renameSync(this.file+suffix,this.file+'.corrupt-'+Date.now()+suffix);open();this.recovered=true;}
    this.rebuild();
  }
  rebuild() {
    this.store.scan(); this.db.exec('BEGIN; DELETE FROM documents;');
    try {
      const insert = this.db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)');
      for (const r of this.store.records.values()) if (!r.removed_at) insert.run(r.uid, r.type, r.id, r.title || r.name || r.id, JSON.stringify(r));
      const visit=relative=>{const absolute=path.join(this.store.root,relative);if(!fs.existsSync(absolute))return;const stat=fs.lstatSync(absolute);if(stat.isSymbolicLink())return;if(stat.isDirectory()){for(const name of fs.readdirSync(absolute))if(durable(relative+'/'+name))visit(relative+'/'+name);}else if(stat.size<=512*1024&&/\.(md|json|jsonl|txt)$/.test(relative))insert.run('file-'+hash(relative),'workspace_file',relative,relative,fs.readFileSync(absolute,'utf8'));};
      for(const name of [...durableRoots.filter(r=>r!=='records'),...durableFiles])visit(name);
      this.db.exec('COMMIT'); this.lastRebuild = new Date().toISOString();
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  search(query) {
    const escaped = String(query).replace(/[\\%_]/g, '\\$&');
    return this.db.prepare("SELECT uid,type,id,title FROM documents WHERE body LIKE ? ESCAPE '\\' LIMIT 200").all('%' + escaped + '%');
  }
  close() { this.db.close(); }
}
