# Small update copies, 21 October 2026

Version: `2.0.0-beta.4`. Release: `godspeed-v2-integrated-2026-10-21-1`.
Reviewed source and complete corresponding source archive: `5a7bd7c22a1254ce00ca58628cba4f4ec2c6e230`.
Windows bootstrap: `5364e82b44ab0b093e04262c680a21d666faf5e1` (the update copy, its retention and the start wait); shared Unix engine unchanged at `86da1dd27fea804ab131a8494b79a2ccf868e847`. Node runtime 22.19.0 and data format 1 are unchanged.

## Scope and checks

Before every update the installers copied every durable folder of the mission control. On the maintainer's PC that was 8.33 GB and about sixteen minutes, an update refused to start with 5.4 GB free, and nine older copies (36 GB) had piled up. Now `godspeed.mjs backup FOLDER --before-update` (`notebook/core/update-copy.mjs`) copies only what an update can change, never `work/` or the assistant's undo archive, plus the media. In a folder that is its own Git repository it keeps the commit with a local ref (`refs/godspeed/update-copies/<copy>`) and saves only the files Git's index says changed, the untracked and ignored ones, and the names of deleted committed files. It opens no notebook and no unchanged committed file. Restore lays such a copy out from the repository and the saved files and then restores it like any backup. Once an update has answered, only its own copy stays; older copies, the whole copies of earlier versions and their refs go. A Menerio import makes the same copy and keeps only the newest import's. The server package keeps only the newest settings copy, and the one-line server installer keeps only the last software ref.

The update also reads the notebook once instead of five times (`init` reuses one read, `wire-assistant` opens it only when it needs records), and the Windows setup connects the assistant once. `start-full-alpha.ps1` waits while the notebook it started is alive and its supervisor has not given up, for up to 15 minutes; one still starting after that is reported as starting, never as failed.

The exact source passed the full notebook suite on Windows (1,332 tests: 1,320 passed, 9 skipped, and the 3 failures unchanged main has there: two Mac-only installer tests under Git Bash and one load-sensitive timing test that passes alone). The update-copy, retention, import, installer and server-package tests are in `notebook/test/update-copy.test.mjs`, `upgrade-copies.test.mjs`, `migration-merge.test.mjs`, `native-installer.test.mjs` and `docker/full-candidate/test-package-update.sh`. The bootstrap's Windows suite passed under Windows PowerShell 5.1 (451 passed, 0 failed), with its backup-location, native-error, starter-pin, update-copy and new start-wait fixture suites.

On the maintainer's PC (`C:\godspeed`, live notebook running) the copy took 1.8 to 12 seconds for 1,012 files and 80 MB with the bundled Node runtime, `init` 2.0 seconds and the assistant wiring 0.5 seconds when warm. The build before this one (product `656a5c1c`, bootstrap `5364e82`, labelled beta.3) was installed there silently by the maintainer's session on 21 October 2026: setup finished in 2 minutes 14 seconds, the notebook answered eight seconds later, exactly one update copy (82 MB) and its ref remained, and the earlier whole copy and its ref were removed. This exact EXE differs from that build by the version label.

## Immutable files

| File | Bytes | SHA-256 |
|---|---:|---|
| `GodspeedSetup.exe` | 60302962 | `b4da44e24c5031fb7579f16513bda874db1d0ad8e41b2ab337120704b90ff17b` |
| `install-godspeed.sh` | 2326 | `68560ed5c2ec7547c3a76648c552439f9756a0fdf2366df9f07a208fb6ae0a1b` |
| `windows-manifest.json` | 964714 | `f03abeed87a0a3630e06a6c20ba73b1b1d14323049fcfaa082c48dccc0974fa6` |
| `Godspeed-v2-integrated-source.tar.gz` | 40213855 | `a23c2e449960f0c0ae30e08e203b5a48f1e8eba46bdc1406128f8734f1c8bd42` |

The EXE and manifest were built with `docs/full-version/release-beta-2026-10-19/build-exe.sh` (Node 22.19.0, Windows PowerShell 5.1, Inno Setup 6); the manifest names beta.4, the source and bootstrap above, and 5,540 checked files. The source archive is `git archive --prefix=godspeed-mission-control/` of the reviewed source. The root Unix installer and its packaged copy have identical bytes and pin product, starter and notebook hook to that source.

Public release, installed-server checks and anonymous download readback are added after verification.
