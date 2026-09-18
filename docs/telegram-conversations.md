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
The server installer owns remote updates. Desktop setup does not install software
on a connected server or claim to have checked it.

## Updating a connected server

Run the server installer on the server that already runs your assistant. Keep the
same account and hub folder. The update preserves your files, sign-in and approval
choices. It must restart the existing gateway and verify the loaded protection
before reporting it active. A failed check means the update is not verified.

This candidate has not been released. The current public installer still serves
the earlier version; rerunning it today does not install this candidate. The release
checklist requires the tested installer and shared package to be published together.

A desktop message saying the server was not checked is local information only.
It does not mean an already updated server needs another update. Verification runs
on the server, with `hub-chat --profile PROFILE doctor --require-live`.

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
hub-chat --profile PROFILE forget-text --before 2026-01-01T00:00:00Z
hub-chat --profile PROFILE forget-text --before 2026-01-01T00:00:00Z --apply
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

Setup registers an existing reader morning-brief job only when its saved name and
working folder match. It leaves its schedule untouched. Delivery reads today's
saved brief, checks its age and phone-readable form, then waits for a real receipt.
A changed or expired report is checked again before sending. The scheduler's raw
transcript and standalone Telegram sender cannot bypass this route.

Other scheduled Telegram jobs require an explicit registered report source before
activation. Their unclassified output is refused and the delivery error stays in
the local job record. Failed report production currently stays local too; a clear
failure notice for a requested report remains a migration gate. Checking a saved
brief's age and format does not establish the truth of arbitrary prose within it.

The SQLite journal is private local runtime data. Keep it outside Git and cloud
sync. Queue acceptance is not delivery. A transport timeout leaves an uncertain
receipt and is not retried automatically. Keep the journal during rollback.

Message text is removed from completed local delivery records after 90 days by
default. Set `text_retention_days` to another number from 1 to 3650, or zero to keep
it. `forget-text` previews an earlier cutoff; `--apply` removes eligible text.
Pending and uncertain records remain available for reconciliation. Completed
approval text is eligible only after the final message edit was confirmed.
Outcome records and delivery identities remain to prevent duplicate sends. This
does not delete messages from Telegram, source documents, backups or disk remnants.

Rollback validates the previous protected package and its complete recovery copy
before switching configuration. It preserves the journal and current owner,
language and retention choices, pauses automatic messages, and requires a restart.
If the previous recovery copy is damaged, rollback refuses the switch and leaves
automatic messages paused. It never restores an unprotected sender.
An earlier package missing scheduler or standalone-send protection is refused too.
The complete Linux saved-runtime rollback probe passed with both protections present;
equivalent Windows and Mac recovery tests remain release gates.

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
- Verify retention and protected rollback through the full installation matrix.
- Publish the tested kit, bootstrap and watchdog versions together, with updated
  immutable pins. Until then, existing download links still serve the old release.
