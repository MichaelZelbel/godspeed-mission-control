"""Explicit local gateway setup. Never installs a second bot consumer."""
import json
import os
from pathlib import Path
import shutil
import sys
import sysconfig
from .compatibility import install_patch


def atomic_json(path,data):
    temp=path.with_suffix(path.suffix+'.tmp')
    temp.write_text(json.dumps(data,indent=2)+'\n',encoding='utf-8')
    if os.name!='nt': os.chmod(temp,0o600)
    temp.replace(path)


def configure(args):
    config_path=args.profile/'hub-chat.json'
    config=json.loads(config_path.read_text(encoding='utf-8')) if config_path.exists() else {}
    if config.get('enabled') is False:
        return {'configured':False,'state':'disabled_by_user','messages_sent':0}
    # This command must run in Hermes's interpreter, not a system Python.
    import importlib.util
    if not importlib.util.find_spec('telegram') or not importlib.util.find_spec('yaml'):
        raise ValueError('Run configuration with the Python environment used by Hermes')
    root=args.runtime.resolve(); bundle=args.bundle.resolve()
    package=bundle/'tools'
    if not (package/'hub_chat/__init__.py').is_file():
        raise ValueError('The immutable chat bundle is incomplete')
    from .bundle import verify
    verify(bundle,check_import=True)
    previous_config=dict(config)
    # Only communication settings are changed. Execution permissions remain untouched.
    config.update(schema=1,enabled=True,conversation_id=args.conversation,actor_id=args.actor,
                  timezone=args.timezone or config.get('timezone') or os.environ.get('TZ','UTC'),
                  language=args.language or config.get('language','en'),runtime=str(root),package=str(bundle))
    from .timezones import zone
    zone(config['timezone'])
    from .scheduled import register_reports
    register_reports(config,args.profile,args.hub,package)
    # Validate configuration before touching executable code or its import path.
    import yaml
    yaml_path=args.profile/'config.yaml'
    current=(yaml.safe_load(yaml_path.read_text()) or {}) if yaml_path.exists() else {}
    display=current.setdefault('display',{}).setdefault('platforms',{}).setdefault('telegram',{})
    if not isinstance(display,dict):
        raise ValueError('Telegram display settings must be a mapping')
    patch_result=install_patch(root,bundle/'integrations/hermes')
    args.profile.mkdir(parents=True,exist_ok=True,mode=0o700)
    config.setdefault('sources',[{'name':'reader-due','argv':['node',str(package/'due.js'),'export','--hub',str(args.hub)]},
                                 {'name':'reader-work','argv':['node',str(package/'work.js'),'export'],'cwd':str(args.hub)}])
    config.setdefault('proactive_paused',True)
    config.setdefault('text_retention_days',90)
    pth=Path(sysconfig.get_paths()['purelib'])/'hub_chat.pth'
    old_pth=pth.read_text(encoding='utf-8') if pth.exists() else None
    backup=args.profile/'chat-rollback.json'
    if not backup.exists() or previous_config.get('package')!=str(bundle):
        atomic_json(backup,{'previous_config':previous_config or None,
                            'pth':str(pth),'previous_pth':old_pth,'runtime':str(root),'package':str(bundle)})
    from .recovery import preserve
    config['recovery']=preserve(root,args.profile,bundle)
    changed=[key for key in ('streaming','interim_assistant_messages','long_running_notifications') if display.get(key) is not False]
    display.update(streaming=False,interim_assistant_messages=False,long_running_notifications=False)
    if yaml_path.exists() and not (args.profile/'config.before-chat.yaml').exists():
        shutil.copy2(yaml_path,args.profile/'config.before-chat.yaml')
    yaml_tmp=yaml_path.with_suffix('.yaml.chat-tmp')
    yaml_tmp.write_text(yaml.safe_dump(current,sort_keys=False),encoding='utf-8')
    if os.name!='nt': os.chmod(yaml_tmp,0o600)
    yaml_tmp.replace(yaml_path)
    atomic_json(config_path,config)
    pth_tmp=pth.with_suffix('.pth.chat-tmp')
    pth_tmp.write_text(str(package)+'\nimport hub_chat.startup\n',encoding='utf-8')
    pth_tmp.replace(pth)
    (args.profile/'chat-inbox').mkdir(exist_ok=True,mode=0o2770)
    return {'configured':True,'patch':patch_result,'restart_required':True,'messages_sent':0,'managed_display_changes':changed}
