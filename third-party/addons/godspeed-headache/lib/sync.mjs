// Entries reach the other machines through mission control's own git history. Only an add-on's own
// folder is ever staged or committed, with an explicit pathspec, so a person's half-finished work
// in the same folder is never swept into an add-on's commit.
//
// Every save starts a sync of its own in the background, so a burst of entries starts several at
// once, often while something else is using git in the same folder. They used to give up when
// they met each other, and those entries stayed on this computer only. Now:
// - A sync first writes its folder into a queue in git's own folder, then takes the lock. One that
//   finds the lock taken leaves: the sync holding it commits everything queued, for every add-on
//   that uses this file (journal, coach, headache), each with its own folder as the pathspec. It
//   looks at the queue once more after giving the lock back, so no save waits for a sync that has
//   already finished.
// - What a sync cannot finish (git's index locked for long, a rebase that is not its own, a push
//   that keeps failing) stays in the queue, and the next sync of any of these add-ons finishes it.
//   A commit whose push failed stays on this computer until then.
// - A git step that fails while another git command holds the index is tried again after a pause;
//   a push another machine beat is pulled and pushed again.
// - A rebase is waited out for a while and never aborted unless this sync's own pull started it.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The only lines that differ between the journal, the coach and the headache tracker:
const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "godspeed-headache.mjs");
const FOLDER = "routines/headache";
export const commitHeadache = (mcDir, message, mode, options) => commitFolder(mcDir, FOLDER, message, mode, options);

// Shared by every add-on that uses this file, so their syncs in one folder take turns too.
const LOCK = "godspeed-addons-sync.lock";
const QUEUE = "godspeed-addons-sync.queue";
export const LIMITS = Object.freeze({
  staleMs: 10 * 60000,    // a lock untouched this long belongs to a sync that hangs; every git step touches it
  rebaseWaitMs: 60000,    // how long a rebase in progress is waited out before a sync leaves it be
  pushTries: 3,
  pauses: [500, 1000, 2000, 4000, 8000], // between the tries of a git step that failed
});
const FAILED = new Set(["busy", "commit-failed", "push-failed"]);

const g = (mcDir, args, timeout = 60000) => spawnSync("git", ["-C", mcDir, ...args], { encoding: "utf8", timeout, windowsHide: true });
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

// The rebase in progress is the one this sync just started: from this HEAD, onto this upstream.
function ownRebase(mcDir, onto, head) {
  for (const which of ["rebase-merge", "rebase-apply"]) {
    const p = gitPath(mcDir, which);
    if (!p || !fs.existsSync(p)) continue;
    const read = (f) => { try { return fs.readFileSync(path.join(p, f), "utf8").trim(); } catch { return ""; } };
    return read("onto") === onto && read("orig-head") === head;
  }
  return false;
}

// Brings in what the other machines pushed. A rebase that stops on a conflict is put back as it
// was, but only when it is provably this one's; a rebase the person began in the meantime is left
// alone. True when this branch now contains its upstream.
export function pullRebase(mcDir, git = (args, timeout) => g(mcDir, args, timeout), timeout = 60000) {
  if (git(["fetch", "-q"], timeout).status !== 0) return false;
  const up = git(["rev-parse", "-q", "--verify", "@{u}"]).stdout.trim();
  const head = git(["rev-parse", "HEAD"]).stdout.trim();
  if (!up || git(["merge-base", "--is-ancestor", up, "HEAD"]).status === 0) return true;
  if (git(["rebase", "--autostash", "-q", up], timeout).status === 0) return true;
  if (ownRebase(mcDir, up, head)) git(["rebase", "--abort"]);
  return false;
}

// A git step, again after a pause each time it fails, the way it fails while another git command
// holds the index.
function tries(step, pauses) {
  let r = step();
  for (const ms of pauses) { if (r.status === 0) break; sleep(ms); r = step(); }
  return r;
}

// The queue: one file per add-on folder waiting for a sync, written whole (a temporary file renamed
// into place), holding a token that changes with every write.
function enqueue(dir, item, { onlyIfAbsent = false } = {}) {
  const t = token();
  const tmp = path.join(dir, `.${t}`);
  const file = path.join(dir, encodeURIComponent(item.folder));
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify({ token: t, mode: item.mode, message: item.message }));
    if (onlyIfAbsent) fs.linkSync(tmp, file);
    else for (let i = 0; ; i++) try { fs.renameSync(tmp, file); break; } catch (e) { if (i > 20) throw e; sleep(25); }
    return t;
  } catch { return null; }
  finally { try { fs.unlinkSync(tmp); } catch {} }
}

function queued(dir) {
  let names = [];
  try { names = fs.readdirSync(dir).filter((n) => !n.startsWith(".")); } catch { return []; }
  return names.flatMap((n) => {
    const file = path.join(dir, n);
    try {
      const q = JSON.parse(fs.readFileSync(file, "utf8"));
      return [{ file, folder: decodeURIComponent(n), token: q.token, mode: q.mode === "commit" ? "commit" : "auto", message: String(q.message || "") }];
    } catch { return []; }
  });
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
  const aside = `${file}.${token()}.stale`;
  try { fs.renameSync(file, aside); } catch { return; }
  let text = "";
  try { text = fs.readFileSync(aside, "utf8"); } catch {}
  if (text !== judged) try { fs.linkSync(aside, file); } catch {}
  try { fs.unlinkSync(aside); } catch {}
}

// The lock, or null when another sync holds it (after waiting up to waitMs for it).
// { file: null }: there is nowhere to keep a lock (a read-only .git), so this goes ahead without.
function takeLock(file, { staleMs }, waitMs = 0) {
  const body = JSON.stringify({ pid: process.pid, host: os.hostname(), at: new Date().toISOString(), token: token() });
  const end = Date.now() + waitMs;
  for (let spin = 0; spin < 200; spin++) {
    try { fs.writeFileSync(file, body, { flag: "wx" }); return { file, body }; }
    // Windows answers EPERM for a moment while a lock just given back is being deleted.
    catch (e) { if (!["EEXIST", "EPERM", "EACCES", "EBUSY"].includes(e.code)) return { file: null }; }
    let text = null, mtimeMs = 0;
    try { mtimeMs = fs.statSync(file).mtimeMs; text = fs.readFileSync(file, "utf8"); } catch {}
    if (text !== null && stale(text, mtimeMs, staleMs)) { drop(file, text); continue; }
    if (text !== null && Date.now() >= end) return null; // alive: its holder will see the queue
    sleep(text === null ? 50 : 250);                     // being written or deleted right now
  }
  return null;
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
  if (!rebaseOver(mcDir, o.rebaseWaitMs)) return "busy";
  if (fs.existsSync(path.join(mcDir, folder)) && tries(() => git(["add", "--", folder]), o.pauses).status !== 0) return "commit-failed";
  const staged = git(["diff", "--cached", "--quiet", "--", folder]).status === 1;
  if (staged && tries(() => git(["commit", "-m", message, "--", folder]), o.pauses).status !== 0) return "commit-failed";
  if (mode === "commit" || !git(["remote"]).stdout.trim()) return staged ? "committed" : "nothing";
  if (!staged && !unpushed(git, folder)) return "nothing";
  return push(mcDir, git, o);
}

// One folder, again while saves keep landing in it as it works.
function settle(mcDir, git, item, o) {
  let out = "nothing";
  for (let i = 0; i < 5; i++) {
    const r = round(mcDir, git, item, o);
    if (r !== "nothing") out = r;
    if (r === "nothing" || FAILED.has(r) || !git(["status", "--porcelain", "--", item.folder]).stdout.trim()) break;
  }
  return out;
}

// Everything in the queue that this sync has not handled yet. A folder is taken off the queue
// before its commit, so a save queued in the meantime is either in that commit or queued again.
// What fails goes back on the queue for the next sync, unless a newer save queued it already.
function drain(mcDir, git, dir, o, seen, results, extra) {
  for (let pass = 0; pass < 50; pass++) {
    const items = [...extra.splice(0), ...queued(dir).filter((q) => seen.get(q.folder) !== q.token)];
    if (!items.length) return;
    for (const q of items) {
      if (q.file) { seen.set(q.folder, q.token); try { fs.unlinkSync(q.file); } catch {} }
      const r = settle(mcDir, git, q, o);
      if (r !== "nothing" || !results.has(q.folder)) results.set(q.folder, r);
      if (FAILED.has(r)) { const t = enqueue(dir, q, { onlyIfAbsent: true }); if (t) seen.set(q.folder, t); }
    }
  }
}

// Takes the lock, does `first` (if any), then everything queued; gives the lock back and looks at
// the queue once more, taking the lock again when a save queued itself while this one held it.
// null: another sync holds the lock, and it does all of that instead.
function takeTurns(mcDir, o, { first = null, extra = [], waitMs = 0 } = {}) {
  const file = gitPath(mcDir, LOCK), dir = gitPath(mcDir, QUEUE);
  if (!file || !dir) return null;
  const seen = new Map(), results = new Map();
  let held = false;
  for (let pass = 0; pass < 50; pass++) {
    const lock = takeLock(file, o, pass ? 0 : waitMs);
    if (!lock) return held ? results : null;
    held = true;
    try {
      const git = (args, timeout) => { touch(lock); return g(mcDir, args, timeout); };
      if (first) { first(git); first = null; }
      drain(mcDir, git, dir, o, seen, results, extra);
    } finally { giveBack(lock); }
    if (!queued(dir).some((q) => seen.get(q.folder) !== q.token)) return results;
  }
  return results;
}

export function commitFolder(mcDir, folder, message, mode, options = {}) {
  if (mode === "off" || !fs.existsSync(path.join(mcDir, ".git"))) return "off";
  const o = { ...LIMITS, ...options };
  const item = { folder, message, mode };
  const dir = gitPath(mcDir, QUEUE);
  // Queued before the lock is tried: whoever holds the lock then will see it.
  const inQueue = dir ? enqueue(dir, item) : null;
  const results = takeTurns(mcDir, o, { extra: inQueue ? [] : [item] });
  if (!results) return "queued";
  return results.get(folder) ?? "nothing";
}

export function syncInBackground(mcDir, message, mode) {
  if (mode === "off") return;
  spawn(process.execPath, [BIN, "_sync", message, "--godspeed", mcDir], { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

// Before a tick reads the entries. It waits a while for its turn, so it never pulls in the middle of
// a sync, and it commits whatever was queued meanwhile, like any sync holding the lock.
export function pullQuietly(mcDir, mode) {
  if (mode !== "auto" || !fs.existsSync(path.join(mcDir, ".git"))) return;
  takeTurns(mcDir, LIMITS, { waitMs: 60000, first: (git) => { if (!rebaseInProgress(mcDir)) pullRebase(mcDir, git, 15000); } });
}
