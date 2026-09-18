import json
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from helpers import load_chat


class Sources(unittest.TestCase):
    def setUp(self):
        Chat=load_chat(self); self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.app=Chat(self.tmp.name,'100'); self.addCleanup(self.app.close)
        self.now='2026-09-18T10:00:00Z'
        self.row={'item_id':'one','source':'fixture','revision':'1','status':'done','checked_at':self.now,'kind':'task','subject':'Example','next_action':'Choose a name.'}

    def test_stale_open_import_cannot_reopen_done(self):
        from hub_chat.contracts import Fact
        self.app.store.put_fact(Fact.parse(self.row))
        self.app.store.put_fact(Fact.parse(dict(self.row,status='open',revision='older')))
        self.assertEqual(self.app.store.item('one')['status'],'done')

    def test_explicit_reopen_names_previous_revision(self):
        from hub_chat.contracts import Fact
        self.app.store.put_fact(Fact.parse(self.row))
        self.app.store.put_fact(Fact.parse(dict(self.row,status='open',revision='2')),reopens_revision='1')
        self.assertEqual(self.app.store.item('one')['status'],'open')

    def test_invalid_batch_makes_no_partial_changes(self):
        self.app.sources.register('fixture',lambda ids,now:[self.row,dict(self.row,item_id='two',status='invented')])
        facts=self.app.sources.refresh(['one','two'],self.now)
        self.assertEqual([f.status for f in facts],['unknown','unknown'])
        self.assertIsNone(self.app.store.item('one'))

    def test_concurrent_refresh_is_safe(self):
        self.app.sources.register('fixture',lambda ids,now:[self.row])
        with ThreadPoolExecutor(max_workers=2) as executor:
            results=list(executor.map(lambda _:self.app.sources.refresh(['one'],self.now),range(10)))
        self.assertTrue(all(r[0].status=='done' for r in results))

    def test_missing_adapter_is_unknown_even_with_cached_open_fact(self):
        from hub_chat.contracts import Fact
        self.app.store.put_fact(Fact.parse(dict(self.row,status='open')))
        self.assertEqual(self.app.sources.refresh(['one'],self.now)[0].status,'unknown')

    def test_migration_is_repeatable_and_creates_no_delivery(self):
        from hub_chat.migrate import import_legacy
        file=Path(self.tmp.name)/'old.json'; file.write_text(json.dumps([self.row]))
        self.assertEqual(import_legacy(self.app,file)['delivery_receipts_created'],0)
        self.assertTrue(import_legacy(self.app,file)['already_imported'])
        self.assertEqual(self.app.store.shown_ids(),[])
