# Conversation reset hotfix, 20 October 2026

Version: `2.0.0-beta.3`. Release: `godspeed-v2-integrated-2026-10-20-2`.
Reviewed source and complete corresponding source archive: `9b8b3d022899f8d3112218aa3d65762ba4c4fd7d`.
Shared bootstrap: `86da1dd27fea804ab131a8494b79a2ccf868e847`; unchanged Node runtime 22.19.0 and data format 1.

## Scope and checks

Clearing the notebook conversation now clears both the visible chat and the AI session behind it. Saved notes are preserved. A late reply cannot restore the cleared chat.

Six focused backend checks passed on the exact source and again under the bundled Node runtime: persisted resets survive restart, provider history and native Hermes session IDs change, scopes stay separate, stale requests are refused and a delayed old reply remains archived without restoring the cleared chat. UI clear/failure tests also passed alongside a real two-tab browser fixture using the production build, real server and native adapter with a deterministic child. That fixture proved the displayed new session, cross-tab sync and reload; it did not call a paid model. Independent verification matched all staged files to the manifest and every changed source file to the exact reviewed Git source. The EXE was not extracted or installed in the maintainer account.

This patch does not change the goal research, decision or work loop, installer, or storage format. The release contract therefore does not require goal-loop acceptance.

The exact committed source was built with Node 22.19.0, Windows PowerShell 5.1 and Inno Setup 6 through the unchanged pinned bootstrap. The normalized manifest names the source and bootstrap above, beta.3, and 5534 checked files. The complete source archive is git archive of the reviewed source. The root Unix installer and packaged copy have identical bytes and pin product, starter and notebook hook to that source.

The unchanged bootstrap backup-location, native-error, update-copy-retention and starter-pin fixture suites passed under Windows PowerShell 5.1. The standard Windows updater in read-only mode recognized beta.3 as newer than the previous beta.2 installation. Repinned installer and Windows-command source checks passed nine tests, with seventeen expected platform skips. These fixture and source checks do not claim a fresh installation, upgrade or uninstallation test of this exact EXE. No installation was run against the maintainer's working Windows account. Mac setup remains experimental.

## Immutable files

| File | Bytes | SHA-256 |
|---|---:|---|
| `GodspeedSetup.exe` | 60286656 | `84809f02a285c22dbfdb1d7962af382a208fe1a35e19ec0d17471be78b2fc59c` |
| `install-godspeed.sh` | 2326 | `144f1647244a98768bf0b6fc1c2666b71eb1b82d4be6b8a1b421d7ae436e57d4` |
| `windows-manifest.json` | 963786 | `5525ad82dba6e163b4e2f704ffa24f93a3e3159abaf089a8d4bd721ac3173e99` |
| `Godspeed-v2-integrated-source.tar.gz` | 40189577 | `17d6dce4ba8d3d99e585ff99e6fc9d7b535db4e4660e183f00f0148ac94f1a9f` |

## Publication and public readback

Published as latest on 20 October 2026, release ID 418777854, targeting installer/assets commit `295a8e974f3479998bf3d52d2ea7a4be57cc81a5`. As with the preceding limited beta, it is not marked as a GitHub prerelease so ordinary `releases/latest/download` updates receive it. The prior release and tag were preserved.

All five release files were downloaded anonymously through their ordinary latest-download URLs. Every redirect selected this release, every payload matched the checked local SHA-256, the downloaded checksum file verified all four payloads, and the downloaded manifest named beta.3 and reviewed source `9b8b3d022899f8d3112218aa3d65762ba4c4fd7d`. SHA256SUMS itself is `c3ad5547d8c69f29dd1be93908dd379dcc5d94b60ebbc9b015e8779004e32c4e`.

The [exact-source integrated workflow](https://github.com/MichaelZelbel/godspeed-mission-control/actions/runs/39481873383) passed native Linux install/update/recovery, the prebuild checks and the new reset regressions, Docker build, the entire installed-server suite and browser checks, publication, keyless signing and the reporting scan. Reporting success does not mean the image has no dependency vulnerabilities. The [packaged-installer Mac/Linux workflow](https://github.com/MichaelZelbel/godspeed-mission-control/actions/runs/39482612277) also passed every job: actual Mac LaunchAgent install/restart/update/removal, the native mail executable on both Mac architectures and ARM Linux, and Linux uninstall. The [packaged-installer integrated workflow](https://github.com/MichaelZelbel/godspeed-mission-control/actions/runs/39482612364) has passed native Linux install/update/recovery with the newly published source pins; its second image build is not the image shipped here.

The tested server image is `ghcr.io/michaelzelbel/godspeed-mission-control@sha256:dd115e265cb2abba07f25d971e376d9c8dc4f3c2f90b945328d11bdd46d9cccf`. Anonymous registry readback verified the manifest digest and the exact reviewed-source label in its configuration. The signature is verified by CI's successful signing step; signature cryptography was not independently checked locally.

Exactly four active server Compose files changed only to select that digest, at public configuration source `5327793b83c209a166fe4b507e3a11ad882f2574`. The generated public Hostinger file matches its source. All 27 public/standalone/Traefik checks passed under checksum-verified Linux Node 22.19.0, with actual Docker Compose parsing and no containers started. Existing personal installations were not changed.
