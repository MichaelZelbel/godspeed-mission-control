import json
from pathlib import Path
from .compatibility import inspect_runtime


def inspect(profile,runtime=None):
    profile = Path(profile)
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
    return {'healthy':not problems,'problems':problems}
