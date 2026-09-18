import json
import tempfile
import unittest
from helpers import load_chat


class Retention(unittest.TestCase):
    def test_text_can_be_removed_without_reopening_or_resending(self):
        Chat=load_chat(self)
        from hub_chat.contracts import Draft,Receipt,Fact
        from hub_chat.retention import prune
        temporary=tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        chat=Chat(temporary.name,'100'); self.addCleanup(chat.close)
        chat.store.put_fact(Fact('done','fixture','2','done','2026-01-01T00:00:00Z','task','Closed item'))
        draft=Draft('old','100','digest','Private old message',(('done','2'),))
        chat.delivery.submit(draft); chat.delivery.claim('old')
        chat.delivery.acknowledge(Receipt('old','sent','22','2026-01-01T00:00:00Z'),draft.text)
        with chat.store.transaction() as db:
            db.execute("UPDATE deliveries SET created_at='2026-01-01T00:00:00Z'")
        cutoff='2026-06-01T00:00:00Z'
        self.assertEqual(prune(chat.store,cutoff,dry_run=True)['messages'],1)
        self.assertEqual(chat.delivery.draft('old').text,draft.text)
        self.assertEqual(prune(chat.store,cutoff)['messages'],1)
        self.assertIsNone(chat.delivery.get('old')['exact_text'])
        self.assertNotIn('Private',chat.delivery.get('old')['body'])
        self.assertEqual(chat.delivery.receipt('old').state,'sent')
        self.assertEqual(chat.delivery.receipt('old').message_id,'22')
        self.assertFalse(chat.delivery.claim('old'))
        self.assertEqual(chat.store.item('done')['status'],'done')
        self.assertEqual(prune(chat.store,cutoff)['messages'],0)

    def test_pending_and_uncertain_records_are_preserved(self):
        Chat=load_chat(self)
        from hub_chat.contracts import Draft
        from hub_chat.retention import prune
        temporary=tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        chat=Chat(temporary.name,'100'); self.addCleanup(chat.close)
        for key in ('queued','uncertain'):
            chat.delivery.submit(Draft(key,'100','digest','Keep this text'))
        chat.delivery.claim('uncertain'); chat.delivery.state('uncertain','uncertain','Connection lost')
        prune(chat.store,'2099-01-01T00:00:00Z')
        for key in ('queued','uncertain'):
            self.assertEqual(chat.delivery.draft(key).text,'Keep this text')
