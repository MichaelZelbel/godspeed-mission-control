"""Migrate known reader reports and refuse unclassified scheduled Telegram output."""
import json
from pathlib import Path
import subprocess
import sys
import time
from datetime import datetime, timezone


def jobs(profile):
    file=Path(profile)/'cron/jobs.json'
    if not file.exists(): return []
    data=json.loads(file.read_text(encoding='utf-8-sig'))
    result=data if isinstance(data,list) else data.get('jobs',[])
    if not isinstance(result,list) or any(not isinstance(job,dict) for job in result):
        raise ValueError('The saved schedule is not a job list')
    return result


def uses_telegram(job):
    for value in (job.get('deliver','local'),job.get('failure_deliver','local')):
        for token in str(value).lower().split(','):
            token=token.strip()
            if token=='telegram' or token.startswith('telegram:') or token=='all': return True
            if token in ('origin','home'):
                origin=job.get('origin')
                if not isinstance(origin,dict) or origin.get('platform') in (None,'telegram'): return True
    return False


def failure_facts(profile,now=None):
    from .contracts import fingerprint
    from .timezones import zone
    now=now or datetime.now(timezone.utc)
    config=settings(profile)
    day=str(now.astimezone(zone(config.get('timezone','UTC'))).date())
    result=[]
    for job in jobs(profile):
        registration=config.get('scheduled_reports',{}).get(str(job.get('id')))
        if not registration or not job.get('last_run_at'): continue
        try: age=(now-datetime.fromisoformat(job['last_run_at'].replace('Z','+00:00'))).total_seconds()
        except (ValueError,TypeError): continue
        if not 0<=age<=3*3600: continue
        failed=job.get('last_status') in ('error','interrupted','delivery_failed')
        label='morning report' if registration['name']=='morning-brief' else 'scheduled report'
        german=config.get('language')=='de'
        subject=('Ich konnte die Zustellung deines geplanten Berichts nicht bestätigen' if german else 'I could not confirm delivery of your '+label)
        result.append({'item_id':'scheduled-failure:'+str(job['id'])+':'+day,'source':'scheduled-reports',
            'revision':fingerprint([job['id'],day,failed]),'status':'open' if failed else 'done',
            'checked_at':now.isoformat(),'kind':'failure','subject':subject,
            'consequence':('Es liegt kein bestätigtes Ergebnis vor.' if german else 'There is no confirmed result.'),
            'next_action':('Bitte mich, den Bericht erneut zu prüfen.' if german else 'Ask me to check the report again.'),
            'link':None,'deadline':None})
    return result


def register_failure_source(chat,profile):
    def read(ids,now):
        return [fact for fact in failure_facts(profile) if fact['item_id'] in ids]
    chat.sources.register('scheduled-reports',read)


def queue_failures(boundary):
    from .contracts import utcnow
    now=utcnow()
    ids=[fact['item_id'] for fact in failure_facts(boundary.profile)]
    facts=boundary.chat.sources.refresh(ids,now)
    for fact in facts:
        draft=boundary.chat.compose([fact],now,purpose='critical_failure')
        if draft: boundary.chat.delivery.submit(draft)


def settings(profile):
    file=Path(profile)/'hub-chat.json'
    return json.loads(file.read_text(encoding='utf-8')) if file.exists() else {}


def protected(profile):
    return settings(profile).get('enabled') is True


def register_reports(config,profile,hub,package):
    saved=jobs(profile)
    for job in saved:
        if job.get('name')!='morning-brief' or not job.get('id') or not job.get('workdir'): continue
        if Path(job['workdir']).resolve()!=hub.resolve(): continue
        config.setdefault('scheduled_reports',{}).setdefault(str(job['id']),
            {'name':'morning-brief','workdir':str(hub.resolve())})
        config.setdefault('reports',{}).setdefault('morning-brief',{'argv':[
            sys.executable,'-m','hub_chat.reader_brief','--hub',str(hub.resolve()),
            '--timezone',config.get('timezone','UTC')]})
    for job in saved:
        if not uses_telegram(job): continue
        registration=config.get('scheduled_reports',{}).get(str(job.get('id')))
        if not registration or not config.get('reports',{}).get(registration.get('name'),{}).get('argv'):
            raise ValueError('Migrate this existing Telegram report before enabling protection: '+str(job.get('name') or job.get('id')))


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
