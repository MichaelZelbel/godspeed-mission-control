import sqlite3
import tempfile
import unittest
from pathlib import Path
from helpers import load_chat


class StateSafety(unittest.TestCase):
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
