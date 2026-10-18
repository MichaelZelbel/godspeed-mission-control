> Historical record from the previous repository. The old commit IDs, workflow runs, release assets and checksums below are archive references. They are not instructions or acceptance evidence for the fresh public repository. The first beta must be rebuilt and checked against its new commits before publication.

# Publish list: godspeed-v2-integrated-2026-10-19-1, the first beta (runs only on the maintainer's yes)

Everything below is outward: it changes what readers download. It is run by the session that has the
maintainer's own yes, in this order, each step with its check. Nothing here has been done; the draft
release, the release commit and the website branch are ready (`README.md` beside this file says what
was built and what each gate showed).

Run from Git Bash. `gh` is signed in as the maintainer on this PC.

    REPO=MichaelZelbel/godspeed-mission-control
    REL=godspeed-v2-integrated-2026-10-19-1
    DRAFT_ID=416669391                                   # the draft release (no tag exists until step 3)
    C=0b17b10868f54f6301420231f4104253f518ed82          # the release commit: the tag, and what product main becomes
    P=725f6f659da4a7be6f1b9d2e273f59c7a015e2e8          # the product commit it installs (2.0.0-beta.1)
    KB=86da1dd27fea804ab131a8494b79a2ccf868e847         # kit-bootstrap: what its main becomes
    SH=78799a903784bdf49e3a3f72d20555ea040f6d2bbb7bfdc7a416838e75864184   # install-godspeed.sh
    EXE=3c05166ae7d52ca7b90f95f42499c1469c74e809568172057b04e93739e9f702  # GodspeedSetup.exe
    K=<a product checkout on a branch level with release/beta-2026-10-18>
    KBC=<a kit-bootstrap checkout>
    SITE=<a website checkout on a branch level with beta/guide-2026-10-18, its tools installed>
    HERE=$K/docs/full-version/release-beta-2026-10-19

## 0. Still true?

    git ls-remote https://github.com/$REPO refs/heads/main                                    # f8e47e1df7b4df3b9c9b5898445b5156fc4fbce6
    git ls-remote https://github.com/MichaelZelbel/kit-bootstrap refs/heads/main              # 0390fa7677c591f92806166cd00ecf10f5373a4f
    git -C $SITE ls-remote origin refs/heads/main                                             # 87281867ace934253934428b41739308336d552a
    git -C $SITE ls-remote origin refs/heads/beta/guide-2026-10-18                            # 65c1cd78ae101b9bb763640ea096e3ad6670b456 (or newer)

Each of those mains must be an ancestor of what it becomes (`git merge-base --is-ancestor <main> <new>`
in a fetched checkout). If product main moved, the release is rebuilt on top (README.md here, "How it
was built"); if kit-bootstrap's or the website's main moved, merge it into the release branch first,
as was done for both on 18 October. The four gates in README.md here are green for `$C`. The draft
still holds the five files:

    mkdir -p /tmp/draft && cd /tmp/draft && gh api repos/$REPO/releases/$DRAFT_ID/assets --jq '.[] | "\(.id) \(.name)"' |
      while read id name; do gh api -H "Accept: application/octet-stream" repos/$REPO/releases/assets/$id > "$name"; done
    sha256sum -c SHA256SUMS                                                                   # 4 x OK, GodspeedSetup.exe = $EXE

## 1. kit-bootstrap: main becomes the beta's shared installer

    git -C $KBC fetch origin
    git -C $KBC push origin $KB:refs/heads/main

A fast-forward from 0390fa7: 86da1dd records main's five own commits as merged (each a copy of a change
the release line carries in its own form) without changing a file. The setups name `$KB` by commit, so
this changes nothing a reader installs; it ends the default branch lagging the branch releases ship
from. `codex/godspeed-v2-native-integration` stays at fd52d43 (an ancestor). Check:

    git ls-remote https://github.com/MichaelZelbel/kit-bootstrap refs/heads/main              # $KB
    curl -fsSI https://raw.githubusercontent.com/MichaelZelbel/kit-bootstrap/$KB/join.ps1 | head -1            # 200
    curl -fsSI https://raw.githubusercontent.com/MichaelZelbel/kit-bootstrap/$KB/setup-godspeed.sh | head -1   # 200

On main this starts only the `guide` workflow (green on the release branch for the same commits).

## 2. Product main becomes the release commit

    git -C $K push origin $C:refs/heads/main

A fast-forward from f8e47e1. From here `/install` on both sites and the README's one-liner give the beta
(they read main's `install-godspeed.sh`), and `/server` gives main's `docker/server/install.sh`, which
installs the image `docker/hostinger/compose.yaml` pins: still the 18 October image until step 5. Check:

    git ls-remote https://github.com/$REPO refs/heads/main                                    # $C
    curl -fsSL https://raw.githubusercontent.com/$REPO/main/install-godspeed.sh | sha256sum   # $SH (raw can lag up to 5 minutes)

This push starts, on main: Integrated Godspeed v2 (it publishes `v2-sha-$C`, step 5), docker.yml (it tests
and then publishes the plain image's `:latest`, as every push touching `docker/` does), Mac and Linux
installers, tools-test and guide. All should end green on github.com/$REPO/actions.

## 3. The GitHub release: the draft is published, marked latest

    gh api -X PATCH repos/$REPO/releases/$DRAFT_ID -F draft=false -f make_latest=true --jq '.html_url, .tag_name, .target_commitish'

Publishing creates the tag `$REL` on `$C`. It is a full release, not a pre-release, so that
`releases/latest` and godspeedmissioncontrol.com/windows (the release list, newest first) land on it.
Check, downloading everything back:

    git ls-remote --tags https://github.com/$REPO "refs/tags/$REL"                            # $C
    curl -s https://api.github.com/repos/$REPO/releases/latest | grep '"tag_name"'             # $REL
    mkdir -p /tmp/back && cd /tmp/back && for f in GodspeedSetup.exe install-godspeed.sh windows-manifest.json Godspeed-v2-integrated-source.tar.gz SHA256SUMS; do
      curl -fsSLO https://github.com/$REPO/releases/download/$REL/$f; done
    sha256sum -c SHA256SUMS                                                                   # 4 x OK
    cmp install-godspeed.sh <(git -C $K show $C:install-godspeed.sh) && echo same-as-main
    curl -sI https://github.com/$REPO/releases/latest/download/GodspeedSetup.exe | grep -i '^location'   # .../download/$REL/GodspeedSetup.exe

## 4. The short links land on it (nothing to change; they follow main and releases/latest)

    curl -fsSL -A "selftest release check" https://godspeedmissioncontrol.com/install | sha256sum   # $SH ("selftest" is not counted)
    curl -fsSL -A "selftest release check" https://teachitonce.com/install | sha256sum               # $SH
    curl -fsSL -A "selftest release check" https://godspeedmissioncontrol.com/server | cmp - <(git -C $K show $C:docker/server/install.sh) && echo server-ok
    curl -fsSL -A "selftest release check" https://teachitonce.com/server | cmp - <(git -C $K show $C:docker/server/install.sh) && echo server-ok
    curl -sI https://godspeedmissioncontrol.com/windows | grep -i '^location'   # .../releases: open it, the beta is first and marked Latest
    curl -sIL https://teachitonce.com/windows | grep -i '^location'             # .../releases/latest -> .../releases/tag/$REL

## 5. The image for the one-line server and Hostinger

Wait for Integrated Godspeed v2 on main for `$C` (about 25 minutes). If its browser check stops after the
server's restart (the wait for the Import page that has failed now and then since 6 October), re-run the
failed job once: `gh run rerun <run id> --repo $REPO --failed`. When it is green, read the digest back
from ghcr.io:

    T=$(curl -fsSL "https://ghcr.io/token?scope=repository:michaelzelbel/godspeed-mission-control:pull" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
    curl -fsSI -H "Authorization: Bearer $T" -H "Accept: application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.oci.image.index.v1+json" \
      https://ghcr.io/v2/michaelzelbel/godspeed-mission-control/manifests/v2-sha-$C | grep -i docker-content-digest
    # it must equal the "Published tested image" line of the run's summary; call it D=sha256:...

Pin it (two commits on top of the release branch: compose files, then the README's purchase link):

    cd $K && git fetch origin && git merge --ff-only origin/release/beta-2026-10-18
    bash $HERE/pin-image.sh $D $C              # prints PIN COMMIT <full> (call it Y) and README COMMIT
    git push origin HEAD:release/beta-2026-10-18
    gh workflow run docker.yml --repo $REPO --ref release/beta-2026-10-18 -f edition=hostinger
    gh workflow run docker.yml --repo $REPO --ref release/beta-2026-10-18 -f edition=hostinger-automatic
    # never edition=full: that one publishes. Both deploy the pinned Compose file on a throwaway runner.
    # When both are green:
    git push origin HEAD:main                  # a fast-forward from $C (it also carries this folder's docs commit)

Check: `git -C $K show origin/main:docker/hostinger/compose.yaml | grep -c "${D#sha256:}"` is 1. docker.yml runs
on main again (the pin touches `docker/`), tests and publishes `:latest`, as on every such push.

## 6. The website: the install count's receiver, the beta guide, the image

The installers of this release send the opt-in install count to godspeedmissioncontrol.com/signal/v1, and
the guide branch names this release, so the site goes out right after step 3 (and its image pin with
step 5, or as a second publish if the image takes longer than an hour).

a. The database. Apply the branch's `db/installer.sql` (idempotent; it adds `install_signals`,
   `install_signal_minutes`, `install_signal` and `install_signal_counts` and keeps everything else) to the
   site's Lovable Cloud database: Lovable `query_database` on the site's project with the file's whole
   text. Check: `select proname from pg_proc where proname like 'install_signal%'`
   names both functions.

b. The image pin (after step 5; skip it here if the image is not ready and do it as a second publish):

       node $HERE/site-pin.mjs "$SITE" $D $C $Y
       cd $SITE && node --test tests/*.test.mjs          # 80 tests: pass, 2 skipped (they need the kit checkout beside it)
       git commit -qam "The Hostinger coordinator hands out the first beta's image (v2-sha-${C:0:7}, digest ${D:7:8}...)" && git push origin HEAD:beta/guide-2026-10-18

c. Main becomes the beta guide (a fast-forward: the branch already merged main's four newer commits),
   then the site is checked and published:

       cd $SITE && git fetch origin && git merge-base --is-ancestor origin/main origin/beta/guide-2026-10-18 && git push origin origin/beta/guide-2026-10-18:refs/heads/main
       node scripts/guide-lint.mjs                       # 65 pages, no problems
       # Lovable: get_project until its latest_commit_sha is the pushed commit, then deploy_project.

   Check from outside once the deployment is live:

       curl -fsS https://godspeedmissioncontrol.com/signal/health                                     # answers ok
       curl -fsS https://godspeedmissioncontrol.com/guide/install-linux.md | grep -c 78799a90          # 1
       curl -fsS https://godspeedmissioncontrol.com/guide/install-mac.md | grep -c "$REL"              # 1

   Not part of this release: the Hostinger page's deploy button (`src/lib/hosting.ts`) still names the
   one-click file of product 543e85a (branch codex/hostinger-traefik-compatibility); the Hostinger work
   waits for a Hostinger test server.

## 7. Afterwards

- The product's handoff: a "Published on 19 October 2026" paragraph in `docs/full-version/trial-handoff.md`
  under the first beta's entry (the files, the tag, main's fast-forward, the image and its digest, the
  pin commits, the site commit), committed on main as on 18 October (f6e680d).
- kit-bootstrap's `beta-windows.yml` names the newest published release for its update test
  (`PREVIOUS_RELEASE`, `PREVIOUS_SETUP_SHA256`, `OLDER_PRODUCT`): move them to `$REL`, `$EXE` and `$P` on its
  next change.
- Test branches that can go once published: kit-bootstrap `test/beta-2026-10-19-1` and
  `release-prep/beta-2026-10-19` (local only), product `beta/release-prep` (local only). The clean-install
  test repository's `release-725f6f6` stays as the record.
- Way back, if a reader reports a broken setup: `gh release edit godspeed-v2-integrated-2026-10-18-1 --latest`
  makes the previous release the latest again; main is moved back with a revert commit, never a force push.
- The maintainer's own records name the release, its files' checksums, the image and its digest, the
  pin commits and the site commit.
