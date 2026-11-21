import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { createService } from '../server/main.mjs';

// The notebook used to answer every file request with the whole file: sendFile
// always wrote 200 with the full Content-Length and ignored the browser's
// Range header (#889). A media player could not scrub until the whole
// attachment had downloaded, a seek fetched the file again in full, and Safari
// (macOS and iPhone) asks for a byte range before it plays anything at all, so
// audio and video in the notebook simply did not play there. This checks the
// ranges through /api/media/file/, the same sendFile that serves the page
// files and the pairing blobs.

const content = Buffer.from(Array.from({ length: 1000 }, (_, i) => String(i % 10)));

async function start(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-range-'));
  const service = await createService({ root, port: 0 });
  const base = 'http://127.0.0.1:' + service.address.port;
  const form = new FormData();
  form.set('file', new Blob([content], { type: 'audio/mpeg' }), 'sample.mp3');
  form.set('path', 'owner/sample.mp3');
  const uploaded = await fetch(base + '/api/media/upload', { method: 'POST', body: form });
  assert.equal(uploaded.status, 200, await uploaded.clone().text());
  t.after(async () => { await service.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const get = async range => {
    const r = await fetch(base + '/api/media/file/' + encodeURIComponent('owner/sample.mp3'), { headers: range === undefined ? {} : { Range: range } });
    return { status: r.status, headers: r.headers, body: Buffer.from(await r.arrayBuffer()) };
  };
  return { get };
}

test('a byte range answers 206 with exactly those bytes and the file answers ranges on every reply', async t => {
  const { get } = await start(t);
  // bytes=a-b, inside the file.
  let r = await get('bytes=100-199');
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('content-range'), 'bytes 100-199/1000');
  assert.equal(r.headers.get('content-length'), '100');
  assert.equal(r.headers.get('accept-ranges'), 'bytes');
  assert.ok(r.body.equals(content.subarray(100, 200)));

  // bytes=a-, from a point to the end of the file.
  r = await get('bytes=900-');
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('content-range'), 'bytes 900-999/1000');
  assert.ok(r.body.equals(content.subarray(900)));

  // bytes=a-b past the end of the file is cut down to the file's last byte.
  r = await get('bytes=990-2000');
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('content-range'), 'bytes 990-999/1000');
  assert.ok(r.body.equals(content.subarray(990)));

  // bytes=-n, the last n bytes; more than the file has is the whole file.
  r = await get('bytes=-100');
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('content-range'), 'bytes 900-999/1000');
  assert.ok(r.body.equals(content.subarray(900)));
  r = await get('bytes=-2000');
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('content-range'), 'bytes 0-999/1000');
  assert.ok(r.body.equals(content));

  // A range that covers the whole file is still answered as a range.
  r = await get('bytes=0-999');
  assert.equal(r.status, 206);
  assert.equal(r.headers.get('content-range'), 'bytes 0-999/1000');
  assert.ok(r.body.equals(content));
});

test('a range the file cannot satisfy answers 416 with the file size, and no Range header behaves as before', async t => {
  const { get } = await start(t);
  // A start at and past the end, and a suffix asking for no bytes.
  for (const range of ['bytes=1000-', 'bytes=1500-1600', 'bytes=-0']) {
    const r = await get(range);
    assert.equal(r.status, 416, range);
    assert.equal(r.headers.get('content-range'), 'bytes */1000', range);
  }
  // A header that is not one plain range is ignored, and the whole file goes out.
  for (const range of ['bytes=abc', 'bytes=200-100', 'bytes=0-9,20-29', 'chunks=0-9', 'bytes=-']) {
    const r = await get(range);
    assert.equal(r.status, 200, range);
    assert.equal(r.headers.get('content-range'), null, range);
    assert.equal(r.headers.get('accept-ranges'), 'bytes', range);
    assert.equal(r.headers.get('content-length'), '1000', range);
    assert.ok(r.body.equals(content), range);
  }
  // No Range header at all: exactly what the notebook answered before.
  const r = await get();
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('accept-ranges'), 'bytes');
  assert.ok(r.body.equals(content));
});

test('a range changes nothing about who may read a file, and a browser that gives up part way through a range does not stop the notebook', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-range-'));
  const service = await createService({ root, port: 0 });
  const base = 'http://127.0.0.1:' + service.address.port;
  const port = service.address.port;
  // A few MB, so the ranged reply is still travelling when the test cuts the
  // connection: a reply small enough to arrive in one piece (the 1000-byte
  // file above) is over before any cut could land in it.
  const big = Buffer.alloc(3 * 1024 * 1024);
  for (let i = 0; i < big.length; i++) big[i] = i % 251;
  const form = new FormData();
  form.set('file', new Blob([big], { type: 'audio/mpeg' }), 'sample.mp3');
  form.set('path', 'owner/sample.mp3');
  const uploaded = await fetch(base + '/api/media/upload', { method: 'POST', body: form });
  assert.equal(uploaded.status, 200, await uploaded.clone().text());
  t.after(async () => { await service.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const route = '/api/media/file/' + encodeURIComponent('owner/sample.mp3');
  // A request the door allows without a range is allowed with one: here a
  // same-origin request (its Origin is the door's own address), answered 206
  // with exactly the asked bytes.
  const sameSite = await fetch(base + route, { headers: { Origin: base, Range: 'bytes=0-9' } });
  assert.equal(sameSite.status, 206);
  assert.equal(sameSite.headers.get('content-range'), `bytes 0-9/${big.length}`);
  assert.ok(Buffer.from(await sameSite.arrayBuffer()).equals(big.subarray(0, 10)));
  // A file a request is refused without a range is refused with one: here a
  // cross-site origin, which the door refuses either way.
  for (const headers of [{ Origin: 'https://unrelated.example' }, { Origin: 'https://unrelated.example', Range: 'bytes=0-9' }]) {
    const r = await fetch(base + route, { headers });
    assert.equal(r.status, 403);
    await r.text();
  }
  // A browser that gives up part way through a range ends only that reply:
  // the status line and Content-Range arrive first, the connection is cut
  // while bytes are still travelling, and the same server answers the next
  // request, as a range and in full.
  const asked = big.length - 1000;
  const cut = await new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(`GET ${route} HTTP/1.1\r\nHost: 127.0.0.1\r\nRange: bytes=1000-\r\nConnection: close\r\n\r\n`);
    });
    let received = Buffer.alloc(0), destroyed = false;
    socket.on('data', chunk => {
      received = Buffer.concat([received, chunk]);
      const headerEnd = received.indexOf('\r\n\r\n');
      if (destroyed || headerEnd === -1) return;
      try {
        const head = received.subarray(0, headerEnd).toString();
        const bodyBytes = received.length - headerEnd - 4;
        // The reply being cut is a ranged one, not the whole file.
        assert.equal(head.split('\r\n')[0], 'HTTP/1.1 206 Partial Content', head);
        assert.ok(/^Content-Range: bytes 1000-\d+\/\d+$/m.test(head), head);
        if (bodyBytes >= 256 * 1024 && bodyBytes < asked) {
          destroyed = true;
          socket.destroy();
          resolve({ bodyBytes });
        }
      } catch (error) { destroyed = true; socket.destroy(); reject(error); }
    });
    socket.on('error', () => {});
    socket.on('close', () => { if (!destroyed) { destroyed = true; reject(new Error('the reply finished before the test could cut it mid-range')); } });
  });
  assert.ok(cut.bodyBytes > 0 && cut.bodyBytes < asked, `only ${cut.bodyBytes} of the ${asked} asked bytes had arrived when the connection was cut`);
  const afterRange = await fetch(base + route, { headers: { Range: 'bytes=0-9' } });
  assert.equal(afterRange.status, 206);
  assert.equal(afterRange.headers.get('content-range'), `bytes 0-9/${big.length}`);
  assert.ok(Buffer.from(await afterRange.arrayBuffer()).equals(big.subarray(0, 10)));
  const afterWhole = await fetch(base + route);
  assert.equal(afterWhole.status, 200);
  assert.ok(Buffer.from(await afterWhole.arrayBuffer()).equals(big));
});
