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
    root = Path(directory)
    root.mkdir(parents=True,exist_ok=True,mode=0o2770)
    name = uuid.uuid4().hex
    temporary = root/(name+'.tmp')
    with temporary.open('x',encoding='utf-8') as handle:
        handle.write(canonical({'schema':1,'item_ids':item_ids}))
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
            if set(event) != {'schema','item_ids'} or event['schema'] != 1:
                raise ValueError('Unknown submission format')
            ids = event['item_ids']
            if not isinstance(ids,list) or len(ids)>100 or not all(isinstance(i,str) and len(i)<200 for i in ids):
                raise ValueError('Invalid source identities')
            now = utcnow()
            facts = boundary.chat.sources.refresh(ids,now)
            draft = boundary.chat.compose(facts,now)
            if draft:
                boundary.chat.delivery.submit(draft)
        except Exception as exc:
            boundary.chat.store.audit('inbox_rejected',type(exc).__name__)
        path.replace(archive/path.name)


async def deliver(boundary,key):
    chat = boundary.chat
    if not chat.delivery.claim(key):
        return chat.delivery.receipt(key)
    draft = chat.delivery.draft(key)
    facts = await asyncio.to_thread(chat.sources.refresh,[i for i,_ in draft.item_revisions],utcnow())
    errors = policy.check(draft,facts,[])
    if errors:
        return chat.delivery.state(key,'suppressed','; '.join(errors))
    from zoneinfo import ZoneInfo
    date = datetime.now(ZoneInfo(chat.timezone)).date()
    sent = chat.store.rows("SELECT coalesce(sent_at,created_at) AS time FROM deliveries WHERE class='digest' AND state IN ('sent','uncertain') AND key NOT LIKE 'telegram:%'")
    if any(datetime.fromisoformat(row['time'].replace('Z','+00:00')).astimezone(ZoneInfo(chat.timezone)).date()==date for row in sent):
        return chat.delivery.state(key,'suppressed','Digest already sent or uncertain today')
    try:
        with boundary.output('digest',key):
            # Plain text is deliberately retained verbatim, with links intact.
            # A single digest is bounded to Telegram's safe text size at composition.
            result = await boundary.adapter._bot.send_message(chat_id=draft.conversation_id,text=draft.text)
        chat.delivery.acknowledge(Receipt(key,'sent',str(result.message_id),utcnow()),draft.text)
    except Exception as exc:
        chat.delivery.state(key,'uncertain',type(exc).__name__)
    return chat.delivery.receipt(key)


async def pump(boundary):
    from .hermes_bridge import edit_approval
    while True:
        try:
            await asyncio.to_thread(import_pending,boundary)
            for row in boundary.chat.store.rows("SELECT key FROM deliveries WHERE state='queued' ORDER BY created_at LIMIT 10"):
                await deliver(boundary,row['key'])
            for row in boundary.chat.store.rows("SELECT * FROM approvals WHERE state!='pending' AND message_id IS NOT NULL"):
                if json.loads(row['result']).get('presented_state') != row['state']:
                    await edit_approval(boundary,row['id'])
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            boundary.chat.store.audit('pump_error',type(exc).__name__)
        await asyncio.sleep(5)
