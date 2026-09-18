import unittest
from helpers import load_chat


class Evidence(unittest.TestCase):
    def setUp(self):
        load_chat(self)
        from hub_chat.evidence import validate_answer
        self.validate=validate_answer

    def test_failed_check_cannot_be_called_passed(self):
        evidence={'test':{'status':'failed'}}
        self.assertNotIn('passed',self.validate('All tests passed.',evidence))
        self.assertNotIn('passed',self.validate('{"answer":"","claims":[{"text":"Tests passed.","evidence_ids":["test"]}]}',evidence))

    def test_wrong_operation_cannot_supply_evidence(self):
        self.assertNotIn('passed',self.validate('{"answer":"","claims":[{"text":"Tests passed.","evidence_ids":["test"]}]}',{'read':{'status':'succeeded'}}))

    def test_supported_claim_has_no_internal_ids(self):
        self.assertEqual(self.validate('{"answer":"","claims":[{"text":"Tests passed.","evidence_ids":["test"]}]}',{'test':{'status':'succeeded'}}),'Tests passed.')

    def test_normal_question_keeps_its_answer(self):
        self.assertEqual(self.validate('The update is already complete. There is no decision to make.',{}),'The update is already complete. There is no decision to make.')

    def test_denial_overrides_a_success_exit_code(self):
        import tempfile
        from hub_chat.app import Chat
        from hub_chat.evidence import collect
        with tempfile.TemporaryDirectory() as state:
            chat=Chat(state,'100')
            try:
                messages=[{'role':'assistant','tool_calls':[{'id':'one','function':{'name':'terminal','arguments':'{}'}}]},
                          {'role':'tool','tool_call_id':'one','content':'{"exit_code":0,"denied":true}'}]
                self.assertEqual(collect(chat.store,'100',messages)['one']['status'],'failed')
            finally: chat.close()
