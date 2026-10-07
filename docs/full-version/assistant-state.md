# Native assistant state contract

The notebook already saves user state as files. The pinned native assistant also
uses SQLite for conversations, tool execution metadata and its own work queue.
Those databases must not become a second authoritative store.

Candidate Python processes alone load `sitecustomize.py` from the packaged
`notebook/assistant-files` directory. Activation requires an explicit workspace,
isolated assistant home, Node executable and publisher. It never modifies an
installed Python runtime or the default assistant profile. Connections outside
that isolated home, in-memory databases and read-only connections are untouched.

Each isolated assistant home receives a random profile ID. A portable logical
JSON snapshot under `assistant-state/<profile-id>/` preserves ordinary tables,
column names, exact values, SQLite schema version and sequence high-water marks.
FTS tables and their shadows are disposable. Binary cells use explicit base64.
SQLite is rebuilt from these files, including after database deletion. The native
assistant rebuilds its own FTS indexes. Distinct devices keep distinct profiles;
their integer message IDs therefore do not collide. Restored profiles remain
readable as files, and selecting a previous profile is an explicit device choice.

Before SQLite acknowledges a write, the publisher acquires the notebook workspace
lock, checks the previous file hash and publishes the logical snapshot plus the
previous immutable version through the notebook recovery journal. A failure
rolls back the SQLite transaction. A crash after publishing but before committing
SQLite recovers forward from the authoritative file. An externally edited or
synced snapshot replaces the disposable database at the next transaction; a
concurrent file edit retains base/local/remote in the normal conflict queue and
refuses to overwrite it. An assistant transaction is a whole-file conflict, not
a silent row merge.

Since 6 October 2026 the database file (format 2) holds the schema and a list of
parts; each table's rows live in part files of 32 row ids beside it
(`assistant-state/<profile-id>/<file>/<table>-<n>.json`). Temporary triggers note
which parts a transaction changed, and a save publishes only those parts and the
updated list. A schema change, or a write SQLite does not count, rereads every
table. Format 1, one file holding every row, is still read and becomes format 2
at its next save. On a working server format 1 rewrote 35 MB for each message
and kept a compressed copy of every version, 6.8 GB in all. A conflict keeps both
sides whole, as format 1, so either can be chosen. The history keeps versions of
the changed parts only; once a day versions older than 30 days are removed,
keeping the newest five of each file.

Native credentials and account configuration remain private device files.
They are never included in the logical SQL snapshots by configuration copying.
The notebook owns scheduled Mission Control work; native assistant conversation
state does not transfer schedule ownership.

After restoring knowledge on a new device, `godspeed assistant profiles` lists
the available native histories. `godspeed assistant select <profile-id>` selects
one in the configured isolated assistant home, before its first use. It refuses
to change a home that already contains database caches. This makes restored
history usable without copying credentials or silently merging device profiles.
