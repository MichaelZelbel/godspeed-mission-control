# First beta rebuilt in the fresh public repository

Version: `2.0.0-beta.1`. Release: `godspeed-v2-integrated-2026-10-19-1`.
Status: prepared for verification; keep the release draft until every required gate passes.

The repository starts with one clean source commit, `bc3b63d10097ed46faab8d6e4be5672201b3ad68`. No parent or tag from the earlier repository is imported. The installer, starter and notebook hook all name that source commit. The shared bootstrap is `86da1dd27fea804ab131a8494b79a2ccf868e847`. The source archive is `git archive --prefix=godspeed-mission-control/` of the clean source commit. The release metadata and packaged installers follow in a separate commit.

The notebook UI was built with Node.js 22.19.0. Windows packaging used the pinned bootstrap's `windows/build-full-alpha.ps1`, Windows PowerShell 5.1 and Inno Setup 6. Its manifest names the clean source and bootstrap commits and contains 5527 checked files. The UI source did not change when the final source snapshot added server compatibility and removed private release records.

| File | Bytes | SHA-256 |
|---|---:|---|
| `GodspeedSetup.exe` | 60271629 | `7cb66ca66830d86ad11e691e75a235cb168128868f97ca787370ba01df6dff48` |
| `install-godspeed.sh` | 2326 | `960bd6bd39c8d3ab7590bd4079b0d39cfcf3e62d2596b4e93aea5a5b04c29ea6` |
| `windows-manifest.json` | 962627 | `2e540f097af4d65dffe0d467ef8ce96f297bfeeee6116ac226dc74a793209910` |
| `Godspeed-v2-integrated-source.tar.gz` | 40177829 | `876ec1bb2040c91b31e9ec801aa90df348041a64221679345108cd850517c7a7` |

## Verified before the repository swap

- Secret scanning of the source snapshot and every reachable commit passed. Narrow scanner exceptions document upstream public ingestion metadata, content hashes, a deliberately weak synthetic security-test code and an API documentation placeholder.
- Case-insensitive owner-name occurrences outside the GitHub handle and copyright lines: zero. Private server names, private workspace paths, confidential employer/client names and leaked prompt-archive files: zero. The three starter prompt-folder README files are empty-workspace templates, with no personal prompts. Shipped public commands and generic product runtime paths remain.
- The server cache updater crosses unrelated repository histories, retains its previous source commit and refuses local edits: three local regression cases passed.
- Existing Hostinger browser/public installation contracts were retained without merging the unfinished development branch: all 27 source and Docker Compose checks passed in Ubuntu. No new server or WSL distribution was created for these checks.
- The website's exact Compose implementation matches the product, its full test suite passed 80 of 80 with no skips, TypeScript passed and all 65 guide pages passed the guide check.

## Required before publishing

The historical passes recorded below do not count for this fresh repository. Record fresh results against the new release commit before publishing:

1. Windows fresh and update from the previous release, using the exact new EXE and manifest.
2. Linux fresh and upgrade, using retained private previous-version fixtures when old commits are no longer public.
3. The engine's corrected goal-day acceptance.
4. The product goal-loop acceptance with Hermes and the chosen free model. A daily provider limit is a stopped test, never a pass.
5. The image built, tested, published and signed by this new repository's own workflow, then pinned by digest in `docker/hostinger/compose.yaml`, `docker/hostinger/installer/compose.mjs`, `docker/hostinger/one-click.yaml` and `docker/server/browser-compose-traefik.yaml`.

The active website's public Compose and browser installer source pins must name commits in this repository. Re-pin them again after the image pin changes. Run the website tests, build, guide checks and database migration before its authorized publication. Verify the public install/download addresses from outside, and verify that the private archive and leaked commits are unavailable without signing in.

## Historical evidence

Older build IDs, commits, checksums and workflow runs in this folder belong to the earlier repository. They are retained as history, with private host and log paths removed; they are not instructions to use missing public commits or evidence that this rebuild passed.
