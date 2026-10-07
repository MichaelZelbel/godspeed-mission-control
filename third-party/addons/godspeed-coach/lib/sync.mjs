// Entries reach the other machines through mission control's own git history. Only coach/ is ever
// staged or committed here, with an explicit pathspec, so a person's half-finished work in the
// same folder is never swept into a coach commit.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "godspeed-coach.mjs");
const g = (mcDir, args, timeout = 60000) => spawnSync("git", ["-C", mcDir, ...args], { encoding: "utf8", timeout, windowsHide: true });

// True when the person is in the middle of a rebase they started by hand (or one an earlier
// pull left stopped on a conflict). Nothing here may touch git state until they finish it.
export function rebaseInProgress(mcDir) {
  for (const which of ["rebase-merge", "rebase-apply"]) {
    const r = g(mcDir, ["rev-parse", "--git-path", which]);
    if (r.status !== 0) continue;
    const p = r.stdout.trim();
    if (p && fs.existsSync(path.join(mcDir, p))) return true;
  }
  return false;
}

export function commitCoach(mcDir, message, mode) {
  if (mode === "off" || !fs.existsSync(path.join(mcDir, ".git"))) return "off";
  if (rebaseInProgress(mcDir)) return "busy";
  g(mcDir, ["add", "--", "coach"]);
  if (g(mcDir, ["diff", "--cached", "--quiet", "--", "coach"]).status === 0) return "nothing";
  let c = g(mcDir, ["commit", "-m", message, "--", "coach"]);
  if (c.status !== 0) { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500); c = g(mcDir, ["commit", "-m", message, "--", "coach"]); }
  if (c.status !== 0) return "commit-failed";
  if (mode === "commit" || !g(mcDir, ["remote"]).stdout.trim()) return "committed";
  const pull = g(mcDir, ["pull", "--rebase", "--autostash", "-q"]);
  if (pull.status !== 0) { g(mcDir, ["rebase", "--abort"]); return "push-failed"; }
  return g(mcDir, ["push", "-q"], 300000).status === 0 ? "pushed" : "push-failed";
}

export function syncInBackground(mcDir, message, mode) {
  if (mode === "off") return;
  spawn(process.execPath, [BIN, "_sync", message, "--godspeed", mcDir], { detached: true, stdio: "ignore", windowsHide: true }).unref();
}

export function pullQuietly(mcDir, mode) {
  if (mode !== "auto" || !fs.existsSync(path.join(mcDir, ".git"))) return;
  if (rebaseInProgress(mcDir)) return;
  const pull = g(mcDir, ["pull", "--rebase", "--autostash", "-q"], 15000);
  if (pull.status !== 0) { g(mcDir, ["rebase", "--abort"]); return; }
}
