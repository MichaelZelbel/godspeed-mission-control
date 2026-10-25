import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { commitHeadache, commitFolder, pullQuietly, pullRebase, rebaseInProgress, syncInBackground, syncQueued } from "../lib/sync.mjs";

const git = (cwd, ...a) => spawnSync("git", a, { cwd, encoding: "utf8" });
function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hj-sync-"));
  const remote = path.join(root, "remote.git"); const mcDir = path.join(root, "mc");
  git(root, "init", "--bare", "-b", "main", remote);
  git(root, "clone", remote, mcDir);
  git(mcDir, "config", "user.email", "t@t"); git(mcDir, "config", "user.name", "t");
  fs.writeFileSync(path.join(mcDir, "AGENTS.md"), "x"); git(mcDir, "add", "."); git(mcDir, "commit", "-m", "init"); git(mcDir, "push", "-u", "origin", "main");
  return { mcDir, remote };
}
function clone(remote, dir) {
  git(path.dirname(dir), "clone", "-q", remote, dir);
  git(dir, "config", "user.email", "o@o"); git(dir, "config", "user.name", "o");
  return dir;
}

const SYNC = pathToFileURL(fileURLToPath(new URL("../lib/sync.mjs", import.meta.url))).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gitPath = (mcDir, name) => path.resolve(mcDir, git(mcDir, "rev-parse", "--git-path", name).stdout.trim());
const lockFile = (mcDir) => gitPath(mcDir, "godspeed-addons-sync.lock");
const itemsDir = (mcDir) => gitPath(mcDir, "godspeed-addons-sync");
const workItems = (mcDir) => { try { return fs.readdirSync(itemsDir(mcDir)).filter((n) => n.endsWith(".json") && !n.startsWith(".")); } catch { return []; } };
const dirty = (mcDir) => git(mcDir, "status", "--porcelain", "-uall", "--", "routines/headache").stdout.trim();
const remoteFiles = (remote) => git(remote, "ls-tree", "-r", "--name-only", "main").stdout;
const has = (remote, file) => remoteFiles(remote).split(/\r?\n/).includes(file);
const OTHER = "coach"; // another add-on's folder beside this one's: they share the lock and the work items
const liveLock = (mcDir) => fs.writeFileSync(lockFile(mcDir), JSON.stringify({ pid: process.pid, host: os.hostname(), token: "another sync" }));
function entry(mcDir, name, folder = "routines/headache") {
  fs.mkdirSync(path.join(mcDir, folder), { recursive: true });
  fs.writeFileSync(path.join(mcDir, folder, name), name);
}
// commitHeadache in a process of its own, the way a command that waits for its result runs it.
function syncInChild(mcDir) {
  const code = `import { commitHeadache } from ${JSON.stringify(SYNC)}; console.log(commitHeadache(${JSON.stringify(mcDir)}, "headache: child", "auto"));`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "inherit"] });
  let out = ""; child.stdout.on("data", (d) => { out += d; });
  return new Promise((resolve) => child.on("exit", () => resolve(out.trim())));
}
async function until(check, ms = 90000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (check()) return true;
  return check();
}
function hook(mcDir, name, body) {
  const file = path.join(gitPath(mcDir, "hooks"), name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}
// A pre-push hook that waits while a file exists: the sync holding the lock is held mid-push.
function holdPush(mcDir) {
  const f = (p) => p.replace(/\\/g, "/");
  const pushing = path.join(path.dirname(mcDir), "pushing"), held = path.join(path.dirname(mcDir), "held");
  fs.writeFileSync(held, "");
  hook(mcDir, "pre-push", `touch "${f(pushing)}"\nwhile [ -f "${f(held)}" ]; do sleep 0.1; done\nexit 0`);
  return { pushing: () => fs.existsSync(pushing), release: () => fs.rmSync(held) };
}

test("commits and pushes headache files only, leaving other staged work alone", () => {
  const { mcDir, remote } = repo();
  fs.writeFileSync(path.join(mcDir, "other.md"), "mine"); git(mcDir, "add", "other.md");
  entry(mcDir, "a.md");
  assert.equal(commitHeadache(mcDir, "headache: note", "auto"), "pushed");
  assert.equal(git(remote, "show", "--name-only", "--format=", "main").stdout.trim(), "routines/headache/a.md");
  assert.match(git(mcDir, "diff", "--cached", "--name-only").stdout, /other\.md/);
  assert.deepEqual(workItems(mcDir), [], "a work item goes once its commit and push worked");
});

test("nothing to commit, commit-only mode, and off", () => {
  const { mcDir } = repo();
  assert.equal(commitHeadache(mcDir, "x", "auto"), "nothing");
  entry(mcDir, "b.md");
  assert.equal(commitHeadache(mcDir, "x", "off"), "off");
  assert.equal(commitHeadache(mcDir, "x", "commit"), "committed");
});

test("a folder that is not a git repo is fine", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hj-nogit-"));
  assert.equal(commitHeadache(d, "x", "auto"), "off");
});

test("a conflicting pull aborts its own rebase cleanly and leaves the entry safe locally", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hj-sync-conflict-"));
  const remote = path.join(root, "remote.git");
  git(root, "init", "--bare", "-b", "main", remote);
  const seed = clone(remote, path.join(root, "seed"));
  fs.writeFileSync(path.join(seed, "AGENTS.md"), "x");
  entry(seed, "settings.json");
  git(seed, "add", "."); git(seed, "commit", "-m", "init"); git(seed, "push", "-u", "origin", "main");
  const a = clone(remote, path.join(root, "a")), b = clone(remote, path.join(root, "b"));

  fs.writeFileSync(path.join(a, "routines", "headache", "settings.json"), "a");
  assert.equal(commitHeadache(a, "x", "auto"), "pushed");
  fs.writeFileSync(path.join(b, "routines", "headache", "settings.json"), "b");
  assert.equal(commitHeadache(b, "x", "auto"), "push-failed");

  assert.equal(rebaseInProgress(b), false, "the sync's own stopped rebase was aborted");
  assert.equal(git(b, "show", "HEAD:routines/headache/settings.json").stdout, "b");
  assert.equal(workItems(b).length, 1, "the item stays for the next sync");
});

test("a rebase the person started by hand is never touched: the sync reports busy and leaves the entry on disk", () => {
  const mcDir = fs.mkdtempSync(path.join(os.tmpdir(), "hj-sync-rebase-"));
  git(mcDir, "init", "-q", "-b", "main");
  git(mcDir, "config", "user.email", "t@t"); git(mcDir, "config", "user.name", "t");
  fs.writeFileSync(path.join(mcDir, "AGENTS.md"), "x");
  fs.writeFileSync(path.join(mcDir, "conflict.txt"), "base\n");
  git(mcDir, "add", "."); git(mcDir, "commit", "-qm", "base");
  git(mcDir, "checkout", "-qb", "feature");
  fs.writeFileSync(path.join(mcDir, "conflict.txt"), "feature\n");
  git(mcDir, "commit", "-qam", "feature change");
  git(mcDir, "checkout", "-q", "main");
  fs.writeFileSync(path.join(mcDir, "conflict.txt"), "main\n");
  git(mcDir, "commit", "-qam", "main change");
  git(mcDir, "checkout", "-q", "feature");
  assert.notEqual(git(mcDir, "rebase", "main").status, 0, "the rebase must stop on a conflict for this test to mean anything");
  assert.equal(rebaseInProgress(mcDir), true);
  entry(mcDir, "x.md");

  assert.equal(commitHeadache(mcDir, "x", "auto", { rebaseWaitMs: 300 }), "busy");
  assert.equal(fs.existsSync(lockFile(mcDir)), false, "the lock is given back");
  assert.equal(rebaseInProgress(mcDir), true);
  assert.match(dirty(mcDir), /routines\/headache\//);
  assert.equal(workItems(mcDir).length, 1, "the item stays for the next sync");
});

test("a lock whose process is gone is taken over; one whose process still runs never is, however old", () => {
  const { mcDir } = repo();
  const dead = spawnSync(process.execPath, ["-e", ""]).pid;
  fs.writeFileSync(lockFile(mcDir), JSON.stringify({ pid: dead, host: os.hostname(), token: "died" }));
  entry(mcDir, "after-dead.md");
  assert.equal(commitHeadache(mcDir, "x", "auto"), "pushed");
  assert.equal(fs.existsSync(lockFile(mcDir)), false);

  liveLock(mcDir);
  const old = new Date(Date.now() - 24 * 3600000); fs.utimesSync(lockFile(mcDir), old, old);
  const before = fs.readFileSync(lockFile(mcDir), "utf8");
  entry(mcDir, "while-alive.md");
  assert.equal(commitHeadache(mcDir, "x", "auto"), "queued");
  assert.equal(fs.readFileSync(lockFile(mcDir), "utf8"), before, "the live sync's lock is left as it was");
  assert.match(dirty(mcDir), /while-alive\.md/);
  fs.rmSync(lockFile(mcDir));
  syncQueued(mcDir);
  assert.equal(dirty(mcDir), "");
});

test("a rebase another program is running only delays the sync", async () => {
  const { mcDir, remote } = repo();
  entry(mcDir, "during-rebase.md");
  const rebaseDir = gitPath(mcDir, "rebase-merge");
  fs.mkdirSync(rebaseDir);
  const done = syncInChild(mcDir);
  await sleep(1500);
  assert.match(dirty(mcDir), /during-rebase\.md/, "nothing is committed while a rebase runs");
  fs.rmSync(rebaseDir, { recursive: true });
  assert.equal(await done, "pushed");
  assert.ok(has(remote, "routines/headache/during-rebase.md"));
});

test("an entry with no work item of its own goes out with the next save in its folder", () => {
  const { mcDir, remote } = repo();
  entry(mcDir, "itemless.md");
  entry(mcDir, "saved.md");
  assert.equal(commitHeadache(mcDir, "headache: saved", "auto"), "pushed");
  assert.ok(has(remote, "routines/headache/itemless.md")); assert.ok(has(remote, "routines/headache/saved.md"));
});

test("a push refused because another machine pushed first is pulled and pushed again", () => {
  const { mcDir, remote } = repo();
  const other = clone(remote, path.join(path.dirname(mcDir), "other"));
  // The other machine pushes just before this one does, once: the first push from here is refused.
  const o = other.replace(/\\/g, "/");
  hook(mcDir, "pre-push", `unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX\nif [ ! -f "${o}/raced" ]; then echo x > "${o}/raced"; git -C "${o}" add raced; git -C "${o}" commit -qm race; git -C "${o}" push -q; fi\nexit 0`);
  entry(mcDir, "raced-entry.md");
  assert.equal(commitHeadache(mcDir, "headache: raced", "auto"), "pushed");
  assert.ok(has(remote, "routines/headache/raced-entry.md")); assert.ok(has(remote, "raced"));
});

test("a commit an earlier push could not send goes out with the next sync, even with nothing new", () => {
  const { mcDir, remote } = repo();
  entry(mcDir, "kept-local.md");
  assert.equal(commitHeadache(mcDir, "x", "commit"), "committed");
  assert.ok(!has(remote, "routines/headache/kept-local.md"));
  assert.equal(commitHeadache(mcDir, "x", "auto"), "pushed");
  assert.ok(has(remote, "routines/headache/kept-local.md"));
  assert.equal(commitHeadache(mcDir, "x", "auto"), "nothing");
});

// Finding: a save must leave a durable record before anything else can go wrong.
test("a save writes its work item before the background sync starts", async () => {
  const { mcDir, remote } = repo();
  liveLock(mcDir); // the background sync finds the lock taken and leaves at once
  entry(mcDir, "saved.md");
  syncInBackground(mcDir, "headache: saved", "auto");
  const [name] = workItems(mcDir);
  assert.ok(name, "the item is there when the save returns");
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(itemsDir(mcDir), name), "utf8")), { folder: "routines/headache", mode: "auto", message: "headache: saved" });
  fs.rmSync(lockFile(mcDir));
  syncQueued(mcDir); // or the background sync, whichever takes the lock first
  assert.ok(await until(() => has(remote, "routines/headache/saved.md") && workItems(mcDir).length === 0));
});

// Finding: saves arriving while another sync holds the lock for long are committed by it.
test("saves that arrive while another sync holds the lock for long are committed by it, another add-on's included", async () => {
  const { mcDir, remote } = repo();
  const push = holdPush(mcDir);
  entry(mcDir, "first.md");
  const done = syncInChild(mcDir);
  assert.ok(await until(push.pushing), "the first sync is pushing, and holds the lock");
  entry(mcDir, "second.md");
  assert.equal(commitHeadache(mcDir, "headache: second", "auto"), "queued");
  entry(mcDir, "entry.md", OTHER);
  assert.equal(commitFolder(mcDir, OTHER, "other: entry", "auto"), "queued");
  push.release();
  assert.equal(await done, "pushed");
  for (const file of ["routines/headache/first.md", "routines/headache/second.md", `${OTHER}/entry.md`]) assert.ok(has(remote, file), file);
  assert.match(git(remote, "log", "--format=%s", "main").stdout, /^other: entry$/m, "each add-on's folder is committed on its own");
  assert.equal(git(mcDir, "status", "--porcelain", "-uall").stdout.trim(), "");
  assert.deepEqual(workItems(mcDir), []);
  assert.equal(fs.existsSync(lockFile(mcDir)), false);
});

test("an entry no try could commit (git's index locked throughout) stays, and the next sync of any add-on commits it", () => {
  const { mcDir, remote } = repo();
  const indexLock = gitPath(mcDir, "index.lock");
  entry(mcDir, "stuck.md");
  fs.writeFileSync(indexLock, "");
  assert.equal(commitHeadache(mcDir, "headache: stuck", "auto", { pauses: [20, 20] }), "commit-failed");
  const left = workItems(mcDir);
  assert.equal(left.length, 1);
  assert.equal(JSON.parse(fs.readFileSync(path.join(itemsDir(mcDir), left[0]), "utf8")).folder, "routines/headache");
  fs.rmSync(indexLock);
  assert.equal(commitFolder(mcDir, OTHER, "other: nothing new", "auto"), "nothing");
  assert.ok(has(remote, "routines/headache/stuck.md"));
  assert.deepEqual(workItems(mcDir), []);
});

test("the tick's pull takes its turn too, and commits what is waiting", () => {
  const { mcDir, remote } = repo();
  liveLock(mcDir);
  entry(mcDir, "queued.md");
  assert.equal(commitHeadache(mcDir, "headache: queued", "auto"), "queued");
  fs.rmSync(lockFile(mcDir)); // that sync ended without looking at the items (it was killed)
  pullQuietly(mcDir, "auto");
  assert.ok(has(remote, "routines/headache/queued.md"));
  assert.deepEqual(workItems(mcDir), []);
});

// Finding: a holder must stop as soon as the lock is no longer its own.
test("a sync stops at its next git step once the lock is no longer its own, and leaves the rest waiting", async () => {
  const { mcDir, remote } = repo();
  const push = holdPush(mcDir);
  entry(mcDir, "first.md");
  const done = syncInChild(mcDir);
  assert.ok(await until(push.pushing));
  entry(mcDir, "second.md");
  assert.equal(commitHeadache(mcDir, "headache: second", "auto"), "queued");
  liveLock(mcDir); // the lock is replaced while that sync is in its push
  push.release();
  assert.equal(await done, "pushed", "its own push finishes");
  assert.ok(!has(remote, "routines/headache/second.md"), "but it starts nothing more");
  assert.equal(workItems(mcDir).length, 1);
  fs.rmSync(lockFile(mcDir));
  syncQueued(mcDir);
  assert.ok(has(remote, "routines/headache/second.md"));
});

// Finding: only the add-ons' own folders are ever committed.
test("only the journal's, the coach's and the headache tracker's folders are committed, whatever an item names", () => {
  const { mcDir, remote } = repo();
  fs.mkdirSync(itemsDir(mcDir), { recursive: true });
  for (const [i, folder] of [".", "", "..", "notes", "routines"].entries()) fs.writeFileSync(path.join(itemsDir(mcDir), `000-bogus-${i}.json`), JSON.stringify({ folder, mode: "auto", message: "bogus" }));
  fs.writeFileSync(path.join(mcDir, "private.md"), "mine");
  fs.mkdirSync(path.join(mcDir, "notes")); fs.writeFileSync(path.join(mcDir, "notes", "n.md"), "mine");
  entry(mcDir, "real.md");
  assert.equal(commitHeadache(mcDir, "headache: real", "auto"), "pushed");
  assert.ok(has(remote, "routines/headache/real.md"));
  assert.ok(!has(remote, "private.md")); assert.ok(!has(remote, "notes/n.md"));
  assert.doesNotMatch(git(remote, "log", "--format=%s", "main").stdout, /bogus/);
  assert.equal(commitFolder(mcDir, ".", "x", "auto"), "off");
});

test("a folder that does not exist is skipped, never committed as a deletion", () => {
  const { mcDir, remote } = repo();
  entry(mcDir, "kept.md");
  assert.equal(commitHeadache(mcDir, "headache: kept", "auto"), "pushed");
  fs.rmSync(path.join(mcDir, "routines", "headache"), { recursive: true });
  assert.equal(commitHeadache(mcDir, "headache: gone", "auto"), "nothing");
  assert.ok(has(remote, "routines/headache/kept.md"));
  assert.match(git(mcDir, "ls-tree", "-r", "--name-only", "HEAD").stdout, /routines\/headache\/kept\.md/);
});

// Finding: a rebase is aborted only when it is provably the sync's own.
test("a rebase the person starts onto the same upstream, from the same HEAD, while a sync pulls, is left alone", () => {
  const { mcDir, remote } = repo();
  fs.writeFileSync(path.join(mcDir, "conflict.txt"), "base\n"); git(mcDir, "add", "."); git(mcDir, "commit", "-qm", "base"); git(mcDir, "push", "-q");
  const other = clone(remote, path.join(path.dirname(mcDir), "other"));
  fs.writeFileSync(path.join(other, "conflict.txt"), "theirs\n"); git(other, "commit", "-qam", "theirs"); git(other, "push", "-q");
  fs.writeFileSync(path.join(mcDir, "conflict.txt"), "mine\n"); git(mcDir, "commit", "-qam", "mine");
  const head = git(mcDir, "rev-parse", "HEAD").stdout.trim();
  // The person runs `git rebase origin/main` after the sync fetched and just before its own rebase:
  // the same upstream, from the same HEAD, so onto and orig-head cannot tell the two apart.
  let theirs = null;
  const run = (args, timeout, env) => {
    if (args[0] === "rebase" && args.includes("--autostash")) {
      assert.notEqual(git(mcDir, "rebase", "origin/main").status, 0, "the person's rebase stops on a conflict");
      const dir = gitPath(mcDir, "rebase-merge"), read = (f) => fs.readFileSync(path.join(dir, f), "utf8").trim();
      theirs = { onto: read("onto"), origHead: read("orig-head") };
    }
    return spawnSync("git", ["-C", mcDir, ...args], { encoding: "utf8", timeout, env: env && { ...process.env, ...env } });
  };
  assert.equal(pullRebase(mcDir, run), false);
  assert.deepEqual(theirs, { onto: git(mcDir, "rev-parse", "origin/main").stdout.trim(), origHead: head }, "the person's rebase looks exactly like the sync's would");
  assert.equal(rebaseInProgress(mcDir), true, "the person's rebase is still there");
  assert.equal(git(mcDir, "rebase", "--abort").status, 0, "and it is still the person's to finish or abort");
});
