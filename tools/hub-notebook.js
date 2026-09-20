/*
 * hub-notebook.js - what hub-search and hub-menerio-connect both need to know: where the hub
 * is, how to read the one notebook key out of the locked store, and which files the notebook
 * mirror covers.
 *
 * It is a module, not a command. It sits beside the programs that use it, the same way
 * hub-cards.js sits beside hub-goals and hub-work, because the installer copies this whole
 * folder to one place and "the file next to me" is the only address a scheduled job can count on.
 *
 * It never prints a key and never returns one to anything but the caller.
 */
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

// ---------------------------------------------------------------- where is the hub
function readDeviceEnv(name) {
  const f = path.join(os.homedir(), ".hub", "device.env");
  try {
    for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = line.match(new RegExp("^\\s*" + name + "=(.*)$"));
      if (m) return m[1].trim();
    }
  } catch (e) { /* no device.env is normal on a hub somebody made by hand */ }
  return "";
}

// The same order hub-due uses: what you said, what the installer wrote down, what the
// environment says, and last a walk up from where you are sitting.
function findHub(explicit) {
  let hub = explicit || readDeviceEnv("HUB_DIR") || process.env.HUB_DIR || "";
  if (!hub) {
    let d = process.cwd();
    for (let i = 0; i < 6; i++) {
      if (fs.existsSync(path.join(d, "AGENTS.md")) || fs.existsSync(path.join(d, "profile"))) { hub = d; break; }
      const up = path.dirname(d);
      if (up === d) break;
      d = up;
    }
  }
  if (!hub) return "";
  hub = path.resolve(hub);
  try { return fs.statSync(hub).isDirectory() ? hub : ""; } catch (e) { return ""; }
}

// ---------------------------------------------------------------- finding `age`
// The small program that opens the locked store. NOT assumed to be on PATH: on a Mac it
// lives where Homebrew put it, on Windows where the installer put it, and a program started
// by a schedule is handed almost no PATH at all. The same hunt hub-check-keys makes.
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
  // Last resort: whatever PATH says, proved by RUNNING it.
  for (const n of names) {
    const r = spawnSync(n, ["--version"], { encoding: "utf8" });
    if (!r.error) return n;
  }
  return "";
}

// ---------------------------------------------------------------- the notebook key
// The environment first, because the installer teaches every new terminal the key and a
// program started there already holds it. The locked store second, for everything that was
// NOT started from a terminal: a scheduled job, an assistant started from an icon.
//
// Returns { key, from, why }. `why` is a short plain reason when there is no key, and it is
// allowed to reach a reader. The key itself must never be printed by anybody.
function menerioKey(hub) {
  const fromEnv = (process.env.MENERIO_API_KEY || "").trim();
  if (fromEnv) return { key: fromEnv, from: "environment", why: "" };
  if (!hub) return { key: "", from: "", why: "no hub folder found" };
  const store = path.join(hub, "secrets", "hub-secrets.env.age");
  const keyFile = process.env.HUB_AGE_KEY || path.join(os.homedir(), ".hub", "age-key.txt");
  if (!fs.existsSync(store)) return { key: "", from: "", why: "your hub carries no keys" };
  if (!fs.existsSync(keyFile)) return { key: "", from: "", why: "this computer has not opened your hub's locked store yet" };
  const age = findAge();
  if (!age) return { key: "", from: "", why: "the small program called age is not on this computer" };
  const r = spawnSync(age, ["-d", "-i", keyFile, store], { encoding: "utf8", maxBuffer: 4e6 });
  for (const line of (r.stdout || "").split(/\r?\n/)) {
    const m = line.match(/^MENERIO_API_KEY=(.*)$/);
    if (m) {
      const v = m[1].replace(/["' \r]/g, "");
      if (v) return { key: v, from: "store", why: "" };
    }
  }
  if (r.status !== 0) return { key: "", from: "", why: "the key on this computer does not open your hub's store" };
  return { key: "", from: "", why: "your hub's store holds no MENERIO_API_KEY" };
}

// ---------------------------------------------------------------- which files are mirrored
// THE SAME LIST LIVES IN tools/notebook-sync.py, which is the program that does the mirroring.
// hub-search falls back to searching exactly these files, so that a search gives the same
// answer about what EXISTS whether or not Menerio could be reached. Change one, change the
// other; tools/test-hub-search.sh compares the two on one folder and fails when they drift.
// The reason for each exception is written once, in notebook-sync.py.
const SKIP_DIRS = ["dev", ".git", "node_modules"];
const SKIP_PREFIXES = ["world/removed/"];
const SKILLS_FOLDER = "skills";
const SKILLS_ALIASES = [".claude/skills"];
const SYNC_SKIP_FILES = new Set([
  "observations/MEMORY.md", "observations/README.md", "skills/README.md", ".claude/skills/README.md",
]);
const DECISION_LOG = "decisions.md";
const MAX_FILE_BYTES = 300 * 1024;

// What git tracks, or null when git cannot answer. Only believed when the hub IS the top of a
// repository: a hub sitting inside some other repository gets the answer "nothing", and
// nothing is the wrong answer.
function trackedMarkdown(hub) {
  const git = (args) => spawnSync("git", ["-C", hub].concat(args),
    { encoding: "utf8", maxBuffer: 64e6, timeout: 60000 });
  const top = git(["rev-parse", "--show-cdup"]);
  if (top.error || top.status !== 0 || (top.stdout || "").trim()) return null;
  const listed = git(["ls-files", "-z", "--cached"]);
  if (listed.error || listed.status !== 0) return null;
  return listed.stdout.split("\0").filter((p) => p && p.toLowerCase().endsWith(".md"));
}

function walkedMarkdown(hub) {
  const found = [];
  const walk = (dir, rel) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const r = rel ? rel + "/" + e.name : e.name;
      // isDirectory() is false for a link, so links are never followed. That is what keeps
      // a linked .claude/skills from turning up as a second skills/.
      if (e.isDirectory()) {
        if (e.name === ".git" || e.name === "node_modules") continue;
        if (!rel && SKIP_DIRS.includes(e.name)) continue;
        walk(path.join(dir, e.name), r);
      } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
        found.push(r);
      }
    }
  };
  walk(hub, "");
  return found;
}

function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } }

// The repo-relative paths the mirror covers, sorted. decisions.md is NOT in the list, exactly
// as in notebook-sync.py, where it is split into one note per decision.
function mirroredMarkdown(hub) {
  const paths = trackedMarkdown(hub) || walkedMarkdown(hub);
  const visibleSkills = isDir(path.join(hub, SKILLS_FOLDER));
  const keep = [];
  for (const rel of Array.from(new Set(paths)).sort()) {
    if (rel === DECISION_LOG || SYNC_SKIP_FILES.has(rel)) continue;
    if (SKIP_DIRS.includes(rel.split("/", 1)[0])) continue;
    if (SKIP_PREFIXES.some((p) => rel.startsWith(p))) continue;
    if (visibleSkills && SKILLS_ALIASES.some((a) => rel.startsWith(a + "/"))) continue;
    let st;
    try { st = fs.statSync(path.join(hub, rel)); } catch (e) { continue; }
    if (!st.isFile() || st.size > MAX_FILE_BYTES) continue;
    keep.push(rel);
  }
  return keep;
}

module.exports = {
  readDeviceEnv, findHub, findAge, menerioKey, mirroredMarkdown, DECISION_LOG,
};
