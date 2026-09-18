import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace as NS
from helpers import load_chat


class Inbox(unittest.TestCase):
    def setUp(self):
        Chat=load_chat(self); self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.chat=Chat(Path(self.tmp.name)/'state','100'); self.addCleanup(self.chat.close)
        self.boundary=NS(chat=self.chat,profile=Path(self.tmp.name),config={})
        from hub_chat.inbox import submit_event,import_pending
        self.submit,self.consume=submit_event,import_pending

    def test_forged_destination_and_class_are_refused(self):
        self.submit(Path(self.tmp.name)/'chat-inbox',{'schema':1,'item_ids':['x'],'conversation':'other','output_class':'reply'})
        self.consume(self.boundary)
        self.assertEqual(self.chat.store.rows('SELECT * FROM deliveries'),[])
        self.assertEqual(self.chat.store.rows('SELECT kind FROM audit')[0]['kind'],'inbox_rejected')

    def test_partial_file_is_not_imported(self):
        root=Path(self.tmp.name)/'chat-inbox'; root.mkdir(); (root/'partial.tmp').write_text('{')
        self.consume(self.boundary)
        self.assertTrue((root/'partial.tmp').exists())
        self.assertEqual(self.chat.store.rows('SELECT * FROM deliveries'),[])

    def test_unregistered_report_cannot_send_producer_text(self):
        self.submit(Path(self.tmp.name)/'chat-inbox',{'schema':1,'report':'unknown','revision':'x'})
        self.consume(self.boundary)
        self.assertEqual(self.chat.store.rows('SELECT * FROM deliveries'),[])

    def test_stopped_service_is_not_called_a_failure_without_abnormal_exit(self):
        from hub_chat.health_source import read
        run=lambda *a,**k:NS(returncode=0,stdout='ActiveState=failed\nResult=success\nLoadState=loaded\n')
        self.assertEqual(read('example.service',run)[0]['status'],'unknown')

    def test_repaired_service_is_closed(self):
        from hub_chat.health_source import read
        run=lambda *a,**k:NS(returncode=0,stdout='ActiveState=active\nResult=success\nLoadState=loaded\n')
        self.assertEqual(read('example.service',run)[0]['status'],'done')
