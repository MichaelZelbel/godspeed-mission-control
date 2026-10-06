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
            self.assertEqual(json.loads(content)['format'],2)
        snapshot=next((self.workspace/'assistant-state').glob('*/*.json'))
        self.assertEqual(json.loads(snapshot.read_text())['format'],2)
        for part in (self.workspace/'assistant-state').glob('*/*/*.json'):
            self.assertEqual(json.loads(part.read_text(encoding='utf-8'))['format'],2)

    # Until 6 October 2026 every message rewrote the whole history (35 MB on a
    # working server) and kept a full copy of the previous one.
    def test_a_save_rewrites_only_the_part_whose_rows_changed(self):
        self.initialize()
        result=self.run_python('import sqlite3,os; from pathlib import Path; c=sqlite3.connect(str(Path(os.environ["HERMES_HOME"])/"state.db"),isolation_level=None); c.execute("BEGIN"); [c.execute("INSERT INTO messages(text) VALUES (?)",("fictional message %d" % i,)) for i in range(150)]; c.execute("COMMIT"); c.close()')
        self.assertEqual(result.returncode,0,result.stderr)
        folder=next(p for p in (self.workspace/'assistant-state').glob('*/*') if p.is_dir() and p.name!='history')
        before={p.name:p.read_bytes() for p in folder.glob('*.json')}
        self.assertGreaterEqual(len(before),5)
        history=set((self.workspace/'assistant-state/history').rglob('*'))
        result=self.run_python('import sqlite3,os; from pathlib import Path; c=sqlite3.connect(str(Path(os.environ["HERMES_HOME"])/"state.db"),isolation_level=None); c.execute("UPDATE messages SET text=? WHERE id=40",("fictional correction",)); c.close()')
        self.assertEqual(result.returncode,0,result.stderr)
        after={p.name:p.read_bytes() for p in folder.glob('*.json')}
        self.assertEqual([name for name in before if before[name]!=after[name]],[next(n for n in before if n.endswith('-1.json'))],'only the part holding row 40 changed')
        added=set((self.workspace/'assistant-state/history').rglob('*.json*'))-history
        self.assertEqual(len(added),2,'the history keeps the old part and the old file list, nothing else')
        result=self.run_python('import sqlite3,os; from pathlib import Path; p=Path(os.environ["HERMES_HOME"])/"state.db"; p.unlink(); c=sqlite3.connect(str(p)); assert c.execute("SELECT count(*) FROM messages").fetchone()[0]==151; assert c.execute("SELECT text FROM messages WHERE id=40").fetchone()[0]=="fictional correction"; assert c.execute("SELECT binary FROM messages WHERE id=1").fetchone()[0]==b"\\x00\\xff"; c.close()')
        self.assertEqual(result.returncode,0,result.stderr)

    def test_history_older_than_thirty_days_goes_but_the_newest_five_stay(self):
        self.initialize()
        old = self.workspace / 'assistant-state/history/fictional-profile/fictional-file'
        old.mkdir(parents=True)
        month = 40 * 86400
        for i in range(8):
            f = old / ('%064d.json' % i)
            f.write_text('{}', encoding='utf-8')
            os.utime(f, (f.stat().st_atime - month - i, f.stat().st_mtime - month - i))
        (self.workspace / '.godspeed/assistant-history-pruned').unlink()
        result = self.run_python('import sqlite3,os; from pathlib import Path; c=sqlite3.connect(str(Path(os.environ["HERMES_HOME"])/"state.db"),isolation_level=None); c.execute("INSERT INTO messages(text) VALUES (?)",("prune now",)); c.close()')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(sorted(f.name for f in old.iterdir()), ['%064d.json' % i for i in range(5)])

    def test_a_single_file_state_from_before_is_read_and_converted(self):
        self.initialize()
        # Write the state as the earlier single file, then rebuild from it.
        result=self.run_python('import sqlite3,os,json,hashlib; from pathlib import Path; p=Path(os.environ["HERMES_HOME"])/"state.db"; c=sqlite3.connect(str(p)); s=c._snapshot(); s["tables"][[t["name"] for t in s["tables"]].index("messages")]["rows"].append([5,"fictional older message",None]); m=next((Path(os.environ["GODSPEED_WORKSPACE"])/"assistant-state").glob("*/*.json")); c.close(); import shutil; [shutil.rmtree(d) for d in m.parent.iterdir() if d.is_dir()]; m.write_text(json.dumps(s,ensure_ascii=False,sort_keys=True,indent=2)+"\\n",encoding="utf-8"); p.unlink()')
        self.assertEqual(result.returncode,0,result.stderr)
        result=self.run_python('import sqlite3,os; from pathlib import Path; c=sqlite3.connect(str(Path(os.environ["HERMES_HOME"])/"state.db"),isolation_level=None); assert c.execute("SELECT text FROM messages WHERE id=5").fetchone()[0]=="fictional older message"; c.execute("INSERT INTO messages(text) VALUES (?)",("after the change",)); c.close()')
        self.assertEqual(result.returncode,0,result.stderr)
        manifest=json.loads(next((self.workspace/'assistant-state').glob('*/*.json')).read_text(encoding='utf-8'))
        self.assertEqual(manifest['format'],2)
        result=self.run_python('import sqlite3,os; from pathlib import Path; p=Path(os.environ["HERMES_HOME"])/"state.db"; p.unlink(); c=sqlite3.connect(str(p)); assert [r[0] for r in c.execute("SELECT text FROM messages ORDER BY id")]==["Exact ü text","fictional older message","after the change"]; c.close()')
        self.assertEqual(result.returncode,0,result.stderr)

    def test_synced_crlf_snapshot_remains_writable(self):
        self.initialize()
        snapshot=next((self.workspace/'assistant-state').glob('*/*.json'))
        snapshot.write_bytes(snapshot.read_bytes().replace(b'\r\n',b'\n').replace(b'\n',b'\r\n'))
        result=self.run_python('import sqlite3,os; from pathlib import Path; c=sqlite3.connect(str(Path(os.environ["HERMES_HOME"])/"state.db"),isolation_level=None); c.execute("INSERT INTO messages(text) VALUES (?)",("after sync",)); assert c.execute("SELECT COUNT(*) FROM messages").fetchone()[0]==2; c.close()')
        self.assertEqual(result.returncode,0,result.stderr)

    def test_unchanged_startup_transactions_skip_whole_history_serialization(self):
        self.initialize()
        result=self.run_python('''import sqlite3,os,hashlib
from pathlib import Path
c=sqlite3.connect(str(Path(os.environ["HERMES_HOME"])/"state.db"),isolation_level=None)
snapshot=next((Path(os.environ["GODSPEED_WORKSPACE"])/"assistant-state").glob("*/*.json"))
before=snapshot.read_bytes();count=[0];full=[];original=type(c)._changes
def measured(self,whole):
 count[0]+=1;full.append(whole)
 return original(self,whole)
type(c)._changes=measured
for _ in range(40):
 c.execute("CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT, binary BLOB)")
 c.execute("BEGIN IMMEDIATE");c.execute("SELECT * FROM messages").fetchall();c.commit()
assert count[0]==0, "Unchanged startup transactions serialized history "+str(count[0])+" times"
assert snapshot.read_bytes()==before
c.execute("CREATE INDEX message_text ON messages(text)")
c.execute("PRAGMA user_version=8")
c.execute("INSERT INTO messages(text) VALUES (?)",("retained actual change",))
assert count[0]==3
assert full==[True,True,False], "Only schema changes reread every table: "+str(full)
assert c.execute("PRAGMA user_version").fetchone()[0]==8
c.close()
''')
        self.assertEqual(result.returncode,0,result.stderr)
        result=self.run_python('import sqlite3,os;from pathlib import Path;c=sqlite3.connect(str(Path(os.environ["HERMES_HOME"])/"state.db"));assert c.execute("SELECT text FROM messages WHERE id=2").fetchone()[0]=="retained actual change";assert c.execute("PRAGMA user_version").fetchone()[0]==8;assert c.execute("SELECT name FROM sqlite_master WHERE name=\'message_text\'").fetchone();c.close()')
        self.assertEqual(result.returncode,0,result.stderr)

    def test_publication_failure_rolls_back(self):
        self.initialize()
        result = self.run_python('import sqlite3,os; from pathlib import Path; c=sqlite3.connect(str(Path(os.environ["HERMES_HOME"])/"state.db"),isolation_level=None); c.execute("INSERT INTO messages(text) VALUES (?)",("must roll back",))', GODSPEED_ASSISTANT_PUBLISHER=str(self.temp / 'missing-publisher.mjs'))
        self.assertNotEqual(result.returncode, 0)
        result = self.run_python('import sqlite3,os; from pathlib import Path; c=sqlite3.connect(str(Path(os.environ["HERMES_HOME"])/"state.db")); assert c.execute("SELECT count(*) FROM messages").fetchone()[0]==1; c.close()')
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_mid_transaction_conflict_retains_both(self):
        self.initialize()
        # Another copy of this state arrives while a write is under way: its part and file list change.
        result = self.run_python('import sqlite3,os,json,hashlib; from pathlib import Path; c=sqlite3.connect(str(Path(os.environ["HERMES_HOME"])/"state.db"),isolation_level=None); c.execute("BEGIN IMMEDIATE"); c.execute("INSERT INTO messages(text) VALUES (?)",("local edit",)); root=Path(os.environ["GODSPEED_WORKSPACE"]); p=next((root/"assistant-state").glob("*/*.json")); snapshot=json.loads(p.read_text(encoding="utf-8")); part=next(t for t in snapshot["tables"] if t["name"]=="messages")["parts"][0]; rows=json.loads((root/part["file"]).read_text(encoding="utf-8")); rows["rows"][0][1]="remote edit"; text=json.dumps(rows,ensure_ascii=False,sort_keys=True)+"\\n"; (root/part["file"]).write_bytes(text.encode("utf-8")); part["hash"]=hashlib.sha256(text.encode("utf-8")).hexdigest(); p.write_text(json.dumps(snapshot),encoding="utf-8"); c.commit()')
        self.assertNotEqual(result.returncode, 0)
        conflicts = list((self.workspace / 'conflicts').glob('*.json'))
        self.assertEqual(len(conflicts), 1)
        conflict = json.loads(conflicts[0].read_text(encoding='utf-8'))
        # Both sides are kept whole, as one readable file each, for a person to choose.
        self.assertIn('local edit', conflict['local'])
        self.assertEqual(json.loads(conflict['local'])['format'], 1)
        self.assertIn('remote edit', conflict['remote'])
        self.assertIn('"messages"', conflict['base'])

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
