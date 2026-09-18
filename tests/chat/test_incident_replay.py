import unittest
import tempfile
from helpers import load_chat, Adapter, fixture


class Incident(unittest.TestCase):
    def test_complete_exchange(self):
        Chat = load_chat(self)
        data = fixture('september-18.json')
        with tempfile.TemporaryDirectory() as state:
            app = Chat(state, conversation_id=data['conversation'], timezone='Europe/Berlin')
            source = lambda ids, now: [dict(x, source='fixture', checked_at=now) for x in data['items'] if x['item_id'] in ids]
            app.sources.register('fixture', source)
            facts = app.sources.refresh([x['item_id'] for x in data['items']], data['now'])
            draft = app.compose(facts, data['now'])
            adapter = Adapter()
            receipt = app.delivery.submit(draft)
            self.assertEqual(receipt.state, 'queued')
            self.assertEqual(app.store.shown_ids(), [])
            app.dispatch(draft.delivery_key, adapter.send, data['now'])
            self.assertEqual(set(app.store.shown_ids()), {'name-choice', 'report'})
            self.assertNotIn('five decisions', adapter.messages[0][1].lower())
            app.close()
            app = Chat(state, conversation_id=data['conversation'], timezone='Europe/Berlin')
            app.sources.register('fixture', source)
            ctx = app.context.resolve(data['conversation'], '1', data['followup'], data['now'])
            self.assertEqual(set(f.item_id for f in ctx.facts), {'name-choice', 'report'})
            action = {'summary':'Delete the temporary test file', 'actor':'reader', 'fingerprint':'fixture-delete'}
            aid = app.approvals.create(action, data['conversation'], '2026-09-18T09:33:25Z')
            result = app.approvals.decide(aid, 'reader', 'once', '2026-09-18T09:40:02Z')
            self.assertEqual(result['state'], 'expired')
            self.assertFalse(result['may_execute'])
            app.close()


if __name__ == '__main__':
    unittest.main()
