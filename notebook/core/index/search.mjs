import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export class SearchIndex {
  constructor(store) {
    this.store = store; this.file = path.join(store.state, 'search.sqlite');
    this.db = new DatabaseSync(this.file);
    this.db.exec('CREATE TABLE IF NOT EXISTS documents (uid TEXT PRIMARY KEY, type TEXT, id TEXT, title TEXT, body TEXT)');
    this.rebuild();
  }
  rebuild() {
    this.store.scan(); this.db.exec('BEGIN; DELETE FROM documents;');
    try {
      const insert = this.db.prepare('INSERT INTO documents VALUES(?,?,?,?,?)');
      for (const r of this.store.records.values()) if (!r.removed_at) insert.run(r.uid, r.type, r.id, r.title || r.name || r.id, JSON.stringify(r));
      this.db.exec('COMMIT'); this.lastRebuild = new Date().toISOString();
    } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  search(query) {
    const escaped = String(query).replace(/[\\%_]/g, '\\$&');
    return this.db.prepare("SELECT uid,type,id,title FROM documents WHERE body LIKE ? ESCAPE '\\' LIMIT 200").all('%' + escaped + '%');
  }
  close() { this.db.close(); }
}
