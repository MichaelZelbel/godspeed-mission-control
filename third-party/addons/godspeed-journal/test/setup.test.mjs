import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { claudeHookMerge, tickScript, hermesArgs, wantTick, telegramConfigured } from "../lib/setup.mjs";
import * as P from "../lib/paths.mjs";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "godspeed-journal.mjs");
const isWin = process.platform === "win32";
const VERSION = JSON.parse(fs.readFileSync(path.join(path.dirname(BIN), "..", "package.json"), "utf8")).version;

test("claude hook merges into existing settings once, writing whatever command it is given", () => {
  const abs = '"/opt/godspeed-journal/bin/godspeed-journal.cmd" context --hook claude';
  const merged = JSON.parse(claudeHookMerge(JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "x" }] }] } }), abs));
  assert.equal(merged.hooks.Stop.length, 1);
  assert.match(JSON.stringify(merged.hooks.UserPromptSubmit), /godspeed-journal\.cmd\\" context --hook claude/);
  assert.equal(claudeHookMerge(JSON.stringify(merged), abs), null);
  // an old, bare hook from an earlier version still counts as already there, so setup never
  // writes a second hook line next to it.
  const bareAlready = JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "godspeed-journal context --hook claude" }] }] } });
  assert.equal(claudeHookMerge(bareAlready, abs), null);
  assert.match(claudeHookMerge("", abs), /UserPromptSubmit/);
});

test("tick script, hermes args and the one-tick-host rule", () => {
  assert.match(tickScript("/home/a/.local/bin/godspeed-journal", "/home/a/godspeed"), /exec "\/home\/a\/\.local\/bin\/godspeed-journal" tick --godspeed "\/home\/a\/godspeed"/);
  assert.deepEqual(hermesArgs("godspeed"), ["-p", "godspeed"]); assert.deepEqual(hermesArgs(undefined), []);
  assert.equal(wantTick({ tick_host: "" }, "vps"), "register");
  assert.equal(wantTick({ tick_host: "vps" }, "vps"), "already-here");
  assert.equal(wantTick({ tick_host: "vps" }, "laptop"), "other-host");
});

test("telegramConfigured reads the config value or the profile env file, never both required", () => {
  assert.equal(telegramConfigured("", ""), false);
  assert.equal(telegramConfigured("null", "TELEGRAM_BOT_TOKEN="), false);
  assert.equal(telegramConfigured("", "OTHER=1\nTELEGRAM_BOT_TOKEN=123:abc\n"), true);
  assert.equal(telegramConfigured("{enabled: true}", ""), true);
});

test("setup with no Hermes and no git: recipe, settings, command, and it is repeatable", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hj-setup-"));
  const mcDir = path.join(home, "godspeed"); fs.mkdirSync(mcDir); fs.writeFileSync(path.join(mcDir, "AGENTS.md"), "");
  fs.mkdirSync(path.join(mcDir, ".claude"), { recursive: true });
  const env = { ...process.env, HOME: home, USERPROFILE: home, GODSPEED_JOURNAL_APP: path.join(home, ".godspeed-journal"), PATH: process.env.PATH };
  const args = [BIN, "setup", "--godspeed", mcDir, "--yes", "--no-hermes", "--timezone", "Europe/Berlin", "--language", "en", "--nudges", "off", "--evening", "on"];
  const r1 = spawnSync(process.execPath, args, { encoding: "utf8", env });
  assert.equal(r1.status, 0, r1.stdout + r1.stderr);
  assert.ok(fs.existsSync(path.join(mcDir, "skills", "interstitial-journal", "SKILL.md")));
  assert.match(r1.stdout, /✓ godspeed-journal command/);
  const s = JSON.parse(fs.readFileSync(path.join(mcDir, "routines", "journal", "settings.json"), "utf8"));
  assert.equal(s.timezone, "Europe/Berlin"); assert.equal(s.nudge.enabled, false); assert.equal(s.evening.enabled, true);

  // The Claude Code hook writes the absolute launcher path, not a bare command that only
  // works when the launcher's folder happens to be on PATH.
  const claudeText = fs.readFileSync(path.join(mcDir, ".claude", "settings.json"), "utf8");
  const launcher = path.join(P.binDir(home), "godspeed-journal").replace(/\\/g, "/");
  assert.ok(claudeText.includes(launcher), claudeText);
  assert.match(claudeText, /context --hook claude/);

  fs.writeFileSync(path.join(mcDir, "routines", "journal", "settings.json"), JSON.stringify({ ...s, length: "long" }));
  const r2 = spawnSync(process.execPath, args, { encoding: "utf8", env });
  assert.equal(r2.status, 0);
  assert.match(r2.stdout, /✓ godspeed-journal command/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(mcDir, "routines", "journal", "settings.json"), "utf8")).length, "long");
});

test("a person's own uncommitted .claude/settings.json edits never ride into the install commit", () => {
  const git = (cwd, ...a) => spawnSync("git", a, { cwd, encoding: "utf8" });
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hj-setup3-"));
  const mcDir = path.join(home, "godspeed"); fs.mkdirSync(mcDir);
  fs.writeFileSync(path.join(mcDir, "AGENTS.md"), "");
  fs.mkdirSync(path.join(mcDir, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(mcDir, ".claude", "settings.json"), JSON.stringify({ hooks: {} }));
  git(mcDir, "init", "-b", "main");
  git(mcDir, "config", "user.email", "t@t"); git(mcDir, "config", "user.name", "t");
  git(mcDir, "add", "."); git(mcDir, "commit", "-m", "init");
  fs.writeFileSync(path.join(mcDir, ".claude", "settings.json"), JSON.stringify({ hooks: {}, permissions: {} }));

  const env = { ...process.env, HOME: home, USERPROFILE: home, GODSPEED_JOURNAL_APP: path.join(home, ".godspeed-journal") };
  const args = [BIN, "setup", "--godspeed", mcDir, "--yes", "--no-hermes", "--timezone", "Europe/Berlin", "--language", "en", "--nudges", "off"];
  const r = spawnSync(process.execPath, args, { encoding: "utf8", env });
  assert.equal(r.status, 0, r.stdout + r.stderr);

  const claudeText = fs.readFileSync(path.join(mcDir, ".claude", "settings.json"), "utf8");
  assert.match(claudeText, /context --hook claude/);
  assert.match(claudeText, /godspeed-journal/);
  assert.doesNotMatch(claudeText, /\.cmd/);
  assert.match(claudeText, /"permissions"/);
  assert.equal(git(mcDir, "log", "-1", "--format=%s").stdout.trim(), `Install godspeed-journal ${VERSION}`);
  assert.doesNotMatch(git(mcDir, "show", "--name-only", "--format=", "HEAD").stdout, /\.claude[\\/]settings\.json/);
  assert.notEqual(git(mcDir, "status", "--porcelain", "--", ".claude/settings.json").stdout.trim(), "");
});

test("check creates the journal folder itself before probing whether it is writable", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hj-check-"));
  const mcDir = path.join(home, "godspeed"); fs.mkdirSync(mcDir);
  fs.writeFileSync(path.join(mcDir, "AGENTS.md"), "");
  const env = { ...process.env, HOME: home, USERPROFILE: home, GODSPEED_JOURNAL_APP: path.join(home, ".godspeed-journal") };
  const r = spawnSync(process.execPath, [BIN, "check", "--godspeed", mcDir, "--no-hermes"], { encoding: "utf8", env });
  assert.match(r.stdout, /✓ journal folder writable/, r.stdout + r.stderr);
});

test("a recipe the person wrote under the same name is left alone", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "hj-setup2-"));
  const mcDir = path.join(home, "godspeed"); fs.mkdirSync(path.join(mcDir, "skills", "interstitial-journal"), { recursive: true });
  fs.writeFileSync(path.join(mcDir, "AGENTS.md"), ""); fs.writeFileSync(path.join(mcDir, "skills", "interstitial-journal", "SKILL.md"), "mine");
  const env = { ...process.env, HOME: home, USERPROFILE: home, GODSPEED_JOURNAL_APP: path.join(home, ".godspeed-journal") };
  const r = spawnSync(process.execPath, [BIN, "setup", "--godspeed", mcDir, "--yes", "--no-hermes"], { encoding: "utf8", env });
  assert.equal(fs.readFileSync(path.join(mcDir, "skills", "interstitial-journal", "SKILL.md"), "utf8"), "mine");
  assert.match(r.stdout, /left alone/i);
});
