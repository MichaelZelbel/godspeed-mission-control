import hashlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from helpers import load_chat


class Rollback(unittest.TestCase):
    def test_previous_protected_configuration_and_runtime_are_restored(self):
        load_chat(self)
        from hub_chat.rollback import rollback
        with tempfile.TemporaryDirectory() as directory:
            home=Path(directory); profile=home/'profile'; profile.mkdir()
            root=home/'.hub/chat'; (root/'releases').mkdir(parents=True)
            previous=root/'releases/previous'; previous.mkdir()
            (previous/'code.py').write_text('previous version')
            files={'code.py':hashlib.sha256((previous/'code.py').read_bytes()).hexdigest()}
            package_id=hashlib.sha256(json.dumps(files,separators=(',',':')).encode()).hexdigest()
            (previous/'bundle.json').write_text(json.dumps({'id':package_id,'files':files}))
            current_package=root/'releases/current'
            (root/'current.json').write_text(json.dumps({'path':str(current_package),'previous':str(previous)}))
            old={'enabled':True,'package':str(previous),'runtime':'old-runtime','recovery':str(profile/'chat-recovery/old'),
                 'conversation_id':'100','actor_id':'100','timezone':'Europe/Berlin','sources':[]}
            current=dict(old,package=str(current_package),runtime='new-runtime',recovery='new-recovery')
            (profile/'hub-chat.json').write_text(json.dumps(current))
            pth=home/'hub_chat.pth'; pth.write_text('current version')
            (profile/'chat-rollback.json').write_text(json.dumps({'pth':str(pth),'previous_config':old}))
            journal=profile/'chat-state'; journal.mkdir()
            (journal/'communication.sqlite3').write_bytes(b'journal preserved exactly')
            with patch('hub_chat.recovery.verify',return_value={'bundle':str(previous)}):
                result=rollback(profile,home)
            restored=json.loads((profile/'hub-chat.json').read_text())
            self.assertTrue(result['restored'])
            self.assertEqual(restored['runtime'],'old-runtime')
            self.assertEqual(restored['recovery'],old['recovery'])
            self.assertTrue(restored['proactive_paused'])
            self.assertEqual((journal/'communication.sqlite3').read_bytes(),b'journal preserved exactly')
            self.assertIn(str(previous/'tools'),pth.read_text())

    def test_damaged_recovery_pauses_without_switching_package(self):
        load_chat(self)
        from hub_chat.rollback import rollback
        with tempfile.TemporaryDirectory() as directory:
            home=Path(directory); profile=home/'profile'; profile.mkdir()
            root=home/'.hub/chat'; (root/'releases/old').mkdir(parents=True)
            previous=root/'releases/old'
            pointer=root/'current.json'
            pointer.write_text(json.dumps({'path':'current','previous':str(previous)}))
            old={'enabled':True,'package':str(previous),'runtime':'old',
                 'recovery':str(profile/'chat-recovery/old')}
            (profile/'hub-chat.json').write_text(json.dumps(dict(old,package='current',proactive_paused=False)))
            (profile/'chat-rollback.json').write_text(json.dumps({'previous_config':old}))
            before=pointer.read_bytes()
            with patch('hub_chat.bundle.verify',return_value='old'), patch('hub_chat.recovery.verify',side_effect=ValueError('Changed dependency')):
                with self.assertRaisesRegex(ValueError,'Changed dependency'): rollback(profile,home)
            self.assertEqual(pointer.read_bytes(),before)
            config=json.loads((profile/'hub-chat.json').read_text())
            self.assertTrue(config['proactive_paused'])
            self.assertEqual(config['package'],'current')
