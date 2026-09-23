/*
 * mc-mail-guide.js - the Gmail step of the mission control installer: the reader signs in to Google, and
 * the mission control does the rest.
 *
 * WHY THIS FILE IS HERE (Michael, 2026-09-21). Every reader, and Michael himself, connects Gmail
 * the same way: each person registers their own small Google app once, in their own Google
 * account, and nobody else is involved: no shared app, no connection company in between.
 *
 * VERSION ONE OF THIS FILE WAS WRONG, AND HIS OWN RUN SAID SO THE SAME EVENING. It opened
 * Google's developer pages one by one and told the reader what to click: eleven steps. His
 * words: "I don't want 11 steps, never ever; I'm not going to do 11 steps, so I would stop the
 * installation right there", and then the product in one sentence: "the reader is signing you
 * in, and you do it in Google."
 *
 * SO THE READER DOES THREE THINGS, and the mission control does everything between them:
 *   1. signs in to Google, in a browser window the mission control opens;
 *   2. ticks the one box that agrees to Google's user data policy (an agreement is the reader's
 *      to give, so the mission control never ticks it);
 *   3. clicks Allow, when Google asks whether this app may open the mailbox.
 * Nothing is copied or pasted: the mission control reads the app's two lines off Google's page itself.
 *
 * WHO DOES WHAT. mc-mail-browser.js opens the window and talks to it. mc-mail-google.js does
 * the clicking in Google's pages, and hands a single click back to the reader, in one sentence,
 * whenever Google has changed a page. connect() in mc-mail-gmail.js, the same code as ever,
 * checks what Google granted, shows the mailbox before anything is kept, and locks the
 * connection into the mission control's store. This file is the words and the order.
 *
 * ONE COPY OF THE WORDS: the bash installer and the Windows installer both start this program.
 */
"use strict";

const APP_NAME = "My mission control";

// kind: "workspace" (an address on your own domain, run through Google Workspace) or "personal"
// (an address ending in @gmail.com). Workspace apps are Internal; personal ones are External and
// must be published, because in "Testing" Google cancels the permission after seven days.
const kindOf = email => /@(gmail|googlemail)\.com$/i.test(String(email).trim()) ? "personal" : "workspace";

const WHAT = [
  "After this, every assistant of your mission control can search your Gmail, read messages and their",
  "attachments, and save draft replies in your Drafts folder. Your mission control sends nothing: you read",
  "the draft in Gmail and press Send yourself.",
];
const WHY = [
  "Google only lets registered apps into a mailbox, so your mission control gets a small app of its own.",
  "It belongs to you and nobody else: not to the author of the book, not to any company in between.",
  "It costs nothing.",
];
const YOUR_PART = [
  "Your part is small. You sign in to Google. I set the app up while you watch.",
  "You tick one box, and at the end you click Allow. About five minutes.",
];

/*
 * guide({ G, ask, say, browser, google })
 *   G        mc-mail-gmail.js
 *   ask      (question, hidden) -> the reader's answer
 *   say      one line to the reader
 *   browser  mc-mail-browser.js (a test hands in its own)
 *   google   mc-mail-google.js  (a test hands in its own)
 * Resolves to { connected, address } and never throws for a reader's "stop".
 */
async function guide({ G, ask, say, browser, google }) {
  browser = browser || require("./mc-mail-browser.js");
  google = google || require("./mc-mail-google.js");
  const line = s => say(google.scrub ? google.scrub(s === undefined ? "" : s) : (s === undefined ? "" : s));
  const answer = async (q, hidden) => String(await ask(q, !!hidden) || "").trim();
  const stopped = () => { line("Stopped. Nothing was changed. Start this step again whenever you like."); return { connected: false, address: "" }; };
  const no = { connected: false, address: "" };

  line("Connect your Gmail to your mission control");
  line("==============================");
  const st = G.state();
  if (st.why && st.why !== "not connected") {
    line("This computer cannot open your mission control's locked store (" + st.why + "), so there is nowhere safe to keep the connection.");
    line("Run the whole godspeed installer once, then start this step again.");
    return no;
  }

  if (st.connected) {
    line(`Your mission control is connected to ${st.address}${st.readOnly ? " (reading only)" : ""}. Every assistant of your mission control uses that one connection.`);
    const a = (await answer("Press Enter to leave it as it is. Or type: again (connect again), or: remove (disconnect). ")).toLowerCase();
    if (a === "remove") {
      const r = await G.disconnect();
      line(`Godspeed: ${r.local}.`); line(`Google: ${r.google}.`); if (r.kept) line(r.kept + "."); if (r.shared) line("The change is " + r.shared + ".");
      return no;
    }
    if (a !== "again") { line("Left as it is."); return { connected: true, address: st.address }; }
  } else {
    for (const s of WHAT) line(s);
    line();
    for (const s of WHY) line(s);
    line();
    for (const s of YOUR_PART) line(s);
  }
  line();

  const email = await answer("Which Gmail address do you want to connect? Type it and press Enter: ");
  if (email.toLowerCase() === "stop") return stopped();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { line("That is not an email address, so nothing was started."); return stopped(); }
  const kind = kindOf(email);
  const mode = (await answer("Press Enter and I open a browser window. (If your mission control should only read and never save drafts, type: read) ")).toLowerCase();
  if (mode === "stop") return stopped();
  const readOnly = mode === "read";

  // ---------------------------------------------------------------- the window, and the sign-in
  let win;
  try {
    win = await browser.attach();
    if (!win) win = await browser.open({ url: "https://console.cloud.google.com/welcome?hl=en" });
  } catch (e) {
    line();
    if (e.noBrowser) {
      line("I need a browser I can work in, and found none on this computer: Microsoft Edge, Google Chrome, Brave or Chromium.");
      line("Install one of them (Chrome is free at google.com/chrome), then start this step again. Nothing was changed.");
    } else line("I could not open a browser window: " + e.message + " Nothing was changed.");
    return no;
  }
  let result = no;
  try {
    let page = await win.page();
    line();
    line(`Look at the ${win.name} window I just opened. It is a fresh window of its own, with nothing of yours in it.`);
    line(`Sign in to Google there with ${email}. Your password goes to Google, on Google's own page. I cannot see it.`);
    line("Answer whatever Google asks while you sign in. When you are in, I notice it myself and carry on.");
    const signedIn = async () => { try { page = await win.page(); const u = await page.url(); return /^https:\/\/console\.cloud\.google\.com\//.test(u); } catch (e) { if (win.gone) throw e; return false; } };
    const end = Date.now() + 20 * 60000;
    while (!await signedIn()) {
      if (Date.now() > end) { line(); line("Nobody signed in within twenty minutes, so I stopped. Nothing was changed. Start this step again when you are ready."); await win.close({ forget: true }); return no; }
      await browser.sleep(2500);
    }
    const who = await page.waitFor(() => { const m = document.body.innerText.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/); const b = [...document.querySelectorAll("[aria-label]")].map(x => x.getAttribute("aria-label")).find(x => /^Account:|Google Account:/.test(x || "")); return (b && (b.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/) || [])[0]) || (m && m[0]) || ""; }, { timeout: 15000 });
    line();
    line(`You are signed in${who ? " as " + who : ""}. Now it is my turn. Please leave the window alone until I ask you for something.`);
    if (who && who.toLowerCase() !== email.toLowerCase()) line(`(You said ${email} and signed in as ${who}. I go on with ${who}, and at the end I show you the mailbox before anything is kept.)`);
    line("You can watch. Google's pages will open and fill themselves in:");

    const app = await google.registerApp({ page, email: who || email, kind, say: line, ask, log: () => {} });

    // ---------------------------------------------------------------- Google asks the reader
    line();
    line("Last thing, and it is yours: Google now asks, in the same window, whether your app may open your mailbox.");
    if (kind === "personal") {
      line("Google first warns that it has not verified this app. That is true: nobody checked it, because it is");
      line("yours and only you use it. Click Advanced, then the line that names " + APP_NAME + ".");
    }
    line("Tick every box Google shows, then click " + (readOnly ? "Continue" : "Allow") + "." + (readOnly ? "" : " Google's words mention sending, because Google bundles it with drafts. Your mission control does not send."));
    const r = await G.connect({ readOnly, ask, say: () => {}, open: url => page.goto(url), clientId: app.clientId, clientSecret: app.clientSecret,
      fresh: true, loginHint: who || email, back: "the installer's window" });
    google.forgetNote();
    line();
    line(`Connected: ${r.address}. ${r.readOnly ? "Your mission control can read it." : "Your mission control can read it and save drafts in it. It sends nothing."}`);
    line("The connection is kept in your mission control's locked store, so every assistant of your mission control uses it.");
    if (r.shared) line("It is " + r.shared + ".");
    line("I close the browser window now and delete everything it remembered, so no signed-in window is left behind.");
    line("Close your assistant and open it again. Then ask it, in your own words:");
    line("   Find the newest email in my Gmail and tell me who it is from.");
    result = { connected: true, address: r.address };
  } catch (e) {
    line();
    line("Not connected: " + (win.gone ? "the browser window was closed before I was finished. Nothing was kept." : e.message));
    if (!win.gone) line("I leave the browser window open, so you can see where it stopped. Start this step again and it goes on from there.");
    return no;
  }
  try { await win.close({ forget: true }); } catch (e) { /* closed by hand already */ }
  return result;
}

module.exports = { guide, kindOf, WHAT, WHY, YOUR_PART, APP_NAME };
