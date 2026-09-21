/*
 * hub-mail-guide.js - the guided Gmail step: the hub installer runs it, and the reader never
 * types a command.
 *
 * WHY THIS FILE IS HERE (Michael, 2026-09-21). Every reader, and Michael himself, connects Gmail
 * the same way: each person registers their own small Google app once, in their own Google
 * account, and nobody else is involved. The first version handed the reader a walkthrough file
 * and a terminal command. This one does the walking: it opens each Google page, says in one plain
 * sentence what to click there, and moves on only when the reader says the step is done. At the
 * end the reader pastes the two lines Google shows, hidden, here and never into a chat; Google's
 * Allow window opens; and the mailbox Google names is shown before anything is kept.
 *
 * ONE COPY OF THE WORDS. The bash installer and the Windows installer both start this program,
 * so the sentences exist once. The Menerio step had its words in both installers and they
 * drifted apart within a fortnight. STEPS below is also what mail/gmail-setup.md prints, and the
 * test compares the two.
 *
 * WHERE THE SENTENCES COME FROM. Google renames its pages often, so every sentence in STEPS was
 * written from the real screen during a real run, with the date in SEEN. A sentence nobody has
 * seen live is marked `seen: ""` and the test lists it.
 *
 * It keeps nothing itself: connecting, the locked store and the mailbox question are connect()
 * in hub-mail-gmail.js, the same code `hub-mail connect gmail` has always used.
 */
"use strict";

const CONSOLE = process.env.HUB_MAIL_GOOGLE_CONSOLE || "https://console.cloud.google.com";
const APP_NAME = "My hub";

// kind: "workspace" (an address on your own domain, run through Google Workspace) or "personal"
// (an address ending in @gmail.com). Workspace apps are Internal; personal ones are External and
// must be published, because in "Testing" Google cancels the permission after seven days.
const kindOf = email => /@(gmail|googlemail)\.com$/i.test(String(email).trim()) ? "personal" : "workspace";

// Every step: which page to open (or none: the reader is still on the same page), what to do
// there in one sentence, and for whom. `seen` is the date the sentence was checked against the
// real Google page.
const STEPS = [
  { id: "project", page: "/projectcreate", for: "all", seen: "",
    say: `Google calls the home of your app a project. In the box "Project name", type ${APP_NAME}, then click Create.` },
  { id: "select", page: "", for: "all", seen: "",
    say: `A small notice appears at the top right of the page. In it, click Select project.` },
  { id: "api", page: "/apis/library/gmail.googleapis.com", for: "all", seen: "",
    say: `This page is the Gmail API, the door your hub will use. Check that the bar at the top says ${APP_NAME}, then click Enable.` },
  { id: "start", page: "/auth/overview", for: "all", seen: "",
    say: `This is where your app gets its name. Click Get started.` },
  { id: "name", page: "", for: "all", seen: "",
    say: `In "App name", type ${APP_NAME}. In "User support email", pick your own address. Click Next.` },
  { id: "internal", page: "", for: "workspace", seen: "",
    say: `Choose Internal, which means only your own organisation can use this app. Click Next.` },
  { id: "external", page: "", for: "personal", seen: "",
    say: `Choose External, the only choice Google offers a personal address. Click Next.` },
  { id: "contact", page: "", for: "all", seen: "",
    say: `Type your own email address, so Google can write to you about this app. Click Next.` },
  { id: "agree", page: "", for: "all", seen: "",
    say: `Tick the box to agree to Google's user data policy, click Continue, then click Create.` },
  { id: "publish", page: "/auth/audience", for: "personal", seen: "",
    say: `Click Publish app, then Confirm. An app left in "Testing" is cancelled by Google after seven days.` },
  { id: "client", page: "/auth/clients/create", for: "all", seen: "",
    say: `Under "Application type", choose Desktop app. As the name, type ${APP_NAME}. Click Create.` },
];
const stepsFor = kind => STEPS.filter(s => s.for === "all" || s.for === kind);

const WHY = [
  "Google only lets registered apps into a mailbox. So you register one small app.",
  "It belongs to you and nobody else: not to the author of the book, not to any company in between.",
  "It costs nothing, and it takes about ten minutes, once.",
];

const pageUrl = (page, email) => CONSOLE + page + (email ? (page.includes("?") ? "&" : "?") + "authuser=" + encodeURIComponent(email) : "");

/*
 * guide({ G, ask, say, open })
 *   G     hub-mail-gmail.js
 *   ask   (question, hidden) -> the reader's answer
 *   say   one line to the reader
 *   open  opens a web page
 * Resolves to { connected, address } and never throws for a reader's "stop".
 */
async function guide({ G, ask, say, open }) {
  open = open || G.openBrowser;
  const line = s => say(s === undefined ? "" : s);
  const answer = async (q, hidden) => String(await ask(q, !!hidden) || "").trim();
  const stopped = () => { line("Stopped. Nothing was changed. Start this step again whenever you like."); return { connected: false, address: "" }; };

  line("Connect your Gmail to your hub");
  line("==============================");
  const st = G.state();
  if (st.why && st.why !== "not connected") {
    line("This computer cannot open your hub's locked store (" + st.why + "), so there is nowhere safe to keep the connection.");
    line("Run the whole hub installer once, then start this step again.");
    return { connected: false, address: "" };
  }

  let readOnly = false;
  if (st.connected) {
    line(`Your hub is connected to ${st.address}${st.readOnly ? " (reading only)" : ""}. Every assistant of your hub uses that one connection.`);
    const a = (await answer("Press Enter to leave it as it is. Or type: again (connect again), or: remove (disconnect). ")).toLowerCase();
    if (a === "remove") {
      const r = await G.disconnect();
      line(`Hub: ${r.local}.`); line(`Google: ${r.google}.`); if (r.kept) line(r.kept + "."); if (r.shared) line("The change is " + r.shared + ".");
      return { connected: false, address: "" };
    }
    if (a !== "again") { line("Left as it is."); return { connected: true, address: st.address }; }
  } else {
    line("After this, every assistant of your hub can search your Gmail, read messages and their");
    line("attachments, and save draft replies in your Drafts folder. Your hub sends nothing: you read");
    line("the draft in Gmail and press Send yourself.");
    line();
    for (const w of WHY) line(w);
  }
  line();

  // An app that is already registered is not registered twice: a second run goes straight to
  // Google's Allow window, which is also how "reconnect needed" is put right.
  let clientId = "", clientSecret = "", email = "";
  let haveApp = st.hasApp;
  if (haveApp) {
    const a = (await answer("Your Google app is already registered. Press Enter to use it, or type: new (register another one). ")).toLowerCase();
    if (a === "stop") return stopped();
    if (a === "new") haveApp = false;
  }

  if (!haveApp) {
    email = await answer("Which Gmail address do you want to connect? Type it and press Enter: ");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { line("That is not an email address, so nothing was started."); return stopped(); }
    const kind = kindOf(email);
    line(kind === "personal"
      ? "That is a personal Gmail address, so your app will be the kind Google calls External."
      : "That address is on your own domain, through Google Workspace, so your app will be the kind Google calls Internal.");
    const mode = (await answer("Press Enter to start. (If your hub should only read and never save drafts, type: read) ")).toLowerCase();
    if (mode === "stop") return stopped();
    readOnly = mode === "read";
    line();
    line("I open one Google page at a time in your browser. Sign in with " + email + " if Google asks.");
    line("Do the one thing each step says, come back to this window, and press Enter.");

    const steps = stepsFor(kind);
    let page = "";
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      line();
      line(`Step ${i + 1} of ${steps.length + 2}`);
      if (s.page) { page = pageUrl(s.page, email); open(page); line("(I opened a page in your browser.)"); }
      line(s.say);
      for (;;) {
        const a = (await answer("Done? Press Enter. (again = open the page again, stop = stop here) ")).toLowerCase();
        if (a === "stop") return stopped();
        if (a === "again") { if (page) open(page); continue; }
        break;
      }
    }
    line();
    line(`Step ${steps.length + 1} of ${steps.length + 2}`);
    line("Google now shows a small window with two lines: a Client ID and a Client secret.");
    line("Copy each one and paste it here. You will not see what you paste. That is on purpose.");
    line("Paste them here and never into a chat with an assistant, because chats are saved.");
    for (;;) {
      clientId = await answer("Paste the Client ID and press Enter: ", true);
      if (clientId.toLowerCase() === "stop") return stopped();
      if (/\.apps\.googleusercontent\.com$/.test(clientId)) break;
      line("That was not the Client ID: it is the line that ends in .apps.googleusercontent.com. Copy it again.");
    }
    for (;;) {
      clientSecret = await answer("Paste the Client secret and press Enter: ", true);
      if (clientSecret.toLowerCase() === "stop") return stopped();
      if (clientSecret && clientSecret !== clientId && !/\s/.test(clientSecret)) break;
      line("That was not the Client secret: it is the shorter line under the Client ID. Copy it again.");
    }
    line("Got both. They go into your hub's locked store and nowhere else.");
  } else {
    const mode = (await answer("Press Enter to go on. (If your hub should only read and never save drafts, type: read) ")).toLowerCase();
    if (mode === "stop") return stopped();
    readOnly = mode === "read";
  }

  line();
  line(haveApp ? "Last step" : `Step ${stepsFor(kindOf(email)).length + 2} of ${stepsFor(kindOf(email)).length + 2}`);
  line("Google's own window opens now and asks whether your app may open your mailbox.");
  if (!haveApp && kindOf(email) === "personal") {
    line("Google will warn that it has not verified this app. That is true: nobody checked it, because");
    line("it is yours and only you use it. Click Advanced, then the line that names " + APP_NAME + ".");
  }
  line("Tick every box Google shows, then click " + (readOnly ? "Continue" : "Allow") + "." + (readOnly ? "" : " Google's words mention sending, because Google bundles it with drafts. Your hub does not send."));

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await G.connect({ readOnly, ask, say: s => line(String(s).replace(/^Opening Google in your browser\./, "I opened Google's window in your browser.")),
        open, clientId: clientId || undefined, clientSecret: clientSecret || undefined, fresh: !haveApp, loginHint: email || undefined, back: "the installer's window" });
      line();
      line(`Connected: ${r.address}. ${r.readOnly ? "Your hub can read it." : "Your hub can read it and save drafts in it. It sends nothing."}`);
      line("The connection is kept in your hub's locked store, so every assistant of your hub uses it.");
      if (r.shared) line("It is " + r.shared + ".");
      line("Close your assistant and open it again. Then ask it, in your own words:");
      line("   Find the newest email in my Gmail and tell me who it is from.");
      return { connected: true, address: r.address };
    } catch (e) {
      line();
      line("Not connected: " + e.message);
      if (e.step === "api") {
        open(pageUrl("/apis/library/gmail.googleapis.com", email));
        line("I opened the Gmail API page again. Check that the bar at the top says " + APP_NAME + ", click Enable, and wait until the page changes.");
        if ((await answer("Done? Press Enter to try again. (stop = stop here) ")).toLowerCase() === "stop") return stopped();
        continue;
      }
      if (e.google === "invalid_client" && !haveApp) {
        line("Google did not recognise the two lines, so one of them was not copied whole.");
        return stopped();
      }
      return { connected: false, address: "" };
    }
  }
  return { connected: false, address: "" };
}

module.exports = { guide, STEPS, stepsFor, kindOf, pageUrl, WHY, APP_NAME };
