// Entries reach the other machines through mission control's own git history. Only an add-on's own
// folder is ever staged or committed, with an explicit pathspec, so a person's half-finished work
// in the same folder is never swept into an add-on's commit.
//
// How a burst of saves all gets there (they used to meet each other's syncs, give up, and stay on
// this computer only):
// - Each save writes a work item of its own, a file with a unique name in git's own folder, before
//   it starts the background sync. A save always leaves a record, and no record replaces another.
// - Syncs take turns through one lock. The sync holding it commits each item's folder and deletes
//   the item only once its commit, and its push when the item asks for one, worked. A sync that
//   finds the lock taken leaves; after giving the lock back the holder looks once more and takes
//   it again when an item arrived meanwhile, so no save waits for a sync that has finished.
// - An item that fails (git's index locked past every try, a push that keeps failing, a rebase in
//   progress) stays, and so do the other items of its folder for that turn: one commit holds the
//   whole folder, so they would only fail the same way, each after its own tries.
// - While items wait, one background sync per mission control folder stays and tries again, at
//   pauses growing to a quarter of an hour, for as long as they wait: they never depend on the next
//   save. Any other sync that would stay leaves them to it. The next save or tick tries them too.
// - A lock is taken over only when the process that wrote it is gone, or when its holder has not
//   touched it for ten minutes, twice as long as any git step may run (after a restart, its process
//   number can belong to another program). A holder touches it and checks that it is still its own
//   before every git step, and stops when it is not.
// - Only the journal's, the coach's and the headache tracker's folders are ever committed, and a
//   folder that does not exist is skipped.
// - A rebase in progress is never touched; a sync aborts only a rebase that HEAD's reflog shows it
//   started itself.
// - git_sync works per repository in effect: one push sends every local commit on the branch, so an
//   add-on set to commit only is pushed along with the next push of an add-on set to auto.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The only lines that differ between the journal, the coach and the headache tracker:
const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "godspeed-headache.mjs");
const FOLDER = "routines/headache";
export const commitHeadache = (mcDir, message, mode, options) => commitFolder(mcDir, FOLDER, message, mode, options);

const FOLDERS = ["routines/journal", "coach", "routines/headache"]; // the only folders a sync ever commits
const LOCK = "godspeed-addons-sync.lock";
const ITEMS = "godspeed-addons-sync";
const RETRY = "godspeed-addons-sync.retry"; // says which background sync stays to try again
export const LIMITS = Object.freeze({
  rebaseWaitMs: 60000,                   // how long a rebase in progress is waited out before a sync leaves it be
  pushTries: 3,
  pauses: [500, 1000, 2000, 4000, 8000], // between the tries of a git step that failed
  retryFirstMs: 30000,                   // the sync that stays while items wait tries again after this,
  retryMaxMs: 900000,                    // doubling the pause up to a quarter of an hour
  staleMs: 600000,                      // a lock untouched this long is abandoned: the longest git step (a push) stops at 5 min
});
const FAILED = new Set(["busy", "commit-failed", "push-failed"]);
const LOST = new Error("The sync lock is no longer this sync's.");

const g = (mcDir, args, timeout = 60000, env) =>
  spawnSync("git", ["-C", mcDir, ...args], { encoding: "utf8", timeout, windowsHide: true, env: env && { ...process.env, ...env } });
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const token = () => `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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

// Brings in what the other machines pushed. The rebase runs under a reflog name of its own, so
// HEAD's reflog says "godspeed-sync <token> (start)" where the person's says "rebase (start)". A
// rebase that stops is aborted only when the newest start in that reflog is this one. True when
// the branch now contains its upstream.
export function pullRebase(mcDir, git = (args, timeout, env) => g(mcDir, args, timeout, env), timeout = 60000) {
  if (git(["fetch", "-q"], timeout).status !== 0) return false;
  const up = git(["rev-parse", "-q", "--verify", "@{u}"]).stdout.trim();
  if (!up || git(["merge-base", "--is-ancestor", up, "HEAD"]).status === 0) return true;
  const action = `godspeed-sync ${token()}`;
  if (git(["rebase", "--merge", "--autostash", "-q", up], timeout, { GIT_REFLOG_ACTION: action }).status === 0) return true;
  const start = git(["reflog", "show", "--format=%gs", "-n", "200", "HEAD"]).stdout.split("\n").find((l) => l.includes("(start)"));
  if (rebaseInProgress(mcDir) && start && start.startsWith(`${action} (start)`)) git(["rebase", "--abort"]);
  return false;
}

// A git step, again after a pause each time it fails, the way it fails while another git command
// holds the index.
function tries(step, pauses) {
  let r = step();
  for (const ms of pauses) { if (r.status === 0) break; sleep(ms); r = step(); }
  return r;
}

// One work item per save: a new file under a unique name, written whole elsewhere and renamed into
// place, so a sync never reads half of one and nothing ever writes over one.
function addItem(mcDir, item) {
  const dir = gitPath(mcDir, ITEMS);
  if (!dir) return null;
  const name = `${String(Date.now()).padStart(15, "0")}-${token()}.json`;
  const tmp = path.join(dir, `.${name}.tmp`);
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(item));
    fs.renameSync(tmp, path.join(dir, name));
    return name;
  } catch {
    try { fs.unlinkSync(tmp); } catch {}
    return null;
  }
}

// The items waiting, oldest first. One that names any other folder, or no valid mode, is not ours
// and is left alone.
function items(dir) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => n.endsWith(".json") && !n.startsWith(".")).sort(); } catch { return []; }
  return names.flatMap((name) => {
    const file = path.join(dir, name);
    try {
      const { folder, mode, message } = JSON.parse(fs.readFileSync(file, "utf8"));
      if (!FOLDERS.includes(folder) || !["auto", "commit"].includes(mode)) return [];
      return [{ name, file, folder, mode, message: String(message || `${folder}: entries`) }];
    } catch { return []; }
  });
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; }
}

// Taken over only when the sync that wrote it is gone: its process no longer runs on this computer,
// it never finished writing the lock (empty or unreadable for a minute), or its holder stopped
// touching it. A holder touches the lock before every git step and no git step runs half as long
// as staleMs, so a lock that old has no git step running for it, though its process number may
// belong to another program by now (Windows hands numbers out again, after a restart too).
function abandoned(text, mtimeMs, staleMs) {
  if (Date.now() - mtimeMs > staleMs) return true;
  let lock;
  try { lock = JSON.parse(text); } catch { return Date.now() - mtimeMs > 60000; }
  return lock.host === os.hostname() && Number.isInteger(lock.pid) && !pidAlive(lock.pid);
}

// Moves an abandoned lock out of the way, unless another sync took the lock between the look and now.
function drop(file, judged) {
  const aside = `${file}.${token()}.stale`;
  try { fs.renameSync(file, aside); } catch { return; }
  let text = "";
  try { text = fs.readFileSync(aside, "utf8"); } catch {}
  if (text !== judged) try { fs.linkSync(aside, file); } catch {}
  try { fs.unlinkSync(aside); } catch {}
}

// The lock, or null when a live sync holds it (after waiting up to waitMs).
// { file: null }: there is nowhere to keep a lock (a read-only .git), so this goes ahead without.
function takeLock(file, waitMs, staleMs) {
  const body = JSON.stringify({ pid: process.pid, host: os.hostname(), at: new Date().toISOString(), token: token() });
  const end = Date.now() + waitMs;
  for (let spin = 0; spin < 200; spin++) {
    try { fs.writeFileSync(file, body, { flag: "wx" }); return { file, body }; }
    // Windows answers EPERM for a moment while a lock just given back is being deleted.
    catch (e) { if (!["EEXIST", "EPERM", "EACCES", "EBUSY"].includes(e.code)) return { file: null }; }
    let text = null, mtimeMs = 0;
    try { mtimeMs = fs.statSync(file).mtimeMs; text = fs.readFileSync(file, "utf8"); } catch {}
    if (text !== null && abandoned(text, mtimeMs, staleMs)) { drop(file, text); continue; }
    if (text !== null && Date.now() >= end) return null; // its holder will see the items
    sleep(text === null ? 50 : 250);                     // being written or deleted right now
  }
  return null;
}

function owns(lock) {
  if (!lock.file) return true;
  try { return fs.readFileSync(lock.file, "utf8") === lock.body; } catch { return false; }
}

// Says the holder is still at work: a lock touched within staleMs is never taken over.
function touch(lock) {
  if (!lock.file) return;
  const now = new Date();
  try { fs.utimesSync(lock.file, now, now); } catch {}
}

function giveBack(lock) {
  if (!lock.file) return;
  for (let i = 0; i < 10; i++) {
    try {
      if (fs.readFileSync(lock.file, "utf8") !== lock.body) return; // no longer ours
      fs.unlinkSync(lock.file); return;
    } catch (e) { if (e.code === "ENOENT") return; sleep(50); }
  }
}

// Commits of a folder this computer made that its upstream does not have yet, from a push that
// failed earlier. None when the branch has no upstream.
function unpushed(git, folder) {
  const r = git(["rev-list", "--count", "@{u}..HEAD", "--", folder]);
  return r.status === 0 && Number(r.stdout.trim()) > 0;
}

function push(mcDir, git, o) {
  for (let i = 0; i < o.pushTries; i++) {
    if (i) sleep(o.pauses[i] ?? 0);
    if (!rebaseOver(mcDir, o.rebaseWaitMs)) return "push-failed";
    if (!pullRebase(mcDir, git)) continue;
    if (git(["push", "-q"], 300000).status === 0) return "pushed";
  }
  return "push-failed";
}

function round(mcDir, git, { folder, message, mode }, o) {
  if (!FOLDERS.includes(folder) || !fs.existsSync(path.join(mcDir, folder))) return "nothing";
  if (!rebaseOver(mcDir, o.rebaseWaitMs)) return "busy";
  if (tries(() => git(["add", "--", folder]), o.pauses).status !== 0) return "commit-failed";
  const staged = git(["diff", "--cached", "--quiet", "--", folder]).status === 1;
  if (staged && tries(() => git(["commit", "-m", message, "--", folder]), o.pauses).status !== 0) return "commit-failed";
  if (mode === "commit" || !git(["remote"]).stdout.trim()) return staged ? "committed" : "nothing";
  if (!staged && !unpushed(git, folder)) return "nothing";
  return push(mcDir, git, o);
}

// Every item not yet tried by this sync, again and again while new ones arrive. A rebase in
// progress ends the work for now: every item waits. A failed item's folder waits too, for this turn.
function work(mcDir, git, dir, o, failed, results) {
  const due = () => items(dir).filter((i) => !failed.has(i.name));
  const wait = (r, which) => { for (const i of items(dir)) if (which(i) && !failed.has(i.name)) { failed.add(i.name); results.set(i.name, r); } };
  for (let list = due(); list.length; list = due()) {
    for (const item of list) {
      if (failed.has(item.name)) continue;
      const r = round(mcDir, git, item, o);
      results.set(item.name, r);
      if (r === "busy") { wait(r, () => true); return; }
      if (FAILED.has(r)) wait(r, (i) => i.folder === item.folder);
      else try { fs.unlinkSync(item.file); } catch { failed.add(item.name); }
    }
  }
}

// Takes the lock, does `first` (if any) and the work; gives the lock back and looks once more,
// taking the lock again when an item arrived while it held it. null: a live sync holds the lock,
// and it does the work instead.
function takeTurns(mcDir, o, { first = null, waitMs = 0 } = {}) {
  const file = gitPath(mcDir, LOCK), dir = gitPath(mcDir, ITEMS);
  if (!file || !dir) return null;
  const failed = new Set(), results = new Map();
  let held = false;
  for (;;) {
    const lock = takeLock(file, waitMs, o.staleMs);
    waitMs = 0;
    if (!lock) return held ? results : null;
    held = true;
    try {
      const git = (args, timeout, env) => { if (!owns(lock)) throw LOST; touch(lock); return g(mcDir, args, timeout, env); };
      if (first) { const f = first; first = null; f(git); }
      work(mcDir, git, dir, o, failed, results);
    } catch (e) { if (e !== LOST) throw e; }
    finally { giveBack(lock); }
    if (!items(dir).some((i) => !failed.has(i.name))) return results;
  }
}

// Saves and commits now, in this process (a tick, or a command that waits for its result).
// "queued": a live sync holds the lock and commits this one.
export function commitFolder(mcDir, folder, message, mode, options = {}) {
  if (mode === "off" || !FOLDERS.includes(folder) || !fs.existsSync(path.join(mcDir, ".git"))) return "off";
  const name = addItem(mcDir, { folder, mode, message });
  if (!name) return "commit-failed";
  const results = takeTurns(mcDir, { ...LIMITS, ...options });
  if (!results) return "queued";
  return results.get(name) ?? "nothing";
}

// What the background sync runs: the items that are waiting, in a turn of its own or, when a live
// sync holds the lock, in that sync's turn. Either way it stays while items still wait: the holder
// may be a tick or a command, which does not stay.
export function syncQueued(mcDir, options = {}) {
  if (!fs.existsSync(path.join(mcDir, ".git"))) return;
  const o = { ...LIMITS, ...options };
  takeTurns(mcDir, o);
  retryWhileWaiting(mcDir, o);
}

// Sleeps ms, a second at a time; false as soon as nothing waits any more.
function pauseWhile(ms, waiting) {
  for (const end = Date.now() + ms; Date.now() < end; sleep(Math.min(1000, end - Date.now()))) if (!waiting()) return false;
  return waiting();
}

// Items still wait (a rebase someone else left in progress, git's index locked past every try, a
// push that keeps failing, or another sync's turn still running). One background sync per mission
// control folder stays and tries again at growing pauses, without holding the lock in between, for
// as long as items wait, so they go out once the cause is gone instead of waiting for the next save.
// Which one stays is a second lock, the retry mark, taken over like the sync lock (its holder
// touches it at every wake); any other sync leaves. A pause ends early once nothing waits. After
// giving the mark back the holder looks once more, so an item that arrived just then is not left
// without one. It ends when nothing waits or the mission control folder is gone.
function retryWhileWaiting(mcDir, o) {
  const dir = gitPath(mcDir, ITEMS), file = gitPath(mcDir, RETRY);
  const waiting = () => fs.existsSync(path.join(mcDir, ".git")) && items(dir).length > 0;
  while (dir && file && waiting()) {
    const mark = takeLock(file, 0, o.retryMaxMs + o.staleMs); // untouched past a pause and a long turn: its sync is gone
    if (!mark) return;
    try {
      for (let pause = o.retryFirstMs; pauseWhile(pause, waiting) && owns(mark); pause = Math.min(pause * 2, o.retryMaxMs)) {
        touch(mark);
        takeTurns(mcDir, o);
      }
    } finally { giveBack(mark); }
  }
}

// After a save: its work item first, here and now, then the sync in the background. That runs from
// the home folder: a sync waiting to try again must not keep the folder it was started from in use
// (Windows does not let anyone remove a folder a running program has as its own).
export function syncInBackground(mcDir, message, mode) {
  if (mode === "off" || !fs.existsSync(path.join(mcDir, ".git"))) return;
  addItem(mcDir, { folder: FOLDER, mode, message });
  spawn(process.execPath, [BIN, "_sync", "--godspeed", path.resolve(mcDir)], { cwd: os.homedir(), detached: true, stdio: "ignore", windowsHide: true }).unref();
}

// Before a tick reads the entries. It waits a while for its turn, so it never pulls in the middle of
// a sync, and it does the waiting items too, like any sync holding the lock.
export function pullQuietly(mcDir, mode) {
  if (mode !== "auto" || !fs.existsSync(path.join(mcDir, ".git"))) return;
  takeTurns(mcDir, LIMITS, { waitMs: 60000, first: (git) => { if (!rebaseInProgress(mcDir)) pullRebase(mcDir, git, 15000); } });
}
