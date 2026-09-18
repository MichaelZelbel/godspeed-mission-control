"""Remove old message text while keeping outcomes and duplicate prevention intact."""
import json
from .contracts import canonical,timestamp

REMOVED='[Message text removed under the local retention policy]'


def prune(store,before,dry_run=False):
    timestamp(before)
    with store.transaction() as db:
        messages=db.execute("SELECT key,body FROM deliveries WHERE state IN ('sent','failed','suppressed') "
                            "AND julianday(coalesce(sent_at,created_at))<julianday(?)",(before,)).fetchall()
        changed=[]
        for row in messages:
            body=json.loads(row['body'])
            if body['text']==REMOVED: continue
            changed.append(row['key'])
            if not dry_run:
                body['text']=REMOVED
                db.execute('UPDATE deliveries SET body=?,exact_text=NULL WHERE key=?',(canonical(body),row['key']))
                db.execute('UPDATE message_parts SET text=? WHERE delivery_key=?',(REMOVED,row['key']))
        approvals=0
        for row in db.execute("SELECT * FROM approvals WHERE state IN ('expired','cancelled','denied','succeeded','failed') "
                              "AND julianday(expires_at)<julianday(?)",(before,)).fetchall():
            body=json.loads(row['body']); result=json.loads(row['result'])
            if body.get('text_removed') or result.get('presented_state')!=row['state']: continue
            approvals+=1
            if not dry_run:
                kept={key:body[key] for key in ('actor','fingerprint','request_id') if key in body}
                kept.update(summary=REMOVED,text_removed=True)
                db.execute('UPDATE approvals SET body=? WHERE id=?',(canonical(kept),row['id']))
    return {'messages':len(changed),'approvals':approvals,'dry_run':dry_run,
            'outcomes_preserved':True,'pending_and_uncertain_preserved':True}
