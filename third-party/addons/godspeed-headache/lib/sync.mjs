// Entries reach the other machines through mission control's own git history. Only FOLDER (below)
// is ever staged or committed here, with an explicit pathspec, so a person's half-finished work in
// the same folder is never swept into this add-on's commits.
//
// Every save starts a sync of its own in the background, so a burst of entries starts several at
// once, often while something else is using git in the same folder. None of them may give up
// because of that (they used to, and those entries stayed on this computer only). So the syncs
// take turns through a lock file in git's own folder: one that finds the lock taken waits for it,
// and the one holding it goes round again until nothing under FOLDER is left uncommitted or
// unpushed. A git step that fails because another git command holds the index is tried again
// after a pause, and so is a push another machine beat. A rebase is waited out for a while and
// never touched: it may be the person's own. The same file serves the journal, the coach and the
// headache tracker; only the four lines below differ.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "godspeed-headache.mjs");
const FOLDER = "routines/headache";
const MEANWHILE = "headache: entries saved meanwhile";
export { commitFolder as commitHeadache };
// One name for every Godspeed add-on that syncs this way (journal, coach, headache), so their
// syncs in the same folder take turns too, and none pulls in the middle of another's rebase.
const LOCK = "godspeed-addons-sync.lock";
const PAUSES = [500, 1000, 2000, 4000, 8000]; // between the tries of a git step that failed
export const LIMITS = Object.freeze({
  lockWaitMs: 15 * 60000, // how long a sync waits for the one before it
  staleMs: 10 * 60000,    // a lock untouched this long belongs to a sync that hangs; every git step touches it
  rebaseWaitMs: 60000,    // how long a rebase in progress is waited out before this sync leaves it be
  rounds: 5,              // commit-and-push rounds one sync makes while entries keep arriving
  pushTries: 3,
});

const g = (mcDir, args, timeout = 60000) => spawnSync("git", ["-C", mcDir, ...args], { encoding: "utf8", timeout, windowsHide: true });
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
// git prints these relative to the folder it ran in, or absolute (a linked worktree).
function gitPath(mcDir, name) {
  const r = g(mcDir, ["rev-parse", "--git-path", name]);
  const p = r.status === 0 ? r.stdout.trim() : "";
  return p ? path.resolve(mcDir, p) : null;
}

// True when the person is in the middle of a rebase they started by hand (or one an earlier
// pull left stopped on a conflict). Nothing here may touch git state until they finish it.
export function rebaseInProgress(mcDir) {
  return ["rebase-merge", "rebase-apply"].some((which) => {
    const p = gitPath(mcDir, which);
    return Boolean(p && fs.existsSync(p));
  });
}

// A rebase in progress may be another program's pull, over in a moment, or the person's own,
// which nothing here may touch. It is waited out for a while; true once it is over.
function rebaseOver(mcDir, waitMs) {
  for (const end = Date.now() + waitMs; rebaseInProgress(mcDir); sleep(Math.min(1000, waitMs))) if (Date.now() > end) return false;
  return true;
}

// A git step, again after a pause each time it fails, the way it fails while another git command
// holds the index.
function tries(step) {
  let r = step();
  for (const ms of PAUSES) { if (r.status === 0) break; sleep(ms); r = step(); }
  return r;
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

// A lock can be taken over when the sync that holds it died (this computer, process gone), or
// when nobody has touched it for longer than any git step takes.
function stale(text, mtimeMs, staleMs) {
  if (Date.now() - mtimeMs > staleMs) return true;
  try {
    const { pid, host } = JSON.parse(text);
    return host === os.hostname() && Number.isInteger(pid) && !pidAlive(pid);
  } catch { return false; } // still being written
}

// Moves a stale lock out of the way, unless another sync took the lock between the look and now.
function drop(file, judged) {
  const aside = `${file}.${process.pid}.${Date.now()}.stale`;
  try { fs.renameSync(file, aside); } catch { return; }
  let text = "";
  try { text = fs.readFileSync(aside, "utf8"); } catch {}
  if (text !== judged) try { fs.linkSync(aside, file); } catch {}
  try { fs.unlinkSync(aside); } catch {}
}

// Waits for the lock. null: the wait ran out. { file: null }: there is nowhere to keep a lock
// (a read-only .git), so this sync goes ahead the way syncs did before there was one.
function takeLock(file, { lockWaitMs, staleMs }) {
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const body = JSON.stringify({ pid: process.pid, host: os.hostname(), at: new Date().toISOString(), token });
  const end = Date.now() + lockWaitMs;
  for (;;) {
    try { fs.writeFileSync(file, body, { flag: "wx" }); return { file, body }; }
    catch (e) {
      // Windows answers EPERM for a moment while a lock just given back is still being deleted.
      if (!["EEXIST", "EPERM", "EACCES", "EBUSY"].includes(e.code)) return { file: null };
    }
    let text = null, mtimeMs = 0;
    try { mtimeMs = fs.statSync(file).mtimeMs; text = fs.readFileSync(file, "utf8"); } catch {}
    if (text !== null && stale(text, mtimeMs, staleMs)) { drop(file, text); continue; }
    if (Date.now() > end) return null;
    sleep(text === null ? 50 : 250);
  }
}

function touch(lock) {
  if (!lock.file) return;
  const t = new Date();
  try { fs.utimesSync(lock.file, t, t); } catch {}
}

function giveBack(lock) {
  if (!lock.file) return;
  for (let i = 0; i < 10; i++) {
    try {
      if (fs.readFileSync(lock.file, "utf8") !== lock.body) return; // taken over: no longer ours
      fs.unlinkSync(lock.file); return;
    } catch (e) { if (e.code === "ENOENT") return; sleep(50); }
  }
}

function withLock(mcDir, o, work) {
  const file = gitPath(mcDir, LOCK);
  const lock = file ? takeLock(file, o) : { file: null };
  if (!lock) return null;
  try { return work((args, timeout) => { touch(lock); return g(mcDir, args, timeout); }); }
  finally { giveBack(lock); }
}

// Commits of FOLDER this computer made that its upstream does not have yet, from a push that failed
// earlier. None when the branch has no upstream.
function unpushed(git) {
  const r = git(["rev-list", "--count", "@{u}..HEAD", "--", FOLDER]);
  return r.status === 0 && Number(r.stdout.trim()) > 0;
}

function push(mcDir, git, o) {
  for (let i = 0; i < o.pushTries; i++) {
    if (i) sleep(PAUSES[i]);
    if (!rebaseOver(mcDir, o.rebaseWaitMs)) return "push-failed";
    const pull = git(["pull", "--rebase", "--autostash", "-q"]);
    // Stopped on a conflict: put everything back as it was. The entry stays committed here.
    if (pull.status !== 0) { if (rebaseInProgress(mcDir)) git(["rebase", "--abort"]); continue; }
    if (git(["push", "-q"], 300000).status === 0) return "pushed";
  }
  return "push-failed";
}

function round(mcDir, git, message, mode, o) {
  if (!rebaseOver(mcDir, o.rebaseWaitMs)) return "busy";
  if (fs.existsSync(path.join(mcDir, FOLDER)) && tries(() => git(["add", "--", FOLDER])).status !== 0) return "commit-failed";
  const staged = git(["diff", "--cached", "--quiet", "--", FOLDER]).status === 1;
  if (staged && tries(() => git(["commit", "-m", message, "--", FOLDER])).status !== 0) return "commit-failed";
  if (mode === "commit" || !git(["remote"]).stdout.trim()) return staged ? "committed" : "nothing";
  if (!staged && !unpushed(git)) return "nothing";
  return push(mcDir, git, o);
}

function commitFolder(mcDir, message, mode, options = {}) {
  if (mode === "off" || !fs.existsSync(path.join(mcDir, ".git"))) return "off";
  const o = { ...LIMITS, ...options };
  const result = withLock(mcDir, o, (git) => {
    let out = "nothing";
    for (let i = 0; i < o.rounds; i++) {
      const r = round(mcDir, git, i ? MEANWHILE : message, mode, o);
      if (r === "nothing") break;
      out = r;
      if (r !== "pushed" && r !== "committed") break;
    }
    return out;
  });
  // The wait ran out: the sync holding the lock is still at it, and its rounds take this entry along.
  return result ?? "busy";
}

export function syncInBackground(mcDir, message, mode) {
  if (mode === "off") return;
  spawn(process.execPath, [BIN, "_sync", message, "--godspeed", mcDir], { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

// Before a tick reads the entries. It takes its turn like a sync, so it never pulls in the middle
// of one, and never aborts a rebase that is not its own.
export function pullQuietly(mcDir, mode) {
  if (mode !== "auto" || !fs.existsSync(path.join(mcDir, ".git"))) return;
  withLock(mcDir, { ...LIMITS, lockWaitMs: 60000 }, (git) => {
    if (rebaseInProgress(mcDir)) return;
    const pull = git(["pull", "--rebase", "--autostash", "-q"], 15000);
    if (pull.status !== 0 && rebaseInProgress(mcDir)) git(["rebase", "--abort"]);
  });
}
