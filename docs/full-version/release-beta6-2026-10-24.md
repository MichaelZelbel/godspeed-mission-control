# Godspeed Mission Control 2.0.0-beta.6, 24 October 2026

Version: `2.0.0-beta.6`. Release tag: `godspeed-v2-integrated-2026-10-24-2`.
Runtime and complete corresponding source archive: `9390da492a0035a41b0eb02584234e269bca6dc8`.
Windows bootstrap: `5364e82b44ab0b093e04262c680a21d666faf5e1`; shared Unix engine: `86da1dd27fea804ab131a8494b79a2ccf868e847`. Both are unchanged from beta.5. Node 22.19.0 and data format 1 are unchanged.

## Scope

PR #36 fixes two failures observed in actual fresh public beta.5 installations. Docker add-ons get a separate private loopback notebook API, with the existing local Host and Origin protections; the public listener still requires owner sign-in and the private port is not published. The connected-model command discovers the current Hermes package-manager Python runtime and loads that installation's dependency bootstrap. The Clerk is a separate release. This product release supplies the capabilities its next beta requires.

Only PR #36 and the version change were added to beta.5's runtime and release bookkeeping. The unrelated unfinished Hostinger branch was excluded.

## Build and verification

Built with the same `docs/full-version/release-beta-2026-10-19/build-exe.sh` used for beta.5, using Node 22.19.0, Windows PowerShell 5.1 and Inno Setup 6. Root and packaged Unix installers are identical and pin product, starter and notebook hook to the runtime source. The source archive is `git archive --prefix=godspeed-mission-control/` of that source. The manifest identifies both source commits and all 5,615 packaged files; SHA256SUMS identifies the four release payloads.

The exact-source integrated workflow passed native Linux fresh install, update and recovery; the full installed notebook suite; actual container model and backup-AI requests; archive/sync checks; browser setup, screen and restart checks; image publication and signing: https://github.com/MichaelZelbel/godspeed-mission-control/actions/runs/40106007417 . The informational dependency scan also completed under the existing non-blocking policy and reported HIGH and CRITICAL findings; this is not a claim of a clean vulnerability scan.

The exact-source Mac/Linux workflow passed native Mac install, restart, upgrade and uninstall, mail on Apple/Intel Macs and ARM Linux, and Linux uninstall: https://github.com/MichaelZelbel/godspeed-mission-control/actions/runs/40106074410 . Before merging, PR #36 passed the local/auth/model regressions and actual scratch requests through the released Docker install and current native package-manager runtime, including one tools-free request through its real provider adapter to a local HTTP stand-in. Details are in [the add-on evidence](addon-server-access-2026-10-24.md).

The unchanged Windows bootstrap retains beta.5's validation: 451 checks with zero failures plus backup-location, native-diagnostics, starter-pin, update-copy and slow-start fixtures. Beta.6's UI was built from its exact source. No update of the maintainer's real Windows installation was performed. The exact staged Windows payload passed its own setup with a disposable profile, state and workspace on K: all manifest hashes, installed source, beta.6 health, built UI, a saved skip-processing note, persistence and instance after restart. This fixture used NoStart, NoStartup and SkipHermes; it did not invoke the EXE wizard, touch the real user state or change registry/startup/Hermes. A local full-suite attempt was stopped to respect the host's low available memory; the completed exact-source installed suite above supplies that gate.

Server image: `sha256:70a07e63bad57ee9cf114a86be3261db533191af28927453a81d5ea8fc330291` (`v2-sha-9390da492a0035a41b0eb02584234e269bca6dc8`), selected by all three server Compose files and the installer compose module at pin commit `78ea790d766073bf77059fadf4d1c340b022059d`. The public Compose module's tests passed five checks with one existing skip.

## Immutable files

| File | Bytes | SHA-256 |
|---|---:|---|
| `GodspeedSetup.exe` | 60471136 | `4a1c63c8a14af59a0c5b295b63a2bc5e45f6637174b706f1b2b7826fd513c2a5` |
| `install-godspeed.sh` | 2326 | `25bf88cb075527e7f4d9b5b10d2d6db789d3d99c5f1170cbc22e8aac4f691ce9` |
| `windows-manifest.json` | 976657 | `cfb64d742de64f24026be00a1240f9f9bf211bf6daa2c75b715cc07ad01735aa` |
| `Godspeed-v2-integrated-source.tar.gz` | 40437200 | `f8dc14e1a96430a8387eccd2a1e77fe1e3b3c14b4f1e99b7c4d3ed9735e109c4` |

`SHA256SUMS`: `55fb24f0f66702060a3f4ec9cfa878a33caa4941fe13df71e255396ff87649e1`.

Publication and anonymous readback are recorded after they complete. Production update is a separate operation through the normal released native installer.
