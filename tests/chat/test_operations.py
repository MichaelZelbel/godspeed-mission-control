import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from helpers import load_chat


class Operations(unittest.TestCase):
    def test_migration_preview_changes_nothing(self):
        Chat=load_chat(self)
        from hub_chat.migrate import import_legacy
        temporary=tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        directory=temporary.name
        chat=Chat(directory,'100')
        self.addCleanup(chat.close)
        source=Path(directory)/'legacy.json'
        source.write_text(json.dumps([{'item_id':'example','source':'fixture','revision':'1','status':'done',
                                      'kind':'task','subject':'Example','checked_at':'2026-09-18T10:00:00Z'}]))
        report=import_legacy(chat,source,dry_run=True)
        self.assertEqual(report['would_import'],1)
        self.assertIsNone(chat.store.item('example'))
        self.assertEqual(chat.store.rows('SELECT * FROM audit'),[])
        self.assertEqual(import_legacy(chat,source)['imported'],1)
        self.assertTrue(import_legacy(chat,source)['already_imported'])

    def test_doctor_distinguishes_installed_from_active_configuration(self):
        load_chat(self)
        from hub_chat.doctor import inspect
        from hub_chat.contracts import fingerprint,utcnow
        with tempfile.TemporaryDirectory() as directory:
            profile=Path(directory)
            config={'enabled':True,'conversation_id':'100','actor_id':'100','runtime':directory,'sources':[]}
            (profile/'hub-chat.json').write_text(json.dumps(config))
            with patch('hub_chat.doctor.inspect_runtime',return_value=[]):
                report=inspect(profile)
                self.assertTrue(report['healthy'])
                self.assertFalse(report['runtime_loaded'])
                marker={'pid':123,'config_hash':fingerprint(config),'heartbeat_at':utcnow(),'package':directory}
                (profile/'chat-runtime.json').write_text(json.dumps(marker))
                self.assertTrue(inspect(profile)['runtime_loaded'])
                config['proactive_paused']=False
                (profile/'hub-chat.json').write_text(json.dumps(config))
                self.assertFalse(inspect(profile)['runtime_loaded'])

    def test_fixture_replay_cannot_use_network_or_existing_state(self):
        load_chat(self)
        from hub_chat.replay import replay
        with patch('socket.socket',side_effect=AssertionError('Network forbidden')):
            result=replay('september-18')
        self.assertTrue(result['passed'])
        self.assertEqual(result['network_messages'],0)
        self.assertEqual(result['approval'],'expired')
