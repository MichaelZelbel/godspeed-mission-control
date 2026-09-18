import asyncio
import tempfile
import unittest
from types import SimpleNamespace as NS
from helpers import load_chat


class Boundary(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        Chat = load_chat(self)
        from hub_chat.runtime import Boundary
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.chat = Chat(self.tmp.name, '100')
        self.addCleanup(self.chat.close)
        self.boundary = Boundary(self.chat, actor='200')
        self.event = NS(source=NS(chat_id='100',user_id='200'),message_id='7',reply_to_message_id=None,text='Check it')

    async def test_metadata_cannot_create_a_direct_reply(self):
        self.assertFalse(self.boundary.allowed('sendMessage', {'chat_id':'100','text':'review','output_class':'reply'}))

    async def test_only_native_owner_event_can_be_bound(self):
        self.assertFalse(self.boundary.bind(self.event, authenticated=False))
        self.event.source.user_id = 'other'
        self.assertFalse(self.boundary.bind(self.event, authenticated=True))

    async def test_internal_send_inside_user_turn_still_refused(self):
        self.boundary.bind(self.event, authenticated=True)
        with self.boundary.turn(self.event):
            self.assertFalse(self.boundary.allowed('sendMessage',{'chat_id':'100'}))
            with self.boundary.output('reply'):
                self.assertTrue(self.boundary.allowed('sendMessage',{'chat_id':'100'}))
                self.assertFalse(self.boundary.allowed('sendMessage',{'chat_id':'101'}))
            self.assertFalse(self.boundary.allowed('sendMessage',{'chat_id':'100'}))

    async def test_streaming_media_and_edit_use_same_boundary(self):
        for method in ('sendMessage','sendMessageDraft','sendPhoto','sendVoice','sendDocument','sendMediaGroup','editMessageText','editMessageCaption','copyMessage','forwardMessage'):
            self.assertFalse(self.boundary.allowed(method,{'chat_id':'100'}),method)
        self.assertTrue(self.boundary.allowed('getUpdates',{}))

    async def test_finished_turn_cannot_send_from_inherited_background_context(self):
        self.boundary.bind(self.event, authenticated=True)
        ready = asyncio.Event()
        async def later():
            await ready.wait()
            with self.boundary.output('reply'):
                return self.boundary.allowed('sendMessage', {'chat_id':'100'})
        with self.boundary.turn(self.event):
            task = asyncio.create_task(later())
        ready.set()
        self.assertFalse(await task)
