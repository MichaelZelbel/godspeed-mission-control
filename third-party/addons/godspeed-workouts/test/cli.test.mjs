import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { main } from "../lib/cli.mjs";
import { setSetting, DEFAULTS, loadSettings, saveSettings, TEXTS } from "../lib/settings.mjs";
import { cleanKey, readKey } from "../lib/keys.mjs";
import { statePaths } from "../lib/paths.mjs";
import { tmp, world } from "./helpers.mjs";
import { KEY, workout } from "./fakes/hevy.mjs";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "godspeed-workouts.mjs");
// The command as its own process. Not spawnSync: the pretend Hevy answers from this process.
function cmd(args, { input = "", env }) {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, [BIN, ...args], { env, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    c.stdout.on("data", (d) => { stdout += d; });
    c.stderr.on("data", (d) => { stderr += d; });
    c.on("close", (status) => resolve({ status, stdout, stderr }));
    c.stdin.end(input);
  });
}

test("settings are checked before they are kept", () => {
  assert.throws(() => setSetting(DEFAULTS, "minute", "0"), /1 to 58/);
  assert.throws(() => setSetting(DEFAULTS, "minute", "59"), /1 to 58/);
  assert.equal(setSetting(DEFAULTS, "minute", "33").minute, 33);
  assert.throws(() => setSetting(DEFAULTS, "timezone", "Mars/Olympus"), /not a time zone/);
  assert.deepEqual(setSetting(DEFAULTS, "talks", "Health, work").talks, ["health", "work"]);
  assert.throws(() => setSetting(DEFAULTS, "tell", "pigeon"), /telegram, desktop/);
  assert.throws(() => setSetting(DEFAULTS, "hevy_key", "x"), /no setting/);
  assert.equal(setSetting(DEFAULTS, "texts.deleted_mark", "(gone)").texts.deleted_mark, "(gone)");
});

test("only texts that differ from the defaults are written, so better wording reaches everyone", () => {
  const dir = tmp("set");
  try {
    const paths = statePaths(dir);
    saveSettings(paths, { ...loadSettings(paths), texts: { ...TEXTS, deleted_mark: "(gone)" } });
    assert.deepEqual(JSON.parse(fs.readFileSync(paths.settings, "utf8")).texts, { deleted_mark: "(gone)" });
    assert.equal(loadSettings(paths).texts.key_refused, TEXTS.key_refused);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a key is a Hevy key or nothing: a sentence or a line break never becomes one", () => {
  assert.equal(cleanKey(` ${KEY.toUpperCase()}\n`), KEY);
  assert.throws(() => cleanKey("my key is 1234"), /not a Hevy API key/);
});

test("connect takes the key from standard input, checks it with Hevy, and never prints it; status never shows it", async () => {
  const w = await world({ key: null });
  try {
    w.hevy.add(workout({ start: "2026-10-20T16:00:00Z", exercises: [{ title: "Squat", sets: [{ reps: 5, kg: 100 }] }] }));
    const env = { ...process.env, ...w.env, GODSPEED_WORKOUTS_STATE: w.paths.root };
    delete env.HEVY_API_KEY;
    const bad = await cmd(["connect"], { input: "00000000-0000-4000-8000-000000000000\n", env });
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /Hevy refused that key/);
    assert.equal(readKey(w.paths), null, "a refused key is not kept");
    const ok = await cmd(["connect"], { input: `${KEY}\n`, env });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /Hevy key saved: Hevy account Alex Example/);
    assert.match(ok.stdout, /Run: backfill: 1 added/);
    assert.equal(readKey(w.paths), KEY);
    const st = await cmd(["status"], { env });
    assert.equal(st.status, 0, st.stderr);
    assert.match(st.stdout, /Hevy key: saved/);
    assert.match(st.stdout, /Tracker: "Workouts" https:\/\/notebook.example\/collections\/workouts; 1 row\(s\) from Hevy/);
    for (const out of [ok.stdout, ok.stderr, st.stdout, fs.readFileSync(w.paths.log, "utf8"), fs.readFileSync(w.paths.state, "utf8")]) assert.ok(!out.includes(KEY));
    if (process.platform !== "win32") assert.equal(fs.statSync(w.paths.hevy).mode & 0o777, 0o600);
  } finally { await w.close(); }
});

test("help names every command", async () => {
  const out = [];
  assert.equal(await main(["help"], { print: (s) => out.push(s) }), 0);
  for (const c of ["setup", "connect", "run", "status", "settings", "uninstall"]) assert.match(out.join("\n"), new RegExp(`^  ${c} `, "m"));
});

test("uninstall returns a failure when the scheduler refuses removal", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "godspeed-workouts-uninstall-"));
  const bin = path.join(root, "bin");
  const platform = Object.getOwnPropertyDescriptor(process, "platform");
  const oldPath = process.env.PATH;
  try {
    fs.mkdirSync(bin);
    const command = path.join(bin, "powershell.exe");
    fs.writeFileSync(command, "#!/bin/sh\necho 'scheduler refused removal' >&2\nexit 1\n");
    fs.chmodSync(command, 0o755);
    Object.defineProperty(process, "platform", { ...platform, value: "win32" });
    process.env.PATH = bin + path.delimiter + oldPath;
    const out = [];
    const code = await main(["uninstall", "--state", root], { env: { ...process.env, PATH: bin + path.delimiter + process.env.PATH }, print: (line) => out.push(line) });
    assert.equal(code, 1);
    assert.match(out.join("\n"), /scheduler refused removal/);
  } finally {
    Object.defineProperty(process, "platform", platform);
    process.env.PATH = oldPath;
    fs.rmSync(root, { recursive: true, force: true });
  }
});
