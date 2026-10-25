import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { commitJournal, rebaseInProgress } from "../lib/sync.mjs";

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

const BIN = fileURLToPath(new URL("../bin/godspeed-journal.mjs", import.meta.url));
const SYNC = pathToFileURL(fileURLToPath(new URL("../lib/sync.mjs", import.meta.url))).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gitPath = (mcDir, name) => path.resolve(mcDir, git(mcDir, "rev-parse", "--git-path", name).stdout.trim());
const lockFile = (mcDir) => gitPath(mcDir, "godspeed-addons-sync.lock");
const journalDirty = (mcDir) => git(mcDir, "status", "--porcelain", "-uall", "--", "routines/journal").stdout.trim();
const remoteFiles = (remote) => git(remote, "ls-tree", "-r", "--name-only", "main").stdout;
function entry(mcDir, name) {
  fs.mkdirSync(path.join(mcDir, "routines", "journal"), { recursive: true });
  fs.writeFileSync(path.join(mcDir, "routines", "journal", name), name);
}
// commitJournal in a process of its own, the way the background sync runs it.
function syncInChild(mcDir) {
  const code = `import { commitJournal } from ${JSON.stringify(SYNC)}; console.log(commitJournal(${JSON.stringify(mcDir)}, "journal: child", "auto"));`;
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

test("commits and pushes journal files only, leaving other staged work alone", () => {
  const { mcDir, remote } = repo();
  fs.writeFileSync(path.join(mcDir, "other.md"), "mine"); git(mcDir, "add", "other.md");
  fs.mkdirSync(path.join(mcDir, "routines", "journal"), { recursive: true }); fs.writeFileSync(path.join(mcDir, "routines", "journal", "a.md"), "entry");
  assert.equal(commitJournal(mcDir, "journal: note", "auto"), "pushed");
  const files = git(remote, "show", "--name-only", "--format=", "main").stdout.trim();
  assert.equal(files, "routines/journal/a.md");
  assert.match(git(mcDir, "diff", "--cached", "--name-only").stdout, /other\.md/);
});

test("nothing to commit, commit-only mode, and off", () => {
  const { mcDir } = repo();
  assert.equal(commitJournal(mcDir, "x", "auto"), "nothing");
  fs.mkdirSync(path.join(mcDir, "routines", "journal"), { recursive: true }); fs.writeFileSync(path.join(mcDir, "routines", "journal", "b.md"), "b");
  assert.equal(commitJournal(mcDir, "x", "off"), "off");
  assert.equal(commitJournal(mcDir, "x", "commit"), "committed");
});

test("a folder that is not a git repo is fine", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hj-nogit-"));
  assert.equal(commitJournal(d, "x", "auto"), "off");
});

test("a conflicting pull aborts cleanly and leaves the entry safe locally", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hj-sync-conflict-"));
  const remote = path.join(root, "remote.git");
  git(root, "init", "--bare", "-b", "main", remote);
  const seed = path.join(root, "seed");
  git(root, "clone", remote, seed);
  git(seed, "config", "user.email", "t@t"); git(seed, "config", "user.name", "t");
  fs.writeFileSync(path.join(seed, "AGENTS.md"), "x");
  fs.mkdirSync(path.join(seed, "routines", "journal"), { recursive: true });
  fs.writeFileSync(path.join(seed, "routines", "journal", "settings.json"), "seed");
  git(seed, "add", "."); git(seed, "commit", "-m", "init"); git(seed, "push", "-u", "origin", "main");

  const a = path.join(root, "a"); const b = path.join(root, "b");
  git(root, "clone", remote, a); git(a, "config", "user.email", "t@t"); git(a, "config", "user.name", "t");
  git(root, "clone", remote, b); git(b, "config", "user.email", "t@t"); git(b, "config", "user.name", "t");

  fs.writeFileSync(path.join(a, "routines", "journal", "settings.json"), "a");
  assert.equal(commitJournal(a, "x", "auto"), "pushed");

  fs.writeFileSync(path.join(b, "routines", "journal", "settings.json"), "b");
  assert.equal(commitJournal(b, "x", "auto"), "push-failed");

  const rebaseDir = git(b, "rev-parse", "--git-path", "rebase-merge").stdout.trim();
  assert.equal(fs.existsSync(path.join(b, rebaseDir)), false);
  assert.notEqual(git(b, "rebase", "--abort").status, 0);
  assert.equal(git(b, "show", "HEAD:routines/journal/settings.json").stdout, "b");
});

test("a rebase the person started by hand is never touched: commitJournal reports busy and leaves the entry on disk", () => {
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

  fs.mkdirSync(path.join(mcDir, "routines", "journal"), { recursive: true });
  fs.writeFileSync(path.join(mcDir, "routines", "journal", "x.md"), "entry");

  assert.equal(commitJournal(mcDir, "x", "auto", { rebaseWaitMs: 300 }), "busy");
  assert.equal(fs.existsSync(lockFile(mcDir)), false, "the lock is given back");
  assert.equal(rebaseInProgress(mcDir), true);
  assert.match(git(mcDir, "status", "--porcelain", "-uall", "routines/journal").stdout, /routines\/journal\//);
  assert.ok(fs.existsSync(path.join(mcDir, "routines", "journal", "x.md")));
});

// Several saves in quick succession each start a sync in the background, while something else
// holds git's index (the first sync's pull, or another job committing in the same folder). Until
// 0.4.7 every sync that met that gave up at once and nothing tried again, so the entries stayed on
// disk and no other machine saw them: a task finished here still looked open to the machine that
// sends the check-ins, and it asked about it hours later.
test("a burst of saves while git's index is busy: every entry is committed and pushed", async () => {
  const { mcDir, remote } = repo();
  fs.mkdirSync(path.join(mcDir, "routines", "journal"), { recursive: true });
  fs.writeFileSync(path.join(mcDir, "routines", "journal", "settings.json"), JSON.stringify({ timezone: "Europe/Berlin", git_sync: "auto" }));
  git(mcDir, "add", "."); git(mcDir, "commit", "-qm", "settings"); git(mcDir, "push", "-q");
  const env = { ...process.env }; delete env.GODSPEED_JOURNAL_GIT_SYNC; delete env.GODSPEED_JOURNAL_DIR;
  const say = (now, ...a) => spawnSync(process.execPath, [BIN, ...a, "--godspeed", mcDir], { encoding: "utf8", env: { ...env, GODSPEED_NOW: now } });
  const indexLock = gitPath(mcDir, "index.lock");
  fs.writeFileSync(indexLock, "");
  for (const r of [
    say("2026-10-24T23:57:41.100Z", "start", "Write the invoice"),
    say("2026-10-24T23:57:41.300Z", "done", "invoice"),
    say("2026-10-24T23:57:41.500Z", "start", "Edit the video"),
    say("2026-10-24T23:57:41.700Z", "done", "video", "--words", "done, back now"),
    say("2026-10-24T23:57:41.900Z", "note", "that was the last one today"),
  ]) assert.equal(r.status, 0, r.stderr);
  const entries = () => remoteFiles(remote).split("\n").filter((f) => f.startsWith("routines/journal/entries/"));
  assert.equal(fs.readdirSync(path.join(mcDir, "routines", "journal", "entries"), { recursive: true }).filter((f) => f.endsWith(".md")).length, 5);
  await sleep(2500);
  fs.rmSync(indexLock, { force: true });
  assert.ok(await until(() => !journalDirty(mcDir) && entries().length === 5 && !fs.existsSync(lockFile(mcDir))),
    `left behind: ${journalDirty(mcDir) || "nothing"}; pushed: ${entries().length} of 5`);
});

test("a sync that finds another one running waits for it instead of giving up", async () => {
  const { mcDir, remote } = repo();
  entry(mcDir, "waits.md");
  fs.writeFileSync(lockFile(mcDir), JSON.stringify({ pid: process.pid, host: os.hostname(), token: "the-other-sync" }));
  const done = syncInChild(mcDir);
  await sleep(1500);
  assert.match(journalDirty(mcDir), /waits\.md/, "nothing is committed while the other sync holds the lock");
  fs.rmSync(lockFile(mcDir));
  assert.equal(await done, "pushed");
  assert.equal(journalDirty(mcDir), "");
  assert.match(remoteFiles(remote), /routines\/journal\/waits\.md/);
  assert.equal(fs.existsSync(lockFile(mcDir)), false);
});

test("a lock left by a sync that died, or one nobody has touched for too long, is taken over", () => {
  const { mcDir } = repo();
  const dead = spawnSync(process.execPath, ["-e", ""]).pid;
  fs.writeFileSync(lockFile(mcDir), JSON.stringify({ pid: dead, host: os.hostname(), token: "died" }));
  entry(mcDir, "after-dead.md");
  assert.equal(commitJournal(mcDir, "x", "auto"), "pushed");
  assert.equal(fs.existsSync(lockFile(mcDir)), false);

  fs.writeFileSync(lockFile(mcDir), JSON.stringify({ pid: process.pid, host: os.hostname(), token: "hung" }));
  const old = new Date(Date.now() - 60 * 60000); fs.utimesSync(lockFile(mcDir), old, old);
  entry(mcDir, "after-hung.md");
  assert.equal(commitJournal(mcDir, "x", "auto"), "pushed");
  assert.equal(journalDirty(mcDir), "");
});

test("a rebase another program is running only delays the sync", async () => {
  const { mcDir, remote } = repo();
  entry(mcDir, "during-rebase.md");
  const rebaseDir = gitPath(mcDir, "rebase-merge");
  fs.mkdirSync(rebaseDir);
  const done = syncInChild(mcDir);
  await sleep(1500);
  assert.match(journalDirty(mcDir), /during-rebase\.md/, "nothing is committed while a rebase runs");
  fs.rmSync(rebaseDir, { recursive: true });
  assert.equal(await done, "pushed");
  assert.match(remoteFiles(remote), /during-rebase\.md/);
});

test("an entry saved while the sync is at work goes out in the same run", () => {
  const { mcDir, remote } = repo();
  // Saves one more entry right after the first commit, the way a save whose own sync never ran
  // would leave it.
  hook(mcDir, "post-commit", "[ -f routines/journal/late.md ] || echo late > routines/journal/late.md");
  entry(mcDir, "first.md");
  assert.equal(commitJournal(mcDir, "journal: first", "auto"), "pushed");
  assert.equal(journalDirty(mcDir), "");
  assert.match(remoteFiles(remote), /routines\/journal\/first\.md/);
  assert.match(remoteFiles(remote), /routines\/journal\/late\.md/);
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
  assert.equal(commitJournal(mcDir, "journal: raced", "auto"), "pushed");
  assert.match(remoteFiles(remote), /raced-entry\.md/);
  assert.match(remoteFiles(remote), /^raced$/m);
});

test("a journal commit an earlier push could not send goes out with the next sync, even with nothing new", () => {
  const { mcDir, remote } = repo();
  entry(mcDir, "kept-local.md");
  assert.equal(commitJournal(mcDir, "x", "commit"), "committed");
  assert.doesNotMatch(remoteFiles(remote), /kept-local/);
  assert.equal(commitJournal(mcDir, "x", "auto"), "pushed");
  assert.match(remoteFiles(remote), /kept-local\.md/);
  assert.equal(commitJournal(mcDir, "x", "auto"), "nothing");
});
