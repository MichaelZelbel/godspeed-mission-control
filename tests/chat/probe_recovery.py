"""Linux release probe using a real installed Hermes environment, no bot connection.

Arguments: candidate Hermes source, immutable bundle, empty test profile directory.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
from hub_chat.recovery import preserve,verify

runtime,bundle,profile=map(Path,sys.argv[1:])
profile.mkdir(parents=True,exist_ok=True)
if (profile/'hub-chat.json').exists(): raise SystemExit('Use a new empty test profile')
snapshot=Path(preserve(runtime,profile,bundle))
verify(snapshot)
config={'enabled':True,'runtime':str(profile/'nonexistent-updated-runtime'),'recovery':str(snapshot),'proactive_paused':False}
(profile/'hub-chat.json').write_text(json.dumps(config))
python=snapshot/'env/bin/python'
env=dict(os.environ,HERMES_HOME=str(profile),PYTHONDONTWRITEBYTECODE='1')
env.pop('PYTHONPATH',None); env.pop('HUB_CHAT_RECOVERY',None)
run=subprocess.run([str(python),'-c','raise RuntimeError("Startup recovery did not take over")','gateway','run','--help'],
                   env=env,text=True,capture_output=True,timeout=120)
if run.returncode:
    raise SystemExit(run.stderr[-2500:])
assert (profile/'chat-recovery-active.json').exists()
assert json.loads((profile/'hub-chat.json').read_text())['proactive_paused'] is True
assert 'usage:' in run.stdout.lower()
verify(snapshot)
print('PASS: unsupported runtime recovered into the preserved interpreter and source; notifications paused; no Telegram connection.')
