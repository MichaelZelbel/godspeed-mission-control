> Historical record from the previous repository. The old commit IDs, workflow runs, release assets and checksums below are archive references. They are not instructions or acceptance evidence for the fresh public repository. The first beta must be rebuilt and checked against its new commits before publication.

# The first beta, `godspeed-v2-integrated-2026-10-19-1` (2.0.0-beta.1): built and gated, not published

Prepared on 18 October 2026 at the maintainer's request, from the beta round of that day (the product's
`release/beta-2026-10-18`, kit-bootstrap's `release/beta-2026-10-18`, the website's
`beta/guide-2026-10-18`). Nothing here is published: the GitHub release is a draft, no tag exists, product
main, kit-bootstrap main and the website are untouched, and no short link moved. `publish-list.md` is
what runs after the maintainer's yes.

- `publish-list.md`: the publish steps in order, each with its check, and the record lines.
- `build-exe.sh`: how the Windows setup and the release files were built.
- `pin-image.sh`: after main publishes the image, pins it for Hostinger and the one-line server.
- `site-pin.mjs`: the same image in the website's copy of the Hostinger coordinator.
- `release-notes.md`: the GitHub release's text (the draft carries it).

## What is in it

| | |
|---|---|
| release commit (the tag, what main becomes) | `0b17b10868f54f6301420231f4104253f518ed82` on `release/beta-2026-10-18` |
| product it installs | `725f6f659da4a7be6f1b9d2e273f59c7a015e2e8`: main f8e47e1 plus the beta round's 88 commits |
| kit-bootstrap | `86da1dd27fea804ab131a8494b79a2ccf868e847`: 5136582 (the beta's Windows work) plus a merge of its main that changes no file, so main can be fast-forwarded to it |
| draft release | https://github.com/MichaelZelbel/godspeed-mission-control/releases (id 416669391, five files, not latest) |
| GodspeedSetup.exe | 60,260,317 bytes, `3c05166ae7d52ca7b90f95f42499c1469c74e809568172057b04e93739e9f702` |
| install-godspeed.sh | `78799a903784bdf49e3a3f72d20555ea040f6d2bbb7bfdc7a416838e75864184` |
| windows-manifest.json | `d35a8c1ec138290722cb015a172b5da712baf9e1488d9fc6c8eabb6fcb59ae6f` (version 2.0.0-beta.1, kitCommit 725f6f6, bootstrapCommit 86da1dd, 5,512 files) |
| source archive | `9421cc5aa142d8b8ee4518734e51dfd4fd699923403a2f8c73c2e027b3641b26` (`git archive --prefix=godspeed-mission-control/` of 725f6f6) |
| website | `beta/guide-2026-10-18` at 65c1cd7: main's four newer commits merged in (so main fast-forwards), every page's `release` and the two checksum lines name this release |

The server image cannot be pinned in the release commit: "Integrated Godspeed v2" publishes
`v2-sha-<commit>` only from main, so the pin follows main's push (publish list, step 5), as on every
release since 9 October.

## How it was built

`build-exe.sh 725f6f6` with BUILD a detached product worktree and KB kit-bootstrap at 86da1dd: the
notebook's pages with Node 22.19.0, the setup with kit-bootstrap's `windows/build-full-alpha.ps1` under
Windows PowerShell 5.1 and Inno Setup 6. Then `install-godspeed.sh` (and `installers/install-godspeed.sh`)
had their product, starter, kit-bootstrap and notebook-hook pins moved from 6996712 and 11daa48 to 725f6f6
and 86da1dd, the binaries were copied into `installers/`, SHA256SUMS written, and README and the trial
handoff got the release's name, links, checksum and what is new: one commit, 0b17b10. The draft's five
files were downloaded back: `sha256sum -c` OK, identical to the tested files.

## The gates, all on the exact release commit 0b17b10

The release changes the goal loop, so both gates of `release-contract.md` ("Before a release that touches
the goal loop") apply, and the goal loop's own acceptance with Hermes was run as well.

1. **Windows, fresh and as the update over 18-1: passed.** kit-bootstrap's beta-windows workflow on the test
   branch `test/beta-2026-10-19-1` (8dba87a), run https://github.com/MichaelZelbel/kit-bootstrap/actions/runs/39160620842:
   the workflow of 86da1dd with one change, the installer under test is the release commit's own
   `installers/GodspeedSetup.exe` and `windows-manifest.json`, fetched from 0b17b10 and refused unless their
   checksums match (the build printed `candidate: kitCommit 725f6f6..., bootstrapCommit 86da1dd...,
   version 2.0.0-beta.1` and `3c05166a...`). install fresh and install update (install, the older
   installer refused, "look for an update", uninstall) ALL PASS; the wizard on screen, fresh and update,
   its last page read; the Windows suite under Windows PowerShell 5.1 and `test.sh` on Ubuntu: all seven
   jobs green.
2. **Clean install, linux-fresh: passed** (`##### JOB fresh: success`). The clean-install test repository's
   branch `release-725f6f6`, made from `v2` (3fad06a) with `release.env` naming product 725f6f6, kit-bootstrap
   86da1dd, previous release 18-1 (6996712), and the release's exact GodspeedSetup.exe and
   install-godspeed.sh; run with `local-linux/wsl-job.sh fresh` in a throwaway WSL distro on the
   maintainer's PC ("main is now 0b17b10868f5... (release/beta-2026-10-18)"). The first goal started all
   seven routines the installed notebook names, the goal day with the stand-in passed (research,
   decision, the work with its own check, the daily round's two routines), and all eleven tool suites
   passed with 0 failed. Log: that branch's `results/2026-10-18/fresh-20261018T195023Z.log`. linux-upgrade
   over 18-1 the same way: `##### JOB upgrade: success` (`upgrade-20261018T195825Z.log`).
3. **Goal-day acceptance on the server: NOT passed, twice, both times in the work step, for a reason
   in the acceptance script rather than the product.** The engine copy on the maintainer's server
   (f8ae70a), in its throwaway container, `--kit-ref 0b17b10868f54f6301420231f4104253f518ed82` (no `--pin-kit-ref`: the release
   commit pins what it ships). Both runs: "kit commit under test" and "installed commit" name 0b17b10,
   the installer finished, the first goal started all 7 routines, the founding research night passed
   `mc-check-research`, a real decision was written and `mc-check-moves` passed. Then:
   - `<private acceptance log>`: the decision's one move was the
     person's (choose a race date from a page the mission control writes, W-20261018-06 OWNER person; the
     page itself, W-20261018-05 OWNER godspeed, planned, carried no bet). The script follows only a bet
     on a step the mission control does itself, so it found none: "the decision bet on no step the
     mission control does itself".
   - `<private acceptance log>`: two moves, the second on a step the
     mission control does (W-20261018-05, start a run log). A new goal has no standing permission, so the
     decision put both on the day's ship list, as the next-action recipe says (`PERMISSION: ship list`,
     NEEDS authorization, blocked until the person answers). The script ran `mc-work-run` on it without
     answering the ship list, and the runner rightly ran nothing: "W-20261018-05 is not verified
     (STATUS: blocked)".
   The product's own goal-loop harness learnt the second case on 18 October (8c596e8): when the
   decision's own steps wait on the ship list, the person answers "ship all" (`mc-work unblock <id>
   --why "ship list answer" --approved-by "ship all"`) and the first such step is followed. The engine's
   `scripts/acceptance/goal-day.sh` (f8ae70a) does not have that yet; with it, the second run would have
   gone on to the work. The first case fails both harnesses alike: a first decision that bets only on
   the person's step leaves no step of the mission control's own to follow.
4. **Goal loop with Hermes and a free model: GOAL-LOOP-PENDING**

Also on the release commit, beyond the contract's gates:

- Integrated Godspeed v2 on the release branch (run https://github.com/MichaelZelbel/godspeed-mission-control/actions/runs/39160508699,
  tests only, nothing published): the native Linux install, upgrade and recovery; the in-image notebook
  suite; the image built and a fresh installed server checked in a browser.
- Mac and Linux installers (run 39160502307, on the push of 0b17b10): green.
- guide-check: every guide page this release touches is reviewed (install-linux, install-mac,
  install-windows, update); the website's `beta/guide-2026-10-18` names the release, its 80 tests pass
  (2 skipped), `guide-lint` "65 pages, no problems", and the site builds and type-checks.
