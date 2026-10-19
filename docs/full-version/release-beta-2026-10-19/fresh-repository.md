# Replacement beta after the APPLY-reference fix

Version: `2.0.0-beta.1`. Release: `godspeed-v2-integrated-2026-10-19-1`.
Status: built for verification; keep the release draft until every required gate passes.

The installed product, starter and native notebook hook are pinned to reviewed source `a621d5f2649f3931943634b86101ba8134e672fc`. The shared bootstrap remains `86da1dd27fea804ab131a8494b79a2ccf868e847`. This source descends from the sole clean public root `bc3b63d10097ed46faab8d6e4be5672201b3ad68`; no earlier repository history is imported. The release metadata and installer assets are a separate commit on that reviewed source.

The earlier candidate `503703edbc5ec806b9b70b97ed210fee75b8eabf` failed its complete unchanged real Hermes goal-loop acceptance, exiting 1. Its draft move pointed at an existing research item instead of the checked draft action. The sole failed assertion was work verification, and the draft was absent. The remaining harness stages completed; Settings and research successes did not make the full run pass. [The superseded package record](superseded-503703.md) preserves its hashes and source checks.

Both move validation and direct bet recording now reject an APPLY reference unless it names a do action for the same goal with a CHECK. Ship-list moves must name their apply action. Recording a bet does not approve execution, change the referenced item or substitute another ID.

## Build and immutable files

The existing `build-exe.sh` ran from a clean detached checkout of reviewed source with Node.js 22.19.0. Its UI build passed. Windows packaging used the unchanged bootstrap's `windows/build-full-alpha.ps1`, Windows PowerShell 5.1 and Inno Setup 6. The normalized manifest names the source and bootstrap above, version `2.0.0-beta.1`, and 5529 checked files. Its file list includes the new reference regression.

The source archive is exactly `git archive --prefix=godspeed-mission-control/` of the reviewed source, not of the later release metadata commit. The installer scripts in that later commit are separately repinned to the reviewed source. The root and packaged Unix scripts have identical bytes. `SHA256SUMS` covers the four files below.

| File | Bytes | SHA-256 |
|---|---:|---|
| `GodspeedSetup.exe` | 60274400 | `deec71b3a2a2b6d313e8dcd7be54acc2f0a10c6aba54463dafa9117520a778ec` |
| `install-godspeed.sh` | 2326 | `bec3e561db067ba4e58ca05d60ac92f6626e3ffa7b8bf3920b3dd97f89227c27` |
| `windows-manifest.json` | 962950 | `831af931f2c94cb42e776b3baa3d00ad91d338f5fdf3695550124f744d05fba2` |
| `Godspeed-v2-integrated-source.tar.gz` | 40183537 | `fa1f9a3a2681017d71a1360ba53032e61d0a92f7497d93b0805d9c394e813e9f` |

## Source verification

The mistake was reproduced before the fix: both positive controls passed and four invalid references were wrongly accepted. After the fix, all six focused cases pass. The unchanged related suites pass: moves 100, goals 252, work 271, work runner 74 and decision 33. The approval case compares the blocked work card before and after recording, then verifies that taking it still fails with authorization required and no approval recorded. Guide pages were reviewed; the guide check passes.

These are source regression results. They do not replace installation or real model acceptance. Current source and reachable-history secret/privacy scans are recorded separately before the preparation branch is pushed.

## Required replacement gates

Every replacement gate is pending when this preparation commit is created. Earlier candidate passes do not certify these changed bytes.

1. Windows fresh/update and wizard fresh/update, downgrade refusal, update check and uninstall using this exact EXE and manifest.
2. Linux fresh and upgrade using the unchanged assertions and privately retained previous-version fixtures.
3. The engine's real corrected goal-day acceptance for the new release commit.
4. One complete real Hermes goal loop with the approved zero-price model and no paid fallback, including checked work, readings, settlement and the next decision. Partial successes and failed verification are not a pass.
5. A new integrated image built from the replacement release commit, native/browser/persistence checks, signature/scan results and the normal server gate. The automatic one-click Hostinger gate is explicitly waived; the separate diagnostic branch is not part of this release. Existing reporting-only vulnerability findings must not be described as absent.
6. The final digest pins, website parity/build/guide checks, database/publication checks and an independent install from the public download path using these exact new installer bytes.

Keep prior assets and evidence immutable. Do not run the historical publish list, image-pin script or website-pin script without adapting their stale commit/hash assumptions. Re-read live draft and remote identities before any authorized publication. The release tag ultimately names the metadata/assets commit, while the runtime and archive identify the reviewed source above.
