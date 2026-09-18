"""Profile-local journal. SQLite transactions own every state transition."""
from contextlib import contextmanager
from dataclasses import asdict
import json
import os
from pathlib import Path
import sqlite3
import threading
from .contracts import canonical, utcnow, timestamp


class Store:
    def __init__(self, directory):
        path = Path(directory)
        path.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = path / 'communication.sqlite3'
        self.lock = threading.RLock()
        self.db = sqlite3.connect(self.path, timeout=20, isolation_level=None, check_same_thread=False)
        if os.name != 'nt':
            os.chmod(self.path, 0o600)
        self.db.row_factory = sqlite3.Row
        schema = self.db.execute("SELECT name FROM sqlite_master WHERE name='schema_versions'").fetchone()
        if schema and self.db.execute('SELECT max(version) FROM schema_versions').fetchone()[0] != 1:
            self.db.close()
            raise ValueError('Unsupported communication schema; preserve the database and use the matching package')
        self.db.execute('PRAGMA foreign_keys=ON')
        self.db.execute('PRAGMA journal_mode=WAL')
        self.db.executescript('''
        CREATE TABLE IF NOT EXISTS schema_versions(version INTEGER PRIMARY KEY);
        INSERT OR IGNORE INTO schema_versions VALUES(1);
        CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY, source TEXT NOT NULL, revision TEXT NOT NULL,
          status TEXT NOT NULL, checked_at TEXT NOT NULL, body TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS deliveries(key TEXT PRIMARY KEY, conversation TEXT NOT NULL,
          class TEXT NOT NULL, body TEXT NOT NULL, state TEXT NOT NULL, message_id TEXT,
          sent_at TEXT, exact_text TEXT, created_at TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '');
        CREATE TABLE IF NOT EXISTS delivery_items(delivery_key TEXT NOT NULL REFERENCES deliveries(key),
          item_id TEXT NOT NULL, revision TEXT NOT NULL, PRIMARY KEY(delivery_key,item_id));
        CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY, conversation TEXT NOT NULL,
          operation TEXT NOT NULL, status TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS approvals(id TEXT PRIMARY KEY, conversation TEXT NOT NULL,
          actor TEXT NOT NULL, fingerprint TEXT NOT NULL, body TEXT NOT NULL, expires_at TEXT NOT NULL,
          state TEXT NOT NULL, result TEXT NOT NULL DEFAULT '{}', message_id TEXT);
        CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, kind TEXT NOT NULL,
          detail TEXT NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS inbound(conversation TEXT NOT NULL, message_id TEXT NOT NULL,
          actor TEXT NOT NULL, received_at TEXT NOT NULL, PRIMARY KEY(conversation,message_id));
        CREATE TABLE IF NOT EXISTS message_parts(delivery_key TEXT NOT NULL REFERENCES deliveries(key),
          conversation TEXT NOT NULL, message_id TEXT NOT NULL, text TEXT NOT NULL,
          PRIMARY KEY(conversation,message_id));
        CREATE TABLE IF NOT EXISTS requested_results(key TEXT PRIMARY KEY,source TEXT NOT NULL,
          external_id TEXT NOT NULL,revision TEXT NOT NULL,body TEXT NOT NULL,state TEXT NOT NULL,
          delivery_key TEXT NOT NULL,created_at TEXT NOT NULL);
        ''')
        if self.db.execute('SELECT max(version) FROM schema_versions').fetchone()[0] != 1:
            raise ValueError('Unsupported communication schema; preserve the database and use the matching package')

    @contextmanager
    def transaction(self):
        with self.lock:
            self.db.execute('BEGIN IMMEDIATE')
            try:
                yield self.db
                self.db.execute('COMMIT')
            except BaseException:
                self.db.execute('ROLLBACK')
                raise

    def rows(self, sql, args=()):
        with self.lock:
            return [dict(r) for r in self.db.execute(sql, args).fetchall()]

    def item(self, item_id):
        rows = self.rows('SELECT body FROM items WHERE id=?', (item_id,))
        return json.loads(rows[0]['body']) if rows else None

    def put_fact(self, fact, reopens_revision=None):
        with self.transaction() as db:
            self.put_fact_in(db,fact,reopens_revision)

    def put_fact_in(self,db,fact,reopens_revision=None):
        previous = db.execute('SELECT * FROM items WHERE id=?', (fact.item_id,)).fetchone()
        if previous:
            if previous['source'] != fact.source:
                raise ValueError('A source cannot replace another source\'s item')
            if fact.status == 'unknown' or timestamp(previous['checked_at']) > timestamp(fact.checked_at):
                return
            if previous['status'] == 'done' and fact.status == 'open' and reopens_revision != previous['revision']:
                return
        db.execute('INSERT OR REPLACE INTO items VALUES(?,?,?,?,?,?)',
                   (fact.item_id, fact.source, fact.revision, fact.status, fact.checked_at, canonical(asdict(fact))))

    def shown_ids(self):
        return [r['item_id'] for r in self.rows("SELECT DISTINCT item_id FROM delivery_items JOIN deliveries ON delivery_key=key WHERE state='sent'")]

    def audit(self, kind, detail):
        with self.transaction() as db:
            db.execute('INSERT INTO audit(kind,detail,created_at) VALUES(?,?,?)', (kind, str(detail)[:2000], utcnow()))

    def close(self):
        with self.lock:
            try:
                self.db.close()
            except sqlite3.ProgrammingError:
                pass
