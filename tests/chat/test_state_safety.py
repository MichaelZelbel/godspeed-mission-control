import sqlite3
import tempfile
import unittest
from pathlib import Path
from helpers import load_chat


class StateSafety(unittest.TestCase):
    def test_migration_conflict_rolls_back_the_whole_batch(self):
        import json
        from dataclasses import asdict,replace
        Chat=load_chat(self)
        from hub_chat.contracts import Fact
        from hub_chat.migrate import import_legacy
        with tempfile.TemporaryDirectory() as directory:
            chat=Chat(directory,'100')
            try:
                original=Fact('taken','first','1','done','2026-09-18T10:00:00Z','task','Example')
                chat.store.put_fact(original)
                file=Path(directory)/'import.json'
                file.write_text(json.dumps([asdict(replace(original,item_id='new')),asdict(replace(original,source='other'))]))
                with self.assertRaises(ValueError): import_legacy(chat,file)
                self.assertIsNone(chat.store.item('new'))
                self.assertEqual(chat.store.item('taken')['source'],'first')
            finally: chat.close()

    def test_newer_schema_is_not_modified(self):
        Chat = load_chat(self)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'communication.sqlite3'
            db = sqlite3.connect(path)
            db.execute('CREATE TABLE schema_versions(version INTEGER PRIMARY KEY)')
            db.execute('INSERT INTO schema_versions VALUES(99)')
            db.commit()
            before = db.execute('SELECT name FROM sqlite_master').fetchall()
            with self.assertRaises(ValueError):
                Chat(directory, 'reader')
            self.assertEqual(db.execute('SELECT name FROM sqlite_master').fetchall(), before)
            db.close()
