---
name: mc-brief-operations
description: Read current goals, decisions, deadlines, recent conversations, health observations and configured source receipts.
---

# Mc brief operations

Read current goals, decisions, deadlines, recent conversations, health observations and configured source receipts. Write a short useful note with one factual health line. Missing sources remain missing. Save the exact text and delivery receipt. Sending requires an enabled delivery connector.

## Shared contract

Read AGENTS.md and profile/voice.md. Search existing knowledge before asking for a life fact. Use the notebook MCP or documented file CLI. Files hold durable state; never write SQLite directly. Resolve people and references by stable ID, not name alone. Keep model inference in the review queue until the user accepts it. Verify saved work. Keep credentials outside synced files. Buying, booking, sending, publishing and deleting external data require explicit approval. Do not use employer or client names in examples.

## Start and finish

1. Confirm the actual request, its intended result and the scope you may change. Use only visible records. Resolve ambiguous people or competing versions before editing.
2. Read the existing state through the notebook tools and the command help. Record the IDs, current revision, sources and dates needed for this result. Do not infer execution from a model reply.
3. Follow the workflow above. Save the actual deliverable and its evidence, retaining the original when changing it. Use a stable request identifier on a retry.
4. Open or read the saved result through the same installed entry point. Check it against the requested outcome, including links and referenced people. For a failed attempt retain the error and a next check; never file it as completed.
5. Confirm the outcome in one plain sentence. Stay quiet when a scheduled check finds no actionable change. Outward steps remain proposals until their exact action is approved.

## Runtime and recovery

The notebook MCP exposes search_knowledge, list_records, save_record, capture_note, personal_operation, write_fact, record_event and review_suggestions. Personal commands in chat are /goals, /work, /forecast, /due, /coach and /journal followed by their documented arguments. Consult help before guessing arguments. Jobs use one schedule owner and retained receipts. Configured-account requirements are separate from missing adapters; report a missing tool as a missing implementation. Reconnect only the selected isolated service. Never fall back to a personal installation.
