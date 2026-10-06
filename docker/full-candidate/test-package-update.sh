#!/usr/bin/env bash
# The packaged server's install.sh and manage.sh, run twice in one folder against a
# stand-in docker, so no Docker is needed (CI, or any computer with bash and Python 3):
#
#   bash docker/full-candidate/test-package-update.sh
#
# A second package's image is the one started, the setup code and the reader's own
# settings stay, the settings before are kept beside them, the data is backed up before
# the switch, a package that does not match its checksums changes nothing, and the setup
# code never appears on a command line. Until 6 October 2026 a second run loaded the new
# image and went on running the old one.
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
fails=0
check() { if eval "$2"; then echo "PASS  $1"; else echo "FAIL  $1"; fails=$((fails+1)); fi; }

mkdir -p "$work/bin" "$work/server"
cat > "$work/bin/docker" <<'SH'
#!/usr/bin/env bash
# Answers like a running server and writes down every call.
printf '%s\n' "$*" >> "$FAKE_LOG"
case "$*" in
  *" ps -q notebook"*) echo 0123456789ab ;;
  *bootstrap*) cat > "$FAKE_STDIN"; echo '/setup#invite=fixture' ;;
esac
exit 0
SH
chmod +x "$work/bin/docker"
export PATH="$work/bin:$PATH" FAKE_LOG="$work/docker.log" FAKE_STDIN="$work/setup-code"
files=(image.tar.gz source.tar.gz compose.yaml Caddyfile install.sh manage.sh manifest.json SHA256SUMS)
package() {  # package <image> <file.tar.gz>
  local dir="$work/package"
  rm -rf "$dir"; mkdir -p "$dir"
  cp "$here/install.sh" "$here/manage.sh" "$here/compose.yaml" "$here/Caddyfile" "$dir/"
  printf 'image %s\n' "$1" > "$dir/image.tar.gz"; echo source > "$dir/source.tar.gz"
  printf '{"image":"%s","caddy":"caddy:pinned"}\n' "$1" > "$dir/manifest.json"
  (cd "$dir" && sha256sum image.tar.gz source.tar.gz compose.yaml Caddyfile install.sh manage.sh manifest.json > SHA256SUMS)
  tar -czf "$2" -C "$dir" "${files[@]}"
}
value() { sed -n "s/^$1=//p" "$work/server/candidate.env"; }

echo '== a first installation'
package godspeed:one "$work/one.tar.gz"
tar -xzf "$work/one.tar.gz" -C "$work/server"
bash "$work/server/install.sh" > "$work/first.out" 2>&1 || { cat "$work/first.out"; exit 1; }
token=$(value GODSPEED_CANDIDATE_TOKEN)
check 'the setup code is a fresh 256-bit value' '[[ "$token" =~ ^[0-9a-f]{64}$ ]]'
check 'the image is the package'"'"'s' '[ "$(value GODSPEED_CANDIDATE_IMAGE)" = godspeed:one ]'
check 'the setup code went in on standard input' '[ "$(cat "$FAKE_STDIN")" = "$token" ]'
check 'and on no command line' '! grep -qF "$token" "$FAKE_LOG"'
check 'the reader gets the private link' 'grep -q "/setup#invite=fixture" "$work/first.out"'

echo '== the next package, through manage.sh upgrade'
printf 'GODSPEED_CANDIDATE_HOST=notebook.example.org\n' >> "$work/server/candidate.env"
: > "$FAKE_LOG"
package godspeed:two "$work/two.tar.gz"
bash "$work/server/manage.sh" upgrade "$work/two.tar.gz" > "$work/second.out" 2>&1 || { cat "$work/second.out"; exit 1; }
check 'the new image is the one started' '[ "$(value GODSPEED_CANDIDATE_IMAGE)" = godspeed:two ]'
check 'the setup code stays' '[ "$(value GODSPEED_CANDIDATE_TOKEN)" = "$token" ]'
check 'the reader'"'"'s own setting stays' '[ "$(value GODSPEED_CANDIDATE_HOST)" = notebook.example.org ]'
check 'each setting is there once' '[ "$(grep -c "^GODSPEED_CANDIDATE_IMAGE=" "$work/server/candidate.env")" = 1 ]'
check 'the settings before are kept, naming the old image' 'grep -q "^GODSPEED_CANDIDATE_IMAGE=godspeed:one$" "$work/server"/candidate.env.before-*'
backup=$(grep -n 'godspeed.mjs backup /opt/data/full-candidate/backups/before-update-' "$FAKE_LOG" | cut -d: -f1 | head -1)
load=$(grep -n '^load -i image.tar.gz' "$FAKE_LOG" | cut -d: -f1 | head -1)
check 'the data is backed up before the new image is loaded' '[ -n "$backup" ] && [ -n "$load" ] && [ "$backup" -lt "$load" ]'
check 'and the new image is started' 'grep -q " up -d$" "$FAKE_LOG"'
check 'the package files are the new ones' 'grep -q godspeed:two "$work/server/manifest.json"'

echo '== the same package again'
: > "$FAKE_LOG"
before=$(ls "$work/server"/candidate.env.before-* | wc -l)
bash "$work/server/install.sh" > /dev/null 2>&1
check 'no backup and no second copy of the settings' '! grep -q "godspeed.mjs backup" "$FAKE_LOG" && [ "$(ls "$work/server"/candidate.env.before-* | wc -l)" = "$before" ]'

echo '== a package that does not match its own checksums'
package godspeed:three "$work/three.tar.gz"
mkdir -p "$work/bad" && tar -xzf "$work/three.tar.gz" -C "$work/bad"
echo 'changed after it was checked' >> "$work/bad/image.tar.gz"
tar -czf "$work/bad.tar.gz" -C "$work/bad" "${files[@]}"
: > "$FAKE_LOG"
if bash "$work/server/manage.sh" upgrade "$work/bad.tar.gz" > "$work/bad.out" 2>&1; then refused=no; else refused=yes; fi
check 'it is refused' '[ "$refused" = yes ] && grep -q "nothing was changed" "$work/bad.out"'
check 'and nothing changed' '[ "$(value GODSPEED_CANDIDATE_IMAGE)" = godspeed:two ] && ! grep -q godspeed:three "$work/server/manifest.json" && [ ! -s "$FAKE_LOG" ]'

echo
if [ "$fails" -eq 0 ]; then echo 'ALL PASS'; else echo "$fails FAILED"; exit 1; fi
