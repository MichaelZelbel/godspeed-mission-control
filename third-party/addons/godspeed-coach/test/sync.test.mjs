import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { commitCoach, commitFolder, pullQuietly, pullRebase, rebaseInProgress } from "../lib/sync.mjs";

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

const SYNC = pathToFileURL(fileURLToPath(new URL("../lib/sync.mjs", import.meta.url))).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gitPath = (mcDir, name) => path.resolve(mcDir, git(mcDir, "rev-parse", "--git-path", name).stdout.trim());
const lockFile = (mcDir) => gitPath(mcDir, "godspeed-addons-sync.lock");
const queueFiles = (mcDir) => { try { return fs.readdirSync(gitPath(mcDir, "godspeed-addons-sync.queue")).filter((n) => !n.startsWith(".")); } catch { return []; } };
const dirty = (mcDir) => git(mcDir, "status", "--porcelain", "-uall", "--", "coach").stdout.trim();
const remoteFiles = (remote) => git(remote, "ls-tree", "-r", "--name-only", "main").stdout;
// Another add-on's folder beside this one's: they share the lock and the queue.
const OTHER = "routines/other-addon";
const has = (remote, file) => remoteFiles(remote).split(/\r?\n/).includes(file);
function entry(mcDir, name) {
  fs.mkdirSync(path.join(mcDir, "coach"), { recursive: true });
  fs.writeFileSync(path.join(mcDir, "coach", name), name);
}
// commitCoach in a process of its own, the way the background sync runs it.
function syncInChild(mcDir) {
  const code = `import { commitCoach } from ${JSON.stringify(SYNC)}; console.log(commitCoach(${JSON.stringify(mcDir)}, "coach: child", "auto"));`;
  const child = spawn(process.execPath, ["--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "inherit"] });
  let out = ""; child.stdout.on("data", (d) => { out += d; });
  return new Promise((resolve) => child.on("exit", () => resolve(out.trim())));
}
async function until(check, ms = 90000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) if (check()) return true;
  return check();
}
function hook(mcDir, name, body) {
  const file = path.join(gitPath(mcDir, "hooks"), name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
}

test("commits and pushes coach files only, leaving other staged work alone", () => {
  const { mcDir, remote } = repo();
  fs.writeFileSync(path.join(mcDir, "other.md"), "mine"); git(mcDir, "add", "other.md");
  fs.mkdirSync(path.join(mcDir, "coach"), { recursive: true }); fs.writeFileSync(path.join(mcDir, "coach", "a.md"), "entry");
  assert.equal(commitCoach(mcDir, "coach: note", "auto"), "pushed");
  const files = git(remote, "show", "--name-only", "--format=", "main").stdout.trim();
  assert.equal(files, "coach/a.md");
  assert.match(git(mcDir, "diff", "--cached", "--name-only").stdout, /other\.md/);
});

test("nothing to commit, commit-only mode, and off", () => {
  const { mcDir } = repo();
  assert.equal(commitCoach(mcDir, "x", "auto"), "nothing");
  fs.mkdirSync(path.join(mcDir, "coach"), { recursive: true }); fs.writeFileSync(path.join(mcDir, "coach", "b.md"), "b");
  assert.equal(commitCoach(mcDir, "x", "off"), "off");
  assert.equal(commitCoach(mcDir, "x", "commit"), "committed");
});

test("a folder that is not a git repo is fine", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hj-nogit-"));
  assert.equal(commitCoach(d, "x", "auto"), "off");
});

test("a conflicting pull aborts cleanly and leaves the entry safe locally", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hj-sync-conflict-"));
  const remote = path.join(root, "remote.git");
  git(root, "init", "--bare", "-b", "main", remote);
  const seed = path.join(root, "seed");
  git(root, "clone", remote, seed);
  git(seed, "config", "user.email", "t@t"); git(seed, "config", "user.name", "t");
  fs.writeFileSync(path.join(seed, "AGENTS.md"), "x");
  fs.mkdirSync(path.join(seed, "coach"), { recursive: true });
  fs.writeFileSync(path.join(seed, "coach", "settings.json"), "seed");
  git(seed, "add", "."); git(seed, "commit", "-m", "init"); git(seed, "push", "-u", "origin", "main");

  const a = path.join(root, "a"); const b = path.join(root, "b");
  git(root, "clone", remote, a); git(a, "config", "user.email", "t@t"); git(a, "config", "user.name", "t");
  git(root, "clone", remote, b); git(b, "config", "user.email", "t@t"); git(b, "config", "user.name", "t");

  fs.writeFileSync(path.join(a, "coach", "settings.json"), "a");
  assert.equal(commitCoach(a, "x", "auto"), "pushed");

  fs.writeFileSync(path.join(b, "coach", "settings.json"), "b");
  assert.equal(commitCoach(b, "x", "auto"), "push-failed");

  const rebaseDir = git(b, "rev-parse", "--git-path", "rebase-merge").stdout.trim();
  assert.equal(fs.existsSync(path.join(b, rebaseDir)), false);
  assert.notEqual(git(b, "rebase", "--abort").status, 0);
  assert.equal(git(b, "show", "HEAD:coach/settings.json").stdout, "b");
});

test("a rebase the person started by hand is never touched: commitCoach reports busy and leaves the entry on disk", () => {
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
  const rebase = git(mcDir, "rebase", "main");
  assert.notEqual(rebase.status, 0, "the rebase must stop on a conflict for this test to mean anything");
  assert.equal(rebaseInProgress(mcDir), true);

  fs.mkdirSync(path.join(mcDir, "coach"), { recursive: true });
  fs.writeFileSync(path.join(mcDir, "coach", "x.md"), "entry");

  assert.equal(commitCoach(mcDir, "x", "auto", { rebaseWaitMs: 300 }), "busy");
  assert.equal(fs.existsSync(lockFile(mcDir)), false, "the lock is given back");
  assert.equal(rebaseInProgress(mcDir), true);
  assert.match(git(mcDir, "status", "--porcelain", "-uall", "coach").stdout, /coach\//);
  assert.ok(fs.existsSync(path.join(mcDir, "coach", "x.md")));
});

test("a lock left by a sync that died, or one nobody has touched for too long, is taken over", () => {
  const { mcDir } = repo();
  const dead = spawnSync(process.execPath, ["-e", ""]).pid;
  fs.writeFileSync(lockFile(mcDir), JSON.stringify({ pid: dead, host: os.hostname(), token: "died" }));
  entry(mcDir, "after-dead.md");
  assert.equal(commitCoach(mcDir, "x", "auto"), "pushed");
  assert.equal(fs.existsSync(lockFile(mcDir)), false);

  fs.writeFileSync(lockFile(mcDir), JSON.stringify({ pid: process.pid, host: os.hostname(), token: "hung" }));
  const old = new Date(Date.now() - 60 * 60000); fs.utimesSync(lockFile(mcDir), old, old);
  entry(mcDir, "after-hung.md");
  assert.equal(commitCoach(mcDir, "x", "auto"), "pushed");
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
  assert.match(remoteFiles(remote), /during-rebase\.md/);
});

test("a save made while the sync is at work goes out in the same run", () => {
  const { mcDir, remote } = repo();
  // Saves one more entry right after the first commit, the way a save whose own sync never ran
  // would leave it.
  hook(mcDir, "post-commit", "[ -f coach/late.md ] || echo late > coach/late.md");
  entry(mcDir, "first.md");
  assert.equal(commitCoach(mcDir, "coach: first", "auto"), "pushed");
  assert.equal(dirty(mcDir), "");
  assert.match(remoteFiles(remote), /coach\/first\.md/);
  assert.match(remoteFiles(remote), /coach\/late\.md/);
});

test("a push refused because another machine pushed first is pulled and pushed again", () => {
  const { mcDir, remote } = repo();
  const other = path.join(path.dirname(mcDir), "other");
  git(path.dirname(mcDir), "clone", "-q", remote, other);
  git(other, "config", "user.email", "o@o"); git(other, "config", "user.name", "o");
  // The other machine pushes just before this one does, once: the first push from here is refused.
  const o = other.replace(/\\/g, "/");
  hook(mcDir, "pre-push", `unset GIT_DIR GIT_WORK_TREE GIT_INDEX_FILE GIT_PREFIX\nif [ ! -f "${o}/raced" ]; then echo x > "${o}/raced"; git -C "${o}" add raced; git -C "${o}" commit -qm race; git -C "${o}" push -q; fi\nexit 0`);
  entry(mcDir, "raced-entry.md");
  assert.equal(commitCoach(mcDir, "coach: raced", "auto"), "pushed");
  assert.match(remoteFiles(remote), /raced-entry\.md/);
  assert.match(remoteFiles(remote), /^raced$/m);
});

test("a commit an earlier push could not send goes out with the next sync, even with nothing new", () => {
  const { mcDir, remote } = repo();
  entry(mcDir, "kept-local.md");
  assert.equal(commitCoach(mcDir, "x", "commit"), "committed");
  assert.doesNotMatch(remoteFiles(remote), /kept-local/);
  assert.equal(commitCoach(mcDir, "x", "auto"), "pushed");
  assert.match(remoteFiles(remote), /kept-local\.md/);
  assert.equal(commitCoach(mcDir, "x", "auto"), "nothing");
});

// A sync that finds the lock taken queues its folder and leaves; the sync holding the lock commits
// it, for any add-on, however long it holds the lock (here its push is held until the test lets go).
test("saves that arrive while another sync holds the lock for long are committed by it, another add-on's included", async () => {
  const { mcDir, remote } = repo();
  const f = (p) => p.replace(/\\/g, "/");
  const pushing = path.join(path.dirname(mcDir), "pushing"), held = path.join(path.dirname(mcDir), "held");
  fs.writeFileSync(held, "");
  hook(mcDir, "pre-push", `touch "${f(pushing)}"\nwhile [ -f "${f(held)}" ]; do sleep 0.1; done\nexit 0`);
  entry(mcDir, "first.md");
  const done = syncInChild(mcDir);
  assert.ok(await until(() => fs.existsSync(pushing)), "the first sync is pushing, and holds the lock");
  entry(mcDir, "second.md");
  assert.equal(commitCoach(mcDir, "coach: second", "auto"), "queued");
  fs.mkdirSync(path.join(mcDir, OTHER), { recursive: true }); fs.writeFileSync(path.join(mcDir, OTHER, "entry.md"), "x");
  assert.equal(commitFolder(mcDir, OTHER, "other: entry", "auto"), "queued");
  fs.rmSync(held);
  assert.equal(await done, "pushed");
  for (const file of ["coach/first.md", "coach/second.md", `${OTHER}/entry.md`]) assert.ok(has(remote, file), file);
  assert.match(git(remote, "log", "--format=%s", "main").stdout, /^other: entry$/m, "each add-on's folder is committed on its own");
  assert.equal(git(mcDir, "status", "--porcelain", "-uall").stdout.trim(), "");
  assert.deepEqual(queueFiles(mcDir), []);
  assert.equal(fs.existsSync(lockFile(mcDir)), false);
});

test("an entry no try could commit (git's index locked throughout) stays queued, and the next sync of any add-on commits it", () => {
  const { mcDir, remote } = repo();
  const indexLock = gitPath(mcDir, "index.lock");
  entry(mcDir, "stuck.md");
  fs.writeFileSync(indexLock, "");
  assert.equal(commitCoach(mcDir, "coach: stuck", "auto", { pauses: [20, 20] }), "commit-failed");
  assert.deepEqual(queueFiles(mcDir), [encodeURIComponent("coach")]);
  fs.rmSync(indexLock);
  assert.equal(commitFolder(mcDir, OTHER, "other: nothing new", "auto"), "nothing");
  assert.ok(has(remote, "coach/stuck.md"));
  assert.deepEqual(queueFiles(mcDir), []);
});

test("the tick's pull takes its turn too, and commits what was queued meanwhile", () => {
  const { mcDir, remote } = repo();
  fs.writeFileSync(lockFile(mcDir), JSON.stringify({ pid: process.pid, host: os.hostname(), token: "another sync" }));
  entry(mcDir, "queued.md");
  assert.equal(commitCoach(mcDir, "coach: queued", "auto"), "queued");
  fs.rmSync(lockFile(mcDir)); // that sync ended without looking at the queue (it was killed)
  pullQuietly(mcDir, "auto");
  assert.ok(has(remote, "coach/queued.md"));
  assert.deepEqual(queueFiles(mcDir), []);
});

test("a rebase the person starts while a sync pulls is left alone: a sync aborts only its own", () => {
  const { mcDir, remote } = repo();
  const other = path.join(path.dirname(mcDir), "other");
  git(path.dirname(mcDir), "clone", "-q", remote, other);
  git(other, "config", "user.email", "o@o"); git(other, "config", "user.name", "o");
  fs.writeFileSync(path.join(other, "theirs.md"), "x"); git(other, "add", "."); git(other, "commit", "-qm", "theirs"); git(other, "push", "-q");
  // Local work the person is about to rebase, and a branch it will stop on with a conflict.
  fs.writeFileSync(path.join(mcDir, "conflict.txt"), "base\n"); git(mcDir, "add", "."); git(mcDir, "commit", "-qm", "base");
  git(mcDir, "checkout", "-qb", "side"); fs.writeFileSync(path.join(mcDir, "conflict.txt"), "side\n"); git(mcDir, "commit", "-qam", "side");
  git(mcDir, "checkout", "-q", "main"); fs.writeFileSync(path.join(mcDir, "conflict.txt"), "main\n"); git(mcDir, "commit", "-qam", "main");
  // The person's rebase begins after the sync looked for one and fetched, just before its own rebase.
  let onto = null;
  const run = (args, timeout) => {
    if (args[0] === "rebase" && args[1] === "--autostash") {
      assert.notEqual(git(mcDir, "rebase", "side").status, 0, "the person's rebase stops on a conflict");
      onto = fs.readFileSync(path.join(gitPath(mcDir, "rebase-merge"), "onto"), "utf8");
    }
    return spawnSync("git", ["-C", mcDir, ...args], { encoding: "utf8", timeout });
  };
  assert.equal(pullRebase(mcDir, run), false);
  assert.ok(onto, "the person's rebase began in the window");
  assert.equal(rebaseInProgress(mcDir), true, "the person's rebase is still there");
  assert.equal(fs.readFileSync(path.join(gitPath(mcDir, "rebase-merge"), "onto"), "utf8"), onto);
  assert.equal(git(mcDir, "rebase", "--abort").status, 0, "and it is still the person's to finish or abort");
});
