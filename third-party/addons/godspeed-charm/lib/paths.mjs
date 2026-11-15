// Where mission control lives and where things get installed. Adapted from the headache add-on's paths.mjs so both
// add-ons answer "which folder?" the same way.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const MARKER = ".installed-by-godspeed-charm";
export const RECIPE = "charm-challenge";

export function appHome() {
  return process.env.GODSPEED_CHARM_APP || path.join(os.homedir(), ".godspeed-charm");
}

export function findMissionControl({ arg, cwd = process.cwd(), userHome = os.homedir(), env = process.env } = {}) {
  const looksLikeMissionControl = (d) => d && fs.existsSync(path.join(d, "AGENTS.md"));
  if (arg) return looksLikeMissionControl(path.resolve(arg)) ? path.resolve(arg) : null;
  if (env.GODSPEED_CHARM_DIR) return looksLikeMissionControl(env.GODSPEED_CHARM_DIR) ? path.resolve(env.GODSPEED_CHARM_DIR) : null;
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

export const LAUNCHER_STAMP = "Written by godspeed-charm setup.";

// One launcher per shell, each built so the person's words arrive exactly as given (lib/argv.mjs):
// - sh (Linux, macOS, and Git Bash on Windows). On Windows, Git Bash rewrites any argument that
//   starts with / into a Windows path when it starts node, so "/ right side" would arrive as
//   "C:/Program Files/Git/ right side"; that rewriting is switched off for this one call.
// - .cmd (cmd.exe). It cannot carry a line break, so it marks where its arguments end and the
//   command refuses a line that was cut.
// - .ps1 (PowerShell, which picks it over the .cmd in the same folder), only when ps1 is true:
//   PowerShell refuses every .ps1 under a Restricted or AllSigned policy instead of falling back
//   to the .cmd, so setup writes it only where PowerShell runs it (setup.mjs, ps1Allowed).
export function launchers(appDir, platform = process.platform, { ps1 = false } = {}) {
  // Joined the way the launcher's own system joins paths, whichever computer writes it.
  const script = (platform === "win32" ? path.win32 : path.posix).join(appDir, "bin", "godspeed-charm.mjs");
  const posix = script.replace(/\\/g, "/");
  if (platform !== "win32") return [{ name: "godspeed-charm", body: `#!/bin/sh\nexec node "${posix}" "$@"\n`, mode: 0o755 }];
  // What the two switches held before is passed along, and node puts it back before it starts
  // anything (lib/argv.mjs, restoreShellEnv): git hooks run in Git Bash too, and they may count
  // on the rewriting this switches off.
  const out = [{
    name: "godspeed-charm",
    body: [
      "#!/bin/sh",
      `# ${LAUNCHER_STAMP} Git Bash rewrites an argument that starts with / into a Windows path when`,
      "# it starts node; that is switched off for this one call, so the words arrive as they were given.",
      'export GODSPEED_CHARM_PATHCONV_WAS="${MSYS_NO_PATHCONV+x}${MSYS_NO_PATHCONV-}"',
      'export GODSPEED_CHARM_ARGCONV_WAS="${MSYS2_ARG_CONV_EXCL+x}${MSYS2_ARG_CONV_EXCL-}"',
      `MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*' exec node "${posix}" "$@"`,
      "",
    ].join("\n"),
    mode: 0o755,
  }];
  out.push({
    name: "godspeed-charm.cmd",
    body: [
      "@echo off",
      `rem ${LAUNCHER_STAMP} cmd.exe stops reading a command line at its first line break`,
      "rem and drops the rest. The line as it was given, and a marker after the arguments, let",
      "rem godspeed-charm see that and refuse instead of saving half of it.",
      "setlocal EnableDelayedExpansion",
      'set "GODSPEED_CHARM_CMDLINE=!CMDCMDLINE!"',
      "setlocal DisableDelayedExpansion",
      "set GODSPEED_CHARM_LAUNCHER=cmd",
      `node "${script}" %* --end-of-cmd-args`,
      "",
    ].join("\r\n"),
    mode: 0o644,
  });
  if (ps1) out.push({ name: "godspeed-charm.ps1", body: ps1Launcher(script, "godspeed-charm"), mode: 0o644 });
  return out;
}

// PowerShell turns an unquoted a,b into a list; it reaches a .cmd as "a,b", so it is handed over
// that way here too, never as "a b".
function ps1Launcher(script, name) {
  // A byte order mark, so Windows PowerShell 5.1 reads a path with an umlaut in it correctly.
  return "\ufeff" + [
    `# ${LAUNCHER_STAMP} PowerShell runs this file in place of ${name}.cmd next to it.`,
    "# The arguments reach node as one base64 string, so no line break, quote, $ or % in them is",
    "# changed or cut on the way (cmd.exe stops at the first line break and drops the rest).",
    "$argvJson = ConvertTo-Json -Compress -InputObject @($args | ForEach-Object { if ($_ -is [array]) { @($_ | ForEach-Object { [string]$_ }) -join ',' } else { [string]$_ } })",
    `& node '${script.replace(/'/g, "''")}' --argv-base64 ([Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($argvJson)))`,
    "exit $LASTEXITCODE",
    "",
  ].join("\r\n");
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
