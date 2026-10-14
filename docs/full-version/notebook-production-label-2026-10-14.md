# Notebook production wording correction: preparation receipt

Prepared on 14 October 2026. Michael subsequently approved publication: "Yes, thank you. Please publish it." The preparation evidence below records the original build checks; publication validation is recorded separately at the end.

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

No newer feature changes were included. The notebook runtime preserves every other runtime file from the original public product. The source publication snapshot is `579f5a1ccb507d3f354f4cf1cdbe3f2106fd3ba3`, based on the corrected runtime and adding only corrected installer artifacts, release links, packaging notes and the archive export attribute. Its archive includes the corrected root installer, Windows setup, shell installer and manifest. Embedded checksums cover those three installer files; the release checksum file additionally covers the source archive, avoiding a checksum cycle.

## Download assets

Local directory: `C:/godspeed-worktrees/notebook-production-label-artifacts`.

| File | SHA256 |
|---|---|
| `GodspeedSetup.exe` | `60997cc4840a68e6499fd935799ff4755de87812cda663c2ba19486d3fabe0b3` |
| `install-godspeed.sh` | `66e4350edd0c6b98bdd408a24fc5afd16604fb536354757b39559fe6a591aa7a` |
| `windows-manifest.json` | `5dce390d94e7b93d54806e0d0a7a1a3f181aecfe4c6a9ef3f89bb7e37479eec7` |
| `Godspeed-v2-integrated-source.tar.gz` | `79a5acb64c8c97677b0a7ff8b244e01bbdf83a5034ef4778e2cccd6c7e9e956e` |

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

Michael approved the release under `rules/ask-before-irreversible-or-outward.md`. Publication includes install/update validations, replacement download assets, installer pins and checksums, the exact corrected image, the hosted installer image digest, and public read-back checks. The immutable runtime commit stays separate from main's newer features.
