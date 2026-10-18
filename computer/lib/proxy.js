'use strict';
// The home-network filter. Godspeed Chrome sends every request through this small proxy on
// 127.0.0.1 (--proxy-server, with loopback included), so a page, a link or a redirect cannot
// reach the router, a printer or a file server: the proxy looks up where each name really
// leads and refuses home-network addresses. It connects to the very address it checked, so a
// name cannot change its answer in between. HTTPS passes through untouched (CONNECT).
const http = require('http');
const net = require('net');
const dns = require('dns');
const { isHomeNetworkIp, isHomeNetworkHost } = require('./common');

const BLOCK_PAGE = '<!doctype html><meta charset="utf-8"><title>Blocked by Godspeed</title>'
  + '<body style="font:16px system-ui;margin:3em;max-width:36em"><h1>Blocked by Godspeed</h1>'
  + '<p>This window belongs to your assistant, and it never opens addresses inside your home network '
  + '(your router, printers or other devices).</p></body>';

function allowedForTests(host) {
  const list = (process.env.GODSPEED_COMPUTER_ALLOW_HOSTS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return list.includes(String(host).toLowerCase());
}

// Resolves host to one public address, or explains why not.
function resolvePublic(host) {
  return new Promise(resolve => {
    const bare = String(host).replace(/^\[|\]$/g, '');
    if (allowedForTests(bare)) return resolve({ address: net.isIP(bare) ? bare : '127.0.0.1' });
    if (isHomeNetworkHost(bare)) return resolve({ blocked: 'a home-network name or address' });
    if (net.isIP(bare)) return resolve({ address: bare });
    dns.lookup(bare, { all: true }, (err, list) => {
      if (err || !list || !list.length) return resolve({ error: 'name not found' });
      if (list.some(a => isHomeNetworkIp(a.address))) return resolve({ blocked: 'a name that leads into the home network' });
      resolve({ address: list[0].address });
    });
  });
}

function startProxy({ port = 0, onBlocked = () => {} } = {}) {
  const server = http.createServer(async (req, res) => {
    let u;
    try { u = new URL(req.url); } catch { res.writeHead(400); return res.end(); }
    const r = await resolvePublic(u.hostname);
    if (!r.address) {
      if (r.blocked) onBlocked(u.href, r.blocked);
      res.writeHead(r.blocked ? 403 : 502, { 'content-type': 'text/html; charset=utf-8', 'x-godspeed': 'blocked' });
      return res.end(r.blocked ? BLOCK_PAGE : 'Godspeed: ' + r.error);
    }
    const headers = { ...req.headers };
    delete headers['proxy-connection'];
    const up = http.request({
      host: r.address, port: u.port || 80, method: req.method, path: u.pathname + u.search, headers,
      setHost: false,
    }, upRes => { res.writeHead(upRes.statusCode, upRes.headers); upRes.pipe(res); });
    up.on('error', e => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Godspeed: ' + u.host + ' did not answer (' + (e.code || e.message) + ').');
    });
    req.pipe(up);
  });

  server.on('connect', async (req, client, head) => {
    const m = String(req.url).match(/^\[?([^\]]+?)\]?:(\d+)$/);
    if (!m) { client.end('HTTP/1.1 400 Bad Request\r\n\r\n'); return; }
    const r = await resolvePublic(m[1]);
    if (!r.address) {
      if (r.blocked) onBlocked(req.url, r.blocked);
      client.end(`HTTP/1.1 ${r.blocked ? '403 Forbidden' : '502 Bad Gateway'}\r\nX-Godspeed: blocked\r\nContent-Length: 0\r\n\r\n`);
      return;
    }
    const up = net.connect(Number(m[2]), r.address, () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head && head.length) up.write(head);
      up.pipe(client); client.pipe(up);
    });
    up.on('error', () => client.destroy());
    client.on('error', () => up.destroy());
  });
  server.on('clientError', (e, sock) => sock.destroy());

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve({ port: server.address().port, close: () => new Promise(r => server.close(() => r())) }));
  });
}

module.exports = { startProxy, resolvePublic };
