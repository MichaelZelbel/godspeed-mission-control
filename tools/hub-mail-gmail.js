/*
 * hub-mail-gmail.js - your own Gmail for hub-mail: connect it once, read it, save drafts in it,
 * and send only a message you approved yourself.
 *
 * It is a module, not a command. hub-mail.js is the command and the MCP server; this file is
 * what they call for the "gmail" account. It sits beside them because the installer copies the
 * whole tools folder to one place.
 *
 * ONE CONNECTION FOR EVERY ASSISTANT. `hub-mail connect gmail` asks Google once, in your
 * browser, and keeps what Google hands back in your hub's locked store
 * (secrets/hub-secrets.env.age), the same place the notebook key lives. Every assistant starts
 * this same program, and this program reads the store, so Claude Code, Codex and Hermes all use
 * that one connection and none of them signs in to Google on its own.
 *
 * WHAT IT MAY DO, AND WHO CHECKS.
 *   Google checks: which mailbox, and whether the connection may read only or also draft.
 *     The normal connection asks for reading plus drafts (gmail.readonly + gmail.compose).
 *     Google's compose permission also allows sending; Google offers no "drafts only".
 *   THIS program checks: that a message is sent only after you approved the exact message
 *     yourself, by typing `hub-mail approve <code>` in a terminal, within 30 minutes, once.
 *     No tool an assistant can call sends anything, and no tool accepts "approved: true".
 *   What nobody checks: an assistant with full control of this computer could read the store,
 *     edit this file or call Google itself. The approval step protects you against mistakes
 *     and against text in an email talking an assistant into sending; it does not protect you
 *     against an administrator who sets out to get round it. That is true of every program on
 *     a computer an assistant fully controls, and the book says so.
 *
 * Nothing here prints a token. State that is not a credential (proposals, the outbox, which
 * drafts the hub wrote) lives in ~/.hub/mail/ on each computer, readable by you only.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const http = require("http");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const SCOPE_READ = "https://www.googleapis.com/auth/gmail.readonly";
const SCOPE_COMPOSE = "https://www.googleapis.com/auth/gmail.compose";
const AUTH_URL = process.env.HUB_MAIL_GOOGLE_AUTH_URL || "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = process.env.HUB_MAIL_GOOGLE_TOKEN_URL || "https://oauth2.googleapis.com/token";
const REVOKE_URL = process.env.HUB_MAIL_GOOGLE_REVOKE_URL || "https://oauth2.googleapis.com/revoke";
const API = (process.env.HUB_MAIL_GMAIL_API || "https://gmail.googleapis.com") + "/gmail/v1/users/me";
const APPROVAL_MINUTES = 30;
const MAX_ATTACH_BYTES = 10 * 1024 * 1024;
const MAX_TEXT = 20000;
const KEYS = ["GMAIL_CLIENT_ID", "GMAIL_CLIENT_SECRET", "GMAIL_REFRESH_TOKEN", "GMAIL_ADDRESS", "GMAIL_SCOPES", "GMAIL_GENERATION"];

// ============================================================ where things are
function home() { return process.env.HUB_MAIL_HOME || os.homedir(); }
function stateDir() {
  const d = path.join(home(), ".hub", "mail");
  fs.mkdirSync(d, { recursive: true, mode: 0o700 });
  return d;
}
function readJson(name, dflt) {
  try { return JSON.parse(fs.readFileSync(path.join(stateDir(), name), "utf8")); } catch (e) { return dflt; }
}
function writeJson(name, data) {
  const f = path.join(stateDir(), name), tmp = f + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1), { mode: 0o600 });
  fs.renameSync(tmp, f);
}

function readDeviceEnv(name) {
  try {
    const m = fs.readFileSync(path.join(home(), ".hub", "device.env"), "utf8").match(new RegExp("^\\s*" + name + "=(.*)$", "m"));
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : "";
  } catch (e) { return ""; }
}
// What you said, what the installer wrote down, then a walk up from here. Each is used only
// if the folder really exists: a HUB_DIR mangled on its way through a shell is skipped, not
// believed.
function findHub() {
  for (const h of [process.env.HUB_DIR, readDeviceEnv("HUB_DIR")]) {
    if (h && fs.existsSync(path.join(h, "AGENTS.md"))) return path.resolve(h);
  }
  let d = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (fs.existsSync(path.join(d, "AGENTS.md"))) return d;
    const up = path.dirname(d); if (up === d) break; d = up;
  }
  return "";
}

// ============================================================ the locked store
function findAge(name) {
  const h = os.homedir(), exe = process.platform === "win32" ? ".exe" : "";
  const dirs = ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/snap/bin", path.join(h, "bin"), path.join(h, ".local", "bin"),
    path.join(h, "AppData", "Local", "Microsoft", "WinGet", "Links"), "C:\\Program Files\\age"];
  for (const d of dirs) { const p = path.join(d, name + exe); if (fs.existsSync(p)) return p; }
  const r = spawnSync(name, ["--version"], { encoding: "utf8" });
  return r.error ? "" : name;
}
function storePaths() {
  const hub = findHub();
  return { hub, store: hub ? path.join(hub, "secrets", "hub-secrets.env.age") : "",
    key: process.env.HUB_AGE_KEY || path.join(home(), ".hub", "age-key.txt") };
}
function readStore() {
  const { store, key } = storePaths();
  if (!store || !fs.existsSync(store) || !fs.existsSync(key)) return { lines: null, why: !store ? "no hub folder found" : "this computer cannot open your hub's locked store" };
  const age = findAge("age");
  if (!age) return { lines: null, why: "the small program called age is not on this computer" };
  const r = spawnSync(age, ["-d", "-i", key, store], { encoding: "utf8", maxBuffer: 8e6 });
  if (r.status !== 0) return { lines: null, why: "the key on this computer does not open your hub's store" };
  return { lines: r.stdout.split(/\r?\n/), why: "" };
}
// Change some NAME=value lines and leave every other line exactly as it was.
function writeStore(changes) {
  const { hub, store, key } = storePaths();
  if (!hub) throw new Error("no hub folder found, so there is nowhere to keep the connection");
  if (!fs.existsSync(key)) throw new Error("this computer has no key to your hub's locked store yet. Run the hub installer on it first.");
  const age = findAge("age"), keygen = findAge("age-keygen");
  if (!age || !keygen) throw new Error("the small program called age is not on this computer");
  const pub = spawnSync(keygen, ["-y", key], { encoding: "utf8" });
  const recipient = (pub.stdout || "").trim().split(/\r?\n/).pop();
  if (pub.status !== 0 || !/^age1/.test(recipient)) throw new Error("could not read the public half of this computer's store key");
  let lines = [];
  if (fs.existsSync(store)) {
    const cur = readStore();
    if (!cur.lines) throw new Error(cur.why);
    lines = cur.lines;
  }
  const seen = new Set();
  lines = lines.map(l => {
    const m = l.match(/^([A-Z][A-Z0-9_]*)=/);
    if (!m || !(m[1] in changes)) return l;
    seen.add(m[1]);
    return changes[m[1]] === null ? null : m[1] + "=" + changes[m[1]];
  }).filter(l => l !== null);
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  for (const [k, v] of Object.entries(changes)) if (!seen.has(k) && v !== null) lines.push(k + "=" + v);
  fs.mkdirSync(path.dirname(store), { recursive: true });
  const tmp = store + ".tmp";
  const r = spawnSync(age, ["-e", "-r", recipient, "-o", tmp], { input: lines.join("\n") + "\n", encoding: "utf8" });
  if (r.status !== 0) { try { fs.unlinkSync(tmp); } catch (e) { /* nothing written */ } throw new Error("could not lock the store again: " + (r.stderr || "").trim()); }
  fs.renameSync(tmp, store);
  return store;
}

// The locked store first, because it is the one place a reconnect or a disconnect writes: a
// copy of these lines in the environment (Windows persists the whole store for programs started
// from an icon) goes stale the moment you reconnect. The environment is only used where the
// store cannot be opened at all, which is the server bot, handed these lines by its own .env.
function credentials() {
  const out = {};
  const s = readStore();
  if (s.lines) {
    for (const line of s.lines) {
      const m = line.match(/^(GMAIL_[A-Z_]+)=(.*)$/);
      if (m && KEYS.includes(m[1])) out[m[1]] = m[2].trim();
    }
    if (!out.GMAIL_REFRESH_TOKEN) out.why = "not connected";
    return out;
  }
  for (const k of KEYS) if (process.env[k]) out[k] = process.env[k].trim();
  if (!out.GMAIL_REFRESH_TOKEN) out.why = s.why;
  return out;
}
const canDraft = c => (c.GMAIL_SCOPES || "").split(/\s+/).includes(SCOPE_COMPOSE);

// ============================================================ Google calls
async function post(url, form) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(), signal: AbortSignal.timeout(30000) });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

let cached = null;   // { token, expires, generation } for this process only
async function accessToken(c) {
  if (cached && cached.generation === c.GMAIL_GENERATION && cached.expires > Date.now() + 60000) return cached.token;
  const r = await post(TOKEN_URL, { client_id: c.GMAIL_CLIENT_ID, client_secret: c.GMAIL_CLIENT_SECRET || "",
    refresh_token: c.GMAIL_REFRESH_TOKEN, grant_type: "refresh_token" });
  if (r.status !== 200 || !r.body.access_token) {
    const e = new Error(r.body.error === "invalid_grant"
      ? "Google no longer accepts this connection (it was withdrawn, expired or the password changed). Reconnect: hub-mail connect gmail"
      : "Google refused to renew the connection (" + (r.body.error || r.status) + ")");
    e.reconnect = r.body.error === "invalid_grant";
    throw e;
  }
  cached = { token: r.body.access_token, expires: Date.now() + (r.body.expires_in || 3600) * 1000, generation: c.GMAIL_GENERATION };
  return cached.token;
}

async function gmail(c, method, p, body) {
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = await accessToken(c);
    let res;
    try {
      res = await fetch(API + p, { method, headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30000) });
    } catch (e) { last = "Gmail not reached"; if (method !== "GET") break; continue; }
    if (res.status === 401 && attempt === 0) { cached = null; continue; }
    if ((res.status === 429 || res.status >= 500) && method === "GET") { last = "Gmail answered " + res.status; await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); continue; }
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error("Gmail answered " + res.status + (out.error && out.error.message ? ": " + out.error.message : "")); e.status = res.status; throw e; }
    return out;
  }
  const e = new Error(last || "Gmail not reached"); e.uncertain = method !== "GET"; throw e;
}

function need(c) {
  if (!c.GMAIL_REFRESH_TOKEN) throw new Error("gmail: not connected. When you want it: hub-mail connect gmail. Until then, paste an email or forward it to the hub's address.");
}

// ============================================================ reading
const hdr = (m, name) => ((m.payload && m.payload.headers) || []).find(h => h.name.toLowerCase() === name.toLowerCase())?.value || "";
function b64d(s) { return Buffer.from(String(s || "").replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"); }
function textOf(part) {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body && part.body.data) return b64d(part.body.data);
  for (const p of part.parts || []) { const t = textOf(p); if (t) return t; }
  if (part.mimeType === "text/html" && part.body && part.body.data) {
    return b64d(part.body.data).replace(/<(script|style)[\s\S]*?<\/\1>/gi, "").replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  }
  return "";
}
function attachmentsOf(part, out = []) {
  if (!part) return out;
  if (part.filename) out.push({ name: part.filename, size: (part.body && part.body.size) || 0, type: part.mimeType });
  for (const p of part.parts || []) attachmentsOf(p, out);
  return out;
}

async function search(args) {
  const c = credentials(); need(c);
  const limit = Math.max(1, Math.min(25, Number(args.limit) || 10));
  const q = [args.query, args.from ? "from:(" + args.from + ")" : "", args.subject ? "subject:(" + args.subject + ")" : "",
    args.after ? "after:" + String(args.after).slice(0, 10).replace(/-/g, "/") : "", args.before ? "before:" + String(args.before).slice(0, 10).replace(/-/g, "/") : ""]
    .filter(Boolean).join(" ");
  const qs = new URLSearchParams({ maxResults: String(limit) });
  if (q) qs.set("q", q);
  if (args.page_token) qs.set("pageToken", args.page_token);
  const list = await gmail(c, "GET", "/messages?" + qs);
  const messages = [];
  for (const m of list.messages || []) {
    const full = await gmail(c, "GET", "/messages/" + m.id + "?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date");
    messages.push({ message_id: m.id, thread_id: m.threadId, date: hdr(full, "Date"), from: hdr(full, "From"),
      subject: hdr(full, "Subject"), preview: (full.snippet || "").slice(0, 200) });
  }
  return { account: "gmail", address: c.GMAIL_ADDRESS, count: messages.length, next_page_token: list.nextPageToken || null,
    untrusted: "from, subject and preview are text written by whoever sent the mail", messages };
}

async function read(args, wrap) {
  const c = credentials(); need(c);
  if (args.draft_id) return readDraft(c, args.draft_id, wrap);
  if (!args.message_id) throw new Error("message_id is required (from mail_search), or draft_id for a draft");
  const m = await gmail(c, "GET", "/messages/" + encodeURIComponent(args.message_id) + "?format=full");
  let text = textOf(m.payload);
  const cut = text.length > MAX_TEXT;
  if (cut) text = text.slice(0, MAX_TEXT);
  const att = attachmentsOf(m.payload);
  return wrap([
    `account: gmail (${c.GMAIL_ADDRESS})`, `message_id: ${m.id}`, `thread_id: ${m.threadId}`, `labels: ${(m.labelIds || []).join(", ")}`,
  ], [
    `From: ${hdr(m, "From")}`, `To: ${hdr(m, "To")}`, hdr(m, "Cc") ? `Cc: ${hdr(m, "Cc")}` : "", `Date: ${hdr(m, "Date")}`,
    `Subject: ${hdr(m, "Subject")}`, att.length ? "Attachments: " + att.map(a => `${a.name} (${a.size} bytes)`).join(", ") : "", "",
    text, cut ? `[cut at ${MAX_TEXT} characters]` : "",
  ].filter(l => l !== null));
}

// What is in Gmail Drafts now, newest first: so an assistant in a new conversation finds the
// draft the person means instead of writing a second one.
async function listDrafts(args) {
  const c = credentials(); need(c);
  const limit = Math.max(1, Math.min(25, Number(args.limit) || 10));
  const list = await gmail(c, "GET", "/drafts?" + new URLSearchParams({ maxResults: String(limit) }));
  const drafts = [];
  for (const d of list.drafts || []) {
    const f = await gmail(c, "GET", "/drafts/" + encodeURIComponent(d.id) + "?format=full");
    const m = f.message || {};
    drafts.push({ draft_id: d.id, version: m.id, to: hdr(m, "To"), subject: hdr(m, "Subject"),
      preview: textOf(m.payload).replace(/\s+/g, " ").slice(0, 160) });
  }
  return { account: "gmail", address: c.GMAIL_ADDRESS, count: drafts.length, drafts,
    note: "Drafts are not sent. To change one: mail_read with draft_id, then mail_draft with draft_id and base_version." };
}

// A draft as it is in Gmail NOW, with the person's edits. `version` is what mail_draft needs as
// base_version to change this text in place: that is how an assistant edits on top of what the
// person wrote, instead of beside it.
async function readDraft(c, draftId, wrap) {
  const d = await gmail(c, "GET", "/drafts/" + encodeURIComponent(draftId) + "?format=full");
  const m = d.message || {};
  return wrap([`account: gmail (${c.GMAIL_ADDRESS})`, `draft_id: ${d.id}`, `version: ${m.id}`,
    "This is a DRAFT in Gmail Drafts, not sent. To change it, call mail_draft with this draft_id and base_version."],
  [`To: ${hdr(m, "To")}`, hdr(m, "Cc") ? `Cc: ${hdr(m, "Cc")}` : "", hdr(m, "Bcc") ? `Bcc: ${hdr(m, "Bcc")}` : "",
    `Subject: ${hdr(m, "Subject")}`, "", textOf(m.payload)]);
}

// ============================================================ building a message
function encWord(s) { return /^[\x20-\x7e]*$/.test(s) ? s : "=?UTF-8?B?" + Buffer.from(s, "utf8").toString("base64") + "?="; }
function addrList(v) { return [].concat(v || []).flatMap(x => String(x).split(",")).map(x => x.trim()).filter(Boolean); }
function checkAddr(list, field) {
  for (const a of list) {
    const bare = (a.match(/<([^>]+)>/) || [null, a])[1].trim();
    if (!/^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]+$/.test(bare)) throw new Error(`${field}: "${a}" is not an email address`);
    if (/[\r\n]/.test(a)) throw new Error(`${field}: line breaks are not allowed`);
  }
  return list;
}
function readAttachments(list) {
  const hub = findHub(), out = [];
  let total = 0;
  for (const p of [].concat(list || [])) {
    const full = path.resolve(hub || process.cwd(), p);
    if (hub && !full.startsWith(path.resolve(hub) + path.sep)) throw new Error(`attachment "${p}" is outside your hub folder`);
    const data = fs.readFileSync(full);
    total += data.length;
    if (total > MAX_ATTACH_BYTES) throw new Error("attachments together are larger than 10 MB");
    out.push({ name: path.basename(full).replace(/["\r\n]/g, "_"), data, sha256: crypto.createHash("sha256").update(data).digest("hex") });
  }
  return out;
}
// The whole message as one RFC 2822 text. Everything an approval binds is in here.
function buildRaw(m) {
  const id = m.messageIdHeader || `<hubmail-${crypto.randomBytes(12).toString("hex")}@${(m.from.split("@")[1] || "hub.local").replace(/[>\s]/g, "")}>`;
  const head = [`From: ${m.from}`, `To: ${m.to.join(", ")}`];
  if (m.cc.length) head.push(`Cc: ${m.cc.join(", ")}`);
  if (m.bcc.length) head.push(`Bcc: ${m.bcc.join(", ")}`);
  head.push(`Subject: ${encWord(m.subject || "")}`, `Message-ID: ${id}`, "MIME-Version: 1.0");
  if (m.inReplyTo) head.push(`In-Reply-To: ${m.inReplyTo}`, `References: ${m.references || m.inReplyTo}`);
  const bodyPart = ["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "",
    Buffer.from(m.body || "", "utf8").toString("base64").replace(/.{76}/g, "$&\r\n")].join("\r\n");
  let raw;
  if (!m.attachments.length) raw = head.join("\r\n") + "\r\n" + bodyPart;
  else {
    const b = "hubmail-" + crypto.randomBytes(8).toString("hex");
    raw = head.concat([`Content-Type: multipart/mixed; boundary="${b}"`]).join("\r\n") + "\r\n\r\n--" + b + "\r\n" + bodyPart +
      m.attachments.map(a => `\r\n--${b}\r\nContent-Type: application/octet-stream; name="${a.name}"\r\nContent-Disposition: attachment; filename="${a.name}"\r\nContent-Transfer-Encoding: base64\r\n\r\n` +
        a.data.toString("base64").replace(/.{76}/g, "$&\r\n")).join("") + `\r\n--${b}--`;
  }
  return { raw: Buffer.from(raw, "utf8").toString("base64url"), messageIdHeader: id };
}

async function replyContext(c, messageId) {
  const o = await gmail(c, "GET", "/messages/" + encodeURIComponent(messageId) + "?format=metadata&metadataHeaders=From&metadataHeaders=Reply-To&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References");
  const subj = hdr(o, "Subject");
  return { threadId: o.threadId, inReplyTo: hdr(o, "Message-ID"), references: [hdr(o, "References"), hdr(o, "Message-ID")].filter(Boolean).join(" "),
    subject: /^re:/i.test(subj) ? subj : "Re: " + subj, to: hdr(o, "Reply-To") || hdr(o, "From") };
}

// ============================================================ drafts
// Saving a draft needs no approval: nothing leaves your mailbox, and you can change or delete
// it in Gmail. The one rule is about YOUR edits: if a draft the hub saved has been changed
// since (by you, or by anybody), the hub never writes over it. It saves its new version as a
// separate draft and says so.
async function draft(args) {
  const c = credentials(); need(c);
  if (!canDraft(c)) throw new Error("gmail: this connection reads only, so it cannot save drafts. The reply text is in this answer; to let the hub save drafts, run: hub-mail connect gmail");
  let ctx = {};
  if (args.reply_to_message_id) ctx = await replyContext(c, args.reply_to_message_id);
  else if (args.draft_id) {
    // Changing an existing draft keeps what the draft already had and the call did not
    // restate: its conversation (thread and reply headers), recipient and subject. Without
    // this, a one-word change could move a reply out of its conversation in Gmail.
    const cur = await gmail(c, "GET", "/drafts/" + encodeURIComponent(args.draft_id) + "?format=full").catch(e => { if (e.status === 404) return null; throw e; });
    const cm = cur && cur.message;
    if (cm) ctx = { threadId: cm.threadId, inReplyTo: hdr(cm, "In-Reply-To"), references: hdr(cm, "References"),
      to: hdr(cm, "To"), subject: hdr(cm, "Subject"), cc: hdr(cm, "Cc"), bcc: hdr(cm, "Bcc") };
  }
  const to = checkAddr(addrList(args.to !== undefined ? args.to : ctx.to), "to");
  const m = { from: c.GMAIL_ADDRESS, to, cc: checkAddr(addrList(args.cc !== undefined ? args.cc : ctx.cc), "cc"), bcc: checkAddr(addrList(args.bcc !== undefined ? args.bcc : ctx.bcc), "bcc"),
    subject: args.subject !== undefined ? String(args.subject) : ctx.subject || "", body: String(args.body || ""),
    inReplyTo: ctx.inReplyTo, references: ctx.references, attachments: readAttachments(args.attachments) };
  if (/[\r\n]/.test(m.subject)) throw new Error("subject: line breaks are not allowed");
  const { raw } = buildRaw(m);
  const known = readJson("drafts.json", {});
  const message = { raw, threadId: ctx.threadId || args.thread_id || undefined };
  let saved, note = "";
  if (args.draft_id) {
    let current;
    try { current = await gmail(c, "GET", "/drafts/" + encodeURIComponent(args.draft_id) + "?format=minimal"); } catch (e) { if (e.status !== 404) throw e; }
    const mine = known[args.draft_id];
    const curId = current && current.message && current.message.id;
    // In place only when nothing can be lost: the draft is exactly what the hub last wrote, or
    // exactly the version the assistant read (base_version) and built this text on.
    if (curId && ((mine && curId === mine.message_id) || (args.base_version && curId === args.base_version))) {
      saved = await gmail(c, "PUT", "/drafts/" + encodeURIComponent(args.draft_id), { id: args.draft_id, message });
      note = mine && curId === mine.message_id ? "updated the draft the hub saved earlier" : "updated the draft, on top of the version you had edited";
    } else {
      saved = await gmail(c, "POST", "/drafts", { message });
      note = current ? "the earlier draft was changed since it was read, so it was left exactly as it is and this version was saved as a separate draft (read it with mail_read draft_id, then pass base_version to change it in place)"
        : "the earlier draft no longer exists, so this was saved as a new draft";
    }
  } else {
    saved = await gmail(c, "POST", "/drafts", { message });
    note = "saved as a new draft";
  }
  known[saved.id] = { message_id: saved.message && saved.message.id, at: new Date().toISOString() };
  writeJson("drafts.json", known);
  return { account: "gmail", draft_id: saved.id, saved_in: "Gmail Drafts of " + c.GMAIL_ADDRESS, note,
    to: m.to, cc: m.cc, bcc: m.bcc, subject: m.subject, sent: false,
    next: "Nothing was sent. You can edit or send it yourself in Gmail, or ask the hub to propose sending it (you then approve it in a terminal)." };
}

// ============================================================ proposing and approving a send
function digestOf(p) {
  return crypto.createHash("sha256").update(JSON.stringify([p.generation, p.account, p.from, p.to, p.cc, p.bcc, p.subject, p.body_sha256,
    p.attachments.map(a => [a.name, a.sha256]), p.thread_id || "", p.in_reply_to || "", p.raw_sha256])).digest("hex");
}
async function proposeSend(args) {
  const c = credentials(); need(c);
  if (!canDraft(c)) throw new Error("gmail: this connection reads only, so it cannot send. Send it yourself from Gmail, or reconnect with: hub-mail connect gmail");
  if (!args.draft_id) throw new Error("draft_id is required: save the message with mail_draft first, so you can see it in Gmail before approving it");
  const id = encodeURIComponent(args.draft_id);
  // The raw text is what gets sent and what the approval binds; the structured view is what
  // the person is shown. Both are read from Gmail now, so a draft you edited in Gmail is
  // proposed as it is now, with your edits.
  const d = await gmail(c, "GET", "/drafts/" + id + "?format=raw");
  const f = await gmail(c, "GET", "/drafts/" + id + "?format=full");
  const raw = d.message && d.message.raw;
  if (!raw || !f.message) throw new Error("could not read that draft from Gmail");
  const m = f.message;
  const to = addrList(hdr(m, "To")), cc = addrList(hdr(m, "Cc")), bcc = addrList(hdr(m, "Bcc"));
  if (!to.length && !cc.length && !bcc.length) throw new Error("the draft has no recipient");
  const attachments = [];
  for (const a of attachmentsParts(m.payload)) {
    let data = a.data ? Buffer.from(a.data, "base64url") : null;
    if (!data && a.attachmentId) {
      const got = await gmail(c, "GET", "/messages/" + encodeURIComponent(m.id) + "/attachments/" + encodeURIComponent(a.attachmentId));
      data = Buffer.from(got.data || "", "base64url");
    }
    data = data || Buffer.alloc(0);
    attachments.push({ name: a.name, bytes: data.length, sha256: crypto.createHash("sha256").update(data).digest("hex") });
  }
  const body = textOf(m.payload);
  const code = crypto.randomBytes(3).toString("hex").toUpperCase();
  const p = { id: code, created: new Date().toISOString(), expires: new Date(Date.now() + APPROVAL_MINUTES * 60000).toISOString(),
    generation: c.GMAIL_GENERATION || "", account: "gmail", from: hdr(m, "From") || c.GMAIL_ADDRESS, to, cc, bcc,
    subject: hdr(m, "Subject"), body, body_sha256: crypto.createHash("sha256").update(body).digest("hex"),
    attachments, thread_id: m.threadId || "", in_reply_to: hdr(m, "In-Reply-To"), message_id_header: hdr(m, "Message-ID"),
    draft_id: args.draft_id, draft_message_id: m.id, raw, raw_sha256: crypto.createHash("sha256").update(raw).digest("hex"), status: "pending" };
  p.digest = digestOf(p);
  const all = readJson("proposals.json", {});
  all[code] = p;
  writeJson("proposals.json", all);
  return { account: "gmail", proposal: code, status: "waiting for your approval", sent: false, expires: p.expires,
    to: p.to, cc: p.cc, bcc: p.bcc, subject: p.subject, attachments: p.attachments.map(a => a.name),
    ask_the_user: `Nothing is sent yet. To send exactly this message, type in a terminal on this computer: hub-mail approve ${code}  (it shows the whole message first; valid for ${APPROVAL_MINUTES} minutes). To drop it: hub-mail reject ${code}` };
}

function attachmentsParts(part, out = []) {
  if (!part) return out;
  if (part.filename) out.push({ name: part.filename, attachmentId: part.body && part.body.attachmentId, data: part.body && part.body.data });
  for (const x of part.parts || []) attachmentsParts(x, out);
  return out;
}

function describe(p) {
  return [
    `From:    ${p.from}`, `To:      ${p.to.join(", ") || "-"}`, `Cc:      ${p.cc.join(", ") || "-"}`,
    `Bcc:     ${p.bcc.join(", ") || "-"}`, `Subject: ${p.subject}`,
    `Attachments: ${p.attachments.length ? p.attachments.map(a => `${a.name} (${a.bytes} bytes, sha256 ${a.sha256.slice(0, 12)})`).join(", ") : "none"}`,
    `Expires: ${p.expires}`, "", "----- message -----", p.body, "----- end -----",
  ].join("\n");
}

// Everything that must hold at the moment of sending, checked again then, not just when the
// proposal was made.
async function checkProposal(p, c) {
  if (!p) return "no such proposal on this computer (proposals are kept on the computer that made them)";
  if (p.status === "sent") return `already sent at ${p.sent_at}; a message is sent once`;
  if (p.status === "rejected") return "you rejected this one";
  if (p.status === "void") return "this proposal was cancelled when the Gmail connection changed";
  if (Date.now() > Date.parse(p.expires)) return `it expired at ${p.expires}; ask for a new proposal`;
  if ((c.GMAIL_GENERATION || "") !== p.generation) return "the Gmail connection changed after this was proposed";
  if (digestOf(p) !== p.digest) return "the saved proposal was altered after it was made";
  const d = await gmail(c, "GET", "/drafts/" + encodeURIComponent(p.draft_id) + "?format=raw").catch(e => ({ gone: e.status === 404, err: e }));
  if (d.err && !d.gone) throw d.err;
  if (d.gone) return "the draft is gone from Gmail (perhaps you sent or deleted it yourself)";
  if (d.message.raw !== p.raw) return "the draft was changed after it was proposed; ask for a new proposal of the current text";
  return "";
}

// The only way anything is sent: a person runs `hub-mail approve <code>` in a terminal, sees
// the whole message, and types the code back. `confirm` is how the command asks; the tests
// hand in their own. There is deliberately no MCP tool for this.
async function approve(code, confirm, opts = {}) {
  code = String(code || "").toUpperCase();
  const c = credentials(); need(c);
  const all = readJson("proposals.json", {});
  const p = all[code];
  if (p && p.status === "unknown") return reconcile(p, all, c, confirm, opts);
  const why = await checkProposal(p, c);
  if (why) return { sent: false, why };
  const typed = await confirm(describe(p) + `\n\nType ${code} to send this message now, or anything else to stop: `);
  if (String(typed || "").trim().toUpperCase() !== code) return { sent: false, why: "not confirmed; nothing was sent" };
  // Recheck: the draft may have changed while the message was on screen.
  const why2 = await checkProposal(p, c);
  if (why2) return { sent: false, why: why2 };
  p.status = "submitting"; p.submitting_at = new Date().toISOString();
  writeJson("proposals.json", all);                           // recorded BEFORE Google is asked
  try {
    const r = await gmail(c, "POST", "/messages/send", { raw: p.raw, threadId: p.thread_id || undefined });
    p.status = "sent"; p.sent_at = new Date().toISOString(); p.gmail_id = r.id;
    delete p.raw; delete p.body;                             // the outbox keeps no message text once it went
    writeJson("proposals.json", all);
    await gmail(c, "DELETE", "/drafts/" + encodeURIComponent(p.draft_id)).catch(() => {});
    audit({ op: "send", proposal: code, to: p.to.length + p.cc.length + p.bcc.length, digest: p.digest.slice(0, 16), gmail_id: r.id, result: "sent" });
    return { sent: true, gmail_id: r.id, to: p.to };
  } catch (e) {
    if (e.status && e.status >= 400 && e.status < 500) {
      p.status = "failed"; p.error = e.message; writeJson("proposals.json", all);
      audit({ op: "send", proposal: code, result: "failed", error: e.status });
      return { sent: false, why: "Gmail refused it: " + e.message };
    }
    p.status = "unknown"; writeJson("proposals.json", all);
    audit({ op: "send", proposal: code, result: "unknown" });
    return { sent: false, why: "Gmail did not answer, so it is not known whether the message went. Run hub-mail approve " + code + " again: it checks your Sent mail first and never sends twice." };
  }
}

// A send whose answer was lost: look in Sent for our own Message-ID before anything else.
async function reconcile(p, all, c, confirm, opts) {
  const since = Math.floor(Date.parse(p.submitting_at || p.created) / 1000) - 60;
  const q = new URLSearchParams({ maxResults: "1", q: p.message_id_header
    ? "in:sent rfc822msgid:" + p.message_id_header.replace(/[<>]/g, "")
    : `in:sent after:${since} subject:"${String(p.subject).replace(/"/g, "")}"` + (p.to[0] ? " to:" + (p.to[0].match(/<([^>]+)>/) || [null, p.to[0]])[1] : "") });
  const found = await gmail(c, "GET", "/messages?" + q);
  if ((found.messages || []).length) {
    p.status = "sent"; p.sent_at = "confirmed later"; p.gmail_id = found.messages[0].id; delete p.raw; delete p.body;
    writeJson("proposals.json", all);
    return { sent: true, gmail_id: p.gmail_id, note: "it had gone after all; found in your Sent mail, not sent again" };
  }
  p.status = "pending"; writeJson("proposals.json", all);
  return approve(p.id, confirm, opts);
}

function reject(code) {
  code = String(code || "").toUpperCase();
  const all = readJson("proposals.json", {});
  if (!all[code]) return { ok: false, why: "no such proposal" };
  if (all[code].status !== "pending") return { ok: false, why: "it is " + all[code].status };
  all[code].status = "rejected"; delete all[code].raw; delete all[code].body;
  writeJson("proposals.json", all);
  return { ok: true };
}

function pending() {
  const all = readJson("proposals.json", {});
  return Object.values(all).filter(p => p.status === "pending" && Date.now() <= Date.parse(p.expires))
    .map(p => ({ proposal: p.id, to: p.to, subject: p.subject, expires: p.expires }));
}

// Purge what no longer needs keeping: finished proposals after 30 days, expired ones' text now.
function tidy() {
  const all = readJson("proposals.json", {});
  let changed = false;
  for (const [k, p] of Object.entries(all)) {
    if (p.status === "pending" && Date.now() > Date.parse(p.expires)) { p.status = "expired"; delete p.raw; delete p.body; changed = true; }
    if (["sent", "rejected", "expired", "failed", "void"].includes(p.status) && Date.now() - Date.parse(p.created) > 30 * 86400000) { delete all[k]; changed = true; }
  }
  if (changed) writeJson("proposals.json", all);
}

function audit(entry) {
  const f = path.join(stateDir(), "audit.jsonl");
  fs.appendFileSync(f, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n", { mode: 0o600 });
}

// ============================================================ connecting
function openBrowser(url) {
  const cmd = process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : process.platform === "darwin" ? ["open", [url]] : ["xdg-open", [url]];
  try { spawnSync(cmd[0], cmd[1], { stdio: "ignore", timeout: 5000 }); } catch (e) { /* the URL is printed anyway */ }
}

// The browser half of Google's sign-in for installed programs: a one-time listener on this
// computer, a random state, and PKCE (S256), so the code Google hands back is useless to
// anyone who did not start this sign-in.
function authorize({ clientId, clientSecret, scopes, say, open = openBrowser, timeoutMs = 300000 }) {
  return new Promise((resolve, reject) => {
    const verifier = crypto.randomBytes(48).toString("base64url");
    const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
    const state = crypto.randomBytes(16).toString("hex");
    const server = http.createServer(async (req, res) => {
      const u = new URL(req.url, "http://127.0.0.1");
      if (u.pathname !== "/callback") { res.writeHead(404); return res.end(); }
      const finish = (msg, ok) => { res.writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(`<!doctype html><meta charset="utf-8"><title>Hub mail</title><p style="font:16px sans-serif;margin:3em">${msg}</p>`); };
      if (u.searchParams.get("state") !== state) return finish("This answer did not come from the sign-in this computer started. Nothing was changed.", false);
      if (u.searchParams.get("error")) { finish("You did not allow it, so nothing was connected. You can close this tab.", false); server.close(); return reject(new Error("you did not allow it, so nothing was connected")); }
      const code = u.searchParams.get("code");
      const r = await post(TOKEN_URL, { code, client_id: clientId, client_secret: clientSecret || "", code_verifier: verifier,
        grant_type: "authorization_code", redirect_uri: redirect });
      server.close();
      if (r.status !== 200 || !r.body.refresh_token) {
        finish("Google did not hand over a lasting connection. Nothing was changed; the terminal says what to do.", false);
        return reject(new Error("Google did not hand over a lasting connection (" + (r.body.error || r.status) + ")"));
      }
      finish("Done. Your hub has its answer from Google; you can close this tab and go back to the terminal.", true);
      resolve(r.body);
    });
    let redirect = "";
    server.listen(0, "127.0.0.1", () => {
      redirect = `http://127.0.0.1:${server.address().port}/callback`;
      const url = AUTH_URL + "?" + new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: "code",
        scope: scopes.join(" "), access_type: "offline", prompt: "consent", state, code_challenge: challenge, code_challenge_method: "S256" });
      say("Opening Google in your browser. If nothing opens, copy this address into it:\n" + url);
      open(url);
    });
    setTimeout(() => { server.close(); reject(new Error("no answer from the browser within 5 minutes; nothing was changed. Run it again when you are ready.")); }, timeoutMs).unref();
  });
}

// connect gmail: one browser sign-in, then the account is checked and shown BEFORE it is kept.
async function connect({ readOnly = false, ask, say, open, clientId, clientSecret }) {
  const before = credentials();
  clientId = clientId || before.GMAIL_CLIENT_ID || process.env.HUB_MAIL_GOOGLE_CLIENT_ID;
  clientSecret = clientSecret || before.GMAIL_CLIENT_SECRET || process.env.HUB_MAIL_GOOGLE_CLIENT_SECRET;
  if (!clientId) {
    say("Your hub needs the two lines Google gives you for a desktop app (the walkthrough: mail/gmail-setup.md in the kit).");
    clientId = String(await ask("Client ID: ", false) || "").trim();
    clientSecret = String(await ask("Client secret (it stays hidden): ", true) || "").trim();
  }
  if (!/\.apps\.googleusercontent\.com$/.test(clientId)) throw new Error("that does not look like a Google client ID (it ends in .apps.googleusercontent.com). Nothing was changed.");
  const scopes = readOnly ? [SCOPE_READ] : [SCOPE_READ, SCOPE_COMPOSE];
  const tok = await authorize({ clientId, clientSecret, scopes, say, open });
  const granted = String(tok.scope || "").split(/\s+/);
  const missing = scopes.filter(s => !granted.includes(s));
  if (missing.length) throw new Error("Google granted less than asked (" + missing.map(s => s.split("/").pop()).join(", ") + " missing). Tick every box on Google's screen and run it again. Nothing was changed.");
  const probe = { GMAIL_CLIENT_ID: clientId, GMAIL_CLIENT_SECRET: clientSecret, GMAIL_REFRESH_TOKEN: tok.refresh_token, GMAIL_GENERATION: "probe" };
  cached = { token: tok.access_token, expires: Date.now() + 3000000, generation: "probe" };
  const prof = await gmail(probe, "GET", "/profile");
  const answer = String(await ask(`Google says this is ${prof.emailAddress}. Connect this mailbox to your hub? (yes/no) `, false) || "").trim().toLowerCase();
  if (!/^y(es)?$/.test(answer)) {
    await post(REVOKE_URL, { token: tok.refresh_token }).catch(() => {});
    throw new Error("not connected; the sign-in was withdrawn at Google again");
  }
  if (before.GMAIL_REFRESH_TOKEN && before.GMAIL_REFRESH_TOKEN !== tok.refresh_token) {
    await post(REVOKE_URL, { token: before.GMAIL_REFRESH_TOKEN }).catch(() => {});
  }
  const generation = crypto.randomBytes(6).toString("hex");
  const store = writeStore({ GMAIL_CLIENT_ID: clientId, GMAIL_CLIENT_SECRET: clientSecret, GMAIL_REFRESH_TOKEN: tok.refresh_token,
    GMAIL_ADDRESS: prof.emailAddress, GMAIL_SCOPES: granted.filter(s => /gmail/.test(s)).join(" "), GMAIL_GENERATION: generation });
  voidProposals();
  cached = null;
  return { address: prof.emailAddress, readOnly, store };
}

function voidProposals() {
  const all = readJson("proposals.json", {});
  for (const p of Object.values(all)) if (p.status === "pending" || p.status === "submitting") { p.status = "void"; delete p.raw; delete p.body; }
  writeJson("proposals.json", all);
}

// disconnect: the hub stops at once; Google is asked to forget the permission too.
async function disconnect() {
  const c = credentials();
  voidProposals();
  cached = null;
  if (!c.GMAIL_REFRESH_TOKEN) return { local: "was not connected", google: "nothing to withdraw" };
  let google = "withdrawn";
  try {
    const r = await post(REVOKE_URL, { token: c.GMAIL_REFRESH_TOKEN });
    if (r.status !== 200 && r.body.error !== "invalid_token") google = "not confirmed (" + (r.body.error || r.status) + "); remove it by hand at https://myaccount.google.com/permissions";
  } catch (e) { google = "not reached; remove it by hand at https://myaccount.google.com/permissions"; }
  writeStore({ GMAIL_REFRESH_TOKEN: null, GMAIL_ADDRESS: null, GMAIL_SCOPES: null, GMAIL_GENERATION: crypto.randomBytes(6).toString("hex") });
  return { local: "disconnected: no assistant of this hub can read or draft in that mailbox any more", google,
    kept: "your Gmail messages and any drafts are untouched" };
}

async function status() {
  const c = credentials();
  if (!c.GMAIL_REFRESH_TOKEN) return { account: "gmail", state: "not connected", note: "Optional. When you want it: hub-mail connect gmail. Until then, paste an email or forward it to the hub's address." };
  try {
    const prof = await gmail(c, "GET", "/profile");
    return { account: "gmail", address: prof.emailAddress, state: canDraft(c) ? "connected" : "reading only",
      can: canDraft(c) ? ["search", "read", "save drafts", "propose a send (you approve it)"] : ["search", "read"],
      note: canDraft(c) ? "Reading and drafting are on. Sending needs your approval of the exact message: hub-mail approve <code>." : "Reading only. Drafts stay as text in the hub.",
      pending: pending().length, checked_at: new Date().toISOString() };
  } catch (e) {
    return { account: "gmail", address: c.GMAIL_ADDRESS, state: e.reconnect ? "reconnect needed" : "unreachable", error: e.message };
  }
}

module.exports = { findHub, credentials, search, read, draft, listDrafts, proposeSend, approve, reject, pending, tidy, connect, disconnect, status,
  authorize, writeStore, readStore, buildRaw, SCOPE_READ, SCOPE_COMPOSE };
