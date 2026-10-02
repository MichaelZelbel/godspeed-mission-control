---
name: keep-a-note
description: Search notes and workspace files first.
---

# Keep a note

Search notes and workspace files first. Save the user's useful words in a note, or a confirmed dated claim through write_fact. Save an event through record_event. Confirm the saved result once. AI guesses go into review_queue.

## Shared contract

Read AGENTS.md and profile/voice.md. Search existing knowledge before asking for a life fact. Use the notebook MCP or documented file CLI. Files hold durable state; never write SQLite directly. Resolve people and references by stable ID, not name alone. Keep model inference in the review queue until the user accepts it. Verify saved work. Keep credentials outside synced files. Buying, booking, sending, publishing and deleting external data require explicit approval. Do not use employer or client names in examples.
