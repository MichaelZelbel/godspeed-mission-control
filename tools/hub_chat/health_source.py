"""Read-only service evidence for an explicitly configured critical notification."""
import argparse
import json
import subprocess
from .contracts import fingerprint,utcnow


def read(unit,run=subprocess.run):
    result=run(['systemctl','show',unit,'--property=ActiveState,Result,LoadState'],capture_output=True,text=True,timeout=10)
    fields=dict(line.split('=',1) for line in result.stdout.splitlines() if '=' in line)
    state=fields.get('ActiveState')
    abnormal=fields.get('Result') in ('exit-code','signal','core-dump','watchdog','timeout')
    status='done' if state=='active' else 'open' if state=='failed' and abnormal and fields.get('LoadState')=='loaded' else 'unknown'
    if result.returncode: status='unknown'
    return [{'item_id':'watchdog:gateway','source':'reader-health','revision':fingerprint([unit,fields]),
             'status':status,'checked_at':utcnow(),'kind':'failure','subject':'Your assistant service has failed',
             'consequence':'It cannot answer messages while it is stopped.',
             'next_action':'Check the server status and restart the assistant service.'}]


if __name__=='__main__':
    p=argparse.ArgumentParser(); p.add_argument('--unit',required=True); a=p.parse_args()
    print(json.dumps(read(a.unit)))
