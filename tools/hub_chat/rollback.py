"""Rollback a package without rolling back conversation state or enabling old senders."""
import json
from pathlib import Path
from .setup import atomic_json


def rollback(profile,home=None):
    profile=Path(profile); home=Path(home or Path.home())
    config_path=profile/'hub-chat.json'
    config=json.loads(config_path.read_text(encoding='utf-8'))
    config['proactive_paused']=True
    atomic_json(config_path,config)
    pointer=home/'.hub/chat/current.json'
    current=json.loads(pointer.read_text(encoding='utf-8'))
    previous=current.get('previous')
    if not previous:
        return {'restored':False,'proactive_paused':True,'restart_required':True,'reason':'No earlier protected package exists. Keep this boundary until a tested replacement is installed.'}
    previous=Path(previous)
    root=(home/'.hub/chat/releases').resolve()
    if previous.resolve().parent!=root:
        raise ValueError('Previous package is outside the release directory')
    from .bundle import verify
    package_id=verify(previous)
    compatibility=json.loads((previous/'integrations/hermes/compatibility.json').read_text(encoding='utf-8'))
    required={'gateway/platforms/base.py','plugins/platforms/telegram/adapter.py',
              'gateway/run_turn_runner.py','tools/approval.py','cron/scheduler_delivery.py',
              'tools/send_message_senders.py','_hub_chat_bridge.py'}
    if not required.issubset(compatibility.get('files',{})):
        return {'restored':False,'proactive_paused':True,'restart_required':True,
                'reason':'The earlier package lacks complete output protection. Keep this boundary until a tested replacement is installed.'}
    backup=json.loads((profile/'chat-rollback.json').read_text(encoding='utf-8'))
    restored=backup.get('previous_config') or {}
    if not restored.get('enabled') or Path(restored.get('package','')).resolve()!=previous.resolve():
        raise ValueError('No matching earlier protected configuration exists; notifications remain paused')
    recovery=Path(restored.get('recovery','')).resolve()
    if not recovery.is_relative_to((profile/'chat-recovery').resolve()):
        raise ValueError('Previous recovery runtime is outside this profile')
    from .recovery import verify as verify_recovery
    record=verify_recovery(recovery)
    if Path(record['bundle']).resolve()!=previous.resolve():
        raise ValueError('Previous runtime does not match the earlier package')
    # Preserve personal communication choices changed after the upgrade.
    for key in ('conversation_id','actor_id','timezone','language','text_retention_days'):
        if key in config: restored[key]=config[key]
    restored['proactive_paused']=True
    pth=Path(backup['pth'])
    old_pth=pth.read_text(encoding='utf-8') if pth.exists() else None
    atomic_json(config_path,restored)
    temporary=pth.with_suffix('.pth.rollback-tmp')
    temporary.write_text(str(previous/'tools')+'\nimport hub_chat.startup\n',encoding='utf-8')
    temporary.replace(pth)
    atomic_json(pointer,{'schema':1,'id':package_id,'path':str(previous),'previous':current['path']})
    atomic_json(profile/'chat-rollback.json',{'pth':str(pth),'previous_config':config,'previous_pth':old_pth,
                                            'runtime':restored['runtime'],'package':str(previous)})
    return {'restored':True,'proactive_paused':True,'restart_required':True,'database_preserved':True}
