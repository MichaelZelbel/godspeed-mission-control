"""Offline incident rehearsal. No transport selection or real profile is accepted."""
import json
from pathlib import Path
import tempfile
from .app import Chat


def replay(name):
    if name!='september-18':
        raise ValueError('Unknown rehearsal')
    data=json.loads((Path(__file__).parent/'data/september-18.json').read_text(encoding='utf-8'))
    checks={}
    messages=[]
    def source(ids,now):
        return [dict(x,source='fixture',checked_at=now) for x in data['items'] if x['item_id'] in ids]
    def send(conversation,text):
        messages.append(text)
        return str(len(messages))
    with tempfile.TemporaryDirectory(prefix='hub-chat-replay-') as directory:
        chat=Chat(directory,data['conversation'],timezone='Europe/Berlin')
        try:
            chat.sources.register('fixture',source)
            facts=chat.sources.refresh([x['item_id'] for x in data['items']],data['now'])
            draft=chat.compose(facts,data['now'])
            chat.delivery.submit(draft)
            checks['queue_is_not_delivery']=chat.store.shown_ids()==[]
            chat.dispatch(draft.delivery_key,send,data['now'])
            checks['only_current_items']=set(chat.store.shown_ids())=={'name-choice','report'}
            chat.close()
            chat=Chat(directory,data['conversation'],timezone='Europe/Berlin')
            chat.sources.register('fixture',source)
            context=chat.context.resolve(data['conversation'],'1',data['followup'],data['now'])
            checks['reply_after_restart']=set(f.item_id for f in context.facts)=={'name-choice','report'}
            for item in data['items']:
                if item['item_id']=='name-choice':
                    item.update(status='done',revision='2')
            context=chat.context.resolve(data['conversation'],'1',data['followup'],'2026-09-18T09:30:00Z')
            checks['completion_refreshed']=any(f.item_id=='name-choice' and f.status=='done' for f in context.facts)
            action={'summary':'Delete a fictional temporary file','actor':'reader','fingerprint':'fictional-delete'}
            approval=chat.approvals.create(action,data['conversation'],'2026-09-18T09:33:25Z')
            outcome=chat.approvals.decide(approval,'reader','once','2026-09-18T09:40:02Z')
            checks['late_approval_cannot_execute']=outcome['state']=='expired' and not outcome['may_execute']
        finally:
            chat.close()
    return {'passed':all(checks.values()),'checks':checks,'network_messages':0,
            'visible_fixture_messages':messages,'approval':outcome['state'],
            'scope':'Shared conversation components; this does not certify an installed gateway.'}
