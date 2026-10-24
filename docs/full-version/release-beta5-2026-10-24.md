# Godspeed Mission Control 2.0.0-beta.5, 24 October 2026

Version: `2.0.0-beta.5`. Release: `godspeed-v2-integrated-2026-10-24-1`.
Runtime and complete corresponding source archive: `b81160c56f22266ab96c6a89b30df53f0365fe9e`.
Windows bootstrap: `5364e82b44ab0b093e04262c680a21d666faf5e1`; shared Unix engine: `86da1dd27fea804ab131a8494b79a2ccf868e847`. Both are the same as beta.4. Node 22.19.0 and data format 1 are unchanged.

## Scope

Every product main change since beta.4, plus PRs #19, #30 and #31: semantic search runs outside the notebook's request thread; links in notes open when clicked; failed saves retain typed text and its original version; Review checks whether something is already known before queuing it. The release also includes the connected-model command, backup AI, add-on notes that remain searchable without entering processing, add-on deadlines, CommonJS declarations, add-on web address folders and intervening fixes. The unfinished Hostinger compatibility branch was excluded.

## Build and verification

Built with beta.4's `docs/full-version/release-beta-2026-10-19/build-exe.sh`, using Node 22.19.0, Windows PowerShell 5.1 and Inno Setup 6. Root and packaged Unix installers are identical and pin product, starter and notebook hook to the runtime source. The source archive is `git archive --prefix=godspeed-mission-control/` of that source. The manifest identifies both source commits and every packaged file; SHA256SUMS identifies all four release payloads.

The unchanged Windows bootstrap suite passed 451 checks with zero failures. Its backup-location, native-diagnostics, starter-pin, update-copy and slow-start fixture suites passed. PR #19's current-main integrated check passed native Linux fresh install/update/recovery, image build, the installed server's full notebook suite and browser checks: https://github.com/MichaelZelbel/godspeed-mission-control/actions/runs/40090736892 . Note-link UI tests passed 10/10; failed-save UI tests passed 15/15; semantic-worker, save and repeated-shutdown regressions passed 16/16.

The full exact-source notebook suite passed on Windows with Git Bash first on PATH: 1,443 tests, 1,404 passed, 39 skipped, zero failures. The full UI suite passed in jsdom: 22 files and all 103 tests. The exact package's Mac/Linux installer workflow passed native Mac install, restart, upgrade and uninstall, mail on Apple/Intel Macs and ARM Linux, and Linux uninstall: https://github.com/MichaelZelbel/godspeed-mission-control/actions/runs/40093023034 .

Main's exact-source image workflow passed on retry: https://github.com/MichaelZelbel/godspeed-mission-control/actions/runs/40092683716/attempts/2 . Its first attempt passed the full installed notebook suite, setup and all eight screen checks, then hit the existing intermittent blank-page wait after Docker restart, documented in test-browser.cjs since 6 October. The unchanged-source retry passed the restart check, published and signed the image, and completed its scan. Normal Docker main CI also passed: https://github.com/MichaelZelbel/godspeed-mission-control/actions/runs/40092683638 .

Server image: `sha256:cfcc97ee120ceeaa8ccd9df1be8bd0467a8d21664054523a26b6fd39ee017fc2` (`v2-sha-b81160c56f22266ab96c6a89b30df53f0365fe9e`), selected by the three server Compose files and installer compose module at pin commit `bdb4a08bcde05b7dfac66cbc841d04e9be88c961`. The Hostinger purchase link selects that same immutable pin commit.

## Immutable files

| File | Bytes | SHA-256 |
|---|---:|---|
| `GodspeedSetup.exe` | 60463355 | `6d513f3018f6b246e5f65b34b7d267229d44eda061192b86e39e27f98fda7c8e` |
| `install-godspeed.sh` | 2326 | `be6d0adc49ca5cdacadba225d1fbc5d4d2a103510c7217fbde8f11562b3bb73a` |
| `windows-manifest.json` | 976167 | `04da47d883f591a2d252273f05b0feab40b6c0255815ea5f58d89bfd82ebc2db` |
| `Godspeed-v2-integrated-source.tar.gz` | 40428495 | `dfa214bcdc893b90b006a15ec5697b75290925088f7242fb255b4d012473f7c2` |

## Real installations before publication

The exact EXE updated the maintainer's existing beta.3 installation on Windows before publication. The final normal run completed in about 6 minutes 22 seconds with setup result ok. The installed manifest identifies source b81160c5, health answers as beta.5, the instance and workspace stayed the same, the identity file's bytes were unchanged, and one update copy remains. Two initial environment issues were resolved before the successful run: Windows PowerShell 5.1 was given its native module path rather than the parent's PowerShell 7 path, and the missing destination of the existing backup junction was recreated. No installer or runtime bytes changed between those attempts. The private verification receipt is kept with the release build artifacts.

The unchanged website one-line server installer completed a fresh installation in the WSL `clerk-machines` test bed before publication, with its supported candidate source and image overrides selecting the exact release. It created a new install directory and Docker volumes, pulled the pinned image, completed with exit 0, passed the notebook health wait, served the HTTPS health and setup pages through Caddy, and printed the normal private owner-account link. The local-certificate localhost test does not claim public certificate validation. The existing browser smoke also passed against that real install: owner password and recovery acknowledgement, persistent session, skipping Telegram, requested-page return and import UI, plus desktop and phone dashboard and note chat, with no browser errors. It used a synthetic note without a real bot or AI service. Installation including the image pull took 4 minutes 17 seconds; the running image revision is the exact runtime source.

## Publication and public readback

Published GitHub release 422711605 at 12:39:36 UTC on 24 October 2026 as Latest, with draft and prerelease both false: https://github.com/MichaelZelbel/godspeed-mission-control/releases/tag/godspeed-v2-integrated-2026-10-24-1 . The release tag and the product main fast-forward both selected `82a7554303d5725bcd227c04ab7f9de07fac7b2c`; the shipped runtime and source archive remain the immutable source identified above. All five release files were downloaded back from the draft and the four payloads passed SHA256SUMS before publication.

The four guide branches were merged into website main `fe439a3045fe9684fc18a56973f2857cad41bb92`, verified synchronized in Lovable and deployed as `81c6a56a-daa3-4100-ad6d-e44b8974b501`. The reused beta.4 anonymous verifier was adapted with the beta.5 hashes, source, image and pin commit plus the four released guide behaviors. Its full public run ended ALL PASS with exit 0, including Latest and tag downloads, short links, main Unix installer, anonymous image digest, all server Compose pins, website one-line installer parity and guide contents. A first guide-folder check was corrected to compare visible text after removing HTML formatting tags; the full rerun passed. The private readback log is kept with the release receipts.

## Maintainer server update

After publication and the anonymous ALL PASS readback, the maintainer server was updated from its prior custom runtime through the normal native installer, fetched at the immutable official source. The installed runtime is the exact released source. The notebook and owner dashboard answered successfully, the existing owner and device remained valid, and all eight existing add-on notes remained searchable in both notebook and MCP while retaining their skip-processing status. The assistant returned the requested one-shot verification answer through the existing subscription. Active add-on status and model commands answered, and the running gateway and add-ons retained their processes. Provider, login, device, sync and environment files were byte-identical before and after. No separate add-on or AI-tool release was installed. The private receipt retains the host-specific evidence.
