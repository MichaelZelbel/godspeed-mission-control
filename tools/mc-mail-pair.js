/*
 * mc-mail-pair.js - let a desktop computer use the mail connection that lives on your server.
 *
 * WHY THIS FILE IS HERE (the reviewed email plan, section 6). Gmail can be connected once, on the
 * server, so Hermes there, its Telegram bot and its scheduled jobs use it with the laptop closed.
 * A desktop assistant (Claude Desktop, Claude Code, Codex) on another computer then needs a way
 * to reach that one mail tool, without the Gmail password ever leaving the server. Nothing the
 * book sets up gives it one: a GitHub login, Tailscale and the Hermes web password are not a way
 * to run a program on the server. So this pairs one device, with ordinary SSH and a key that can
 * do exactly one thing.
 *
 * THREE STEPS, AND THE OWNER CARRIES TWO LINES:
 *   1. On the desktop: `mc-mail pair request` makes a key for this device only (its private
 *      half never leaves this computer) and prints one line, the request.
 *   2. On the server, in a terminal that is already logged in (the one in the provider's web page
 *      is fine), as the account that runs the mission control: `mc-mail pair approve <request>`. It adds the
 *      key to that account's authorized_keys, locked with `restrict` and a forced command: the key
 *      can start the mail tool and nothing else (no shell, no terminal, no forwarding). Every
 *      other key there is kept. It prints one line back, the receipt, with the server's own host
 *      key read from its files.
 *   3. On the desktop: `mc-mail pair finish <receipt>`. The receipt must answer this device's own
 *      request. Its host key is written into a known_hosts file of mc-mail's own, host checking
 *      stays strict, and the mail tool is started over SSH and asked for its status before
 *      anything is switched. Then this computer's `mc-mail mcp` carries every call to the server.
 *
 * The two lines are data (base64 of JSON), checked field by field and never run as commands. They
 * hold no password and no private key. The route is ordinary SSH over the private network where
 * there is one (Tailscale), not Tailscale's own SSH feature, which has rules of its own.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");

const home = () => process.env.GODSPEED_MAIL_HOME || os.homedir();
const sshDir = () => path.join(home(), ".godspeed", "mail", "ssh");
const routeFile = () => path.join(home(), ".godspeed", "mail", "route.json");
const REQ = "godspeedmail-pair-1.", REC = "godspeedmail-receipt-1.";
const DEVICE = /^[A-Za-z0-9._-]{1,40}$/;
const USER = /^[a-z_][a-z0-9_-]{0,31}$/;
const HOST = /^(?:[A-Za-z0-9-]{1,63}\.)*[A-Za-z0-9-]{1,63}$|^\d{1,3}(?:\.\d{1,3}){3}$/;
const KEY = /^ssh-ed25519 [A-Za-z0-9+/]{68}={0,2}$/;

const enc = o => Buffer.from(JSON.stringify(o)).toString("base64url");
function dec(line, prefix) {
  const s = String(line || "").trim();
  if (!s.startsWith(prefix)) throw new Error(`that is not a ${prefix === REQ ? "pairing request" : "pairing receipt"} (it starts with ${prefix})`);
  try { return JSON.parse(Buffer.from(s.slice(prefix.length), "base64url").toString("utf8")); }
  catch (e) { throw new Error("that line is damaged; copy it again, whole"); }
}
function which(name) {
  const exe = process.platform === "win32" ? ".exe" : "";
  const spots = process.platform === "win32" ? [path.join(process.env.SystemRoot || "C:\\Windows", "System32", "OpenSSH")] : ["/usr/bin", "/usr/local/bin", "/opt/homebrew/bin"];
  for (const d of spots) { const p = path.join(d, name + exe); if (fs.existsSync(p)) return p; }
  return spawnSync(name, ["-V"], { encoding: "utf8" }).error ? "" : name;
}
function privateDir(d) {
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(d, 0o700); } catch (e) { /* */ }
  if (process.platform === "win32") {
    // ssh.exe refuses a key others can read, and so should we.
    const sys32 = path.join(process.env.SystemRoot || "C:\\Windows", "System32");
    const sid = ((spawnSync(path.join(sys32, "whoami.exe"), ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true }).stdout || "").match(/"(S-1-[0-9-]+)"/) || [])[1];
    if (sid) spawnSync(path.join(sys32, "icacls.exe"), [d, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`, "/grant:r", "*S-1-5-18:(OI)(CI)F"], { windowsHide: true });
  }
}

// ---------------------------------------------------------------- the desktop's half
function request({ device } = {}) {
  const name = (device || os.hostname()).replace(/[^A-Za-z0-9._-]/g, "-").slice(0, 40) || "desktop";
  const keygen = which("ssh-keygen");
  if (!keygen) throw new Error("this computer has no ssh-keygen (OpenSSH). On Windows it is an optional feature called OpenSSH Client.");
  privateDir(sshDir());
  const key = path.join(sshDir(), "id_ed25519");
  if (!fs.existsSync(key)) {
    const r = spawnSync(keygen, ["-q", "-t", "ed25519", "-N", "", "-C", "mc-mail:" + name, "-f", key], { encoding: "utf8", windowsHide: true });
    if (r.status !== 0) throw new Error("could not make this device's key: " + (r.stderr || "").trim());
  }
  const pub = fs.readFileSync(key + ".pub", "utf8").trim().split(/\s+/).slice(0, 2).join(" ");
  const nonce = crypto.randomBytes(16).toString("hex");
  fs.writeFileSync(path.join(sshDir(), "pending.json"), JSON.stringify({ nonce, device: name, at: new Date().toISOString() }), { mode: 0o600 });
  return REQ + enc({ v: 1, nonce, device: name, key: pub });
}

function sshArgs(r) {
  return ["-T", "-i", path.join(sshDir(), "id_ed25519"), "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=yes", "-o", "UserKnownHostsFile=" + path.join(sshDir(), "known_hosts"), "-o", "GlobalKnownHostsFile=" + (process.platform === "win32" ? "NUL" : "/dev/null"),
    "-o", "ConnectTimeout=15", "-o", "ServerAliveInterval=30", "-p", String(r.port), `${r.user}@${r.host}`, "mc-mail-mcp"];
}

// One MCP conversation over the route: initialize, then call mail_status. "" when it answered.
function probe(r) {
  const lines = [{ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "mc-mail-pair", version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" }, { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "mail_status", arguments: {} } }];
  const out = spawnSync(which("ssh") || "ssh", sshArgs(r), { input: lines.map(x => JSON.stringify(x)).join("\n") + "\n", encoding: "utf8", timeout: 60000, windowsHide: true });
  const status = (out.stdout || "").split(/\r?\n/).map(l => { try { return JSON.parse(l); } catch (e) { return null; } }).find(x => x && x.id === 2);
  if (status && status.result) return { ok: true, text: ((status.result.content || [])[0] || {}).text || "" };
  return { ok: false, why: ((out.stderr || "").trim().split(/\r?\n/).pop() || (out.error && out.error.message) || "no answer").slice(0, 200) };
}

function finish(line) {
  const r = dec(line, REC);
  let pending = null;
  try { pending = JSON.parse(fs.readFileSync(path.join(sshDir(), "pending.json"), "utf8")); } catch (e) { /* */ }
  if (!pending) throw new Error("this computer has no pairing request waiting. Start with: mc-mail pair request");
  if (r.v !== 1 || r.nonce !== pending.nonce) throw new Error("this receipt answers a different request (an older one, or another computer's). Nothing was changed.");
  if (!USER.test(r.user || "") || !HOST.test(r.host || "") || !(Number(r.port) > 0 && Number(r.port) < 65536)) throw new Error("the receipt names an account, address or port that is not valid. Nothing was changed.");
  const keys = [].concat(r.host_keys || []).filter(k => KEY.test(k));
  if (!keys.length) throw new Error("the receipt carries no usable host key for the server. Nothing was changed.");
  const hostId = Number(r.port) === 22 ? r.host : `[${r.host}]:${r.port}`;
  fs.writeFileSync(path.join(sshDir(), "known_hosts"), keys.map(k => `${hostId} ${k}`).join("\n") + "\n", { mode: 0o600 });
  const route = { kind: "ssh", user: r.user, host: r.host, port: Number(r.port), device: pending.device, server: r.server || "", paired_at: new Date().toISOString() };
  const p = probe(route);
  if (!p.ok) throw new Error(`the server did not answer as the mail tool (${p.why}). The route was not switched; this computer keeps what it had.`);
  const tmp = routeFile() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(route, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, routeFile());
  try { fs.unlinkSync(path.join(sshDir(), "pending.json")); } catch (e) { /* */ }
  return { route, status: p.text };
}

function route() { try { const r = JSON.parse(fs.readFileSync(routeFile(), "utf8")); return r && r.kind === "ssh" ? r : null; } catch (e) { return null; } }
function forget() { const r = route(); try { fs.unlinkSync(routeFile()); } catch (e) { /* */ } return r; }

// The desktop's `mc-mail mcp` when a route exists: a straight pipe to the server's mail tool.
// Diagnostics go to stderr, the protocol to stdout, untouched. When the server cannot be reached
// the assistant gets that as the answer to its call, never a mailbox from somewhere else.
function relay(r) {
  const child = spawn(which("ssh") || "ssh", sshArgs(r), { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
  let alive = true, pendingIds = [];
  process.stdin.on("data", d => {
    for (const l of String(d).split("\n")) { try { const m = JSON.parse(l); if (m.id !== undefined) pendingIds.push(m.id); } catch (e) { /* partial line */ } }
    if (alive) child.stdin.write(d);
    else answerDown();
  });
  process.stdin.on("end", () => { try { child.stdin.end(); } catch (e) { /* */ } });
  child.stdout.on("data", d => { process.stdout.write(d); for (const l of String(d).split("\n")) { try { const m = JSON.parse(l); pendingIds = pendingIds.filter(x => x !== m.id); } catch (e) { /* */ } } });
  child.stderr.on("data", d => process.stderr.write("mc-mail (server): " + d));
  child.stdin.on("error", () => {});
  const why = `the mail tool on your server (${r.user}@${r.host}) could not be reached. The server may be off, or this computer may be off the private network (Tailscale). Nothing else was tried.`;
  function answerDown() {
    for (const id of pendingIds.splice(0)) process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result: { isError: true, content: [{ type: "text", text: why }] } }) + "\n");
  }
  child.on("exit", () => { alive = false; answerDown(); if (process.stdin.readableEnded) process.exit(0); });
  child.on("error", () => { alive = false; answerDown(); });
}

// ---------------------------------------------------------------- the server's half
function sshdPort() {
  try { const m = fs.readFileSync("/etc/ssh/sshd_config", "utf8").match(/^\s*Port\s+(\d+)/mi); if (m) return Number(m[1]); } catch (e) { /* */ }
  return 22;
}
function endpoint() {
  const ts = spawnSync("tailscale", ["ip", "-4"], { encoding: "utf8" });
  const ip = (ts.stdout || "").trim().split(/\s+/)[0];
  if (ts.status === 0 && /^100\.\d+\.\d+\.\d+$/.test(ip)) return { host: ip, network: "Tailscale" };
  return { host: os.hostname(), network: "" };
}
function authorizedKeys() { return path.join(os.homedir(), ".ssh", "authorized_keys"); }
function forcedCommand() {
  const tool = fs.existsSync(path.join(os.homedir(), ".local", "bin", "mc-mail.js")) ? path.join(os.homedir(), ".local", "bin", "mc-mail.js") : path.join(__dirname, "mc-mail.js");
  if (/["\\\s]/.test(process.execPath + tool)) throw new Error("the path to node or to the mail tool has a space or quote in it, which a locked key cannot name safely");
  return `${process.execPath} ${tool} mcp`;
}

function approve(line) {
  if (process.platform === "win32") throw new Error("approve runs on the server (Linux), in its own terminal");
  if (process.getuid && process.getuid() === 0) throw new Error("this is the root account. Run it as the account that runs your mission control (for a book server: sudo -iu ai mc-mail pair approve ...), so the key opens that account's mail tool and not root's.");
  const q = dec(line, REQ);
  if (q.v !== 1 || !/^[0-9a-f]{32}$/.test(q.nonce || "") || !DEVICE.test(q.device || "") || !KEY.test(q.key || "")) throw new Error("that request is not valid. Nothing was changed.");
  const hk = [process.env.GODSPEED_MAIL_TEST_HOST_KEY_FILE && process.env.GODSPEED_MAIL_TEST_HOST_KEY_FILE.includes("mc-mail-pair-test") ? process.env.GODSPEED_MAIL_TEST_HOST_KEY_FILE : "/etc/ssh/ssh_host_ed25519_key.pub"].map(f => { try { return fs.readFileSync(f, "utf8").trim().split(/\s+/).slice(0, 2).join(" "); } catch (e) { return ""; } }).filter(k => KEY.test(k));
  if (!hk.length) throw new Error("this server has no ed25519 host key that this account can read, so a desktop could not check it is talking to this server. Nothing was changed.");
  const f = authorizedKeys();
  fs.mkdirSync(path.dirname(f), { recursive: true, mode: 0o700 });
  let text = ""; try { text = fs.readFileSync(f, "utf8"); } catch (e) { /* first key */ }
  const tag = "mc-mail:" + q.device;
  const lineOut = `restrict,command="${forcedCommand()}" ${q.key} ${tag}`;
  const kept = text.split(/\r?\n/).filter(l => l && !l.endsWith(" " + tag) && !l.includes(q.key));
  const after = kept.concat([lineOut]).join("\n") + "\n";
  const tmp = f + ".mc-mail.tmp";
  fs.writeFileSync(tmp, after, { mode: 0o600 });
  fs.renameSync(tmp, f);
  try { fs.chmodSync(path.dirname(f), 0o700); fs.chmodSync(f, 0o600); } catch (e) { /* */ }
  const ep = endpoint();
  return { receipt: REC + enc({ v: 1, nonce: q.nonce, user: os.userInfo().username, host: ep.host, port: sshdPort(), host_keys: hk, server: os.hostname() }),
    device: q.device, network: ep.network, kept: kept.length };
}

function list() {
  let text = ""; try { text = fs.readFileSync(authorizedKeys(), "utf8"); } catch (e) { /* */ }
  return text.split(/\r?\n/).map(l => (l.match(/ mc-mail:([A-Za-z0-9._-]+)$/) || [])[1]).filter(Boolean);
}
function remove(device) {
  if (!DEVICE.test(device || "")) throw new Error("which device? mc-mail pair list names them");
  const f = authorizedKeys();
  let text = ""; try { text = fs.readFileSync(f, "utf8"); } catch (e) { return false; }
  const lines = text.split(/\r?\n/).filter(Boolean);
  const kept = lines.filter(l => !l.endsWith(" mc-mail:" + device));
  if (kept.length === lines.length) return false;
  fs.writeFileSync(f + ".mc-mail.tmp", kept.join("\n") + "\n", { mode: 0o600 });
  fs.renameSync(f + ".mc-mail.tmp", f);
  return true;
}

module.exports = { request, finish, route, forget, relay, approve, list, remove, probe, sshArgs };
