"""Finite classification from observed screen dependencies and packaged runtime operations."""
import json,pathlib
root=pathlib.Path(__file__).resolve().parents[2];out=root/'docs/full-version'
source=json.loads((out/'source-inventory.json').read_text());procedures=json.loads((root/'notebook/data/procedure-inventory.json').read_text());recipes=json.loads((root/'notebook/data/recipe-inventory.json').read_text())
tables=sorted({t for d in source['dependencies'] for t in d['tables']});functions=sorted({f for d in source['dependencies'] for f in d['functions']})
deferred={'get-graph-data','backfill-wikilinks','enrich-person-from-lexicon','wiki-ingest'}
cloud={'delete-my-account','ensure-token-allowance','moderate-content'}
connectors={'gdrive-proxy','gdrive-sync','github-import-vault','github-people-sync','github-proxy','github-sync-export','github-sync-pull','send-patch'}
rows=[]
for p in source['pages']:
 rows.append(dict(kind='screen',name=p,classification='superseded' if p in ['Dashboard','Settings'] else 'included',reason='Integrated control desk: own runtime, privacy, keys, schedules, optional connectors, sync, pairing and recovery.' if p in ['Dashboard','Settings'] else 'Reused upstream screen connected to file-backed APIs.',evidence='UI walkthrough and HTTP/domain fixtures; candidate verification report states the tested actions.'))
for t in tables:
 if t.startswith('wiki_'):classification,reason='deferred','Permitted lexicon deferral; existing imported records remain preservable.'
 elif t=='note-attachments':classification,reason='superseded','Storage bucket is the SHA-checked local media service, not a record table.'
 elif t in ['user_roles','v_ai_allowance_current','mcp_api_tokens']:classification,reason='superseded','Cloud roles and billing are unnecessary for a single owner; API keys are hash-only device files.'
 elif t.endswith('_connections') or t in ['user_mcp_servers','connected_apps']:classification,reason='optional connector','Connection credentials and configuration belong to the device, outside synced user records. Connector source/setup is packaged; activate your own accounts.'
 elif t in ['world_entities','world_claims','world_events','profile_facts']:classification,reason='included','Derived directly from dated source claims, relationships, entities and append-only events; no second authoritative database.'
 else:classification,reason='included','Structured files preserve full record values, stable IDs, typed references and prior revisions; Markdown note bodies remain readable.'
 rows.append(dict(kind='domain',name=t,classification=classification,reason=reason,evidence='records, domains, parity, acceptance and closure fixtures; views are read-only.'))
for f in functions:
 classification='deferred' if f in deferred else 'superseded' if f in cloud else 'optional connector' if f in connectors else 'included'
 reason='Permitted lexicon/note graph deferral.' if f in deferred else 'Local owner and own-provider policy replaces cloud account deletion, credit allowance and platform moderation.' if f in cloud else 'Private file reconciler or explicitly configured provider connector; no credential seeds and no automatic outward action.' if f in connectors else 'File-backed processing saves actual results or review proposals; model errors remain visible and do not produce fabricated completion.'
 rows.append(dict(kind='function',name=f,classification=classification,reason=reason,evidence='core/domains.mjs, connectors.mjs, api-keys.mjs; domain/HTTP fixtures plus real model and image fixture.'))
rows += [dict(kind='procedure',**p,evidence='Shared scheduler/receipts and packaged procedure dispatcher; actual health, disk, ownership, uncertain delivery and connector fixtures.') for p in procedures]
rows += [dict(kind='recipe',**r,evidence='Portable SKILL.md; concrete public coach, journal, phone and video sources under third-party/addons.') for r in recipes]
assert {r['name'] for r in rows if r['kind']=='procedure'}==set(source['job_ids'])
assert {r['name'] for r in rows if r['kind']=='recipe'}=={r['name'] for r in source['skills']}
(out/'capability-matrix.json').write_text(json.dumps({'format':1,'items':rows},indent=2)+'\n')
lines=['# Capability inventory','','Every traced screen, domain, processing function, personal schedule and recipe has an explicit classification. Included means implemented in the candidate; optional means account/tool configuration is required. This matrix does not assert live-account verification. Lexicon and note graph are the only feature deferrals.','','See verification.md for concrete evidence and the user-only trial boundary. Full source dependency evidence is source-inventory.json.']
for kind in ['screen','domain','function','procedure','recipe']:
 lines+=['','## '+kind.capitalize()+'s','','| Item | Classification | Implementation and reason |','| --- | --- | --- |']
 lines += ['| '+r['name']+' | '+r['classification']+' | '+r['reason'].replace('|','/')+' |' for r in rows if r['kind']==kind]
lines+=['','## Activation and boundaries','','All knowledge is local files. Optional provider calls, read-only accounts, phone/video toolchains and browser posting require the owner\'s configuration. Company desks and specialist enterprise systems are separately owned. Starter procedures are portable versions, not copies of personal incident histories. Existing production, live data and stable channels are untouched.']
(out/'capabilities.md').write_text('\n'.join(lines)+'\n')
print(json.dumps({k:sum(r['kind']==k for r in rows) for k in ['screen','domain','function','procedure','recipe']}))
