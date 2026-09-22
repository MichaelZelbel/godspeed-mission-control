/*
 * hub-mail-imap.js - your Gmail for hub-mail, through Himalaya (a free mail program) and a
 * Google app password. No Google Cloud app, no connector company, no second computer.
 *
 * WHY THIS FILE IS HERE (the reviewed email plan, hub work/plans/email-strategy-2026-09-21.md).
 * The earlier Gmail step made every reader register their own Google app in Google's developer
 * console. A real run stopped part way, and eleven console steps are not a reader journey. Google
 * already lets an ordinary mail program in with an app password, so the hub uses one: Himalaya
 * 2.1.0, pinned by archive and SHA-256 (hub-mail-himalaya.json), talking IMAP to imap.gmail.com.
 * The person does the two things only they can do: make the app password on Google's page, and
 * type it into a window of this computer. The hub does the rest.
 *
 * WHERE THINGS LIVE, all on THIS computer and never in the hub folder or its Git history:
 *   ~/.hub/mail/imap/bin/        the pinned Himalaya program
 *   ~/.hub/mail/imap/state.json  which address, which Drafts folder, what was last verified (no secret)
 *   ~/.hub/mail/imap/account.toml  Himalaya's settings, rewritten from state.json on each use (no secret)
 *   ~/.hub/mail/imap/password.age  the app password, locked with age to a key of this folder
 *   ~/.hub/mail/imap/journal.jsonl every draft the hub tried to save, and what became of it
 * The folder is readable by this account only (on Windows by its access list, not by a mode flag).
 *
 * WHAT IT MAY DO. Search, read a message the person picks, list Drafts, and save a NEW plain-text
 * draft (also as a reply). Nothing here sends: there is no SMTP in the settings and no send
 * command. No attachments, no editing or deleting a draft, no Gmail search syntax.
 * THE HONEST LIMIT: an app password opens the whole mailbox to any program that holds it,
 * sending included. Locking it on disk and leaving out a send tool protect against mistakes and
 * against text in an email talking an assistant into something. They do not stop an
 * administrator of this computer who sets out to use the password another way.
 *
 * A SAVE THAT MAY OR MAY NOT HAVE HAPPENED is never repeated blindly. Every draft carries its own
 * Message-ID and is written to the journal before Gmail is asked. When the answer is lost, the
 * hub looks for that Message-ID in Drafts; found means saved, not found means "uncertain", and
 * the person checks Drafts before the same draft is saved again.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");
const G = require("./hub-mail-gmail.js");

const MANIFEST = require("./hub-mail-himalaya.json");
const ACCOUNT = "gmail";
const GMAIL_IMAP = "imaps://imap.gmail.com:993";
const APP_PASSWORDS = "https://myaccount.google.com/apppasswords";
const MAX_TEXT = 20000;
const MAX_READ_BYTES = 15 * 1024 * 1024;
const MAX_BODY = 100000;
const SLOTS = 2;                       // Himalaya processes at once, across every assistant here
const WAIT_MS = Number(process.env.HUB_MAIL_IMAP_WAIT_MS) || 45000;
const RUN_MS = () => Number(process.env.HUB_MAIL_IMAP_TIMEOUT_MS) || 60000;
const STALE_MS = 5 * 60000;

// ============================================================ where things are
const home = () => process.env.HUB_MAIL_HOME || os.homedir();
const base = () => path.join(home(), ".hub", "mail", "imap");
const file = name => path.join(base(), name);
const platformKey = () => process.platform + "-" + process.arch;
const asset = () => MANIFEST.assets[platformKey()] || null;
const supported = () => !!(asset() && (asset().tested || process.env.HUB_MAIL_IMAP_UNTESTED === "1"));
const exePath = () => path.join(base(), "bin", asset() ? asset().binary : "himalaya");

function readJson(name, dflt) { try { return JSON.parse(fs.readFileSync(file(name), "utf8")); } catch (e) { return dflt; } }
function writeJson(name, data) {
  ensureBase();
  const f = file(name), tmp = f + "." + process.pid + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, f);
}
const readState = () => readJson("state.json", null);

// The folder is this account's alone. On Windows a mode flag means nothing, so the access list
// is set: inheritance off, full control for this account and for the system, nobody else.
function ensureBase() {
  const d = base();
  const fresh = !fs.existsSync(d);
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(d, 0o700); } catch (e) { /* Windows */ }
  if (process.platform === "win32" && (fresh || !fs.existsSync(path.join(d, ".acl")))) {
    // By full path: in Git Bash a bare "whoami" is a different program that knows no /user.
    const sys32 = path.join(process.env.SystemRoot || "C:\\Windows", "System32");
    const who = spawnSync(path.join(sys32, "whoami.exe"), ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true });
    const sid = ((who.stdout || "").match(/"(S-1-[0-9-]+)"/) || [])[1];
    if (sid) {
      const r = spawnSync(path.join(sys32, "icacls.exe"), [d, "/inheritance:r", "/grant:r", `*${sid}:(OI)(CI)F`, "/grant:r", "*S-1-5-18:(OI)(CI)F"], { encoding: "utf8", windowsHide: true });
      if (r.status === 0) fs.writeFileSync(path.join(d, ".acl"), "owner-only " + sid + "\n");
    }
  }
  return d;
}

// ============================================================ the pinned program
// A .tgz is gzip around tar; tar is 512-byte headers. A few lines here instead of trusting
// whichever `tar` a computer happens to have (Git Bash's own tar misreads C:\ paths).
function untarOne(tgz, wanted) {
  const buf = zlib.gunzipSync(tgz);
  let off = 0, longName = "";
  while (off + 512 <= buf.length) {
    const h = buf.subarray(off, off + 512);
    if (h.every(b => b === 0)) break;
    const str = (a, b) => h.subarray(a, b).toString("utf8").replace(/\0.*$/s, "");
    let name = str(0, 100);
    const prefix = str(345, 500);
    if (prefix) name = prefix + "/" + name;
    const size = parseInt(str(124, 136).trim() || "0", 8);
    const type = String.fromCharCode(h[156] || 48);
    const data = buf.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === "L") { longName = data.toString("utf8").replace(/\0.*$/s, ""); continue; }
    if (longName) { name = longName; longName = ""; }
    if ((type === "0" || type === "\0") && name.replace(/^\.\//, "") === wanted) return Buffer.from(data);
  }
  return null;
}

async function install(say = () => {}) {
  const a = asset();
  if (!supported()) {
    throw Object.assign(new Error(`this kind of computer (${platformKey()}) has not been tested with the hub's mail program yet, so the hub does not install it here. You can still paste an email into the chat, or forward it to the hub's own address.`), { kind: "unsupported" });
  }
  const done = readJson("bin/installed.json", null);
  if (done && done.version === MANIFEST.version && done.sha256 === a.sha256 && fs.existsSync(exePath())) return exePath();
  ensureBase();
  let tgz;
  if (process.env.HUB_MAIL_HIMALAYA_ARCHIVE) tgz = fs.readFileSync(process.env.HUB_MAIL_HIMALAYA_ARCHIVE);
  else {
    say(`Fetching the mail program (Himalaya ${MANIFEST.version}, about 7 MB) from its official release page.`);
    let res;
    try { res = await fetch(MANIFEST.download + a.asset, { signal: AbortSignal.timeout(120000) }); }
    catch (e) { throw Object.assign(new Error("the mail program could not be downloaded (" + (e.cause && e.cause.code || e.message) + "). Check this computer is online and try again."), { kind: "network" }); }
    if (!res.ok) throw Object.assign(new Error("the mail program could not be downloaded (GitHub answered " + res.status + ")"), { kind: "network" });
    tgz = Buffer.from(await res.arrayBuffer());
  }
  const sum = crypto.createHash("sha256").update(tgz).digest("hex");
  if (sum !== a.sha256) throw Object.assign(new Error(`the downloaded mail program is not the pinned one (SHA-256 ${sum.slice(0, 16)}..., expected ${a.sha256.slice(0, 16)}...). Nothing was installed.`), { kind: "integrity" });
  const bin = untarOne(tgz, a.binary);
  if (!bin) throw new Error("the release archive does not contain " + a.binary + ". Nothing was installed.");
  const dir = path.join(base(), "bin");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = exePath() + ".new";
  fs.writeFileSync(tmp, bin, { mode: 0o700 });
  const v = spawnSync(tmp, ["--version"], { encoding: "utf8", windowsHide: true, timeout: 20000 });
  if (v.status !== 0 || !(v.stdout || "").includes("v" + MANIFEST.version)) {
    try { fs.unlinkSync(tmp); } catch (e) { /* */ }
    throw new Error("the mail program did not start on this computer (" + ((v.stderr || v.error && v.error.message || "").trim().split(/\r?\n/)[0] || "no answer") + "). Nothing was installed.");
  }
  fs.renameSync(tmp, exePath());
  writeJson("bin/installed.json", { version: MANIFEST.version, asset: a.asset, sha256: a.sha256, at: new Date().toISOString() });
  return exePath();
}

// ============================================================ the locked password
function mailKey() {
  const keyFile = file("key.txt");
  if (fs.existsSync(keyFile)) return keyFile;
  const keygen = G.findAge("age-keygen");
  if (!keygen) throw new Error("the small program called age is not on this computer. The hub installer fetches it: run it once, then try again.");
  ensureBase();
  const r = spawnSync(keygen, ["-o", keyFile], { encoding: "utf8", windowsHide: true });
  if (r.status !== 0 || !fs.existsSync(keyFile)) throw new Error("could not make a key for the mail password on this computer");
  try { fs.chmodSync(keyFile, 0o600); } catch (e) { /* Windows: the folder's access list covers it */ }
  return keyFile;
}
function lockPassword(password, target) {
  ensureBase();
  if (process.platform === "win32" && !fs.existsSync(path.join(base(), ".acl"))) throw new Error("the mail folder could not be made private to this Windows account, so the password was not stored");
  const age = G.findAge("age"), keygen = G.findAge("age-keygen");
  if (!age || !keygen) throw new Error("the small program called age is not on this computer. The hub installer fetches it: run it once, then try again.");
  const key = mailKey();
  const pub = spawnSync(keygen, ["-y", key], { encoding: "utf8", windowsHide: true });
  const recipient = (pub.stdout || "").trim().split(/\r?\n/).pop();
  if (!/^age1/.test(recipient)) throw new Error("could not read the public half of the mail key");
  const tmp = target + ".tmp";
  const r = spawnSync(age, ["-e", "-r", recipient, "-o", tmp], { input: password, encoding: "utf8", windowsHide: true });
  if (r.status !== 0) { try { fs.unlinkSync(tmp); } catch (e) { /* */ } throw new Error("could not lock the password"); }
  try { fs.chmodSync(tmp, 0o600); } catch (e) { /* */ }
  fs.renameSync(tmp, target);
}
function unlockPassword(source) {
  const age = G.findAge("age");
  const key = file("key.txt");
  if (!age || !fs.existsSync(key) || !fs.existsSync(source)) return null;
  const r = spawnSync(age, ["-d", "-i", key, source], { encoding: "utf8", windowsHide: true });
  return r.status === 0 ? r.stdout.replace(/\r?\n$/, "") : null;
}

// ============================================================ Himalaya's settings
const tq = s => JSON.stringify(String(s));      // a TOML basic string is a JSON string
function writeConfig(dir, st, passwordFile) {
  const secret = [process.execPath, path.join(__dirname, "hub-mail-imap.js"), "secret", passwordFile];
  let server = GMAIL_IMAP, extra = "";
  // Only the tests point this elsewhere, and only at this computer.
  const t = process.env.HUB_MAIL_IMAP_TEST_SERVER;
  if (t) {
    if (!/^imap:\/\/127\.0\.0\.1:\d+$/.test(t)) throw new Error("HUB_MAIL_IMAP_TEST_SERVER may only name a stand-in on 127.0.0.1");
    server = t; extra = "imap.starttls = false\n";
  }
  const lines = [`[accounts.${ACCOUNT}]`, `email = ${tq(st.address)}`, "default = true", `imap.server = ${tq(server)}`];
  const text = lines.join("\n") + "\n" + extra +
    `imap.sasl.plain.username = ${tq(st.address)}\n` +
    `imap.sasl.plain.password.command = [${secret.map(tq).join(", ")}]\n` +
    `mailbox.alias.inbox = "INBOX"\n` +
    (st.drafts ? `mailbox.alias.drafts = ${tq(st.drafts)}\n` : "") +
    (st.all ? `mailbox.alias.all = ${tq(st.all)}\n` : "");
  const f = path.join(dir, "account.toml");
  let before = null; try { before = fs.readFileSync(f, "utf8"); } catch (e) { /* */ }
  if (before !== text) { fs.writeFileSync(f + ".tmp", text, { mode: 0o600 }); fs.renameSync(f + ".tmp", f); }
}

// ============================================================ one Himalaya at a time (or two)
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } }
function tryLock(f) {
  try {
    const fd = fs.openSync(f, "wx", 0o600);
    fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }));
    fs.closeSync(fd);
    return true;
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    try {
      const o = JSON.parse(fs.readFileSync(f, "utf8"));
      if (!alive(o.pid) || Date.now() - o.at > STALE_MS) { fs.unlinkSync(f); return tryLock(f); }
    } catch (x) { /* being written this instant: busy */ }
    return false;
  }
}
async function withLock(names, fn) {
  const dir = path.join(ensureBase(), "locks");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const until = Date.now() + WAIT_MS;
  for (;;) {
    for (const n of names) {
      const f = path.join(dir, n);
      if (tryLock(f)) { try { return await fn(); } finally { try { fs.unlinkSync(f); } catch (e) { /* */ } } }
    }
    if (Date.now() > until) throw Object.assign(new Error("mail is busy with other requests on this computer; try again in a minute"), { kind: "busy" });
    await new Promise(r => setTimeout(r, 200));
  }
}
const slots = () => Array.from({ length: SLOTS }, (_, i) => "slot-" + i);

function runRaw(dir, args, { input = "", timeoutMs = RUN_MS() } = {}) {
  return new Promise(resolve => {
    const child = spawn(exePath(), ["-c", "./account.toml", "-a", ACCOUNT, "--json", "--log-level", "off", ...args],
      { cwd: dir, env: { ...process.env, HUB_MAIL_IMAP_PIPE: "1" }, windowsHide: true });
    let out = [], outLen = 0, err = "", timedOut = false, cut = false;
    child.stdout.on("data", d => { outLen += d.length; if (outLen > MAX_READ_BYTES * 2) { cut = true; child.kill(); } else out.push(d); });
    child.stderr.on("data", d => { if (err.length < 4000) err += d; });
    child.on("error", e => { err += e.message; });
    const t = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    child.on("close", code => {
      clearTimeout(t);
      const stdout = Buffer.concat(out).toString("utf8");
      let json = null; try { json = JSON.parse(stdout); } catch (e) { /* */ }
      resolve({ code, stdout, stderr: err, json, timedOut, cut });
    });
  });
}

// What kind of trouble, in words a person can act on.
function trouble(r, doing) {
  const text = String((r.json && r.json.error) || r.stderr || r.stdout || "").trim();
  let kind = "other", msg;
  if (r.timedOut) { kind = "timeout"; msg = `Gmail did not answer within ${Math.round(RUN_MS() / 1000)} seconds while ${doing}`; }
  else if (r.cut) { kind = "too-big"; msg = "the answer from Gmail was larger than the hub accepts"; }
  else if (/AUTHENTICAT|LOGIN failed|Invalid credentials|Application-specific password|Web login required|\[ALERT\]/i.test(text)) {
    kind = "auth";
    msg = "Gmail did not accept the app password. It may have been removed at Google, or the Google account password changed, which removes every app password. Reconnect: ask your assistant to connect Gmail again, or type hub-mail connect gmail-imap";
  } else if (/dns|resolve|lookup|connect|network|unreachable|refused|reset|broken pipe|tls|certificate|handshake|os error|timed out/i.test(text)) {
    kind = "network"; msg = "Gmail could not be reached from this computer (" + text.split(/\r?\n/)[0].slice(0, 160) + ")";
  } else if (/mailbox|NONEXISTENT|TRYCREATE|not exist|unknown folder/i.test(text)) {
    kind = "mailbox"; msg = "Gmail does not have the folder the hub expected (" + text.split(/\r?\n/)[0].slice(0, 160) + ")";
  } else msg = (text.split(/\r?\n/)[0] || "the mail program stopped without saying why").slice(0, 240);
  return Object.assign(new Error(msg), { kind });
}

async function himalaya(args, opts = {}) {
  const st = readState();
  if (!st || !st.address) throw notConnected();
  const exe = await install();
  if (!fs.existsSync(exe)) throw new Error("the mail program is missing on this computer; connect Gmail again");
  writeConfig(base(), st, file("password.age"));
  const r = await withLock(slots(), () => runRaw(base(), args, opts));
  if (r.code !== 0 || !r.json || r.json.error) {
    const e = trouble(r, opts.doing || "working");
    e.result = r;
    if (e.kind === "auth") setState({ state: "disconnected", problem: "Gmail refused the app password", problem_at: new Date().toISOString() });
    throw e;
  }
  return r.json;
}

function notConnected() {
  return Object.assign(new Error("gmail: not connected on this computer. When the person wants it, they ask their assistant \"Connect Gmail for me\" (or type hub-mail connect gmail-imap). Until then they can paste an email, or forward it to the hub's own address."), { kind: "not_configured" });
}
function setState(changes) {
  const st = readState();
  if (!st) return;
  writeJson("state.json", Object.assign(st, changes));
}

// ============================================================ message references
// Opaque to the assistant, precise to the hub: which connection, which folder, which folder
// generation (UIDVALIDITY) and which message. A reference from an older connection or from
// before Gmail renumbered the folder is refused instead of reading the wrong message.
const BOXES = { i: "inbox", a: "all", d: "drafts" };
const mailboxName = (st, k) => k === "i" ? "INBOX" : k === "a" ? st.all : k === "d" ? st.drafts : null;
const makeRef = (st, k, uidvalidity, uid) => `imap:${st.generation}:${k}:${uidvalidity}:${uid}`;
function parseRef(st, ref) {
  const m = String(ref || "").match(/^imap:([0-9a-f]+):([iad]):(\d+):(\d+)$/);
  if (!m) throw new Error("that is not a message reference from this Gmail connection (they look like imap:...). Search again with mail_search.");
  if (m[1] !== st.generation) throw new Error("that message reference belongs to an earlier Gmail connection. Search again with mail_search.");
  return { k: m[2], box: mailboxName(st, m[2]), uidvalidity: Number(m[3]), uid: m[4] };
}
async function uidValidity(box) {
  const s = await himalaya(["imap", "status", box], { doing: "checking the folder" });
  return Number(s.uid_validity);
}

// ============================================================ reading mail (MIME)
function unfoldHeaders(head) {
  return head.replace(/\r?\n[ \t]+/g, " ").split(/\r?\n/).map(l => { const i = l.indexOf(":"); return i > 0 ? { name: l.slice(0, i).trim().toLowerCase(), value: l.slice(i + 1).trim() } : null; }).filter(Boolean);
}
function decodeWords(s) {
  return String(s || "").replace(/=\?([^?]+)\?([bBqQ])\?([^?]*)\?=(\s+(?==\?))?/g, (all, cs, enc, text) => {
    try {
      const bytes = enc.toUpperCase() === "B" ? Buffer.from(text, "base64")
        : Buffer.from(text.replace(/_/g, " ").replace(/=([0-9A-Fa-f]{2})/g, (x, h) => String.fromCharCode(parseInt(h, 16))), "latin1");
      return charset(bytes, cs);
    } catch (e) { return all; }
  });
}
function charset(bytes, cs) {
  try { return new TextDecoder((cs || "utf-8").trim().toLowerCase().replace(/^"|"$/g, "") || "utf-8").decode(bytes); }
  catch (e) { return new TextDecoder("utf-8").decode(bytes); }
}
function param(value, name) {
  const m = String(value || "").match(new RegExp(";\\s*" + name + "\\*?=\\s*(?:\"([^\"]*)\"|([^;\\s]*))", "i"));
  return m ? decodeWords(m[1] !== undefined ? m[1] : m[2]) : "";
}
function parsePart(raw, depth = 0) {
  const cut = raw.search(/\r?\n\r?\n/);
  const head = cut < 0 ? raw : raw.slice(0, cut);
  const body = cut < 0 ? "" : raw.slice(cut).replace(/^\r?\n\r?\n/, "");
  const headers = unfoldHeaders(head);
  const get = n => (headers.find(h => h.name === n) || {}).value || "";
  const ct = get("content-type") || "text/plain";
  const type = ct.split(";")[0].trim().toLowerCase();
  const part = { headers, get, type, charset: param(ct, "charset"), cte: get("content-transfer-encoding").toLowerCase(),
    disposition: get("content-disposition").split(";")[0].trim().toLowerCase(),
    filename: param(get("content-disposition"), "filename") || param(ct, "name"), parts: [], body };
  if (type.startsWith("multipart/") && depth < 8) {
    const b = param(ct, "boundary");
    if (b) {
      const chunks = body.split(new RegExp("\\r?\\n?--" + b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?:--)?[ \\t]*(?:\\r?\\n|$)"));
      for (const c of chunks.slice(1)) if (c.trim()) part.parts.push(parsePart(c, depth + 1));
    }
  }
  return part;
}
function bytesOf(part) {
  if (part.cte === "base64") return Buffer.from(part.body.replace(/[^A-Za-z0-9+/=]/g, ""), "base64");
  if (part.cte === "quoted-printable") {
    const s = part.body.replace(/=\r?\n/g, "").replace(/=([0-9A-Fa-f]{2})/g, (x, h) => String.fromCharCode(parseInt(h, 16)));
    return Buffer.from(s, "latin1");
  }
  return null;
}
function textOfPart(p) {
  if (p.parts.length) {
    const pick = p.type === "multipart/alternative" ? p.parts.find(x => x.type === "text/plain") || p.parts[0] : null;
    if (pick) return textOfPart(pick);
    for (const x of p.parts) { if (x.disposition === "attachment" || x.filename) continue; const t = textOfPart(x); if (t) return t; }
    return "";
  }
  if (p.disposition === "attachment" || (p.filename && !/^text\//.test(p.type))) return "";
  if (p.type !== "text/plain" && p.type !== "text/html") return "";
  const b = bytesOf(p);
  let t = b ? charset(b, p.charset) : p.body;
  if (p.type === "text/html") {
    t = t.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  }
  return t.replace(/\r\n/g, "\n");
}
function attachmentsOfPart(p, out = []) {
  if (p.parts.length) { for (const x of p.parts) attachmentsOfPart(x, out); return out; }
  if (p.disposition === "attachment" || (p.filename && !/^text\/(plain|html)$/.test(p.type))) {
    const b = bytesOf(p);
    out.push({ name: p.filename || "(no name)", type: p.type, bytes: b ? b.length : Buffer.byteLength(p.body) });
  }
  return out;
}
const who = list => (list || []).map(a => a.name ? `${a.name} <${a.email}>` : a.email).join(", ");

// ============================================================ the operations
function status() {
  const st = readState();
  if (!st || !st.address) {
    return { account: "gmail", route: "Himalaya on " + os.hostname(), state: "not connected", setup: supported() ? "available" : "not tested on this kind of computer",
      note: "Optional. When you want it, ask your assistant: Connect Gmail for me. Until then, paste an email or forward it to the hub's address." };
  }
  const can = ["search", "read", "list drafts"].concat(st.drafts ? ["save new drafts"] : []);
  return { account: "gmail", address: st.address, route: "Himalaya on " + os.hostname() + " (app password)", state: st.state === "ready" ? "connected" : st.state,
    can, cannot: ["send", "attachments", "change or delete a draft"].concat(st.drafts ? [] : ["save drafts (no Drafts folder was found)"]),
    signed_in: st.verified_at ? `Gmail accepted the app password for ${st.address} on ${st.verified_at}` : "not verified yet",
    problem: st.state === "ready" ? undefined : st.problem,
    note: "Reading and saving drafts need no approval. Nothing is sent: the person presses Send in Gmail." };
}

async function check() {
  const st = readState();
  if (!st || !st.address) return status();
  try {
    const s = await himalaya(["imap", "status", "INBOX"], { doing: "checking the connection" });
    setState({ state: "ready", verified_at: new Date().toISOString(), problem: undefined });
    return Object.assign(status(), { checked: "Gmail answered just now", inbox: { messages: s.messages, unread: s.unseen } });
  } catch (e) {
    if (e.kind === "network" || e.kind === "timeout") setState({ state: "degraded", problem: e.message });
    return Object.assign(status(), { checked: "failed just now", error: e.message });
  }
}

// WHY NOT HIMALAYA'S OWN "envelopes search" (found 2026-09-22 on a real Gmail inbox of 13,000
// messages): it fetches the envelope of EVERY match before it pages, so "newest unread" did not
// answer within a minute. The stand-in mailbox had two messages and could not show it. The
// protocol-level search returns only message numbers (0.6 s on that inbox), and then only the
// newest few are fetched. Several words are several searches, and only messages matching all
// of them are kept, because that search accepts one text condition at a time.
async function uidsMatching(box, flags) {
  const r = await himalaya(["imap", "search", "-m", box, ...flags], { doing: "searching" });
  return (r.ids || []).map(x => Number(x.id)).filter(n => n > 0);
}
async function envelopesOf(box, uids) {
  if (!uids.length) return [];
  const r = await himalaya(["imap", "fetch", uids.join(","), "-m", box, "--envelope", "--flags", "--size"], { doing: "reading the list" });
  return (r.messages || []).sort((x, y) => y.uid - x.uid);
}
const addrs = list => [].concat(list || []).map(decodeWords).join(", ");
const envOut = (st, k, uv, m) => ({ message_id: makeRef(st, k, uv, m.uid), date: (m.envelope || {}).date || "", from: addrs((m.envelope || {}).from),
  to: addrs((m.envelope || {}).to), subject: decodeWords((m.envelope || {}).subject || ""), unread: !(m.flags || []).some(f => /seen/i.test(String(f.raw || f.iana || f))), bytes: m.size });

async function search(args) {
  const st = readState(); if (!st || !st.address) throw notConnected();
  const limit = Math.max(1, Math.min(25, Number(args.limit) || 10));
  const page = Math.max(1, Number(args.page_token) || 1);
  const k = args.in === "all" ? "a" : args.in === "drafts" ? "d" : "i";
  const box = mailboxName(st, k);
  if (!box) throw new Error(`gmail: no ${BOXES[k]} folder was found in this mailbox`);
  const flags = [];
  const one = v => String(v).replace(/[\r\n]/g, " ").trim().slice(0, 200);
  if (args.from) flags.push("--from", one(args.from));
  if (args.subject) flags.push("--subject", one(args.subject));
  for (const [key, v] of [["after", args.after], ["before", args.before]]) {
    if (!v) continue;
    if (!/^\d{4}-\d{2}-\d{2}/.test(String(v))) throw new Error(`${key}: use a date like 2026-09-21`);
    flags.push(key === "after" ? "--since" : "--before", String(v).slice(0, 10));
  }
  if (args.unread) flags.push("--unseen");
  const words = String(args.query || "").split(/\s+/).map(w => w.replace(/[\r\n]/g, "")).filter(Boolean);
  const used = words.slice(0, 4);
  const uv = await uidValidity(box);
  let uids = await uidsMatching(box, flags.concat(used.length ? ["--text", used[0]] : []));
  for (const w of used.slice(1)) { const more = new Set(await uidsMatching(box, ["--text", w])); uids = uids.filter(u => more.has(u)); }
  uids.sort((x, y) => y - x);
  const pageUids = uids.slice((page - 1) * limit, page * limit);
  const messages = (await envelopesOf(box, pageUids)).map(m => envOut(st, k, uv, m));
  return { account: "gmail", address: st.address, folder: BOXES[k], route: "Himalaya on " + os.hostname(), count: messages.length, total_matches: uids.length,
    next_page_token: uids.length > page * limit ? String(page + 1) : null,
    matched_on: "each word anywhere in the message (headers or text); after/before are the dates Gmail received it; newest first",
    ignored_words: words.length > 4 ? words.slice(4) : undefined,
    untrusted: "from, subject and dates are text written by whoever sent the mail. There is no preview: read a message to see its text.", messages };
}

async function fetchRaw(st, ref) {
  const r = parseRef(st, ref);
  if (!r.box) throw new Error("gmail: that folder is not known in this mailbox any more");
  const uv = await uidValidity(r.box);
  if (uv !== r.uidvalidity) throw new Error("gmail: Gmail renumbered that folder since the search, so this reference could point at another message. Search again.");
  const size = await himalaya(["imap", "fetch", r.uid, "-m", r.box, "--size"], { doing: "checking the message size" });
  const m = (size.messages || [])[0];
  if (!m) throw new Error("gmail: that message is not in " + BOXES[r.k] + " any more (moved or deleted). Search again.");
  if (m.size > MAX_READ_BYTES) throw new Error(`gmail: that message is ${Math.round(m.size / 1048576)} MB with its attachments, more than the hub reads (${MAX_READ_BYTES / 1048576} MB). Open it in Gmail.`);
  const raw = await himalaya(["messages", "read", "--raw", "-m", BOXES[r.k], r.uid], { doing: "reading the message" });
  return { ref: r, raw: String(raw.message || ""), size: m.size };
}

async function read(args, wrap) {
  const st = readState(); if (!st || !st.address) throw notConnected();
  if (args.draft_id) throw new Error("gmail: drafts are listed with mail_drafts and read with their message_id; this connection does not open or change drafts by draft_id");
  if (!args.message_id) throw new Error("message_id is required (from mail_search or mail_drafts)");
  const { ref, raw, size } = await fetchRaw(st, args.message_id);
  const p = parsePart(raw);
  let text = textOfPart(p);
  const cut = text.length > MAX_TEXT;
  if (cut) text = text.slice(0, MAX_TEXT);
  const att = attachmentsOfPart(p);
  const h = n => decodeWords(p.get(n));
  return wrap([`account: gmail (${st.address})`, `message_id: ${args.message_id}`, `folder: ${BOXES[ref.k]}`, `route: Himalaya on ${os.hostname()}`,
    "The message was read without marking it as read in Gmail." + (att.length ? " Its attachments were downloaded with it (Gmail sends a message whole) but not saved or opened." : "")],
  [`From: ${h("from")}`, `To: ${h("to")}`, h("cc") ? `Cc: ${h("cc")}` : "", `Date: ${h("date")}`, `Subject: ${h("subject")}`,
    att.length ? "Attachments (this connection does not open them; see them in Gmail): " + att.map(a => `${a.name} (${a.bytes} bytes)`).join(", ") : "", "",
    text || "[no plain text in this message]", cut ? `[cut at ${MAX_TEXT} characters of ${size} bytes]` : ""]);
}

async function listDrafts(args) {
  const st = readState(); if (!st || !st.address) throw notConnected();
  if (!st.drafts) throw new Error("gmail: no Drafts folder was found in this mailbox");
  const limit = Math.max(1, Math.min(25, Number(args.limit) || 10));
  const uv = await uidValidity(st.drafts);
  const uids = (await uidsMatching(st.drafts, [])).sort((x, y) => y - x).slice(0, limit);
  const drafts = (await envelopesOf(st.drafts, uids)).map(m => { const e = envOut(st, "d", uv, m); return { message_id: e.message_id, to: e.to, subject: e.subject, date: e.date }; });
  return { account: "gmail", address: st.address, folder: st.drafts, count: drafts.length, drafts,
    note: "Drafts are not sent. mail_read with a message_id shows one. This connection saves new drafts; it does not change or delete one, so a changed reply is saved as a new draft and the person deletes the old one in Gmail." };
}

// ---- saving a draft
function addrList(v) { return [].concat(v || []).flatMap(x => String(x).split(",")).map(x => x.trim()).filter(Boolean); }
function checkAddr(list, field) {
  for (const a of list) {
    if (/[\r\n]/.test(a)) throw new Error(`${field}: line breaks are not allowed`);
    const bare = (a.match(/<([^>]+)>\s*$/) || [null, a])[1].trim();
    if (!/^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/.test(bare)) throw new Error(`${field}: "${a}" is not an email address`);
    if (/[<>]/.test(a) && !/^[^<>]*<[^<>]+>$/.test(a)) throw new Error(`${field}: "${a}" is not an email address`);
  }
  return list;
}
const encWord = s => /^[\x20-\x7e]*$/.test(s) ? s : "=?UTF-8?B?" + Buffer.from(s, "utf8").toString("base64") + "?=";
function encAddr(a) {
  const m = a.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (!m || !m[1]) return a.trim();
  const name = /^[\x20-\x7e]*$/.test(m[1]) ? '"' + m[1].replace(/["\\]/g, "") + '"' : encWord(m[1]);
  return `${name} <${m[2]}>`;
}
function buildDraft(m) {
  const head = [`From: ${m.from}`];
  if (m.to.length) head.push(`To: ${m.to.map(encAddr).join(", ")}`);
  if (m.cc.length) head.push(`Cc: ${m.cc.map(encAddr).join(", ")}`);
  if (m.bcc.length) head.push(`Bcc: ${m.bcc.map(encAddr).join(", ")}`);
  head.push(`Subject: ${encWord(m.subject)}`, `Date: ${new Date().toUTCString().replace("GMT", "+0000")}`, `Message-ID: ${m.messageId}`);
  if (m.inReplyTo) head.push(`In-Reply-To: ${m.inReplyTo}`, `References: ${m.references || m.inReplyTo}`);
  head.push("MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64");
  const body = Buffer.from(m.body.replace(/\r?\n/g, "\r\n"), "utf8").toString("base64").replace(/.{76}/g, "$&\r\n");
  return head.join("\r\n") + "\r\n\r\n" + body + "\r\n";
}

function journal() {
  const ops = {};
  try {
    for (const line of fs.readFileSync(file("journal.jsonl"), "utf8").split(/\r?\n/)) {
      if (!line.trim()) continue;
      try { const e = JSON.parse(line); ops[e.op] = Object.assign(ops[e.op] || {}, e); } catch (x) { /* a torn last line */ }
    }
  } catch (e) { /* no journal yet */ }
  return ops;
}
function note(entry) {
  ensureBase();
  fs.appendFileSync(file("journal.jsonl"), JSON.stringify(Object.assign({ at: new Date().toISOString() }, entry)) + "\n", { mode: 0o600 });
}
// Looks for our own Message-ID among the newest drafts. true: it is there. false: it is not
// among them. null: the question itself could not be answered.
async function findDraft(messageId) {
  try {
    const st = readState();
    const uids = (await uidsMatching(st.drafts, [])).sort((x, y) => y - x).slice(0, 50);
    const want = messageId.replace(/[<>]/g, "");
    return (await envelopesOf(st.drafts, uids)).some(m => String((m.envelope || {}).message_id || "").replace(/[<>]/g, "") === want);
  } catch (e) { return null; }
}

async function draft(args) {
  const st = readState(); if (!st || !st.address) throw notConnected();
  if (!st.drafts) throw new Error("gmail: no Drafts folder was found in this mailbox, so drafts cannot be saved. Give the person the reply as text.");
  if (args.draft_id || args.base_version) throw new Error("gmail: this connection saves new drafts only; it does not change an existing one. Save the new version as a new draft and tell the person to delete the old one in Gmail.");
  if (args.attachments && [].concat(args.attachments).length) throw new Error("gmail: this connection does not attach files. Save the draft without them and tell the person which file to attach in Gmail.");
  const body = String(args.body || "");
  if (!body.trim()) throw new Error("body is required");
  if (body.length > MAX_BODY) throw new Error(`body: longer than ${MAX_BODY} characters`);
  let ctx = {};
  if (args.reply_to_message_id) {
    const { raw } = await fetchRaw(st, args.reply_to_message_id);
    const p = parsePart(raw);
    const subj = decodeWords(p.get("subject"));
    const mid = p.get("message-id");
    ctx = { inReplyTo: mid, references: [p.get("references"), mid].filter(Boolean).join(" ").slice(-2000),
      subject: /^re:/i.test(subj) ? subj : "Re: " + subj, to: decodeWords(p.get("reply-to") || p.get("from")) };
    if (/[\r\n]/.test(ctx.inReplyTo + ctx.references)) ctx.inReplyTo = ctx.references = "";
  }
  const m = { from: st.address, to: checkAddr(addrList(args.to !== undefined ? args.to : ctx.to), "to"), cc: checkAddr(addrList(args.cc), "cc"),
    bcc: checkAddr(addrList(args.bcc), "bcc"), subject: args.subject !== undefined ? String(args.subject) : (ctx.subject || ""),
    body, inReplyTo: ctx.inReplyTo, references: ctx.references };
  if (/[\r\n]/.test(m.subject)) throw new Error("subject: line breaks are not allowed");
  if (!m.to.length && !m.cc.length && !m.bcc.length) throw new Error("to: a draft needs at least one recipient");
  const fingerprint = crypto.createHash("sha256").update(JSON.stringify([m.to, m.cc, m.bcc, m.subject, m.body, m.inReplyTo || ""])).digest("hex").slice(0, 32);
  const domain = (st.address.split("@")[1] || "hub.invalid").replace(/[^A-Za-z0-9.-]/g, "");

  return withLock(["writer"], async () => {
    // An earlier try at this very draft whose outcome is unknown: find out, never just repeat.
    const earlier = Object.values(journal()).filter(o => o.fingerprint === fingerprint && o.generation === st.generation && o.state === "uncertain"
      && Date.now() - Date.parse(o.started || o.at) < 7 * 86400000);
    for (const o of earlier) {
      const found = await findDraft(o.message_id);
      if (found === true) {
        note({ op: o.op, state: "saved", confirmed: "found in Drafts later" });
        return { account: "gmail", saved: true, sent: false, saved_in: "Gmail Drafts of " + st.address,
          note: "This draft had already reached Gmail on an earlier try (found in Drafts), so it was not saved a second time.",
          next: "Tell the person the draft is waiting in Gmail Drafts. Nothing was sent." };
      }
      if (!args.after_checking_drafts) {
        return { account: "gmail", saved: "uncertain", sent: false,
          note: "An earlier try to save this same draft may or may not have reached Gmail, and the hub could not confirm it either way. It did not try again, so Drafts does not get two copies.",
          next: "Ask the person to look in Gmail Drafts for it. If it is not there, call mail_draft again with the same text and after_checking_drafts: true." };
      }
      note({ op: o.op, state: "abandoned", why: "the person checked Drafts" });
    }
    const op = crypto.randomBytes(8).toString("hex");
    m.messageId = `<hubmail.${op}@${domain}>`;
    const raw = buildDraft(m);
    note({ op, state: "started", started: new Date().toISOString(), generation: st.generation, fingerprint, message_id: m.messageId, to: m.to.length + m.cc.length + m.bcc.length });
    const result = (saved, extra) => Object.assign({ account: "gmail", saved, sent: false, saved_in: "Gmail Drafts of " + st.address,
      to: m.to, cc: m.cc, bcc: m.bcc, subject: m.subject, reply: !!m.inReplyTo,
      next: "Nothing was sent, and the hub does not send. Tell the person the draft is waiting in Gmail Drafts: they read it there, change what they like, and press Send themselves." }, extra || {});
    try {
      const r = await himalaya(["messages", "add", "-m", "drafts", "-f", "draft"], { input: raw, doing: "saving the draft", timeoutMs: RUN_MS() });
      note({ op, state: "saved", uid: r.id });
      return result(true, { note: "saved as a new draft" });
    } catch (e) {
      // Refused before anything was written: sign-in or connection failures. Everything else
      // (no answer, a dropped line, a stopped program) may have happened after Gmail took it.
      if (e.kind === "auth" || e.kind === "not_configured" || (e.kind === "network" && /refused|resolve|lookup|dns|no route|unreachable|failed to connect/i.test(e.message))) {
        note({ op, state: "failed", why: e.kind });
        throw e;
      }
      const found = await findDraft(m.messageId);
      if (found === true) { note({ op, state: "saved", confirmed: "found in Drafts after a lost answer" }); return result(true, { note: "Gmail's answer was lost, but the draft is in Drafts (checked), so it was not saved again." }); }
      note({ op, state: "uncertain", why: e.message.slice(0, 200) });
      return { account: "gmail", saved: "uncertain", sent: false,
        note: "Gmail did not confirm the save (" + e.message + "), and the draft was not found in Drafts " + (found === false ? "just now" : "because Drafts could not be checked") + ". Gmail can take a moment to show a new draft. The hub did not try again, so Drafts does not get two copies.",
        next: "Ask the person to look in Gmail Drafts. If it is not there, call mail_draft again with the same text and after_checking_drafts: true." };
    }
  });
}

// ============================================================ connecting (the owner's part)
// A session only the person can answer. Everything the owner types happens here, in a window of
// this computer or the server's own terminal, never in a chat.
function haveDesktop() {
  if (process.platform === "win32" || process.platform === "darwin") return true;
  return !!(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}
function terminalCommand() {
  const who = os.userInfo().username;
  const tool = path.join(__dirname, "hub-mail.js");
  return { self: `node ${tool} connect gmail-imap`, root: `sudo -iu ${who} node ${tool} connect gmail-imap`, user: who };
}

// Opens a new console window on Windows that runs the owner's part, and (unless noWait) waits
// for it. Start-Process gives the new window a real console, which is what hidden typing needs.
function openWindow({ noWait = false } = {}) {
  if (process.platform !== "win32") return { opened: false };
  const tool = path.join(__dirname, "hub-mail.js");
  const psq = s => "'" + String(s).replace(/'/g, "''") + "'";
  const argline = `"${tool}" connect gmail-imap --here`;
  const script = `Start-Process -FilePath ${psq(process.execPath)} -ArgumentList ${psq(argline)}${noWait ? "" : " -Wait"}`;
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { stdio: "ignore", windowsHide: true, timeout: noWait ? 30000 : 3600000 });
  return { opened: r.status === 0 };
}

async function connectHere({ ask, say, open = G.openBrowser }) {
  const exe = await install(say);
  const before = readState();
  say("");
  say("Connect your Gmail to your hub");
  say("");
  say("Your hub will be able to search your Gmail, read a message you pick, and save draft replies");
  say("in Gmail's Drafts folder. It sends nothing: you read a draft in Gmail and press Send there.");
  say("");
  say("Google lets a mail program in with an app password: 16 letters Google makes for one program.");
  say("You make it on Google's page, and you type it only here, in this window. It never goes into a chat.");
  if (before && before.address) say(`\nRight now ${before.address} is connected. Connecting again replaces that; the old one keeps working if you stop.`);
  say("");
  let address = "";
  for (let i = 0; i < 3 && !address; i++) {
    const a = String(await ask("Which Gmail address? ") || "").trim();
    if (/^stop$/i.test(a) || !a) { say("Stopped. Nothing was changed."); return { connected: false }; }
    if (/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(a)) address = a.toLowerCase(); else say("That is not an email address. Try again, or type stop.");
  }
  if (!address) { say("Stopped. Nothing was changed."); return { connected: false }; }
  const page = APP_PASSWORDS + "?authuser=" + encodeURIComponent(address);
  say("");
  say(`Step 1 of 2. Make the app password on Google's page for ${address}.`);
  if (haveDesktop()) { say("I am opening it in your browser now. If nothing opens, go to:"); open(page); }
  else say("Open this page in a browser on your phone or computer:");
  say("  " + page);
  say("Sign in if Google asks. Type a name such as hub mail, click Create, and Google shows 16 letters.");
  say("If Google says the setting is not available for your account, this account does not offer app");
  say("passwords: Google needs 2-Step Verification switched on first, and some work or school accounts");
  say("turn them off. Type stop then; nothing on your account is changed by the hub.");
  say("");
  const staging = path.join(ensureBase(), "staging");
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true, mode: 0o700 });
  try {
    for (let tries = 1; tries <= 3; tries++) {
      const typed = String(await ask("Step 2 of 2. Type the 16 letters here (they stay hidden; spaces do not matter): ", true) || "");
      const pw = typed.replace(/\s+/g, "").toLowerCase();
      if (pw === "stop" || !pw) { say("Stopped. Nothing was changed."); return { connected: false }; }
      if (!/^[a-z]{16}$/.test(pw)) { say("That was not 16 letters. Try again, or type stop."); tries--; if (typed.length > 200) break; continue; }
      const pwFile = path.join(staging, "password.age");
      lockPassword(pw, pwFile);
      const trial = { address, generation: "trial", drafts: "", all: "" };
      writeConfig(staging, trial, pwFile);
      say("Checking with Gmail...");
      const r = await withLock(slots(), () => runRaw(staging, ["imap", "list", "--all"], { timeoutMs: RUN_MS() }));
      if (r.code !== 0 || !r.json || r.json.error) {
        const e = trouble(r, "signing in");
        if (e.kind === "auth") {
          say(`Gmail did not accept that password for ${address}. Usual reasons: a typing mistake, a password made for`);
          say("another address, or a work account whose administrator turned mail programs off. You can make a");
          say("new one on the same page. " + (tries < 3 ? "Try again, or type stop." : ""));
          continue;
        }
        say("That did not work: " + e.message + ". Nothing was changed.");
        return { connected: false, problem: e.message };
      }
      const boxes = r.json.mailboxes || [];
      const find = attr => (boxes.find(b => (b.attributes || []).includes(attr)) || {}).name || "";
      const drafts = find("\\Drafts"), all = find("\\All");
      // Commit: the new password and settings replace the old ones in one rename each.
      const generation = crypto.randomBytes(6).toString("hex");
      fs.renameSync(pwFile, file("password.age"));
      const st = { version: 1, address, generation, drafts, all, state: "ready", route: "local", host: os.hostname(), user: os.userInfo().username,
        connected_at: new Date().toISOString(), verified_at: new Date().toISOString(), himalaya: MANIFEST.version };
      writeJson("state.json", st);
      writeConfig(base(), st, file("password.age"));
      say("");
      say(`Gmail accepted it. Signed in as ${address}.`);
      say(drafts ? `Drafts will be saved in your folder "${drafts}".` : "No Drafts folder was found, so the hub can read but not save drafts.");
      return { connected: true, address, drafts: !!drafts, exe };
    }
    say("Stopped after three tries. Nothing was changed.");
    return { connected: false };
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function disconnect() {
  const st = readState();
  for (const f of ["password.age", "account.toml", "state.json"]) { try { fs.unlinkSync(file(f)); } catch (e) { /* */ } }
  return { was: st && st.address || "", google: `The app password still exists at Google until you remove it there: ${APP_PASSWORDS}. Removing it there stops every copy of it.` };
}

// ============================================================ the password, handed to Himalaya
// Himalaya runs this (the command array in account.toml) and reads the password from the pipe.
// It refuses when a person runs it at a terminal: printing the password is never its job. That
// guards against accidents, not against an administrator of this computer.
function secretMain(argv) {
  const src = argv[1];
  if (process.env.HUB_MAIL_IMAP_PIPE !== "1" || process.stdout.isTTY) { console.error("hub-mail: this hands the mail password to the mail program only."); process.exit(2); }
  const inside = p => { const rel = path.relative(base(), path.resolve(p)); return rel && !rel.startsWith("..") && !path.isAbsolute(rel); };
  if (!src || !inside(src) || !/password\.age$/.test(src)) { console.error("hub-mail: unknown password file"); process.exit(2); }
  const pw = unlockPassword(src);
  if (pw === null) { console.error("hub-mail: the mail password could not be unlocked on this computer"); process.exit(1); }
  process.stdout.write(pw + "\n");
}

module.exports = { status, check, search, read, listDrafts, draft, install, connectHere, openWindow, terminalCommand, haveDesktop, disconnect,
  supported, readState, base, parsePart, textOfPart, attachmentsOfPart, decodeWords, buildDraft, untarOne, MANIFEST };
if (require.main === module) {
  const argv = process.argv.slice(2);
  if (argv[0] === "secret") secretMain(argv);
  else { console.error("hub-mail-imap.js is part of hub-mail: use hub-mail connect gmail-imap"); process.exit(2); }
}
