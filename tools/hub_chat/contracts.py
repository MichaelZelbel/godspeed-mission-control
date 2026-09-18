from dataclasses import dataclass, asdict
from datetime import datetime, timezone
import hashlib
import json


def utcnow():
    return datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')


def timestamp(value):
    parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if parsed.tzinfo is None:
        raise ValueError('A timezone is required')
    return parsed


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def fingerprint(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


@dataclass(frozen=True)
class Fact:
    item_id: str
    source: str
    revision: str
    status: str
    checked_at: str
    kind: str
    subject: str
    consequence: str = ''
    next_action: str = ''
    link: str | None = None
    deadline: str | None = None

    @classmethod
    def parse(cls, row):
        fact = cls(**{k: v for k, v in row.items() if k in cls.__dataclass_fields__})
        if fact.status not in ('open', 'done', 'unknown') or fact.kind not in ('decision', 'task', 'report', 'failure'):
            raise ValueError('Invalid fact state or kind')
        if not all(isinstance(getattr(fact, k), str) and getattr(fact, k) for k in ('item_id', 'source', 'revision', 'checked_at', 'subject')):
            raise ValueError('Missing fact identity')
        timestamp(fact.checked_at)
        if fact.link and not fact.link.startswith('https://'):
            raise ValueError('Expected an HTTPS link')
        return fact


@dataclass(frozen=True)
class Draft:
    delivery_key: str
    conversation_id: str
    output_class: str
    text: str
    item_revisions: tuple[tuple[str, str], ...] = ()
    evidence_ids: tuple[str, ...] = ()

    @classmethod
    def parse(cls, row):
        return cls(**dict(row, item_revisions=tuple(tuple(x) for x in row.get('item_revisions', ())), evidence_ids=tuple(row.get('evidence_ids', ()))))


@dataclass(frozen=True)
class Receipt:
    delivery_key: str
    state: str
    message_id: str | None = None
    sent_at: str | None = None


@dataclass(frozen=True)
class ReplyContext:
    messages: tuple[Draft, ...]
    facts: tuple[Fact, ...]
    ambiguous: bool
