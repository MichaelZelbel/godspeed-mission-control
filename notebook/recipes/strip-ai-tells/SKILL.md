---
name: strip-ai-tells
description: Read the user's own voice rules.
---

# Strip ai tells

Read the user's own voice rules. Remove filler, unsupported claims and stock AI phrasing without changing meaning. Preserve real stories and uncertainty. Show a draft before writing in the user's name externally.

## Shared contract

Read AGENTS.md and profile/voice.md. Search existing knowledge before asking for a life fact. Use the notebook MCP or documented file CLI. Files hold durable state; never write SQLite directly. Resolve people and references by stable ID, not name alone. Keep model inference in the review queue until the user accepts it. Verify saved work. Keep credentials outside synced files. Buying, booking, sending, publishing and deleting external data require explicit approval. Do not use employer or client names in examples.
