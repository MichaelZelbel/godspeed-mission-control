#!/usr/bin/env node
'use strict';
// The assistant's "your computer's browser" tools (computer use layer 2, D-285), as an MCP
// server Hermes starts (mcp_servers.computer). They sit BESIDE Hermes' own browser: its own
// browser reads public pages from the server; these use Godspeed Chrome on the user's computer,
// where the user is logged in. When the computer is off they say so in plain words, and a job
// can be left to run by itself when it is back.
//
// Only a safe set of browser actions is offered: open, read, click, fill, press, scroll, back.
// No scripts, no cookies, no files in or out.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const WebSocket = require('./vendor/ws');
const C = require('./lib/common');
const S = require('./lib/state');
const K = require('./lib/control');

const CDP = Number(process.env.GODSPEED_COMPUTER_CDP_PORT || C.CDP_PORT);
const AB = process.env.GODSPEED_COMPUTER_AGENT_BROWSER || 'agent-browser';
const SESSION = 'godspeed-computer';
const INSTALL = 'https://github.com/MichaelZelbel/godspeed-mission-control/releases/latest/download/GodspeedSetup.exe';

const NOT_CONNECTED = 'NOT CONNECTED. The user\'s computer is off, asleep, paused or offline, so their logins cannot be used right now. '
  + 'Tell the user in one plain sentence, for example: "Your computer is off or asleep, so I can\'t use your Amazon login right now. '
  + 'I\'ll do it as soon as it\'s back on." Then call computer_when_back with the whole job written out, so it runs by itself when the computer is back. '
  + 'For public pages you can still use your own browser tools.';
const SWITCHED_OFF = 'SWITCHED OFF. The user told you to stop using their computer. Do not use it. '
  + 'If they want it back, they say "use my computer again"; then call computer_switch with on=true.';
const NOT_SET_UP = 'NOT SET UP. No computer is paired with this server yet. Tell the user: install Godspeed on their Windows or Mac computer '
  + `(Windows: ${INSTALL}), tick "Let your assistant use a browser on this computer", and paste the connection code you get from computer_connect_code.`;

const OPEN_RULES = 'Use these computer_browser tools (not your own browser) only for pages that need the user\'s own login: their accounts, orders, '
  + 'inboxes, bookings, dashboards. For public pages use your own browser tools. Never buy, book, send, post, delete or change a setting without asking the user first.';

const TOOLS = [
  { name: 'computer_status', description: 'Whether the user\'s own computer is connected and lending its browser (Godspeed Chrome), so their logged-in sites can be used.', inputSchema: { type: 'object', properties: {} } },
  { name: 'computer_connect_code', description: 'Make a one-time connection code (valid half an hour) for when the user says "connect my computer" or the Godspeed installer on their computer asks for one. Send the user the code exactly as returned.', inputSchema: { type: 'object', properties: {} } },
  { name: 'computer_switch', description: 'Switch the use of the user\'s computer off ("stop using my computer") or back on ("use my computer again").', inputSchema: { type: 'object', properties: { on: { type: 'boolean', description: 'true to switch on, false to switch off' } }, required: ['on'] } },
  { name: 'computer_browser_open', description: 'Open a web page in Godspeed Chrome on the user\'s own computer, where they are logged in to their own sites. ' + OPEN_RULES + ' Returns the page title and address.', inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] } },
  { name: 'computer_browser_snapshot', description: 'The page open in Godspeed Chrome on the user\'s computer, as a list of its parts with refs like @e3 to click or fill.', inputSchema: { type: 'object', properties: {} } },
  { name: 'computer_browser_read', description: 'The visible text of the page open in Godspeed Chrome on the user\'s computer.', inputSchema: { type: 'object', properties: {} } },
  { name: 'computer_browser_click', description: 'Click a part of the page in Godspeed Chrome on the user\'s computer, by its ref from computer_browser_snapshot (like @e3). Ask the user first before anything that buys, sends, posts, deletes or changes a setting.', inputSchema: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'] } },
  { name: 'computer_browser_fill', description: 'Fill a field on the page in Godspeed Chrome on the user\'s computer, by its ref from computer_browser_snapshot. Never type the user\'s passwords: when a login is needed, use computer_browser_show_for_login.', inputSchema: { type: 'object', properties: { ref: { type: 'string' }, text: { type: 'string' } }, required: ['ref', 'text'] } },
  { name: 'computer_browser_press', description: 'Press a key in Godspeed Chrome on the user\'s computer, like Enter, Tab or Escape.', inputSchema: { type: 'object', properties: { key: { type: 'string' } }, required: ['key'] } },
  { name: 'computer_browser_scroll', description: 'Scroll the page in Godspeed Chrome on the user\'s computer.', inputSchema: { type: 'object', properties: { direction: { type: 'string', enum: ['up', 'down'] } }, required: ['direction'] } },
  { name: 'computer_browser_back', description: 'Go back one page in Godspeed Chrome on the user\'s computer.', inputSchema: { type: 'object', properties: {} } },
  { name: 'computer_browser_show_for_login', description: 'When a site needs the user to log in: opens that site\'s login page in Godspeed Chrome on the user\'s computer and brings the window up on their screen. Then tell the user, for example: "I need you logged in to Amazon for this. I opened the Amazon login in Godspeed Chrome on your computer. Log in there and tell me when you\'re done." You never type their password.', inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'the site\'s login page' } }, required: ['url'] } },
  { name: 'computer_when_back', description: 'When the user\'s computer is off: leave a job to run by itself as soon as the computer is back. Write the whole job out so it stands on its own (what to open, what to find, what to tell the user). It is dropped after a day, with one line to the user.', inputSchema: { type: 'object', properties: { task: { type: 'string' } }, required: ['task'] } },
  { name: 'computer_pages', description: 'The last pages you opened on the user\'s computer, for when they ask what you looked at.', inputSchema: { type: 'object', properties: {} } },
];

const text = (t, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError ? { isError: true } : {}) });
const stripAnsi = s => String(s).replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');

// Hermes starts this program with a short list of settings (HOME, PATH, XDG_*), so the browser
// engine may find no runtime folder it can write its socket to ("Failed to create socket
// directory"). It gets one of its own, beside the link's other files.
function engineEnv() {
  const env = { ...process.env };
  const writable = d => { try { fs.mkdirSync(d, { recursive: true, mode: 0o700 }); fs.accessSync(d, fs.constants.W_OK); return true; } catch { return false; } };
  if (!env.XDG_RUNTIME_DIR || !writable(env.XDG_RUNTIME_DIR)) {
    const d = path.join(C.serverDir(), 'run');
    writable(d);
    env.XDG_RUNTIME_DIR = d;
  }
  return env;
}

function agentBrowser(args, timeoutMs = 60000) {
  return new Promise(resolve => {
    let out = '', err = '';
    let p;
    const [bin, ...pre] = String(AB).match(/"[^"]*"|\S+/g).map(s => s.replace(/^"|"$/g, ''));
    try { p = spawn(bin, [...pre, '--session', SESSION, '--cdp', String(CDP), ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: engineEnv() }); } catch (e) { return resolve({ code: -1, out: '', err: e.message }); }
    const timer = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* */ } }, timeoutMs);
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('error', e => { clearTimeout(timer); resolve({ code: -1, out, err: e.message }); });
    p.on('close', code => { clearTimeout(timer); resolve({ code, out: stripAnsi(out).trim(), err: stripAnsi(err).trim() }); });
  });
}

async function gate() {
  const st = await K.localStatus(CDP);
  if (!st) return 'The computer link is not running on this server, so the user\'s computer cannot be used. Use your own browser tools for public pages.';
  if (st.off) return SWITCHED_OFF;
  if (!st.connected) return st.paired ? NOT_CONNECTED : NOT_SET_UP;
  return null;
}

async function browse(args, limit = 30000) {
  const stop = await gate();
  if (stop) return text(stop);
  const r = await agentBrowser(args);
  const out = (r.out || r.err || '').slice(0, limit);
  if (r.code !== 0) {
    const again = await gate();
    if (again) return text(again);
    return text('The browser on the user\'s computer did not do that: ' + (out || 'no answer') + (/home-network/.test(out) ? ' (Godspeed never opens addresses inside the user\'s home network.)' : ''), true);
  }
  return text(out || 'Done.');
}

function cdpCall(steps) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${CDP}/json/version`, { timeout: 10000 }, res => {
      let b = '';
      res.on('data', d => { b += d; });
      res.on('end', async () => {
        let v; try { v = JSON.parse(b); } catch { return reject(new Error('no answer from the computer')); }
        if (!v.webSocketDebuggerUrl) return reject(new Error(v.error || 'no answer from the computer'));
        const ws = new WebSocket(v.webSocketDebuggerUrl);
        let id = 0; const wait = new Map();
        const send = (method, params = {}) => new Promise((ok, no) => { const n = ++id; wait.set(n, { ok, no }); ws.send(JSON.stringify({ id: n, method, params })); });
        ws.on('message', m => { const x = JSON.parse(m.toString()); const w = wait.get(x.id); if (w) { wait.delete(x.id); x.error ? w.no(new Error(x.error.message)) : w.ok(x.result); } });
        ws.on('error', reject);
        ws.on('open', async () => { try { resolve(await steps(send)); } catch (e) { reject(e); } finally { ws.close(); } });
      });
    }).on('error', reject);
  });
}

async function call(name, a = {}) {
  const dir = C.serverDir();
  switch (name) {
    case 'computer_status': return text(await K.statusText(dir));
    case 'computer_connect_code': {
      const line = await K.pairLine(dir);
      return text('Send the user this connection code exactly, on a line of its own, and say it works once, for half an hour. '
        + 'They paste it where the Godspeed installer on their computer asks for "connection code".\n\n' + line);
    }
    case 'computer_switch':
      S.setOff(dir, !a.on);
      return text(a.on ? 'Switched on. The user\'s computer reconnects within a minute when it is on.'
        : 'Switched off. The user\'s computer is disconnected within seconds and stays off until they say "use my computer again".');
    case 'computer_browser_open': {
      const why = C.refuseUrl(a.url);
      if (why) return text('Not opened: ' + why + '. Godspeed never opens addresses inside the user\'s home network, nor files or browser settings.', true);
      const stop = await gate();
      if (stop) return text(stop);
      const r = await agentBrowser(['open', String(a.url)], Number(process.env.GODSPEED_COMPUTER_OPEN_WAIT_MS || 15000));
      if (r.code === 0) return text(r.out || 'Opened.');
      // The engine (agent-browser 0.26.0) times out when the first page of a session redirects,
      // although the page has opened (tested 2026-10-02, with and without the relay). So: where is
      // the tab now? A web page there is an opened page.
      const again = await gate();
      if (again) return text(again);
      const u = await agentBrowser(['get', 'url'], 15000);
      const url = (u.out || '').trim();
      if (u.code === 0 && /^https?:\/\//.test(url)) {
        const t = await agentBrowser(['get', 'title'], 15000);
        return text(`✓ ${(t.out || '').trim()}\n  ${url}\n(The page took long to finish loading; read it to see what it shows.)`);
      }
      return text('The browser on the user\'s computer did not open that: ' + (r.out || r.err || 'no answer'), true);
    }
    case 'computer_browser_snapshot': return browse(['snapshot', '-i']);
    case 'computer_browser_read': return browse(['get', 'text', 'body']);
    case 'computer_browser_click': return browse(['click', String(a.ref)]);
    case 'computer_browser_fill': return browse(['fill', String(a.ref), String(a.text)]);
    case 'computer_browser_press': return browse(['press', String(a.key)]);
    case 'computer_browser_scroll': return browse(['scroll', a.direction === 'up' ? 'up' : 'down', '600']);
    case 'computer_browser_back': return browse(['back']);
    case 'computer_browser_show_for_login': {
      const why = C.refuseUrl(a.url);
      if (why) return text('Not opened: ' + why + '.', true);
      const stop = await gate();
      if (stop) return text(stop);
      try {
        await cdpCall(async send => {
          const { targetId } = await send('Target.createTarget', { url: String(a.url) });
          try {
            const { windowId } = await send('Browser.getWindowForTarget', { targetId });
            await send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
          } catch { /* headless or no window manager: the tab is open anyway */ }
          await send('Target.activateTarget', { targetId });
        });
        return text('The login page is open in Godspeed Chrome on the user\'s computer, in front. Now ask the user to log in there and to tell you when they are done. Do not type their password.');
      } catch (e) {
        return text('Could not open the login page on the user\'s computer: ' + e.message, true);
      }
    }
    case 'computer_when_back': {
      const job = S.addWaiting(dir, a.task);
      return text(`Saved (${job.id}). It runs by itself when the user's computer is back, and the answer goes to the user's chat. It is dropped after a day.`);
    }
    case 'computer_pages': {
      const p = S.readPages(dir, 20);
      return text(p.length ? p.join('\n') : 'No page opened on the user\'s computer yet.');
    }
    default: return text('Unknown tool: ' + name, true);
  }
}

// --- MCP over stdio (JSON-RPC 2.0, one message per line) ------------------------------------

function reply(id, result, error) {
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, ...(error ? { error } : { result }) }) + '\n');
}

async function handle(msg) {
  const { id, method, params } = msg;
  if (method === 'initialize') {
    return reply(id, {
      protocolVersion: (params && params.protocolVersion) || '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'godspeed-computer', version: C.VERSION },
      instructions: 'Tools for Godspeed Chrome on the user\'s own computer. ' + OPEN_RULES,
    });
  }
  if (method === 'ping') return reply(id, {});
  if (method === 'tools/list') return reply(id, { tools: TOOLS });
  if (method === 'tools/call') {
    try { return reply(id, await call(params.name, params.arguments || {})); } catch (e) { return reply(id, text('Error: ' + e.message, true)); }
  }
  if (id !== undefined && id !== null) reply(id, null, { code: -32601, message: 'Method not found: ' + method });
}

if (require.main === module) {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      let msg; try { msg = JSON.parse(line); } catch { continue; }
      handle(msg);
    }
  });
  process.stdin.on('end', () => process.exit(0));
}

module.exports = { TOOLS, call, handle };
