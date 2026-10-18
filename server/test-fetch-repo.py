#!/usr/bin/env python3
"""Cached installer source can cross a repository restart without losing edits."""
import pathlib, subprocess, tempfile, unittest

HERE = pathlib.Path(__file__).resolve().parent
SOURCE = (HERE / 'install.sh').read_text(encoding='utf8')
FUNCTION = SOURCE.split('fetch_repo() {', 1)[1].split('\n}\n', 1)[0]
FUNCTION = 'fetch_repo() {' + FUNCTION + '\n}\n'

def git(folder, *args):
    return subprocess.check_output(['git', '-C', str(folder), *args], text=True, stderr=subprocess.STDOUT).strip()

class FetchRepository(unittest.TestCase):
    def setUp(self):
        self.scratch = tempfile.TemporaryDirectory(prefix='godspeed-repository-restart-')
        self.addCleanup(self.scratch.cleanup)
        self.root = pathlib.Path(self.scratch.name)
        self.old = self.make_repo('old', 'old source\n')
        self.new = self.make_repo('new', 'new source\n')
        self.cache = self.root / 'cache'
        subprocess.check_call(['git', 'clone', '-q', str(self.old), str(self.cache)])
        self.old_head = git(self.cache, 'rev-parse', 'HEAD')
        git(self.cache, 'remote', 'set-url', 'origin', str(self.new))

    def make_repo(self, name, content):
        folder = self.root / name
        folder.mkdir()
        git(folder, 'init', '-q', '-b', 'main')
        (folder / 'source.txt').write_text(content)
        git(folder, 'add', '.')
        git(folder, '-c', 'user.name=Fictional Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', name)
        return folder

    def fetch(self, pin=''):
        program = 'set -e\nwarn() { echo "$*"; }\nok() { echo "$*"; }\ndie() { echo "$*" >&2; exit 1; }\n' + FUNCTION + '\nfetch_repo "$1" "$2" "$3" "test source"\n'
        script = self.root / 'fetch.sh'
        script.write_text(program, encoding='utf8', newline='\n')
        import os
        bash = pathlib.Path(os.environ.get('ProgramFiles', 'C:/Program Files')) / 'Git/bin/bash.exe'
        command = str(bash) if bash.exists() else 'bash'
        return subprocess.run([command, str(script).replace('\\', '/'), str(self.new).replace('\\', '/'), str(self.cache).replace('\\', '/'), pin], text=True, capture_output=True)

    def test_unrelated_default_branch_replaces_only_clean_cached_source(self):
        result = self.fetch()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(git(self.cache, 'rev-parse', 'HEAD'), git(self.new, 'rev-parse', 'HEAD'))
        self.assertEqual((self.cache / 'source.txt').read_text(), 'new source\n')
        self.assertEqual(git(self.cache, 'rev-parse', 'refs/godspeed-before-update/' + self.old_head), self.old_head)

    def test_local_edits_are_retained_and_stop_the_install(self):
        (self.cache / 'source.txt').write_text('local edit\n')
        result = self.fetch()
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(git(self.cache, 'rev-parse', 'HEAD'), self.old_head)
        self.assertEqual((self.cache / 'source.txt').read_text(), 'local edit\n')

    def test_explicit_commit_also_crosses_the_restart(self):
        revision = git(self.new, 'rev-parse', 'HEAD')
        result = self.fetch(revision)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(git(self.cache, 'rev-parse', 'HEAD'), revision)

if __name__ == '__main__':
    unittest.main()
