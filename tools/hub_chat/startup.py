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
    config=profile/'hub-chat.json'
    if config.exists():
        settings=json.loads(config.read_text(encoding='utf-8'))
        if settings.get('enabled'):
            try:
                from .compatibility import verify_runtime
                verify_runtime(settings['runtime'])
            except Exception:
                sys.stderr.write('Telegram protection does not match this Hermes version. Restore the tested runtime before starting the gateway.\n')
                raise SystemExit(78)
