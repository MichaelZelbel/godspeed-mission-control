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

Only the host selects the provider and model. Requests cannot name credentials,
programs, endpoints, tools or a different provider. A nonzero exit means no usable
answer. The add-on must validate the answer and must not turn an AI error into an
external action.

`--check` or `--describe` returns `configured`, `provider` and `model` without
refreshing credentials or sending an AI request. This proves configuration only,
not that the account can answer now.

The default time budget is 120 seconds; allowed values are 1 to 240 seconds.
The output budget is 128 to 8,192 tokens, default 2,048. System and prompt text are
each limited to 256,000 bytes. Add-on requests share one host execution slot; time
spent waiting counts against the request deadline. Private receipts keep only the
time, outcome, selected route and elapsed time, never the prompt or answer.

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
