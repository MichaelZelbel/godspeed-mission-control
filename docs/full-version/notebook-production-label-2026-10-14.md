# Notebook production wording correction: preparation receipt

Prepared on 14 October 2026. Michael subsequently approved publication: "Yes, thank you. Please publish it." The preparation evidence below records the original build checks; publication validation is recorded separately at the end.

## Exact source

- Original public release: `godspeed-v2-integrated-2026-10-13-1`.
- Original product: `9ab230680e2972eb424eeb54cbb83d1a8cc5ee9b`.
- Corrected product: `02f4ecbdd89276783004e102d032178f952f1c6e`.
- Pushed product branch: `codex/notebook-production-label-release` in `MichaelZelbel/godspeed-mission-control`.
- Original bootstrap: `0eafb061d28a077b2d7c0cc83d0bd002fcb44444`.
- Final bootstrap: `68f6103809e5b61b0c163b7797e7f4f65664aef3`, adding optional starter pinning and deriving the Windows starter ref from the bundled runtime manifest.
- Isolated product checkout: `C:/godspeed-worktrees/notebook-production-label-release`.
- Isolated bootstrap checkout: `C:/godspeed-worktrees/notebook-production-label-bootstrap`.

The product difference contains only these three files:

- `notebook/ui/src/components/layout/DashboardSidebar.tsx`: remove the unconditional "Test installation" footer, keep the separator.
- `notebook/ui/src/App.tsx`: unavailable-page fallback becomes "This page is unavailable."
- `notebook/adapters/src/App.tsx`: the same unavailable-page fallback.

No newer feature changes were included. The notebook runtime preserves every other runtime file from the original public product. The source publication snapshot is `29568147ac3169af6c9a19e743ed6e0df4136284`, based on the corrected runtime and adding only corrected installer artifacts, release links, packaging notes and the archive export attribute. Its archive includes the corrected root installer, Windows setup, shell installer and manifest. Embedded checksums cover those three installer files; the release checksum file additionally covers the source archive, avoiding a checksum cycle.

## Download assets

Local directory: `C:/godspeed-worktrees/notebook-production-label-artifacts`.

| File | SHA256 |
|---|---|
| `GodspeedSetup.exe` | `82c3c6672fc177a2dbb9b9976f57383418a6f71d84dfca13afaadba4e7861a3a` |
| `install-godspeed.sh` | `5843a37502758b9cfd504d55a2b87413c916cee4773375ae2044fc0dd61866b6` |
| `windows-manifest.json` | `2b2c588ee831dd15c76491d9082a8f1cd9742e49fb7407166a50596814544965` |
| `Godspeed-v2-integrated-source.tar.gz` | `3d2a0be502a1f04ff1258cbe027ffff53b59f1415691a5dcc93780602c8ce8f7` |

`SHA256SUMS` is also staged. The shell installer was downloaded from the exact original release, verified against release asset SHA256 `3078a9b059b5d1a1a7be805612a72a5cb455b0490c09bae7b4a36b782da454d6`, then changed to select the corrected product, the matching starter ref, and the narrowly corrected bootstrap. The original baseline-bootstrap assets are retained under `baseline-bootstrap-assets/`.

## Verification performed

- `npm ci --no-audit --no-fund` and `npm run build` succeeded with Node `22.19.0`.
- Case-insensitive search found no "test installation" in either UI source or the built frontend.
- Windows `build-full-alpha.ps1` succeeded with the final pinned bootstrap and the existing Inno Setup 6 compiler. No compiler was downloaded.
- Windows manifest product/bootstrap pins match the exact hashes above.
- Changed source files and bundled Node executable match their manifest hashes.
- The packaged frontend also contains no "test installation".
- The source branch was read back from the remote at the exact corrected product commit.
- Product diff is limited to the three files above and `git diff --check` passes.

The build emits existing dependency/chunk warnings. The initial package matrix found a baseline starter mismatch: moving-main starter recipes caused a review in both old `9ab2306` and copy-corrected `02f4ecb`. The final package pins the starter to the installed runtime instead. Final install/update validation is recorded below. The executable has not been installed on Michael's computer. Do not describe this receipt as a full release certification.

## Docker preparation

Docker was unavailable on the local Windows machine. A second approach uses the separate test VPS `srv1069233.hstgr.cloud`, reached at `100.73.52.50`.

- Task directory: `/tmp/godspeed-notebook-label-02f4ecb`.
- Exact corrected source archive uploaded and unpacked there.
- Build uses the original `docker/full-candidate/Dockerfile`, its unchanged pinned base images, and `REVISION=02f4ecbdd89276783004e102d032178f952f1c6e`.
- Local-only target: `godspeed-notebook-label:02f4ecb`.
- Build log: `/tmp/godspeed-notebook-label-02f4ecb/docker-build.log`.

- Build succeeded, producing `sha256:91a5fb1e0462db1d64f4dc0bbd56a32ba3ca9f040b78bbbfc11df4b20e99f2ff` (`linux/amd64`).
- Image revision label matches the exact corrected product commit.
- Static verification inside the built image confirmed its frontend entry exists and neither source nor compiled frontend contains "test installation".
- A fresh isolated container, `godspeed-notebook-label-health-02f4ecb`, started with no published host ports and answered its internal `/health` endpoint successfully.
- The smoke-test container was stopped afterwards; its state and log remain available. Log: `/tmp/godspeed-notebook-label-02f4ecb/health-container.log`.
- The static-check container, `godspeed-notebook-label-static-02f4ecb`, remains stopped for evidence.

Those were the initial local preparation checks. After approval, exact-source public workflow `38573820731` passed native Linux install/update/recovery and the complete server/browser checks, then published, signed and scanned image digest `sha256:60df0c65e25d3b0f445112e9bb5fdf9982ef2f13afa31cfa9ae5b90439f8ba00` (`linux/amd64`, source `02f4ecb`). Hostinger standard and automatic test runs `38575480488` and `38575484704` passed. The hosted coordinator was deployed and its actual prepared Compose was read back with that exact digest. Multiarchitecture builds were not performed.

## Live state and approval boundary

At the original preparation boundary, no public release, live installer pin, website short link, hosted installer image pin, or running installation had changed. GitHub's latest release was read back as `godspeed-v2-integrated-2026-10-13-1`. After approval, the Hostinger image and hosted coordinator were published and verified as recorded above. Download publication is recorded below when its final validation completes.

Michael approved the release under `rules/ask-before-irreversible-or-outward.md`. Publication includes install/update validations, replacement download assets, installer pins and checksums, the exact corrected image, the hosted installer image digest, and public read-back checks. The immutable runtime commit stays separate from main's newer features.

## Final validation and publication

The starter mismatch was reproduced with both installed runtime versions, `9ab2306` and `02f4ecb`, against identical current-main starter text: each created the same one recipe conflict. The release therefore pins the starter to its installed runtime instead of accepting an arbitrary newer recipe hash. The final shell installer exports `GODSPEED_STARTER_REF=02f4ecbdd89276783004e102d032178f952f1c6e`; the Windows installer derives the same ref from its bundled manifest. Shared tools retain their existing channel, and edited recipes remain protected.

Bootstrap `68f6103` passed its focused starter-ref tests under Git Bash and actual Windows PowerShell 5.1. Its implementation worker also verified the existing full Bash suite (535 passed, 0 failed) and Windows PowerShell 5.1 suite (410 passed, 0 failed).

Public Unix validation: [kit-bootstrap run 38577472335](https://github.com/MichaelZelbel/kit-bootstrap/actions/runs/38577472335). The new focused starter-ref tests pass on actual macOS and Ubuntu, and both collector suites pass. Ubuntu's full bootstrap suite passes. macOS retains the same five documented legacy bootstrap test failures: three Bash 3.2 command-substitution checks and two `/var` versus `/private/var` path comparisons. This is not a claim that the entire Mac suite is green.

The final source archive was extracted and its root installer matched the staged shell asset. Its embedded Windows executable, shell installer and manifest matched the staged assets; its embedded three-file checksum list passed. The final shell syntax and exact manifest product/bootstrap pins were verified. The final source snapshot differs from the corrected runtime only in installer artifacts, release links, packaging notes and the archive export attribute.

Final Linux fresh and upgrade validations both passed with aggregate exit 0 on separate clean Ubuntu 24.04/systemd containers. The fresh run passed installation, first-goal routines, the complete stand-in goal day, no recipe reviews both before and after that day, conversation archive, trackers and all eleven tool suites. The upgrade over the public 13 October release preserved the reader's own file, saved note and deliberately edited recipe, and passed archive/tracker checks. Logs are `linux-final-fresh.log` and `linux-final-upgrade.log` in the artifact directory and `/tmp/godspeed-notebook-label-02f4ecb/` on the test VPS. Test containers were stopped with their evidence retained.

The baseline-bootstrap Windows run [38573655687](https://github.com/MichaelZelbel/kit-bootstrap/actions/runs/38573655687) passed fresh and upgrade checks for the original prepared executable. It is baseline evidence, not validation of the rebuilt final executable. The final exact-executable Windows run is [38577471777](https://github.com/MichaelZelbel/kit-bootstrap/actions/runs/38577471777), including fresh review absence and preservation of a deliberately edited upgrade recipe. Its completion and public read-back evidence will be recorded after completion.
