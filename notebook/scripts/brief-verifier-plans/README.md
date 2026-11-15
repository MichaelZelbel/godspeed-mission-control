# Saved briefing holdout inputs

These are complete public-route inputs for H-04, H-05, H-06, and H-18. Each plan asserts the exact
visible replies and retains every public request and response. The bounded AI plan fails an
unexpected call instead of inventing a substitute.

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
public logs, AI log, notebook logs, and exact head. Only H-04 may call ordinary chat before save;
all saved requests must bypass AI, so redrafting produces an unmatched failure or extra AI record.
