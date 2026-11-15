# Add-on access on freshly installed servers

The Clerk release walkthrough used the public server installers and found two product
defects in Godspeed Mission Control 2.0.0-beta.5. This change prepares the next product
build. It does not publish a Godspeed release or a new server image.

## Observed failures

- On the one-line Docker server, the notebook binds its main listener to `0.0.0.0`.
  An `/api/query` request from loopback inside that same container returns HTTP 401
  `SIGN_IN_REQUIRED`. There is no separate private local API listener. MCP bearer keys
  apply only to `/mcp`, and its allowed operations do not provide the add-on deadline
  contract. A browser owner session is not an unattended add-on credential.
- On a fresh native server, the public installer installs Hermes with its current package
  manager and shell launcher. The assistant works through that launcher, but
  `godspeed-model --check` stops with `The connected Godspeed assistant Python runtime was
  not found`. The model helper looked only beside the outer launcher and in the older
  `.venv` layout, and did not load Hermes' selected package-manager dependencies.

## Resulting behavior

- The Docker image opts into a separate listener on container loopback, port 47832. It
  runs the same handler and store as the native local API, including the existing Host
  and Origin checks. The network-facing listener still requires sign-in. The port is
  neither exposed nor published. Startup fails if the requested private port cannot open;
  closing the service closes that listener too.
- The model helper reuses the notebook's existing Hermes launcher resolver when its old
  packaged-runtime paths do not apply. Hermes' own bootstrap loads its selected
  dependencies before the helper imports its connection modules. The verified home,
  selected provider and credentials remain the source of the request.

## Verification

New regression tests failed against the original source before implementation: the
Docker local address was absent, native package-manager discovery failed, and the Python
helper could not import a dependency made available only by Hermes' bootstrap. They pass
after the change.

The HTTP regression starts a network-facing service and a separate loopback listener,
then checks local note creation with `skip_processing`, add-on deadline creation/listing,
rejected non-local Host and Origin headers, continued HTTP 401 responses on both web
listeners, and unchanged native defaults. The existing model tests retain their
credential, provider, backup and output guards.

The same HTTP regression passes inside the actual released Godspeed Docker container,
using an isolated scratch copy of its source with the candidate handler. Its installed
notebook process, source and settings remain unchanged. The focused Windows regression
run passed 55 tests, with two existing platform skips; all 14 Python helper tests passed.

On the actual fresh native installation, a scratch copy of the released product with
only the model resolver and bootstrap changes returns
`{"configured":true,"provider":"custom","model":"clerk-test"}`. The original installed
source still gives the Python-runtime error; its service and settings were not changed.
The check used made-up local model configuration and made no external inference request.

A full tools-free request also passed through that installation's real package-manager
Python, bootstrap and provider adapter to a local pretend HTTP API. The response used
the configured `custom` provider and `clerk-test` model, made exactly one request and
sent no tools. This ran from a local-only snapshot of the stopped disposable native
machine, with networking disabled except loopback and without starting its notebook or
Paperless services. No production source, credentials or services were involved.

The packaged Docker image was not rebuilt or published in this change. A later release
must include this source in its tested image before add-ons can use the new Docker door.
