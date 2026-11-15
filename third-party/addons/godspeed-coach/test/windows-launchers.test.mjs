// End to end on Windows: the launchers setup writes, called the way an assistant calls them, from
// PowerShell (5.1 and 7), Git Bash, and through cmd.exe. A talk's opening and the person's words
// with line breaks, quotes, $, % and umlauts arrive whole, every flag after them arrives too, and
// the one way in that cannot carry a line break (cmd.exe) refuses instead of saving half. Through
// the .cmd launcher alone, a multi-line argument lost its words and every flag after it, silently
// (2026-10-11, the journal).
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as P from "../lib/paths.mjs";
import { localParts } from "../lib/clock.mjs";
import { area } from "./helpers.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const WORDS = 'From your coach, your weekly health talk:\n\nI said "tired", it cost $5, 100% %PATH% & more | Grüße ß \\ back\n/ stretched twice\nlast line';
const oneLine = (w) => w.replace(/\s+/g, " ").trim();

function sandbox() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "coach-win-"));
  const bin = path.join(d, "bin"); fs.mkdirSync(bin);
  for (const l of P.launchers(ROOT, "win32", { ps1: true })) fs.writeFileSync(path.join(bin, l.name), l.body, { mode: l.mode });
  const mc = path.join(d, "mc"); fs.mkdirSync(path.join(mc, "coach", "health"), { recursive: true });
  fs.writeFileSync(path.join(mc, "AGENTS.md"), "");
  fs.writeFileSync(path.join(mc, "coach", "settings.json"), JSON.stringify({ timezone: "Europe/Berlin", git_sync: "off" }));
  fs.writeFileSync(path.join(mc, "coach", "health", "area.md"), area());
  const home = path.join(d, "home"); fs.mkdirSync(home);
  const wordsFile = path.join(d, "words.txt"); fs.writeFileSync(wordsFile, WORDS);
  // A cut command line loses --godspeed too; the mission control folder then comes from the
  // environment, so it points at this sandbox and never at a real coach.
  const env = { ...process.env, GODSPEED_COACH_DIR: mc, HOME: home, USERPROFILE: home, GODSPEED_COACH_GIT_SYNC: "off", GODSPEED_COACH_APP: path.join(d, "app") };
  return { d, bin, mc, wordsFile, env };
}
const today = () => localParts(new Date(), "Europe/Berlin").date;
const talk = (mc) => fs.readFileSync(path.join(mc, "coach", "health", "talks", `${today()}.md`), "utf8");
const found = (exe) => spawnSync(exe, ["-NoProfile", "-NonInteractive", "-Command", "1"], { windowsHide: true }).status === 0;

const PS_SCRIPT = `param($Bin, $WordsFile)
$env:PATH = "$Bin;" + $env:PATH
$w = [IO.File]::ReadAllText($WordsFile, [Text.Encoding]::UTF8)
"resolved:" + (Get-Command godspeed-coach).Source
godspeed-coach talk open health --opening $w --read "the table"
"open-exit:$LASTEXITCODE"
godspeed-coach talk said health --words $w --json
"said-exit:$LASTEXITCODE"
godspeed-coach habit add health head-lifts --title "Head lifts" --days mon,wed,fri
"add-exit:$LASTEXITCODE"
godspeed-coach.cmd talk said health --words $w
"cmd-exit:$LASTEXITCODE"
`;

for (const exe of ["powershell.exe", "pwsh.exe"]) {
  test(`${exe}: a multi-line opening and words, and every flag after them, arrive whole; the .cmd refuses`, { skip: !isWin ? "Windows only" : !found(exe) && `${exe} not installed` }, () => {
    const s = sandbox();
    const script = path.join(s.d, "call.ps1"); fs.writeFileSync(script, "﻿" + PS_SCRIPT);
    const r = spawnSync(exe, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Bin", s.bin, "-WordsFile", s.wordsFile],
      { encoding: "utf8", env: s.env, windowsHide: true, timeout: 120000 });
    const out = r.stdout + r.stderr;
    assert.match(out, /resolved:.*godspeed-coach\.ps1/, out);
    assert.match(out, /open-exit:0/, out); assert.match(out, /said-exit:0/, out); assert.match(out, /add-exit:0/, out);
    assert.match(out, /"ok":true/, out);
    assert.match(out, /cmd-exit:1/, out); assert.match(out, /cut short/, out);
    const t = talk(s.mc);
    assert.ok(t.includes(`## The opening\n${WORDS}\n`), t);
    assert.match(t, /## What was read\nthe table\n/);
    const said = t.split("## What you said\n")[1].split("\n## ")[0].trim().split("\n");
    assert.equal(said.length, 1, "the cut .cmd call added nothing");
    assert.equal(said[0].slice(8), oneLine(WORDS));
    assert.match(fs.readFileSync(path.join(s.mc, "coach", "health", "habits", "head-lifts.md"), "utf8"), /^DAYS: mon,wed,fri$/m);
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
    // Both paths in Git Bash's own form (/c/... or /tmp/...): they must still be found. A
    // --godspeed that names no mission control is refused even with GODSPEED_COACH_DIR set.
    'godspeed-coach talk open health --opening-file "$(cygpath -u "$2")" --godspeed "$(cygpath -u "$3")" || exit 11',
    'godspeed-coach talk said health --words "$w" || exit 12',
    'godspeed-coach talk said health --words "/ stretched twice" || exit 13',
    "echo resolved:$(command -v godspeed-coach)",
  ].join("\n");
  const r = spawnSync(gitBash(), ["-c", script, "call", s.bin, s.wordsFile, s.mc], { encoding: "utf8", env: s.env, windowsHide: true, timeout: 120000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /resolved:.*\/godspeed-coach$/m);
  const t = talk(s.mc);
  assert.ok(t.includes(`## The opening\n${WORDS}\n`), t);
  const said = t.split("## What you said\n")[1].split("\n## ")[0].trim().split("\n").map((l) => l.slice(8));
  assert.deepEqual(said, [oneLine(WORDS), "/ stretched twice"]);
});

test("Git Bash: the rewriting is off only for the call into node; what node starts gets the shell's own setting back", { skip: !isWin ? "Windows only" : !gitBash() && "Git Bash not found" }, () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "coach-msys-"));
  const app = path.join(d, "app"); fs.mkdirSync(path.join(app, "bin"), { recursive: true });
  const argvLib = new URL("../lib/argv.mjs", import.meta.url).href;
  fs.writeFileSync(path.join(app, "bin", "godspeed-coach.mjs"), `import { restoreShellEnv } from ${JSON.stringify(argvLib)};
const during = process.env.MSYS_NO_PATHCONV ?? null;
restoreShellEnv(process.env);
const e = process.env;
console.log(JSON.stringify({ argv: process.argv.slice(2), during, after: [e.MSYS_NO_PATHCONV ?? null, e.MSYS2_ARG_CONV_EXCL ?? null, e.GODSPEED_COACH_PATHCONV_WAS ?? null] }));
`);
  const bin = path.join(d, "bin"); fs.mkdirSync(bin);
  const sh = P.launchers(app, "win32")[0]; fs.writeFileSync(path.join(bin, sh.name), sh.body, { mode: sh.mode });
  const call = (pre) => {
    const r = spawnSync(gitBash(), ["-c", `${pre} "$1/godspeed-coach" "/ stretched twice"`, "call", bin.replace(/\\/g, "/")], { encoding: "utf8", windowsHide: true });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  assert.deepEqual(call("unset MSYS_NO_PATHCONV MSYS2_ARG_CONV_EXCL;"), { argv: ["/ stretched twice"], during: "1", after: [null, null, null] });
  assert.deepEqual(call("unset MSYS_NO_PATHCONV; export MSYS2_ARG_CONV_EXCL='/c';"), { argv: ["/ stretched twice"], during: "1", after: [null, "/c", null] });
});

test("cmd.exe started by a program (shell: true, nothing quoted): a cut line saves nothing; a file goes through", { skip: !isWin && "Windows only" }, () => {
  const s = sandbox();
  const env = { ...s.env, PATH: `${s.bin};${process.env.PATH}` };
  const cut = spawnSync("godspeed-coach", ["talk", "open", "health", "--opening", "line one\nline two", "--read", "x"], { shell: true, encoding: "utf8", env, windowsHide: true });
  assert.equal(cut.status, 1, cut.stdout + cut.stderr); assert.match(cut.stderr, /cut short/);
  assert.equal(fs.existsSync(path.join(s.mc, "coach", "health", "talks")), false);
  const viaFile = spawnSync("godspeed-coach", ["talk", "open", "health", "--opening-file", `"${s.wordsFile}"`, "--read", "x"], { shell: true, encoding: "utf8", env, windowsHide: true });
  assert.equal(viaFile.status, 0, viaFile.stdout + viaFile.stderr);
  assert.ok(talk(s.mc).includes(`## The opening\n${WORDS}\n`));
});

// Without a messenger a talk waits in the chat (test/chat-talk.test.mjs), and two flags steer that:
// --shown on a talk opened in the conversation, --scheduled on a routine's read of the block. They
// come after a multi-line opening, so through every launcher they must arrive as well.
const chatSandbox = () => {
  const s = sandbox();
  fs.writeFileSync(path.join(s.mc, "coach", "settings.json"), JSON.stringify({ timezone: "Europe/Berlin", git_sync: "off", talk_delivery: "chat" }));
  return { ...s, env: { ...s.env, GODSPEED_SCHEDULED_RUN: "" } };
};
const shownOf = (mc) => (talk(mc).match(/^SHOWN: (.+)$/m) || [])[1] || "";

test("without a messenger: --shown after a multi-line opening and context --scheduled arrive through every launcher", { skip: !isWin && "Windows only" }, () => {
  // PowerShell: the opening on the command line, --shown after it.
  for (const exe of ["powershell.exe", "pwsh.exe"].filter(found)) {
    const s = chatSandbox();
    const script = path.join(s.d, "call.ps1");
    fs.writeFileSync(script, "\ufeff" + `param($Bin, $WordsFile)
$env:PATH = "$Bin;" + $env:PATH
$w = [IO.File]::ReadAllText($WordsFile, [Text.Encoding]::UTF8)
godspeed-coach talk open health --opening $w --read "the table" --shown
"open-exit:$LASTEXITCODE"
`);
    const r = spawnSync(exe, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Bin", s.bin, "-WordsFile", s.wordsFile], { encoding: "utf8", env: s.env, windowsHide: true, timeout: 120000 });
    assert.match(r.stdout + r.stderr, /open-exit:0/, r.stdout + r.stderr);
    assert.ok(talk(s.mc).includes(`## The opening\n${WORDS}\n`), talk(s.mc));
    assert.match(shownOf(s.mc), /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/, `${exe}: --shown arrived`);
  }
  // cmd.exe: the opening from a file; a routine's read leaves the talk waiting, the person's first one shows it.
  const c = chatSandbox();
  const env = { ...c.env, PATH: `${c.bin};${process.env.PATH}` };
  const opened = spawnSync("godspeed-coach", ["talk", "open", "health", "--opening-file", `"${c.wordsFile}"`, "--read", "x"], { shell: true, encoding: "utf8", env, windowsHide: true });
  assert.equal(opened.status, 0, opened.stdout + opened.stderr);
  const routine = spawnSync("godspeed-coach", ["context", "--scheduled"], { shell: true, encoding: "utf8", env, windowsHide: true });
  assert.match(routine.stdout, /^- Open talk: Health and fitness/m, routine.stdout + routine.stderr);
  assert.equal(shownOf(c.mc), "", "a routine never uses up the once");
  const person = spawnSync("godspeed-coach", ["context"], { shell: true, encoding: "utf8", env, windowsHide: true });
  assert.match(person.stdout, /^- Waiting talk: Health and fitness/m, person.stdout + person.stderr);
  assert.notEqual(shownOf(c.mc), "");
  // Git Bash: the opening from a file in Git Bash's own path form, --shown after it.
  if (gitBash()) {
    const g = chatSandbox();
    const r = spawnSync(gitBash(), ["-c", 'export PATH="$(cygpath -u "$1"):$PATH"; godspeed-coach talk open health --opening-file "$(cygpath -u "$2")" --read x --shown', "call", g.bin, g.wordsFile], { encoding: "utf8", env: g.env, windowsHide: true, timeout: 120000 });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.ok(talk(g.mc).includes(`## The opening\n${WORDS}\n`));
    assert.notEqual(shownOf(g.mc), "", "Git Bash: --shown arrived");
  }
});
