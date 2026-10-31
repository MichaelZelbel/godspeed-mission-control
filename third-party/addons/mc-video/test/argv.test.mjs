// What mc-video is given arrives whole, or it refuses: how the launchers hand the arguments over
// (bin/argv.mjs), and which PowerShell gets its own launcher.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { decodeArgv, ps1Allowed, ARGV_FLAG, CMD_END, LAUNCHER_ENV, CMDLINE_ENV, CUT_MESSAGE } from "../bin/argv.mjs";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "mc-video.mjs");
const TEXT = 'Welcome back.\n\nI said "three things", it cost $5, 100% %PATH% & more | Grüße ß \\ back\n/start of a line\nlast line';
const b64 = (list) => Buffer.from(JSON.stringify(list), "utf8").toString("base64");

test("--argv-base64 hands over every argument unchanged, line breaks, quotes and empty ones included", () => {
  const list = ["hyperframes", "tts", TEXT, "-o", "C:\\v\\narration.wav", ""];
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
  const env = { [LAUNCHER_ENV]: "cmd", [CMDLINE_ENV]: 'cmd.exe /c ""mc-video.cmd" captions "C:\\v\\clip.mp4""' };
  assert.deepEqual(decodeArgv(["captions", "C:\\v\\clip.mp4", CMD_END], env), { argv: ["captions", "C:\\v\\clip.mp4"] });
  assert.deepEqual(decodeArgv([CMD_END], env), { argv: [] });
  assert.equal(decodeArgv(["hyperframes", "tts", `line one ${CMD_END}`], env).error, CUT_MESSAGE);
  assert.equal(decodeArgv(["hyperframes", "tts", "a"], env).error, CUT_MESSAGE);
  const unquoted = { [LAUNCHER_ENV]: "cmd", [CMDLINE_ENV]: 'cmd.exe /d /s /c "mc-video hyperframes tts line one\nline two -o x.wav"' };
  assert.equal(decodeArgv(["hyperframes", "tts", "line", "one", CMD_END], unquoted).error, CUT_MESSAGE);
});

test("without a launcher marker the arguments are taken as they are", () => {
  assert.deepEqual(decodeArgv(["hyperframes", "tts", "a\nb"], {}), { argv: ["hyperframes", "tts", "a\nb"] });
});

test("a line the .cmd launcher saw cut runs nothing and says why", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "mcv-argv-"));
  const r = spawnSync(process.execPath, [BIN, "hyperframes", "tts", `line one ${CMD_END}`], { encoding: "utf8", windowsHide: true,
    env: { ...process.env, GODSPEED_VIDEO_HOME: home, [LAUNCHER_ENV]: "cmd", [CMDLINE_ENV]: "x" } });
  assert.equal(r.status, 1); assert.match(r.stderr, /^error: nothing was run: .*cut short/);
  assert.doesNotMatch(r.stderr, /HyperFrames is not installed/, "refused before anything else was looked at");
});

test("the PowerShell launcher is written only where every PowerShell runs scripts", () => {
  assert.equal(ps1Allowed([{ exe: "powershell.exe", policy: "RemoteSigned" }, { exe: "pwsh.exe", policy: "Unrestricted" }]), true);
  assert.equal(ps1Allowed([{ exe: "powershell.exe", policy: "Bypass\r\n" }]), true);
  assert.equal(ps1Allowed([{ exe: "powershell.exe", policy: "Restricted" }, { exe: "pwsh.exe", policy: "RemoteSigned" }]), false);
  assert.equal(ps1Allowed([{ exe: "powershell.exe", policy: "AllSigned" }]), false);
  assert.equal(ps1Allowed([{ exe: "powershell.exe", policy: "unknown" }]), false);
  assert.equal(ps1Allowed([]), false);
});
