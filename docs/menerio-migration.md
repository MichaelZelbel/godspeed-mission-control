# Copy a Menerio account into Godspeed Mission Control

The server now exposes **Settings → Import from Menerio** at `/dashboard/settings/import`. It can preview an administrator-provided verified copy, use a privately configured connection, or make a fresh copy using a project address, personal Menerio API key and Supabase account token entered in the form. Form credentials are transient and are not saved. No browser request accepts a filesystem path. The owner must be signed in; paired devices cannot start the import.

Copying and staging run in a worker, with resumable screen progress. A server restart marks an interrupted job for a new preview. The preview reports missing active/trashed notes, contacts, attachments, existing items retained and unsupported table counts. Import requires the explicit add-content action. It backs up knowledge and media, keeps every existing matching record, preserves source IDs and timestamps, resolves relationships against retained identities, refuses media collisions and changed import plans, and never replaces authentication or AI configuration. Imported schedules are paused. Supported records are committed through the existing durable transaction mechanism; sanitized source-only features remain in the private staging archive. Repeating an import adds no duplicate records or media. Other writes and automatic sync pause during application.

Private server configuration lives at `.godspeed/menerio-import/config.json`, with `bundle` pointing to a verified source directory inside the installation or optional `credentials` containing the trusted source connection. Configuration, staged copies, job receipts and backups are outside synced knowledge and AI context. The shipped package includes no personal data or credentials; Michael's test server has its own separately staged copy. Account copies on the test installation are not applied until the owner selects **Import this copy**.

This is a source-database migration, not a GitHub vault import. It identifies the connected account from its active personal API key, reads every owned public base table, follows ownership through foreign keys for child tables, and copies owned or referenced storage objects. SQL uses Supabase's dedicated read-only endpoint. The source account is never changed.

Copy, verification and staging are separate operations. Neither copy nor stage connects a provider, enables synchronization, activates imported connections, or replaces a running workspace. Existing destinations are refused. An interrupted incomplete copy may resume after each completed table passes its original count, fingerprint and local file checks.

Load the existing protected secrets into the process environment. Required variable names are `SUPABASE_ACCESS_TOKEN` and `MENERIO_API_KEY`. Never put their values in arguments, logs, the migration bundle, or a repository.

From the repository root:

```powershell
node notebook/scripts/migrate-menerio.mjs copy --project SOURCE_PROJECT_REFERENCE --output C:/Users/USER/Private-Migration-Copy
node notebook/scripts/migrate-menerio.mjs verify --input C:/Users/USER/Private-Migration-Copy
node notebook/scripts/migrate-menerio.mjs stage --input C:/Users/USER/Private-Migration-Copy --output C:/Users/USER/Private-Migrated-Notebook
```

To recover an interrupted copy, repeat its exact project and output arguments and add `--resume true`. Never resume a completed copy or reuse another account's destination. Changing source fingerprints require a fresh copy instead of silently mixing versions.

Every table is read past the first page. Counts and stable fingerprints are checked before and after its pages; all fingerprints are checked again before completion. Large tables use larger pages. Downloaded media sizes are checked against storage metadata and SHA-256 hashes protect all copied files. Verification refuses incomplete or damaged copies. IDs, note contents, timestamps, trashed notes, and supported relationships remain intact in the staged notebook.

The staged notebook keeps a sanitized source archive and a migration report under its private `.godspeed` directory. Data from source-only features stays in that archive with explicit table counts. In particular, the graph screen is not available in this test installation: graph links and text chunks are retained in the archive rather than represented as hundreds of thousands of individual notebook files. Authentication records, credentials and generated access/quota telemetry are excluded. Embeddings and search vectors are derived caches and can be rebuilt. Imported connection configurations remain archived and inactive.

Browser-only drafts and local chat histories require a separate browser export; they are not present in the source database. External websites referenced in notes are not copied. A PDF's original binary is copied, but encrypted or scanned PDFs need separate document processing before chat analysis.

For the rehearsal, compare the staged note IDs, complete content and trash counts to the verified source bundle. Start the staged notebook on an unused local port and query its index before any server switch. The eventual server switch must back up its current workspace and media, install the verified staged copy, and verify counts and media again. Keep the previous workspace for rollback. No automatic server switch is part of this script.

Primary interface documentation: [Supabase read-only SQL](https://supabase.com/docs/reference/api/v1-read-only-query), [storage downloads](https://supabase.com/docs/guides/storage/serving/downloads), and [API key types](https://supabase.com/docs/guides/api/api-keys).

Rehearsal completed on 2026-10-03: copied 160,288 source rows across 84 owned tables and 40 media objects. Staged 1,719 notes, including 417 trashed notes, and 294 active contacts. Every note ID, title, complete content, tags and trash state matched the source copy; every media hash matched. The isolated notebook started and queried all notes, with no broken canonical references. Two historical references to unavailable source people are preserved using hidden, unnamed removed-contact records. Those records do not add invented personal facts or active contacts.

Imported on the test server on 2026-10-05 from a fresh copy (161,659 source rows; 1,753 notes, 294 contacts, 215 moments, 41 attachments), through **Import this copy**. Every source note and contact is present by ID, no ID appears twice, every attachment hash matches, and all 6,258 records already there are unchanged.

The importer keeps an existing record with a matching ID. On that server 272 notes and 271 contacts had arrived earlier through the GitHub vault export, which drops wikilink-only lines and most Menerio fields (merges, relationship labels, folders, trash state), and some were older than the account. They were replaced afterwards with the Menerio records under the same IDs and uids, so every link still resolves and each earlier version stays in record history. The importer itself does not do this yet: an installation that imported the vault export first keeps those lossier copies.

A vault this size (15,900 records) made note saves slow until the notebook kept its whole read cache, stopped re-reading the vault after its own writes and for bursts of dashboard reads, and synchronization stopped trading empty merge commits with another device. Source-only graph links and document chunks remain in the private archive until their screens and search indexing support an import.
