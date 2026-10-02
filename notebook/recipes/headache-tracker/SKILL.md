---
name: headache-tracker
description: Record what the user said in health_episodes and medications, without guessing pain or dosage.
---

# Headache tracker

Record what the user said in health_episodes and medications, without guessing pain or dosage. Keep onset, end, symptoms, reported triggers and medicine times. Corrections retain prior versions. Count distinct medication days in the requested timezone. Offer patterns, not diagnosis.

## Shared contract

Read AGENTS.md and profile/voice.md. Search existing knowledge before asking for a life fact. Use the notebook MCP or documented file CLI. Files hold durable state; never write SQLite directly. Resolve people and references by stable ID, not name alone. Keep model inference in the review queue until the user accepts it. Verify saved work. Keep credentials outside synced files. Buying, booking, sending, publishing and deleting external data require explicit approval. Do not use employer or client names in examples.
