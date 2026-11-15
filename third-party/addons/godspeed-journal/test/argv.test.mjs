// The person's words arrive whole, or the command refuses: how the launchers hand the arguments
// over (lib/argv.mjs), the words file, and what each launcher looks like.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { decodeArgv, readWordsFile, restoreShellEnv, startedFromGitBash, gitBashPath, ARGV_FLAG, CMD_END, LAUNCHER_ENV, CMDLINE_ENV, CUT_MESSAGE } from "../lib/argv.mjs";
import * as P from "../lib/paths.mjs";
import { ps1Allowed, policyProbeEnv, powershellPolicies } from "../lib/setup.mjs";
import { readEntries } from "../lib/store.mjs";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "godspeed-journal.mjs");
const WORDS = 'Now, what do I want?\n\nI said "German" videos cost $50, 100% %PATH% & more | Grüße ß \\ back\n/start of a line\nlast line';
const b64 = (list) => Buffer.from(JSON.stringify(list), "utf8").toString("base64");
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test("--argv-base64 hands over every argument unchanged, line breaks, quotes and empty ones included", () => {
  const list = ["note", WORDS, "--task", "german", "--source", "desk", ""];
  assert.deepEqual(decodeArgv([ARGV_FLAG, b64(list)], {}), { argv: list });
  assert.deepEqual(decodeArgv([ARGV_FLAG, b64([])], {}), { argv: [] });
});

test("--argv-base64 that cannot be read is refused, never half-used", () => {
  for (const raw of [[ARGV_FLAG], [ARGV_FLAG, "not base64!"], [ARGV_FLAG, b64(["a"]), "extra"], [ARGV_FLAG, b64({ a: 1 })], [ARGV_FLAG, b64(["a", 2])],
    [ARGV_FLAG, Buffer.from([0xff, 0xfe, 0x00]).toString("base64")]]) {
    const r = decodeArgv(raw, {});
    assert.match(r.error, /cannot read/, JSON.stringify(raw));
  }
});

test("through the .cmd: a whole line drops the marker, a cut line is refused", () => {
  const env = { [LAUNCHER_ENV]: "cmd", [CMDLINE_ENV]: 'cmd.exe /c ""x.cmd" note hello --task a"' };
  assert.deepEqual(decodeArgv(["note", "hello", "--task", "a", CMD_END], env), { argv: ["note", "hello", "--task", "a"] });
  assert.deepEqual(decodeArgv([CMD_END], env), { argv: [] });
  // cut inside quotes: the marker ends up inside the last argument
  assert.equal(decodeArgv(["note", `line one ${CMD_END}`], env).error, CUT_MESSAGE);
  // cut at an & outside quotes: the marker never arrives
  assert.equal(decodeArgv(["note", "a"], env).error, CUT_MESSAGE);
  // cut outside quotes (node's shell: true does not quote): the marker arrives on its own, but
  // the line cmd.exe was given still holds the line break
  const unquoted = { [LAUNCHER_ENV]: "cmd", [CMDLINE_ENV]: 'cmd.exe /d /s /c "godspeed-journal note line one\nline two --task x"' };
  assert.equal(decodeArgv(["note", "line", "one", CMD_END], unquoted).error, CUT_MESSAGE);
  assert.equal(decodeArgv(["note", "ab", CMD_END], { ...unquoted, [CMDLINE_ENV]: "cmd.exe /c \"x a\rb\"" }).error, CUT_MESSAGE);
  // the quiet commands still know who they are, so context and tick stay silent
  assert.equal(decodeArgv(["tick", "--godspeed"], env).argv[0], "tick");
});

test("without a launcher marker the arguments are taken as they are", () => {
  assert.deepEqual(decodeArgv(["note", "a\nb"], {}), { argv: ["note", "a\nb"] });
});

test("what the Git Bash launcher switched off is put back as the shell had it", () => {
  // nothing set before: both removed again
  assert.deepEqual(restoreShellEnv({ MSYS_NO_PATHCONV: "1", MSYS2_ARG_CONV_EXCL: "*", GODSPEED_JOURNAL_PATHCONV_WAS: "", GODSPEED_JOURNAL_ARGCONV_WAS: "", X: "y" }), { X: "y" });
  // set before, even to nothing: the old value back
  assert.deepEqual(restoreShellEnv({ MSYS_NO_PATHCONV: "1", MSYS2_ARG_CONV_EXCL: "*", GODSPEED_JOURNAL_PATHCONV_WAS: "x", GODSPEED_JOURNAL_ARGCONV_WAS: "x/c;/d" }),
    { MSYS_NO_PATHCONV: "", MSYS2_ARG_CONV_EXCL: "/c;/d" });
  // not started by that launcher: left alone
  assert.deepEqual(restoreShellEnv({ MSYS_NO_PATHCONV: "1" }), { MSYS_NO_PATHCONV: "1" });
  assert.equal(startedFromGitBash({ GODSPEED_JOURNAL_PATHCONV_WAS: "" }), true);
  assert.equal(startedFromGitBash({}), false);
});

test("a path given the Git Bash way becomes a Windows path; anything else is left alone", () => {
  const asked = [];
  const ask = (p) => { asked.push(p); return p === "/tmp/w.txt" ? "C:\\Users\\a\\AppData\\Local\\Temp\\w.txt" : null; };
  assert.equal(gitBashPath("/tmp/w.txt", ask), "C:\\Users\\a\\AppData\\Local\\Temp\\w.txt");
  assert.equal(gitBashPath("/c/Users/a/mc", ask), "C:\\Users\\a\\mc", "a drive path is turned by hand when cygpath cannot answer");
  assert.equal(gitBashPath("/d", ask), "D:\\");
  assert.equal(gitBashPath("/nowhere/x", ask), "/nowhere/x");
  assert.equal(gitBashPath("C:\\mc", ask), "C:\\mc");
  assert.equal(gitBashPath("relative/w.txt", ask), "relative/w.txt");
  assert.equal(gitBashPath("//server/share", ask), "//server/share");
  assert.deepEqual(asked, ["/tmp/w.txt", "/c/Users/a/mc", "/d", "/nowhere/x"]);
});

test("the words file reads UTF-8 and UTF-16 and refuses what it would have to guess", () => {
  const d = tmp("hj-words-");
  const put = (name, buf) => { const f = path.join(d, name); fs.writeFileSync(f, buf); return f; };
  assert.equal(readWordsFile(put("plain.txt", Buffer.from(WORDS, "utf8"))), WORDS);
  assert.equal(readWordsFile(put("bom.txt", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(WORDS, "utf8")]))), WORDS);
  assert.equal(readWordsFile(put("le.txt", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(WORDS, "utf16le")]))), WORDS);
  assert.equal(readWordsFile(put("be.txt", Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(WORDS, "utf16le").swap16()]))), WORDS);
  assert.equal(readWordsFile(put("crlf.txt", Buffer.from(WORDS.replace(/\n/g, "\r\n"), "utf8"))), WORDS);
  assert.throws(() => readWordsFile(put("latin1.txt", Buffer.from("Gr\xfc\xdfe", "latin1"))), /not UTF-8/);
  assert.throws(() => readWordsFile(put("empty.txt", " \n")), /empty/);
  assert.throws(() => readWordsFile(path.join(d, "missing.txt")), /no such file/);
});

function mcDir() {
  const d = tmp("hj-argv-"); fs.writeFileSync(path.join(d, "AGENTS.md"), "");
  fs.mkdirSync(path.join(d, "routines", "journal"), { recursive: true });
  fs.writeFileSync(path.join(d, "routines", "journal", "settings.json"), JSON.stringify({ timezone: "Europe/Berlin", git_sync: "off" }));
  return d;
}
const SETTINGS = { timezone: "Europe/Berlin" };
const run = (h, ...a) => spawnSync(process.execPath, [BIN, ...a, "--godspeed", h], { encoding: "utf8", env: { ...process.env, GODSPEED_NOW: "2026-10-11T14:38:00Z" }, windowsHide: true });

test("--words-file saves the words verbatim, for a note, a start and a done, with every flag after it", () => {
  const h = mcDir();
  const file = path.join(h, "words.txt"); fs.writeFileSync(file, WORDS + "\n");
  assert.equal(run(h, "start", "German audio", "--words-file", file, "--source", "desk").status, 0);
  const n = run(h, "note", "--words-file", file, "--task", "german", "--source", "desk", "--json");
  assert.equal(n.status, 0, n.stderr);
  const d = run(h, "done", "german", "--words-file", file, "--source", "desk");
  assert.equal(d.status, 0, d.stderr);
  const es = readEntries(h, SETTINGS, { days: 2, until: new Date("2026-10-11T15:00:00Z") });
  assert.deepEqual(es.map((e) => [e.kind, e.words, e.source, e.task]), [
    ["start", WORDS, "desk", "t-20261011-1638-german-audio"],
    ["note", WORDS, "desk", "t-20261011-1638-german-audio"],
    ["done", WORDS, "desk", "t-20261011-1638-german-audio"],
  ]);
});

test("a note takes --words too, and its words only once", () => {
  const h = mcDir();
  assert.equal(run(h, "note", "--words", "a\nb", "--source", "desk").status, 0);
  const both = run(h, "note", "text", "--words", "other");
  assert.equal(both.status, 1); assert.match(both.stderr, /once/);
  const file = path.join(h, "w.txt"); fs.writeFileSync(file, "x");
  const twice = run(h, "note", "--words", "a", "--words-file", file);
  assert.equal(twice.status, 1); assert.match(twice.stderr, /either --words or --words-file/);
  const missing = run(h, "note", "--words-file", path.join(h, "nope.txt"));
  assert.equal(missing.status, 1); assert.match(missing.stderr, /Nothing was saved/);
  const es = readEntries(h, SETTINGS, { days: 2, until: new Date("2026-10-11T15:00:00Z") });
  assert.deepEqual(es.map((e) => e.words), ["a\nb"]);
});

test("a line the .cmd launcher saw cut saves nothing and says why", () => {
  const h = mcDir();
  const r = spawnSync(process.execPath, [BIN, "note", `line one ${CMD_END}`], { encoding: "utf8", windowsHide: true,
    env: { ...process.env, GODSPEED_JOURNAL_DIR: h, [LAUNCHER_ENV]: "cmd", [CMDLINE_ENV]: "x" } });
  assert.equal(r.status, 1); assert.match(r.stderr, /cut short/);
  assert.equal(fs.existsSync(path.join(h, "routines", "journal", "entries")), false);
});

test("launchers: sh everywhere, .cmd on Windows, .ps1 only when asked for", () => {
  assert.deepEqual(P.launchers("/app", "linux").map((l) => l.name), ["godspeed-journal"]);
  assert.doesNotMatch(P.launchers("/app", "linux")[0].body, /MSYS/);
  assert.deepEqual(P.launchers("C:\\app", "win32").map((l) => l.name), ["godspeed-journal", "godspeed-journal.cmd"]);
  const win = P.launchers("C:\\o'neil\\app", "win32", { ps1: true });
  assert.deepEqual(win.map((l) => l.name), ["godspeed-journal", "godspeed-journal.cmd", "godspeed-journal.ps1"]);
  assert.match(win[0].body, /\nexport GODSPEED_JOURNAL_PATHCONV_WAS="\$\{MSYS_NO_PATHCONV\+x\}\$\{MSYS_NO_PATHCONV-\}"\n/);
  assert.match(win[0].body, /\nexport GODSPEED_JOURNAL_ARGCONV_WAS="\$\{MSYS2_ARG_CONV_EXCL\+x\}\$\{MSYS2_ARG_CONV_EXCL-\}"\n/);
  assert.match(win[0].body, /\nMSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='\*' exec node "C:\/o'neil\/app\/bin\/godspeed-journal.mjs" "\$@"\n$/);
  assert.match(win[1].body, /set "GODSPEED_JOURNAL_CMDLINE=!CMDCMDLINE!"\r\nsetlocal DisableDelayedExpansion\r\nset GODSPEED_JOURNAL_LAUNCHER=cmd\r\nnode "C:\\o'neil\\app\\bin\\godspeed-journal\.mjs" %\* --end-of-cmd-args\r\n$/);
  assert.equal(win[2].body.charCodeAt(0), 0xfeff);
  assert.match(win[2].body, /& node 'C:\\o''neil\\app\\bin\\godspeed-journal\.mjs' --argv-base64 /);
  assert.match(win[2].body, /-is \[array\]\) \{ @\(\$_ \| ForEach-Object \{ \[string\]\$_ \}\) -join ',' \}/, "a,b stays a,b, as it reaches a .cmd");
});

test("the PowerShell launcher is written only where every PowerShell runs scripts", () => {
  assert.equal(ps1Allowed([{ exe: "powershell.exe", policy: "RemoteSigned" }, { exe: "pwsh.exe", policy: "Unrestricted" }]), true);
  assert.equal(ps1Allowed([{ exe: "powershell.exe", policy: "Bypass\r\n" }]), true);
  assert.equal(ps1Allowed([{ exe: "powershell.exe", policy: "Restricted" }, { exe: "pwsh.exe", policy: "RemoteSigned" }]), false);
  assert.equal(ps1Allowed([{ exe: "powershell.exe", policy: "AllSigned" }]), false);
  assert.equal(ps1Allowed([{ exe: "powershell.exe", policy: "unknown" }]), false);
  assert.equal(ps1Allowed([]), false);
});

test("the policy check hands PowerShell neither the caller's policy nor its module path", () => {
  const env = policyProbeEnv({ Path: "C:\\bin", PSExecutionPolicyPreference: "Bypass", PSModulePath: "C:\\Program Files\\PowerShell\\7\\Modules", psmodulepath: "x", USERPROFILE: "C:\\Users\\a" });
  assert.deepEqual(env, { Path: "C:\\bin", USERPROFILE: "C:\\Users\\a" });
});

// Started from PowerShell 7, the module path points at PowerShell 7's modules; Windows
// PowerShell could not load its Get-ExecutionPolicy from there, and setup then removed a
// working launcher because it read the policy as "unknown".
const pwsh7Modules = process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "PowerShell", "7", "Modules") : "";
test("Windows PowerShell's policy is read even when the caller is PowerShell 7", { skip: process.platform !== "win32" || !fs.existsSync(pwsh7Modules) }, () => {
  const fromPwsh7 = { ...process.env, PSModulePath: [path.join(os.homedir(), "Documents", "PowerShell", "Modules"), pwsh7Modules].join(";") };
  const found = powershellPolicies(fromPwsh7);
  const winPs = found.find((p) => p.exe === "powershell.exe");
  assert.ok(winPs, JSON.stringify(found));
  assert.notEqual(winPs.policy, "unknown", JSON.stringify(found));
});
