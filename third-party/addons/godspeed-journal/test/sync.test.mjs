import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
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

  assert.equal(commitJournal(mcDir, "x", "auto"), "busy");
  assert.equal(rebaseInProgress(mcDir), true);
  assert.match(git(mcDir, "status", "--porcelain", "-uall", "routines/journal").stdout, /routines\/journal\//);
  assert.ok(fs.existsSync(path.join(mcDir, "routines", "journal", "x.md")));
});
