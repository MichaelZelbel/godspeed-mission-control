# Publish list: godspeed-v2-integrated-2026-10-09-1 (runs only on Michael's yes)

Two builds are ready; publish ONE.

| | A: the release candidate as briefed | B: recommended, A plus the daily round fix |
|---|---|---|
| product commit | 43a4e5dfc694c1ddbbf779d1124742a0f1bd3792 | cbfc71c58b66f3f8f4fa9613b6ae74c70b7499fc (one commit on 43a4e5d) |
| publish branch (pushed, test only) | release/second-edition-publish, worktree dev/kit-publish | release/second-edition-publish-cbfc71c, worktree dev/kit-publish-cbfc71c |
| assets | release-prep/assets-43a4e5d | release-prep/assets-cbfc71c |
| GodspeedSetup.exe | 57,341,688 bytes, 29fea3a06f3847fd9ada67305cbe4359809e2fa7d507a5e55637b7d081e7ae30 | 57,339,046 bytes, e2048e3648e35674057eb44b45537e2a3b422bc9bf3267aba66a303d6b58e8e7 |
| install-godspeed.sh | 60ef989ae0c90d6f7eb9466ce4c9b9c7c4f3f917960dffdf5ca6f7ed51e32227 | 52029670b665ce53bbb200033f5bb6a755c46b850554ded9a49c79b2688895c6 |
| image tests (Integrated Godspeed v2) | FAIL, run 37964246669: no image can be published (steps 6 to 8 impossible) | PASS, run 37965765819 |
| daily round on Linux, Mac, one-click server | stops: "mc-run is not installed" | works |

For B, the branch's owner first makes cbfc71c the release candidate (a fast-forward; cbfc71c is on GitHub already):
    git -C C:/godspeed/dev/kit-release merge --ff-only fix/daily-round-finds-mc-run
If release/second-edition gets any other commit instead or as well, rebuild:
`bash release-prep/rebuild.sh <new head>` (VARIANT=1 to build beside), then rerun the clean install.

Below, `K` is the chosen worktree and `BR` its branch: A: `K=C:/godspeed/dev/kit-publish BR=release/second-edition-publish`,
B: `K=C:/godspeed/dev/kit-publish-cbfc71c BR=release/second-edition-publish-cbfc71c`. `KB=C:/godspeed/dev/kit-bootstrap-second-edition`,
`AS=<scratchpad>/release-prep/assets-<43a4e5d or cbfc71c>`, `HEAD_SHA=$(git -C $K rev-parse $BR)`, `SH=<install-godspeed.sh sha256 from the table>`.
Run from Git Bash. gh needs `gh auth login` once (it is not signed in on this PC); every gh step can also be done on github.com by hand.

## 0. Before anything: still true?
- `git -C $K fetch origin && git -C $K merge-base --is-ancestor origin/main $HEAD_SHA` exits 0 (main has not moved
  past the release; if it has, remake the branch on top: rebuild.sh).
- The clean install run on the final commits is green (mc-installer-clean-test, branch second-edition-release for A, second-edition-release-cbfc71c for B).
- For step 6: Integrated Godspeed v2 green on this product commit (A: red, B: green; table above).

## 1. kit-bootstrap: the setup's pinned commit stays on GitHub
    git -C $KB push origin c91da3a4aa2a1c71f123548ca1aaef08366dcf90:refs/heads/codex/godspeed-v2-native-integration
Fast-forward from e62f38b (no workflow runs on that branch). Check:
    git ls-remote https://github.com/MichaelZelbel/kit-bootstrap refs/heads/codex/godspeed-v2-native-integration   # c91da3a...
    curl -fsSI https://raw.githubusercontent.com/MichaelZelbel/kit-bootstrap/c91da3a4aa2a1c71f123548ca1aaef08366dcf90/join.ps1 | head -1           # 200
    curl -fsSI https://raw.githubusercontent.com/MichaelZelbel/kit-bootstrap/c91da3a4aa2a1c71f123548ca1aaef08366dcf90/setup-godspeed.sh | head -1   # 200

## 2. main becomes the release (starter, commands and the one-liner come from main)
    git -C $K push origin $BR:main
Fast-forward from f6956cb. Check:
    git ls-remote https://github.com/MichaelZelbel/godspeed-mission-control refs/heads/main          # = $HEAD_SHA
    curl -fsSL https://raw.githubusercontent.com/MichaelZelbel/godspeed-mission-control/main/install-godspeed.sh | sha256sum
        # = $SH (raw can lag up to 5 minutes)
What else this push starts, as on 7 October: docker.yml on main (docker/ and server/ changed) tests and then publishes
ghcr.io/michaelzelbel/godspeed-mission-control:latest and :sha-<head> (the plain Docker image), and tools-test runs.
Check both runs are green on github.com/MichaelZelbel/godspeed-mission-control/actions.

## 3. The GitHub release, marked latest
    gh release create godspeed-v2-integrated-2026-10-09-1 --repo MichaelZelbel/godspeed-mission-control \
      --target $HEAD_SHA --latest \
      --title "Godspeed Mission Control v2 for the book's second edition (9 October)" \
      --notes-file $AS/release-notes.md \
      $AS/GodspeedSetup.exe $AS/install-godspeed.sh $AS/windows-manifest.json $AS/Godspeed-v2-integrated-source.tar.gz $AS/SHA256SUMS
Check, downloading everything back:
    mkdir -p /tmp/back && cd /tmp/back && for f in GodspeedSetup.exe install-godspeed.sh windows-manifest.json Godspeed-v2-integrated-source.tar.gz SHA256SUMS; do
      curl -fsSLO https://github.com/MichaelZelbel/godspeed-mission-control/releases/download/godspeed-v2-integrated-2026-10-09-1/$f; done
    sha256sum -c SHA256SUMS                                          # 4 x OK
    cmp SHA256SUMS $AS/SHA256SUMS && cmp GodspeedSetup.exe $AS/GodspeedSetup.exe   # identical to what was tested

## 4. releases/latest points at it
    curl -s https://api.github.com/repos/MichaelZelbel/godspeed-mission-control/releases/latest | grep '"tag_name"'   # godspeed-v2-integrated-2026-10-09-1
    curl -sI https://github.com/MichaelZelbel/godspeed-mission-control/releases/latest/download/GodspeedSetup.exe | grep -i '^location'
        # .../releases/download/godspeed-v2-integrated-2026-10-09-1/GodspeedSetup.exe

## 5. The short links land on it
    curl -sI https://teachitonce.com/windows | grep -i '^location'
        # today: .../godspeed-mission-control/releases (the list; the new release is first, marked Latest).
        # teach-it-once branch book/second-edition d1ef4c9 (not pushed, not deployed) changes it to /releases/latest.
        # Either way: open it and see godspeed-v2-integrated-2026-10-09-1 with GodspeedSetup.exe.
    curl -sI https://godspeedmissioncontrol.com/windows | grep -i '^location'    # .../releases (same check)
    curl -fsSL -A "selftest release check" https://godspeedmissioncontrol.com/install | sha256sum   # = $SH (selftest keeps the install count clean)
    curl -fsSL -A "selftest release check" https://teachitonce.com/install | sha256sum               # = $SH

## 6. The image for the one-click server (needs a product commit whose image tests pass)
    git -C $K push origin $HEAD_SHA:refs/heads/codex/godspeed-v2-completeness
Fast-forward from 06746b7. Starts "Integrated Godspeed v2": native Linux install test, image build, the image's whole
notebook suite and a fresh server in a browser; only then it publishes, signs and scans
ghcr.io/michaelzelbel/godspeed-mission-control:v2-sha-$HEAD_SHA. Check the run is green and copy the digest from its
summary line "Published tested image: `ghcr.io/michaelzelbel/godspeed-mission-control@sha256:...`".

## 7. Pin it for Hostinger, then prove the one-click route
    OLD=sha256:c3706e1c1e69d796a666c3682a4b5bb629749e5ab679d2c63e1683cf5f46344e; NEW=sha256:<digest from step 6>
    cd $K   # its branch $BR = main now
    sed -i "s#godspeed-mission-control@$OLD#godspeed-mission-control@$NEW#" docker/hostinger/compose.yaml docker/hostinger/installer/compose.mjs
    git commit -qam "Hostinger installs the image built from ${HEAD_SHA:0:7} (v2-sha-${HEAD_SHA:0:7}, digest ${NEW:7:8}...)"; Y=$(git rev-parse HEAD)
    # docker/hostinger/README.md: in the purchase link replace f3dba17c12650d4bfa5b8c9d2adb6cef95afd3c6 by $Y, and the sentence
    #   "(`v2-sha-b327fe0`, digest `c3706e1c…`, since 7 October 2026; before that `v2-sha-20cdd7b`, digest `351e8a16…`)"
    # by "(`v2-sha-<short>`, digest `<8>…`, since <date>; before that `v2-sha-b327fe0`, digest `c3706e1c…`)";
    # docs/full-version/trial-handoff.md: the sentence "The Hostinger one-click image is still v2-sha-b327fe0; ..." names the new image.
    git commit -qam "Hostinger README: the purchase link names the commit that pins the new image"
    git push origin HEAD:main HEAD:codex/godspeed-v2-completeness
(docker.yml runs on main again for docker/**, as in step 2; Integrated Godspeed v2 does not run for these paths.)
Check without publishing anything: run docker.yml by hand on main twice, edition `hostinger-automatic` and edition
`hostinger` (only the hostinger job runs: it deploys the pinned Compose file on a throwaway runner; the publish job
needs the test job, which these editions skip). Never pick edition `full`: that one publishes.

## 8. The installer page on srv1069233 (the test server; production is not involved)
    ssh -i C:/godspeed/secrets/claude-desktop_ed25519 root@100.73.52.50
      cp -a /opt/godspeed-hostinger-installer /opt/godspeed-hostinger-installer.bak-$(date +%Y%m%d)
    git -C $K archive $Y docker/hostinger/installer | ssh -i ... root@100.73.52.50 \
      'tar -x --strip-components=3 -C /opt/godspeed-hostinger-installer && systemctl restart godspeed-installer && systemctl is-active godspeed-installer'
Check:
    ssh ... root@100.73.52.50 "grep -c '$NEW' /opt/godspeed-hostinger-installer/compose.mjs"        # 1
    curl -fsS -o /dev/null -w '%{http_code}\n' https://srv1069233.hstgr.cloud/godspeed-install       # 200
    # one prepared installation from the page (expires unfetched after an hour) shows the new digest in its Compose file

## 9. Afterwards
- Mission Control's own record (decisions.md entry, where-things-live's kit section) names the release, the image and the pins.
- Delete the test branches when done: godspeed-mission-control release/second-edition-publish,
  release/second-edition-publish-cbfc71c and fix/daily-round-finds-mc-run (after main has the chosen one),
  kit-bootstrap fix/second-edition-installer (after step 1), mc-installer-clean-test debug-daily-round
  (second-edition-release and second-edition-release-cbfc71c can stay as the record of the test).
- Way back, if a reader reports a broken setup: `gh release edit godspeed-v2-integrated-2026-10-07-2 --latest` makes the
  previous release the latest again; main is moved back with a revert commit, never a force push.
