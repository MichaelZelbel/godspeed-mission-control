"""Selection and deterministic fallback wording. No urgency inferred from a queue."""
from datetime import datetime
from zoneinfo import ZoneInfo
from .contracts import Draft, fingerprint, timestamp

ALLOWED = frozenset(('reply','digest','question','approval','approval_result','requested_result','critical_failure'))


def select(facts, purpose, now):
    timestamp(now)
    return [f for f in facts if f.status == 'open' and f.next_action.strip() and
            (f.kind != 'failure' or purpose == 'critical_failure')]


def check(draft, facts, evidence):
    errors = []
    if draft.output_class not in ALLOWED:
        errors.append('Internal or unclassified output')
    if not draft.text.strip() or not draft.conversation_id:
        errors.append('Missing content or recipient')
    by_id = {f.item_id: f for f in facts}
    for item_id, revision in draft.item_revisions:
        f = by_id.get(item_id)
        if not f or f.status != 'open' or f.revision != revision:
            errors.append('Source changed or could not be checked')
        elif f.link and f.link not in draft.text:
            errors.append('Missing source link')
    successes = {e['id'] for e in evidence if e.get('status') == 'succeeded'}
    if any(e not in successes for e in draft.evidence_ids):
        errors.append('Unsupported result claim')
    return errors


def compose(facts, conversation_id, now, timezone='UTC', language='en', purpose='digest'):
    chosen = sorted(select(facts, purpose, now),key=lambda f:(f.deadline or '9999',f.item_id))
    if not chosen:
        return None
    date = timestamp(now).astimezone(ZoneInfo(timezone)).date()
    parts, included = [], []
    for f in chosen:
        lines = [f.subject.rstrip('. ') + '.']
        if f.deadline:
            deadline = datetime.fromisoformat(f.deadline).date()
            days = (deadline-date).days
            if language == 'de':
                lines.append(f'Die Frist war am {deadline}.' if days < 0 else f'Die Frist ist am {deadline}.')
            else:
                lines.append(f'The deadline was {deadline}.' if days < 0 else f'The deadline is {deadline}.')
        if f.consequence:
            lines.append(f.consequence.rstrip('. ') + '.')
        lines.append(f.next_action)
        if f.link:
            lines.append(f.link)
        part = '\n'.join(lines)
        if len(part.encode('utf-16-le'))//2 > 3500:
            continue  # Do not truncate an action or its link into a different meaning.
        if len(('\n\n'.join(parts+[part])).encode('utf-16-le'))//2 > 3500:
            break
        parts.append(part)
        included.append(f)
    chosen = included
    if not parts:
        return None
    revisions = tuple((f.item_id, f.revision) for f in chosen)
    text = '\n\n'.join(parts)
    key = fingerprint([conversation_id, purpose, str(date), revisions, text])
    return Draft(key, conversation_id, purpose, text, revisions)
