# User files

The notebook is the folder `notebook/` of the mission control (it was `records/` until 2026-10-05; a workspace that still has that folder has it renamed once when it is opened, and a pending transaction written under the old name is replayed into the new one). Open `notebook/` in Obsidian, or any editor, and it reads as a notebook: every page a person reads is a Markdown file named after its title, in the folder it belongs to, with plain YAML frontmatter and its text as the body. Machine bookkeeping sits apart in one system folder, `notebook/_system/`. Menerio's vault export (`github-sync-export` and `people-vault.ts` in `MichaelZelbel/menerio`) is the model for names, folders and frontmatter fields.

## Readable pages

| Record type | Folder | File name | Body | `type:` |
| --- | --- | --- | --- | --- |
| `notes` | its own `folder_path`; `Trash/<folder_path>` when trashed | title | `content` | `note` |
| `contacts` | `People/` | name | `notes` | `person` |
| `contact_groups` | `Groups/` | name | `description` | `group` |
| `entities` | `World/` | name | `description` | `entity` |
| `claims` (facts) | `Facts/`; `Facts/Earlier/` once closed (`valid_to`) | `<attribute> - <value>` | none | `fact` |
| `moments` | `Timeline/` | `<YYYY-MM-DD> <title>` | `description` | `moment` |
| `collections` | `Collections/` | name | `description` | `collection` |
| `collection_items` | `Collections/<collection name>/` | title, else its first text value | none | `collection item` |
| `contact_topics` | `Topics/` | title | none | `topic` |
| `weekly_reviews` | `Reviews/` | `Week of <week_start>` | none | `weekly review` |

Why these: they are what the notebook shows as pages (Notes, People, Groups, Timeline, World, Collections), each with a title of its own. Folders and the field names below follow Menerio where Menerio had them (`People/`, `Groups/`, the note's own folder, `id`, `title`, `name`, `created`, `modified`, `tags`, `aliases`, `favorite`, `pinned`, `sensitive`). An item sits under its collection's name because that is how a person looks for it; renaming the collection moves its items.

The Lexicon (Menerio's wiki pages, `Lexicon/`) was retired on 8 October 2026 at Michael's request, so that every kind of record is one the notebook shows and lets its owner edit. His 296 pages, their sources and revisions were moved to `archives/notebook-lexicon-2026-10-08/` in his mission control, and an import from Menerio leaves them in its source archive.

A page looks like this:

```
---
id: 6f1c2d3e-...
type: note
title: Plan for October
created: 2026-10-05T09:12:00.000Z
modified: 2026-10-05T10:40:00.000Z
tags:
  - work
aliases: []
favorite: false
pinned: false
folder_path: Projects/2026
uid: 6f1c2d3e-...
format: 1
revision: 4
...
---
The note itself, in Markdown, with ![[photo.png]] attachment links.
```

The frontmatter starts with `id`, the friendly `type`, the type's own fields (a person's name, company, role, relationship, email, phone; a fact's attribute, value and validity), then `created`, `modified`, `tags`, `aliases`, `favorite`, `pinned` and `sensitive` (Menerio's names for `created_at`, `updated_at`, `is_favorite`, `is_pinned` and `is_sensitive`), then everything else the record holds (`uid`, `format`, `revision`, `device`, `references`, `metadata` and so on). Values are plain YAML; a text that would read as a number, a date, `yes` or anything other than itself is quoted. Every record reads back exactly as it was written.

**Identity is the frontmatter, never the file name.** `id` and `uid` say which record a file is. The store reads every Markdown file under `notebook/` at any depth and finds a record by its id wherever its file is, so references (by uid) never depend on a name.

**File names** follow Menerio: `<>:"/\|?*` are removed, runs of white space become one space, the name is trimmed and at most 200 characters, and an empty name is `Untitled`. So that every name works on Windows, macOS and Linux and in a sync repository, the name is also written in composed Unicode, has no control characters, no leading dot (a hidden file sync never carries), no trailing dot or space, a `_` after a device name Windows reserves (`CON` becomes `CON_`), and at most 200 bytes. A note's folder path is cleaned the same way, part by part; `..` and empty parts are dropped, so no folder leaves the notebook, a note never goes into the system folder (`Notes/` is put in front), and a folder named `secrets` or `node_modules`, which sync never carries, gets a `_`. Sync always carries a page, whatever its title ends in (a note called `backup.sqlite` is `backup.sqlite.md`, not a database). A name another file already has in that folder gets ` 2`, ` 3`, and names are compared as a file system that ignores case does, so `Plan.md` and `plan.md` never both exist. A folder that already exists in another letter case is used as it is spelled. A file the owner made there keeps its name; the record takes the next number.

**Renames and moves.** Changing a title renames the file, changing a note's folder moves it, trashing a note moves it to `Trash/`, closing a fact moves it to `Facts/Earlier/`. A removed record (a tombstone) and a person merged into another keep their Markdown form but leave the readable folders for `_system/<type>/<id>.md`. A file keeps its name as long as the name still fits, a number included. The old file is deleted before the new one is written, so a change of case alone works on Windows and macOS, and a folder left empty is removed.

**Editing by hand.** Editing the body or the frontmatter of a page edits the record; Obsidian's way of rewriting frontmatter (block lists, single quotes, `|` blocks) is read as well. A page renamed or moved by hand is still found by its id; the next save puts it back under its title and folder, so change the title or the folder, not the file name. A Markdown file without a `uid` in its frontmatter is the owner's own page: it is never a validation problem, never moved or renamed, keeps its name when a record wants the same one, is searched like any file and syncs as a file. A file that held a record and lost its frontmatter, or whose frontmatter has a `uid` but does not read, is reported as a problem and left untouched. Deleting a page in Obsidian deletes the record's file. Synced through a knowledge repository of its own, the next sync keeps the record as a tombstone, as the notebook's remove does; through the mission control's own repository the deletion travels as a deletion, so use the notebook's remove there to keep a tombstone that other machines and references understand.

**Attachments.** The bytes of a note's attachments stay in the device media store (`.godspeed/media`, one content-addressed file and one mapping per storage path) and travel through the authenticated media transfer, never through Git. A note links them in its body as Menerio wrote them, `![[file]]`; renaming a note or converting a workspace does not touch them.

## The system folder

`notebook/_system/<type>/<id>.json` holds every record a person does not read as a page, one JSON file per record, named by its id as before 2026-10-05. Its name does not start with a dot, because sync never carries dot folders; in an alphabetical list it sorts before the pages, as one folder apart. What goes there, and why:

- Bookkeeping: `record_history` (earlier versions), `jobs`, `job_receipts`, `command_receipts`, `work_tool_receipts`, `settings`, `import_mappings`, `approvals`, `notifications`, `connector_status`, `embeddings`, `review_queue` and its bulk jobs, AI job state (`note_ai_jobs`, `media_analysis`, `gdrive_imports` and the like), `conversation_messages` and `note_conversations`, `event_corrections`.
- Links between records: group memberships, moment participants and entities, relationships, note connections, person documents, note attachments, contact topic events. Their identity is the pair of records they join, so they have no title of their own; the pages they join are readable.
- Settings of the notebook itself: `profiles`, `profile_categories`, `fact_slots` (how facts are labelled and shown), `user_self_aliases`, `collection_templates`, suggestion preferences.
- The assistant's working records: `goals`, `decisions`, `forecasts`, `work_items`, `deadlines`, `habits`, `journal`, `coach_talks`, `health_*`, `watch_*`, `lead_*`, `radar_*`. The mission control keeps its readable form of these in its own folders (`goals/`, `work/`, `due/`, `journal/`, `coach/`, `forecasts/`).
- Any type not in the table above.

## Records

Every record carries `format`, `type`, `id`, `uid`, `revision`, `device`, `created_at`, `updated_at`, `aliases` and typed `references`. IDs and UUIDs never change during ordinary edits. `former_ids` retain the ids a record had before a rename or a merge; `aliases` are names (a person's nicknames, a note's alternative titles, as in Obsidian and Menerio) and two records may share one. Until 6 October 2026 earlier ids were written into `aliases` too; those are still found. UUID references identify the actual target. New readable IDs include eight UUID characters so offline same-name creations remain separate; imported IDs (Menerio's UUIDs) stay as they were. Collection schemas, row values, favorites, comments, review decisions, schedules and receipts are records. Profile claims close earlier validity; timeline edits append correction records. Earlier record contents are immutable snapshots under `record_history`.

The notebook validates complete reference graphs before publishing grouped edits. `.godspeed/transactions` stages durable writes, deletions of moved files included, and startup completes prepared transactions. Invalid external files remain untouched and are reported. A workspace lock prevents concurrent process writes. Edit content directly; use the record command for merges, names and removals. Remove creates a tombstone, preserving old references.

Coaching, journal, profile instructions, rules, goals, work, deadlines and recipes also use their existing readable files. Git sync includes these explicitly. Credentials, runtime settings, media binaries, SQLite and transient transaction files stay outside Git. User media is transferred separately with SHA-256 verification.

Use `node notebook/bin/godspeed.mjs` with `GODSPEED_WORKSPACE` set. `record merge <type> <source> <target>` rewrites typed references and retains provenance. `record display-name <type> <id> <name>` keeps the record's identity and renames its file. `record rename <type> <id> <new-id>` changes the id and keeps the file. `record remove <type> <id>` retains a tombstone. `validate` reports broken references and ambiguous aliases. Backup and restore include integrity manifests; restoration requires an empty destination.

## Before 2026-10-05, and converting

Until 2026-10-05 every note was `notebook/notes/<id>.md` with JSON between the `---` lines, and every other record `notebook/<type>/<id>.json`; notes imported from Menerio kept Menerio's UUID as their file name. The store still reads that layout, so an unconverted workspace keeps working, and a record moves to its readable file whenever it is saved.

`node notebook/bin/godspeed.mjs convert-notebook --dry-run` lists every file that would move or be rewritten and where to; `convert-notebook` does it. It runs under the workspace lock and refuses a notebook with validation problems. It first copies `notebook/` to `.godspeed/backups/notebook-before-readable-files-<time>/` and checks the copy byte for byte (`backup.json` lists every file with its SHA-256), moves the old one-folder-per-type folders into `_system/`, writes every record to its planned file through the recoverable transactions in groups of 500, and then checks that every record is still there, unchanged (the same text once written in today's form, the same revision, no new history) and where it belongs. It changes no record's content. The oldest of several same-named records keeps the plain name. The full list goes to `.godspeed/convert-notebook-dry-run.json` or `.godspeed/convert-notebook-report.json` and into the backup folder; the screen shows the counts and the first renames. A second run finds nothing to do. On a copy of a real notebook of 15,997 records the conversion took about 75 seconds; in a generated test of the same size, the converting machine's next sync took about 30 seconds and the other machine's about 40.

Every machine that syncs the notebook must run this version before any of them uses it: from the first record this version saves, and all the more after a conversion, an older version finds files it cannot read and stops syncing rather than guess.
