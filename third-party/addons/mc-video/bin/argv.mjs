// How the arguments reach mc-video. The same way in as godspeed-journal's (lib/argv.mjs there),
// with this command's own names.
//
// Most of what mc-video is given is file paths, but `mc-video hyperframes tts "<text>"` hands a
// whole script to speak, and that text has to arrive exactly as it was written, line breaks,
// quotes, $ and % included. On Windows the usual way in, a .cmd launcher, cannot promise that:
// cmd.exe stops reading a command line at its first line break and silently drops every argument
// after it (2026-10-11: the journal lost words and flags that way). So:
//
// - PowerShell runs mc-video.ps1, which hands the arguments over as one base64 string of JSON
//   (--argv-base64), so nothing on the way can cut or change them.
// - The .cmd launcher, still used by cmd.exe and by programs that start commands through it,
//   says it is the .cmd (MC_VIDEO_LAUNCHER=cmd), passes on the command line cmd.exe was given
//   before it cut anything (MC_VIDEO_CMDLINE) and puts a marker after the arguments. A line break
//   in that line, or a marker that is not the last argument on its own, means the line was cut,
//   and mc-video refuses instead of running half a command.
// - Git Bash keeps rewriting paths that start with / (unlike the journal's launcher): almost
//   everything mc-video is given is a path, and that rewriting is what lets /c/Users/... reach
//   node as a path Windows can open. A line break inside quotes already arrives whole there.
import { spawnSync } from "node:child_process";

export const ARGV_FLAG = "--argv-base64";
export const CMD_END = "--end-of-cmd-args";
export const LAUNCHER_ENV = "MC_VIDEO_LAUNCHER";
export const CMDLINE_ENV = "MC_VIDEO_CMDLINE";

export const CUT_MESSAGE =
  "nothing was run: this command reached mc-video cut short, because Windows' cmd.exe stops reading at the first line break " +
  "(or at an & or | outside quotes) and drops everything after it. Put text that runs over several lines in a .txt file and " +
  "pass the file instead (mc-video hyperframes tts script.txt), or run the command from PowerShell or Git Bash.";

const utf8 = (bytes) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);

// raw is process.argv.slice(2). Returns { argv } or { argv, error }.
export function decodeArgv(raw, env = process.env) {
  if (raw[0] === ARGV_FLAG) {
    const bad = { argv: [], error: "the PowerShell launcher handed over arguments this version cannot read. Nothing was run. Run mc-video setup again." };
    if (raw.length !== 2 || !/^[A-Za-z0-9+/]*={0,2}$/.test(raw[1])) return bad;
    let list;
    try { list = JSON.parse(utf8(Buffer.from(raw[1], "base64"))); } catch { return bad; }
    if (!Array.isArray(list) || !list.every((a) => typeof a === "string")) return bad;
    return { argv: list };
  }
  if (env[LAUNCHER_ENV] === "cmd") {
    const last = raw.length - 1;
    // A line break outside quotes cuts the line where the marker still lands on its own (node's
    // shell: true passes arguments unquoted), so the line cmd.exe was given is checked as well.
    const whole = !/[\r\n]/.test(env[CMDLINE_ENV] || "") && raw[last] === CMD_END && raw.slice(0, last).every((a) => !a.includes(CMD_END));
    if (whole) return { argv: raw.slice(0, last) };
    return { argv: raw, error: CUT_MESSAGE };
  }
  return { argv: raw };
}

// PowerShell picks a .ps1 over a .cmd of the same name in the same folder, and under the
// Restricted or AllSigned policy it refuses the .ps1 instead of falling back to the .cmd. So the
// PowerShell launcher is written only where every PowerShell on this computer would run it.
const RUNS_LOCAL_SCRIPTS = new Set(["unrestricted", "remotesigned", "bypass"]);
export function ps1Allowed(policies) {
  return policies.length > 0 && policies.every((p) => RUNS_LOCAL_SCRIPTS.has(String(p.policy).trim().toLowerCase()));
}

// The policy a new PowerShell window gets, so the one this process may have been started with
// (PSExecutionPolicyPreference, which Claude Code sets to Bypass for its own shells) is left out.
export function powershellPolicies() {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.toLowerCase() !== "psexecutionpolicypreference"));
  const found = [];
  for (const exe of ["powershell.exe", "pwsh.exe"]) {
    const r = spawnSync(exe, ["-NoProfile", "-NonInteractive", "-Command", "Get-ExecutionPolicy"], { encoding: "utf8", env, timeout: 30000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    if (r.error && r.error.code === "ENOENT") continue;
    found.push({ exe, policy: r.status === 0 ? r.stdout.trim() : "unknown" });
  }
  return found;
}
