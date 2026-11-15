import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { claudeHookMerge, gateScript, tickScript, wantTick, telegramConfigured, TALK_PROMPT, ps1Allowed, powershellPolicies } from "../lib/setup.mjs";
import * as P from "../lib/paths.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BIN = path.join(ROOT, "bin", "godspeed-coach.mjs");

test("scripts, prompt and the one-host rule", () => {
  assert.match(gateScript("/home/a/.local/bin/godspeed-coach", "/home/a/godspeed"), /exec "\/home\/a\/\.local\/bin\/godspeed-coach" gate --godspeed "\/home\/a\/godspeed"/);
  assert.match(tickScript("/b/godspeed-coach", "/m"), /exec "\/b\/godspeed-coach" tick --godspeed "\/m"/);
  assert.match(TALK_PROMPT, /ends with how to open it/);
  assert.equal(wantTick({ tick_host: "" }, "vps"), "register");
  assert.equal(wantTick({ tick_host: "vps" }, "laptop"), "other-host");
  assert.equal(telegramConfigured("", "TELEGRAM_BOT_TOKEN=1:a\n"), true);
  assert.equal(claudeHookMerge(JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ command: "x/godspeed-coach context" }] }] } }), "y"), null);
  assert.match(claudeHookMerge("", '"/b/godspeed-coach" context --hook claude'), /UserPromptSubmit/);
});

test("the Linux launcher names the Node that ran setup; Windows keeps node", () => {
  const linux = P.launchers("/home/ai/.godspeed-coach/app", "linux", { nodeBin: "/home/ai/.hermes/tools/node-26.7.0-linux-x64/bin/node", ps1: true });
  assert.deepEqual(linux.map((l) => l.name), ["godspeed-coach"], "no .cmd or .ps1 off Windows");
  assert.equal(linux[0].body, '#!/bin/sh\nexec "/home/ai/.hermes/tools/node-26.7.0-linux-x64/bin/node" "/home/ai/.godspeed-coach/app/bin/godspeed-coach.mjs" "$@"\n');
  assert.match(P.launchers("C:\\app", "win32")[0].body, /\nMSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='\*' exec node "C:\/app\/bin\/godspeed-coach\.mjs" "\$@"\n$/);
});

test("the one-line installer finds Hermes' own Node and reads questions from the terminal", () => {
  const s = fs.readFileSync(path.join(ROOT, "install.sh"), "utf8");
  assert.match(s, /\$HOME"\/\.hermes\/tools\/node-\*\/bin\/node/);
  assert.match(s, /setup "\$@" < \/dev\/tty/);
  assert.match(s, /codeload\.github\.com\/MichaelZelbel\/godspeed-coach/);
});

test("setup without Hermes: recipe, settings, command, hook, and it is repeatable", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "coach-setup-"));
  const mcDir = path.join(home, "godspeed"); fs.mkdirSync(path.join(mcDir, ".claude"), { recursive: true }); fs.writeFileSync(path.join(mcDir, "AGENTS.md"), "");
  // A stand-in hermes that leaves a mark if anything calls it: --no-hermes never asks Hermes.
  const fake = path.join(home, "fakebin"); fs.mkdirSync(fake);
  const mark = path.join(home, "hermes-was-called");
  fs.writeFileSync(path.join(fake, "hermes.cmd"), `@echo off\r\necho x> "${mark}"\r\n`);
  fs.writeFileSync(path.join(fake, "hermes"), `#!/bin/sh\necho x > "${mark}"\n`, { mode: 0o755 });
  const env = { ...process.env, HOME: home, USERPROFILE: home, GODSPEED_COACH_APP: path.join(home, ".godspeed-coach"), PATH: `${fake}${path.delimiter}${process.env.PATH}` };
  const args = [BIN, "setup", "--godspeed", mcDir, "--yes", "--no-hermes", "--timezone", "Europe/Berlin", "--language", "en"];
  const r1 = spawnSync(process.execPath, args, { encoding: "utf8", env });
  assert.equal(r1.status, 0, r1.stdout + r1.stderr);
  assert.equal(fs.existsSync(mark), false, "hermes was called");
  if (process.platform === "win32") {
    // The PowerShell launcher exists exactly where PowerShell would run it.
    assert.equal(fs.existsSync(path.join(P.binDir(home), "godspeed-coach.ps1")), ps1Allowed(powershellPolicies()), r1.stdout);
    assert.match(fs.readFileSync(path.join(P.binDir(home), "godspeed-coach.cmd"), "utf8"), /--end-of-cmd-args/);
  }
  assert.ok(fs.existsSync(path.join(mcDir, "skills", "coach", "SKILL.md")));
  assert.ok(fs.existsSync(path.join(mcDir, "coach", "README.md")));
  assert.equal(JSON.parse(fs.readFileSync(path.join(mcDir, "coach", "settings.json"), "utf8")).timezone, "Europe/Berlin");
  assert.ok(fs.readFileSync(path.join(mcDir, ".claude", "settings.json"), "utf8").includes(path.join(P.binDir(home), "godspeed-coach").replace(/\\/g, "/")));
  fs.writeFileSync(path.join(mcDir, "coach", "settings.json"), JSON.stringify({ timezone: "Europe/Berlin", language: "de" }));
  const r2 = spawnSync(process.execPath, args, { encoding: "utf8", env });
  assert.equal(r2.status, 0, r2.stdout + r2.stderr);
  assert.equal(JSON.parse(fs.readFileSync(path.join(mcDir, "coach", "settings.json"), "utf8")).language, "de", "kept");
});

test("the Hermes plugin compiles", () => {
  const py = spawnSync("python3", ["--version"]).status === 0 ? "python3" : spawnSync("python", ["--version"]).status === 0 ? "python" : null;
  if (!py) return;
  const r = spawnSync(py, ["-c", `import ast,sys; ast.parse(open(sys.argv[1],encoding="utf-8").read())`, path.join(ROOT, "hermes", "plugin", "godspeed-coach", "__init__.py")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
});

// This repository is private: a stranger who reads the README gets the coach with Godspeed
// Mission Control, which is public. Only the maintainer's note at the end names this repository.
test("the README sends a stranger to Godspeed Mission Control, never to this private repository", () => {
  const readme = fs.readFileSync(path.join(ROOT, "README.md"), "utf8");
  const [forReaders, forMaintainer = ""] = readme.split("\n## For the maintainer\n");
  assert.doesNotMatch(forReaders, /MichaelZelbel\/godspeed-coach|teach-it-once-kit/);
  assert.match(forReaders, /^git clone --depth 1 https:\/\/github\.com\/MichaelZelbel\/godspeed-mission-control\.git$/m);
  assert.match(forReaders, /^node godspeed-mission-control\/third-party\/addons\/godspeed-coach\/bin\/godspeed-coach\.mjs setup --godspeed <your mission control folder>$/m);
  assert.match(forMaintainer, /^npx --yes github:MichaelZelbel\/godspeed-coach setup/m);
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.deepEqual(pkg.repository, { type: "git", url: "https://github.com/MichaelZelbel/godspeed-mission-control.git", directory: "third-party/addons/godspeed-coach" });
});
