"""Actual repair script with isolated command endpoints; no service or network changes."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from helpers import ROOT


@unittest.skipIf(os.name=='nt','The server entry point runs on Unix')
class RepairEntryPoint(unittest.TestCase):
    def test_repair_installs_tools_preserves_schedule_and_stops_on_failed_tools(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory); account=root/'account'; account.mkdir()
            hub=account/'hub'; hub.mkdir(); (hub/'AGENTS.md').write_text('# Example assistant')
            bin_dir=root/'commands'; bin_dir.mkdir()
            def command(name,text):
                file=bin_dir/name; file.write_text('#!/bin/sh\n'+text+'\n'); file.chmod(0o700)
            command('id','printf "1001\\n"')
            command('curl','cat "$TEST_LIBRARY"')
            command('hermes','printf "Example Hermes\\n"')
            command('xz','exit 0')
            profile=account/'.hermes'; (profile/'cron').mkdir(parents=True)
            jobs=profile/'cron/jobs.json'
            original=json.dumps({'jobs':[{'id':'reader-brief','name':'morning-brief','workdir':str(hub),'schedule':{'expr':'30 8 * * 1-5'}}]})
            jobs.write_text(original)
            library=root/'library.sh'
            library.write_text('''
kb_point_hermes_at_hub() { return 0; }
kb_install_hub_tools() {
  [ "${TEST_FAIL_TOOLS:-}" = yes ] && return 1
  mkdir -p "$HOME/.local/bin" "$HOME/.hub/chat"
  printf '%s' '{}' > "$HOME/.hub/chat/current.json"
  printf '%s' 'require("fs").writeFileSync(process.env.TEST_CONFIGURED,"configured")' > "$HOME/.local/bin/chat-gateway.js"
  printf '%s' "$KB_TOOLS_REF" > "$TEST_TOOL_PIN"
}
kb_cron_job() { printf '%s' unexpected > "$TEST_SCHEDULE_EDIT"; return 0; }
''')
            env=dict(os.environ,HOME=str(account),HUB=str(hub),HERMES_HOME=str(profile),
                     PATH=str(bin_dir)+os.pathsep+os.environ['PATH'],TEST_LIBRARY=str(library),
                     TEST_CONFIGURED=str(root/'configured'),TEST_TOOL_PIN=str(root/'pin'),
                     TEST_SCHEDULE_EDIT=str(root/'schedule-edit'),KB_CALLED_FROM_INSTALLER='1',KB_MORNING_BRIEF='yes')
            run=subprocess.run(['bash',str(ROOT/'server/install-hermes.sh')],env=env,text=True,capture_output=True,timeout=30)
            self.assertEqual(run.returncode,0,run.stdout+run.stderr)
            self.assertEqual(jobs.read_text(),original)
            self.assertFalse((root/'schedule-edit').exists())
            self.assertTrue((root/'configured').exists())
            self.assertRegex((root/'pin').read_text(),r'^[0-9a-f]{40}$')
            (root/'configured').unlink()
            env['TEST_FAIL_TOOLS']='yes'
            failed=subprocess.run(['bash',str(ROOT/'server/install-hermes.sh')],env=env,text=True,capture_output=True,timeout=30)
            self.assertNotEqual(failed.returncode,0)
            self.assertFalse((root/'configured').exists())
            self.assertEqual(jobs.read_text(),original)
            env.pop('TEST_FAIL_TOOLS')
            jobs.write_text('{broken')
            failed=subprocess.run(['bash',str(ROOT/'server/install-hermes.sh')],env=env,text=True,capture_output=True,timeout=30)
            self.assertNotEqual(failed.returncode,0)
            self.assertEqual(jobs.read_text(),'{broken')
            self.assertFalse((root/'schedule-edit').exists())
            self.assertFalse((root/'configured').exists())
