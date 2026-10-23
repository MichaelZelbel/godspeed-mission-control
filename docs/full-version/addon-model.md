# One model connection for add-ons

An add-on asks Godspeed Mission Control for an answer through `godspeed-model`.
It does not need a second AI subscription or a copy of the user's credentials.

The command reads the installation's verified assistant connection on every call.
With Hermes, it uses the main provider and model selected in that assistant's home,
and Hermes resolves the account and request format. It never opens an assistant
conversation, loads memory, gives the model tools, or writes a notebook record.
The notebook's separate small-job connection does not replace the assistant's choice.
On an API-only installation without a connected assistant, the command uses that
installation's saved model endpoint instead.

Provider terms still govern the selected connection. Installing an add-on does not
expand a subscription's permissions. Godspeed does not silently switch to another
provider, paid model or subscription when the selected connection fails.

The one exception is a backup AI the user connected themselves (Settings, Your AI,
Backup AI; or `/backupai` in Telegram on the one-line server). Godspeed never adds one.
When the selected connection fails, the command asks the backup once, for that request
only, and the next request tries the selected connection first again. With Hermes the
backup is the first entry of its fallback chain (`fallback_providers` in the assistant's
`config.yaml`); on an API-only installation it is the second saved endpoint
(`.godspeed/provider-backup.json`). A request that ran out of its time is not repeated
with the backup. Without a backup, a failure is a failure, as before.

## Command contract

```
godspeed-model --workspace /path/to/godspeed
```

Send one JSON object on standard input:

```json
{"system":"Return a JSON verdict from the supplied facts.","prompt":"An invented example.","timeout_ms":120000,"max_tokens":2048}
```

The command returns one JSON object on standard output:

```json
{"text":"{\"verdict\":\"like\"}","provider":"the-selected-provider","model":"the-selected-model"}
```

When the backup answered, `provider` and `model` name the backup and the object carries
`"backup": true`. An add-on that keeps its own record of which model answered should
keep that too.

Only the host selects the provider and model. Requests cannot name credentials,
programs, endpoints, tools or a different provider. A nonzero exit means no usable
answer. The add-on must validate the answer and must not turn an AI error into an
external action.

`--check` or `--describe` returns `configured`, `provider` and `model` without
refreshing credentials or sending an AI request, and `backup` with the backup's
`provider` and `model` when one is connected. This proves configuration only, not that
the account can answer now.

The default time budget is 120 seconds; allowed values are 1 to 240 seconds.
The output budget is 128 to 8,192 tokens, default 2,048. System and prompt text are
each limited to 256,000 bytes. Add-on requests share one host execution slot; time
spent waiting counts against the request deadline. Private receipts keep only the
time, outcome, selected route, whether the backup answered, and elapsed time, never the
prompt or answer.

## Installation

Assistant wiring installs the command in the assistant home's `bin` folder and a
stable Node launcher at `<workspace>/.godspeed/model.mjs`. An add-on whose background
service has no assistant PATH can run that launcher with the installation's Node.
Windows wiring also writes a `.cmd` form. Existing installations must update their
Godspeed host helper before an add-on can use this connection; the add-on should
ask for that update rather than ask for another AI account.

`GODSPEED_MODEL_WORKSPACE` can name the workspace when `--workspace` is absent.
The command also accepts the usual `GODSPEED_WORKSPACE`, `GODSPEED_ROOT` and
`GODSPEED_DIR` locations. Credentials stay in the host's existing private files.

On the one-line Docker server, the server installer also creates a host launcher
at `<server installation>/.godspeed/model.mjs`. Its `model-host.json` identifies
that installation. A host add-on uses it to call the fixed `godspeed` Compose
service as its `hermes` account over standard input and output. The helper and selected connection stay
inside the existing container. The launcher opens no network port and forwards no
credential. It refuses another workspace, service or executable. An existing
global `godspeed-model` command belonging to a native installation is preserved.

## Notes an add-on writes

An add-on writes notes the way the notebook's own screens do, through the door that answers
only on the same machine: `POST http://127.0.0.1:47831/api/query` with
`{"table":"notes","operation":"insert","values":{...}}`, and `"operation":"update"` with
`"filters":[["eq","id","<the note's id>"]]` to change one.

A few minutes after a note is written, the notebook's own processing reads it: it adds a type,
topics, a summary and tags, links the people it names, and proposes facts, timeline entries and
new people for the Review Queue. It reads one note at a time, oldest first, at most 40 a day by
default.

### Searchable, not processed

An add-on that writes many notes and has already put what matters into them, such as one note
per scanned letter with its summary and key facts, marks each note with `"skip_processing": true`:

```json
{"table":"notes","operation":"insert","values":{"title":"Invoice from an invented roofer","content":"...","folder_path":"Documents","source_app":"your-add-on","skip_processing":true}}
```

Such a note stays visible to the assistant and is found by search exactly like any other note.
Processing never queues it, the bulk runs (Classify, Enrich from notes and timeline, Enrich
profiles now) leave it out, and it never counts against the daily limit, so the user's own notes
are not held back behind a pile of letters. The user can still process one such note from its own
menu. Setting the field to `false`, or removing it, makes the note a candidate again; marking a
note that was waiting takes it out of the queue. An add-on that wrote notes before it set the mark
can add it to them with an update.

`"ai_visibility": "hidden"` is something else: it hides a note from the assistant and from
search.

### When a note goes, its suggestions go

What processing proposed from a note waits in the Review Queue only while the note still holds
it. When a note goes to the trash or is deleted, every suggestion from it that is still waiting is
withdrawn. When an edit takes out of the note's title and text the sentence a suggestion quotes,
that suggestion is withdrawn. It happens in the same write as the change to the note, whichever
way the note was saved. A suggestion the user already kept stays; one they removed or blocked is
not touched.

A withdrawn suggestion has `"status": "withdrawn"` and a `withdrawn_reason` of `source_trashed`,
`source_removed` or `source_text_gone`. It is not shown or counted in the Review Queue and cannot
be kept. When the note comes back from the trash, or the sentence comes back, it waits again,
unless processing has meanwhile proposed the same thing from the note's new words.

So an add-on that takes its note back out of the notebook, for example by emptying the note and
moving it to the trash in one update, also takes back what processing proposed from it.
