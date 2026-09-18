"""Trusted gateway scopes. Caller-provided metadata never creates authority.

This is an output policy, not a sandbox for a process that can read bot credentials.
The native adapter binds authenticated inbound events; only patched final-delivery
and prompt paths open an output scope. Child tasks lose authority when a turn ends.
"""
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
import uuid
from .contracts import utcnow


@dataclass
class Turn:
    conversation: str
    actor: str
    message_id: str
    live: bool = True


class Boundary:
    def __init__(self, chat, actor):
        self.chat, self.actor = chat, str(actor)
        self._identity = object()
        self._turn = ContextVar('hub_chat_turn', default=None)
        self._output = ContextVar('hub_chat_output', default=None)
        self.active = {}

    def bind(self, event, authenticated):
        if not authenticated or str(event.source.chat_id) != self.chat.conversation_id or str(event.source.user_id) != self.actor:
            return False
        event._hub_chat_origin = self._identity
        with self.chat.store.transaction() as db:
            db.execute('INSERT OR IGNORE INTO inbound VALUES(?,?,?,?)',
                       (self.chat.conversation_id,str(event.message_id),self.actor,utcnow()))
        return True

    def native(self, event):
        return getattr(event,'_hub_chat_origin',None) is self._identity

    def reconcile_reply(self,message,bot_id):
        """A native Telegram reply can prove one otherwise uncertain plain-text send."""
        if not message or str(getattr(getattr(message,'from_user',None),'id',''))!=str(bot_id): return False
        if str(getattr(getattr(message,'chat',None),'id',''))!=self.chat.conversation_id: return False
        text=getattr(message,'text',None)
        if not text: return False
        rows=self.chat.store.rows("SELECT key FROM deliveries WHERE conversation=? AND state='uncertain'",(self.chat.conversation_id,))
        from datetime import timedelta
        from .contracts import timestamp
        matches=[r['key'] for r in rows if self.chat.delivery.draft(r['key']).text==text and
                 message.date>=timestamp(self.chat.delivery.get(r['key'])['created_at'])-timedelta(seconds=5)]
        if len(matches)!=1: return False
        from .contracts import Receipt
        key=matches[0]
        self.chat.delivery.acknowledge(Receipt(key,'sent',str(message.message_id),message.date.isoformat()),text)
        self.chat.store.audit('delivery_reconciled','Authenticated reply identified an uncertain message')
        return True

    @contextmanager
    def turn(self, event):
        turn = Turn(self.chat.conversation_id,self.actor,str(event.message_id)) if self.native(event) else None
        token = self._turn.set(turn)
        if turn:
            self.active[turn.message_id] = turn
        try:
            yield turn
        finally:
            if turn:
                turn.live = False
                self.active.pop(turn.message_id,None)
            self._turn.reset(token)

    @contextmanager
    def output(self, kind, key=None, message_id=None):
        token = self._output.set((kind,key,str(message_id) if message_id is not None else None))
        try:
            yield
        finally:
            self._output.reset(token)

    @contextmanager
    def inherit_turn(self,turn):
        if not turn or not turn.live or self.active.get(turn.message_id) is not turn:
            turn=None
        token=self._turn.set(turn)
        try: yield
        finally: self._turn.reset(token)

    def allowed(self, method, payload):
        method = method.lower()
        visible = method.startswith(('send','editmessage','copymessage','forwardmessage'))
        if method in ('sendchataction','setmessagereaction'):
            return False
        if not visible:
            return True
        if str(payload.get('chat_id','')) != self.chat.conversation_id:
            return False
        output = self._output.get()
        if not output:
            return False
        kind,key,message_id = output
        if method.startswith('edit') and message_id != str(payload.get('message_id','')):
            return False
        turn = self._turn.get()
        if kind in ('reply','question','requested_result'):
            return bool(turn and turn.live and turn.conversation == self.chat.conversation_id)
        if kind in ('digest','critical_failure') and key:
            try:
                row = self.chat.delivery.get(key)
                return row['state'] == 'sending' and row['conversation'] == self.chat.conversation_id
            except KeyError:
                return False
        if kind in ('approval','approval_result') and key:
            row = self.chat.approvals.get(key)
            return bool(row and row['conversation'] == self.chat.conversation_id and
                        (kind == 'approval_result' or row['state'] == 'pending'))
        return False

    def record_part(self, method, payload, response):
        """Called after the actual API receipt, including sends outside adapter.send."""
        results = response if isinstance(response,list) else [response]
        output = self._output.get()
        if not output or not method.lower().startswith(('send','copy','forward')):
            return
        kind,key,_ = output
        from .contracts import Draft, Receipt
        for result in results:
            if not isinstance(result,dict) or not result.get('message_id'):
                continue
            mid = str(result['message_id'])
            text = result.get('text') or result.get('caption') or payload.get('text') or payload.get('caption') or '[Attachment]'
            part_key = 'telegram:' + self.chat.conversation_id + ':' + mid
            draft = Draft(part_key,self.chat.conversation_id,kind,text)
            self.chat.delivery.submit(draft)
            self.chat.delivery.claim(part_key)
            self.chat.delivery.acknowledge(Receipt(part_key,'sent',mid,utcnow()),text)
            if key and kind in ('digest','critical_failure'):
                with self.chat.store.transaction() as db:
                    db.execute('INSERT OR IGNORE INTO message_parts VALUES(?,?,?,?)',(key,self.chat.conversation_id,mid,text))
