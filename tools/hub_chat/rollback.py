"""Rollback a package without rolling back conversation state or enabling old senders."""
import hashlib
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
        return {'restored':False,'proactive_paused':True,'reason':'No earlier protected package exists. Direct replies remain available; keep this boundary until a tested replacement is installed.'}
    previous=Path(previous)
    root=(home/'.hub/chat/releases').resolve()
    if previous.resolve().parent!=root:
        raise ValueError('Previous package is outside the release directory')
    manifest=json.loads((previous/'bundle.json').read_text(encoding='utf-8'))
    for name,digest in manifest['files'].items():
        file=(previous/name).resolve()
        if not file.is_relative_to(previous.resolve()) or hashlib.sha256(file.read_bytes()).hexdigest()!=digest:
            raise ValueError('Previous package failed integrity verification')
    backup=json.loads((profile/'chat-rollback.json').read_text(encoding='utf-8'))
    Path(backup['pth']).write_text(str(previous/'tools')+'\nimport hub_chat.startup\n',encoding='utf-8')
    config['package']=str(previous); atomic_json(config_path,config)
    atomic_json(pointer,{'schema':1,'id':manifest['id'],'path':str(previous),'previous':current['path']})
    return {'restored':True,'proactive_paused':True,'restart_required':True,'database_preserved':True}
