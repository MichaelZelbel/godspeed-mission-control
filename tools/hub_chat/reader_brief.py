"""Send what the saved task records say now; never a model's cron transcript or its prose claims.

A brief written minutes ago can still repeat a count of decisions that were never open, or name
finished work as waiting. A fresh file proves when the words were written, not that they are true.
So the brief file only proves the morning job ran today. The message is built from the task
records read at this moment, and a record that cannot be read stops the message instead of
turning into "nothing to do".
"""
import argparse
from datetime import datetime,timezone
import json
import os
from pathlib import Path
import subprocess
from .contracts import Fact,fingerprint
from .policy import compose
from .timezones import zone

NOTHING={'en':'Nothing in your saved task records needs you today.',
         'de':'In deinen gespeicherten Aufgaben wartet heute nichts auf dich.'}


def current_facts(hub):
    """Read both reader sources. Any failure propagates: unknown is never reported as empty."""
    if not ((hub/'rules').is_dir() or (hub/'observations').is_dir()):
        # The task tools fall back to another hub on this computer when they do not recognize one.
        raise ValueError('The hub folder could not be recognized')
    tools=Path(__file__).parent.parent
    environment=dict(os.environ,HUB_ROOT=str(hub))
    facts=[]
    for argv in (['node',str(tools/'due.js'),'export','--hub',str(hub)],['node',str(tools/'work.js'),'export']):
        result=subprocess.run(argv,cwd=str(hub),env=environment,capture_output=True,text=True,
                              encoding='utf-8',timeout=15,check=True)
        if len(result.stdout)>2_000_000: raise ValueError('Source response is too large')
        rows=json.loads(result.stdout)
        if not isinstance(rows,list): raise ValueError('Source must return a list')
        facts.extend(Fact.parse(row) for row in rows)
    return facts


def read(hub,timezone_name,now=None,language='en'):
    now=now or datetime.now(timezone.utc)
    hub=Path(hub).resolve()
    file=hub/'brief'/(str(now.astimezone(zone(timezone_name)).date())+'.md')
    if file.is_symlink() or not file.resolve().is_relative_to(hub):
        raise ValueError('The brief must be inside the hub')
    age=now.timestamp()-file.stat().st_mtime
    if not 0<=age<=3*3600 or file.stat().st_size>14000:
        raise ValueError('The brief is missing or is not current')
    text=file.read_text(encoding='utf-8').strip()
    if not text or len(text.encode('utf-16-le'))//2>3500:
        raise ValueError('The brief must fit in one readable message')
    checker=Path(__file__).parent.parent/'check-brief.js'
    checked=subprocess.run(['node',str(checker),'-'],input=text,text=True,encoding='utf-8',capture_output=True,timeout=10)
    if checked.returncode: raise ValueError('The brief sends its reader to unavailable files or content')
    created=datetime.fromtimestamp(file.stat().st_mtime,timezone.utc).isoformat().replace('+00:00','Z')
    draft=compose(current_facts(hub),'brief',now.isoformat(),timezone_name,language)
    revisions=[list(pair) for pair in draft.item_revisions] if draft else []
    message=draft.text if draft else NOTHING.get(language,NOTHING['en'])
    report={'messages':[message],'item_ids':[item for item,_ in revisions],'created_at':created,'parse_mode':None}
    report['revision']=fingerprint([report['messages'],revisions,created,None])
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--hub',required=True); parser.add_argument('--timezone',default='UTC')
    parser.add_argument('--language',default='en')
    args=parser.parse_args()
    print(json.dumps(read(args.hub,args.timezone,language=args.language),ensure_ascii=False))
