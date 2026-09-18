"""Read-only source commands are configured locally, never supplied by an inbox event."""
import json
from pathlib import Path
import subprocess


def configure_sources(chat, config):
    for source in config.get('sources',[]):
        name = source['name']
        command = source['argv']
        if not isinstance(command,list) or not command or not all(isinstance(x,str) for x in command):
            raise ValueError('Source argv must be an argument list')
        def read(ids, now, source=source, command=command, name=name):
            result = subprocess.run(command,cwd=source.get('cwd'),capture_output=True,text=True,
                                    encoding='utf-8',timeout=15,check=True)
            if len(result.stdout) > 2_000_000:
                raise ValueError('Source response is too large')
            rows = json.loads(result.stdout)
            if not isinstance(rows,list):
                raise ValueError('Source must return a list')
            return [dict(row,source=name,checked_at=now) for row in rows if row.get('item_id') in ids]
        chat.sources.register(name,read)


def discover(config):
    """List identities without treating discovery as proof that an item is still open."""
    ids = []
    for source in config.get('sources',[]):
        result = subprocess.run(source['argv'],cwd=source.get('cwd'),capture_output=True,text=True,
                                encoding='utf-8',timeout=15,check=True)
        rows = json.loads(result.stdout)
        ids.extend(r['item_id'] for r in rows)
    return list(dict.fromkeys(ids))
