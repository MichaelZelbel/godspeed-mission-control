import json
import sqlite3
from pathlib import Path
from .compatibility import inspect_runtime


def inspect(profile,runtime=None):
    profile = Path(profile).resolve()
    config_path = profile/'hub-chat.json'
    if not config_path.exists():
        return {'healthy':False,'problems':['Telegram conversation protection has not been configured on this gateway.']}
    config = json.loads(config_path.read_text(encoding='utf-8'))
    problems = []
    if not config.get('enabled'):
        problems.append('Conversation protection is disabled.')
    if not config.get('conversation_id') or not config.get('actor_id'):
        problems.append('The conversation owner has not been configured.')
    if not runtime and not config.get('runtime'):
        problems.append('The Hermes runtime location is missing.')
    else:
        problems.extend(inspect_runtime(runtime or config['runtime']))
    for source in config.get('sources',[]):
        if not source.get('argv'):
            problems.append('A current-state source has no read command.')
    try:
        from .source_adapters import discover
        discover(config)
    except Exception as exc:
        problems.append('Current source read failed: '+type(exc).__name__)
    journal=profile/'chat-state/communication.sqlite3'
    states=[]
    if journal.exists():
        db=sqlite3.connect(journal.as_uri()+'?mode=ro',uri=True)
        try: states=[{'state':state,'count':count} for state,count in db.execute('SELECT state,count(*) FROM deliveries GROUP BY state')]
        finally: db.close()
    return {'healthy':not problems,'problems':problems,'proactive_paused':config.get('proactive_paused',True),
            'delivery_states':states,'runtime_loaded':(profile/'chat-runtime.json').exists()}
