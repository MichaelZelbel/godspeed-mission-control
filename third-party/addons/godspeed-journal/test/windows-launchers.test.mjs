// End to end on Windows: the launchers setup writes, called the way an assistant calls them, from
// PowerShell (5.1 and 7), Git Bash, and through cmd.exe. Words with line breaks, quotes, $, % and
// umlauts arrive whole, every flag after them arrives too, and the one way in that cannot carry
// a line break (cmd.exe) refuses instead of saving half. 2026-10-11: through the .cmd launcher
// alone, three entries lost their words, a --source and a --task.
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
const WORDS = 'Now, what do I want to achieve with this?\n\nI said "German" videos cost $50, 100% %PATH% & more | Grüße ß \\ back\n/start of a line\nlast line';
const SETTINGS = { timezone: "Europe/Berlin" };

function sandbox() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hj-win-"));
  const bin = path.join(d, "bin"); fs.mkdirSync(bin);
  for (const l of P.launchers(ROOT, "win32", { ps1: true })) fs.writeFileSync(path.join(bin, l.name), l.body, { mode: l.mode });
  const mc = path.join(d, "mc"); fs.mkdirSync(path.join(mc, "routines", "journal"), { recursive: true });
  fs.writeFileSync(path.join(mc, "AGENTS.md"), "");
  fs.writeFileSync(path.join(mc, "routines", "journal", "settings.json"), JSON.stringify({ timezone: "Europe/Berlin", git_sync: "off" }));
  const home = path.join(d, "home"); fs.mkdirSync(home);
  const wordsFile = path.join(d, "words.txt"); fs.writeFileSync(wordsFile, WORDS);
  // A cut command line loses --godspeed too; the mission control folder then comes from the
  // environment, so it points at this sandbox and never at a real journal.
  const env = { ...process.env, GODSPEED_JOURNAL_DIR: mc, HOME: home, USERPROFILE: home, GODSPEED_JOURNAL_GIT_SYNC: "off" };
  return { d, bin, mc, wordsFile, env };
}
const entries = (mc) => readEntries(mc, SETTINGS, { days: 2 });
const found = (exe) => spawnSync(exe, ["-NoProfile", "-NonInteractive", "-Command", "1"], { windowsHide: true }).status === 0;

const PS_SCRIPT = `param($Bin, $WordsFile)
$env:PATH = "$Bin;" + $env:PATH
$w = [IO.File]::ReadAllText($WordsFile, [Text.Encoding]::UTF8)
"resolved:" + (Get-Command godspeed-journal).Source
godspeed-journal start "German audio" --done-means "uploaded" --source desk
"start-exit:$LASTEXITCODE"
godspeed-journal define german --done-means captions,thumbnail --source desk
"define-exit:$LASTEXITCODE"
godspeed-journal note $w --task german --source desk
"note-exit:$LASTEXITCODE"
godspeed-journal done german --met uploaded --words $w --source desk
"done-exit:$LASTEXITCODE"
godspeed-journal.cmd note $w --task german --source cmd-cut
"cmd-exit:$LASTEXITCODE"
`;

for (const exe of ["powershell.exe", "pwsh.exe"]) {
  test(`${exe}: multi-line words and every flag after them arrive whole; the .cmd refuses`, { skip: !isWin ? "Windows only" : !found(exe) && `${exe} not installed` }, () => {
    const s = sandbox();
    const script = path.join(s.d, "call.ps1"); fs.writeFileSync(script, "﻿" + PS_SCRIPT);
    const r = spawnSync(exe, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Bin", s.bin, "-WordsFile", s.wordsFile],
      { encoding: "utf8", env: s.env, windowsHide: true, timeout: 120000 });
    const out = r.stdout + r.stderr;
    assert.match(out, /resolved:.*godspeed-journal\.ps1/, out);
    assert.match(out, /start-exit:0/, out); assert.match(out, /define-exit:0/, out);
    assert.match(out, /note-exit:0/, out); assert.match(out, /done-exit:0/, out);
    assert.match(out, /cmd-exit:1/, out); assert.match(out, /cut short/, out);
    const es = entries(s.mc);
    assert.deepEqual(es.map((e) => [e.kind, e.source, e.task]), [
      ["start", "desk", es[0].task], ["define", "desk", es[0].task], ["note", "desk", es[0].task], ["done", "desk", es[0].task]]);
    // An unquoted list reaches the command as it would have through the .cmd: one value, a,b.
    assert.deepEqual(es[1].done_means, ["captions,thumbnail"]);
    assert.equal(es[2].words, WORDS); assert.equal(es[3].words, WORDS);
    assert.deepEqual(es[3].met, ["uploaded"]);
  });
}

// Git for Windows' own bash, found next to git, never whatever "bash" is on PATH (that can be WSL).
function gitBash() {
  const r = spawnSync("git", ["--exec-path"], { encoding: "utf8", windowsHide: true });
  if (r.status !== 0) return null;
  const root = path.resolve(r.stdout.trim(), "..", "..", "..");
  return ["bin/bash.exe", "usr/bin/bash.exe"].map((p) => path.join(root, p)).find((p) => fs.existsSync(p)) || null;
}

test("Git Bash: multi-line words and a word starting with / arrive unchanged", { skip: !isWin ? "Windows only" : !gitBash() && "Git Bash not found" }, () => {
  const s = sandbox();
  const script = [
    'export PATH="$(cygpath -u "$1"):$PATH"',
    'w="$(cat "$2")"',
    'godspeed-journal start "German audio" --source desk || exit 11',
    'godspeed-journal note "$w" --task german --source desk || exit 12',
    'godspeed-journal note "/start the day" --task german --source desk || exit 13',
    // Paths the Git Bash way still work for the flags that take a path: a /c/... folder and a
    // /tmp/... words file. --godspeed given and not found never falls back to another folder.
    'mc="$3"; tmpw="/tmp/hj-words-$$.txt"; printf "from /tmp\\nsecond line" > "$tmpw"',
    'godspeed-journal note --words-file "$tmpw" --godspeed "$mc" --source desk-tmp || exit 14',
    'godspeed-journal note --words-file "$(cygpath -u "$2")" --godspeed "$mc" --source desk-c || exit 15',
    'rm -f "$tmpw"',
    "echo resolved:$(command -v godspeed-journal)",
  ].join("\n");
  // The folder in the /c/... form (cygpath -u would give /tmp/... for a folder under Temp).
  const driveForm = `/${s.mc[0].toLowerCase()}${s.mc.slice(2).replace(/\\/g, "/")}`;
  const r = spawnSync(gitBash(), ["-c", script, "call", s.bin, s.wordsFile, driveForm], { encoding: "utf8", env: s.env, windowsHide: true, timeout: 120000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /resolved:.*\/godspeed-journal$/m);
  const es = entries(s.mc);
  assert.deepEqual(es.map((e) => [e.kind, e.words, e.source]), [
    ["start", "German audio", "desk"], ["note", WORDS, "desk"], ["note", "/start the day", "desk"],
    ["note", "from /tmp\nsecond line", "desk-tmp"], ["note", WORDS, "desk-c"]]);
});

test("Git Bash: the rewriting is off only for the call into node; what node starts gets the shell's own setting back", { skip: !isWin ? "Windows only" : !gitBash() && "Git Bash not found" }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "hj-msys-"));
  const app = path.join(d, "app"); fs.mkdirSync(path.join(app, "bin"), { recursive: true });
  const argvLib = new URL("../lib/argv.mjs", import.meta.url).href;
  fs.writeFileSync(path.join(app, "bin", "godspeed-journal.mjs"), `import { restoreShellEnv } from ${JSON.stringify(argvLib)};
const during = process.env.MSYS_NO_PATHCONV ?? null;
restoreShellEnv(process.env);
const e = process.env;
console.log(JSON.stringify({ argv: process.argv.slice(2), during, after: [e.MSYS_NO_PATHCONV ?? null, e.MSYS2_ARG_CONV_EXCL ?? null, e.GODSPEED_JOURNAL_PATHCONV_WAS ?? null] }));
`);
  const bin = path.join(d, "bin"); fs.mkdirSync(bin);
  const sh = P.launchers(app, "win32")[0]; fs.writeFileSync(path.join(bin, sh.name), sh.body, { mode: sh.mode });
  const call = (pre) => {
    const r = spawnSync(gitBash(), ["-c", `${pre} "$1/godspeed-journal" "/start the day"`, "call", bin.replace(/\\/g, "/")], { encoding: "utf8", windowsHide: true });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  assert.deepEqual(call("unset MSYS_NO_PATHCONV MSYS2_ARG_CONV_EXCL;"), { argv: ["/start the day"], during: "1", after: [null, null, null] });
  assert.deepEqual(call("unset MSYS_NO_PATHCONV; export MSYS2_ARG_CONV_EXCL='/c';"), { argv: ["/start the day"], during: "1", after: [null, "/c", null] });
});

test("cmd.exe started by a program (shell: true, nothing quoted): a cut line saves nothing; a words file goes through", { skip: !isWin && "Windows only" }, () => {
  const s = sandbox();
  const env = { ...s.env, PATH: `${s.bin};${process.env.PATH}` };
  assert.equal(spawnSync("godspeed-journal", ["start", "German", "--source", "desk"], { shell: true, encoding: "utf8", env, windowsHide: true }).status, 0);
  const cut = spawnSync("godspeed-journal", ["note", "line one\nline two", "--task", "german"], { shell: true, encoding: "utf8", env, windowsHide: true });
  assert.equal(cut.status, 1, cut.stdout + cut.stderr); assert.match(cut.stderr, /cut short/);
  const viaFile = spawnSync("godspeed-journal", ["note", "--words-file", `"${s.wordsFile}"`, "--task", "german", "--source", "desk"], { shell: true, encoding: "utf8", env, windowsHide: true });
  assert.equal(viaFile.status, 0, viaFile.stdout + viaFile.stderr);
  const es = entries(s.mc);
  assert.deepEqual(es.map((e) => [e.kind, e.words]), [["start", "German"], ["note", WORDS]]);
});
