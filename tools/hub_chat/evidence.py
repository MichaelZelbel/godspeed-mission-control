"""Operation evidence is taken from tool results, never from an assistant's prose."""
import json
import re
from .contracts import canonical, fingerprint, utcnow

SUCCESS = re.compile(r'\b(passed|successfully|completed|fixed|deployed|deleted|removed|published|sent|verified|bestanden|erfolgreich|erledigt|behoben|gelöscht|veröffentlicht)\b',re.I)


def collect(store,conversation,messages):
    calls={}
    evidence={}
    for message in messages:
        for call in message.get('tool_calls') or []:
            calls[call.get('id')]=call.get('function') or {}
        if message.get('role')!='tool': continue
        cid=message.get('tool_call_id')
        if not cid or cid not in calls: continue
        call=calls[cid]; raw=message.get('content')
        try: body=json.loads(raw) if isinstance(raw,str) else raw
        except (ValueError,TypeError): body=None
        status='unknown'
        if isinstance(body,dict):
            code=body.get('exit_code',body.get('returncode'))
            if body.get('error') or body.get('blocked') or body.get('denied'): status='failed'
            elif isinstance(code,int) and not isinstance(code,bool): status='succeeded' if code==0 else 'failed'
            elif body.get('success') is True: status='succeeded'
            elif body.get('success') is False: status='failed'
        if isinstance(raw,str) and re.search(r'\b(BLOCKED:|not approved|timed out without user|permission denied)\b',raw,re.I):
            status='failed'
        operation=call.get('name','tool')
        # Store identity and outcome, not raw terminal output or credentials.
        record={'id':cid,'operation':operation,'status':status,'arguments_hash':fingerprint(call.get('arguments',''))}
        try:
            arguments=json.loads(call.get('arguments','{}'))
            if isinstance(arguments,dict) and isinstance(arguments.get('command'),str):
                record['command_hash']=fingerprint(arguments['command'])
        except (TypeError,ValueError): pass
        with store.transaction() as db:
            db.execute('INSERT OR REPLACE INTO evidence VALUES(?,?,?,?,?,?)',
                       (cid,conversation,operation,status,canonical(record),utcnow()))
        evidence[cid]=record
    return evidence


def validate_answer(text,evidence,language='en'):
    """Structured result claims require explicit successful tool identities.

    Free prose remains available for ordinary questions. If it contains an operation
    success claim after tool use, require the structured form instead of guessing
    which successful or failed call it refers to.
    """
    failure=('Ich konnte das Ergebnis nicht bestätigen. Ein erforderlicher Schritt wurde nicht erfolgreich überprüft.'
             if language=='de' else 'I could not confirm the result. A required step has not been verified successfully.')
    try: answer=json.loads(text)
    except (ValueError,TypeError): answer=None
    if isinstance(answer,dict) and 'claims' in answer:
        if set(answer)-{'answer','claims'} or not isinstance(answer['claims'],list): return failure
        plain=answer.get('answer','')
        if not isinstance(plain,str) or SUCCESS.search(plain): return failure
        rendered=[plain] if plain else []
        for claim in answer['claims']:
            if not isinstance(claim,dict) or set(claim)!={'text','evidence_ids'}: return failure
            ids=claim['evidence_ids']
            if not isinstance(ids,list) or not ids or any(evidence.get(cid,{}).get('status')!='succeeded' for cid in ids): return failure
            if not isinstance(claim['text'],str): return failure
            rendered.append(claim['text'])
        return '\n\n'.join(rendered) or failure
    if evidence and SUCCESS.search(text or ''): return failure
    return text


INSTRUCTION = '''For operation results, return JSON with "answer" (explanation only, no success claim) and "claims".
Each claim has "text" and "evidence_ids" containing the exact tool_call_id of each successful operation that proves it.
A command exit code proves that command's result only; it does not prove deployment, delivery, or task completion.
Failed, denied, timed-out, and missing results never prove success. If no operation result is claimed, use ordinary prose.
Keep this schema and tool identifiers out of the visible answer; the gateway renders the validated text.'''
