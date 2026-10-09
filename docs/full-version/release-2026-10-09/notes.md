# Release prep notes (second edition) — started 2026-10-09

Brief: ../release-prep-brief.md
RC head: 43a4e5d on release/second-edition (worktree C:\godspeed\dev\kit-release, read-only for me)
My worktree: C:\godspeed\dev\kit-publish, branch release/second-edition-publish from 43a4e5d
kit-bootstrap: C:\godspeed\dev\kit-bootstrap-second-edition, branch fix/second-edition-installer

## Log
- 18:35 notes started

## Findings (reading, 18:35-19:00)
- RC 43a4e5d is a fast-forward of origin/main f6956cb (52 commits; merges listed by `git log --merges origin/main..43a4e5d`).
- Release branch 43a4e5d NOT on GitHub; kit-bootstrap c91da3a/8cfcfc0 NOT on GitHub (native-integration is e62f38b, c91da3a fast-forwards it).
- gh CLI not logged in. git push works via credential manager (to verify).
- Last release pattern (06746b7 = tag godspeed-v2-integrated-2026-10-07-2): product commit 3ab5037, then ONE publish commit
  touching README.md, docs/full-version/trial-handoff.md, install-godspeed.sh, installers/{GodspeedSetup.exe,SHA256SUMS,install-godspeed.sh,windows-manifest.json}.
  Tag on the publish commit; release target_commitish = publish commit. Assets: GodspeedSetup.exe, install-godspeed.sh,
  windows-manifest.json, Godspeed-v2-integrated-source.tar.gz, SHA256SUMS (SHA256SUMS lists the other four).
- Source tarball reproduced byte-exact: `git archive --format=tar.gz --prefix=godspeed-mission-control/ -o Godspeed-v2-integrated-source.tar.gz <product commit>` (git 2.37.1) -> 390cb8f6... matches.
  `installers export-ignore` keeps installers/ out of it.
- windows-manifest.json = windows/dist/candidate-manifest.json with BOM stripped and CRLF->LF (verified: 7 Oct payload manifest normalized -> 11f20a9b = committed).
- Exe built by kit-bootstrap windows/build-full-alpha.ps1 -KitCheckout <checkout at product commit> (kit-bootstrap HEAD = bootstrapCommit), in dev/kit-bootstrap-v2 on 7 Oct.
  Output windows/dist/GodspeedSetup-Full-Alpha.exe -> renamed installers/GodspeedSetup.exe. Needs notebook/ui/dist built first (npm ci + npm run build in notebook/ui, node 22.19.0 in CI).
  ISCC at %LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe (present).
- Exe passes -KbBranch <bootstrap sha>; setup-godspeed.ps1 fetches raw.githubusercontent.com/MichaelZelbel/kit-bootstrap/<sha>/join.ps1 (falls back to bundled copy if unreachable).
- Shared setup (Windows join.ps1 and Linux lib.sh) clones the STARTER folder and the kit TOOLS from godspeed-mission-control's DEFAULT BRANCH (main) at install time, depth 1.
  => the release only works as described once main = the publish branch. Pre-publish tests must redirect that clone (git url.insteadOf) to the release branch.
- Linux install-godspeed.sh pins: line 4 GODSPEED_PRODUCT_REF, ENGINE (kit-bootstrap sha, was 180321af!), KB_BRANCH, hook URL (product sha). Same file twice: install-godspeed.sh and installers/install-godspeed.sh.
- Workflows (product): push triggers only main / codex/godspeed-v2-completeness / tags v*. A new branch triggers nothing. docker.yml workflow_dispatch PUBLISHES (never dispatch). v2-integrated dispatch from another branch tests only (PUBLISH false).
- kit-bootstrap workflows: full-alpha.yml push only codex/godspeed-full-file-based; agent-cage.yml on any push touching agent-cage.sh (test only).
- clean-install.yml (mc-installer-clean-test): on any push; written for v1 (folder ~/godspeed, v2.x tags, KB_NOTEBOOK skip). Needs v2 jobs.
- Short links: teachitonce.com/windows and godspeedmissioncontrol.com/windows -> github .../releases (list) live; teach-it-once local branch book/second-edition d1ef4c9 (unpushed) changes it to /releases/latest.
  /install (both sites) -> srv1328602.hstgr.cloud/get/install-godspeed.sh = main's install-godspeed.sh (same sha e6ae9201 today). /companion -> main.zip.

## Build (19:00-)
- Worktrees made: C:\godspeed\dev\kit-publish (branch release/second-edition-publish @43a4e5d) and
  C:\godspeed\dev\kit-publish-build (DETACHED @43a4e5d, the build checkout; build-full-alpha needs HEAD = product commit, clean).
- Node 22.19.0 (checksum ea3fad0e... ok) unzipped at release-prep\node-v22.19.0-win-x64 (bash PATH must use /c/... form, not C:/ - first try ran node 18 by mistake, stopped, redone).
- UI: `npm ci --no-audit --no-fund && npm run build` in kit-publish-build\notebook\ui with node 22.19.0 -> EXIT 0 (log release-prep\ui-build.log).
- 18:59-19:06 exe: `powershell.exe -File C:\godspeed\dev\kit-bootstrap-second-edition\windows\build-full-alpha.ps1 -KitCheckout C:\godspeed\dev\kit-publish-build` (cwd scratchpad) -> EXIT 0 (log exe-build.log, UTF-16).
  payload windows\full-alpha-payload\43a4e5dfc694-c91da3a4aa2a ; out windows\dist\GodspeedSetup-Full-Alpha.exe
- Assets staged in release-prep\assets-43a4e5d\ :
  GodspeedSetup.exe 57,341,688 bytes sha256 29fea3a06f3847fd9ada67305cbe4359809e2fa7d507a5e55637b7d081e7ae30
  install-godspeed.sh 1,164 bytes 60ef989ae0c90d6f7eb9466ce4c9b9c7c4f3f917960dffdf5ca6f7ed51e32227
  windows-manifest.json 1,243,640 bytes bdee74131ec973946da6a95562de6d292b4db255af22b622d599e3794fb2b398 (kitCommit 43a4e5d, bootstrapCommit c91da3a, 5255 files)
  Godspeed-v2-integrated-source.tar.gz 36,571,663 bytes 42ec3354c62b0685b73bf5688d66e42bc5fbd4759de9c9495f43a60271eb2222
  SHA256SUMS 361 bytes 3c66366425f0562dcf5ae06a8cc36d0a0e82a753b231b9a7f30332596c15e041
- Commits on release/second-edition-publish: 0e35f86 (Linux pins), fb3ade8 (exe+manifest+SUMS), c733a7c (README).
- 19:10 pushed NEW branches: kit-bootstrap fix/second-edition-installer (c91da3a) and godspeed-mission-control release/second-edition-publish (c733a7c); reason: clean-install test needs both reachable on GitHub (join.ps1/setup-godspeed.sh raw at c91da3a, notebook hook raw at 43a4e5d, the release branch as simulated main).
- 19:12 dispatched v2-integrated.yml on release/second-edition-publish (c733a7c): run 37964246669 - tests only (PUBLISH is true only for refs/heads/codex/godspeed-v2-completeness; verified in the branch's file). Purpose: native Linux install/upgrade/recover + image build + fresh server browser test of this exact product before Michael pushes v2-completeness.
- 19:25 pushed NEW branch mc-installer-clean-test second-edition-release (a6db23e): v2 clean-install.yml + exe + install-godspeed.sh + release.env + kb-tag.txt (fix/second-edition-installer). Push triggers clean-install.yml (on: push).

## Test results (clean-install run 37964921324, branch second-edition-release a6db23e)
- linux-fresh: SUCCESS, ALL PASS (43a4e5d installed, service, health, pages, Hermes, 10 commands, mc-due help new, 6 recipes,
  --sources "" respected, first goal -> all 5 routines in ~/.hermes/cron/jobs.json, check-in rhythm "Runs every Sunday at 18:00.",
  mc-decide --dry-run writes settle.txt; tool tests goals 153, check-moves 36, work 73, work-run 46, forecast 44, check-written 34, due 120, launchers 43, all 0 failed).
- suites ubuntu: success. suites macOS: 5 FAILs in kit-bootstrap test.sh (bash 3.2: `$(case ...)` parse; rooms) - SAME 5 fail on main's last run 37771208897 (8 Oct) -> pre-existing, not from this release. Collector suite 64/0 on both.
- windows-upgrade: FAILED in the PREVIOUS release's install (godspeed-v2-integrated-2026-10-07-2 exe): setup-full-alpha.ps1 "The term 'Get-FileHash' is not recognized".
  Cause (likely): installer started from pwsh 7 -> powershell.exe 5.1 inherits PS7 PSModulePath -> Microsoft.PowerShell.Utility from PS7 fails to load in 5.1. Test-environment artifact; fix the workflow (start installer with Machine PSModulePath).
- v2-integrated run 37964246669 (dispatch, tests only): native-linux SUCCESS; image job FAILED: in-container notebook suite 910/917 pass, 1 fail:
  "the daily round's morning choice runs mc-decide and tells the person its one line" (starting-routines.test.mjs). Passes on Windows (rc2 log) and ...
  Hypothesis: mc-run/mc-decide prepend $HOME/.local/bin:/usr/local/bin:/usr/bin:/bin to PATH, so a real `hermes` in the image wins over the test's stand-in. Debug run: debug-daily-round branch (orphan, test repo), run 37965341663.
- linux-upgrade: SUCCESS (previous release 3ab5037 installed, note + own file written, new installer over it).
- Debug (plain Ubuntu, run 37965341663): the mc-decide test FAILS on plain Ubuntu too: "mc-decide: mc-run is not installed".
  ROOT CAUSE: tools/mc-run (and all tools/mc-* but mc-mail, mc-install-count) are mode 100644 in git; mc-decide and mc-work-run check
  `[ -x "$HERE/mc-run" ]` (then ~/.local/bin/mc-run) although they start it with `bash "$RUNNER"`. Windows Git Bash treats #! files as executable -> passes there.
  Real installs: Linux/Mac native falls back to ~/.local/bin/mc-run (installed executable by kit-bootstrap) -> works by luck; Docker image: unknown (debug run 2 checks).
  BLOCKS the Hostinger image: v2-integrated runs this suite before publishing, so pushing this release to codex/godspeed-v2-completeness would publish NO image.
- FIX prepared (not in the RC, the parent decides): branch fix/daily-round-finds-mc-run cbfc71c on top of 43a4e5d (worktree C:\godspeed\dev\kit-fix-mc-run),
  `[ -x ]` -> `[ -f ]` in tools/mc-decide and tools/mc-work-run. Pushed (new branch, triggers nothing); v2-integrated dispatched on it (tests only).
- windows-fresh (run 37964921324): installer exit 1, setup-log "STOPPED: the notebook could not be set up: The term 'Get-FileHash' is not recognized"
  (same as the previous release). Workflow artifact: installer started from pwsh 7 -> PSModulePath. Everything else that could be checked passed on Windows:
  starter folder, Start menu entries, 10 commands, mc-goals help, 6 recipes, BET:, the commands inside a Hermes-like Git Bash (MSYS_NO_PATHCONV=1): mc-due help (NEW text), mc-due/goals/work/forecast list, mc-goals file, mc-decide --dry-run + settle.txt; tool tests goals..due all 0 failed; test-launchers.sh printed no summary (to see in rerun).
  Note for readers: starting GodspeedSetup.exe from a PowerShell 7 window hits the same Get-FileHash stop (both releases). Not fixed; worth a kit-bootstrap hardening later.
- Debug run 2 (37965808078): plain Ubuntu RC: starting-routines 9/10 (the mc-decide test fails); fix branch: 10/10; tools work-run 46, mc-run 35, launchers 43 all 0 failed on both.
- Workflow fixed (aefcb02): PSModulePath = Machine value before each Start-Process of a setup; failing tool test shows its lines. Rerun: 37966116913.
- v2-integrated on the fix branch: run 37965765819 (native-linux success so far).
- handoff commit 6481e59 on release/second-edition-publish (not yet pushed)

## Where the product commit (43a4e5d) and kit-bootstrap commit (c91da3a) are named  -> rebuild = release-prep\rebuild.sh <new> [<new kb>]
Product commit 43a4e5dfc694c1ddbbf779d1124742a0f1bd3792:
 1. install-godspeed.sh line 4 (GODSPEED_PRODUCT_REF) and line 19 (hook URL)            [kit-publish]
 2. installers/install-godspeed.sh, same two lines                                     [kit-publish]
 3. installers/windows-manifest.json kitCommit + kitCommittedAt (generated by the build)  [kit-publish]
 4. installers/GodspeedSetup.exe (payload = git archive of the commit + its UI build)     [kit-publish]
 5. installers/SHA256SUMS (hashes of 1/3/4 and the source archive)                       [kit-publish]
 6. README.md: install-godspeed.sh checksum (line 32ish); release name (3 links) stays      [kit-publish]
 7. docs/full-version/trial-handoff.md: the 9 October entry (full sha)                    [kit-publish]
 8. Release asset Godspeed-v2-integrated-source.tar.gz (git archive of the commit) + release notes text
 9. The build checkout C:\godspeed\dev\kit-publish-build (detached at the commit) and its notebook/ui/dist
10. kit-bootstrap payload folder windows\full-alpha-payload\<12>-<12> (automatic)
11. Clean-install test branch: release.env PRODUCT, GodspeedSetup.exe, install-godspeed.sh  [mc-installer-clean-test-second-edition]
12. The publish branch's base: release/second-edition-publish sits on the commit (remade on the new one)
13. Hostinger: the image tag v2-sha-<commit pushed to codex/godspeed-v2-completeness> and its digest (after publish)
kit-bootstrap commit c91da3a4aa2a1c71f123548ca1aaef08366dcf90: items 1, 2 (ENGINE + KB_BRANCH), 3 (bootstrapCommit), 4 (KbPin inside the exe), 7, 11 (BOOTSTRAP, kb-tag.txt names the branch).
rebuild.sh does 1-7, 9-12 (DRY=1 checked against cbfc71c: patch applies, every name swapped). Then: force-push release/second-edition-publish (test branch), push the test branch, wait for the clean install.
- FIX VERIFIED: v2-integrated run 37965765819 on fix/daily-round-finds-mc-run (cbfc71c): native-linux success; image success
  (core checks, installers, image build, whole in-container notebook suite + fresh server + browser) - publish/sign/scan steps SKIPPED (PUBLISH false). 
- Rerun 37966116913: linux-fresh SUCCESS, linux-upgrade SUCCESS, suites ubuntu success, suites macOS same pre-existing 5 FAILs. Windows pending.
- Wrote: release-prep\release-notes.md (copied into assets-43a4e5d), release-prep\publish-list.md, release-prep\rebuild.sh (DRY=1 tested).
- Real container (debug run 37966383602, image from release/second-edition-publish): /opt/godspeed/kit/tools/mc-run and mc-decide are -rw-r--r--, and there is NO ~/.local/bin
  (HOME=/opt/data/full-candidate/hermes) and no /opt/data/.local/bin. => On the one-click server with 43a4e5d the daily round's two routines always stop with
  "mc-run is not installed". With cbfc71c they find tools/mc-run. So the fix matters for the server route, not only for the image test.
- 19:32 started VARIANT=1 rebuild.sh cbfc71c (log release-prep\rebuild-cbfc71c.log): branch release/second-edition-publish-cbfc71c in dev/kit-publish-cbfc71c, assets-cbfc71c, test branch second-edition-release-cbfc71c. release/second-edition-publish stays on 43a4e5d.

## Things noticed, not fixed (for the report)
- Windows setup started from a PowerShell 7 window stops with "Get-FileHash is not recognized" (PSModulePath inherited; same in 10-07-2). Double-click is fine. Hardening idea: setup-godspeed.ps1 drops PowerShell 7 module paths when it runs in Windows PowerShell.
- The v2 Windows wizard pre-ticks "Make a second mission control somewhere else" on a PC that already has one (also a v2 one): updating means unticking it (/BESIDE=no silently). Said in release notes.
- kit-bootstrap test.sh: 5 failures on macOS (bash 3.2), pre-existing since at least 8 Oct.
- docker.yml's own test (docker/test.sh, the plain image) cannot run before publishing without a PR (its dispatch publishes); it runs when main is pushed and only then publishes :latest.
- server/install.sh (/server link, the version-1 route) still pins kit-bootstrap v2.18; the second edition does not print /server.
- teachitonce.com/windows still -> /releases (list); d1ef4c9 on teach-it-once book/second-edition (unpushed) moves it to /releases/latest.
- VARIANT built (rebuild.sh EXIT 0): assets-cbfc71c: GodspeedSetup.exe 57,339,046 bytes e2048e3648e35674057eb44b45537e2a3b422bc9bf3267aba66a303d6b58e8e7;
  install-godspeed.sh 52029670b665ce53bbb200033f5bb6a755c46b850554ded9a49c79b2688895c6; windows-manifest.json 0db0ee4d4221b0a510dc4db375c88532f2aacf1dd500f839f718efe6d44b94ac;
  source tar 03d9175f0658a4241b387c659f49372afed5aea595d524378f3ac16c74f793f6.
  Branch release/second-edition-publish-cbfc71c (worktree dev/kit-publish-cbfc71c): 5c07032 rebuild, dce66f5 + f873615 handoff note on the fix. Pushed (new branch, no workflow).
  Test branch second-edition-release-cbfc71c (c6972f1) pushed -> clean install run 37968411759.
- RERUN 37966116913 (43a4e5d) FINAL: windows-fresh: installer exit 0, ALL PASS on the book's checks (notebook 43a4e5d at 47831, pages, Hermes verified,
  Start menu, 10 commands, 6 recipes, commands inside Hermes-like Git Bash, first goal -> 5 routines, check-in rhythm, mc-decide dry run);
  tool tests goals..due 0 failed; the step then failed in tools/test-launchers.sh (no summary: `out=$(...)` under bash -e). windows-upgrade: SUCCESS.
  linux-fresh/upgrade SUCCESS; suites ubuntu SUCCESS; macOS same 5 pre-existing.
- test-launchers.sh run locally (cwd scratchpad): 42/43; the failing check read MICHAEL'S REAL deadlines (mc-due list, read-only) because the test
  clears HOME but not an inherited GODSPEED_DIR (his shell has it). C:\godspeed status checked: clean, due/ untouched. Test defect: hermes_shell should unset GODSPEED_DIR/ROOT/WORKSPACE.
  Debug: launchers alone on fresh windows-latest (debug-daily-round branch) to see the CI failure.
- 20:01 variant test branch cd2ae04 (TMPDIR long + || true for tool tests) -> run 37970410110; earlier variant run 37968411759 still running (same exe).
- 43a4e5d publish branch: 46eda0b adds the "Checked before publishing" paragraph + known defect to the handoff; pushed (release/second-edition-publish = 46eda0b).
  NOTE for rebuild.sh: it replays the text diff from release/second-edition-publish's head, which now carries the "Known defect" paragraph:
  after a rebuild for a fixed commit, edit that paragraph (or build from release/second-edition-publish-cbfc71c's text).
- kit-publish-build is now detached at cbfc71c (moved by the variant rebuild).
- publish-list.md rewritten for two builds (A 43a4e5d / B cbfc71c recommended).

## REBUILD RUNBOOK (coordinator's request 20:30: the RC will move after fix round 4; 43a4e5d is the rehearsal)
Inputs (all pinned):
- product commit  = the new head of release/second-edition (must be on GitHub before the CI: the Linux hook fetches it by sha; pushing the publish branch is enough)
- kit-bootstrap   = c91da3a4aa2a1c71f123548ca1aaef08366dcf90 (worktree C:\godspeed\dev\kit-bootstrap-second-edition, branch fix/second-edition-installer, must be HEAD and clean;
                    a new kit-bootstrap commit = 2nd argument)
- Node for the UI = 22.19.0 win-x64, release-prep\node-v22.19.0-win-x64 (zip sha256 ea3fad0e67a991d8477d8c01344b56e69c676ccb733f065b22436994b1253f86, nodejs.org)
- runtime Node    = 22.19.0, downloaded and checksum-checked by build-full-alpha.ps1 itself
- ISCC            = Inno Setup 6.7.3, %LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe (found by build-full-alpha.ps1)
- PowerShell      = Windows PowerShell 5.1 (powershell.exe), as on 7 October
- git 2.37.1 (source archive byte-identical to GitHub's way: git archive --format=tar.gz --prefix=godspeed-mission-control/)
Commands (Git Bash, cwd = release-prep; never inside C:\godspeed's own files; unset GODSPEED_DIR first if a kit TEST is run by hand):
  1. merge the fixes into release/second-edition (owner) ; NEW=$(git -C C:/godspeed/dev/kit-release rev-parse release/second-edition)
  2. bash rebuild.sh $NEW                       # default: TEXT_FROM=6481e59 (43a4e5d texts without the run paragraph)
     TEXT_FROM=f873615 bash rebuild.sh $NEW     # when $NEW contains cbfc71c (the daily round fix): its handoff bullet comes along
     (VARIANT=1 ... builds beside instead of replacing release/second-edition-publish; the replaced head is kept as release/second-edition-publish-before-<new short>)
     It does: kit-publish-build -> checkout --detach $NEW; npm ci + npm run build (notebook/ui, Node 22.19.0);
              powershell.exe -File kit-bootstrap-second-edition\windows\build-full-alpha.ps1 -KitCheckout C:\godspeed\dev\kit-publish-build;
              assets-<short>\ (exe renamed GodspeedSetup.exe, manifest BOM/CR stripped and checked for both commits, install-godspeed.sh, source tar, SHA256SUMS, release-notes.md);
              release/second-edition-publish remade on $NEW with the text diff replayed (product sha, kit-bootstrap sha, installer checksum swapped) + binaries, one commit;
              test worktree: release.env (KIT_BRANCH, PRODUCT, BOOTSTRAP), GodspeedSetup.exe, install-godspeed.sh, one commit.
     Logs: ui-build-<short>.log, exe-build-<short>.log. Takes about 12 minutes.
  3. by hand: handoff "What is new" gets a bullet per new fix of round 4; after the CI, a "Checked before publishing" paragraph with the run number.
  4. git -C C:/godspeed/dev/kit-publish push --force-with-lease origin release/second-edition-publish     (test branch only)
     git -C C:/godspeed/dev/mc-installer-clean-test-second-edition push origin second-edition-release     (starts clean-install.yml; ~35 min, Windows jobs longest)
     optional, tests only: v2-integrated.yml dispatch on the publish branch (POST .../actions/workflows/v2-integrated.yml/dispatches {"ref":"release/second-edition-publish"}) = the image gate
  5. read results: release-prep\watch-runs.sh mc-installer-clean-test:<run id> ; release-prep\job-log.sh <repo> <run> <job name part>
State left for the re-run: test worktree is on branch second-edition-release with d961176 (tool-test fix, cherry-picked, NOT pushed yet - the step-4 push carries it).
DRY=1 checked for both text sources (TEXT_FROM=f873615 -> 43a4e5d, default -> cbfc71c): patches apply, names swapped.
- Variant run 1 37968411759 (cbfc71c, old tool-test step): windows-fresh ALL PASS (book checks), only the launchers harness stop; windows-upgrade ALL PASS; linux both SUCCESS.
- Variant run 2 37970410110 (cd2ae04: TMPDIR=$RUNNER_TEMP/tmp): windows-fresh ALL PASS again, launchers now 43/0, BUT test-work.sh 71/2 and test-work-run.sh 36/10
  (they passed with the default TEMP) -> a D: temp folder breaks them; windows-upgrade SUCCESS; linux both SUCCESS; macOS same 5.
  Debug: tool tests with a long C: TEMP (cygpath -l) on windows-latest.
- 20:39 workflow: long C: TEMP for tool tests (ef203f7 on second-edition-release, NOT pushed; 969d92a on second-edition-release-cbfc71c, pushed -> run 37974737756)
- 1d1563c on release/second-edition-publish-cbfc71c: "Checked before publishing" paragraph (runs 37968411759/37970410110, image 37965765819); pushed.
- Final run on the variant with the finished workflow: 37974737756 (pending at report time).
- FINAL STATE (report time): git -C C:\godspeed status --short = empty. kit-release untouched at 43a4e5d. All checkouts clean.
  Nothing published: no push to main / codex/godspeed-v2-completeness / codex/godspeed-v2-native-integration, no tag, no release, no image, no server.
