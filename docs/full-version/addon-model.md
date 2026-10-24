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

For a native Hermes installation, Godspeed follows the verified assistant launcher to
its own Python and source folder. When that installation uses Hermes' package manager,
its own bootstrap selects its installed dependencies before the helper reads the current
home's model settings. No alternate interpreter, provider or login is selected.

## The local notebook API in Docker

The integrated Docker image sets `GODSPEED_LOCAL_PORT=47832`. This opens a second
notebook API listener on `127.0.0.1` **inside the Godspeed container only**. It shares
the running notebook's store and the native local API contract: notes, collections and
`addon-deadlines` use the same routes and protections. Requests must use a local Host;
cross-origin browser requests are refused.

This port must never be published by Compose or proxied through the public HTTPS server.
A host add-on reaches it through the installation's fixed `godspeed` service with
`docker compose exec -T`, sending the request body over standard input. It does not copy
the owner's session or bearer credentials. The existing network-facing notebook port
47831 still requires owner sign-in, even for a loopback request to that port.

The extra listener is opt-in outside the Docker image: `GODSPEED_LOCAL_PORT` names its
port. Native installations keep their existing local API on 47831 without an extra
listener. This Docker local door is a next-build capability; the beta.5 image does not
have it.

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

## Deadlines an add-on keeps

An add-on that finds a date the user must keep, such as a documents add-on reading "pay by
20 November" in a letter, makes it a Godspeed deadline. It is an ordinary deadline: a file in the
mission control's `due/` folder, shown in the deadline list, said by the deadline reminders and
the morning brief as its day comes, and closed or moved by the user the usual way. The add-on
sends no reminders of its own, so nothing is reminded twice.

The add-on reaches its deadlines on the same door as its notes, the one that answers only on the
same machine: `POST http://127.0.0.1:47831/api/functions/addon-deadlines`. Every request names
the add-on (`addon`: small letters, digits and dashes) and an action. The answer is
`{"data": ...}`; a request that cannot be done is HTTP 400 with `{"error": "<a plain sentence>"}`.

Each deadline has the add-on's own `key`: letters, digits and `. _ : # / -`, at most 120, for
example the letter's mark and which request in it this is (`5d41402abc4b2a76#2`). One add-on makes
one deadline per key, however often it asks, also after it lost its own records or stopped half
way, so it should ask again rather than remember.

Make one:

```json
{"addon":"your-add-on","action":"create","key":"5d41402abc4b2a76#1","title":"Pay the invented water bill of 212.40 EUR","due":"2026-11-20","done_when":"The bill is paid.","cost":"A reminder fee and interest.","link":"https://paperless.example/documents/7/details"}
```

`due` is the last day, `YYYY-MM-DD`; `start` (optional) the first day it can be done, otherwise
today. `title`, `done_when` (what is true when it is done) and `cost` (what passing the day costs)
are one line each, in the user's language, because the reminders say them. `link` is an http or
https address. The answer is `{"created": true, "deadline": {...}}`, or `{"created": false,
"deadline": {...}}` when that key already has one, which is then left as it is.

Look up its deadlines: `{"addon":"your-add-on","action":"list"}` answers `{"deadlines":[...]}`,
each `{key, slug, title, due, start, state, touched, closed_on, link}`. `state` is `open`,
`unopened` (it starts later), `closed`, `dropped` or `needs-a-look` (someone broke its file by
hand).

Change one: `{"addon":"your-add-on","action":"update","key":"5d41402abc4b2a76#1","due":"2026-11-27"}`,
with `due`, `title` or both, for example when the letter's date was corrected. **A deadline the
user touched is the user's.** Once they changed its title or a date (also a day to aim for), or
closed or dropped it, `touched` is `true` and an update answers `{"updated": false, "touched":
true}` and changes nothing, for good. Otherwise `{"updated": true}`.

A Godspeed from before this answers HTTP 400, "Processing function has not been ported:
addon-deadlines". The add-on then makes no deadline and should tell the user once that updating
Godspeed lets it keep their deadlines.

In the file, three lines say whose a deadline is: `ADDON`, `ADDON-KEY` and `ADDON-STATE`, a
fingerprint of its title and dates as the add-on last wrote them. `mc-due add --addon <name>
--addon-key <key>` and `mc-due addon-update` are the commands behind the door; an add-on uses the
door, which runs them under the notebook's lock in the right mission control.

## A web address for an add-on

On a Linux server installed with Godspeed's Mac and Linux installer, the notebook's web address
comes from Caddy: Godspeed's own (the `godspeed-https` service, whose configuration the installer
writes whole on every update) or the server's own (`caddy.service`, to which the installer adds the
notebook's site, `/etc/caddy/godspeed-notebook.caddy`). Both read the folder
`/etc/caddy/godspeed-addons/`. An add-on that needs a web address writes a file of its own there and
never edits a Caddy file that Godspeed or the server's owner writes. Godspeed never writes in the
folder, and an update never takes a file out of it.

There are two kinds of file. Name each after the add-on and end it in `.caddy`.

**A site of its own**, in `/etc/caddy/godspeed-addons/<add-on>.caddy`: the server's name with a port
of its own, or a name of its own, never the notebook's own address (Caddy refuses two sites for one
address).

```caddy
# The invented archive's web address. your-add-on writes this file.
srv1.example.com:48444 {
	reverse_proxy 127.0.0.1:8000
}
```

**Paths on the notebook's own address**, in `/etc/caddy/godspeed-addons/paths/<add-on>.caddy`, such
as `https://srv1.example.com/your-add-on/` (with the notebook's port, `:48443`, where the server's
Caddy already served that name). Caddy handles them before the notebook's own pages, so
put everything in a `handle_path` or `handle` block under a path with the add-on's name, and never
take a path the notebook uses.

Such a path is open to anyone who has the address. To show it only to whoever is signed in to the
notebook, ask the notebook's web door first: its `/api/session` answers 200 for a visit that is
signed in and 401 otherwise. The web door is `127.0.0.1:47833` unless the installation chose another
port; the `reverse_proxy` line in the notebook's site names it. A visit that is not signed in is sent
to the notebook's address, which asks for the sign-in:

```caddy
# your-add-on's pictures, for whoever is signed in to the notebook. your-add-on writes this file.
redir /your-add-on /your-add-on/ 308
handle_path /your-add-on/* {
	forward_auth 127.0.0.1:47833 {
		uri /api/session
		@signin status 401
		handle_response @signin {
			redir * / 302
		}
	}
	root * /var/lib/your-add-on/pictures
	file_server
}
```

Write `redir * / 302`, with the star: in `redir / 302` Caddy takes the `/` for a path to match, and a
visit that is not signed in is let through.

### Caddy takes the file

Caddy reads the folder when it reads its configuration again:

- When `/etc/systemd/system/godspeed-https.service` exists, Godspeed brings its own Caddy. It has no
  admin endpoint, so a change is a restart: `systemctl restart godspeed-https.service`. A file it
  cannot read stops it, and the notebook's address with it.
- Otherwise it is the server's Caddy: `systemctl reload caddy`. A reload it refuses leaves it
  serving what it served before.

So check the file before Caddy takes it, with the program and the configuration the service runs:
`caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile` for the server's Caddy, and for
Godspeed's own the program and the `--config` file named in the `ExecStart=` line of
`godspeed-https.service`. When the check, the reload or the restart fails, take the file out again
and reload or restart once more. A file Caddy cannot read would also stop Godspeed's next update from
setting the notebook's address.

The installer makes the folder once Caddy reads it. A Godspeed from before this has none: the add-on
should not make the folder itself, since nothing would read it, and should tell the user once that
updating Godspeed gives it its address. The one-line Docker server's Caddy runs in a container of its
own and reads no such folder, and a computer has none. When Godspeed is uninstalled its Caddy stops
reading the folder; the folder and the add-ons' files stay.
