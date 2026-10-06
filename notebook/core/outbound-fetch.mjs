import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';

// Every address a user or a model names (a watched page, a research source, a
// portfolio link, a posted article) is read through here. Until 6 October 2026
// a watch topic could name http://127.0.0.1 and a plain fetch followed any
// redirect, so a key allowed only "actions" made the server read an internal
// metadata-style address and keep the reply. Now the host is resolved and an
// address on this machine, the local network, a cloud's metadata service or a
// carrier's shared network is refused; each redirect is checked again; the
// connection goes to the address that was checked (a name cannot answer
// differently a second time); size and time are bounded.
// Two lists: a BlockList holding IPv6 ranges also matches IPv4 addresses
// against their mapped form, which made every IPv4 address look private.
const blocked4 = new net.BlockList(), blocked6 = new net.BlockList();
for (const [address, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) blocked4.addSubnet(address, bits, 'ipv4');
for (const [address, bits] of [['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]]) blocked6.addSubnet(address, bits, 'ipv6');
// Local fixtures in tests (and nowhere else): GODSPEED_OUTBOUND_ALLOW_LOCAL=1.
const localAllowed = () => process.env.GODSPEED_OUTBOUND_ALLOW_LOCAL === '1';
const refuse = message => Object.assign(new Error(message), { code: 'OUTBOUND_REFUSED' });
const plain = value => String(value).replace(/^\[|\]$/g, '');
export function publicAddress(address) {
  const ip = plain(address), type = net.isIP(ip);
  if (!type) return false;
  if (type === 6) { const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i); if (mapped) return publicAddress(mapped[1]); }
  return type === 6 ? !blocked6.check(ip, 'ipv6') : !blocked4.check(ip, 'ipv4');
}
// The address itself, before any network: only http(s), no credentials, no
// name that always means this machine or the local network.
export function checkOutboundURL(raw, { allowHosts = [] } = {}) {
  let url; try { url = new URL(raw); } catch { throw refuse('This is not a web address.'); }
  if (!['https:', 'http:'].includes(url.protocol)) throw refuse('Use an https:// address.');
  if (url.username || url.password) throw refuse('Leave sign-in details out of the address.');
  const host = plain(url.hostname).toLowerCase();
  if (allowHosts.includes(host) || localAllowed()) return url;
  if (net.isIP(host) ? !publicAddress(host) : host === 'localhost' || /\.(localhost|local|internal|home\.arpa|lan)$/.test(host) || !host.includes('.')) throw refuse('This address is on this server or its private network, so it is not read.');
  return url;
}
// Connects only to an address the check allows, for this one request.
function guardedLookup(allowHosts, resolve = dns.lookup) {
  return (hostname, options, callback) => {
    if (typeof options === 'function') { callback = options; options = {}; }
    resolve(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error);
      const allowed = allowHosts.includes(String(hostname).toLowerCase()) || localAllowed();
      if (!addresses.length || (!allowed && addresses.some(a => !publicAddress(a.address)))) return callback(refuse('This address is on this server or its private network, so it is not read.'));
      if (options.all) return callback(null, addresses);
      callback(null, addresses[0].address, addresses[0].family);
    });
  };
}
const statusesWithoutBody = new Set([101, 103, 204, 205, 304]);
function pinned(url, { method = 'GET', headers = {}, body, signal, allowHosts, lookup }) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const request = lib.request(url, { method, headers, signal, lookup: guardedLookup(allowHosts, lookup), agent: false }, response => {
      const head = new Headers();
      for (const [key, value] of Object.entries(response.headers)) if (value !== undefined) for (const one of [].concat(value)) head.append(key, String(one));
      const stream = statusesWithoutBody.has(response.statusCode) ? null : new ReadableStream({
        start(controller) { response.on('data', chunk => controller.enqueue(new Uint8Array(chunk))); response.on('end', () => controller.close()); response.on('error', error => controller.error(error)); },
        cancel() { response.destroy(); },
      });
      resolve(new Response(stream, { status: response.statusCode, statusText: response.statusMessage || '', headers: head }));
    });
    request.on('error', reject);
    request.end(body);
  });
}
async function bounded(response, maxBytes, truncate) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      if (length + value.length > maxBytes) { if (!truncate) throw refuse('The page is larger than ' + Math.round(maxBytes / 1024) + ' KB, so it was not read.'); chunks.push(value.subarray(0, maxBytes - length)); length = maxBytes; break; }
      chunks.push(value); length += value.length;
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks.map(c => Buffer.from(c.buffer, c.byteOffset, c.byteLength)));
}
// Reads one address and returns a Response whose body is already in memory.
// fetcher is for tests: given one, or when a test has replaced the global
// fetch, that is the network and only the address rules apply (nothing in the
// product replaces fetch). Redirects are followed by hand, at most five, each
// checked.
const nativeFetch = globalThis.fetch;
export async function outboundFetch(raw, init = {}, { timeoutMs = 15000, maxBytes = 1024 * 1024, truncate = false, maxRedirects = 5, allowHosts = [], fetcher, signal, lookup } = {}) {
  if (!fetcher && globalThis.fetch !== nativeFetch) fetcher = globalThis.fetch;
  const hosts = allowHosts.map(h => plain(h).toLowerCase()), deadline = AbortSignal.timeout(timeoutMs), abort = signal ? AbortSignal.any([signal, deadline]) : deadline;
  let url = checkOutboundURL(raw, { allowHosts: hosts }), method = (init.method || 'GET').toUpperCase(), body = init.body, headers = { ...(init.headers || {}) };
  for (let hop = 0; ; hop++) {
    const response = fetcher ? await fetcher(url, { ...init, method, headers, body, redirect: 'manual', signal: abort }) : await pinned(url, { method, headers, body, signal: abort, allowHosts: hosts, lookup });
    const location = response.status >= 300 && response.status < 400 ? response.headers.get('location') : null;
    if (!location) {
      const bytes = await bounded(response, maxBytes, truncate);
      return new Response(statusesWithoutBody.has(response.status) ? null : bytes, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    await response.body?.cancel().catch(() => {});
    if (hop >= maxRedirects) throw refuse(maxRedirects ? 'The address redirected too many times.' : 'The address redirects elsewhere; use the address it leads to.');
    const next = checkOutboundURL(new URL(location, url).href, { allowHosts: hosts });
    // A redirect to another site carries no credentials of the first.
    if (next.origin !== url.origin) for (const key of Object.keys(headers)) if (/^(authorization|cookie|proxy-authorization)$/i.test(key)) delete headers[key];
    if (response.status === 303 || ([301, 302].includes(response.status) && method === 'POST')) { method = 'GET'; body = undefined; }
    url = next;
  }
}
