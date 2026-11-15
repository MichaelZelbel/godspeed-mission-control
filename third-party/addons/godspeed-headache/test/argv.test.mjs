// The person's words arrive whole, or the command refuses: how the launchers hand the arguments
// over (lib/argv.mjs), the words file, the paths from Git Bash, and what each launcher looks like.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { decodeArgv, readWordsFile, restoreShellEnv, startedFromGitBash, gitBashPath, ARGV_FLAG, CMD_END, LAUNCHER_ENV, CMDLINE_ENV, CUT_MESSAGE } from "../lib/argv.mjs";
import * as P from "../lib/paths.mjs";
import { ps1Allowed, powershellPolicies } from "../lib/setup.mjs";
import { readEntries } from "../lib/store.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(ROOT, "bin", "godspeed-headache.mjs");
const isWin = process.platform === "win32";
const WORDS = 'Kopfschmerz seit halb sieben.\n\nI said "pounding", took 2 for $5, 100% %PATH% & more | Grüße ß \\ back\n/ right side worse\nlast line';
const b64 = (list) => Buffer.from(JSON.stringify(list), "utf8").toString("base64");
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test("--argv-base64 hands over every argument unchanged, line breaks, quotes and empty ones included", () => {
  const list = ["start", "--words", WORDS, "--source", "desk", ""];
  assert.deepEqual(decodeArgv([ARGV_FLAG, b64(list)], {}), { argv: list });
  assert.deepEqual(decodeArgv([ARGV_FLAG, b64([])], {}), { argv: [] });
});

test("--argv-base64 that cannot be read is refused, never half-used", () => {
  for (const raw of [[ARGV_FLAG], [ARGV_FLAG, "not base64!"], [ARGV_FLAG, b64(["a"]), "extra"], [ARGV_FLAG, b64({ a: 1 })], [ARGV_FLAG, b64(["a", 2])],
    [ARGV_FLAG, Buffer.from([0xff, 0xfe, 0x00]).toString("base64")]]) {
    assert.match(decodeArgv(raw, {}).error, /cannot read/, JSON.stringify(raw));
  }
});

test("through the .cmd: a whole line drops the marker, a cut line is refused", () => {
  const env = { [LAUNCHER_ENV]: "cmd", [CMDLINE_ENV]: 'cmd.exe /c ""x.cmd" start --words hello --source a"' };
  assert.deepEqual(decodeArgv(["start", "--words", "hello", "--source", "a", CMD_END], env), { argv: ["start", "--words", "hello", "--source", "a"] });
  assert.deepEqual(decodeArgv([CMD_END], env), { argv: [] });
  // cut inside quotes: the marker ends up inside the last argument
  assert.equal(decodeArgv(["start", "--words", `line one ${CMD_END}`], env).error, CUT_MESSAGE);
  // cut at an & outside quotes: the marker never arrives
  assert.equal(decodeArgv(["start", "--words", "a"], env).error, CUT_MESSAGE);
  // cut outside quotes (node's shell: true does not quote): the marker arrives on its own, but
  // the line cmd.exe was given still holds the line break
  const unquoted = { [LAUNCHER_ENV]: "cmd", [CMDLINE_ENV]: 'cmd.exe /d /s /c "godspeed-headache start --words line one\nline two --source x"' };
  assert.equal(decodeArgv(["start", "--words", "line", "one", CMD_END], unquoted).error, CUT_MESSAGE);
  assert.equal(decodeArgv(["end", CMD_END], { ...unquoted, [CMDLINE_ENV]: "cmd.exe /c \"x a\rb\"" }).error, CUT_MESSAGE);
  // the quiet command still knows who it is, so context stays silent
  assert.equal(decodeArgv(["context", "--godspeed"], env).argv[0], "context");
});

test("without a launcher marker the arguments are taken as they are", () => {
  assert.deepEqual(decodeArgv(["start", "--words", "a\nb"], {}), { argv: ["start", "--words", "a\nb"] });
});

test("what the Git Bash launcher switched off is put back as the shell had it", () => {
  assert.deepEqual(restoreShellEnv({ MSYS_NO_PATHCONV: "1", MSYS2_ARG_CONV_EXCL: "*", GODSPEED_HEADACHE_PATHCONV_WAS: "", GODSPEED_HEADACHE_ARGCONV_WAS: "", X: "y" }), { X: "y" });
  assert.deepEqual(restoreShellEnv({ MSYS_NO_PATHCONV: "1", MSYS2_ARG_CONV_EXCL: "*", GODSPEED_HEADACHE_PATHCONV_WAS: "x", GODSPEED_HEADACHE_ARGCONV_WAS: "x/c;/d" }),
    { MSYS_NO_PATHCONV: "", MSYS2_ARG_CONV_EXCL: "/c;/d" });
  assert.deepEqual(restoreShellEnv({ MSYS_NO_PATHCONV: "1" }), { MSYS_NO_PATHCONV: "1" });
  assert.equal(startedFromGitBash({ GODSPEED_HEADACHE_PATHCONV_WAS: "" }), true);
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
  const d = tmp("gh-words-");
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
  const d = tmp("gh-argv-"); fs.writeFileSync(path.join(d, "AGENTS.md"), "");
  fs.mkdirSync(path.join(d, "routines", "headache"), { recursive: true });
  fs.writeFileSync(path.join(d, "routines", "headache", "settings.json"), JSON.stringify({ timezone: "Europe/Berlin", git_sync: "off" }));
  return d;
}
const run = (h, now, ...a) => spawnSync(process.execPath, [BIN, ...a, "--godspeed", h], { encoding: "utf8", env: { ...process.env, GODSPEED_NOW: now }, windowsHide: true });

test("--words-file saves the words verbatim for a start, a detail, an end and a cancel, with every flag after it", () => {
  const h = mcDir();
  const file = path.join(h, "words.txt"); fs.writeFileSync(file, WORDS + "\n");
  assert.equal(run(h, "2026-10-11T07:10:00Z", "start", "--at", "06:30", "--words-file", file, "--pain", "3", "--source", "desk").status, 0);
  const s = run(h, "2026-10-11T07:20:00Z", "set", "--words-file", file, "--side", "right", "--source", "desk");
  assert.equal(s.status, 0, s.stderr);
  const e = run(h, "2026-10-11T08:00:00Z", "end", "--words-file", file, "--source", "desk", "--json");
  assert.equal(e.status, 0, e.stderr);
  assert.equal(JSON.parse(e.stdout).episode.side, "right");
  assert.equal(run(h, "2026-10-11T08:01:00Z", "cancel", "--words-file", file, "--source", "desk").status, 0);
  assert.deepEqual(readEntries(h).map((x) => [x.kind, x.words, x.source]), [
    ["start", WORDS, "desk"], ["set", WORDS, "desk"], ["end", WORDS, "desk"], ["cancel", WORDS, "desk"]]);
});

test("the words come once, and a words file that cannot be read saves nothing", () => {
  const h = mcDir();
  const file = path.join(h, "w.txt"); fs.writeFileSync(file, "x");
  const twice = run(h, "2026-10-11T07:10:00Z", "start", "--words", "a", "--words-file", file);
  assert.equal(twice.status, 1); assert.match(twice.stderr, /either --words or --words-file/);
  const missing = run(h, "2026-10-11T07:10:00Z", "start", "--words-file", path.join(h, "nope.txt"));
  assert.equal(missing.status, 1); assert.match(missing.stderr, /Nothing was saved/);
  assert.deepEqual(readEntries(h), []);
});

test("a line the .cmd launcher saw cut saves nothing and says why; context stays silent", () => {
  const h = mcDir();
  const env = { ...process.env, GODSPEED_HEADACHE_DIR: h, [LAUNCHER_ENV]: "cmd", [CMDLINE_ENV]: "x" };
  const r = spawnSync(process.execPath, [BIN, "start", "--words", `line one ${CMD_END}`], { encoding: "utf8", windowsHide: true, env });
  assert.equal(r.status, 1); assert.match(r.stderr, /cut short/);
  assert.equal(fs.existsSync(path.join(h, "routines", "headache", "entries")), false);
  const c = spawnSync(process.execPath, [BIN, "context", "--hook"], { encoding: "utf8", windowsHide: true, env });
  assert.equal(c.status, 0); assert.equal(c.stdout + c.stderr, "");
});

test("launchers: sh everywhere, .cmd on Windows, .ps1 only when asked for", () => {
  assert.deepEqual(P.launchers("/app", "linux").map((l) => l.name), ["godspeed-headache"]);
  assert.doesNotMatch(P.launchers("/app", "linux")[0].body, /MSYS/);
  assert.deepEqual(P.launchers("C:\\app", "win32").map((l) => l.name), ["godspeed-headache", "godspeed-headache.cmd"]);
  const win = P.launchers("C:\\o'neil\\app", "win32", { ps1: true });
  assert.deepEqual(win.map((l) => l.name), ["godspeed-headache", "godspeed-headache.cmd", "godspeed-headache.ps1"]);
  assert.match(win[0].body, /\nexport GODSPEED_HEADACHE_PATHCONV_WAS="\$\{MSYS_NO_PATHCONV\+x\}\$\{MSYS_NO_PATHCONV-\}"\n/);
  assert.match(win[0].body, /\nexport GODSPEED_HEADACHE_ARGCONV_WAS="\$\{MSYS2_ARG_CONV_EXCL\+x\}\$\{MSYS2_ARG_CONV_EXCL-\}"\n/);
  assert.match(win[0].body, /\nMSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='\*' exec node "C:\/o'neil\/app\/bin\/godspeed-headache.mjs" "\$@"\n$/);
  assert.match(win[1].body, /set "GODSPEED_HEADACHE_CMDLINE=!CMDCMDLINE!"\r\nsetlocal DisableDelayedExpansion\r\nset GODSPEED_HEADACHE_LAUNCHER=cmd\r\nnode "C:\\o'neil\\app\\bin\\godspeed-headache\.mjs" %\* --end-of-cmd-args\r\n$/);
  assert.equal(win[2].body.charCodeAt(0), 0xfeff);
  assert.match(win[2].body, /& node 'C:\\o''neil\\app\\bin\\godspeed-headache\.mjs' --argv-base64 /);
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

test("setup with --no-hermes: launchers that refuse a cut line, the .ps1 exactly where PowerShell runs it, and Hermes never asked", () => {
  const home = tmp("gh-setup-");
  const mc = path.join(home, "mc"); fs.mkdirSync(mc); fs.writeFileSync(path.join(mc, "AGENTS.md"), "");
  // A stand-in hermes that leaves a mark if anything calls it.
  const fake = path.join(home, "fakebin"); fs.mkdirSync(fake);
  const mark = path.join(home, "hermes-was-called");
  fs.writeFileSync(path.join(fake, "hermes.cmd"), `@echo off\r\necho x> "${mark}"\r\n`);
  fs.writeFileSync(path.join(fake, "hermes"), `#!/bin/sh\necho x > "${mark}"\n`, { mode: 0o755 });
  const env = { ...process.env, HOME: home, USERPROFILE: home, GODSPEED_HEADACHE_APP: path.join(home, ".godspeed-headache"), PATH: `${fake}${path.delimiter}${process.env.PATH}` };
  const r = spawnSync(process.execPath, [BIN, "setup", "--godspeed", mc, "--yes", "--no-hermes", "--timezone", "Europe/Berlin", "--language", "en"], { encoding: "utf8", env, windowsHide: true, timeout: 120000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(fs.existsSync(mark), false, "hermes was called");
  assert.ok(fs.existsSync(path.join(mc, "skills", "headache-tracker", "SKILL.md")));
  const bin = P.binDir(home);
  assert.ok(fs.existsSync(path.join(home, ".godspeed-headache", "app", "lib", "argv.mjs")));
  if (isWin) {
    assert.equal(fs.existsSync(path.join(bin, "godspeed-headache.ps1")), ps1Allowed(powershellPolicies()), r.stdout);
    assert.match(fs.readFileSync(path.join(bin, "godspeed-headache.cmd"), "utf8"), /--end-of-cmd-args/);
    assert.match(fs.readFileSync(path.join(bin, "godspeed-headache"), "utf8"), /MSYS_NO_PATHCONV=1/);
  }
});
