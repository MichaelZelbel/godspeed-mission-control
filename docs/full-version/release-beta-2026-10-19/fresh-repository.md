# Replacement beta after the APPLY-reference fix

Version: `2.0.0-beta.1`. Release: `godspeed-v2-integrated-2026-10-19-1`.
Status: published on 20 October 2026 for a limited beta. [Download the release](https://github.com/MichaelZelbel/godspeed-mission-control/releases/tag/godspeed-v2-integrated-2026-10-19-1).

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

## Publication and verification, 20 October 2026

The release was published at 10:20 UTC and targets metadata/assets commit `770eb12da1ba591d4e6f6c4cef57f68a51759cbf`. All five release files were downloaded anonymously after publication and matched their reviewed hashes, including `SHA256SUMS` (`a681df50b38435026a42da14bd0bde40e7815c90618c65a34ef0c3b210932603`). The latest Windows download returned HTTP 200. The runtime and source archive remain pinned to the reviewed source above.

The replacement passed Linux fresh installation and upgrade with the original assertions, a separate install from the public Unix download path, the engine's real goal-day acceptance and a complete real Hermes goal loop using the approved free model without a paid fallback. The latter produced work that passed its own check, recorded its result and used it in the next decision. Research recorded an incomplete-night gap; this is not certification of completed founding research. The rebuilt signed image and normal server checks passed. Reporting-only vulnerability findings remain recorded; this release does not claim an absence of them.

The exact Windows EXE passed a fresh wizard installation, including the final-page checks (run `39188390189`). On 20 October, five unchanged bootstrap fixture suites passed under Windows PowerShell 5.1. Targeted native Windows notebook tests passed 66 checks with no failures; 19 Unix/Mac or POSIX-only checks were skipped. The changed validators passed their focused cases and the goals and moves regression suites again.

Full silent fresh/update, update wizard, original-old-installer refusal, update discovery and uninstall were **not rerun on this exact rebuilt EXE**. The earlier package's acceptance results remain historical evidence. Both packages carry the same bootstrap, Node runtime and data format; no Windows installer, updater, uninstaller, notebook storage migration or core/server implementation changed. The package includes rebuilt frontend bytes and the goal-validator changes, so earlier passes are not represented as exact-package certification. The limited beta accepts this remaining integration uncertainty alongside the exact fresh installation and local regression evidence. GitHub-hosted Windows execution is not a launch requirement.

The maintainer confirms everyday use of the updated computer and server installations. Mac setup remains experimental: automated source checks support it, but an ordinary physical-Mac installation has not been verified and is outside this beta's scope. Fresh ChatGPT account sign-in and real new-bot Telegram onboarding remain unverified; isolated AI-selection and Telegram setup tests passed. Automatic Hostinger checkout remains waived while support investigates. An unspecified outside-user trial is not a beta launch requirement.

This record verifies the published software release. Website and book publication are tracked separately and are not claimed complete here. Prior assets and test evidence remain unchanged.
