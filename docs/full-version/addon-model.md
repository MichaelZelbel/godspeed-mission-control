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
