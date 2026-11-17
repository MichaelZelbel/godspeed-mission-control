# Saved briefing holdout inputs

These are complete public-route inputs for H-04, H-05, H-06, and H-18. Each plan starts with source
facts, runs the real `morning-brief` job through the same public routes as Settings, asserts the
produced note and exact visible replies, and retains every public request and response. H-04 drives
both drafts through refusal and observes the grounded fallback. H-18 captures the exact stored
no-Challenge result, requires both supported public chat routes to return it byte for byte, and
proves retrieval saved no substitute briefing. The bounded AI plan fails an unexpected call instead
of inventing a substitute.

From the repository root, choose free ports as `harness/RUNTIME.md` requires. Start the AI once:

```sh
mkdir -p "$EVIDENCE"
node notebook/scripts/brief-verifier-ai.mjs "$AI_PORT" \
  notebook/scripts/brief-verifier-plans/ai.json "$EVIDENCE/ai-requests.jsonl" &
AI_PID=$!
export BRIEF_VERIFIER_AI_URL="http://127.0.0.1:$AI_PORT/v1"
```

For each file below, start the notebook with a fresh workspace and free `NOTEBOOK_PORT`, then run:

```sh
node notebook/scripts/brief-verifier-setup.mjs "http://127.0.0.1:$NOTEBOOK_PORT" \
  notebook/scripts/brief-verifier-plans/h04-chat-first.json "$EVIDENCE/h04-public.jsonl"
node notebook/scripts/brief-verifier-setup.mjs "http://127.0.0.1:$NOTEBOOK_PORT" \
  notebook/scripts/brief-verifier-plans/h05-filtered-surfaces.json "$EVIDENCE/h05-public.jsonl"
node notebook/scripts/brief-verifier-setup.mjs "http://127.0.0.1:$NOTEBOOK_PORT" \
  notebook/scripts/brief-verifier-plans/h06-challenge.json "$EVIDENCE/h06-public.jsonl"
node notebook/scripts/brief-verifier-setup.mjs "http://127.0.0.1:$NOTEBOOK_PORT" \
  notebook/scripts/brief-verifier-plans/h18-no-challenge.json "$EVIDENCE/h18-public.jsonl"
```

Stop only the recorded notebook PID between journeys, and stop `AI_PID` after H-18. Retain the four
public logs, AI log, notebook logs, and exact head. All saved requests must bypass AI, so redrafting
produces an unmatched failure or extra AI record.
