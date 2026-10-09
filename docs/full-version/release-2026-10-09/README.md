# Release of 9 October 2026: `godspeed-v2-integrated-2026-10-09-1`, for the book's second edition

How the release was prepared, tested and published, kept as the template for the next one. The files here
are the working copies used that day (they name the session's scratch folders; read the paths as examples).

- `notes.md` the preparation log: where every commit is named, how the Windows setup is built
  (kit-bootstrap `windows/build-full-alpha.ps1` with the product checked out at the release commit, Node 22.19.0,
  Inno Setup 6), and what the clean-install test needed for version 2.
- `rebuild.sh` rebuilds every release file for a newer product commit and remakes the publish branch and the
  clean-install test branch (publishes nothing).
- `publish-list.md` the publish steps in order, each with its check.
- `release-notes.md` the GitHub release's text. `create-release.mjs` creates the release and uploads its files
  through the API (gh was not signed in). `gh-api.sh`, `job-log.sh`, `watch-runs.sh` read workflow runs and logs.

## What happened on the day, in order (Michael's yes: "Release, no email")

1. kit-bootstrap c91da3a pushed to `codex/godspeed-v2-native-integration` (the setups fetch it while installing).
2. `main` fast-forwarded to the release, d943f90. Its `install-godspeed.sh` and both `/install` short links
   hand on the tested installer (sha256 `d749185…`).
3. GitHub release created with the five files, marked latest; downloaded back, `sha256sum -c` OK, identical to the
   tested files; `releases/latest/download/GodspeedSetup.exe` lands on it.
4. The image: Docker Hub answered `429 Too Many Requests` to GitHub's runners on every build that evening (the
   node and Hermes base images). Fix 00b4f6d: every Docker build pulls Docker Hub images through `mirror.gcr.io`
   (same digests, so the build cannot change). Then the in-image notebook suite failed twice on a race: Linux
   stamps files with a coarse clock, so a routine run written right after the first look could read as older and
   be skipped. Fix c83b399 allows two seconds. Integrated Godspeed v2 run 37994328875 then tested and published
   `v2-sha-c83b399`, digest `sha256:13232a9097a2c36024106ea0a5b99a4147bc7ded16f371faa9845053ef7cd061` (read back from
   ghcr.io).
5. Pinned for Hostinger (38791af), the README's purchase link names that commit (700c6b8), both pushed to `main`
   and `codex/godspeed-v2-completeness`. The installer page on srv1069233 backed up to
   `/opt/godspeed-hostinger-installer.bak-20261009`, replaced from 38791af (its files were identical to the previous
   release's, so nothing local was lost), restarted, `compose.mjs` holds the new digest, the page answers 200.
6. The clean-install test before publishing (mc-installer-clean-test, branch `second-edition-release`, run
   37986449957): Windows fresh and update from 7 October, Ubuntu fresh and update, all pass; macOS fails five
   checks of kit-bootstrap's own `test.sh`, the same five as on 8 October: three are the test's `$(case …)` that
   macOS's bash 3.2 cannot parse, two compare a `/var` temporary path with the `/private/var` the installer
   resolves to. The installer itself is unaffected.
