// How the arguments reach the command, and the words that do not fit on a command line.
// The same way in as godspeed-journal's (lib/argv.mjs there), with this command's own names.
//
// A person's words have to arrive exactly as they were said, line breaks, quotes, $ and % included.
// On Windows the usual way in, a .cmd launcher, cannot promise that: cmd.exe stops reading a
// command line at its first line break and silently drops every argument after it (2026-10-11:
// the journal lost words, a --source and a --task that way). So:
//
// - PowerShell runs godspeed-headache.ps1, which hands the arguments over as one base64 string of
//   JSON (--argv-base64), so nothing on the way can cut or change them.
// - The .cmd launcher, still used by cmd.exe and by programs that start commands through it,
//   says it is the .cmd (GODSPEED_HEADACHE_LAUNCHER=cmd), passes on the command line cmd.exe
//   was given before it cut anything (GODSPEED_HEADACHE_CMDLINE) and puts a marker after the
//   arguments. A line break in that line, or a marker that is not the last argument on its own,
//   means the line was cut, and the command refuses instead of saving half of what was said.
// - Git Bash: the sh launcher switches off Git Bash's path rewriting for the one call into node,
//   so words starting with / arrive as said; the values that are paths are turned into Windows
//   paths here instead (gitBashPath), the way Git Bash would have.
// - --words-file <file> takes the words from a file, which no shell can change.
import { spawnSync } from "node:child_process";
import fs from "node:fs";

export const ARGV_FLAG = "--argv-base64";
export const CMD_END = "--end-of-cmd-args";
export const LAUNCHER_ENV = "GODSPEED_HEADACHE_LAUNCHER";
export const CMDLINE_ENV = "GODSPEED_HEADACHE_CMDLINE";
export const PATHCONV_WAS = "GODSPEED_HEADACHE_PATHCONV_WAS";
export const ARGCONV_WAS = "GODSPEED_HEADACHE_ARGCONV_WAS";

export const CUT_MESSAGE =
  "Nothing was saved: this command reached godspeed-headache cut short, because Windows' cmd.exe stops reading at the first line break " +
  "(or at an & or | outside quotes) and drops everything after it. Put the words in a file and pass --words-file <file>, " +
  "or run the command from PowerShell or Git Bash.";

const utf8 = (bytes) => new TextDecoder("utf-8", { fatal: true }).decode(bytes);

// raw is process.argv.slice(2). Returns { argv } or { argv, error }; on an error, argv still
// starts with the command when it can be told, so the quiet command (context) stays quiet.
export function decodeArgv(raw, env = process.env) {
  if (raw[0] === ARGV_FLAG) {
    const bad = { argv: [], error: "The PowerShell launcher handed over arguments this version cannot read. Nothing was saved. Run godspeed-headache setup again." };
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

// True when the Windows sh launcher started this, from Git Bash; read before restoreShellEnv.
export const startedFromGitBash = (env = process.env) => env[PATHCONV_WAS] !== undefined;

// The Git Bash launcher switches off MSYS path rewriting for the one call that starts node and
// passes along what the two switches held before ("x" plus the value when one was set, empty
// when none was). Put back before anything starts, so a git hook the background sync sets off
// gets exactly the environment the person's shell had.
const RESTORE = { [PATHCONV_WAS]: "MSYS_NO_PATHCONV", [ARGCONV_WAS]: "MSYS2_ARG_CONV_EXCL" };
export function restoreShellEnv(env = process.env) {
  for (const [was, name] of Object.entries(RESTORE)) {
    if (env[was] === undefined) continue;
    const before = env[was];
    delete env[was];
    if (before.startsWith("x")) env[name] = before.slice(1); else delete env[name];
  }
  return env;
}

// A path given the Git Bash way (/c/Users/..., /tmp/...) arrives unchanged now that the rewriting
// is off, and Windows cannot open it. Only values that are paths come here, never the person's
// words; cygpath (part of Git Bash) answers as Git Bash would have, and a drive path is turned
// by hand when it cannot be asked.
export function gitBashPath(p, ask = cygpath) {
  if (typeof p !== "string" || !p.startsWith("/") || p.startsWith("//")) return p;
  const asked = ask(p);
  if (asked) return asked;
  const m = p.match(/^\/([a-zA-Z])(?:\/(.*))?$/);
  return m ? `${m[1].toUpperCase()}:\\${(m[2] || "").replace(/\//g, "\\")}` : p;
}
function cygpath(p) {
  const r = spawnSync("cygpath", ["-w", p], { encoding: "utf8", timeout: 10000, windowsHide: true });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : null;
}

// The words, from a file an assistant wrote with its own file tool. UTF-8 (with or without a
// byte order mark) and UTF-16 with a byte order mark are read; anything else is refused rather
// than guessed at, since a wrong guess would change the person's words without anyone noticing.
export function readWordsFile(file) {
  let buf;
  try { buf = fs.readFileSync(file); } catch (e) {
    throw new Error(`Could not read the words file ${file}: ${e.code === "ENOENT" ? "there is no such file" : e.message}. Nothing was saved.`);
  }
  let text;
  try {
    if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) text = utf8(buf.subarray(3));
    else if (buf[0] === 0xff && buf[1] === 0xfe) text = new TextDecoder("utf-16le", { fatal: true }).decode(buf.subarray(2));
    else if (buf[0] === 0xfe && buf[1] === 0xff) {
      const body = Buffer.from(buf.subarray(2));
      if (body.length % 2) throw new Error("odd length");
      text = new TextDecoder("utf-16le", { fatal: true }).decode(body.swap16());
    } else text = utf8(buf);
  } catch {
    throw new Error(`The words file ${file} is not UTF-8 text. Save it as UTF-8 and run the command again. Nothing was saved.`);
  }
  text = text.replace(/\r\n?/g, "\n");
  if (!text.trim()) throw new Error(`The words file ${file} is empty. Nothing was saved.`);
  return text;
}
