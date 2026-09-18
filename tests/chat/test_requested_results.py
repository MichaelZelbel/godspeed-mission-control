import json
from pathlib import Path
import tempfile
from types import SimpleNamespace as NS
import unittest
from unittest.mock import AsyncMock, patch
from helpers import load_chat


class RequestedResults(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        Chat=load_chat(self)
        from hub_chat.runtime import Boundary
        from hub_chat.contracts import fingerprint,utcnow
        self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.profile=Path(self.tmp.name)
        self.chat=Chat(self.profile/'state','100'); self.addCleanup(self.chat.close)
        self.boundary=Boundary(self.chat,'200'); self.boundary.profile=self.profile
        self.boundary.config={'request_sources':[{'name':'phone','argv':['fixed-reader']}],'proactive_paused':False}
        self.record={'id':'example-call','authorized':True,'subject':'Call about a table','goal':'Reserve a table for two',
                     'requirements':{'party_size':2},'outcome':'needs_review','finished_at':utcnow(),
                     'transcript':[{'role':'user','message':'No, we are fully booked.'}], 'link':'https://example.org/transcript'}
        self.record['revision']=fingerprint(self.record)

    async def test_review_is_required_before_one_durable_result_can_send(self):
        from hub_chat.requested import import_requests,review_one
        from hub_chat.inbox import deliver
        from hub_chat.contracts import fingerprint
        with patch('hub_chat.requested.read_source',return_value=[self.record]):
            import_requests(self.boundary)
            import_requests(self.boundary)
            self.assertEqual(len(self.chat.store.rows('SELECT * FROM requested_results')),1)
            self.assertEqual(self.chat.store.rows('SELECT * FROM deliveries'),[])
            answer={'outcome':'declined','summary':'The restaurant has no table available.',
                    'evidence':[{'turn':0,'quote':'No, we are fully booked.'}]}
            review=AsyncMock(return_value=json.dumps(answer))
            await review_one(self.boundary,review)
            await review_one(self.boundary,review)
            self.assertEqual(review.await_count,1)
            row=self.chat.store.rows('SELECT * FROM deliveries')[0]
            self.assertEqual(row['class'],'requested_result')
            self.assertIn('Declined',json.loads(row['body'])['text'])
            send=AsyncMock(return_value=NS(message_id=55))
            self.boundary.adapter=NS(_bot=NS(send_message=send))
            receipt=await deliver(self.boundary,row['key'])
            self.assertEqual(receipt.state,'sent')
            await deliver(self.boundary,row['key'])
            self.assertEqual(send.await_count,1)

    async def test_unapproved_or_changed_job_cannot_authorize_output(self):
        from hub_chat.requested import import_requests
        self.record['authorized']=False
        with patch('hub_chat.requested.read_source',return_value=[self.record]):
            import_requests(self.boundary)
        self.assertEqual(self.chat.store.rows('SELECT * FROM requested_results'),[])

    async def test_provider_done_and_invented_quote_cannot_confirm_the_goal(self):
        from hub_chat.requested import render_review
        for answer in ({'outcome':'done','summary':'All done','evidence':[]},
                       {'outcome':'confirmed','summary':'A table is reserved.','evidence':[{'turn':0,'quote':'Yes, reserved.'}]},
                       {'outcome':'confirmed','summary':'A table is reserved.','evidence':[]}):
            with self.assertRaises(ValueError): render_review(self.record,json.dumps(answer),'en')

    async def test_internal_review_has_no_user_reply_or_approval_permission(self):
        event=NS(source=NS(chat_id='100',user_id='200'),message_id='native')
        self.boundary.bind(event,True)
        with self.boundary.turn(event),self.boundary.review('phone:example'):
            with self.boundary.output('reply'):
                self.assertFalse(self.boundary.allowed('sendMessage',{'chat_id':'100'}))
            with self.boundary.output('requested_result','fabricated'):
                self.assertFalse(self.boundary.allowed('sendMessage',{'chat_id':'100'}))

    async def test_review_failure_is_clear_without_raw_internal_details(self):
        from hub_chat.requested import import_requests,review_one
        with patch('hub_chat.requested.read_source',return_value=[self.record]):
            import_requests(self.boundary)
            await review_one(self.boundary,AsyncMock(side_effect=RuntimeError('private stack and credentials')))
        text=json.loads(self.chat.store.rows('SELECT body FROM deliveries')[0]['body'])['text']
        self.assertIn('could not confirm',text)
        self.assertNotIn('credentials',text)
        self.assertIn(self.record['link'],text)
