import hashlib
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from helpers import load_chat


class RuntimeUpgrade(unittest.TestCase):
    def setUp(self):
        load_chat(self)
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.root = self.base/'runtime'
        self.root.mkdir()
        self.git('init', '-q')
        self.git('config', 'core.autocrlf', 'false')
        self.git('config', 'user.email', 'reader@example.org')
        self.git('config', 'user.name', 'Example Reader')
        (self.root/'gateway.py').write_bytes(b'original\n')
        (self.root/'sender.py').write_bytes(b'original\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'fixture')
        self.head = self.git('rev-parse', 'HEAD').strip()
        self.first = self.make_bundle('first')
        self.second = self.make_bundle('second')

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.root), *args], text=True)

    def make_bundle(self, name):
        bundle = self.base/name
        integration = bundle/'integrations/hermes'
        (integration/'patches').mkdir(parents=True)
        changed = (name+'\n').encode()
        (self.root/'gateway.py').write_bytes(changed)
        (self.root/'sender.py').write_bytes(changed)
        patch = subprocess.check_output(['git', '-C', str(self.root), 'diff', '--binary'])
        (integration/'patches/change.patch').write_bytes(patch)
        manifest = {'hermes_commit': self.head, 'patch': 'change.patch', 'files': {
            'gateway.py': {'original': hashlib.sha256(b'original\n').hexdigest(),
                           'patched': hashlib.sha256(changed).hexdigest()}}}
        manifest['files']['sender.py'] = dict(manifest['files']['gateway.py'])
        (integration/'compatibility.json').write_text(json.dumps(manifest))
        (self.root/'gateway.py').write_bytes(b'original\n')
        (self.root/'sender.py').write_bytes(b'original\n')
        return bundle

    def test_verified_prior_patch_upgrades_and_repeat_is_noop(self):
        from hub_chat.compatibility import install_patch
        from unittest.mock import patch
        install_patch(self.root, self.first/'integrations/hermes')
        (self.root/'personal.txt').write_text('keep this local file')
        with patch('hub_chat.bundle.verify', return_value='verified') as verify:
            self.assertEqual(install_patch(self.root, self.second/'integrations/hermes', previous=self.first), 'upgraded')
            verify.assert_called_once_with(self.first, check_import=False)
        self.assertEqual((self.root/'gateway.py').read_bytes(), b'second\n')
        self.assertEqual((self.root/'personal.txt').read_text(), 'keep this local file')
        self.assertEqual(install_patch(self.root, self.second/'integrations/hermes'), 'already installed')

    def test_local_runtime_change_is_preserved_and_refused(self):
        from hub_chat.compatibility import install_patch
        from unittest.mock import patch
        install_patch(self.root, self.first/'integrations/hermes')
        (self.root/'gateway.py').write_bytes(b'my local change\n')
        with patch('hub_chat.bundle.verify', return_value='verified'):
            with self.assertRaises(ValueError):
                install_patch(self.root, self.second/'integrations/hermes', previous=self.first)
        self.assertEqual((self.root/'gateway.py').read_bytes(), b'my local change\n')

    def test_corrupt_previous_package_cannot_authorize_replacement(self):
        from hub_chat.compatibility import install_patch
        from unittest.mock import patch
        install_patch(self.root, self.first/'integrations/hermes')
        with patch('hub_chat.bundle.verify', side_effect=ValueError('Package changed')):
            with self.assertRaises(ValueError):
                install_patch(self.root, self.second/'integrations/hermes', previous=self.first)
        self.assertEqual((self.root/'gateway.py').read_bytes(), b'first\n')

    def test_interrupted_replacement_restores_previous_bytes(self):
        from hub_chat.compatibility import install_patch, replace_file
        from unittest.mock import patch
        install_patch(self.root, self.first/'integrations/hermes')
        def fail_second(path, data):
            if path.name == 'sender.py': raise OSError('Disk full')
            return replace_file(path, data)
        with patch('hub_chat.bundle.verify', return_value='verified'), patch('hub_chat.compatibility.replace_file', side_effect=fail_second):
            with self.assertRaises(OSError):
                install_patch(self.root, self.second/'integrations/hermes', previous=self.first)
        self.assertEqual((self.root/'gateway.py').read_bytes(), b'first\n')
        self.assertEqual((self.root/'sender.py').read_bytes(), b'first\n')
