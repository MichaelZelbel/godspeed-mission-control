import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from helpers import ROOT


class Installation(unittest.TestCase):
    def test_repeat_bundle_install_keeps_one_version_and_no_gateway(self):
        with tempfile.TemporaryDirectory() as home:
            command=['node',str(ROOT/'tools/install-chat.js'),str(ROOT),home]
            first=json.loads(subprocess.check_output(command,text=True))
            second=json.loads(subprocess.check_output(command,text=True))
            self.assertEqual(first['id'],second['id'])
            self.assertFalse((Path(home)/'.hermes').exists())
            manifest=json.loads((Path(second['path'])/'bundle.json').read_text())
            self.assertIn('tools/hub_chat/runtime.py',manifest['files'])
            self.assertIn('integrations/hermes/compatibility.json',manifest['files'])
            self.assertFalse(any('__pycache__' in f for f in manifest['files']))

    def test_tampered_bundle_does_not_replace_pointer(self):
        with tempfile.TemporaryDirectory() as home:
            command=['node',str(ROOT/'tools/install-chat.js'),str(ROOT),home]
            first=json.loads(subprocess.check_output(command,text=True))
            pointer=Path(home)/'.hub/chat/current.json'
            before=pointer.read_bytes()
            (Path(first['path'])/'tools/hub_chat/runtime.py').write_text('changed')
            result=subprocess.run(command,capture_output=True,text=True)
            self.assertNotEqual(result.returncode,0)
            self.assertEqual(pointer.read_bytes(),before)

    def test_due_export_is_read_only_and_keeps_closed_items_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); (root/'due').mkdir()
            file=root/'due/example.md'
            file.write_text('TITLE: Choose a name\nDONE-WHEN: Choose Oak or Cedar.\nCOST-IF-MISSED: The launch waits.\nSTRIP: 2026-09-01 2026-09-18 done 2026-09-17\n')
            before=file.read_bytes()
            rows=json.loads(subprocess.check_output(['node',str(ROOT/'tools/due.js'),'export','--hub',directory],text=True))
            self.assertEqual(rows[0]['status'],'done')
            self.assertEqual(file.read_bytes(),before)
