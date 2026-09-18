# Telegram conversation protection

This is a development candidate. It is not included in the current public download.

The kit owns the `hub_chat` package. Both Bash and Windows setup install that same
package as an immutable bundle under the local user's `.hub/chat/releases` folder.
Changing the selected package is atomic. Personal instructions, task files, models,
credentials, and approval permissions are not replaced.

The candidate integration has been tested against Hermes revision
`db64ddb58eef6aebd0874bcdaad266ca8f6205a0`. Its manifest verifies every changed runtime
file. An unknown version is refused. Do not enable unattended Hermes updates until
a compatible bundle has been tested. Setup preserves the tested source and Python
environment. If an external update breaks compatibility, startup switches to that
verified copy and pauses automated messages. The Linux recovery probe exercised
this switch without connecting to Telegram. Windows and Mac recovery still need
their platform installation tests.

Setup on a desktop without a local Telegram profile installs the tools only. It
does not start another bot. A remote gateway must be updated on its own host.
Setup detects the saved desktop connection and reports a pending server update;
it does not claim that installing desktop tools updated the remote gateway.
Automatic remote installation is not implemented. This candidate must not be
advertised as a complete reader fix.

## Operator commands

Run these through the installed `hub-chat` launcher, using the gateway's own profile:

```text
hub-chat --profile PROFILE doctor
hub-chat --profile PROFILE doctor --json --require-live
hub-chat --profile PROFILE preview
hub-chat --profile PROFILE status
hub-chat --profile PROFILE submit SOURCE_ITEM_ID
hub-chat --profile PROFILE submit-report REGISTERED_NAME --revision CONTENT_HASH
hub-chat --profile PROFILE migrate LEGACY_FACTS_JSON --dry-run
hub-chat --profile PROFILE migrate LEGACY_FACTS_JSON --apply
hub-chat replay --fixture september-18
hub-chat --profile PROFILE rollback
```

Configuration uses the Python environment already installed with Hermes. It checks
the runtime, applies the versioned patch, merges the managed display settings, and
saves previous configuration. Initial configuration pauses unsolicited messages.
Preview current sources and pass doctor before `enable-proactive --after-preview`.
Restart the gateway to load changed settings. No setup command sends a test message.
Doctor distinguishes an installed configuration from one loaded by the gateway.
The live check requires a recent heartbeat with the same configuration hash.
The fixture rehearsal uses temporary state and has no real transport option.

Only configured source commands supply current state. Inbox submissions contain
item identities or a registered report name, never executable commands, credentials,
or arbitrary recipients. On a service account host, provision the inbox for the
producer group while keeping the journal owned by the gateway account.

The SQLite journal is private local runtime data. Keep it outside Git and cloud
sync. Queue acceptance is not delivery. A transport timeout leaves an uncertain
receipt and is not retried automatically. Keep the journal during rollback.

Approval buttons address one request. Permission, expiry, and execution outcome
are recorded separately. The original message is edited when the request expires.
Restart cancels pending waits and marks unrecorded execution outcomes uncertain.
The existing Hermes guard still decides whether a command may execute.

Free-form language checks are supplementary. Structured result claims must name
successful tool evidence, but evidence matching does not prove that arbitrary prose
describes the correct business outcome. Include human review of the visible replay
in release acceptance.

The watchdog integration queues verified critical sources through this boundary.
A gateway that is itself offline cannot immediately deliver its own queued alert;
use a separately configured emergency destination for that case.

## Release blockers

- Verify runtime recovery across the full platform installation matrix.
- Complete existing-reader and remote-host migration, including scheduled reports.
- Verify the executable downloaded through the reader route, not just its source.
- Run fresh-install and upgrade tests on an actual Mac.
- Finish the controlled real exchange, then observe the deployed version for seven
  days without daily status messages. A transport and expiry component test alone
  does not prove incoming reply handling in the deployed gateway.
- Complete text retention, explicit deletion, and restoration of the full previous
  protected runtime/configuration during rollback. The current rollback preserves
  the database and changes the package but does not certify that full recovery path.
- Publish the tested kit, bootstrap and watchdog versions together, with updated
  immutable pins. Until then, existing download links still serve the old release.
