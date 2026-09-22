/*
 * hub-mail-google.js - the hub registers the reader's own small Google app, in the reader's
 * browser window, while the reader watches.
 *
 * WHY THIS FILE IS HERE (Michael, 2026-09-21): "the reader is signing you in, and you do it in
 * Google." The reader does three things: signs in, ticks the box that agrees to Google's terms
 * (an agreement is the reader's to give, never the hub's), and clicks Allow at the end. The hub
 * does everything between: the project, the Gmail API, the app's name and audience, the desktop
 * client, and it reads the Client ID and secret off the page itself, so nothing is copied or
 * pasted by anybody.
 *
 * GOOGLE CHANGES ITS PAGES. Every move below is written as "find it, do it, check that it
 * happened". When a move cannot find what it is looking for, the hub does not stop and does not
 * guess: it tells the reader in one sentence what to click in the window, and goes on as soon as
 * the page shows that it happened. So a renamed button costs a reader one click, not the evening.
 * Every page is opened with hl=en, so the words the hub looks for are English whatever language
 * the reader's Google account speaks.
 *
 * It keeps a small note of how far it got (~/.hub/mail/google-setup.json: the project's id and
 * the last finished move, never a secret), so a run that was interrupted goes on where it was
 * instead of making a second project.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { sleep } = require("./hub-mail-browser.js");

const CONSOLE = process.env.HUB_MAIL_GOOGLE_CONSOLE || "https://console.cloud.google.com";
const APP_NAME = "My hub";

// ============================================================ how far it got
const noteFile = () => path.join(process.env.HUB_MAIL_HOME || os.homedir(), ".hub", "mail", "google-setup.json");
const readNote = () => { try { return JSON.parse(fs.readFileSync(noteFile(), "utf8")); } catch (e) { return {}; } };
function writeNote(n) { fs.mkdirSync(path.dirname(noteFile()), { recursive: true, mode: 0o700 }); fs.writeFileSync(noteFile(), JSON.stringify(n, null, 1), { mode: 0o600 }); }
function forgetNote() { try { fs.unlinkSync(noteFile()); } catch (e) { /* none */ } }

// ============================================================ looking at a page
// These run INSIDE the page. They look the way a person looks: at what is visible, by its words.
// `want` is a regular expression source, matched against the element's own words, its
// aria-label and its title. The smallest visible match wins, so "Create" finds the button and
// not the whole form around it.
function inPageFind(sel, want, opts) {
  const re = new RegExp(want, "i");
  const seen = el => { const r = el.getBoundingClientRect(); const st = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && st.visibility !== "hidden" && st.display !== "none" && r.bottom > 0 && r.right > 0; };
  const roots = [document];
  for (let i = 0; i < roots.length; i++) for (const el of roots[i].querySelectorAll("*")) if (el.shadowRoot) roots.push(el.shadowRoot);
  let best = null;
  for (const root of roots) for (const el of root.querySelectorAll(sel)) {
    if (!seen(el)) continue;
    const words = [(el.innerText || el.textContent || "").trim(), el.getAttribute("aria-label") || "", el.getAttribute("title") || "", el.getAttribute("placeholder") || ""];
    if (!words.some(w => w && re.test(w) && w.length < 200)) continue;
    const r = el.getBoundingClientRect(), area = r.width * r.height;
    if (!best || area < best.area) best = { el, area, r };
  }
  if (!best) return null;
  if (opts && opts.scroll) { best.el.scrollIntoView({ block: "center" }); best.r = best.el.getBoundingClientRect(); }
  const dis = best.el.disabled === true || best.el.getAttribute("aria-disabled") === "true";
  return { x: best.r.x, y: best.r.y, w: best.r.width, h: best.r.height, disabled: dis,
    checked: best.el.checked === true || best.el.getAttribute("aria-checked") === "true",
    text: (best.el.innerText || best.el.getAttribute("aria-label") || "").trim().slice(0, 80) };
}
const BUTTON = "button, [role=button], a[href], input[type=submit]";
const OPTION = "[role=option], mat-option, [role=menuitem], [role=radio], mat-radio-button, label";

// NOTHING SHAPED LIKE A GOOGLE SECRET IS EVER PRINTED OR LOGGED, wherever on the page it came
// from. Learned the hard way on 2026-09-21: a development script hid the secret in a window's
// text and forgot the window's button labels, one of which reads "Copy to clipboard: GOCSPX-...".
// So there is one filter, and every line this file says or logs goes through it.
const scrub = s => String(s).replace(/GOCSPX-[A-Za-z0-9_-]+/g, "GOCSPX-(hidden)").replace(/\b1\/\/[A-Za-z0-9_-]{20,}/g, "(hidden)");

class Worker {
  constructor({ page, say, ask, log }) {
    this.page = page; this.ask = ask;
    this.say = s => say(scrub(s === undefined ? "" : s));
    this.log = log ? (s => log(scrub(s))) : (() => {});
  }

  find(sel, want, opts) { return this.page.eval(inPageFind, sel, want, opts || null); }
  async waitFind(sel, want, timeout = 20000) {
    const end = Date.now() + timeout;
    for (;;) { const b = await this.find(sel, want, { scroll: true }).catch(() => null); if (b && !b.disabled) return b; if (Date.now() > end) return b || null; await sleep(500); }
  }
  async click(sel, want, timeout) {
    let b = await this.waitFind(sel, want, timeout);
    if (!b || b.disabled) return false;
    await sleep(250);
    b = (await this.find(sel, want)) || b;                       // it may have moved while scrolling
    await this.page.clickAt(b);
    this.log("clicked: " + b.text);
    return true;
  }
  // Put text into the box that carries these words as its label, replacing what is there.
  async fill(want, text, timeout) {
    const b = await this.waitFind("input:not([type=hidden]):not([type=checkbox]):not([type=radio]), textarea", want, timeout)
      || await this.labelled(want);
    if (!b) return false;
    await this.page.clickAt(b);
    await this.page.key("a", "KeyA", 65, 2);                      // select what is there (Ctrl+A), then type over it
    await this.page.type(text);
    this.log("filled \"" + want + "\"");
    return true;
  }
  // A box found through a <label> or mat-label that names it.
  labelled(want) {
    return this.page.eval(w => {
      const re = new RegExp(w, "i");
      for (const lab of document.querySelectorAll("label, mat-label")) {
        if (!re.test(lab.textContent || "")) continue;
        const field = lab.closest("mat-form-field, .mat-mdc-form-field, cfc-form-field, div");
        const input = (lab.htmlFor && document.getElementById(lab.htmlFor)) || (field && field.querySelector("input, textarea, [role=combobox]"));
        if (!input) continue;
        input.scrollIntoView({ block: "center" });
        const r = input.getBoundingClientRect();
        if (r.width > 1) return { x: r.x, y: r.y, w: r.width, h: r.height, text: w };
      }
      return null;
    }, want);
  }
  text() { return this.page.eval(() => document.body.innerText); }
  async waitText(want, timeout = 30000) {
    const re = new RegExp(want, "i"), end = Date.now() + timeout;
    for (;;) { const t = await this.text().catch(() => ""); if (re.test(t)) return true; if (Date.now() > end) return false; await sleep(700); }
  }
  async go(pathAndQuery) {
    const url = CONSOLE + pathAndQuery + (pathAndQuery.includes("?") ? "&" : "?") + "hl=en";
    await this.page.goto(url);
    await this.page.waitFor(() => document.readyState === "complete", { timeout: 30000 });
    await sleep(1500);
  }

  /*
   * One move: try it; when the hub cannot do it, the reader does that one thing in the window.
   *   doIt()   -> true when the hub did it
   *   done()   -> true when the page shows that it happened (whoever did it)
   *   sentence -> what to tell the reader when the hub could not
   */
  async move(name, { doIt, done, sentence, timeout = 120000 }) {
    this.log("move: " + name);
    let did = false;
    try { did = await doIt(); } catch (e) { this.log(name + " threw: " + e.message); }
    if (did && (!done || await this.until(done, 40000))) return true;
    if (done && await this.until(done, 1500)) return true;
    this.say("");
    this.say("Google's page looks different from what I expected here, so I need one click from you.");
    this.say("In the browser window: " + sentence);
    this.say("I go on by myself as soon as that is done.");
    if (done) { if (await this.until(done, timeout)) return true; }
    else { await this.ask("Done? Press Enter. ", false); return true; }
    throw new Error("I waited two minutes at \"" + name + "\" and the page did not change. Nothing was connected. Start this step again and it goes on from here.");
  }
  async until(fn, timeout) { const end = Date.now() + timeout; for (;;) { try { if (await fn()) return true; } catch (e) { /* page in between two states */ } if (Date.now() > end) return false; await sleep(800); } }
}

// ============================================================ the moves
// Written from Google's real pages, read in the hub's own window on 2026-09-21 (account
// michael@zelbel.de, a Workspace address). The words in the patterns are the words on those pages.

const inDialog = "[role=dialog] button, mat-dialog-container button";
const dialogText = page => page.eval(() => [...document.querySelectorAll("[role=dialog], mat-dialog-container")]
  .map(d => (d.innerText || "") + "\n" + [...d.querySelectorAll("[aria-label]")].map(x => x.getAttribute("aria-label")).join("\n")).join("\n"));

// Google shows a new Cloud user its terms before anything else. Agreeing is the reader's.
async function termsIfAsked(w) {
  const asked = () => w.page.eval(() => [...document.querySelectorAll("[role=dialog], mat-dialog-container")].some(d => /Terms of Service/i.test(d.innerText || "")));
  if (!await asked().catch(() => false)) return;
  w.say("");
  w.say("Google shows you its terms for Google Cloud, because this is your first time there.");
  w.say("Agreeing is yours to do, not mine. In the browser window: read them, tick the box, and click Agree and continue.");
  w.say("I go on by myself as soon as you have.");
  if (!await w.until(async () => !(await asked()), 15 * 60000)) throw new Error("Google's terms were still open after fifteen minutes. Nothing was connected. Start this step again when you are ready.");
}

// The project: the home Google wants every app to have. Its id is read off the page BEFORE
// Create is pressed, so every later page can be opened for exactly this project.
async function makeProject(w, note) {
  if (note.projectId) { w.log("the project exists already: " + note.projectId); return note.projectId; }
  await w.go("/projectcreate");
  await termsIfAsked(w);
  let projectId = "";
  await w.move("make the project", {
    doIt: async () => {
      const box = await w.page.waitFor(() => { const i = document.querySelector("#p6ntest-name-input, input[formcontrolname=name]"); if (!i) return null; i.scrollIntoView({ block: "center" }); const r = i.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, { timeout: 25000 });
      if (!box) return false;
      await w.page.clickAt(box); await w.page.key("a", "KeyA", 65, 2); await w.page.type(APP_NAME);
      await sleep(2000);                                            // Google works out the id from the name
      projectId = await w.page.eval(() => ((document.body.innerText.match(/Project ID:\s*([a-z][a-z0-9-]{4,29})/) || [])[1] || "").replace(/\.$/, ""));
      if (!projectId) return false;
      return w.click(BUTTON, "^Create$", 8000);
    },
    done: async () => !/\/projectcreate/.test(await w.page.url()),
    sentence: `type ${APP_NAME} into the box "Project name" and click Create.`,
  });
  if (!projectId) projectId = ((await w.page.url()).match(/[?&]project=([a-z][a-z0-9-]+)/) || [])[1] || "";
  if (!projectId) throw new Error("Google made the project, and I could not read its id off the page. Nothing was connected. Start this step again and it goes on from here.");
  note.projectId = projectId; writeNote(note);
  return projectId;
}

// The Gmail API, switched on for that project. A project Google has only just made is not
// there at once, so the page is opened again until it knows the project.
async function switchOnGmail(w, projectId) {
  const on = async () => /API Enabled|Disable API/i.test(await w.text()) || /\/apis\/api\/gmail\.googleapis\.com/.test(await w.page.url());
  for (let i = 0; i < 12; i++) {
    await w.go("/apis/library/gmail.googleapis.com?project=" + projectId);
    if (await on()) return;
    if (await w.find(BUTTON, "^Enable$")) break;
    await sleep(5000);
  }
  await w.move("switch on the Gmail API", {
    doIt: () => w.click(BUTTON, "^Enable$", 15000), done: on, timeout: 180000,
    sentence: "click the blue Enable button on the page named Gmail API.",
  });
}

// The app's name and who may use it: ONE Google page with four sections. The hub fills three.
// The fourth is a box that agrees to Google's user data policy, and the hub never ticks it.
async function nameTheApp(w, projectId, email, kind) {
  await w.go("/auth/overview/create?project=" + projectId);
  const hasForm = await w.page.waitFor(() => !!document.querySelector('input[formcontrolname="displayName"]') || /App name/.test(document.body.innerText), { timeout: 15000 });
  if (!hasForm) { w.log("no form, so the app has its name already"); return; }
  const left = async () => !/\/auth\/overview\/create/.test(await w.page.url());
  const sectionOpen = words => async () => new RegExp(words, "i").test(await w.text());

  await w.move("the app's name", {
    doIt: async () => {
      if (!await w.fill("App name", APP_NAME, 15000)) return false;
      const pick = await w.page.eval(() => { const el = document.querySelector('cfc-select[formcontrolname="userSupportEmail"]'); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
      if (!pick) return false;
      await w.page.clickAt(pick); await sleep(1200);
      const mine = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (!await w.click(OPTION, "^" + mine + "$", 6000) && !await w.click("[role=option], mat-option", ".", 3000)) return false;
      await sleep(500);
      return w.click(BUTTON, "^Next$", 8000);
    },
    done: sectionOpen("Only available to users within your organization|Available to any test user"),
    sentence: `under "App Information", type ${APP_NAME} as the app name, pick your own address as the support email, and click Next.`,
  });
  const want = kind === "personal" ? "External" : "Internal";
  await w.move("who may use it", {
    doIt: async () => { if (!await w.click("mat-radio-button, [role=radio], label", "^" + want, 8000)) return false; await sleep(500); return w.click(BUTTON, "^Next$", 8000); },
    done: sectionOpen("These email addresses are for Google to notify you"),
    sentence: `under "Audience", choose ${want} and click Next.`,
  });
  await w.move("where Google may write to you", {
    doIt: async () => { if (!await w.fill("Text field for emails|Email addresses", email, 8000)) return false; await w.page.key("Enter", "Enter", 13); await sleep(700); return w.click(BUTTON, "^Next$", 8000); },
    done: sectionOpen("I agree to the Google API Services"),
    sentence: `under "Contact Information", type your own email address and click Next.`,
  });

  const ticked = () => w.page.eval(() => { const c = [...document.querySelectorAll("mat-checkbox, [role=checkbox]")].find(x => /I agree/i.test(x.innerText || x.getAttribute("aria-label") || ""));
    if (!c) return false; const i = c.querySelector("input[type=checkbox]"); return (i && i.checked) || c.getAttribute("aria-checked") === "true"; });
  if (!await ticked()) {
    w.say("");
    w.say("One click is yours. Google asks you to agree to its user data policy, and agreeing is for you to do, never for me.");
    w.say("In the browser window: read it if you like, then tick the box \"I agree to the Google API Services: User Data Policy.\"");
    w.say("Click nothing else. I go on by myself as soon as the box is ticked.");
    if (!await w.until(ticked, 15 * 60000)) throw new Error("the box was still empty after fifteen minutes. Nothing was connected. Start this step again when you are ready; it goes on from here.");
    w.say("Thank you. I carry on.");
  }
  await w.move("save the app", {
    doIt: async () => { if (!await w.click(BUTTON, "^Continue$", 8000)) return false; await sleep(1200); return w.click(BUTTON, "^Create$", 8000); },
    done: left,
    sentence: "click Continue, then the blue Create button at the very bottom of the page. Google saves nothing until Create is pressed.",
  });
}

// A personal address gets an External app, and an External app left in "Testing" loses its
// permission after seven days. NOT YET SEEN ON A REAL PAGE (Michael's address is Workspace).
async function publishIfExternal(w, projectId, kind) {
  if (kind !== "personal") return;
  await w.go("/auth/audience?project=" + projectId);
  if (/In production/i.test(await w.text())) return;
  await w.move("publish the app", {
    doIt: async () => { if (!await w.click(BUTTON, "^Publish app$", 12000)) return false; await sleep(1500); return w.click(inDialog, "^Confirm$", 8000); },
    done: async () => /In production/i.test(await w.text()),
    sentence: "click Publish app, then Confirm. An app left in \"Testing\" is cancelled by Google after seven days.",
  });
}

// The app's key. Google shows the two lines once, in a small window; the hub reads them off the
// page itself and closes the window. Nobody copies or pastes, and neither line is printed.
async function makeTheKey(w, projectId) {
  await w.go("/auth/clients/create?project=" + projectId);
  const shown = async () => /OAuth client created/i.test(await dialogText(w.page));
  await w.move("make the app's key", {
    doIt: async () => {
      const pick = await w.page.waitFor(() => { const el = document.querySelector('cfc-select[formcontrolname="typeControl"]'); if (!el) return null; el.scrollIntoView({ block: "center" }); const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; }, { timeout: 20000 });
      if (!pick) return false;
      await w.page.clickAt(pick); await sleep(1200);
      if (!await w.click("[role=option], mat-option", "^Desktop app$", 8000)) return false;
      await sleep(1200);
      if (!await w.fill("^Name", APP_NAME, 8000)) return false;
      await sleep(400);
      return w.click(BUTTON, "^Create$", 8000);
    },
    done: shown,
    sentence: "under \"Application type\" choose Desktop app, then click Create. (If a yellow bar says the consent screen must be configured first, tell me: start this step again.)",
  });
  // The window's title comes up first and its two lines a moment later (found on the first
  // real run, which read too early). So wait for the lines themselves, not for the window.
  const ID = /[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com/, SECRET = /GOCSPX-[A-Za-z0-9_-]+/;
  let t = "";
  await w.until(async () => { t = await dialogText(w.page); return ID.test(t) && SECRET.test(t); }, 30000);
  const clientId = (t.match(ID) || [""])[0];
  const clientSecret = (t.match(SECRET) || [""])[0];
  if (!clientId || !clientSecret) throw new Error("Google made the key, and I could not read its two lines off the page. Nothing was connected. Start this step again: it makes a fresh key.");
  await w.click(inDialog, "^OK$", 5000);
  return { clientId, clientSecret };
}

/*
 * registerApp({ page, email, kind, say, ask, log }) -> { clientId, clientSecret, projectId }
 * The reader is signed in already. `progress` lines are what the reader reads while watching.
 */
async function registerApp({ page, email, kind, say, ask, log }) {
  const w = new Worker({ page, say, ask, log });
  const note = readNote();
  if (note.email && note.email !== email) { note.projectId = ""; }
  note.email = email; writeNote(note);
  await termsIfAsked(w);
  const projectId = await makeProject(w, note);
  w.say("  done: a home for your app (Google calls it a project)");
  await switchOnGmail(w, projectId);
  w.say("  done: the Gmail door is switched on for it (Google calls it the Gmail API)");
  await nameTheApp(w, projectId, email, kind);
  w.say(`  done: your app has its name, ${APP_NAME}, and only ${kind === "personal" ? "you" : "your own organisation"} may use it`);
  await publishIfExternal(w, projectId, kind);
  const key = await makeTheKey(w, projectId);
  w.say("  done: your app has its key, and I have read it off the page myself");
  return { ...key, projectId };
}

module.exports = { Worker, registerApp, scrub, inPageFind, BUTTON, OPTION, APP_NAME, CONSOLE, readNote, writeNote, forgetNote };
