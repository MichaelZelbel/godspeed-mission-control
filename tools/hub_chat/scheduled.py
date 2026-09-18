"""Migrate known reader reports and refuse unclassified scheduled Telegram output."""
import json
from pathlib import Path
import subprocess
import sys
import time


def settings(profile):
    file=Path(profile)/'hub-chat.json'
    return json.loads(file.read_text(encoding='utf-8')) if file.exists() else {}


def protected(profile):
    return settings(profile).get('enabled') is True


def register_reports(config,profile,hub,package):
    jobs_file=profile/'cron/jobs.json'
    if not jobs_file.exists(): return
    data=json.loads(jobs_file.read_text(encoding='utf-8-sig'))
    jobs=data if isinstance(data,list) else data.get('jobs',[])
    for job in jobs:
        if job.get('name')!='morning-brief' or not job.get('id') or not job.get('workdir'): continue
        if Path(job['workdir']).resolve()!=hub.resolve(): continue
        config.setdefault('scheduled_reports',{}).setdefault(str(job['id']),
            {'name':'morning-brief','workdir':str(hub.resolve())})
        config.setdefault('reports',{}).setdefault('morning-brief',{'argv':[
            sys.executable,'-m','hub_chat.reader_brief','--hub',str(hub.resolve()),
            '--timezone',config.get('timezone','UTC')]})


def queue_report(profile,config,job,for_failure,timeout=90):
    registration=config.get('scheduled_reports',{}).get(str(job.get('id')))
    if not registration: return 'Scheduled Telegram output has no registered report source.'
    if not job.get('workdir') or Path(job['workdir']).resolve()!=Path(registration['workdir']).resolve():
        return 'The scheduled report workspace changed; delivery was refused.'
    if for_failure: return 'The scheduled report failed. No result was delivered.'
    source=config.get('reports',{}).get(registration['name'],{})
    if not source.get('argv'): return 'The registered report source is unavailable.'
    result=subprocess.run(source['argv'],cwd=source.get('cwd'),capture_output=True,text=True,encoding='utf-8',timeout=20,check=True)
    if len(result.stdout)>100000: raise ValueError('Report source is too large')
    report=json.loads(result.stdout)
    from .inbox import submit_event
    queued=submit_event(profile/'chat-inbox',{'schema':1,'report':registration['name'],'revision':report['revision']})
    receipt=profile/'chat-outbox'/(queued['submission']+'.json')
    deadline=time.monotonic()+timeout
    while True:
        if receipt.exists():
            state=json.loads(receipt.read_text(encoding='utf-8'))['state']
            if state=='sent': return None
            if state!='queued': return 'Scheduled report delivery is '+state+'. Do not resend automatically.'
        if time.monotonic()>=deadline: break
        time.sleep(0.5)
    return 'Scheduled report queued; delivery is not confirmed. Do not resend automatically.'


def filter_targets(profile,job,targets,for_failure):
    config=settings(profile)
    if config.get('enabled') is not True: return targets,[]
    remaining=[]; errors=[]
    for target in targets:
        if target['platform']!='telegram':
            remaining.append(target); continue
        if str(target['chat_id'])!=str(config['conversation_id']):
            errors.append('The Telegram recipient is outside this protected conversation.'); continue
        try: error=queue_report(Path(profile),config,job,for_failure)
        except Exception as exc: error='Scheduled report delivery refused: '+type(exc).__name__
        if error: errors.append(error)
    return remaining,errors
