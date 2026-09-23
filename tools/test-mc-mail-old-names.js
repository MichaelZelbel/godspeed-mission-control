#!/usr/bin/env node
// The mail tool must still find what a machine set up before 2026-09-22 wrote down.
//
// WHY. The rename moved every name the mail tool reads: ~/.hub/ became ~/.godspeed/,
// secrets/hub-secrets.env.age became secrets/mc-secrets.env.age, HUB_DIR became GODSPEED_DIR,
// HUB_MAIL_AGENTMAIL_INBOX became GODSPEED_MAIL_AGENTMAIL_INBOX, and the .mcp.json entry went
// from hub-mail to mc-mail. It kept none of the old ones, so on every machine installed before
// that day, the author's own included, the tool looked in empty places and found no store, no
// key and no inbox. Never one name: the new name first, the old one when only it exists.
//
//   node tools/test-mc-mail-old-names.js
"use strict";
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const work = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "mc-mail-old-")));
const home = path.join(work, "home");
const hub = path.join(work, "hub");
const elsewhere = path.join(work, "elsewhere");
for (const d of [home, hub, elsewhere]) fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(hub, "AGENTS.md"), "x");

for (const v of ["GODSPEED_DIR", "HUB_DIR", "GODSPEED_AGE_KEY", "HUB_AGE_KEY", "GODSPEED_MAIL_AGENTMAIL_INBOX",
  "HUB_MAIL_AGENTMAIL_INBOX", "AGENTMAIL_READ_KEY", "HUB_MAIL_HOME"]) delete process.env[v];
process.env.GODSPEED_MAIL_HOME = home;
process.chdir(elsewhere);

const G = require("./mc-mail-gmail.js");
const I = require("./mc-mail-imap.js");
const M = require("./mc-mail.js");
const P = require("./mc-mail-pair.js");

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); pass++; console.log("  ok    " + name); }
  catch (e) { fail++; console.log("  FAIL  " + name + "\n        " + e.message); }
}
const put = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); };

try {
  // ---- a machine set up before the rename: only ~/.hub/ -----------------------------------
  put(path.join(home, ".hub", "device.env"), "HUB_DIR=" + hub + "\n");
  t("the hub is found from HUB_DIR in ~/.hub/device.env", () => assert.strictEqual(G.findHub(), hub));

  put(path.join(hub, "secrets", "hub-secrets.env.age"), "x");
  put(path.join(home, ".hub", "age-key.txt"), "x");
  t("the locked store is hub-secrets.env.age when only it exists", () =>
    assert.strictEqual(G.storePaths().store, path.join(hub, "secrets", "hub-secrets.env.age")));
  t("the key is ~/.hub/age-key.txt when only it exists", () =>
    assert.strictEqual(G.storePaths().key, path.join(home, ".hub", "age-key.txt")));

  fs.mkdirSync(path.join(home, ".hub", "mail", "imap"), { recursive: true });
  t("the Gmail state folder is ~/.hub/mail when only it exists", () =>
    assert.strictEqual(G.stateDir(), path.join(home, ".hub", "mail")));
  t("the Himalaya folder is ~/.hub/mail/imap when only it exists", () =>
    assert.strictEqual(I.base(), path.join(home, ".hub", "mail", "imap")));

  put(path.join(home, ".hub", "mail", "route.json"), JSON.stringify({ kind: "ssh", host: "old-server" }));
  t("a desktop paired before the rename still has its route to the server", () => {
    const r = P.route();
    assert.ok(r && r.host === "old-server", "route: " + JSON.stringify(r));
  });

  process.env.HUB_MAIL_AGENTMAIL_INBOX = "old@agentmail.to";
  t("the inbox is read from HUB_MAIL_AGENTMAIL_INBOX", () =>
    assert.strictEqual(M.agentmailConfig().inbox, "old@agentmail.to"));
  delete process.env.HUB_MAIL_AGENTMAIL_INBOX;

  put(path.join(hub, ".mcp.json"), JSON.stringify({ mcpServers: { "hub-mail": { env: { HUB_MAIL_AGENTMAIL_INBOX: "cfg@agentmail.to" } } } }));
  process.chdir(hub);
  t("and from an older .mcp.json entry named hub-mail", () =>
    assert.strictEqual(M.agentmailConfig().inbox, "cfg@agentmail.to"));
  process.chdir(elsewhere);

  // ---- once the new names exist, they win ---------------------------------------------------
  put(path.join(home, ".godspeed", "device.env"), "GODSPEED_DIR=" + hub + "\n");
  put(path.join(hub, "secrets", "mc-secrets.env.age"), "x");
  put(path.join(home, ".godspeed", "age-key.txt"), "x");
  fs.mkdirSync(path.join(home, ".godspeed", "mail", "imap"), { recursive: true });
  t("with both stores present, mc-secrets.env.age wins", () =>
    assert.strictEqual(G.storePaths().store, path.join(hub, "secrets", "mc-secrets.env.age")));
  t("with both keys present, ~/.godspeed/age-key.txt wins", () =>
    assert.strictEqual(G.storePaths().key, path.join(home, ".godspeed", "age-key.txt")));
  t("with both mail folders present, ~/.godspeed/mail wins", () =>
    assert.strictEqual(G.stateDir(), path.join(home, ".godspeed", "mail")));
  t("and ~/.godspeed/mail/imap for Himalaya", () =>
    assert.strictEqual(I.base(), path.join(home, ".godspeed", "mail", "imap")));

  // ---- one decision for the whole mail folder (found by the final review, 2026-09-23) --------
  // Each part used to choose between ~/.hub/mail and ~/.godspeed/mail on its own, by whether its
  // own subfolder existed. With an EMPTY ~/.godspeed/mail beside a real ~/.hub/mail (Michael's
  // work PC had exactly that), a pending Gmail proposal vanished from view the moment another
  // part created its first folder under the new name.
  const home2 = path.join(work, "home2");
  fs.mkdirSync(path.join(home2, ".godspeed", "mail"), { recursive: true });
  put(path.join(home2, ".hub", "mail", "proposals.json"), "[]");
  process.env.GODSPEED_MAIL_HOME = home2;
  t("an empty ~/.godspeed/mail does not hide a real ~/.hub/mail", () =>
    assert.strictEqual(G.stateDir(), path.join(home2, ".hub", "mail")));
  t("Himalaya follows the same folder, before it has one of its own", () =>
    assert.strictEqual(I.base(), path.join(home2, ".hub", "mail", "imap")));
  fs.mkdirSync(I.base(), { recursive: true });
  t("and after it made its folder, the Gmail part still reads the same place", () =>
    assert.strictEqual(G.stateDir(), path.join(home2, ".hub", "mail")));
  put(path.join(home2, ".hub", "mail", "route.json"), JSON.stringify({ kind: "ssh", host: "same-tree" }));
  t("and the pairing route is read from that same place", () =>
    assert.strictEqual((P.route() || {}).host, "same-tree"));
  process.env.GODSPEED_MAIL_HOME = home;

  // ---- a new machine with nothing yet gets only the new names -------------------------------
  fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(home);
  t("a new machine's Gmail state goes to ~/.godspeed/mail", () =>
    assert.strictEqual(G.stateDir(), path.join(home, ".godspeed", "mail")));
  t("and nothing is made under ~/.hub", () => assert.ok(!fs.existsSync(path.join(home, ".hub"))));
} finally {
  process.chdir(os.tmpdir());
  fs.rmSync(work, { recursive: true, force: true });
}
console.log("\n  " + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
