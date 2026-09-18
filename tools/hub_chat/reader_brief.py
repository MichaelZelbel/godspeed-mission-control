"""Read the existing reader brief artifact; never send a model's cron transcript."""
import argparse
from datetime import datetime,timezone
import json
from pathlib import Path
import subprocess
from .contracts import fingerprint
from .timezones import zone


def read(hub,timezone_name,now=None):
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
    report={'messages':[text],'item_ids':[],'created_at':created,'parse_mode':None}
    report['revision']=fingerprint([report['messages'],[],created,None])
    return report


if __name__=='__main__':
    parser=argparse.ArgumentParser(); parser.add_argument('--hub',required=True); parser.add_argument('--timezone',default='UTC')
    args=parser.parse_args()
    print(json.dumps(read(args.hub,args.timezone),ensure_ascii=False))
