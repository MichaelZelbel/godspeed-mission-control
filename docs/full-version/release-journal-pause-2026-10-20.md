# Journal pause hotfix, 20 October 2026

Version: `2.0.0-beta.2`. Release: `godspeed-v2-integrated-2026-10-20-1`.
Reviewed source and complete corresponding source archive: `d02745dd7b2ece9a578122c78a56872f6d713a7d`.
Shared bootstrap: `86da1dd27fea804ab131a8494b79a2ccf868e847`; unchanged Node runtime 22.19.0 and data format 1.

## Scope and checks

Pausing the journal now stops chat writes, all journal mutation commands and journal check-ins. Resuming starts the journal again. Existing entries and settings remain intact. Paused commands do not create an entries directory. The journal recipe also checks pause state before acting.

Source checks: the focused journal and notebook suites passed 112 checks, with one expected Windows shell skip. They exercise a real Settings HTTP pause, browser-chat and MCP journal writes refused while paused, no journal directory created, and a resumed entry saved once. Stale settings, mutation commands and timer/evidence hooks are covered. The journal recipe's normalized hash was added to the known packaged revisions so stock recipes remain eligible for later upgrades; the related tracker-recipe, packaged-skills and journal suites then passed all 26 checks. The source guide check and whitespace checks pass.

The exact source was built with Node 22.19.0, Windows PowerShell 5.1 and Inno Setup 6 through the pinned bootstrap's existing build script. The normalized manifest names the source and bootstrap above, version 2.0.0-beta.2, and 5531 checked files. The complete source archive is `git archive` of the reviewed source. The root Unix installer and packaged copy have identical bytes and pin product, starter and notebook hook to that source.

An independent check matched all 5531 staging files to the manifest and the critical fix files to the reviewed Git source. The bundled Node runtime passed all four journal pause regressions, including the real Settings, browser-chat and MCP paths. Innoextract 1.9 cannot parse the current Inno loader, so this is verification of the checked build payload, not an EXE-extracted runtime test.

Four unchanged bootstrap fixture suites passed under Windows PowerShell 5.1: backup paths, native failure messages, update-copy retention and starter pin selection. The normal Windows updater, in read-only check mode with a disposable prior-release configuration, recognized this exact manifest as a newer beta.2 release. Repinned installer and Windows command source tests passed 10 checks, with 19 platform skips. These fixture and source checks do not claim a fresh installation, upgrade or uninstallation test of this exact EXE. No installation test was run against the maintainer's working Windows account. Mac setup remains experimental. This journal-only patch does not change the goal loop, installer, storage format or frontend source; the goal-loop release gates do not apply.

## Immutable files

| File | Bytes | SHA-256 |
|---|---:|---|
| `GodspeedSetup.exe` | 60285867 | `ef5fa998cad83cc001378f8497c2a729facdc7900ce673154ee88a3614ac588d` |
| `install-godspeed.sh` | 2326 | `0c57ec493ef032ee443cc334fb2c8987d646a03409a84354aed8dd63074421d3` |
| `windows-manifest.json` | 963284 | `36e1ebfbc9efe2dd12e192c7686696175e38318c955d8aa5cfc66c072392acef` |
| `Godspeed-v2-integrated-source.tar.gz` | 40189390 | `e7a0488f9f260282bafd7bdeafe1070cadbb53a0ad51bf86b632fb82b737c992` |

## Publication and public readback

Published as the latest release on 20 October 2026, release ID 418715885, targeting installer/assets commit `4466c121f2a8b4e3bf6a580ac597ac313334f974`. It is not marked as a GitHub prerelease, so ordinary `releases/latest/download` updates receive it, as for the preceding limited beta. The prior release and its tag were not changed.

All five files were downloaded anonymously through their ordinary latest-download URLs. Each redirect selected this release, each payload matched the reviewed local SHA-256, the downloaded checksum file verified all four payloads, and the manifest named beta.2 with reviewed source `d02745dd7b2ece9a578122c78a56872f6d713a7d`. The checksum file's own SHA-256 is `9142a5fccc7003d073882efb97b2b4d8b8501b95a17a827baed047481c86880d`. Independently rebuilding the source archive with Git produced identical bytes; the bundled Node passed all four pause regressions again from the extracted source archive.

The standard integrated workflow [39472139313](https://github.com/MichaelZelbel/godspeed-mission-control/actions/runs/39472139313) passed native Linux installation, update and recovery, all prebuild checks, the Docker build, the complete installed-server suite and browser check, publication, keyless signing and the reporting-only scan. The scan still reports dependency vulnerabilities; a successful reporting step is not a claim that the image is free of them.

The tested server image is `ghcr.io/michaelzelbel/godspeed-mission-control@sha256:45cb11062d11ddac41cc238027111cbfa8936f19f6cf574b85a2a9cb17e10511`. Anonymous registry readback matched the manifest's digest and its configuration's exact reviewed-source label. Signing is verified by the successful workflow step; signature cryptography was not independently checked locally.

Exactly four active server Compose files were repinned to that immutable digest, with no other behavioral changes. Their generator matches the committed public file. All 27 public/standalone/Traefik source checks passed in Linux, including actual Docker Compose parsing; no containers were started by those checks. Personal running installations were not reinstalled by this hotfix release.
