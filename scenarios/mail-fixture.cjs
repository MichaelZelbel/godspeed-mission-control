// The mailbox of the mail-count scenario: the mail tool's own IMAP stand-in
// (tools/test-mc-mail-imap-fixture.js), loopback only, filled with invented mails, and connected to
// the installed mail tool the way the person connects Gmail (mc-mail-imap.js connectHere), so the
// notebook's routine reads it through the tool's own route.
//
//   node mail-fixture.cjs <tools folder> <mission control folder> <out folder>
//
// It prints "ready" when the mailbox is connected and keeps running; every second it writes the
// commands the stand-in has answered into <out>/commands.json, which is how the scenario can say
// what was asked of the mailbox and what was not. Nothing here is a real address or a real mail:
// every one is example.invalid, and every body carries the marker from <out>/marker.txt.
"use strict";
const fs = require("fs");
const path = require("path");

const SHOP = "shop@orders.example.invalid";
const daysAgo = n => new Date(Date.now() - n * 86400000).toUTCString();
const mail = (marker, n, from, subject, ago) => ({ uid: 100 + n, flags: [], raw: [
  `From: ${from}`, "To: reader@example.invalid", `Subject: ${subject}`, `Date: ${daysAgo(ago)}`,
  `Message-ID: <scenario-${n}@example.invalid>`, "MIME-Version: 1.0", "Content-Type: text/plain; charset=utf-8", "",
  `${subject}. ${marker}`, ""].join("\r\n") });

// order, application-reply and unrelated mails, as the issue asks
const mails = marker => [
  mail(marker, 1, `Shop <${SHOP}>`, "New order #1001 from Alex", 12),
  mail(marker, 2, `Shop <${SHOP}>`, "New order #1002 from Sam", 6),
  mail(marker, 3, `Shop <${SHOP}>`, "NEW ORDER #1003 from Kim", 1),
  mail(marker, 4, `Shop <${SHOP}>`, "Your payout is on its way", 5),
  mail(marker, 5, `Shop <${SHOP}>`, "A buyer left a review", 2),
  mail(marker, 6, "HR <hr@studio-a.example.invalid>", "Re: Your application for Designer", 9),
  mail(marker, 7, "Jobs <jobs@firm-b.example.invalid>", "Re: Your application as Editor", 3),
  mail(marker, 8, "Nadia <nadia@example.invalid>", "Lunch on Friday?", 4),
  mail(marker, 9, "Club <news@club.example.invalid>", "Our new newsletter", 7),
];

// the stand-in's INBOX and its all-mail folder both hold the mails
const fill = (F, f, list) => {
  for (const name of Object.keys(f.boxes)) {
    if (name === "INBOX" || name === F.ALL) { f.boxes[name].messages = list.map(m => Object.assign({}, m)); f.boxes[name].uidnext = 200; }
  }
};

module.exports = { mails, fill };

if (require.main === module) (async () => {
  const [tools, root, out] = process.argv.slice(2);
  if (!tools || !root || !out) { console.error("usage: mail-fixture.cjs <tools folder> <mission control folder> <out folder>"); process.exit(2); }
  const MAILS = mails(fs.readFileSync(path.join(out, "marker.txt"), "utf8").trim());
  const F = require(path.join(tools, "test-mc-mail-imap-fixture.js"));
  const f = await F.start();
  fill(F, f, MAILS);
  process.env.GODSPEED_MAIL_IMAP_TEST_SERVER = "imap://127.0.0.1:" + f.port;
  process.env.GODSPEED_DIR = root;
  process.env.GODSPEED_ROOT = root;
  const I = require(path.join(tools, "mc-mail-imap.js"));
  await I.install();
  const answers = [F.USER, F.PASSWORD.replace(/(.{4})/g, "$1 ").trim()];
  const r = await I.connectHere({ ask: async () => (answers.length ? answers.shift() : "stop"), say: s => process.stderr.write(String(s) + "\n"), open: () => {} });
  if (!r.connected) { console.error("the mail tool did not connect to its stand-in"); process.exit(1); }
  const snapshot = () => fs.writeFileSync(path.join(out, "commands.json"), JSON.stringify(f.commands));
  snapshot();
  setInterval(snapshot, 1000);
  process.stdout.write("ready\n");
})().catch(e => { console.error(String((e && e.stack) || e)); process.exit(1); });
