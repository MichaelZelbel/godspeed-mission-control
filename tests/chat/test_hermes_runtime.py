"""Run in the tested Hermes environment. The real adapter uses a fake HTTP transport."""
import asyncio
import importlib.util
import json
import re
import tempfile
from types import SimpleNamespace as NS
import unittest
from unittest.mock import AsyncMock
from helpers import load_chat

HERMES = importlib.util.find_spec('gateway') is not None and importlib.util.find_spec('telegram') is not None


@unittest.skipUnless(HERMES,'Requires the tested Hermes environment')
class HermesRuntime(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        Chat=load_chat(self)
        from hub_chat.runtime import Boundary
        from hub_chat.telegram_request import GuardedRequest
        from telegram import Bot
        from telegram.request import BaseRequest
        from plugins.platforms.telegram.adapter import TelegramAdapter
        from gateway.config import PlatformConfig
        class Transport(BaseRequest):
            read_timeout=5
            def __init__(self): self.calls=[]
            async def initialize(self): pass
            async def shutdown(self): pass
            async def do_request(self,url,method,request_data=None,**kwargs):
                operation=url.rsplit('/',1)[-1]
                payload=request_data.parameters if request_data else {}
                if operation=='getMe': result={'id':123,'is_bot':True,'first_name':'Example','username':'example_bot'}
                elif operation=='answerCallbackQuery': result=True
                else:
                    self.calls.append((operation,payload))
                    visible=payload.get('text','')
                    if payload.get('parse_mode')=='MarkdownV2':
                        visible=re.sub(r'\\([_*\[\]()~`>#+=|{}.!-])',r'\1',visible)
                    result={'message_id':payload.get('message_id',len(self.calls)),'date':1789710000,
                            'chat':{'id':100,'type':'private'},'text':visible}
                return 200,json.dumps({'ok':True,'result':result}).encode()
        self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.chat=Chat(self.tmp.name,'100'); self.addCleanup(self.chat.close)
        self.boundary=Boundary(self.chat,'200')
        self.transport=Transport()
        self.bot=Bot('123:fixture',request=GuardedRequest(self.transport,self.boundary))
        await self.bot.initialize(); self.addAsyncCleanup(self.bot.shutdown)
        self.adapter=TelegramAdapter(PlatformConfig(enabled=True,token='123:fixture'))
        self.adapter._bot=self.bot; self.adapter._hub_chat_boundary=self.boundary
        self.boundary.adapter=self.adapter
        self.event=NS(source=NS(chat_id='100',user_id='200'),message_id='7',reply_to_message_id=None,text='Check it')
        self.boundary.bind(self.event,True)

    async def test_actual_adapter_refuses_internal_and_delivers_final(self):
        with self.boundary.turn(self.event):
            result=await self.adapter.send('100','internal progress')
            self.assertFalse(result.success)
            result=await self.adapter.send('100','Here is the requested answer.',metadata={'notify':True})
            self.assertTrue(result.success)
        self.assertEqual(len(self.transport.calls),1)
        rows=self.chat.store.rows("SELECT * FROM deliveries WHERE state='sent'")
        self.assertEqual(len(rows),1)
        self.assertEqual(rows[0]['message_id'],result.message_id)

    async def test_native_sdk_send_and_edit_cannot_bypass_adapter(self):
        from telegram.error import Forbidden
        for call in (lambda:self.bot.send_message(100,'restart notice'),lambda:self.bot.edit_message_text('review',chat_id=100,message_id=1)):
            with self.assertRaises(Forbidden): await call()
        self.assertEqual(self.transport.calls,[])

    async def test_turn_error_does_not_expose_internal_details(self):
        with self.boundary.turn(self.event):
            await self.adapter._notify_turn_error(self.event,RuntimeError('internal worker path and execution trace'))
        self.assertEqual(len(self.transport.calls),1)
        self.assertEqual(self.chat.store.rows("SELECT exact_text FROM deliveries WHERE state='sent'")[0]['exact_text'],
                         'I could not finish this request. Please try again.')

    async def test_incident_replay_through_actual_adapter_after_restart(self):
        from pathlib import Path
        from helpers import fixture
        from hub_chat.contracts import utcnow
        from hub_chat.inbox import deliver
        from hub_chat.app import Chat
        from hub_chat.runtime import Boundary
        from hub_chat.telegram_request import GuardedRequest
        from telegram import Bot
        data=fixture('september-18.json')
        self.boundary.config={'proactive_paused':False}
        def source(ids,now):
            return [dict(row,source='fixture',checked_at=now) for row in data['items'] if row['item_id'] in ids]
        self.chat.sources.register('fixture',source)
        facts=self.chat.sources.refresh([x['item_id'] for x in data['items']],utcnow())
        draft=self.chat.compose(facts,utcnow())
        self.chat.delivery.submit(draft)
        receipt=await deliver(self.boundary,draft.delivery_key)
        self.assertEqual(receipt.state,'sent')
        self.assertEqual(len(self.transport.calls),1)
        self.assertNotIn('five decisions',self.transport.calls[0][1]['text'].lower())
        # Reopen the on-disk state and change the primary fact before the reply.
        for row in data['items']:
            if row['item_id']=='name-choice': row.update(status='done',revision='finished')
        reopened=Chat(self.tmp.name,'100'); self.addCleanup(reopened.close)
        reopened.sources.register('fixture',source)
        context=reopened.context.resolve('100',receipt.message_id,'Are these still open?',utcnow())
        self.assertEqual({f.item_id:f.status for f in context.facts},{'name-choice':'done','report':'open'})
        self.assertEqual(context.messages[0].text,self.transport.calls[0][1]['text'])
        with self.boundary.turn(self.event):
            await self.adapter.send('100','Internal review results')
            final=await self.adapter.send('100','The name has been chosen. The report is still available to read; it needs no decision.',metadata={'notify':True})
        self.assertTrue(final.success)
        self.assertEqual(len(self.transport.calls),2)

    async def test_button_resolves_its_request_and_expiry_edits_original(self):
        from tools import approval
        from tools.approval_gateway_wait import _ApprovalEntry
        from hub_chat.hermes_bridge import approval_callback
        first=_ApprovalEntry({'request_id':'a'*32,'command':'echo first'})
        second=_ApprovalEntry({'request_id':'b'*32,'command':'echo second'})
        with approval._lock: approval._gateway_queues['fixture-session']=[first,second]
        self.addCleanup(approval._gateway_queues.pop,'fixture-session',None)
        with self.boundary.turn(self.event):
            result=await self.adapter.send_exec_approval('100','echo second','fixture-session',description='Check the example file',metadata={'_hub_chat_request_id':'b'*32})
        self.assertTrue(result.success)
        query=NS(from_user=NS(id=200),message=NS(message_id=int(result.message_id)),answer=AsyncMock())
        self.adapter._callback_authorized=AsyncMock(return_value=True)
        await approval_callback(self.adapter,query,'ea:once:'+'b'*32,{'chat_id':100})
        self.assertFalse(first.event.is_set())
        self.assertTrue(second.event.is_set())
        self.assertEqual(self.chat.approvals.get('b'*32)['state'],'approved')
        self.assertEqual(len(self.transport.calls),2)
        self.assertIn('not been confirmed',self.transport.calls[-1][1]['text'])
        # The same click cannot release the remaining request.
        await approval_callback(self.adapter,query,'ea:once:'+'b'*32,{'chat_id':100})
        self.assertFalse(first.event.is_set())

    async def test_expired_guard_cannot_wake_executor(self):
        from tools import approval
        from tools.approval_gateway_wait import _ApprovalEntry
        entry=_ApprovalEntry({'request_id':'c'*32,'command':'echo example'})
        with approval._lock: approval._gateway_queues['expiry-session']=[entry]
        self.addCleanup(approval._gateway_queues.pop,'expiry-session',None)
        with self.boundary.turn(self.event):
            await self.adapter.send_exec_approval('100','echo example','expiry-session',description='Check the example',metadata={'_hub_chat_request_id':'c'*32})
        with self.chat.store.transaction() as db: db.execute("UPDATE approvals SET expires_at='2020-01-01T00:00:00Z' WHERE id=?",('c'*32,))
        self.assertEqual(approval.resolve_gateway_approval('expiry-session','once',request_id='c'*32),0)
        self.assertFalse(entry.event.is_set())
        self.assertEqual(self.chat.approvals.get('c'*32)['state'],'expired')
        entry.settle('timeout')
        await asyncio.sleep(.03)
        self.assertIn('expired',self.transport.calls[-1][1]['text'])
