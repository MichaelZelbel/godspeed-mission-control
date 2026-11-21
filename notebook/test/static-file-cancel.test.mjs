import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A browser gives up on a page file (a script, a stylesheet, an image)
// whenever it wants: it may cancel the request as soon as it is sent, while
// the server is still opening the file, or once the file is already on its
// way (#877). Until 21 November 2026 a cancel in the middle left the whole
// server dead: sendFile piped into a reply that was already gone, the throw
// had nobody to catch it, and a server process that was not started from
// main.mjs itself (the screen tests and the layout audit start it that way)
// ended on the spot, so every open tab lost the notebook while pages were
// still loading. This test runs the notebook that way, in a process of its
// own, cancels one page file in each of those places, and then asks /health:
// the same process must still answer.
//
// The middle case needs the cancel to land while the file is still being
// opened, a gap of a moment that no delay can hold open from outside. So the
// page itself (index.html) is a named pipe (a Linux and macOS device): the
// server waits inside fs.promises.open until the test lets the file open,
// and the cancel is sent while it waits.

const helper = fileURLToPath(new URL('./screen-test-notebook.mjs', import.meta.url));

function buildUI() {
  const ui = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-page-cancel-ui-'));
  fs.mkdirSync(path.join(ui, 'assets'));
  // A stylesheet big enough that it is still travelling when the test cuts it off.
  fs.writeFileSync(path.join(ui, 'assets', 'app.css'), 'x'.repeat(2 * 1024 * 1024));
  execFileSync('mkfifo', [path.join(ui, 'index.html')]);
  return ui;
}

async function startNotebook(t, ui) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'godspeed-page-cancel-ws-'));
  const child = spawn(process.execPath, [helper, workspace, ui], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', chunk => { out += chunk; });
  let error = '';
  child.stderr.on('data', chunk => { error += chunk; });
  const port = await new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const match = out.match(/listening (\d+)/);
      if (match) { clearInterval(timer); resolve(Number(match[1])); }
    }, 20);
    child.once('exit', (code, signal) => { clearInterval(timer); reject(new Error(`The test notebook stopped (${code ?? signal}): ${error.slice(-2000)}`)); });
    setTimeout(() => { clearInterval(timer); reject(new Error('The test notebook never said it was listening')); }, 20000);
  });
  t.after(async () => {
    if (child.exitCode === null) { child.kill(); await new Promise(resolve => child.once('exit', resolve)); }
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(ui, { recursive: true, force: true });
  });
  const stillUp = async where => {
    assert.equal(child.exitCode, null, `The notebook process ended at ${where}:\n${error.slice(-2000)}`);
    let response; try { response = await fetch(`http://127.0.0.1:${port}/health`); }
    catch (e) { assert.fail(`The notebook did not answer /health at ${where} (${e.cause?.code ?? e.message}):\n${error.slice(-2000)}`); }
    assert.equal(response.status, 200, `The notebook did not answer /health at ${where}`);
    assert.equal((await response.json()).ok, true, `The notebook answered /health without ok at ${where}`);
  };
  return { port, stillUp };
}

function get(port, route, onConnect, onData) {
  return new Promise(resolve => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(`GET ${route} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
      if (onConnect) onConnect(socket);
    });
    if (onData) socket.on('data', chunk => onData(socket, chunk));
    socket.on('error', () => {});
    socket.on('close', resolve);
  });
}

test('a cancelled page file request ends only that reply', async t => {
  const ui = buildUI();
  const { port, stillUp } = await startNotebook(t, ui);
  await stillUp('the start');

  // Cancelled as soon as it was sent, before the server had opened anything.
  await get(port, '/assets/app.css', socket => setImmediate(() => socket.destroy()));
  await stillUp('a cancel as soon as the request was sent');

  // Cancelled while the server was still opening the file, before the reply
  // started. index.html is a named pipe, so the server waits inside
  // fs.promises.open until the test releases it below, and the cancel lands
  // in that wait. This is the window the notebook used to die in.
  await get(port, '/', socket => setTimeout(() => socket.destroy(), 200));
  const writer = fs.openSync(path.join(ui, 'index.html'), 'r+');
  fs.closeSync(writer);
  await stillUp('a cancel while the file was still being opened');

  // Cancelled while the file was already being sent.
  await get(port, '/assets/app.css', null, (socket, chunk) => socket.destroy());
  await stillUp('a cancel while the file was being sent');
});
