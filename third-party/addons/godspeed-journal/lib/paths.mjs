// Where mission control lives and where things get installed. Adapted from mc-video's lib.mjs so both
// add-ons answer "which folder?" the same way.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const MARKER = ".installed-by-godspeed-journal";
export const RECIPE = "interstitial-journal";

export function appHome() {
  return process.env.GODSPEED_JOURNAL_APP || path.join(os.homedir(), ".godspeed-journal");
}

export function findMissionControl({ arg, cwd = process.cwd(), userHome = os.homedir(), env = process.env } = {}) {
  const looksLikeMissionControl = (d) => d && fs.existsSync(path.join(d, "AGENTS.md"));
  if (arg) return looksLikeMissionControl(path.resolve(arg)) ? path.resolve(arg) : null;
  if (env.GODSPEED_JOURNAL_DIR) return looksLikeMissionControl(env.GODSPEED_JOURNAL_DIR) ? path.resolve(env.GODSPEED_JOURNAL_DIR) : null;
  const envFile = path.join(userHome, ".godspeed", "device.env");
  if (fs.existsSync(envFile)) {
    const m = fs.readFileSync(envFile, "utf8").match(/^\s*GODSPEED_DIR=(.+)$/m);
    if (m) {
      const d = m[1].trim().replace(/^["']|["']$/g, "");
      if (looksLikeMissionControl(d)) return d;
    }
  }
  if (looksLikeMissionControl(cwd)) return cwd;
  // The book's default folder: godspeed after the rename, godspeed before it.
  for (const name of ["godspeed", "godspeed"]) {
    const dflt = path.join(userHome, name);
    if (looksLikeMissionControl(dflt)) return dflt;
  }
  return null;
}

function countRecipes(dir) {
  try { return fs.readdirSync(dir).filter((n) => fs.existsSync(path.join(dir, n, "SKILL.md"))).length; }
  catch { return 0; }
}

export function skillsRoom(mcDir) {
  if (countRecipes(path.join(mcDir, "skills")) > 0) return path.join(mcDir, "skills");
  if (countRecipes(path.join(mcDir, ".claude", "skills")) > 0) return path.join(mcDir, ".claude", "skills");
  return path.join(mcDir, "skills");
}

export function mayReplace(dir) {
  if (!fs.existsSync(dir)) return true;
  return fs.existsSync(path.join(dir, MARKER));
}

export function binDir(userHome = os.homedir()) {
  const kit = path.join(userHome, ".godspeed", "bin");
  return fs.existsSync(kit) ? kit : path.join(userHome, ".local", "bin");
}

export function onPath(dir, envPath = process.env.PATH || "", platform = process.platform) {
  const sep = platform === "win32" ? ";" : ":";
  const norm = (p) => path.resolve(p).toLowerCase().replace(/[\\/]+$/, "");
  return envPath.split(sep).filter(Boolean).some((p) => norm(p) === norm(dir));
}

export function launchers(appDir, platform = process.platform) {
  const script = path.join(appDir, "bin", "godspeed-journal.mjs");
  const out = [{ name: "godspeed-journal", body: `#!/bin/sh\nexec node "${script.replace(/\\/g, "/")}" "$@"\n`, mode: 0o755 }];
  if (platform === "win32") out.push({ name: "godspeed-journal.cmd", body: `@echo off\r\nnode "${script}" %*\r\n`, mode: 0o644 });
  return out;
}

export function copyDir(src, dst, { skip = () => false } = {}) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip(e.name)) continue;
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d, { skip });
    else fs.copyFileSync(s, d);
  }
}
