import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from helpers import load_chat


class Scheduled(unittest.TestCase):
    def test_known_brief_is_registered_without_editing_a_schedule(self):
        load_chat(self)
        from hub_chat.scheduled import register_reports
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); profile=root/'profile'; hub=root/'hub'
            (profile/'cron').mkdir(parents=True); hub.mkdir()
            jobs=profile/'cron/jobs.json'
            jobs.write_text(json.dumps({'jobs':[{'id':'brief1','name':'morning-brief','workdir':str(hub),'schedule':{'expr':'0 7 * * *'}},
                                                {'id':'internal','name':'maintenance','workdir':str(hub)}]}))
            before=jobs.read_bytes(); config={}
            register_reports(config,profile,hub,root/'package')
            self.assertEqual(set(config['scheduled_reports']),{'brief1'})
            self.assertEqual(jobs.read_bytes(),before)
            self.assertEqual(config['scheduled_reports']['brief1']['workdir'],str(hub.resolve()))

    def test_scheduled_output_cannot_escape_through_a_standalone_send(self):
        load_chat(self)
        from hub_chat.scheduled import filter_targets, protected
        with tempfile.TemporaryDirectory() as directory:
            profile=Path(directory)
            (profile/'hub-chat.json').write_text(json.dumps({'enabled':True,'conversation_id':'100','scheduled_reports':{}}))
            targets=[{'platform':'telegram','chat_id':'100'},{'platform':'slack','chat_id':'example'}]
            remaining,errors=filter_targets(profile,{'id':'internal'},targets,False)
            self.assertEqual(remaining,[targets[1]])
            self.assertEqual(len(errors),1)
            self.assertTrue(protected(profile))
            self.assertFalse((profile/'chat-inbox').exists())

    def test_brief_file_must_be_current_readable_and_bounded(self):
        load_chat(self)
        from hub_chat.reader_brief import read
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); (root/'brief').mkdir()
            file=root/'brief/2026-09-18.md'; file.write_text('Your draft is ready to review. https://example.org/draft')
            import os
            from datetime import datetime,timezone
            now=datetime(2026,9,18,10,tzinfo=timezone.utc)
            os.utime(file,(now.timestamp(),now.timestamp()))
            result=read(root,'UTC',now)
            self.assertEqual(result['messages'],[file.read_text()])
            file.write_text('Open /home/example/hub/private.md')
            os.utime(file,(now.timestamp(),now.timestamp()))
            with self.assertRaises(ValueError): read(root,'UTC',now)
            file.write_text('x'*4000); os.utime(file,(now.timestamp(),now.timestamp()))
            with self.assertRaises(ValueError): read(root,'UTC',now)
