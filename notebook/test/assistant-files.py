"""Exercise real SQLite, independent Python processes and the notebook publisher."""
import json
import gzip
import hashlib
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


class AssistantFiles(unittest.TestCase):
    def setUp(self):
        self.temp = Path(tempfile.mkdtemp(prefix='godspeed-assistant-files-'))
        self.home = self.temp / 'home'
        self.workspace = self.temp / 'workspace'
        notebook = Path(__file__).resolve().parent.parent
        self.env = dict(os.environ, HERMES_HOME=str(self.home), GODSPEED_WORKSPACE=str(self.workspace), GODSPEED_FILE_HERMES='1', GODSPEED_NODE=os.environ['GODSPEED_TEST_NODE'], GODSPEED_ASSISTANT_PUBLISHER=str(notebook / 'scripts/save-assistant-state.mjs'), PYTHONPATH=str(notebook / 'assistant-files'))
        self.env.pop('GODSPEED_MEDIA_ROOT', None)

    def tearDown(self):
        shutil.rmtree(self.temp)

    def run_python(self, script, **env):
        return subprocess.run([sys.executable, '-c', script], env=dict(self.env, **env), capture_output=True, text=True, encoding='utf-8', timeout=90)

    def initialize(self):
        result = self.run_python('import sqlite3,os; from pathlib import Path; c=sqlite3.connect(str(Path(os.environ["HERMES_HOME"])/"state.db"),isolation_level=None); c.executescript("CREATE TABLE messages(id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT, binary BLOB); PRAGMA user_version=7;"); c.execute("INSERT INTO messages(text,binary) VALUES (?,?)",("Exact ü text",b"\\x00\\xff")); c.close()')
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_rebuild_ids_blobs_history_and_multiple_writers(self):
        self.initialize()
        (self.home / 'state.db').unlink()
        result = self.run_python('import sqlite3,os; from pathlib import Path; p=str(Path(os.environ["HERMES_HOME"])/"state.db"); a=sqlite3.connect(p,isolation_level=None); b=sqlite3.connect(p,isolation_level=None); assert a.execute("SELECT * FROM messages").fetchone()==(1,"Exact ü text",b"\\x00\\xff"); assert a.execute("PRAGMA user_version").fetchone()[0]==7; a.execute("INSERT INTO messages(text) VALUES (?)",("second",)); b.execute("INSERT INTO messages(text) VALUES (?)",("third",)); assert b.execute("SELECT id FROM messages ORDER BY id").fetchall()==[(1,),(2,),(3,)]; a.close(); b.close()')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertTrue(list((self.workspace / 'assistant-state/history').rglob('*.json')))

    def test_large_history_is_losslessly_compressed_and_current_state_stays_plain_json(self):
        self.initialize()
        result=self.run_python('import sqlite3,os; from pathlib import Path; c=sqlite3.connect(str(Path(os.environ["HERMES_HOME"])/"state.db"),isolation_level=None); c.execute("INSERT INTO messages(text) VALUES (?)",("Fictional repeated test text. "*10000,)); c.execute("INSERT INTO messages(text) VALUES (?)",("later",)); c.close()')
        self.assertEqual(result.returncode,0,result.stderr)
        histories=list((self.workspace/'assistant-state/history').rglob('*.json.gz'))
        self.assertTrue(histories)
        for archive in histories:
            content=gzip.decompress(archive.read_bytes())
            self.assertEqual(hashlib.sha256(content).hexdigest(),archive.name.split('.')[0])
            self.assertLess(archive.stat().st_size,len(content)//4)
            self.assertEqual(json.loads(content)['format'],1)
        snapshot=next((self.workspace/'assistant-state').glob('*/*.json'))
        self.assertEqual(json.loads(snapshot.read_text())['format'],1)

    def test_synced_crlf_snapshot_remains_writable(self):
        self.initialize()
        snapshot=next((self.workspace/'assistant-state').glob('*/*.json'))
        snapshot.write_bytes(snapshot.read_bytes().replace(b'\r\n',b'\n').replace(b'\n',b'\r\n'))
        result=self.run_python('import sqlite3,os; from pathlib import Path; c=sqlite3.connect(str(Path(os.environ["HERMES_HOME"])/"state.db"),isolation_level=None); c.execute("INSERT INTO messages(text) VALUES (?)",("after sync",)); assert c.execute("SELECT COUNT(*) FROM messages").fetchone()[0]==2; c.close()')
        self.assertEqual(result.returncode,0,result.stderr)

    def test_publication_failure_rolls_back(self):
        self.initialize()
        result = self.run_python('import sqlite3,os; from pathlib import Path; c=sqlite3.connect(str(Path(os.environ["HERMES_HOME"])/"state.db"),isolation_level=None); c.execute("INSERT INTO messages(text) VALUES (?)",("must roll back",))', GODSPEED_ASSISTANT_PUBLISHER=str(self.temp / 'missing-publisher.mjs'))
        self.assertNotEqual(result.returncode, 0)
        result = self.run_python('import sqlite3,os; from pathlib import Path; c=sqlite3.connect(str(Path(os.environ["HERMES_HOME"])/"state.db")); assert c.execute("SELECT count(*) FROM messages").fetchone()[0]==1; c.close()')
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_mid_transaction_conflict_retains_both(self):
        self.initialize()
        result = self.run_python('import sqlite3,os,json; from pathlib import Path; c=sqlite3.connect(str(Path(os.environ["HERMES_HOME"])/"state.db"),isolation_level=None); c.execute("BEGIN IMMEDIATE"); c.execute("INSERT INTO messages(text) VALUES (?)",("local edit",)); p=next((Path(os.environ["GODSPEED_WORKSPACE"])/"assistant-state").glob("*/*.json")); snapshot=json.loads(p.read_text()); next(t for t in snapshot["tables"] if t["name"]=="messages")["rows"][0][1]="remote edit"; p.write_text(json.dumps(snapshot)); c.commit()')
        self.assertNotEqual(result.returncode, 0)
        conflicts = list((self.workspace / 'conflicts').glob('*.json'))
        self.assertEqual(len(conflicts), 1)
        conflict = json.loads(conflicts[0].read_text(encoding='utf-8'))
        self.assertIn('local edit', conflict['local'])
        self.assertIn('remote edit', conflict['remote'])
        self.assertIn('Exact ü text', conflict['base'])

    def test_crash_after_file_before_database_rolls_forward(self):
        self.initialize()
        wrapper = self.temp / 'crash-publisher.mjs'
        wrapper.write_text('import fs from "node:fs";import {spawnSync} from "node:child_process";const r=spawnSync(process.execPath, [process.env.ORIGINAL_PUBLISHER], {input:fs.readFileSync(0),env:process.env});if(r.status)process.exit(r.status);process.kill(process.ppid,"SIGKILL");')
        result = self.run_python('import sqlite3,os;from pathlib import Path;c=sqlite3.connect(str(Path(os.environ["HERMES_HOME"])/"state.db"),isolation_level=None);c.execute("INSERT INTO messages(text) VALUES (?)",("published before crash",))', GODSPEED_ASSISTANT_PUBLISHER=str(wrapper), ORIGINAL_PUBLISHER=self.env['GODSPEED_ASSISTANT_PUBLISHER'])
        self.assertNotEqual(result.returncode, 0)
        result = self.run_python('import sqlite3,os;from pathlib import Path;c=sqlite3.connect(str(Path(os.environ["HERMES_HOME"])/"state.db"));assert c.execute("SELECT text FROM messages WHERE id=2").fetchone()==("published before crash",);c.close()')
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_checked_backup_restore_and_explicit_profile_selection(self):
        self.initialize()
        notebook = Path(__file__).resolve().parent.parent
        archive = self.temp / 'backup'
        cli = str(notebook / 'bin/godspeed.mjs')
        result = subprocess.run([self.env['GODSPEED_NODE'], cli, 'backup', str(archive)], env=self.env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        restored = self.temp / 'restored-workspace'
        fresh_home = self.temp / 'restored-home'
        fresh_home.mkdir()
        env = dict(self.env, GODSPEED_WORKSPACE=str(restored), HERMES_HOME=str(fresh_home))
        result = subprocess.run([env['GODSPEED_NODE'], cli, 'restore', str(archive)], env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        (restored / '.godspeed/assistant.json').write_text(json.dumps({'verified': True, 'home': str(fresh_home)}), encoding='utf-8')
        profile = json.loads((self.home / 'godspeed-file-profile.json').read_text(encoding='utf-8'))['id']
        result = subprocess.run([env['GODSPEED_NODE'], cli, 'assistant', 'select', profile], env=env, capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        result = subprocess.run([sys.executable, '-c', 'import sqlite3,os;from pathlib import Path;c=sqlite3.connect(str(Path(os.environ["HERMES_HOME"])/"state.db"));assert c.execute("SELECT text FROM messages WHERE id=1").fetchone()==("Exact ü text",);c.close()'], env=env, capture_output=True, text=True, encoding='utf-8')
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()
