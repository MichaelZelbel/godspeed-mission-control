# Notebook production wording correction: preparation receipt

Prepared on 14 October 2026. This is preparation evidence, not publication approval or a complete release certification.

## Exact source

- Original public release: `godspeed-v2-integrated-2026-10-13-1`.
- Original product: `9ab230680e2972eb424eeb54cbb83d1a8cc5ee9b`.
- Corrected product: `02f4ecbdd89276783004e102d032178f952f1c6e`.
- Pushed product branch: `codex/notebook-production-label-release` in `MichaelZelbel/godspeed-mission-control`.
- Unchanged bootstrap: `0eafb061d28a077b2d7c0cc83d0bd002fcb44444`.
- Isolated product checkout: `C:/godspeed-worktrees/notebook-production-label-release`.
- Isolated bootstrap checkout: `C:/godspeed-worktrees/notebook-production-label-bootstrap`.

The product difference contains only these three files:

- `notebook/ui/src/components/layout/DashboardSidebar.tsx`: remove the unconditional "Test installation" footer, keep the separator.
- `notebook/ui/src/App.tsx`: unavailable-page fallback becomes "This page is unavailable."
- `notebook/adapters/src/App.tsx`: the same unavailable-page fallback.

No newer feature changes were included. The source archive preserves all other files exactly at the original public product, including its historical installer copies. The separately staged installer asset below has the new product pin.

## Download assets

Local directory: `C:/godspeed-worktrees/notebook-production-label-artifacts`.

| File | SHA256 |
|---|---|
| `GodspeedSetup.exe` | `60997cc4840a68e6499fd935799ff4755de87812cda663c2ba19486d3fabe0b3` |
| `install-godspeed.sh` | `66e4350edd0c6b98bdd408a24fc5afd16604fb536354757b39559fe6a591aa7a` |
| `windows-manifest.json` | `5dce390d94e7b93d54806e0d0a7a1a3f181aecfe4c6a9ef3f89bb7e37479eec7` |
| `Godspeed-v2-integrated-source.tar.gz` | `9357dc0077fc5e3fa9f4afbe8ef4970a7d6102ced6af753d57356f1d87e535ca` |

`SHA256SUMS` is also staged. The shell installer was downloaded from the exact original release, verified against release asset SHA256 `3078a9b059b5d1a1a7be805612a72a5cb455b0490c09bae7b4a36b782da454d6`, then changed only by replacing the original product hash with the corrected product hash. Its bootstrap pin stays unchanged.

## Verification performed

- `npm ci --no-audit --no-fund` and `npm run build` succeeded with Node `22.19.0`.
- Case-insensitive search found no "test installation" in either UI source or the built frontend.
- Windows `build-full-alpha.ps1` succeeded with the exact original bootstrap and the existing Inno Setup 6 compiler. No compiler was downloaded.
- Windows manifest product/bootstrap pins match the exact hashes above.
- Changed source files and bundled Node executable match their manifest hashes.
- The packaged frontend also contains no "test installation".
- The source branch was read back from the remote at the exact corrected product commit.
- Product diff is limited to the three files above and `git diff --check` passes.

The build emits existing dependency/chunk warnings. No fresh-install or upgrade matrix has been run for these replacement assets. The executable has not been installed on Michael's computer. Do not describe this receipt as a full release certification.

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

No image has been pushed to a registry. The complete Docker test/browser suite and multiarchitecture builds have not been run. This is a local build, copy check and startup smoke test only.

## Live state and approval boundary

No public release, live installer pin, website short link, hosted installer image pin, or running installation was changed by this preparation. GitHub's latest release was read back as `godspeed-v2-integrated-2026-10-13-1` after asset preparation.

Publication still requires Michael's approval under `rules/ask-before-irreversible-or-outward.md`. After approval, complete the appropriate install/update validations, publish the replacement download assets, update installer pins and checksums together, publish and verify the image, update the hosted installer image digest, and download/read back each public entry point. The preparation branch itself must not be merged to main as a substitute for those coordinated release steps.
