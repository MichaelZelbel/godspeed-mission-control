# Telegram clarity release evidence

Candidate implementation, not a public release.

- Incident fixture uses fictional data. Network transport is fake until a dedicated test chat is authorized.
- Each visible message must name its subject, say only what current evidence supports, preserve necessary links, and state any required action plainly.
- New installation, upgrade, repeated installation, remote gateway, interrupted upgrade and rollback must pass.
- Verify source, package and runtime versions together. The public Windows baseline inspected on 18 September is v2.3.1.
- Real Mac verification, candidate executable installation and seven days of production observation must be recorded before claiming complete coverage.
- Publication approval is separate from implementation. No reader download is changed by a candidate branch.

## Recorded component evidence, 18 September 2026

- Kit commit `23bba40`: shared package tests passed on actual Windows, Linux and Mac
  GitHub runners: https://github.com/MichaelZelbel/teach-it-once-kit/actions/runs/35337847547.
  Hermes-only tests are explicitly skipped on those component runners.
- Bootstrap commit `22778ca`: Windows PowerShell 5.1 and Linux/Mac installer component
  tests passed: https://github.com/MichaelZelbel/kit-bootstrap/actions/runs/35338132710.
  These run the setup libraries, not the compiled executable installation journey.
- Subsequent management changes: 56 tests passed in the tested Linux Hermes
  environment, including all six real-adapter tests with fake HTTP transport.
  Local Windows: 50 passed, six Hermes-only tests skipped.
- A fresh Linux recovery snapshot passed re-execution into its preserved interpreter
  and source with proactive sends paused. No bot connection was opened by that probe.
- Later candidates passed 68 checks in the actual Linux Hermes environment, including
  eight real-adapter checks with fake transport. The direct server repair/download
  entry tests separately preserve an existing schedule and refuse malformed schedules
  or failed pinned downloads.
- Kit `00ee0c7` passed all three component runners:
  https://github.com/MichaelZelbel/teach-it-once-kit/actions/runs/35341031794.
- Bootstrap `687a6f7` passed all three component runners:
  https://github.com/MichaelZelbel/kit-bootstrap/actions/runs/35340738782.
- The later join/version-retention changes passed 367 Linux checks and 288 local
  Windows PowerShell 5.1 checks. Their commit is `21bf92a`.
- A Linux rollback probe restored an earlier package that includes scheduler and
  standalone-send protection, restarted its saved interpreter/source with a help-only
  invocation, and preserved an uncertain delivery record byte for byte. No Telegram
  connection was started. Earlier candidates missing those protections are refused.

The approved remote update experience uses the existing server installer. Desktop
setup reports that the server was not checked; it does not update it remotely.
Automatic desktop-to-server installation is no longer a release requirement.

No source branch result certifies the currently published app. Remaining release
gates include remote-server installation, existing report migration, full platform
installation and upgrade, candidate executable installation, deployed reply handling,
publication permission and seven days of observation. Keep the public pins unchanged
until those gates have evidence.
