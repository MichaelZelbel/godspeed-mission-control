# ADR-001: File-authoritative notebook and isolated full candidates

Status: Accepted within Michael's implementation authorization, 2 October 2026.

## Context

Windows and VPS must use the same record service, preserve direct assistant edits and work without a cloud database. Existing installations remain unchanged. The upstream notebook is AGPL-3.0; copied components retain that license and attribution. The surrounding original kit retains its existing license.

## Decision

Narrative records use Markdown with JSON frontmatter (valid YAML); structured records use JSON. A record has format version, immutable identity UUID, readable ID, type, aliases, revision and timestamps. IDs inherited from imports stay unchanged. Display-name changes do not rename records. New offline records use a readable slug plus a device identity suffix, avoiding ambiguous allocation of the same bare slug on disconnected devices. Imports retain source ID mapping in records.

All durable state, including review, jobs, schema, settings, receipts and conflicts, lives in files. SQLite only holds derived search documents. Binary media and credentials live outside the synced workspace. A full startup scan and periodic reconciliation repair missed watcher events.

A single workspace lock protects writers. A transaction directory records staged after-images and before-images, followed by a durable prepared marker. Recovery completes prepared transactions before opening the service. Validation runs against the whole proposed state before preparation. Incomplete transactions without a prepared marker are not published. Readers use the lock for structural changes; outside edits are validated on the next scan.

Structural changes retain tombstones and aliases. Stable UUID references disambiguate readable aliases. Merge rewrites known typed references and preserves provenance. Unresolved or ambiguous references stop sync. World events remain append-only. Replacing a current claim closes its validity and creates a successor rather than erasing the old fact.

Git sync stages only declared record roots and never databases, media or credentials. Separate file changes merge; same-record conflicts preserve base/local/remote snapshots in files outside ordinary record parsing. Conflicts stop publication until explicitly resolved. No force push. A rejection is fetched and retried with the same graph validation.

The scheduler owner is explicit. Pairing sets the VPS owner; an unreachable VPS never transfers ownership. Jobs record attempted and verified outcomes and fail closed for outward actions without permission. Provider credentials are optional local configuration, never synced.

Amended 2026-10-05: records a person reads (notes, people, groups, facts, moments, collections and their items) are Markdown files named after their titles, in readable folders, with plain YAML frontmatter, and the rest is JSON in `notebook/_system/`. Identity stays in the file (`id`, `uid`), never in its name, so a display-name change now renames the file but still not the record. Sync merges renamed records by UUID. See `file-format.md` and `sync-contract.md`.

## Alternatives and consequences

PowerSync or Supabase would preserve upstream calls but violate the authoritative-file requirement. Rewriting every screen immediately risks losing behavior. Reuse the current screens with a local protocol adapter, then replace coupled cloud processing with typed domain functions. The adapter must implement the observed query semantics and may never claim success for unknown operations.

Readable slugs alone cannot identify simultaneous disconnected creation. Device suffixes trade prettier names for guaranteed provenance; imported slugs remain compatible through aliases. A Git commit alone cannot make multiple live writes atomic, so transaction recovery is independent of Git.

Candidate packages pin exact repository commits and runtime hashes. Separate Windows AppId, directories, tasks and ports, and a separate VPS Compose project protect production. Stable publication and live migration still need explicit approval.
