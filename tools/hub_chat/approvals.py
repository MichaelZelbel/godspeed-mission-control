"""Presentation journal only. Hermes remains the execution authority."""
import json
import uuid
from .contracts import canonical, timestamp


class Approvals:
    def __init__(self, store):
        self.store = store

    def create(self, action, conversation_id, expires_at):
        timestamp(expires_at)
        if not all(action.get(k) for k in ('summary','actor','fingerprint')):
            raise ValueError('Action, actor and fingerprint are required')
        aid = action.get('request_id') or uuid.uuid4().hex
        with self.store.transaction() as db:
            previous = db.execute('SELECT fingerprint,conversation FROM approvals WHERE id=?',(aid,)).fetchone()
            if previous and (previous['fingerprint'] != action['fingerprint'] or previous['conversation'] != conversation_id):
                raise ValueError('Approval identity conflict')
            db.execute('INSERT OR IGNORE INTO approvals(id,conversation,actor,fingerprint,body,expires_at,state) VALUES(?,?,?,?,?,?,?)',
                       (aid,conversation_id,action['actor'],action['fingerprint'],canonical(action),expires_at,'pending'))
        return aid

    def decide(self, approval_id, actor, choice, now):
        if choice not in ('once','session','always','deny'):
            raise ValueError('Unknown approval choice')
        with self.store.transaction() as db:
            row = db.execute('SELECT * FROM approvals WHERE id=?',(approval_id,)).fetchone()
            if not row:
                raise KeyError(approval_id)
            if row['actor'] != str(actor):
                raise PermissionError('This approval belongs to another actor')
            state = row['state']
            if state == 'pending':
                state = 'expired' if timestamp(now) >= timestamp(row['expires_at']) else ('denied' if choice == 'deny' else 'approved')
                db.execute('UPDATE approvals SET state=? WHERE id=?',(state,approval_id))
                return {'state':state, 'may_execute':state == 'approved'}
            return {'state':state,'may_execute':False}

    def settle(self, aid, reason):
        state = {'timeout':'expired','interrupted':'cancelled','notify_failed':'cancelled','deny':'denied'}.get(reason, reason)
        if state not in ('expired','cancelled','denied','approved'):
            state = 'cancelled'
        with self.store.transaction() as db:
            db.execute("UPDATE approvals SET state=? WHERE id=? AND state='pending'",(state,aid))
        return self.get(aid)

    def get(self, aid):
        rows = self.store.rows('SELECT * FROM approvals WHERE id=?',(aid,))
        return rows[0] if rows else None

    def finish(self, aid, execution):
        if execution.get('status') not in ('succeeded','failed','uncertain'):
            raise ValueError('Execution outcome required')
        with self.store.transaction() as db:
            row = db.execute('SELECT state FROM approvals WHERE id=?',(aid,)).fetchone()
            if not row or row['state'] not in ('approved','executing'):
                raise ValueError('Execution was not authorized')
            db.execute('UPDATE approvals SET state=?,result=? WHERE id=?',(execution['status'],canonical(execution),aid))
        return self.get(aid)

    def cancel_pending(self, reason):
        with self.store.transaction() as db:
            db.execute("UPDATE approvals SET state='cancelled',result=? WHERE state='pending'", (canonical({'reason':reason}),))
            db.execute("UPDATE approvals SET state='uncertain',result=? WHERE state IN ('approved','executing')", (canonical({'reason':'Execution outcome was not recorded before restart'}),))

    @staticmethod
    def text(state):
        return {'expired':'This request expired. The action was not run. Nothing is waiting for your approval.',
                'cancelled':'This request was cancelled. It is no longer waiting for your approval.',
                'denied':'You declined this request. The action was not run.',
                'approved':'You approved this action. Its result has not been confirmed yet.',
                'succeeded':'The approved action completed successfully.',
                'failed':'The approved action failed.',
                'uncertain':'I cannot confirm whether this action completed. I will not repeat it automatically.'}.get(state,'This request is awaiting your approval.')
