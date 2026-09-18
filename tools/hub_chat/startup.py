"""Startup check remains installed even if an external updater removes the patch.

Only gateway launches are checked; CLI repair commands stay usable. A mismatch is
an explicit startup failure, never an unprotected Telegram consumer.
"""
import json
import os
from pathlib import Path
import sys

if 'gateway' in sys.argv and any(x in sys.argv for x in ('run','start','restart')):
    profile=Path(os.environ.get('HERMES_HOME',Path.home()/'.hermes'))
    for flag in ('-p','--profile'):
        if flag in sys.argv and sys.argv.index(flag)+1<len(sys.argv):
            name=sys.argv[sys.argv.index(flag)+1]
            if '/' in name or '\\' in name or name in ('.','..'):
                raise SystemExit('Invalid Hermes profile name')
            if profile.name!=name:
                profile=profile/'profiles'/name
    config=profile/'hub-chat.json'
    if config.exists():
        settings=json.loads(config.read_text(encoding='utf-8'))
        if settings.get('enabled'):
            try:
                from .bundle import verify
                verify(settings['package'],check_import=True)
                from .compatibility import verify_runtime
                recovery=os.environ.get('HUB_CHAT_RECOVERY')
                if recovery:
                    if str(Path(recovery).resolve())!=str(Path(settings['recovery']).resolve()):
                        raise ValueError('Unexpected recovery location')
                    verify_runtime(Path(recovery)/'source')
                    sys.path.insert(0,str(Path(recovery)/'source'))
                else:
                    verify_runtime(settings['runtime'])
            except Exception:
                if settings.get('recovery') and not os.environ.get('HUB_CHAT_RECOVERY'):
                    try:
                        from .recovery import recover
                        recover(profile,settings)
                    except Exception:
                        pass
                sys.stderr.write('Telegram protection does not match this Hermes version. Restore the tested runtime before starting the gateway.\n')
                raise SystemExit(78)
