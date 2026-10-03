# Copy a Menerio account into Godspeed Mission Control

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

The running installations have not been switched to this copy. Source-only graph links and document chunks remain in the private archive until their screens and search indexing support an import.
