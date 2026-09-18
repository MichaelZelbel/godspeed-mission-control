from .store import Store
from .sources import Sources
from .delivery import Delivery
from .context import Context
from .approvals import Approvals
from .contracts import Receipt
from . import policy


class Chat:
    def __init__(self, state_dir, conversation_id, timezone='UTC', language='en'):
        self.store = Store(state_dir)
        self.conversation_id, self.timezone, self.language = str(conversation_id), timezone, language
        self.sources = Sources(self.store)
        self.delivery = Delivery(self.store)
        self.context = Context(self.store,self.sources)
        self.approvals = Approvals(self.store)

    def compose(self, facts, now, purpose='digest'):
        return policy.compose(facts,self.conversation_id,now,self.timezone,self.language,purpose)

    def dispatch(self, key, send, now):
        if not self.delivery.claim(key):
            return self.delivery.receipt(key)
        draft = self.delivery.draft(key)
        facts = self.sources.refresh([i for i,_ in draft.item_revisions],now)
        errors = policy.check(draft,facts, self.store.rows('SELECT * FROM evidence WHERE conversation=?',(draft.conversation_id,)))
        if errors:
            return self.delivery.state(key,'suppressed','; '.join(errors))
        try:
            message_id = send(draft.conversation_id,draft.text)
            if not message_id:
                return self.delivery.state(key,'uncertain','No delivery identity returned')
            self.delivery.acknowledge(Receipt(key,'sent',str(message_id),now),draft.text)
        except Exception as exc:
            return self.delivery.state(key,'uncertain',type(exc).__name__)
        return self.delivery.receipt(key)

    def close(self):
        self.store.close()
