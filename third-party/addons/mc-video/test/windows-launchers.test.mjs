// End to end on Windows: the launchers setup writes, called the way an assistant calls them, from
// PowerShell (5.1 and 7), Git Bash, and through cmd.exe. A script for `mc-video hyperframes tts`
// with line breaks, quotes, $, % and umlauts reaches HyperFrames whole, every flag after it
// arrives too, and the one way in that cannot carry a line break (cmd.exe) refuses instead of
// running half a command. A stand-in HyperFrames writes down exactly what it was handed.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as L from "../bin/lib.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const isWin = process.platform === "win32";
const TEXT = 'Welcome back.\n\nI said "three things", it cost $5, 100% %PATH% & more | Grüße ß \\ back\n/start of a line\nlast line';

function sandbox() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "mcv-win-"));
  const bin = path.join(d, "bin"); fs.mkdirSync(bin);
  for (const l of L.launchers(ROOT, "win32", { ps1: true })) fs.writeFileSync(path.join(bin, l.name), l.body, { mode: l.mode });
  const home = path.join(d, "mc-video-home");
  const hf = path.join(home, "hyperframes", "node_modules", "hyperframes");
  fs.mkdirSync(path.join(hf, "bin"), { recursive: true });
  fs.writeFileSync(path.join(hf, "package.json"), JSON.stringify({ name: "hyperframes", version: L.HYPERFRAMES_VERSION }));
  const log = path.join(d, "hyperframes-calls.jsonl");
  fs.writeFileSync(path.join(hf, "bin", "hyperframes.mjs"),
    'import fs from "node:fs";\nfs.appendFileSync(process.env.FAKE_HF_LOG, JSON.stringify({ argv: process.argv.slice(2), launcher: process.env.MC_VIDEO_LAUNCHER ?? null }) + "\\n");\n');
  const textFile = path.join(d, "script.txt"); fs.writeFileSync(textFile, TEXT);
  const out = path.join(d, "narration.wav");
  const env = { ...process.env, GODSPEED_VIDEO_HOME: home, FAKE_HF_LOG: log };
  return { d, bin, log, textFile, out, env };
}
const calls = (s) => (fs.existsSync(s.log) ? fs.readFileSync(s.log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const found = (exe) => spawnSync(exe, ["-NoProfile", "-NonInteractive", "-Command", "1"], { windowsHide: true }).status === 0;

const PS_SCRIPT = `param($Bin, $TextFile, $Out)
$env:PATH = "$Bin;" + $env:PATH
$t = [IO.File]::ReadAllText($TextFile, [Text.Encoding]::UTF8)
"resolved:" + (Get-Command mc-video).Source
mc-video hyperframes tts $t -o $Out --voice af_heart --speed 1.0
"tts-exit:$LASTEXITCODE"
mc-video hyperframes render --format mp4,webm -o $Out
"render-exit:$LASTEXITCODE"
mc-video.cmd hyperframes tts $t -o $Out
"cmd-exit:$LASTEXITCODE"
`;

for (const exe of ["powershell.exe", "pwsh.exe"]) {
  test(`${exe}: a multi-line script and every flag after it reach HyperFrames whole; the .cmd refuses`, { skip: !isWin ? "Windows only" : !found(exe) && `${exe} not installed` }, () => {
    const s = sandbox();
    const script = path.join(s.d, "call.ps1"); fs.writeFileSync(script, "\ufeff" + PS_SCRIPT);
    const r = spawnSync(exe, ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script, "-Bin", s.bin, "-TextFile", s.textFile, "-Out", s.out],
      { encoding: "utf8", env: s.env, windowsHide: true, timeout: 120000 });
    const out = r.stdout + r.stderr;
    assert.match(out, /resolved:.*mc-video\.ps1/, out);
    assert.match(out, /tts-exit:0/, out); assert.match(out, /render-exit:0/, out);
    assert.match(out, /cmd-exit:1/, out); assert.match(out, /cut short/, out);
    assert.deepEqual(calls(s), [
      { argv: ["tts", TEXT, "-o", s.out, "--voice", "af_heart", "--speed", "1.0"], launcher: null },
      // An unquoted list reaches HyperFrames as it would have through the .cmd: one value, a,b.
      { argv: ["render", "--format", "mp4,webm", "-o", s.out], launcher: null },
    ]);
  });
}

// Git for Windows' own bash, found next to git, never whatever "bash" is on PATH (that can be WSL).
function gitBash() {
  const r = spawnSync("git", ["--exec-path"], { encoding: "utf8", windowsHide: true });
  if (r.status !== 0) return null;
  const root = path.resolve(r.stdout.trim(), "..", "..", "..");
  return ["bin/bash.exe", "usr/bin/bash.exe"].map((p) => path.join(root, p)).find((p) => fs.existsSync(p)) || null;
}

test("Git Bash: a multi-line script arrives whole, and a path given the Git Bash way reaches HyperFrames as a Windows path", { skip: !isWin ? "Windows only" : !gitBash() && "Git Bash not found" }, () => {
  const s = sandbox();
  const script = [
    'export PATH="$(cygpath -u "$1"):$PATH"',
    't="$(cat "$2")"',
    'mc-video hyperframes tts "$t" -o "$(cygpath -u "$3")" || exit 11',
    "echo resolved:$(command -v mc-video)",
  ].join("\n");
  const r = spawnSync(gitBash(), ["-c", script, "call", s.bin, s.textFile, s.out], { encoding: "utf8", env: s.env, windowsHide: true, timeout: 120000 });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /resolved:.*\/mc-video$/m);
  const [c] = calls(s);
  assert.deepEqual(c.argv.slice(0, 3), ["tts", TEXT, "-o"]);
  assert.match(c.argv[3], /^[A-Za-z]:[\\/]/, "Git Bash still turns /c/... into a path Windows can open");
  assert.equal(path.resolve(c.argv[3]).toLowerCase(), path.resolve(s.out).toLowerCase());
});

test("cmd.exe started by a program (shell: true, nothing quoted): a cut line runs nothing; a script file goes through", { skip: !isWin && "Windows only" }, () => {
  const s = sandbox();
  const env = { ...s.env, PATH: `${s.bin};${process.env.PATH}` };
  const cut = spawnSync("mc-video", ["hyperframes", "tts", "line one\nline two", "-o", "x.wav"], { shell: true, encoding: "utf8", env, windowsHide: true });
  assert.equal(cut.status, 1, cut.stdout + cut.stderr); assert.match(cut.stderr, /cut short/);
  assert.deepEqual(calls(s), []);
  const viaFile = spawnSync("mc-video", ["hyperframes", "tts", `"${s.textFile}"`, "-o", `"${s.out}"`], { shell: true, encoding: "utf8", env, windowsHide: true });
  assert.equal(viaFile.status, 0, viaFile.stdout + viaFile.stderr);
  assert.deepEqual(calls(s), [{ argv: ["tts", s.textFile, "-o", s.out], launcher: null }]);
});
