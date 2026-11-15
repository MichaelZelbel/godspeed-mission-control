# Briefing verifier AI

This loopback-only OpenAI-compatible server lets a black-box verifier supply the distinct prepared
AI replies its cases require without putting those private replies in the repository.

Create a response plan outside the checkout. Its keys are the `kind` values sent by the briefing
pipeline. A value may be one reply or an array of replies. Array replies are served in order; the
last reply is then repeated. Object replies are encoded as JSON text for checks such as
`brief-verification`.

```json
{
  "morning-brief": ["first prepared draft", "second prepared draft"],
  "brief-verification": {
    "passed": false,
    "reason": "prepared reason",
    "rejection_scope": "source",
    "rejected_source_ids": ["prepared-source-id"]
  }
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
to the result log, and the setup stops on the first non-success response.
