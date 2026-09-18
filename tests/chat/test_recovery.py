import json
from pathlib import Path
import tempfile
import unittest
from helpers import load_chat


class Recovery(unittest.TestCase):
    def setUp(self):
        load_chat(self)
        self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)

    def test_snapshot_validation_rejects_changed_dependency(self):
        from hub_chat.recovery import seal, verify
        (self.root/'source').mkdir(); (self.root/'env').mkdir()
        (self.root/'source/main.py').write_text('pass\n')
        dependency=self.root/'env/dependency.py'; dependency.write_text('pass\n')
        seal(self.root,'revision','bundle')
        verify(self.root)
        dependency.write_text('changed\n')
        with self.assertRaises(ValueError): verify(self.root)

    def test_unlisted_file_cannot_enter_recovery(self):
        from hub_chat.recovery import seal, verify
        (self.root/'source').mkdir(); (self.root/'env').mkdir()
        seal(self.root,'revision','bundle')
        (self.root/'source/injected.py').write_text('pass\n')
        with self.assertRaises(ValueError): verify(self.root)

    def test_snapshot_excludes_mutable_bytecode(self):
        from hub_chat.recovery import seal, verify
        (self.root/'source').mkdir(); (self.root/'env').mkdir()
        seal(self.root,'revision','bundle')
        (self.root/'source/__pycache__').mkdir()
        (self.root/'source/__pycache__/main.pyc').write_bytes(b'cache')
        verify(self.root)
