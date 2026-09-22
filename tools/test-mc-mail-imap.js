#!/usr/bin/env node
/*
 * The gate for mc-mail's Gmail route through Himalaya: the REAL pinned Himalaya 2.1.0 program,
 * talking to a stand-in for Gmail's IMAP door on 127.0.0.1 (test-mc-mail-imap-fixture.js).
 * Nothing here can reach a real mailbox: the address is invented, the password is invented, and
 * the settings refuse any server but 127.0.0.1. This is a simulation: it proves the mission control's own
 * code and the program's commands, not Google's sign-in rules or Gmail's search.
 *
 * What it proves, in the order a reader meets it:
 *   the program: the pinned archive is used only when its SHA-256 matches;
 *   connecting: a wrong app password is refused and asked again, the right one is checked with
 *     Gmail before anything is kept, Drafts is found by its mark (in German too), and no file
 *     but the locked one holds the password;
 *   reading: search gives references, a read leaves the message unread, the text arrives marked
 *     untrusted, attachments are named but not saved, a stale or foreign reference is refused;
 *   drafts: one append, into Drafts, with the Draft flag, never sent; a reply keeps the thread
 *     headers and goes to the sender only; a lost answer is looked up instead of saved twice;
 *     an unknown outcome is never retried blindly; two drafts at once are both kept;
 *   trouble: a refused password reads as "reconnect", not as "no mail";
 *   the tool: no send tool, the older Gmail tools hidden, and "gmail" never answered from the
 *     mission control's own inbox.
 *
 * The program comes from GODSPEED_MAIL_HIMALAYA_ARCHIVE when set (a .tgz), else it is downloaded
 * once into the system's temp folder and checked against the same pinned hash.
 *
 * Usage: node tools/test-mc-mail-imap.js
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawn, spawnSync } = require("child_process");

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail) => { if (cond) { PASS++; console.log("  ok   " + name); } else { FAIL++; console.log("  FAIL " + name + (detail ? "\n       " + String(detail).slice(0, 600) : "")); } };

const MANIFEST = require("./mc-mail-himalaya.json");
const key = process.platform + "-" + process.arch;
const A = MANIFEST.assets[key];

async function archive() {
  if (process.env.GODSPEED_MAIL_HIMALAYA_ARCHIVE) return process.env.GODSPEED_MAIL_HIMALAYA_ARCHIVE;
  if (!A) return "";
  const cache = path.join(os.tmpdir(), "mc-mail-test-" + A.asset);
  if (fs.existsSync(cache) && crypto.createHash("sha256").update(fs.readFileSync(cache)).digest("hex") === A.sha256) return cache;
  try {
    const res = await fetch(MANIFEST.download + A.asset, { signal: AbortSignal.timeout(120000) });
    if (!res.ok) return "";
    fs.writeFileSync(cache, Buffer.from(await res.arrayBuffer()));
    return cache;
  } catch (e) { return ""; }
}

async function main() {
  if (!A || !A.tested) { console.log(`SKIP: ${key} is not a tested kind of computer for the mail program`); process.exit(0); }
  const tgz = await archive();
  if (!tgz) { console.log("SKIP: the pinned Himalaya archive could not be fetched (offline?)"); process.exit(1); }

  const W = fs.mkdtempSync(path.join(os.tmpdir(), "godspeed mail imap "));   // a space, on purpose
  const HOME = path.join(W, "home"), GODSPEED = path.join(W, "godspeed");
  fs.mkdirSync(path.join(HOME, ".godspeed"), { recursive: true });
  fs.mkdirSync(GODSPEED, { recursive: true });
  fs.writeFileSync(path.join(GODSPEED, "AGENTS.md"), "# test godspeed\n");
  for (const k of Object.keys(process.env)) if (/^GMAIL_|^AGENTMAIL_|^GODSPEED_MAIL_/.test(k)) delete process.env[k];
  Object.assign(process.env, { GODSPEED_MAIL_HOME: HOME, GODSPEED_DIR: GODSPEED, GODSPEED_AGE_KEY: path.join(HOME, ".godspeed", "no-store-key"), GODSPEED_MAIL_IMAP_TIMEOUT_MS: "20000" });

  const F = require("./test-mc-mail-imap-fixture.js");
  const f = await F.start();
  process.env.GODSPEED_MAIL_IMAP_TEST_SERVER = "imap://127.0.0.1:" + f.port;
  const I = require("./mc-mail-imap.js");
  const base = I.base();

  // ---- the program
  const bad = path.join(W, "tampered.tgz");
  const buf = fs.readFileSync(tgz); buf[buf.length - 1] ^= 0xff; fs.writeFileSync(bad, buf);
  process.env.GODSPEED_MAIL_HIMALAYA_ARCHIVE = bad;
  let err = ""; try { await I.install(); } catch (e) { err = e.message; }
  ok("1 an archive whose SHA-256 is not the pinned one is refused, and nothing is installed", /not the pinned one/.test(err) && !fs.existsSync(path.join(base, "bin", A.binary)), err);
  process.env.GODSPEED_MAIL_HIMALAYA_ARCHIVE = tgz;
  const exe = await I.install();
  const v = spawnSync(exe, ["--version"], { encoding: "utf8" });
  ok("2 the pinned archive installs Himalaya " + MANIFEST.version + " in the mission control's own mail folder", v.stdout.includes("v" + MANIFEST.version) && exe.startsWith(base));

  // ---- connecting
  const script = (answers) => { const asked = []; const left = answers.slice();
    return { asked, ask: async (q, hidden) => { asked.push({ q, hidden: !!hidden }); return left.length ? left.shift() : "stop"; } }; };
  let said = [];
  const say = s => said.push(String(s));
  let s1 = script(["stop"]);
  let r = await I.connectHere({ ask: s1.ask, say, open: () => {} });
  ok("3 stop at the first question changes nothing", !r.connected && !I.readState());
  said = []; const opened = [];
  s1 = script([F.USER, "wrong wrong wrong", "zzzz zzzz zzzz zzzz", "abcd efgh ijkl mnop"]);
  r = await I.connectHere({ ask: s1.ask, say, open: u => opened.push(u) });
  const text = said.join("\n");
  ok("4 a password that is not 16 letters is asked for again without asking Gmail", /That was not 16 letters/.test(text));
  ok("5 a password Gmail refuses is explained and asked for again", /did not accept that password/.test(text) && r.connected, text.slice(-600));
  ok("6 the app password is only ever asked hidden", s1.asked.filter(a => /16 letters/.test(a.q)).every(a => a.hidden));
  ok("7 Google's app password page is opened for that address", opened.length === 1 && opened[0].includes("myaccount.google.com/apppasswords") && opened[0].includes(encodeURIComponent(F.USER)));
  const st = I.readState();
  ok("8 Drafts is found by its mark, in German too, and All Mail with it", st && st.drafts === F.DRAFTS_UNICODE && st.all === F.ALL && st.state === "ready", JSON.stringify(st));
  const everything = fs.readdirSync(base).filter(n => fs.statSync(path.join(base, n)).isFile()).map(n => fs.readFileSync(path.join(base, n), "latin1")).join("\n");
  ok("9 the password is in no file on disk except the locked one", !everything.includes(F.PASSWORD) && fs.existsSync(path.join(base, "password.age")));
  ok("10 no leftover staging folder, and the settings name the stand-in only by 127.0.0.1", !fs.existsSync(path.join(base, "staging")) && /127\.0\.0\.1/.test(fs.readFileSync(path.join(base, "account.toml"), "utf8")));
  if (process.platform === "win32") {
    const acl = spawnSync("icacls", [base], { encoding: "utf8" }).stdout || "";
    ok("11 on Windows the mail folder's access list names this account and the system only", fs.existsSync(path.join(base, ".acl")) && !/Everyone|BUILTIN\\Users|Authenticated Users|Jeder|Benutzer/i.test(acl), acl);
  } else {
    ok("11 the mail folder is readable by this account only", (fs.statSync(base).mode & 0o077) === 0);
  }

  // ---- the password helper
  const helper = spawnSync(process.execPath, [path.join(__dirname, "mc-mail-imap.js"), "secret", path.join(base, "password.age")], { encoding: "utf8", env: Object.assign({}, process.env, { GODSPEED_MAIL_IMAP_PIPE: "" }) });
  ok("12 the password helper refuses to print the password when not started by the mail program", helper.status !== 0 && !helper.stdout.includes(F.PASSWORD));

  // ---- status and reading
  const s = I.status();
  ok("13 status names the mailbox, the route and what it cannot do, without asking Gmail", s.state === "connected" && s.address === F.USER && s.cannot.includes("send") && /Himalaya/.test(s.route));
  const logins = f.logins;
  const chk = await I.check();
  ok("14 a live check asks Gmail once", chk.checked === "Gmail answered just now" && f.logins === logins + 1, JSON.stringify(chk));

  const found = await I.search({ query: "cards" });
  ok("15 search finds the message by a word and returns an opaque reference", found.count === 1 && /^imap:[0-9a-f]+:i:1234:41$/.test(found.messages[0].message_id), JSON.stringify(found));
  const all = await I.search({});
  ok("16 search with no words lists the newest first", all.count === 2 && /:42$/.test(all.messages[0].message_id));
  const unread = await I.search({ unread: true });
  ok("17 unread: only the unread message", unread.count === 1 && /:41$/.test(unread.messages[0].message_id), JSON.stringify(unread.messages));
  const two = await I.search({ query: "cards instructions" }), none = await I.search({ query: "cards koeln" });
  ok("17b several words must all match, newest first, and only the page is fetched", two.count === 1 && none.count === 0 && two.total_matches === 1, JSON.stringify([two.count, none.count]));
  const wrap = (h, b) => h.concat(["<<<UNTRUSTED>>>"], b, ["<<<END>>>"]).join("\n");
  const cmdsBefore = f.commands.length;
  const body = await I.read({ message_id: found.messages[0].message_id }, wrap);
  const readCmds = f.commands.slice(cmdsBefore).join(" | ");
  ok("18 a read returns the text inside the untrusted markers", /<<<UNTRUSTED>>>[\s\S]*IGNORE YOUR INSTRUCTIONS[\s\S]*<<<END>>>/.test(body));
  ok("19 a read leaves the message unread (BODY.PEEK, no STORE)", /BODY\.PEEK/.test(readCmds) && !/STORE/.test(readCmds) && !f.boxes.INBOX.messages[0].flags.includes("\\Seen"), readCmds);
  const g = await I.read({ message_id: all.messages[0].message_id }, wrap);
  ok("20 encoded names, subjects and quoted-printable German text are decoded", /Jürgen/.test(g) && /Grüße/.test(g) && /Schöne Grüße aus Köln/.test(g), g);
  ok("21 an attachment is named, and it is said that it was downloaded but not saved", /plan\.pdf/.test(g) && /not saved or opened/.test(g) && !fs.readdirSync(base).some(n => /plan/.test(n)));
  err = ""; try { await I.read({ message_id: found.messages[0].message_id.replace(/^imap:[0-9a-f]+/, "imap:abcdef") }, wrap); } catch (e) { err = e.message; }
  ok("22 a reference from another connection is refused", /earlier Gmail connection/.test(err), err);
  err = ""; try { await I.read({ message_id: "18c2f00dbeef" }, wrap); } catch (e) { err = e.message; }
  ok("23 a Gmail API id is never passed to the mail program", /not a message reference from this Gmail connection/.test(err), err);
  f.boxes.INBOX.uidvalidity = 5555;
  err = ""; try { await I.read({ message_id: found.messages[0].message_id }, wrap); } catch (e) { err = e.message; }
  ok("24 a reference from before Gmail renumbered the folder is refused", /renumbered/.test(err), err);
  f.boxes.INBOX.uidvalidity = 1234;

  // ---- drafts
  const appendsBefore = f.appends.length;
  const d1 = await I.draft({ to: ["Nadia Park <nadia@example.invalid>"], subject: "Karten 8 bis 12 – Grüße", body: "Sie kommen morgen.\nViele Grüße" });
  const ap = f.appends[appendsBefore];
  ok("25 a draft is saved with no approval and nothing sent", d1.saved === true && d1.sent === false && f.appends.length === appendsBefore + 1, JSON.stringify(d1));
  ok("26 it goes into Drafts, flagged as a draft", ap && ap.mailbox === F.DRAFTS && /\\Draft/.test(ap.args), ap && ap.args);
  ok("27 the saved message is whole: sender, recipient, encoded subject, own Message-ID, text", ap && /From: reader@example\.invalid/.test(ap.raw) && /To: "Nadia Park" <nadia@example\.invalid>/.test(ap.raw)
    && /Subject: =\?UTF-8\?B\?/.test(ap.raw) && /Message-ID: <godspeedmail\.[0-9a-f]+@example\.invalid>/.test(ap.raw) && Buffer.from(ap.raw.split("\r\n\r\n")[1].replace(/\s/g, ""), "base64").toString("utf8").includes("Viele Grüße"), ap && ap.raw);
  const d2 = await I.draft({ reply_to_message_id: found.messages[0].message_id, body: "Tomorrow." });
  const ap2 = f.appends[f.appends.length - 1];
  ok("28 a reply keeps the thread headers and the subject, and goes to the sender only", d2.saved === true && /In-Reply-To: <cards@example\.invalid>/.test(ap2.raw) && /References: <cards@example\.invalid>/.test(ap2.raw)
    && /Subject: Re: Cards 8 to 12/.test(ap2.raw) && /To: "Nadia Park" <nadia@example\.invalid>/.test(ap2.raw) && !/Cc:/.test(ap2.raw), ap2.raw);
  err = ""; try { await I.draft({ to: ["a@example.invalid"], subject: "x\r\nBcc: evil@example.invalid", body: "x" }); } catch (e) { err = e.message; }
  ok("29 a line break in a header is refused (no header injection)", /line breaks/.test(err));
  err = ""; try { await I.draft({ to: ["a@example.invalid\r\nBcc: evil@example.invalid"], body: "x" }); } catch (e) { err = e.message; }
  ok("30 a line break in an address is refused", /line breaks|not an email address/.test(err));
  err = ""; try { await I.draft({ draft_id: "r-123", body: "x", to: ["a@example.invalid"] }); } catch (e) { err = e.message; }
  ok("31 changing an existing draft is refused plainly, not attempted", /new drafts only/.test(err));
  const dl = await I.listDrafts({});
  ok("32 mail_drafts lists what is in Drafts now", dl.count === 2 && dl.drafts.every(x => /^imap:[0-9a-f]+:d:777:\d+$/.test(x.message_id)), JSON.stringify(dl));

  // The answer to a save is lost after Gmail took the draft: found in Drafts, not saved again.
  f.opts.dropAppendReply = true;
  const n3 = f.appends.length;
  const d3 = await I.draft({ to: ["b@example.invalid"], subject: "Lost answer", body: "one copy only" });
  f.opts.dropAppendReply = false;
  ok("33 a lost answer is checked in Drafts: saved, and saved once", d3.saved === true && f.appends.length === n3 + 1 && /not saved again/.test(d3.note), JSON.stringify(d3));
  // No answer and nothing in Drafts: uncertain, and never retried blindly.
  process.env.GODSPEED_MAIL_IMAP_TIMEOUT_MS = "4000";
  f.opts.swallowAppend = true;
  const n4 = f.appends.length;
  const d4 = await I.draft({ to: ["c@example.invalid"], subject: "Unknown", body: "maybe" });
  ok("34 no answer and not in Drafts: the result says uncertain and names the next step", d4.saved === "uncertain" && /after_checking_drafts/.test(d4.next), JSON.stringify(d4));
  f.opts.swallowAppend = false;
  const d5 = await I.draft({ to: ["c@example.invalid"], subject: "Unknown", body: "maybe" });
  ok("35 the same draft asked again is NOT saved again while its first try is unknown", d5.saved === "uncertain" && f.appends.length === n4 + 1, JSON.stringify(d5));
  const d6 = await I.draft({ to: ["c@example.invalid"], subject: "Unknown", body: "maybe", after_checking_drafts: true });
  ok("36 after the person checked Drafts, it is saved", d6.saved === true && f.appends.length === n4 + 2);
  process.env.GODSPEED_MAIL_IMAP_TIMEOUT_MS = "20000";
  const jr = fs.readFileSync(path.join(base, "journal.jsonl"), "utf8");
  ok("37 the journal holds every try and what became of it, and no message text", /"state":"uncertain"/.test(jr) && /"state":"abandoned"/.test(jr) && !/maybe|one copy only/.test(jr));
  // Two drafts at once, from two assistants.
  const n7 = f.appends.length;
  const both = await Promise.all([I.draft({ to: ["d@example.invalid"], subject: "One", body: "1" }), I.draft({ to: ["d@example.invalid"], subject: "Two", body: "2" })]);
  const ids = f.appends.slice(n7).map(a => (a.raw.match(/Message-ID: (\S+)/) || [])[1]);
  ok("38 two drafts at once are both saved, one after the other, each with its own Message-ID", both.every(x => x.saved === true) && ids.length === 2 && ids[0] !== ids[1]);

  // ---- trouble
  f.opts.rejectAuth = true;
  const lg = f.logins;
  err = ""; let kind = "";
  try { await I.search({}); } catch (e) { err = e.message; kind = e.kind; }
  ok("39 a refused app password reads as reconnect, and is not retried", kind === "auth" && /Reconnect/.test(err) && f.logins === lg + 1 && I.status().state === "disconnected", err);
  f.opts.rejectAuth = false;
  const back = await I.check();
  ok("40 once Gmail accepts it again, a check says connected", back.state === "connected");

  // ---- the tool an assistant sees
  const mcp = lines => new Promise(res => {
    const c = spawn(process.execPath, [path.join(__dirname, "mc-mail.js"), "mcp"], { env: process.env });
    let out = ""; c.stdout.on("data", d => out += d);
    c.stdin.write(lines.map(x => JSON.stringify(x)).join("\n") + "\n");
    setTimeout(() => { c.kill(); res(out); }, 6000);
  });
  const o = await mcp([{ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }, { jsonrpc: "2.0", id: 2, method: "tools/list" },
    { jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "mail_search", arguments: { query: "cards" } } }]);
  ok("41 the assistant sees no send, attachment or approval tool on this connection", /"mail_draft"/.test(o) && /"mail_connect"/.test(o) && !/mail_send"|"mail_attachment"|"mail_propose_send"|"mail_pending"/.test(o), o.slice(0, 400));
  ok("42 mail_search without an account searches Gmail", /imap:[0-9a-f]+:i:1234:41/.test(o) && /"account\\":\s*\\"gmail\\"|account.: .gmail/.test(o), o.slice(-500));
  I.disconnect();
  const o2 = await mcp([{ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "mail_search", arguments: { query: "cards" } } }]);
  ok("43 with Gmail not connected, a search for Gmail says so and is never answered from the mission control's own address", /gmail: not connected/.test(o2) && /account \\"godspeed\\" only when/.test(o2), o2);
  const retired = spawnSync(process.execPath, [path.join(__dirname, "mc-mail.js"), "connect", "gmail", "--guided"], { encoding: "utf8", env: process.env });
  ok("44 the retired Gmail step says it is retired, changes nothing and names the new way", retired.status === 3 && /retired, and nothing was changed/.test(retired.stdout) && /Connect Gmail for me/.test(retired.stdout));
  const gs = spawnSync(process.execPath, [path.join(__dirname, "mc-mail.js"), "gmail-state"], { encoding: "utf8", env: process.env });
  ok("45 older installers are never told 'not-connected', so they stop offering the retired step", gs.stdout.trim() === "optional", gs.stdout);

  await f.close();
  fs.rmSync(W, { recursive: true, force: true });
  console.log(`${PASS} passed, ${FAIL} failed`);
  process.exit(FAIL ? 1 : 0);
}
main().catch(e => { console.log("CRASH " + (e.stack || e)); process.exit(1); });
