// Several saves in quick succession each start a sync in the background, while something else
// holds git's index (the first sync's pull, or another job committing in the same folder). Until
// 0.3.2 every sync that met that gave up at once and nothing tried again, so the entries stayed on
// disk and no other machine saw them.
//
// Only the command is used here, never lib/sync.mjs directly, so this file runs against any version
// of it. Nothing waits on a clock: the index is released only once every background sync has
// started, every one still running holds the sync lock (none before 0.3.2 did, so then all of them
// have to have finished), and git's own trace shows a `git add` tried while the index was locked.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

const BIN = fileURLToPath(new URL("../bin/godspeed-headache.mjs", import.meta.url));
const FOLDER = "routines/headache";
const git = (cwd, ...a) => spawnSync("git", a, { cwd, encoding: "utf8" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return ""; } };
async function until(check, ms = 90000) {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) if (check()) return true;
  return check();
}

test("a burst of saves while git's index is busy: every entry is committed and pushed", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "gh-burst-"));
  const remote = path.join(root, "remote.git"), mcDir = path.join(root, "mc");
  git(root, "init", "-q", "--bare", "-b", "main", remote);
  git(root, "clone", "-q", remote, mcDir);
  git(mcDir, "config", "user.email", "t@t"); git(mcDir, "config", "user.name", "t");
  fs.writeFileSync(path.join(mcDir, "AGENTS.md"), "x");
  fs.mkdirSync(path.join(mcDir, FOLDER), { recursive: true });
  fs.writeFileSync(path.join(mcDir, FOLDER, "settings.json"), JSON.stringify({ timezone: "Europe/Berlin", git_sync: "auto" }));
  git(mcDir, "add", "."); git(mcDir, "commit", "-qm", "init"); git(mcDir, "push", "-q", "-u", "origin", "main");

  // Every background sync says when it starts and ends; git writes down every command it runs.
  const log = path.join(root, "syncs.log"), trace = path.join(root, "git-trace.log"), preload = path.join(root, "preload.mjs");
  fs.writeFileSync(preload, `import fs from "node:fs";\nif (process.argv.includes("_sync")) { const say = (w) => fs.appendFileSync(${JSON.stringify(log)}, w + " " + process.pid + "\\n"); say("start"); process.on("exit", () => say("exit")); }\n`);
  const env = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ""} --import=${pathToFileURL(preload).href}`.trim(), GIT_TRACE: trace };
  delete env.GODSPEED_HEADACHE_GIT_SYNC; delete env.GODSPEED_HEADACHE_DIR;
  const say = (now, ...a) => spawnSync(process.execPath, [BIN, ...a, "--godspeed", mcDir], { encoding: "utf8", env: { ...env, GODSPEED_NOW: now } });

  const indexLock = path.resolve(mcDir, git(mcDir, "rev-parse", "--git-path", "index.lock").stdout.trim());
  const syncLock = path.resolve(mcDir, git(mcDir, "rev-parse", "--git-path", "godspeed-addons-sync.lock").stdout.trim());
  fs.writeFileSync(indexLock, "");
  const saves = [
    say("2026-09-27T07:10:00Z", "start", "--at", "06:30", "--pain", "3", "--side", "right"),
    say("2026-09-27T07:10:01Z", "med", "Ibuprofen", "--dose", "400 mg"),
    say("2026-09-27T07:10:02Z", "set", "--pain", "5"),
    say("2026-09-27T07:10:03Z", "end", "--at", "07:00"),
  ];
  for (const r of saves) assert.equal(r.status, 0, r.stderr);

  const syncs = () => {
    const lines = read(log).split("\n").filter(Boolean).map((l) => l.split(" "));
    const started = lines.filter(([w]) => w === "start").map(([, p]) => p), ended = new Set(lines.filter(([w]) => w === "exit").map(([, p]) => p));
    return { started: started.length, running: started.filter((p) => !ended.has(p)) };
  };
  const holder = () => { try { return String(JSON.parse(read(syncLock)).pid); } catch { return null; } };
  const triedAdd = () => /built-in: git add\b/.test(read(trace));
  assert.ok(await until(() => { const s = syncs(); return s.started >= saves.length && s.running.every((p) => p === holder()) && triedAdd(); }),
    `before the index was released: ${JSON.stringify(syncs())}, lock holder ${holder()}, git add tried: ${triedAdd()}`);
  fs.rmSync(indexLock);

  assert.ok(await until(() => syncs().running.length === 0), "every background sync ends");
  assert.equal(git(mcDir, "status", "--porcelain", "-uall", "--", FOLDER).stdout.trim(), "", "nothing is left uncommitted");
  assert.equal(git(remote, "rev-parse", `main:${FOLDER}`).stdout, git(mcDir, "rev-parse", `HEAD:${FOLDER}`).stdout, "every entry reached the other machines");
});
