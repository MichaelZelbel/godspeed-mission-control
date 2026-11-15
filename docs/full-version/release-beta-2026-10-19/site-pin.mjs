// site-pin.mjs <website checkout> <digest sha256:...> <image commit, full> <product pin commit, full>
// The website's copy of the kit's compose.mjs (src/lib/installer/compose.mjs, the Hostinger coordinator)
// gets the first beta's image, its header says so, and the stored fixture and the test's pinned digest
// follow. The rest of the copy stays the kit file of codex/hostinger-traefik-compatibility 543e85a.
// Run after pin-image.sh, with the digest and commits it used; then the site's tests, then commit.
import fs from 'node:fs';
import path from 'node:path';
const [site, digest, image, pin] = process.argv.slice(2);
if (!site || !/^sha256:[0-9a-f]{64}$/.test(digest || '') || !/^[0-9a-f]{40}$/.test(image || '') || !/^[0-9a-f]{40}$/.test(pin || '')) {
  console.error('usage: node site-pin.mjs SITE sha256:DIGEST IMAGE_COMMIT PIN_COMMIT'); process.exit(1);
}
const OLD = 'sha256:ceb11a103fbc4ee7d45c015397b14cb3886e22eb9f878e07bee8735f14e39b64';
const s = image.slice(0, 7);
// The working copy may have CRLF line ends (core.autocrlf); edit with LF, write back as found.
const edit = (file, fn) => {
  const p = path.join(site, file); const raw = fs.readFileSync(p, 'utf8'); const crlf = raw.includes('\r\n');
  const before = raw.replace(/\r\n/g, '\n'); const after = fn(before);
  if (after === before) throw new Error('nothing changed in ' + file);
  fs.writeFileSync(p, crlf ? after.replace(/\n/g, '\r\n') : after); console.log('changed', file);
};
const once = (t, a, b) => { if (t.split(a).length !== 2) throw new Error('expected exactly one: ' + a.slice(0, 90)); return t.replace(a, b); };
edit('src/lib/installer/compose.mjs', (t) => {
  t = once(t, "// 18 October 2026 (main 8fc6241: image v2-sha-54f72d3, digest sha256:ceb11a10...). An image bump in the kit is a copy of that file below this\n",
    `// 19 October 2026, the first beta (main ${pin.slice(0, 7)}: image v2-sha-${s}, digest ${digest.slice(0, 15)}...). An image bump in the kit is a copy of that file below this\n`);
  return once(t, OLD, digest);
});
edit('tests/fixtures/installer-compose.yaml', (t) => once(t, OLD, digest));
edit('tests/installer-compose.test.mjs', (t) => {
  t = once(t, "// The Hostinger one-click image of 18 October 2026, the notebook tool beside the mail tool (v2-sha-54f72d3), as in the kit's docker/hostinger/compose.yaml.",
    `// The Hostinger one-click image of 19 October 2026, the first beta (v2-sha-${s}), as in the kit's docker/hostinger/compose.yaml.`);
  t = once(t, OLD, digest);
  return once(t, "assert.ok(ours.includes('v2-sha-54f72d3'));", `assert.ok(ours.includes('v2-sha-${s}'));`);
});
