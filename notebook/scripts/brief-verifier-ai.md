# Briefing verifier AI

This loopback-only OpenAI-compatible server lets a black-box verifier supply the distinct prepared
AI replies its cases require without putting those private replies in the repository.

Create a response plan outside the checkout. For a simple case, its keys are the `kind` values sent
by the briefing pipeline. A value may be one reply or an array of replies. Array replies are served
in order; the last reply is then repeated. For cases that need different replies within one kind,
use an ordered `responses` array. Each entry matches a partial copy of the JSON request, may be used
`times`, and is then exhausted. Object replies are encoded as JSON text for checks such as
`brief-verification`.

```json
{
  "responses": [
    {"name": "first draft", "match": {"kind": "morning-brief", "phase": "write"}, "reply": "first prepared draft"},
    {"name": "rewrite", "match": {"kind": "morning-brief", "phase": "one-rewrite"}, "reply": "second prepared draft"},
    {"name": "source refusal", "match": {"kind": "brief-verification", "check": "source-facts"}, "reply": {"passed": false, "reason": "prepared reason", "rejection_scope": "source-claims", "rejected_source_ids": ["prepared-source-id"]}}
  ]
}
```

Start it on a free port and keep its request record in the verifier's evidence folder:

```sh
node notebook/scripts/brief-verifier-ai.mjs 43123 /path/to/response-plan.json /path/to/requests.jsonl
```

Connect Settings to `http://127.0.0.1:43123/v1` with any non-empty key and model name. The server
binds only to loopback. A missing planned reply returns HTTP 500 instead of silently inventing one.

When a verifier also needs prepared notebook state, it can keep its private public-API setup in a
JSON array and execute it against a running loopback notebook:

```json
[
  {
    "name": "connect the prepared AI",
    "path": "/api/provider",
    "body": {"url": "http://127.0.0.1:43123/v1", "key": "stand-in", "model": "stand-in", "routines": true}
  },
  {
    "name": "insert a prepared row through the notebook",
    "path": "/api/query",
    "body": {"table": "notes", "operation": "insert", "values": {"title": "Prepared fact", "content": "Verifier-owned content"}}
  }
]
```

```sh
node notebook/scripts/brief-verifier-setup.mjs http://127.0.0.1:3000 /path/to/setup-plan.json /path/to/setup-results.jsonl
```

Only loopback notebook addresses and public `/api/` routes are accepted. Every response is written
to the result log. A step may set `expect.status`, `expect.body_includes`, or `expect.json` (a map of
dotted response paths to exact values). It may also set `capture` to a map of names to dotted JSON
paths. Later request bodies and expectations can use captured values as `{{name}}`. The setup stops
on the first mismatch, so a verifier can retain proof that the voice rule, refusal, Challenge start,
saved briefing, and each public chat request actually completed.
