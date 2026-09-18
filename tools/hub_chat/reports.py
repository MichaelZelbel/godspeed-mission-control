"""Configured scheduled reports. Producers choose a registered name, never a recipient."""
from datetime import timedelta
import json
import subprocess
from .contracts import Draft,fingerprint,timestamp


def read_report(boundary,name,revision,now):
    registration=boundary.config.get('reports',{}).get(name)
    if not registration or not isinstance(registration.get('argv'),list):
        raise ValueError('Report producer is not registered')
    result=subprocess.run(registration['argv'],capture_output=True,text=True,encoding='utf-8',timeout=20,check=True)
    if len(result.stdout)>100_000: raise ValueError('Report is too large')
    report=json.loads(result.stdout)
    if set(report)-{'messages','item_ids','created_at','revision','parse_mode'}: raise ValueError('Unknown report fields')
    if report.get('revision') != revision: raise ValueError('The report changed after submission')
    age=timestamp(now)-timestamp(report['created_at'])
    if age<timedelta(0) or age>timedelta(hours=3): raise ValueError('Report is not current')
    messages=report['messages']
    if not isinstance(messages,list) or not 1<=len(messages)<=12 or any(not isinstance(m,str) or not m.strip() or len(m.encode('utf-16-le'))//2>3500 for m in messages):
        raise ValueError('Invalid report text')
    expected=fingerprint([messages,report.get('item_ids',[]),report['created_at'],report.get('parse_mode')])
    if revision!=expected: raise ValueError('Report content digest does not match')
    ids=report.get('item_ids',[])
    facts=boundary.chat.sources.refresh(ids,now)
    if any(f.status!='open' for f in facts): raise ValueError('A reported item closed or could not be checked')
    if report.get('parse_mode') not in (None,'HTML'): raise ValueError('Unsupported report format')
    from .timezones import zone
    day=str(timestamp(now).astimezone(zone(boundary.chat.timezone)).date())
    drafts=[Draft('report:'+name+':'+day+':'+str(i),boundary.chat.conversation_id,'digest',text,
                  tuple((f.item_id,f.revision) for f in facts if (f.link and f.link in text) or f.subject in text)) for i,text in enumerate(messages)]
    return drafts,report.get('parse_mode')
