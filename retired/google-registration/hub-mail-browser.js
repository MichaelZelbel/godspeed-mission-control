/*
 * hub-mail-browser.js - a browser window the hub can work in, for the Gmail step.
 *
 * WHY THIS FILE IS HERE (Michael, 2026-09-21, after trying the first guided step himself).
 * The first version opened Google's pages and told the reader what to click on each: eleven
 * steps of Google's developer console. His verdict: "Nobody is going to do 11 steps", and his
 * picture of the product: "the reader is signing you in, and you do it in Google". So the hub
 * opens a browser window of its own, the reader signs in to Google there, and the hub does the
 * clicking in that window while the reader watches.
 *
 * HOW. The reader's own Edge, Chrome, Brave or Chromium is started the ordinary way, as a
 * normal browser with a profile folder of its own, and with its remote-debugging door open on
 * this computer only (127.0.0.1, a port the browser picks). The hub talks to it through that
 * door (the Chrome DevTools Protocol). It is NOT started in "automation mode": Google refuses
 * sign-ins in a browser that announces itself as automated, and accepts them in a normal one.
 *
 * NO DEPENDENCIES, like every program in this folder: the installer copies plain files, so
 * there is no package to install. The few lines of WebSocket below are why.
 *
 * THE PROFILE FOLDER HOLDS THE READER'S GOOGLE SIGN-IN while the step runs. It lives outside
 * the hub folder (~/.hub/mail/browser), and close({ forget: true }) deletes it, so no signed-in
 * browser is left lying around for anything to pick up afterwards.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");

// ============================================================ which browser
function findBrowser() {
  if (process.env.HUB_MAIL_BROWSER) return fs.existsSync(process.env.HUB_MAIL_BROWSER) ? process.env.HUB_MAIL_BROWSER : "";
  const h = os.homedir(), c = [];
  if (process.platform === "win32") {
    const pf = [process.env["ProgramFiles"], process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA].filter(Boolean);
    for (const rel of ["Microsoft\\Edge\\Application\\msedge.exe", "Google\\Chrome\\Application\\chrome.exe",
      "BraveSoftware\\Brave-Browser\\Application\\brave.exe", "Chromium\\Application\\chrome.exe"]) for (const p of pf) c.push(path.join(p, rel));
  } else if (process.platform === "darwin") {
    for (const app of ["Google Chrome.app/Contents/MacOS/Google Chrome", "Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "Brave Browser.app/Contents/MacOS/Brave Browser", "Chromium.app/Contents/MacOS/Chromium"]) { c.push("/Applications/" + app); c.push(path.join(h, "Applications", app)); }
  } else {
    for (const name of ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge", "microsoft-edge-stable", "brave-browser"]) {
      const r = spawnSync("sh", ["-c", "command -v " + name], { encoding: "utf8" });
      if (r.status === 0 && r.stdout.trim()) c.push(r.stdout.trim());
    }
  }
  return c.find(p => fs.existsSync(p)) || "";
}
const browserName = exe => /edge/i.test(exe) ? "Microsoft Edge" : /brave/i.test(exe) ? "Brave" : /chromium/i.test(exe) ? "Chromium" : "Google Chrome";

// ============================================================ a WebSocket, client side, text only
// Node has one built in from version 22. Readers may have 18 or 20, so this is the small part
// of the protocol the browser's door needs: one connection, text frames, any length.
function wsConnect(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url), key = crypto.randomBytes(16).toString("base64");
    const req = http.request({ host: u.hostname, port: u.port, path: u.pathname + u.search, headers: {
      Connection: "Upgrade", Upgrade: "websocket", "Sec-WebSocket-Key": key, "Sec-WebSocket-Version": "13" } });
    req.on("error", reject);
    req.on("response", res => reject(new Error("the browser refused the connection (" + res.statusCode + ")")));
    req.on("upgrade", (res, socket, head) => {
      const ws = { onmessage: null, onclose: null, closed: false };
      let buf = head && head.length ? Buffer.from(head) : Buffer.alloc(0), parts = [];
      const pump = () => {
        for (;;) {
          if (buf.length < 2) return;
          const fin = (buf[0] & 0x80) !== 0, op = buf[0] & 0x0f;
          let len = buf[1] & 0x7f, off = 2;
          if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
          else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
          if (buf.length < off + len) return;
          const data = buf.subarray(off, off + len); buf = buf.subarray(off + len);
          if (op === 8) { ws.closed = true; socket.end(); return; }
          if (op === 9) { socket.write(frame(data, 10)); continue; }            // ping -> pong
          if (op === 0 || op === 1) { parts.push(data); if (fin) { const t = Buffer.concat(parts).toString("utf8"); parts = []; if (ws.onmessage) ws.onmessage(t); } }
        }
      };
      const frame = (payload, op) => {
        const n = payload.length, mask = crypto.randomBytes(4);
        const head2 = n < 126 ? Buffer.from([0x80 | op, 0x80 | n]) : n < 65536 ? Buffer.from([0x80 | op, 0x80 | 126, n >> 8, n & 255])
          : (() => { const b = Buffer.alloc(10); b[0] = 0x80 | op; b[1] = 0x80 | 127; b.writeBigUInt64BE(BigInt(n), 2); return b; })();
        const out = Buffer.from(payload); for (let i = 0; i < n; i++) out[i] ^= mask[i % 4];
        return Buffer.concat([head2, mask, out]);
      };
      socket.on("data", d => { buf = Buffer.concat([buf, d]); pump(); });
      socket.on("close", () => { ws.closed = true; if (ws.onclose) ws.onclose(); });
      socket.on("error", () => { ws.closed = true; });
      ws.send = text => { if (!ws.closed) socket.write(frame(Buffer.from(text, "utf8"), 1)); };
      ws.close = () => { try { socket.end(); } catch (e) { /* already gone */ } };
      resolve(ws); pump();
    });
    req.end();
  });
}

// ============================================================ the browser's door
const sleep = ms => new Promise(r => setTimeout(r, ms));
const getJson = url => new Promise((resolve, reject) => {
  http.get(url, res => { let d = ""; res.on("data", c => d += c); res.on("end", () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); }).on("error", reject);
});

function profileDir() {
  const home = process.env.HUB_MAIL_HOME || os.homedir();
  return path.join(home, ".hub", "mail", "browser");
}

/*
 * open({ url }) -> a Browser. Starts the reader's browser as a normal window with its own
 * profile, and connects to it. Throws an Error with .noBrowser when no such browser is here.
 */
async function open({ url = "about:blank", dir = profileDir() } = {}) {
  const exe = findBrowser();
  if (!exe) { const e = new Error("no browser the hub can work in was found on this computer (Edge, Chrome, Brave or Chromium)"); e.noBrowser = true; throw e; }
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const portFile = path.join(dir, "DevToolsActivePort");
  try { fs.unlinkSync(portFile); } catch (e) { /* first start */ }
  // A CLEAN WINDOW, AND WHY IT HAS TO BE SAID (found on Michael's PC, 2026-09-21). A new Edge
  // profile is not empty: Edge signs it in to the person's Microsoft account by itself, syncs
  // their extensions into it, and every extension opens its welcome tab. His window came up with
  // eleven tabs, eight of them crypto wallets, in a window the hub was about to click in. So
  // extensions and sync are off in this window: it holds Google's pages and nothing else.
  const child = spawn(exe, ["--remote-debugging-port=0", "--user-data-dir=" + dir, "--no-first-run", "--no-default-browser-check",
    "--disable-extensions", "--disable-sync", "--disable-component-extensions-with-background-pages",
    "--disable-features=Translate,msImplicitSignin,msEdgeSyncConsent,EdgeWelcomePage", "--new-window", url], { detached: true, stdio: "ignore" });
  child.unref();
  let port = 0;
  for (let i = 0; i < 150 && !port; i++) { await sleep(200); try { port = Number(fs.readFileSync(portFile, "utf8").split(/\r?\n/)[0]) || 0; } catch (e) { /* not yet */ } }
  if (!port) throw new Error("the browser window did not open its door within 30 seconds");
  const ver = await getJson(`http://127.0.0.1:${port}/json/version`);
  const ws = await wsConnect(ver.webSocketDebuggerUrl);
  return new Browser({ ws, port, exe, dir, child });
}

// attach({ dir }) -> the Browser that open() started earlier and that is still running, or null.
// The window outlives the program that opened it, so a step that was interrupted can go on.
async function attach({ dir = profileDir() } = {}) {
  try {
    const port = Number(fs.readFileSync(path.join(dir, "DevToolsActivePort"), "utf8").split(/\r?\n/)[0]) || 0;
    if (!port) return null;
    const ver = await getJson(`http://127.0.0.1:${port}/json/version`);
    const ws = await wsConnect(ver.webSocketDebuggerUrl);
    return new Browser({ ws, port, exe: findBrowser(), dir, child: null });
  } catch (e) { return null; }
}

class Browser {
  constructor(o) {
    Object.assign(this, o);
    this.name = browserName(o.exe);
    this.nextId = 1; this.waiting = new Map(); this.listeners = [];
    this.ws.onmessage = t => {
      let m; try { m = JSON.parse(t); } catch (e) { return; }
      if (m.id && this.waiting.has(m.id)) { const w = this.waiting.get(m.id); this.waiting.delete(m.id); m.error ? w.reject(new Error(m.error.message)) : w.resolve(m.result); }
      else if (m.method) for (const l of this.listeners) l(m);
    };
    this.ws.onclose = () => { this.gone = true; for (const w of this.waiting.values()) w.reject(new Error("the browser window was closed")); this.waiting.clear(); };
  }
  send(method, params = {}, sessionId) {
    if (this.gone) return Promise.reject(new Error("the browser window was closed"));
    const id = this.nextId++;
    return new Promise((resolve, reject) => { this.waiting.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params, sessionId })); });
  }
  // The tab the hub works in: Google's, when there is one; never an extension's or the
  // browser's own pages, whatever else has opened itself beside it.
  async page() {
    const { targetInfos } = await this.send("Target.getTargets");
    const web = targetInfos.filter(x => x.type === "page" && !/^devtools:|^chrome-extension:|^edge:|^chrome:|^brave:/.test(x.url));
    const t = web.find(x => /^https:\/\/([a-z0-9-]+\.)*google\.com\//.test(x.url)) || web[0] || targetInfos.find(x => x.type === "page");
    if (!t) throw new Error("the browser window has no page open");
    const { sessionId } = await this.send("Target.attachToTarget", { targetId: t.targetId, flatten: true });
    const p = new Page(this, sessionId, t.targetId);
    await p.send("Page.enable"); await p.send("Runtime.enable");
    return p;
  }
  async close({ forget = false } = {}) {
    try { await this.send("Browser.close"); } catch (e) { /* closed by hand already */ }
    this.ws.close();
    if (forget) { await sleep(1500); for (let i = 0; i < 5; i++) { try { fs.rmSync(this.dir, { recursive: true, force: true }); break; } catch (e) { await sleep(1000); } } }
  }
}

class Page {
  constructor(browser, sessionId, targetId) { this.browser = browser; this.sessionId = sessionId; this.targetId = targetId; }
  send(method, params) { return this.browser.send(method, params, this.sessionId); }
  async goto(url) { await this.send("Page.navigate", { url }); await sleep(800); }
  // Run a function in the page. It must return something JSON can carry.
  async eval(fn, ...args) {
    const expression = `(${fn.toString()})(...${JSON.stringify(args)})`;
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error("in the page: " + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text));
    return r.result.value;
  }
  async url() { return this.eval(() => location.href); }
  async title() { return this.eval(() => document.title); }
  // Wait until fn returns something true in the page, or give up (returns null, never throws).
  async waitFor(fn, { timeout = 30000, every = 500, args = [] } = {}) {
    const end = Date.now() + timeout;
    for (;;) {
      try { const v = await this.eval(fn, ...args); if (v) return v; } catch (e) { if (this.browser.gone) throw e; }
      if (Date.now() > end) return null;
      await sleep(every);
    }
  }
  // A real mouse click in the middle of a rectangle {x, y, w, h} (page coordinates of the window).
  async clickAt(box) {
    const x = box.x + box.w / 2, y = box.y + box.h / 2;
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await this.send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 });
    }
  }
  async type(text) { await this.send("Input.insertText", { text }); }
  // modifiers: 2 is Ctrl (4 is Cmd on a Mac), as the browser's door counts them.
  async key(key, code, vk, modifiers = 0) {
    for (const type of ["keyDown", "keyUp"]) await this.send("Input.dispatchKeyEvent", { type, key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
  }
  async screenshot(file) { const r = await this.send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(file, Buffer.from(r.data, "base64")); return file; }
}

module.exports = { open, attach, findBrowser, browserName, profileDir, wsConnect, sleep };
