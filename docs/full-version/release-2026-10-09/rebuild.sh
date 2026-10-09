#!/usr/bin/env bash
# rebuild.sh <new product commit> [<new kit-bootstrap commit>]
#
# Rebuilds release godspeed-v2-integrated-2026-10-09-1 for a newer product commit (a fix that
# landed on release/second-edition) and, if given, a newer kit-bootstrap commit. Publishes nothing.
# Every place that names the product commit is handled here (notes.md, "Where the commit is named").
#
#   1. the build checkout (dev/kit-publish-build, detached) moves to the new commit; notebook UI built
#      with Node 22.19.0
#   2. GodspeedSetup.exe built by kit-bootstrap's windows/build-full-alpha.ps1 (kit-bootstrap's
#      worktree HEAD must be the bootstrap commit)
#   3. assets staged in release-prep/assets-<short>/: exe, manifest (BOM and CR removed), the Linux
#      installer, the source archive, SHA256SUMS
#   4. dev/kit-publish: release/second-edition-publish is remade on the new commit (the old head is
#      kept as release/second-edition-publish-<old short>), with the same text changes, the pins and
#      hashes swapped, and the new binaries: one commit
#   5. dev/mc-installer-clean-test-second-edition: release.env, the exe and the installer swapped,
#      committed (push it yourself, after force-pushing the publish branch, to run the test)
#
# Run from Git Bash. Never with a current folder inside C:\godspeed's own files (it cds itself).
set -euo pipefail
NEW=${1:?new product commit}; NEW_BOOT=${2:-}
DEV=/c/godspeed/dev
PUB=$DEV/kit-publish; BUILD=$DEV/kit-publish-build; KB=$DEV/kit-bootstrap-second-edition; TEST=$DEV/mc-installer-clean-test-second-edition
HERE=$(cd "$(dirname "$0")" && pwd)
NODE_DIR=$HERE/node-v22.19.0-win-x64
# TEXT_FROM: the publish commit whose README, handoff entry and installers are replayed onto the new
# commit with every name swapped. Default 6481e59: the 43a4e5d build's texts BEFORE its run-specific
# "Checked before publishing / known defect" paragraph. For a head that contains the daily round fix
# (cbfc71c), use TEXT_FROM=f873615 (the cbfc71c build, whose handoff names that fix).
TEXT_FROM=${TEXT_FROM:-6481e59}
OLD_PUBLISH_HEAD=$(git -C "$PUB" rev-parse "$TEXT_FROM^{commit}")
OLD=$(git -C "$PUB" show "$OLD_PUBLISH_HEAD:install-godspeed.sh" | sed -n 's/^export GODSPEED_PRODUCT_REF=//p')
OLD_BOOT=$(git -C "$PUB" show "$OLD_PUBLISH_HEAD:install-godspeed.sh" | sed -n 's/^KB_BRANCH=//p')
OLD_SH_SHA=$(git -C "$PUB" show "$OLD_PUBLISH_HEAD:install-godspeed.sh" | sha256sum | cut -d' ' -f1)
[ ${#OLD} = 40 ] && [ ${#OLD_BOOT} = 40 ] || { echo "cannot read the pins of $TEXT_FROM"; exit 1; }
DRY=${DRY:-0}   # DRY=1: only steps 4 and 5's text work, into a scratch copy, for checking this script

git -C "$PUB" fetch -q origin
NEW=$(git -C "$PUB" rev-parse "$NEW^{commit}")
git -C "$PUB" merge-base --is-ancestor "$OLD" "$NEW" || echo "note: $NEW does not contain $OLD (a rebuilt release candidate?)"
[ -n "$NEW_BOOT" ] && NEW_BOOT=$(git -C "$KB" rev-parse "$NEW_BOOT^{commit}") || NEW_BOOT=$OLD_BOOT
S=${NEW:0:7}; OS=${OLD:0:7}; SB=${NEW_BOOT:0:7}; OSB=${OLD_BOOT:0:7}
A=$HERE/assets-$S
echo "product $OS -> $S, kit-bootstrap $OSB -> $SB"

if [ "$DRY" != 1 ]; then
  echo "== 1. build checkout and the notebook's pages"
  git -C "$BUILD" checkout -q --detach "$NEW"
  [ -z "$(git -C "$BUILD" status --porcelain --untracked-files=no)" ] || { echo "the build checkout is not clean"; exit 1; }
  ( export PATH="$NODE_DIR:$PATH"; cd "$BUILD/notebook/ui" && node --version && npm ci --no-audit --no-fund && npm run build ) > "$HERE/ui-build-$S.log" 2>&1 \
    || { echo "UI build failed: $HERE/ui-build-$S.log"; exit 1; }
  echo "== 2. GodspeedSetup.exe"
  [ "$(git -C "$KB" rev-parse HEAD)" = "$NEW_BOOT" ] || { echo "kit-bootstrap's worktree is not at $NEW_BOOT"; exit 1; }
  [ -z "$(git -C "$KB" status --porcelain --untracked-files=no)" ] || { echo "kit-bootstrap's worktree is not clean"; exit 1; }
  ( cd "$HERE" && powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w "$KB/windows/build-full-alpha.ps1")" -KitCheckout "$(cygpath -w "$BUILD")" ) > "$HERE/exe-build-$S.log" 2>&1 \
    || { echo "exe build failed: $HERE/exe-build-$S.log"; exit 1; }
  echo "== 3. assets"
  mkdir -p "$A"
  cp "$KB/windows/dist/GodspeedSetup-Full-Alpha.exe" "$A/GodspeedSetup.exe"
  sed '1s/^\xEF\xBB\xBF//' "$KB/windows/dist/candidate-manifest.json" | tr -d '\r' > "$A/windows-manifest.json"
  node -e "const m=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));if(m.kitCommit!==process.argv[2]||m.bootstrapCommit!==process.argv[3]){console.error('manifest names',m.kitCommit,m.bootstrapCommit);process.exit(1)}" "$(cygpath -w "$A/windows-manifest.json")" "$NEW" "$NEW_BOOT"
  git -C "$PUB" archive --format=tar.gz --prefix=godspeed-mission-control/ -o "$A/Godspeed-v2-integrated-source.tar.gz" "$NEW"
fi
mkdir -p "$A"
git -C "$PUB" show "$OLD_PUBLISH_HEAD:install-godspeed.sh" | sed "s/$OLD/$NEW/g; s/$OLD_BOOT/$NEW_BOOT/g" > "$A/install-godspeed.sh"
NEW_SH_SHA=$(sha256sum "$A/install-godspeed.sh" | cut -d' ' -f1)
if [ "$DRY" != 1 ]; then
  ( cd "$A" && sha256sum GodspeedSetup.exe install-godspeed.sh windows-manifest.json Godspeed-v2-integrated-source.tar.gz | sed 's/ \*/  /' > SHA256SUMS && cat SHA256SUMS )
  sed -E "s/installs product [0-9a-f]{7} exactly/installs product $S exactly/" "$HERE/release-notes.md" > "$A/release-notes.md"
fi

echo "== 4. the publish branch"
W=$PUB; if [ "$DRY" = 1 ]; then W=$DEV/kit-publish-dry; rm -rf "$W"; git -C "$PUB" worktree add -q --detach "$W" "$OLD_PUBLISH_HEAD"; fi
# VARIANT=1: build beside the prepared release instead of replacing it: branch release/second-edition-publish-<new>
# in its own worktree dev/kit-publish-<new>, and test branch second-edition-release-<new>.
VARIANT=${VARIANT:-0}; TARGET=release/second-edition-publish; TEST_BRANCH=second-edition-release
if [ "$VARIANT" = 1 ]; then TARGET=release/second-edition-publish-$S; TEST_BRANCH=second-edition-release-$S; W=$DEV/kit-publish-$S; fi
patch=$HERE/publish-text-$S.patch
git -C "$PUB" diff "$OLD" "$OLD_PUBLISH_HEAD" -- README.md docs/full-version/trial-handoff.md install-godspeed.sh installers/install-godspeed.sh \
  | sed "s/$OLD/$NEW/g; s/$OLD_BOOT/$NEW_BOOT/g; s/$OLD_SH_SHA/$NEW_SH_SHA/g; s/product $OS\b/product $S/g; s/kit-bootstrap $OSB\b/kit-bootstrap $SB/g" > "$patch"
if [ "$DRY" = 1 ]; then git -C "$W" checkout -q --detach "$NEW"; elif [ "$VARIANT" = 1 ]; then
  git -C "$PUB" worktree add -q -B "$TARGET" "$W" "$NEW"
else
  git -C "$PUB" branch -f "release/second-edition-publish-before-$S" "$(git -C "$PUB" rev-parse release/second-edition-publish)"
  git -C "$PUB" checkout -q -B release/second-edition-publish "$NEW"
fi
git -C "$W" apply --index "$patch"
if [ "$DRY" != 1 ]; then
  cp "$A/GodspeedSetup.exe" "$A/windows-manifest.json" "$A/SHA256SUMS" "$W/installers/"
  git -C "$W" add installers/GodspeedSetup.exe installers/windows-manifest.json installers/SHA256SUMS
fi
cmp "$W/install-godspeed.sh" "$A/install-godspeed.sh" && cmp "$W/installers/install-godspeed.sh" "$A/install-godspeed.sh"
grep -q "$NEW_SH_SHA" "$W/README.md"
if grep -n "$OLD\|$OLD_SH_SHA" "$W/README.md" "$W/install-godspeed.sh" "$W/installers/install-godspeed.sh"; then echo "the old commit or checksum is still named above"; exit 1; fi
echo "   still naming $OS in the handoff (check by eye; only history may):"; grep -n "$OS" "$W/docs/full-version/trial-handoff.md" | cut -c1-160 || true
if [ "$DRY" = 1 ]; then git -C "$W" diff --cached --stat; git -C "$PUB" worktree remove --force "$W"; echo "DRY RUN done"; exit 0; fi
git -C "$W" commit -q -F - <<EOF
Release godspeed-v2-integrated-2026-10-09-1 rebuilt for product $S (kit-bootstrap $SB)

The same release as $OS's (README, handoff entry, installers) for the newer release candidate
$NEW. GodspeedSetup.exe built by build-full-alpha.ps1 from kit-bootstrap $NEW_BOOT;
install-godspeed.sh $NEW_SH_SHA.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
EOF
git -C "$W" log --oneline -2

echo "== 5. the clean-install test branch"
if git -C "$TEST" rev-parse -q --verify "refs/heads/$TEST_BRANCH" >/dev/null; then git -C "$TEST" checkout -q "$TEST_BRANCH"; else git -C "$TEST" checkout -q -b "$TEST_BRANCH"; fi
sed -i "s#^KIT_BRANCH=.*#KIT_BRANCH=$TARGET#; s/^PRODUCT=.*/PRODUCT=$NEW/; s/^BOOTSTRAP=.*/BOOTSTRAP=$NEW_BOOT/" "$TEST/release.env"
cp "$A/GodspeedSetup.exe" "$TEST/GodspeedSetup.exe"; cp "$A/install-godspeed.sh" "$TEST/install-godspeed.sh"
git -C "$TEST" add release.env GodspeedSetup.exe install-godspeed.sh
git -C "$TEST" commit -q -m "Test the release rebuilt for product $S (kit-bootstrap $SB)"
echo "Next: git -C $W push --force-with-lease origin $TARGET  (a test branch, never main)"
echo "      git -C $TEST push origin $TEST_BRANCH   (starts the clean install run)"
