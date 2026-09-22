#!/usr/bin/env node
/*
 * check-keys.js - are the keys your mission control folder is carrying actually ON this computer,
 * and is any of them about to run out?
 *
 * WHY THIS EXISTS. Your mission control keeps your keys locked inside the folder, so connecting a
 * service once connects it on every computer you own. There is one more step after that,
 * and it is invisible: the key has to be handed to the programs running on THIS machine.
 * "It is in the folder" and "it is on this computer" are two different facts, and only the
 * second one makes anything work. When the second one is false, nothing says so. Your
 * assistant simply behaves as though you had never connected anything.
 *
 * It never prints a key. Names, dates and counts only.
 *
 * Question 4 also handles the one kind of key that is NOT in your folder on purpose: a login
 * that belongs to one computer, written in secrets/expires.txt as NAME@the/file/it/lives/in.
 * It is counted down like any other and it is never reported as missing from the folder,
 * because it was never meant to be in there.
 *
 *   mc-check-keys              check this computer
 *   mc-check-keys --godspeed PATH   check a mission control somewhere else
 *
 * Exit code 0 when the chain holds, 1 when it does not, so it can be put in something that
 * runs on its own if you ever want that.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const crypto = require("crypto");

let problems = 0;
const say = (s) => console.log(s);
const good = (s) => say("     " + s);
const bad = (s) => { problems++; say("     " + s); };

// ---------------------------------------------------------------- where is the mission control
function readDeviceEnv(name) {
  const f = path.join(os.homedir(), ".godspeed", "device.env");
  try {
    for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = line.match(new RegExp("^\\s*" + name + "=(.*)$"));
      if (m) return m[1].trim();
    }
  } catch (e) { /* no device.env is normal on a mission control somebody made by hand */ }
  return "";
}

let godspeed = "";
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--godspeed") godspeed = args[i + 1] || "";
  if (args[i] === "-h" || args[i] === "--help") {
    say("mc-check-keys - are your mission control's keys really on this computer?");
    say("  mc-check-keys [--godspeed PATH]");
    process.exit(0);
  }
}
if (!godspeed) godspeed = process.env.GODSPEED_DIR || readDeviceEnv("GODSPEED_DIR") || process.cwd();
godspeed = path.resolve(godspeed);

// ---------------------------------------------------------------- finding `age`
// The small program that opens the locked store. NOT assumed to be on PATH: on a Mac it
// lives where Homebrew put it, on Windows where the installer put it, and a program started
// by a schedule is handed almost no PATH at all. A hunt through a few known places costs
// nothing and turns "nothing is connected" into "here is the one thing to install".
function findAge() {
  const home = os.homedir();
  const names = process.platform === "win32" ? ["age.exe"] : ["age"];
  const dirs = [
    "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/snap/bin",
    path.join(home, "bin"),
    path.join(home, ".local", "bin"),
    path.join(home, "AppData", "Local", "Microsoft", "WinGet", "Links"),
    "C:\\Program Files\\age",
  ];
  for (const d of dirs) {
    for (const n of names) {
      const p = path.join(d, n);
      try { fs.accessSync(p, fs.constants.X_OK); return p; } catch (e) { /* keep looking */ }
    }
  }
  // Last resort: whatever PATH says, proved by RUNNING it. A name that answers "where is
  // this program" and then fails to start is a real thing on Windows, and it reads exactly
  // like success.
  for (const n of names) {
    const r = spawnSync(n, ["--version"], { encoding: "utf8" });
    if (!r.error) return n;
  }
  return "";
}

const store = path.join(godspeed, "secrets", "mc-secrets.env.age");
const sealed = path.join(godspeed, "secrets", "mc-key.age");
const keyFile = process.env.GODSPEED_AGE_KEY || path.join(os.homedir(), ".godspeed", "age-key.txt");

say("");
say("Checking the keys your mission control folder is carrying.");
say("");
say("  Your mission control folder: " + godspeed);
say("");

// ---------------------------------------------------------------- 1. any keys at all?
say("  1. Does your folder carry any keys?");
if (!fs.existsSync(store)) {
  good("No, and that is a complete way to own a mission control. Everything the book builds up to");
  good("Chapter 20 works on plain files with no key anywhere. Nothing to check.");
  say("");
  process.exit(0);
}
good("Yes, locked, in secrets/ inside your folder.");
say("");

// ---------------------------------------------------------------- 2. can this one open them?
say("  2. Can this computer open them?");
const age = findAge();
const names = [];
const values = {};
if (!fs.existsSync(keyFile)) {
  if (fs.existsSync(sealed)) {
    bad("No. Your folder carries the key, and this computer has not unlocked it yet.");
    bad("What to do: run the installer again here and type your mission control passphrase once.");
  } else {
    bad("No. This computer has no key, and your folder carries no locked copy of one.");
    bad("What to do: on the computer that CAN open them, run the installer again. It");
    bad("offers to put the key into the folder, and then this one needs the passphrase.");
  }
} else if (!age) {
  bad("Cannot tell. The small program that opens the lock, called age, is not on this");
  bad("computer. What to do: Mac, brew install age. Linux, apt install age. Windows,");
  bad("winget install FiloSottile.age. Then run this again.");
} else {
  const r = spawnSync(age, ["-d", "-i", keyFile, store], { encoding: "utf8", maxBuffer: 4e6 });
  for (const line of (r.stdout || "").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (m) { names.push(m[1]); values[m[1]] = m[2].replace(/["' \r]/g, ""); }
  }
  if (!names.length) {
    bad("No. The key on this computer does not open this folder's store, so it belongs to");
    bad("a different godspeed. What to do: run the installer again here and type your mission control");
    bad("passphrase, which replaces the key with the right one.");
  } else {
    good("Yes. It carries " + names.length + " key" + (names.length === 1 ? "" : "s") + ".");
  }
}
say("");

// ------------------------------------------ 3. would a program started now actually get them?
// THE LAST LINK, AND THE ONE NOTHING ELSE ASKS ABOUT. Everything above can be perfect on a
// computer where your assistant still gets nothing at all.
say("  3. Would a program you start right now actually get them?");
if (!names.length) {
  good("Cannot tell yet. Question 2 has to be a yes first.");
} else if (process.platform === "win32") {
  // Windows keeps a list per account that every NEW program inherits. That list, and not
  // this one program's own environment, is what an assistant started from an icon sees.
  const ps =
    "$sha=[System.Security.Cryptography.SHA256]::Create(); " +
    "foreach($e in [Environment]::GetEnvironmentVariables('User').GetEnumerator()){ " +
    "$v=[string]$e.Value; $v=$v -replace '[\"'' \\r]',''; " +
    "$b=[Text.Encoding]::UTF8.GetBytes($v); " +
    "$x=($sha.ComputeHash($b)|ForEach-Object{$_.ToString('x2')}) -join ''; " +
    "Write-Output ($e.Key + [char]9 + $x) }";
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps],
    { encoding: "utf8", maxBuffer: 8e6 });
  const have = {};
  for (const line of (r.stdout || "").split(/\r?\n/)) {
    const p = line.split("\t");
    if (p.length === 2 && p[1].trim()) have[p[0]] = p[1].trim();
  }
  if (!Object.keys(have).length) {
    bad("Cannot tell. This computer would not show me the list every new program starts");
    bad("with, so whether your assistant gets your keys is unknown. That is not the same");
    bad("as it being fine.");
  } else {
    const missing = names.filter((n) => !(n in have));
    const wrong = names.filter((n) => n in have &&
      have[n] !== crypto.createHash("sha256").update(values[n], "utf8").digest("hex"));
    if (missing.length) {
      bad("No. " + (missing.length === names.length && names.length === 1
          ? "Your one key never reaches" : missing.length + (missing.length === 1 ? " of them never reaches" : " of them never reach")) +
        " a program started on this computer: " + missing.join(", "));
      bad("What to do: run the installer again here. It puts them where new programs look.");
    }
    if (wrong.length) {
      // The half nobody expects: the NAME is there and the key behind it is last year's.
      bad("No. " + wrong.length + (wrong.length === 1 ? " of them reaches" : " of them reach") +
        " programs here as an OLD key, replaced in your folder since: " + wrong.join(", "));
      bad("What to do: run the installer again here, which copies the current one over.");
    }
    if (!missing.length && !wrong.length) {
      good(names.length === 1
        ? "Yes. Your one key, and it is the current one."
        : "Yes. All " + names.length + " of them, and each one is the current one.");
    }
  }
} else {
  // Mac and Linux hand the keys over through one line in your shell start-up file, so the
  // honest test is to start a terminal the way you do and see what it ends up holding.
  const rcs = [".bashrc", ".zshrc"].map((f) => path.join(os.homedir(), f));
  const wired = rcs.filter((f) => {
    try { return /mc-notebook-env/.test(fs.readFileSync(f, "utf8")); } catch (e) { return false; }
  });
  if (!wired.length) {
    bad("No. Nothing in this computer's start-up hands your keys to the programs you");
    bad("launch, so your assistant starts with none of them.");
    bad("What to do: run the installer again here. It adds that one line.");
  } else {
    const probe = names
      .map((n) => "printf '%s=%s\\n' " + n + " \"${" + n + ":+set}\"")
      .join("; ");
    const r = spawnSync(process.env.SHELL || "bash", ["-ic", probe],
      { encoding: "utf8", timeout: 20000, maxBuffer: 4e6 });
    if (r.error || r.status === null) {
      bad("Cannot tell. A fresh terminal did not answer in time, so whether it ends up");
      bad("holding your keys is unknown. That is not the same as it being fine.");
    } else {
      const seen = {};
      for (const line of (r.stdout || "").split(/\r?\n/)) {
        const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(set)?$/);
        if (m) seen[m[1]] = m[2] === "set";
      }
      const missing = names.filter((n) => !seen[n]);
      if (missing.length) {
        bad("No. A fresh terminal here holds " + (names.length - missing.length) + " of your " +
          names.length + " keys. Missing: " + missing.join(", "));
        bad("What to do: run the installer again here, then open a new terminal.");
      } else {
        good(names.length === 1
          ? "Yes. A fresh terminal here holds it."
          : "Yes. A fresh terminal here holds all " + names.length + " of them.");
      }
    }
  }
}
say("");

// ---------------------------------------------------------------- 4. is any of them dying?
// A key that arrived perfectly on every computer you own can still be dead. Nothing tells
// you on the day it happens: the service simply starts saying no, and the message it gives
// back blames whatever asked.
say("  4. Is any of them about to run out?");
const expires = path.join(godspeed, "secrets", "expires.txt");
const rows = [];
if (fs.existsSync(expires)) {
  const today = process.env.GODSPEED_TODAY || new Date().toISOString().slice(0, 10);
  const dayOf = (s) =>
    Math.floor(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86400000);
  const now = dayOf(today);
  for (const raw of fs.readFileSync(expires, "utf8").split(/\r?\n/)) {
    const hash = raw.indexOf("#");
    const note = hash >= 0 ? raw.slice(hash + 1).trim() : "";
    const body = (hash >= 0 ? raw.slice(0, hash) : raw).trim();
    if (!body) continue;
    const f = body.split(/\s+/);
    if (f.length < 2) {
      rows.push({ status: "BAD", name: f[0], note: "it needs a name and then a date" });
      continue;
    }
    if (f[1] === "never") continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f[1])) {
      rows.push({ status: "BAD", name: f[0], note: "the date is not written as YYYY-MM-DD" });
      continue;
    }
    // NAME@PATH means the key lives in that one file on this computer and is NOT in your
    // locked folder, on purpose. Question 4 counts it down like any other, and the check
    // further down does not go looking for it in the folder, because it was never meant
    // to be in there and "missing" would be a warning you could never make go away.
    let name = f[0], where = "";
    const at = name.indexOf("@");
    if (at === 0 || at === name.length - 1) {
      rows.push({ status: "BAD", name: f[0], note: at === 0
        ? "there is no key name before the @"
        : "there is no file after the @, so it says the key lives somewhere without saying where" });
      continue;
    }
    if (at > 0) { name = f[0].slice(0, at); where = f[0].slice(at + 1); }
    const left = dayOf(f[1]) - now;
    rows.push({
      status: left < 0 ? "EXPIRED" : left <= 14 ? "DUE" : left <= 60 ? "SOON" : "QUIET",
      name: name, where: where, date: f[1], left: left, url: f[2] || "-", note: note,
    });
  }
}
const plain = (r) => (r.note.split(".")[0] || r.name).trim();
if (!fs.existsSync(expires) || !rows.length) {
  good("Nothing is written down yet, so nothing here knows when any of your keys dies.");
  good("Chapter 31 has the one line that fixes that: secrets/expires.txt.");
} else {
  for (const r of rows.filter((x) => x.status === "BAD")) {
    bad("A line in secrets/expires.txt cannot be read (" + r.name + "): " + r.note);
  }
  // Where a key lives is said ON the line that reports it, never on a line of its own: a key
  // that lives on one computer fails differently, and "everything using it" would be wrong.
  // A key with months left still says nothing at all, whichever kind it is.
  for (const r of rows.filter((x) => x.status === "EXPIRED")) {
    if (r.where) {
      bad(plain(r) + " ran out on " + r.date + ", " + (-r.left) + " days ago. It lives");
      bad("in " + r.where + " on this computer, and that computer is already");
      bad("being refused. No other computer of yours looks any different.");
    } else {
      bad(plain(r) + " ran out on " + r.date + ", " + (-r.left) + " days ago. Everything");
      bad("using it is already being refused.");
    }
    if (r.url !== "-") bad("Get a new one here: " + r.url);
    else bad("There is no page for this one. The steps are on its own line in expires.txt.");
  }
  for (const r of rows.filter((x) => x.status === "DUE" || x.status === "SOON")) {
    good(plain(r) + " runs out on " + r.date + ", in " + r.left + " days.");
    if (r.where) good("It lives in " + r.where + " on this computer, not in your folder.");
    if (r.url !== "-") good("Get a new one here: " + r.url);
    else good("There is no page for this one. The steps are on its own line in expires.txt.");
  }
  // A name written down that the folder does not carry. Only asked of the keys that are
  // MEANT to be in the folder, and only when the folder could actually be opened: "I could
  // not look" must never be printed as "it is not there".
  if (names.length) {
    for (const r of rows) {
      if (r.status === "BAD" || r.where || names.includes(r.name)) continue;
      bad("secrets/expires.txt has a date for " + r.name + " and your folder carries no");
      bad("key by that name. Nothing can renew a key that is not there.");
    }
  }
  if (!rows.filter((x) => x.status !== "QUIET").length) {
    good(rows.length === 1
      ? "One key has a date written down, and it is not close."
      : rows.length + " keys have a date written down, and none of them is close.");
  }
}
say("");
if (problems === 0) {
  say("  Everything your folder carries is on this computer and working.");
} else {
  say("  " + problems + " line" + (problems === 1 ? "" : "s") + " above need something from you.");
}
say("");
process.exit(problems === 0 ? 0 : 1);
