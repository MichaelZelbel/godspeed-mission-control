import tempfile
import unittest
from dataclasses import replace
from helpers import load_chat


class Contract(unittest.TestCase):
    def setUp(self):
        Chat=load_chat(self); self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.chat=Chat(self.tmp.name,'100',timezone='Europe/Berlin'); self.addCleanup(self.chat.close)
        from hub_chat.contracts import Fact
        self.fact=Fact('one','fixture','1','open','2026-09-18T22:30:00Z','report','A report to read','No decision is required.','Read the report.','https://example.org/report','2026-09-18')

    def test_local_midnight_does_not_call_yesterday_today(self):
        draft=self.chat.compose([self.fact],'2026-09-18T22:30:00Z')
        self.assertIn('deadline was 2026-09-18',draft.text)
        self.assertIn('https://example.org/report',draft.text)

    def test_german_deadline(self):
        self.chat.language='de'
        draft=self.chat.compose([replace(self.fact,subject='Ein Bericht',consequence='Keine Entscheidung erforderlich.',next_action='Lies den Bericht.')],'2026-09-18T22:30:00Z')
        self.assertIn('Die Frist war',draft.text)

    def test_oversized_card_does_not_take_another_cards_identity(self):
        large=replace(self.fact,item_id='a',subject='x'*4000)
        draft=self.chat.compose([large,self.fact],'2026-09-18T22:30:00Z')
        self.assertEqual(draft.item_revisions,(('one','1'),))

    def test_zero_open_items_means_silence(self):
        self.assertIsNone(self.chat.compose([replace(self.fact,status='done')],'2026-09-18T22:30:00Z'))
