// End to end on Windows: the launchers setup writes, called the way an assistant calls them, from
// PowerShell (5.1 and 7), Git Bash, and through cmd.exe. Words with line breaks, quotes, $, % and
// umlauts arrive whole, every flag after them arrives too, and the one way in that cannot carry
// a line break (cmd.exe) refuses instead of saving half. Through the .cmd launcher alone, a
// multi-line --words lost its words and every flag after it, silently (2026-10-11, the journal).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as P from "../lib/paths.mjs";
import { readEntries } from "../lib/store.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const WORDS = 'Kopfschmerz seit halb sieben.\n\nI said "pounding", took 2 for $5, 100% %PATH% & more | Grüße ß \\ back\n/ right side worse\nlast line';

function sandbox() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "gh-win-"));
  const bin = path.join(d, "bin"); fs.mkdirSync(bin);
  for (const l of P.launchers(ROOT, "win32", { ps1: true })) fs.writeFileSync(path.join(bin, l.name), l.body, { mode: l.mode });
  const mc = path.join(d, "mc"); fs.mkdirSync(path.join(mc, "routines", "headache"), { recursive: true });
  fs.writeFileSync(path.join(mc, "AGENTS.md"), "");
  fs.writeFileSync(path.join(mc, "routines", "headache", "settings.json"), JSON.stringify({ timezone: "Europe/Berlin", git_sync: "off" }));
  const home = path.join(d, "home"); fs.mkdirSync(home);
  const wordsFile = path.join(d, "words.txt"); fs.writeFileSync(wordsFile, WORDS);
  // A cut command line loses --godspeed too; the mission control folder then comes from the
  // environment, so it points at this sandbox and never at a real headache diary.
  const env = { ...process.env, GODSPEED_HEADACHE_DIR: mc, HOME: home, USERPROFILE: home, GODSPEED_HEADACHE_GIT_SYNC: "off" };
  return { d, bin, mc, wordsFile, env };
}
const found = (exe) => spawnSync(exe, ["-NoProfile", "-NonInteractive", "-Command", "1"], { windowsHide: true }).status === 0;

const PS_SCRIPT = `param($Bin, $WordsFile)
$env:PATH = "$Bin;" + $env:PATH
$w = [IO.File]::ReadAllText($WordsFile, [Text.Encoding]::UTF8)
"resolved:" + (Get-Command godspeed-headache).Source
godspeed-headache start --at -1h --words $w --pain 3 --source desk
"start-exit:$LASTEXITCODE"
godspeed-headache set --words $w --symptom nausea,dizziness --source desk
"set-exit:$LASTEXITCODE"
godspeed-headache end --words $w --source desk
"end-exit:$LASTEXITCODE"
godspeed-headache.cmd start --words $w --source cmd-cut
"cmd-exit:$LASTEXITCODE"
`;

for (const exe of ["powershell.exe", "pwsh.exe"]) {
  test(`${exe}: multi-line words and every flag after them arrive whole; the .cmd refuses`, { skip: !isWin ? "Windows only" : !found(exe) && `${exe} not installed` }, () => {
    const s = sandbox();
    const script = path.join(s.d, "call.ps1"); fs.writeFileSync(script, "﻿" + PS_SCRIPT);
    const r = spawnSync(exe, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Bin", s.bin, "-WordsFile", s.wordsFile],
      { encoding: "utf8", env: s.env, windowsHide: true, timeout: 120000 });
    const out = r.stdout + r.stderr;
    assert.match(out, /resolved:.*godspeed-headache\.ps1/, out);
    assert.match(out, /start-exit:0/, out); assert.match(out, /set-exit:0/, out); assert.match(out, /end-exit:0/, out);
    assert.match(out, /cmd-exit:1/, out); assert.match(out, /cut short/, out);
    const es = readEntries(s.mc);
    assert.deepEqual(es.map((e) => [e.kind, e.words, e.source]), [["start", WORDS, "desk"], ["set", WORDS, "desk"], ["end", WORDS, "desk"]]);
    assert.equal(es[0].pain, 3);
    // An unquoted list reaches the command as it would have through the .cmd: one value, a,b.
    assert.deepEqual(es[1].symptoms, ["nausea,dizziness"]);
  });
}

// Git for Windows' own bash, found next to git, never whatever "bash" is on PATH (that can be WSL).
function gitBash() {
  const r = spawnSync("git", ["--exec-path"], { encoding: "utf8", windowsHide: true });
  if (r.status !== 0) return null;
  const root = path.resolve(r.stdout.trim(), "..", "..", "..");
  return ["bin/bash.exe", "usr/bin/bash.exe"].map((p) => path.join(root, p)).find((p) => fs.existsSync(p)) || null;
}

test("Git Bash: multi-line words and words starting with / arrive unchanged; paths given the Git Bash way still work", { skip: !isWin ? "Windows only" : !gitBash() && "Git Bash not found" }, () => {
  const s = sandbox();
  const script = [
    'export PATH="$(cygpath -u "$1"):$PATH"',
    'w="$(cat "$2")"',
    'godspeed-headache start --at -1h --words "$w" --source desk || exit 11',
    'godspeed-headache set --words "/ right side worse" --source desk || exit 12',
    // Both paths in Git Bash's own form (/c/... or /tmp/...): they must still be found.
    'godspeed-headache end --words-file "$(cygpath -u "$2")" --godspeed "$(cygpath -u "$3")" --source desk || exit 13',
    "echo resolved:$(command -v godspeed-headache)",
  ].join("\n");
  // A --godspeed that names no mission control is refused even with GODSPEED_HEADACHE_DIR set,
  // so the last call proves the Git Bash path was turned into one Windows can open.
  const r = spawnSync(gitBash(), ["-c", script, "call", s.bin, s.wordsFile, s.mc], { encoding: "utf8", env: s.env, windowsHide: true, timeout: 120000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /resolved:.*\/godspeed-headache$/m);
  assert.deepEqual(readEntries(s.mc).map((e) => [e.kind, e.words, e.source]), [
    ["start", WORDS, "desk"], ["set", "/ right side worse", "desk"], ["end", WORDS, "desk"]]);
});

test("Git Bash: --godspeed given the Git Bash way finds the folder", { skip: !isWin ? "Windows only" : !gitBash() && "Git Bash not found" }, () => {
  const s = sandbox();
  const env = { ...s.env }; delete env.GODSPEED_HEADACHE_DIR;
  const r = spawnSync(gitBash(), ["-c", '"$1/godspeed-headache" med "Ibuprofen" --godspeed "$(cygpath -u "$2")" --source desk', "call", s.bin.replace(/\\/g, "/"), s.mc],
    { encoding: "utf8", env, windowsHide: true, timeout: 120000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(readEntries(s.mc).map((e) => [e.kind, e.med]), [["med", "Ibuprofen"]]);
});

test("Git Bash: the rewriting is off only for the call into node; what node starts gets the shell's own setting back", { skip: !isWin ? "Windows only" : !gitBash() && "Git Bash not found" }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "gh-msys-"));
  const app = path.join(d, "app"); fs.mkdirSync(path.join(app, "bin"), { recursive: true });
  const argvLib = new URL("../lib/argv.mjs", import.meta.url).href;
  fs.writeFileSync(path.join(app, "bin", "godspeed-headache.mjs"), `import { restoreShellEnv } from ${JSON.stringify(argvLib)};
const during = process.env.MSYS_NO_PATHCONV ?? null;
restoreShellEnv(process.env);
const e = process.env;
console.log(JSON.stringify({ argv: process.argv.slice(2), during, after: [e.MSYS_NO_PATHCONV ?? null, e.MSYS2_ARG_CONV_EXCL ?? null, e.GODSPEED_HEADACHE_PATHCONV_WAS ?? null] }));
`);
  const bin = path.join(d, "bin"); fs.mkdirSync(bin);
  const sh = P.launchers(app, "win32")[0]; fs.writeFileSync(path.join(bin, sh.name), sh.body, { mode: sh.mode });
  const call = (pre) => {
    const r = spawnSync(gitBash(), ["-c", `${pre} "$1/godspeed-headache" "/ right side"`, "call", bin.replace(/\\/g, "/")], { encoding: "utf8", windowsHide: true });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  assert.deepEqual(call("unset MSYS_NO_PATHCONV MSYS2_ARG_CONV_EXCL;"), { argv: ["/ right side"], during: "1", after: [null, null, null] });
  assert.deepEqual(call("unset MSYS_NO_PATHCONV; export MSYS2_ARG_CONV_EXCL='/c';"), { argv: ["/ right side"], during: "1", after: [null, "/c", null] });
});

test("cmd.exe started by a program (shell: true, nothing quoted): a cut line saves nothing; a words file goes through", { skip: !isWin && "Windows only" }, () => {
  const s = sandbox();
  const env = { ...s.env, PATH: `${s.bin};${process.env.PATH}` };
  const cut = spawnSync("godspeed-headache", ["start", "--words", "line one\nline two", "--source", "desk"], { shell: true, encoding: "utf8", env, windowsHide: true });
  assert.equal(cut.status, 1, cut.stdout + cut.stderr); assert.match(cut.stderr, /cut short/);
  assert.deepEqual(readEntries(s.mc), []);
  const viaFile = spawnSync("godspeed-headache", ["start", "--words-file", `"${s.wordsFile}"`, "--source", "desk"], { shell: true, encoding: "utf8", env, windowsHide: true });
  assert.equal(viaFile.status, 0, viaFile.stdout + viaFile.stderr);
  assert.deepEqual(readEntries(s.mc).map((e) => [e.kind, e.words, e.source]), [["start", WORDS, "desk"]]);
});
