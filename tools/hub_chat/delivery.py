from dataclasses import asdict
import json
from .contracts import Draft, Receipt, canonical, utcnow
from .policy import ALLOWED


class Delivery:
    def __init__(self, store):
        self.store = store

    def get(self, key):
        rows = self.store.rows('SELECT * FROM deliveries WHERE key=?', (key,))
        if not rows:
            raise KeyError(key)
        return rows[0]

    def receipt(self, key):
        row = self.get(key)
        return Receipt(key, row['state'], row['message_id'], row['sent_at'])

    def draft(self, key):
        return Draft.parse(json.loads(self.get(key)['body']))

    def submit(self, draft):
        if draft.output_class not in ALLOWED or not draft.text.strip():
            raise ValueError('Internal or empty output cannot be submitted')
        body = canonical(asdict(draft))
        with self.store.transaction() as db:
            previous = db.execute('SELECT body FROM deliveries WHERE key=?', (draft.delivery_key,)).fetchone()
            if previous and previous['body'] != body:
                raise ValueError('Delivery key already belongs to different content')
            db.execute('INSERT OR IGNORE INTO deliveries(key,conversation,class,body,state,created_at) VALUES(?,?,?,?,?,?)',
                       (draft.delivery_key, draft.conversation_id, draft.output_class, body, 'queued', utcnow()))
            for item_id, revision in draft.item_revisions:
                db.execute('INSERT OR IGNORE INTO delivery_items VALUES(?,?,?)', (draft.delivery_key, item_id, revision))
        return self.receipt(draft.delivery_key)

    def claim(self, key):
        with self.store.transaction() as db:
            return db.execute("UPDATE deliveries SET state='sending' WHERE key=? AND state='queued'", (key,)).rowcount == 1

    def state(self, key, state, detail=''):
        with self.store.transaction() as db:
            db.execute('UPDATE deliveries SET state=?,detail=? WHERE key=? AND state != ?', (state, detail, key, 'sent'))
        return self.receipt(key)

    def acknowledge(self, receipt, exact_text):
        if receipt.state != 'sent' or not receipt.message_id or not receipt.sent_at:
            raise ValueError('A confirmed receipt is required')
        with self.store.transaction() as db:
            row = db.execute('SELECT * FROM deliveries WHERE key=?', (receipt.delivery_key,)).fetchone()
            if not row or row['state'] not in ('sending', 'uncertain', 'sent'):
                raise ValueError('No send is awaiting acknowledgement')
            if row['state'] == 'sent' and row['message_id'] != receipt.message_id:
                raise ValueError('Conflicting message identity')
            db.execute("UPDATE deliveries SET state='sent',message_id=?,sent_at=?,exact_text=? WHERE key=?",
                       (receipt.message_id, receipt.sent_at, exact_text, receipt.delivery_key))

    def recover(self):
        with self.store.transaction() as db:
            db.execute("UPDATE deliveries SET state='uncertain',detail='Gateway restarted during send' WHERE state='sending'")
