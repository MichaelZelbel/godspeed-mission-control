"""Exercise protected rollback against an earlier scratch recovery snapshot.

Arguments: scratch runtime, new immutable bundle, earlier scratch profile, bundle home.
No Telegram connection or gateway polling is started.
"""
import json
import os
from pathlib import Path
import subprocess
import sys
from hub_chat.recovery import preserve,verify
from hub_chat.rollback import rollback

runtime,bundle,profile,home=map(Path,sys.argv[1:])
settings=profile/'hub-chat.json'
prior=json.loads(settings.read_text())
if prior.get('conversation_id') or (profile/'chat-state').exists():
    raise SystemExit('Use an earlier recovery-only scratch profile without conversation state')
old_snapshot=Path(prior['recovery']); old_record=verify(old_snapshot)
old_bundle=Path(old_record['bundle'])
if old_bundle.resolve().parent!=(home/'.hub/chat/releases').resolve():
    raise SystemExit('Earlier snapshot must use this scratch bundle home')
new_snapshot=Path(preserve(runtime,profile,bundle))
if new_snapshot==old_snapshot: raise SystemExit('Use a newer package for the rollback probe')
old={'enabled':True,'package':str(old_bundle),'recovery':str(old_snapshot),'runtime':str(runtime),
     'conversation_id':'100','actor_id':'200','sources':[],'timezone':'UTC','proactive_paused':False}
current=dict(old,package=str(bundle),recovery=str(new_snapshot),language='de')
settings.write_text(json.dumps(current))
pth=profile/'fixture-launcher.pth'; pth.write_text(str(bundle/'tools')+'\nimport hub_chat.startup\n')
(profile/'chat-rollback.json').write_text(json.dumps({'previous_config':old,'pth':str(pth)}))
(home/'.hub/chat/current.json').write_text(json.dumps({'path':str(bundle),'previous':str(old_bundle)}))
from hub_chat.app import Chat
from hub_chat.contracts import Draft
chat=Chat(profile/'chat-state','100')
chat.delivery.submit(Draft('uncertain-fixture','100','digest','Example uncertain result'))
chat.delivery.claim('uncertain-fixture'); chat.delivery.state('uncertain-fixture','uncertain','Fixture connection loss')
chat.close()
journal=profile/'chat-state/communication.sqlite3'; before=journal.read_bytes()
result=rollback(profile,home)
assert result['restored'] and journal.read_bytes()==before
restored=json.loads(settings.read_text())
assert restored['recovery']==str(old_snapshot) and restored['package']==str(old_bundle)
assert restored['language']=='de' and restored['proactive_paused'] is True
python=new_snapshot/'env/bin/python'
env=dict(os.environ,HERMES_HOME=str(profile),PYTHONDONTWRITEBYTECODE='1')
env.pop('PYTHONPATH',None); env.pop('HUB_CHAT_RECOVERY',None)
run=subprocess.run([str(python),'-c','raise RuntimeError("Rollback recovery did not take over")','gateway','run','--help'],
                   env=env,text=True,capture_output=True,timeout=120)
if run.returncode: raise SystemExit(run.stderr[-2500:])
active=json.loads((profile/'chat-recovery-active.json').read_text())
assert Path(active['runtime'])==old_snapshot/'source'
assert 'usage:' in run.stdout.lower()
assert journal.read_bytes()==before
verify(old_snapshot); verify(new_snapshot)
print('PASS: earlier protected runtime started; uncertain history unchanged; notifications paused; no Telegram connection.')
