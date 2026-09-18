import unittest
import tempfile
from dataclasses import replace
from helpers import load_chat, Adapter


class Core(unittest.TestCase):
    def setUp(self):
        Chat = load_chat(self)
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.app = Chat(self.tmp.name, conversation_id='reader', timezone='UTC')
        self.addCleanup(self.app.close)
        self.now = '2026-09-18T10:00:00Z'
        self.rows = {'a': {'item_id':'a', 'source':'fixture','revision':'1','checked_at':self.now,'status':'open','kind':'decision','subject':'Choose the kit name','next_action':'Choose Oak or Cedar.','consequence':'The launch waits.'}}
        self.app.sources.register('fixture', lambda ids, now: [dict(self.rows[i], checked_at=now) for i in ids])

    def draft(self):
        return self.app.compose(self.app.sources.refresh(['a'], self.now), self.now)

    def test_read_error_is_unknown_and_preserves_done(self):
        self.rows['a']['status'] = 'done'
        self.app.sources.refresh(['a'], self.now)
        del self.rows['a']
        facts = self.app.sources.refresh(['a'], self.now)
        self.assertEqual(facts[0].status, 'unknown')
        self.assertEqual(self.app.store.item('a')['status'], 'done')

    def test_send_time_completion_suppresses_draft(self):
        draft = self.draft()
        self.app.delivery.submit(draft)
        self.rows['a'].update(status='done', revision='2')
        adapter = Adapter()
        receipt = self.app.dispatch(draft.delivery_key, adapter.send, self.now)
        self.assertEqual(receipt.state, 'suppressed')
        self.assertEqual(adapter.messages, [])

    def test_duplicate_dispatch_does_not_repeat(self):
        draft = self.draft()
        self.app.delivery.submit(draft)
        adapter = Adapter()
        for _ in range(2):
            self.app.dispatch(draft.delivery_key, adapter.send, self.now)
        self.assertEqual(len(adapter.messages), 1)

    def test_timeout_is_uncertain_not_retried(self):
        draft = self.draft()
        self.app.delivery.submit(draft)
        adapter = Adapter()
        adapter.failure = TimeoutError()
        self.assertEqual(self.app.dispatch(draft.delivery_key, adapter.send, self.now).state, 'uncertain')
        adapter.failure = None
        self.app.dispatch(draft.delivery_key, adapter.send, self.now)
        self.assertEqual(adapter.messages, [])
        self.assertEqual(self.app.store.shown_ids(), [])

    def test_foreign_reply_is_not_resolved(self):
        draft = self.draft()
        self.app.delivery.submit(draft)
        self.app.dispatch(draft.delivery_key, Adapter().send, self.now)
        self.assertEqual(self.app.context.resolve('stranger','1','what?',self.now).messages, ())

    def test_wrong_actor_cannot_approve(self):
        aid = self.app.approvals.create({'summary':'Delete test file','actor':'reader','fingerprint':'x'}, 'reader', '2026-09-18T10:01:00Z')
        with self.assertRaises(PermissionError):
            self.app.approvals.decide(aid,'stranger','once',self.now)
        self.assertEqual(self.app.approvals.decide(aid,'reader','once',self.now)['state'], 'approved')
        self.assertFalse(self.app.approvals.decide(aid,'reader','once',self.now)['may_execute'])

    def test_internal_class_is_refused(self):
        draft = replace(self.draft(), output_class='progress')
        with self.assertRaises(ValueError):
            self.app.delivery.submit(draft)

    def test_same_key_different_content_is_refused(self):
        draft = self.draft()
        self.app.delivery.submit(draft)
        with self.assertRaises(ValueError):
            self.app.delivery.submit(replace(draft, text='Different meaning'))

    def test_pending_approval_after_restart_is_cancelled(self):
        aid = self.app.approvals.create({'summary':'Delete test file','actor':'reader','fingerprint':'x'}, 'reader', '2026-09-18T10:01:00Z')
        self.app.approvals.cancel_pending('Gateway restarted; no command is waiting.')
        self.assertEqual(self.app.approvals.decide(aid,'reader','once',self.now)['state'],'cancelled')
