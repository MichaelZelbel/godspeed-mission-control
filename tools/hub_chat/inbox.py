"""One producer inbox, consumed by the existing gateway. No extra Telegram poller."""
import asyncio
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import uuid
from .contracts import Receipt, canonical, utcnow
from . import policy


def submit(directory,item_ids):
    if not item_ids or len(item_ids)>100 or not all(isinstance(i,str) and 0<len(i)<200 for i in item_ids):
        raise ValueError('Submit between one and 100 source item identities')
    return submit_event(directory,{'schema':1,'item_ids':item_ids})


def submit_event(directory,event):
    root = Path(directory)
    root.mkdir(parents=True,exist_ok=True,mode=0o2770)
    name = uuid.uuid4().hex
    temporary = root/(name+'.tmp')
    with temporary.open('x',encoding='utf-8') as handle:
        handle.write(canonical(event))
        handle.flush()
        os.fsync(handle.fileno())
    if os.name != 'nt':
        os.chmod(temporary,0o660)
    temporary.replace(root/(name+'.json'))
    return {'state':'queued','submission':name}


def import_pending(boundary):
    root = boundary.profile/'chat-inbox'
    root.mkdir(exist_ok=True,mode=0o2770)
    archive = root/'processed'
    archive.mkdir(exist_ok=True,mode=0o770)
    for path in sorted(root.glob('*.json'))[:20]:
        try:
            if path.is_symlink() or path.stat().st_size>32768:
                raise ValueError('Invalid submission file')
            event = json.loads(path.read_text(encoding='utf-8'))
            if event.get('schema') != 1:
                raise ValueError('Unknown submission format')
            now = utcnow()
            if set(event)=={'schema','critical_item'}:
                facts=boundary.chat.sources.refresh([event['critical_item']],now)
                if len(facts)!=1 or facts[0].kind!='failure' or facts[0].source not in boundary.config.get('critical_sources',[]):
                    raise ValueError('Critical event lacks a registered failure source')
                draft=boundary.chat.compose(facts,now,purpose='critical_failure')
                drafts,parse_mode=[draft] if draft else [],None
            elif set(event)=={'schema','report','revision'}:
                from .reports import read_report
                drafts,parse_mode=read_report(boundary,event['report'],event['revision'],now)
            elif set(event)=={'schema','item_ids'}:
                ids = event['item_ids']
                if not isinstance(ids,list) or len(ids)>100 or not all(isinstance(i,str) and len(i)<200 for i in ids):
                    raise ValueError('Invalid source identities')
                facts = boundary.chat.sources.refresh(ids,now)
                draft = boundary.chat.compose(facts,now)
                drafts,parse_mode=[draft] if draft else [],None
            else:
                raise ValueError('Untrusted submission fields')
            for draft in drafts:
                boundary.chat.delivery.submit(draft)
                if parse_mode or 'report' in event:
                    detail={'parse_mode':parse_mode}
                    if 'report' in event: detail.update(report=event['report'],revision=event['revision'])
                    with boundary.chat.store.transaction() as db:
                        db.execute('UPDATE deliveries SET detail=? WHERE key=? AND state=?',(canonical(detail),draft.delivery_key,'queued'))
            accepted={'keys':[d.delivery_key for d in drafts],'state':'queued' if drafts else 'suppressed'}
        except Exception as exc:
            boundary.chat.store.audit('inbox_rejected',type(exc).__name__)
            accepted={'keys':[],'state':'rejected','reason':type(exc).__name__}
        (archive/(path.stem+'.accepted')).write_text(canonical(accepted),encoding='utf-8')
        path.replace(archive/path.name)


async def deliver(boundary,key):
    chat = boundary.chat
    if boundary.config.get('proactive_paused'):
        return chat.delivery.receipt(key)
    if key.startswith('report:'):
        prefix,part=key.rsplit(':',1)
        for earlier in range(int(part)):
            state=chat.delivery.receipt(prefix+':'+str(earlier)).state
            if state in ('failed','uncertain','suppressed'):
                return chat.delivery.state(key,'suppressed','An earlier report part was not confirmed')
            if state!='sent': return chat.delivery.receipt(key)
    if not chat.delivery.claim(key):
        return chat.delivery.receipt(key)
    draft = chat.delivery.draft(key)
    detail=chat.delivery.get(key)['detail']
    meta=json.loads(detail) if detail.startswith('{') else {}
    if key.startswith('report:'):
        try:
            from .reports import read_report
            current,_=await asyncio.to_thread(read_report,boundary,meta['report'],meta['revision'],utcnow())
            if not any(d==draft for d in current): raise ValueError('Report changed')
        except Exception as exc:
            return chat.delivery.state(key,'suppressed','Report no longer current: '+type(exc).__name__)
    facts = await asyncio.to_thread(chat.sources.refresh,[i for i,_ in draft.item_revisions],utcnow())
    errors = policy.check(draft,facts,[])
    if errors:
        return chat.delivery.state(key,'suppressed','; '.join(errors))
    from .timezones import zone
    date = datetime.now(zone(chat.timezone)).date()
    sent = chat.store.rows("SELECT coalesce(sent_at,created_at) AS time FROM deliveries WHERE class='digest' AND state IN ('sent','uncertain') AND key NOT LIKE 'telegram:%' AND key NOT LIKE 'report:%'")
    if draft.output_class=='digest' and not key.startswith('report:') and any(datetime.fromisoformat(row['time'].replace('Z','+00:00')).astimezone(zone(chat.timezone)).date()==date for row in sent):
        return chat.delivery.state(key,'suppressed','Digest already sent or uncertain today')
    try:
        with boundary.output(draft.output_class,key):
            # Plain text is deliberately retained verbatim, with links intact.
            # A single digest is bounded to Telegram's safe text size at composition.
            result = await boundary.adapter._bot.send_message(chat_id=draft.conversation_id,text=draft.text,parse_mode=meta.get('parse_mode'))
        chat.delivery.acknowledge(Receipt(key,'sent',str(result.message_id),utcnow()),draft.text)
    except Exception as exc:
        chat.delivery.state(key,'uncertain',type(exc).__name__)
    return chat.delivery.receipt(key)


def write_receipts(boundary):
    outbox=boundary.profile/'chat-outbox'; outbox.mkdir(exist_ok=True,mode=0o2770)
    for accepted in (boundary.profile/'chat-inbox/processed').glob('*.accepted'):
        data=json.loads(accepted.read_text(encoding='utf-8'))
        rows=[boundary.chat.delivery.get(key) for key in data['keys']]
        states={r['state'] for r in rows}
        state=('sent' if states=={'sent'} else 'uncertain' if 'uncertain' in states else 'queued' if states & {'queued','sending'} else 'suppressed') if rows else data['state']
        receipt={'state':state,'parts':[{'state':r['state'],'message_id':r['message_id'],'sent_at':r['sent_at']} for r in rows]}
        dest=outbox/(accepted.stem+'.json'); temp=dest.with_suffix('.tmp')
        temp.write_text(canonical(receipt),encoding='utf-8'); temp.replace(dest)


async def pump(boundary):
    from .hermes_bridge import edit_approval,heartbeat
    retention_day=None
    while True:
        try:
            heartbeat(boundary)
            today=datetime.now(timezone.utc).date()
            days=boundary.config.get('text_retention_days',90)
            if retention_day!=today and isinstance(days,int) and 1<=days<=3650:
                from datetime import timedelta
                from .retention import prune
                cutoff=(datetime.now(timezone.utc)-timedelta(days=days)).isoformat()
                await asyncio.to_thread(prune,boundary.chat.store,cutoff)
                retention_day=today
            await asyncio.to_thread(import_pending,boundary)
            for row in boundary.chat.store.rows("SELECT key FROM deliveries WHERE state='queued' ORDER BY created_at LIMIT 10"):
                await deliver(boundary,row['key'])
            await asyncio.to_thread(write_receipts,boundary)
            for row in boundary.chat.store.rows("SELECT * FROM approvals WHERE state!='pending' AND message_id IS NOT NULL"):
                if json.loads(row['result']).get('presented_state') != row['state']:
                    await edit_approval(boundary,row['id'])
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            boundary.chat.store.audit('pump_error',type(exc).__name__)
        await asyncio.sleep(5)
