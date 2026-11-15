// The person's words arrive whole, or the command refuses: how the launchers hand the arguments
// over (lib/argv.mjs), the words and opening files, the paths from Git Bash, and what each
// launcher looks like.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { decodeArgv, readTextFile, restoreShellEnv, startedFromGitBash, gitBashPath, ARGV_FLAG, CMD_END, LAUNCHER_ENV, CMDLINE_ENV, CUT_MESSAGE } from "../lib/argv.mjs";
import * as P from "../lib/paths.mjs";
import { ps1Allowed } from "../lib/setup.mjs";
import { tmpMission, area } from "./helpers.mjs";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "godspeed-coach.mjs");
const WORDS = 'Most evenings, about an hour.\n\nI said "tired", it cost $5, 100% %PATH% & more | Grüße ß \\ back\n/ stretched twice\nlast line';
const b64 = (list) => Buffer.from(JSON.stringify(list), "utf8").toString("base64");
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));

test("--argv-base64 hands over every argument unchanged, line breaks, quotes and empty ones included", () => {
  const list = ["talk", "said", "health", "--words", WORDS, ""];
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
  const env = { [LAUNCHER_ENV]: "cmd", [CMDLINE_ENV]: 'cmd.exe /c ""x.cmd" talk said health --words hello"' };
  assert.deepEqual(decodeArgv(["talk", "said", "health", "--words", "hello", CMD_END], env), { argv: ["talk", "said", "health", "--words", "hello"] });
  assert.deepEqual(decodeArgv([CMD_END], env), { argv: [] });
  assert.equal(decodeArgv(["talk", "said", "health", "--words", `line one ${CMD_END}`], env).error, CUT_MESSAGE);
  assert.equal(decodeArgv(["talk", "said", "health", "--words", "a"], env).error, CUT_MESSAGE);
  const unquoted = { [LAUNCHER_ENV]: "cmd", [CMDLINE_ENV]: 'cmd.exe /d /s /c "godspeed-coach talk said health --words line one\nline two"' };
  assert.equal(decodeArgv(["talk", "said", "health", "--words", "line", "one", CMD_END], unquoted).error, CUT_MESSAGE);
  // the quiet commands still know who they are, so gate, tick and context stay quiet
  assert.equal(decodeArgv(["gate", "--godspeed"], env).argv[0], "gate");
});

test("without a launcher marker the arguments are taken as they are", () => {
  assert.deepEqual(decodeArgv(["talk", "said", "--words", "a\nb"], {}), { argv: ["talk", "said", "--words", "a\nb"] });
});

test("what the Git Bash launcher switched off is put back as the shell had it", () => {
  assert.deepEqual(restoreShellEnv({ MSYS_NO_PATHCONV: "1", MSYS2_ARG_CONV_EXCL: "*", GODSPEED_COACH_PATHCONV_WAS: "", GODSPEED_COACH_ARGCONV_WAS: "", X: "y" }), { X: "y" });
  assert.deepEqual(restoreShellEnv({ MSYS_NO_PATHCONV: "1", MSYS2_ARG_CONV_EXCL: "*", GODSPEED_COACH_PATHCONV_WAS: "x", GODSPEED_COACH_ARGCONV_WAS: "x/c;/d" }),
    { MSYS_NO_PATHCONV: "", MSYS2_ARG_CONV_EXCL: "/c;/d" });
  assert.deepEqual(restoreShellEnv({ MSYS_NO_PATHCONV: "1" }), { MSYS_NO_PATHCONV: "1" });
  assert.equal(startedFromGitBash({ GODSPEED_COACH_PATHCONV_WAS: "" }), true);
  assert.equal(startedFromGitBash({}), false);
});

test("a path given the Git Bash way becomes a Windows path; anything else is left alone", () => {
  const ask = (p) => (p === "/tmp/w.txt" ? "C:\\Temp\\w.txt" : null);
  assert.equal(gitBashPath("/tmp/w.txt", ask), "C:\\Temp\\w.txt");
  assert.equal(gitBashPath("/c/Users/a/mc", ask), "C:\\Users\\a\\mc");
  assert.equal(gitBashPath("/nowhere/x", ask), "/nowhere/x");
  assert.equal(gitBashPath("C:\\mc", ask), "C:\\mc");
  assert.equal(gitBashPath("//server/share", ask), "//server/share");
});

test("the text file reads UTF-8 and UTF-16, says which file it was, and refuses what it would have to guess", () => {
  const d = tmp("coach-words-");
  const put = (name, buf) => { const f = path.join(d, name); fs.writeFileSync(f, buf); return f; };
  assert.equal(readTextFile(put("plain.txt", Buffer.from(WORDS, "utf8"))), WORDS);
  assert.equal(readTextFile(put("bom.txt", Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(WORDS, "utf8")]))), WORDS);
  assert.equal(readTextFile(put("le.txt", Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(WORDS, "utf16le")]))), WORDS);
  assert.equal(readTextFile(put("be.txt", Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(WORDS, "utf16le").swap16()]))), WORDS);
  assert.equal(readTextFile(put("crlf.txt", Buffer.from(WORDS.replace(/\n/g, "\r\n"), "utf8"))), WORDS);
  assert.throws(() => readTextFile(put("latin1.txt", Buffer.from("Gr\xfc\xdfe", "latin1"))), /words file .* not UTF-8/);
  assert.throws(() => readTextFile(put("empty.txt", " \n"), "opening"), /opening file .* empty/);
  assert.throws(() => readTextFile(path.join(d, "missing.txt")), /no such file/);
});

const mission = () => tmpMission({
  "coach/settings.json": JSON.stringify({ timezone: "Europe/Berlin", git_sync: "off" }),
  "coach/health/area.md": area(),
});
const run = (mc, now, ...a) => spawnSync(process.execPath, [BIN, ...a, "--godspeed", mc], {
  encoding: "utf8", windowsHide: true, env: { ...process.env, GODSPEED_NOW: now, GODSPEED_COACH_GIT_SYNC: "off", GODSPEED_COACH_APP: tmp("coach-app-") },
});
const talk = (mc) => fs.readFileSync(path.join(mc, "coach", "health", "talks", "2026-10-04.md"), "utf8");

test("--opening-file and --words-file carry a talk's opening and the person's words, with every flag after them", () => {
  const mc = mission();
  const file = path.join(mc, "words.txt"); fs.writeFileSync(file, WORDS + "\n");
  const o = run(mc, "2026-10-04T17:02:00Z", "talk", "open", "health", "--opening-file", file, "--read", "the week's table");
  assert.equal(o.status, 0, o.stderr);
  const s = run(mc, "2026-10-04T17:20:00Z", "talk", "said", "health", "--words-file", file, "--json");
  assert.equal(s.status, 0, s.stderr); assert.equal(JSON.parse(s.stdout).date, "2026-10-04");
  const text = talk(mc);
  assert.ok(text.includes(`## The opening\n${WORDS}\n`), text);
  assert.match(text, /## What was read\nthe week's table\n/);
  assert.ok(text.includes(`## What you said\n- 19:20 ${WORDS.replace(/\s+/g, " ")}\n`), text);
  assert.equal(run(mc, "2026-10-04T17:21:00Z", "habit", "add", "health", "head-lifts", "--title", "Face-down head lifts", "--days", "daily").status, 0);
  const t = run(mc, "2026-10-04T17:22:00Z", "habit", "track", "head lifts", "--words-file", file, "--source", "desk");
  assert.equal(t.status, 0, t.stderr);
  const habit = fs.readFileSync(path.join(mc, "coach", "health", "habits", "head-lifts.md"), "utf8");
  assert.ok(habit.includes(`- 2026-10-04 done (desk) "${WORDS.replace(/"/g, "'").replace(/\s+/g, " ")}"`), habit);
});

test("the text comes once, and a file that cannot be read saves nothing", () => {
  const mc = mission();
  const file = path.join(mc, "w.txt"); fs.writeFileSync(file, "x");
  const twice = run(mc, "2026-10-04T17:02:00Z", "talk", "open", "health", "--opening", "a", "--opening-file", file);
  assert.equal(twice.status, 1); assert.match(twice.stderr, /either --opening or --opening-file/);
  const missing = run(mc, "2026-10-04T17:02:00Z", "talk", "open", "health", "--opening-file", path.join(mc, "nope.txt"));
  assert.equal(missing.status, 1); assert.match(missing.stderr, /opening file .*Nothing was saved/);
  assert.equal(fs.existsSync(path.join(mc, "coach", "health", "talks")), false);
  const words = run(mc, "2026-10-04T17:02:00Z", "habit", "track", "x", "--words", "a", "--words-file", file);
  assert.equal(words.status, 1); assert.match(words.stderr, /either --words or --words-file/);
});

test("a line the .cmd launcher saw cut saves nothing and says why; gate and context stay quiet", () => {
  const mc = mission();
  const env = { ...process.env, GODSPEED_COACH_DIR: mc, GODSPEED_COACH_GIT_SYNC: "off", GODSPEED_COACH_APP: tmp("coach-app-"), [LAUNCHER_ENV]: "cmd", [CMDLINE_ENV]: "x" };
  const r = spawnSync(process.execPath, [BIN, "talk", "open", "health", "--opening", `line one ${CMD_END}`], { encoding: "utf8", windowsHide: true, env });
  assert.equal(r.status, 1); assert.match(r.stderr, /cut short/);
  assert.equal(fs.existsSync(path.join(mc, "coach", "health", "talks")), false);
  const g = spawnSync(process.execPath, [BIN, "gate", "--godspeed"], { encoding: "utf8", windowsHide: true, env });
  assert.equal(g.status, 0); assert.equal(g.stdout.trim(), '{"wakeAgent": false}'); assert.equal(g.stderr, "");
  const c = spawnSync(process.execPath, [BIN, "context", "--hook"], { encoding: "utf8", windowsHide: true, env });
  assert.equal(c.status, 0); assert.equal(c.stdout + c.stderr, "");
});

test("launchers: sh everywhere, .cmd on Windows, .ps1 only when asked for", () => {
  assert.deepEqual(P.launchers("C:\\app", "win32").map((l) => l.name), ["godspeed-coach", "godspeed-coach.cmd"]);
  const win = P.launchers("C:\\o'neil\\app", "win32", { ps1: true });
  assert.deepEqual(win.map((l) => l.name), ["godspeed-coach", "godspeed-coach.cmd", "godspeed-coach.ps1"]);
  assert.match(win[0].body, /\nexport GODSPEED_COACH_PATHCONV_WAS="\$\{MSYS_NO_PATHCONV\+x\}\$\{MSYS_NO_PATHCONV-\}"\n/);
  assert.match(win[0].body, /\nexport GODSPEED_COACH_ARGCONV_WAS="\$\{MSYS2_ARG_CONV_EXCL\+x\}\$\{MSYS2_ARG_CONV_EXCL-\}"\n/);
  assert.match(win[1].body, /set "GODSPEED_COACH_CMDLINE=!CMDCMDLINE!"\r\nsetlocal DisableDelayedExpansion\r\nset GODSPEED_COACH_LAUNCHER=cmd\r\nnode "C:\\o'neil\\app\\bin\\godspeed-coach\.mjs" %\* --end-of-cmd-args\r\n$/);
  assert.equal(win[2].body.charCodeAt(0), 0xfeff);
  assert.match(win[2].body, /& node 'C:\\o''neil\\app\\bin\\godspeed-coach\.mjs' --argv-base64 /);
  assert.match(win[2].body, /-is \[array\]\) \{ @\(\$_ \| ForEach-Object \{ \[string\]\$_ \}\) -join ',' \}/, "a,b stays a,b, as it reaches a .cmd");
});

test("the PowerShell launcher is written only where every PowerShell runs scripts", () => {
  assert.equal(ps1Allowed([{ exe: "powershell.exe", policy: "RemoteSigned" }, { exe: "pwsh.exe", policy: "Unrestricted" }]), true);
  assert.equal(ps1Allowed([{ exe: "powershell.exe", policy: "Restricted" }, { exe: "pwsh.exe", policy: "RemoteSigned" }]), false);
  assert.equal(ps1Allowed([{ exe: "powershell.exe", policy: "AllSigned" }]), false);
  assert.equal(ps1Allowed([]), false);
});
