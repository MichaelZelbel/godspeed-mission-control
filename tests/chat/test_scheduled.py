import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from helpers import load_chat


class Scheduled(unittest.TestCase):
    def test_existing_custom_telegram_report_requires_migration_before_enable(self):
        load_chat(self)
        from hub_chat.scheduled import register_reports
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); (root/'cron').mkdir()
            jobs=root/'cron/jobs.json'
            jobs.write_text(json.dumps({'jobs':[{'id':'custom','name':'Requested weekly report','deliver':'telegram','workdir':directory}]}))
            before=jobs.read_bytes()
            with self.assertRaisesRegex(ValueError,'Requested weekly report'):
                register_reports({},root,root,root)
            self.assertEqual(jobs.read_bytes(),before)
            config={'scheduled_reports':{'custom':{'name':'weekly','workdir':directory}},'reports':{'weekly':{'argv':['trusted-source']}}}
            register_reports(config,root,root,root)

    def test_failed_requested_report_has_one_clear_current_failure_fact(self):
        load_chat(self)
        from hub_chat.scheduled import failure_facts
        from datetime import datetime,timezone
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); (root/'cron').mkdir()
            (root/'hub-chat.json').write_text(json.dumps({'language':'en','scheduled_reports':{'brief1':{'name':'morning-brief'}}}))
            job={'id':'brief1','last_status':'error','last_run_at':'2026-09-18T10:00:00Z','last_error':'private internal traceback'}
            file=root/'cron/jobs.json'; file.write_text(json.dumps({'jobs':[job]}))
            now=datetime(2026,9,18,10,1,tzinfo=timezone.utc)
            first=failure_facts(root,now)
            self.assertEqual(len(first),1)
            self.assertNotIn('traceback',json.dumps(first))
            self.assertEqual(first[0]['status'],'open')
            job['last_run_at']='2026-09-18T10:00:30Z'; file.write_text(json.dumps({'jobs':[job]}))
            self.assertEqual(failure_facts(root,now)[0]['revision'],first[0]['revision'])
            job['last_status']='ok'; file.write_text(json.dumps({'jobs':[job]}))
            self.assertEqual(failure_facts(root,now)[0]['status'],'done')

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

    def test_fresh_brief_cannot_repeat_invented_decisions_or_completed_work(self):
        load_chat(self)
        from hub_chat.reader_brief import read
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); (root/'brief').mkdir(); (root/'rules').mkdir(); (root/'work').mkdir()
            file=root/'brief/2026-09-18.md'; file.write_text('You have five decisions. The finished draft still needs approval.')
            card=root/'work/example.md'
            card.write_text('ID: example\nSTATUS: blocked\nWHAT: Choose the cover\nDONE WHEN: Choose the blue or green cover.\nOWNER: person\nNEEDS: person\nLINK: https://example.org/cover\n\n## Log\n')
            import os
            from datetime import datetime,timezone
            now=datetime(2026,9,18,10,tzinfo=timezone.utc)
            os.utime(file,(now.timestamp(),now.timestamp()))
            result=read(root,'UTC',now)
            self.assertNotIn('five decisions',result['messages'][0])
            self.assertIn('Choose the cover',result['messages'][0])
            self.assertIn('https://example.org/cover',result['messages'][0])
            self.assertEqual(result['item_ids'],['work:example'])
            card.write_text(card.read_text().replace('STATUS: blocked','STATUS: verified'))
            current=read(root,'UTC',now)
            self.assertNotEqual(current['revision'],result['revision'])
            self.assertEqual(current['item_ids'],[])
            self.assertNotIn('Choose the cover',current['messages'][0])
            self.assertIn('saved task records',current['messages'][0])
            os.utime(file,(now.timestamp()-4*3600,now.timestamp()-4*3600))
            with self.assertRaises(ValueError): read(root,'UTC',now)

    def test_brief_file_must_be_readable_bounded_and_inside_a_recognized_hub(self):
        load_chat(self)
        from hub_chat.reader_brief import read
        import os
        from datetime import datetime,timezone
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); (root/'brief').mkdir()
            now=datetime(2026,9,18,10,tzinfo=timezone.utc)
            file=root/'brief/2026-09-18.md'; file.write_text('Your draft is ready to review.')
            os.utime(file,(now.timestamp(),now.timestamp()))
            with self.assertRaisesRegex(ValueError,'recognized'): read(root,'UTC',now)
            (root/'rules').mkdir()
            self.assertIn('saved task records',read(root,'UTC',now)['messages'][0])
            self.assertIn('gespeicherten Aufgaben',read(root,'UTC',now,language='de')['messages'][0])
            file.write_text('Open /home/example/hub/private.md')
            os.utime(file,(now.timestamp(),now.timestamp()))
            with self.assertRaises(ValueError): read(root,'UTC',now)
            file.write_text('x'*4000); os.utime(file,(now.timestamp(),now.timestamp()))
            with self.assertRaises(ValueError): read(root,'UTC',now)

    def test_brief_never_claims_no_tasks_when_a_source_failed(self):
        load_chat(self)
        from hub_chat.reader_brief import read
        from datetime import datetime,timezone
        import os,subprocess
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); (root/'brief').mkdir(); (root/'rules').mkdir()
            now=datetime(2026,9,18,10,tzinfo=timezone.utc)
            file=root/'brief/2026-09-18.md'; file.write_text('Everything is done.')
            os.utime(file,(now.timestamp(),now.timestamp()))
            real=subprocess.run
            def only_the_task_records_fail(argv,**options):
                if 'export' in argv: raise subprocess.CalledProcessError(1,'source')
                return real(argv,**options)
            with patch('hub_chat.reader_brief.subprocess.run',side_effect=only_the_task_records_fail):
                with self.assertRaises(subprocess.CalledProcessError): read(root,'UTC',now)
