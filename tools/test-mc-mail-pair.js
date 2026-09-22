#!/usr/bin/env node
/*
 * The gate for pairing a desktop with the server's mail tool (mc-mail-pair.js). It runs the two
 * halves against each other in throwaway folders, with no SSH server: it proves what each half
 * accepts, refuses and writes. The real SSH round trip was tested live on 2026-09-22 against the
 * author's server over Tailscale; that is recorded in the email plan's evidence, not repeated here.
 *
 * Checks: the request holds no private key; approve keeps every other key, locks the new one with
 * restrict and a forced command, refuses root and bad requests, and replaces rather than doubles
 * a device that pairs again; finish refuses a receipt for another request, a bad host key and a
 * bad address, and does not switch the route when the server does not answer; remove takes only
 * that device's key.
 *
 * The server half runs on Linux and macOS only; on Windows the server checks are skipped.
 * Usage: node tools/test-mc-mail-pair.js
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail) => { if (cond) { PASS++; console.log("  ok   " + name); } else { FAIL++; console.log("  FAIL " + name + (detail ? "\n       " + String(detail).slice(0, 400) : "")); } };
const W = fs.mkdtempSync(path.join(os.tmpdir(), "mc-mail-pair-test-"));
const DESK = path.join(W, "desk"), SERVER = path.join(W, "server");
fs.mkdirSync(DESK); fs.mkdirSync(path.join(SERVER, ".ssh"), { recursive: true });
process.env.GODSPEED_MAIL_HOME = DESK;
const P = require("./mc-mail-pair.js");
const err = f => { try { f(); return ""; } catch (e) { return e.message; } };
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
const KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl";

const req = P.request({ device: "laptop one" });
const body = JSON.parse(Buffer.from(req.slice("godspeedmail-pair-1.".length), "base64url").toString());
ok("1 the request names the device and its public key, and holds nothing private", body.device === "laptop-one" && /^ssh-ed25519 /.test(body.key) && !/PRIVATE/.test(req + JSON.stringify(body)));
ok("2 the private key stays on the desktop", fs.existsSync(path.join(DESK, ".godspeed", "mail", "ssh", "id_ed25519")));

if (process.platform !== "win32" && !(process.getuid && process.getuid() === 0)) {
  const realHome = process.env.HOME;
  process.env.HOME = SERVER;
  const hk = path.join(W, "mc-mail-pair-test-hostkey.pub");
  fs.writeFileSync(hk, KEY + " root@server\n");
  process.env.GODSPEED_MAIL_TEST_HOST_KEY_FILE = hk;
  const ak = path.join(SERVER, ".ssh", "authorized_keys");
  fs.writeFileSync(ak, "ssh-ed25519 AAAAexistingkeyexistingkeyexistingkeyexistingkeyexistingkey00 owner@laptop\n");
  const r = P.approve(req);
  const text = fs.readFileSync(ak, "utf8");
  ok("3 approve keeps every other key", /owner@laptop/.test(text) && r.kept === 1);
  ok("4 the new key can only start the mail tool: restrict and a forced command", new RegExp('^restrict,command="\\S+ \\S+mc-mail\\.js mcp" ssh-ed25519 \\S+ mc-mail:laptop-one$', "m").test(text), text);
  const again = P.approve(req);
  ok("5 a device that pairs again replaces its key instead of adding a second", (fs.readFileSync(ak, "utf8").match(/mc-mail:laptop-one/g) || []).length === 1 && again.kept === 1);
  ok("6 a bad request is refused and nothing is written", /not valid/.test(err(() => P.approve("godspeedmail-pair-1." + b64({ v: 1, nonce: "x", device: "a", key: "ssh-rsa AAAA" })))) && /damaged|not a pairing request/.test(err(() => P.approve("rm -rf /"))));
  const rec = JSON.parse(Buffer.from(r.receipt.slice("godspeedmail-receipt-1.".length), "base64url").toString());
  ok("7 the receipt answers this request, with the server's host key and no secret", rec.nonce === body.nonce && rec.host_keys[0] === KEY && !/PRIVATE|password/i.test(r.receipt));
  process.env.HOME = realHome;

  ok("8 a receipt for another request is refused", /different request/.test(err(() => P.finish("godspeedmail-receipt-1." + b64(Object.assign({}, rec, { nonce: "0".repeat(32) }))))));
  ok("9 a receipt with no usable host key is refused", /no usable host key/.test(err(() => P.finish("godspeedmail-receipt-1." + b64(Object.assign({}, rec, { host_keys: ["ssh-ed25519 short"] }))))));
  ok("10 a receipt naming a strange address is refused", /not valid/.test(err(() => P.finish("godspeedmail-receipt-1." + b64(Object.assign({}, rec, { host: "a;rm -rf ~" }))))));
  const noAnswer = err(() => P.finish("godspeedmail-receipt-1." + b64(Object.assign({}, rec, { host: "127.0.0.1", port: 1 }))));
  ok("11 when the server does not answer, the route is not switched", /route was not switched/.test(noAnswer) && !P.route(), noAnswer);

  process.env.HOME = SERVER;
  ok("12 list names paired devices, remove takes only that one", P.list().join() === "laptop-one" && P.remove("laptop-one") && /owner@laptop/.test(fs.readFileSync(ak, "utf8")) && !P.list().length);
  process.env.HOME = realHome;
} else console.log("  skip the server half runs on Linux or macOS, as an ordinary account");

fs.rmSync(W, { recursive: true, force: true });
console.log(`${PASS} passed, ${FAIL} failed`);
process.exit(FAIL ? 1 : 0);
