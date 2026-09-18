"""Migration never turns an old queue acknowledgement into a delivery receipt."""
import json
from pathlib import Path
from .contracts import Fact, utcnow, fingerprint


def import_legacy(chat,path,dry_run=False):
    rows = json.loads(Path(path).read_text(encoding='utf-8'))
    key = 'legacy:'+fingerprint(rows)
    if chat.store.rows('SELECT 1 FROM audit WHERE kind=?',(key,)):
        return {'imported':0,'already_imported':True}
    # Validate the whole input before changing state.
    facts = [Fact.parse(dict(r,checked_at=r.get('checked_at') or utcnow())) for r in rows]
    if dry_run:
        import sqlite3
        copy=sqlite3.connect(':memory:')
        copy.row_factory=sqlite3.Row
        try:
            with chat.store.lock:
                chat.store.db.backup(copy)
            for fact in facts:
                chat.store.put_fact_in(copy,fact)
        finally:
            copy.close()
        return {'would_import':len(facts),'delivery_receipts_created':0,'dry_run':True}
    with chat.store.transaction() as db:
        for fact in facts:
            chat.store.put_fact_in(db,fact)
        db.execute('INSERT INTO audit(kind,detail,created_at) VALUES(?,?,?)',
                   (key,'Imported source identities; old send marks are unconfirmed',utcnow()))
    return {'imported':len(facts),'delivery_receipts_created':0}
