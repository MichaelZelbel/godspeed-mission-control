"""Run in the tested Hermes environment. The real adapter uses a fake HTTP transport."""
import asyncio
import importlib.util
import json
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
                    result={'message_id':payload.get('message_id',len(self.calls)),'date':1789710000,
                            'chat':{'id':100,'type':'private'},'text':payload.get('text','')}
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
