from dataclasses import replace
from .contracts import Fact


class Sources:
    def __init__(self, store):
        self.store = store
        self.adapters = {}

    def register(self, name, adapter):
        self.adapters[name] = adapter

    def refresh(self, item_ids, now):
        found = {}
        wanted = set(item_ids)
        for name, adapter in self.adapters.items():
            relevant = [i for i in item_ids if not self.store.item(i) or self.store.item(i)['source'] == name]
            if not relevant:
                continue
            try:
                rows = adapter(relevant, now)
                validated = []
                seen=set()
                for row in rows:
                    fact = Fact.parse(row)
                    if fact.item_id not in wanted or fact.source != name or fact.item_id in found or fact.item_id in seen:
                        raise ValueError('Source returned an unexpected item')
                    seen.add(fact.item_id)
                    validated.append((fact, row.get('reopens_revision')))
                for fact, reopened in validated:
                    self.store.put_fact(fact, reopened)
                    current = self.store.item(fact.item_id)
                    found[fact.item_id] = fact if fact.status == 'unknown' else Fact.parse(current)
            except Exception as exc:
                self.store.audit('source_error', f'{name}: {type(exc).__name__}')
        result = []
        for item_id in item_ids:
            if item_id in found:
                result.append(found[item_id])
            else:
                previous = self.store.item(item_id)
                if previous:
                    result.append(replace(Fact.parse(previous), status='unknown', checked_at=now))
                else:
                    result.append(Fact(item_id, 'unavailable', 'unknown', 'unknown', now, 'task', 'Unverified item'))
        return result
