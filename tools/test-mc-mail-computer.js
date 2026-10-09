/*
 * test-mc-mail-computer.js - mc-mail on a reader's own computer (8 October 2026).
 *
 * What the book's Chapters 31 and 32 promise, and what was not true before this date:
 *   1. The first `mc-mail connect agentmail` works without anybody installing age: mc-mail fetches
 *      the pinned age itself, checks it, and refuses any other (checks 1 to 5).
 *   2. A key stays on the computer it was typed on, on a mission control with the notebook: nothing
 *      is committed or pushed, and secrets/ is kept out of the folder's own Git (6 to 9). A
 *      mission control without the notebook shares as it always did (10).
 *   3. The assistant and a terminal use one mail folder: what the assistant kept in its old folder
 *      is moved once and never over something newer, and an old key still opens the store (11 to 14).
 *   4. `mc-mail setup` also wires the Hermes the notebook set up for itself (15 to 17).
 *
 * Everything happens in temporary folders: a home, a mission control, a bare repository standing in
 * for GitHub. The pinned age archive is downloaded once into the system's temp folder (or taken from
 * GODSPEED_MAIL_AGE_ARCHIVE) and checked against mc-mail-age.json, like the Himalaya test does.
 *
 * Usage: node tools/test-mc-mail-computer.js
 */
"use strict";
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

let PASS = 0, FAIL = 0;
const ok = (name, cond, detail) => { if (cond) { PASS++; console.log("  ok   " + name); } else { FAIL++; console.log("  FAIL " + name + (detail ? "\n       " + String(detail).slice(0, 800) : "")); } };

const MANIFEST = require("./mc-mail-age.json");
const key = process.platform + "-" + process.arch;
const ASSET = MANIFEST.assets[key];
const EXE = process.platform === "win32" ? ".exe" : "";
const gitEnv = { GIT_AUTHOR_NAME: "Test", GIT_AUTHOR_EMAIL: "test@example.invalid", GIT_COMMITTER_NAME: "Test", GIT_COMMITTER_EMAIL: "test@example.invalid", GIT_TERMINAL_PROMPT: "0" };
const git = (cwd, ...a) => spawnSync("git", a, { cwd, encoding: "utf8", windowsHide: true, env: { ...process.env, ...gitEnv } });

async function archive() {
  if (process.env.GODSPEED_MAIL_AGE_ARCHIVE) return process.env.GODSPEED_MAIL_AGE_ARCHIVE;
  const cache = path.join(os.tmpdir(), "mc-mail-test-" + ASSET.asset);
  const good = f => fs.existsSync(f) && crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex") === ASSET.sha256;
  if (good(cache)) return cache;
  try {
    const res = await fetch(MANIFEST.download + ASSET.asset, { signal: AbortSignal.timeout(180000) });
    if (!res.ok) return "";
    fs.writeFileSync(cache, Buffer.from(await res.arrayBuffer()));
    return good(cache) ? cache : "";
  } catch (e) { return ""; }
}
// A node child with its own home folder, so os.homedir() is a temporary one there.
function child(script, env) {
  const homeVars = process.platform === "win32" ? { USERPROFILE: env.HOME_DIR } : { HOME: env.HOME_DIR };
  const e = { ...process.env, ...gitEnv, ...homeVars, ...env };
  delete e.GODSPEED_MAIL_HOME; delete e.GODSPEED_AGE_KEY; delete e.HERMES_HOME; delete e.GODSPEED_ASSISTANT_CONFIG;
  for (const [k, v] of Object.entries(env)) if (v === null) delete e[k];
  return spawnSync(process.execPath, ["-e", script], { cwd: __dirname, env: e, encoding: "utf8", windowsHide: true, timeout: 120000 });
}

async function main() {
  if (!ASSET) { console.log(`SKIP: no pinned age for ${key}`); process.exit(0); }
  const pinned = await archive();
  if (!pinned) { console.log("FAIL: the pinned age archive could not be fetched (offline?)"); process.exit(1); }
  const W = fs.mkdtempSync(path.join(os.tmpdir(), "godspeed mail computer "));   // a space, on purpose
  const HOME = path.join(W, "home"), GS = path.join(W, "godspeed");
  fs.mkdirSync(HOME, { recursive: true }); fs.mkdirSync(GS, { recursive: true }); fs.writeFileSync(path.join(GS, "AGENTS.md"), "# test\n");
  Object.assign(process.env, gitEnv, { GODSPEED_MAIL_HOME: HOME, GODSPEED_DIR: GS, GODSPEED_ROOT: GS, GODSPEED_MAIL_AGE_ONLY_FETCHED: "1" });
  delete process.env.GODSPEED_AGE_KEY;
  const A = require("./mc-mail-age.js"), G = require("./mc-mail-gmail.js");
  console.log("mc-mail on a computer");

  // 1. age is fetched once, checked, and only the pinned one is kept.
  const bad = path.join(W, "tampered" + path.extname(ASSET.asset));
  const tampered = Buffer.from(fs.readFileSync(pinned)); tampered[tampered.length - 100] ^= 0xff; fs.writeFileSync(bad, tampered);
  process.env.GODSPEED_MAIL_AGE_ARCHIVE = bad;
  let err = ""; try { await A.ensure(); } catch (e) { err = e.message; }
  ok("1 a copy of age that is not the pinned one is refused, and nothing is installed", /not the pinned one/.test(err) && !A.local("age"), err);
  ok("2 before age is here, keeping a key says what to do in plain words", (() => { try { G.writeStore({ X: "1" }); return false; } catch (e) { return /which locks your key away, is not on this computer yet\. Run the same mc-mail command in a terminal again: it fetches age by itself/.test(e.message); } })());
  process.env.GODSPEED_MAIL_AGE_ARCHIVE = pinned;
  await G.readyAge();
  const dir = path.join(HOME, ".godspeed", "mail", "age");
  const v = spawnSync(path.join(dir, "age" + EXE), ["--version"], { encoding: "utf8" });
  ok("3 the pinned archive puts age and age-keygen in the mail folder, with its licence", (v.stdout || "").includes(MANIFEST.version) && fs.existsSync(path.join(dir, "age-keygen" + EXE)) && fs.existsSync(path.join(dir, "LICENSE")), v.stdout + v.stderr);
  ok("4 mc-mail finds that copy", G.findAge("age") === path.join(dir, "age" + EXE) && G.findAge("age-keygen") === path.join(dir, "age-keygen" + EXE));
  G.writeStore({ AGENTMAIL_READ_KEY: "am_read_test", GODSPEED_MAIL_AGENTMAIL_INBOX: "sam-mc@agentmail.to" });
  const back = G.readStore();
  ok("5 with it a key is locked away and opened again (a key for this computer is made at the first lock)", (back.lines || []).includes("AGENTMAIL_READ_KEY=am_read_test") && fs.existsSync(path.join(HOME, ".godspeed", "age-key.txt")) && !fs.readFileSync(path.join(GS, "secrets", "mc-secrets.env.age")).includes("am_read_test"), JSON.stringify(back));

  // 2. Keys stay on this computer on a mission control with the notebook.
  const remote = path.join(W, "github.git");
  git(W, "init", "-q", "--bare", remote);
  git(GS, "init", "-q", "-b", "main"); git(GS, "remote", "add", "origin", remote);
  fs.writeFileSync(path.join(GS, "FULL-ALPHA.md"), "# Integrated notebook\n");
  git(GS, "add", "AGENTS.md", "FULL-ALPHA.md"); git(GS, "commit", "-q", "-m", "start"); git(GS, "push", "-q", "origin", "main");
  const said = G.shareStore("mc-mail: connect the mission control address (sam-mc@agentmail.to)");
  ok("6 on a mission control with the notebook the key is kept on this computer only", said === "kept on this computer only, and never sent to your GitHub copy", said);
  ok("7 nothing is committed", git(GS, "log", "--oneline").stdout.trim().split("\n").length === 1 && !git(GS, "ls-files", "secrets").stdout.trim());
  ok("8 nothing reaches the stand-in for GitHub", !git(remote, "ls-tree", "-r", "--name-only", "main").stdout.includes("secrets/"));
  ok("9 the folder's own Git is told to leave secrets/ alone, so no later commit picks the key up", git(GS, "check-ignore", "-q", "secrets/mc-secrets.env.age").status === 0 && /^\/secrets\/$/m.test(fs.readFileSync(path.join(GS, ".gitignore"), "utf8")));
  // A notebook folder whose owner keeps files in secrets/ under version control on purpose: no ignore line, still no commit.
  const GS2 = path.join(W, "owner-keeps-secrets"); fs.mkdirSync(path.join(GS2, "secrets"), { recursive: true });
  fs.writeFileSync(path.join(GS2, "AGENTS.md"), "x\n"); fs.writeFileSync(path.join(GS2, "FULL-ALPHA.md"), "x\n"); fs.writeFileSync(path.join(GS2, "secrets", "README.md"), "mine\n");
  git(GS2, "init", "-q", "-b", "main"); git(GS2, "add", "-A"); git(GS2, "commit", "-q", "-m", "start");
  process.env.GODSPEED_DIR = process.env.GODSPEED_ROOT = GS2; G.writeStore({ AGENTMAIL_READ_KEY: "k2" }); G.shareStore("x");
  ok("9b an owner who keeps secrets/ in Git keeps their ignore file as it was, and the key is not committed", !fs.existsSync(path.join(GS2, ".gitignore")) && git(GS2, "log", "--oneline").stdout.trim().split("\n").length === 1);
  // Without the notebook: shared as before.
  const GS3 = path.join(W, "first-edition"), remote3 = path.join(W, "github3.git");
  fs.mkdirSync(GS3, { recursive: true }); fs.writeFileSync(path.join(GS3, "AGENTS.md"), "x\n");
  git(W, "init", "-q", "--bare", remote3); git(GS3, "init", "-q", "-b", "main"); git(GS3, "remote", "add", "origin", remote3);
  git(GS3, "add", "-A"); git(GS3, "commit", "-q", "-m", "start"); git(GS3, "push", "-q", "-u", "origin", "main");
  process.env.GODSPEED_DIR = process.env.GODSPEED_ROOT = GS3; G.writeStore({ AGENTMAIL_READ_KEY: "k3" });
  const said3 = G.shareStore("mc-mail: connect");
  ok("10 a mission control without the notebook shares its locked store as it always did", /sent with your mission control/.test(said3) && git(remote3, "ls-tree", "-r", "--name-only", "main").stdout.includes("secrets/mc-secrets.env.age"), said3);
  process.env.GODSPEED_DIR = process.env.GODSPEED_ROOT = GS;

  // 3. One mail folder for the assistant and a terminal.
  const H2 = path.join(W, "home2"), GS4 = path.join(W, "notebook folder");
  const old = path.join(GS4, ".godspeed", "device-home", ".godspeed");
  fs.mkdirSync(path.join(old, "mail", "imap"), { recursive: true }); fs.mkdirSync(H2, { recursive: true });
  fs.writeFileSync(path.join(GS4, "AGENTS.md"), "x\n");
  fs.copyFileSync(path.join(HOME, ".godspeed", "age-key.txt"), path.join(old, "age-key.txt"));
  fs.writeFileSync(path.join(old, "mail", "imap", "state.json"), JSON.stringify({ address: "sam@example.com", state: "ready" }));
  fs.writeFileSync(path.join(old, "mail", "imap", ".acl"), "owner-only\n");
  fs.writeFileSync(path.join(old, "mail", "drafts.json"), "{}");
  const moved = child(`const G=require("./mc-mail-gmail.js");console.log(JSON.stringify(G.adoptOldHome()));`, { HOME_DIR: H2, GODSPEED_DIR: GS4, GODSPEED_ROOT: GS4 });
  const here = path.join(H2, ".godspeed");
  ok("11 what the assistant kept in its old folder is moved to the home folder a terminal uses",
    fs.existsSync(path.join(here, "age-key.txt")) && fs.existsSync(path.join(here, "mail", "imap", "state.json")) && fs.existsSync(path.join(here, "mail", "drafts.json")) && !fs.existsSync(path.join(old, "mail", "imap")), moved.stdout + moved.stderr);
  ok("12 the moved Gmail folder is made private to this account again in its new place", !fs.existsSync(path.join(here, "mail", "imap", ".acl")));
  // Both places have one: the home folder's is kept, the old one is left untouched.
  fs.mkdirSync(path.join(old, "mail", "imap"), { recursive: true });
  fs.writeFileSync(path.join(old, "mail", "imap", "state.json"), JSON.stringify({ address: "older@example.com" }));
  child(`require("./mc-mail-gmail.js").adoptOldHome();`, { HOME_DIR: H2, GODSPEED_DIR: GS4, GODSPEED_ROOT: GS4 });
  ok("13 nothing is moved over something already in the home folder", JSON.parse(fs.readFileSync(path.join(here, "mail", "imap", "state.json"), "utf8")).address === "sam@example.com" && fs.existsSync(path.join(old, "mail", "imap", "state.json")));
  // A store locked with the old folder's key, while the home folder has a different key: it still opens.
  const H3 = path.join(W, "home3"), GS5 = path.join(W, "two keys"), old5 = path.join(GS5, ".godspeed", "device-home", ".godspeed");
  fs.mkdirSync(path.join(H3, ".godspeed"), { recursive: true }); fs.mkdirSync(old5, { recursive: true }); fs.writeFileSync(path.join(GS5, "AGENTS.md"), "x\n");
  const keygen = path.join(dir, "age-keygen" + EXE);
  spawnSync(keygen, ["-o", path.join(old5, "age-key.txt")]); spawnSync(keygen, ["-o", path.join(H3, ".godspeed", "age-key.txt")]);
  const both = child(`(async()=>{const G=require("./mc-mail-gmail.js");await G.readyAge();process.env.GODSPEED_AGE_KEY=${JSON.stringify(path.join(old5, "age-key.txt"))};G.writeStore({AGENTMAIL_READ_KEY:"old"});delete process.env.GODSPEED_AGE_KEY;G.adoptOldHome();console.log(JSON.stringify(G.readStore()));})();`,
    { HOME_DIR: H3, GODSPEED_DIR: GS5, GODSPEED_ROOT: GS5, GODSPEED_MAIL_AGE_ONLY_FETCHED: "1", GODSPEED_MAIL_HOME: null });
  ok("14 a store locked with a key the assistant made in its old folder still opens", /AGENTMAIL_READ_KEY=old/.test(both.stdout), both.stdout + both.stderr);

  // 4. mc-mail setup wires the notebook's own Hermes too. Every settings folder is a temporary one.
  const H4 = path.join(W, "home4"), GS6 = path.join(W, "wired"), profile = path.join(W, "State", "hermes-profile");
  fs.mkdirSync(path.join(H4, ".hermes"), { recursive: true }); fs.mkdirSync(path.join(GS6, ".godspeed"), { recursive: true }); fs.mkdirSync(profile, { recursive: true });
  fs.writeFileSync(path.join(GS6, "AGENTS.md"), "x\n");
  fs.writeFileSync(path.join(H4, ".hermes", "config.yaml"), "model: x\n");
  const notebookEntry = "terminal:\n  cwd: \"x\"\nmcp_servers:\n  notebook:\n    url: http://127.0.0.1:47831/mcp\n";
  fs.writeFileSync(path.join(profile, "config.yaml"), notebookEntry);
  fs.writeFileSync(path.join(GS6, ".godspeed", "assistant.json"), "﻿" + JSON.stringify({ verified: true, home: profile, workspace: GS6 }));
  const tmpAll = { HOME_DIR: H4, GODSPEED_DIR: GS6, GODSPEED_ROOT: GS6, LOCALAPPDATA: path.join(W, "local"), APPDATA: path.join(W, "roaming"), CODEX_HOME: path.join(W, "no-codex") };
  const run1 = child(`require("./mc-mail.js").main(["setup"]);`, tmpAll);
  const cfg = fs.readFileSync(path.join(profile, "config.yaml"), "utf8");
  ok("15 mc-mail setup adds the mail tool to the notebook's Hermes and keeps its notebook tool", /Hermes \(the assistant your notebook set up\): added the mail tool/.test(run1.stdout) && /^  mc-mail:$/m.test(cfg) && /^  notebook:\n    url: http:\/\/127\.0\.0\.1:47831\/mcp$/m.test(cfg) && cfg.includes("GODSPEED_DIR: " + JSON.stringify(GS6)), run1.stdout + run1.stderr + cfg);
  ok("16 and the default Hermes still gets its usual entry", /^Hermes: added the mail tool/m.test(run1.stdout) && /mc-mail:/.test(fs.readFileSync(path.join(H4, ".hermes", "config.yaml"), "utf8")), run1.stdout);
  const run2 = child(`require("./mc-mail.js").main(["setup","--check"]);`, tmpAll);
  ok("17 the notebook's Hermes entry starts and answers like Hermes would start it, and a second run adds nothing", /Hermes \(the assistant your notebook set up\): the mail tool answers/.test(run2.stdout) && fs.readFileSync(path.join(profile, "config.yaml"), "utf8") === cfg, run2.stdout + run2.stderr);

  // 5. The first connect, without a terminal: age is fetched before anything is asked.
  const H5 = path.join(W, "home5"); fs.mkdirSync(H5, { recursive: true });
  const first = child(`require("./mc-mail.js").main(["connect","agentmail"]);`, { HOME_DIR: H5, GODSPEED_DIR: GS, GODSPEED_ROOT: GS, GODSPEED_MAIL_AGE_ARCHIVE: pinned, GODSPEED_MAIL_AGE_ONLY_FETCHED: "1" });
  ok("18 connect agentmail fetches age first and only then needs the person at a terminal", fs.existsSync(path.join(H5, ".godspeed", "mail", "age", "age" + EXE)) && /this needs you at a terminal/.test(first.stderr) && !/age is not on this computer/.test(first.stdout + first.stderr), first.stdout + first.stderr);

  try { fs.rmSync(W, { recursive: true, force: true }); } catch (e) { /* Windows may hold a file a moment longer */ }
  console.log(`\n${PASS} passed, ${FAIL} failed`);
  process.exit(FAIL ? 1 : 0);
}
main().catch(e => { console.log("FAIL: " + e.stack); process.exit(1); });
