// setup and check, run against throwaway folders only: HOME and USERPROFILE point into a temp
// folder, the app copy goes to GODSPEED_CHARM_APP, Hermes is skipped, and the .claude folder is a
// temp one. Nothing here touches the real home folder, Hermes or any real settings.json.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { claudeHookMerge } from "../lib/setup.mjs";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "godspeed-charm.mjs");
const tmp = (p) => fs.mkdtempSync(path.join(os.tmpdir(), p));
const gone = (...d) => d.forEach((x) => fs.rmSync(x, { recursive: true, force: true }));

function sandbox() {
  const mc = tmp("charm-setup-mc-"), home = tmp("charm-setup-home-"), app = tmp("charm-setup-app-");
  fs.writeFileSync(path.join(mc, "AGENTS.md"), "# test\n");
  fs.mkdirSync(path.join(mc, "notebook")); fs.mkdirSync(path.join(mc, ".godspeed"));
  fs.mkdirSync(path.join(mc, ".claude")); fs.mkdirSync(path.join(mc, "skills", "other"), { recursive: true });
  fs.writeFileSync(path.join(mc, "skills", "other", "SKILL.md"), "---\nname: other\n---\n");
  return { mc, home, app };
}
function run(sb, args) {
  return spawnSync(process.execPath, [BIN, ...args, "--godspeed", sb.mc, "--no-hermes", "--yes"], {
    encoding: "utf8", timeout: 120000,
    env: { ...process.env, HOME: sb.home, USERPROFILE: sb.home, GODSPEED_CHARM_APP: sb.app, GODSPEED_CHARM_DIR: "", GODSPEED_SCHEDULED_RUN: "" },
  });
}

test("claudeHookMerge adds the hook once and leaves other hooks alone", () => {
  const cmd = '"/h/.godspeed/bin/godspeed-charm" context --hook claude';
  const first = claudeHookMerge(JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: "other" }] }] } }), cmd);
  const cfg = JSON.parse(first);
  assert.equal(cfg.hooks.UserPromptSubmit.length, 2);
  assert.equal(cfg.hooks.UserPromptSubmit[1].hooks[0].timeout, 10);
  assert.equal(claudeHookMerge(first, cmd), null);
  assert.ok(JSON.parse(claudeHookMerge("", cmd)).hooks.UserPromptSubmit[0].hooks[0].command.includes("godspeed-charm"));
});

test("setup writes recipe, settings, command, README and the hook; a second run changes nothing", () => {
  const sb = sandbox();
  try {
    const a = run(sb, ["setup", "--timezone", "Europe/Berlin", "--language", "de"]);
    assert.equal(a.status, 0, a.stdout + a.stderr);
    const recipe = path.join(sb.mc, "skills", "charm-challenge", "SKILL.md");
    assert.ok(fs.existsSync(recipe));
    assert.match(fs.readFileSync(recipe, "utf8"), /^---\nname: charm-challenge\n/);
    const settings = JSON.parse(fs.readFileSync(path.join(sb.mc, "routines", "charm", "settings.json"), "utf8"));
    assert.equal(settings.timezone, "Europe/Berlin"); assert.equal(settings.language, "de");
    assert.ok(fs.existsSync(path.join(sb.mc, "routines", "charm", "README.md")));
    const hookFile = path.join(sb.mc, ".claude", "settings.json");
    const cfg = JSON.parse(fs.readFileSync(hookFile, "utf8"));
    assert.equal(cfg.hooks.UserPromptSubmit.length, 1);
    const command = cfg.hooks.UserPromptSubmit[0].hooks[0].command;
    assert.match(command, /godspeed-charm" context --hook claude$/);
    assert.ok(!command.includes("\\"));
    assert.ok(fs.existsSync(path.join(sb.home, ".local", "bin", "godspeed-charm")) || fs.existsSync(path.join(sb.home, ".godspeed", "bin", "godspeed-charm")));
    assert.ok(fs.existsSync(path.join(sb.app, "app", "bin", "godspeed-charm.mjs")));
    const before = fs.readFileSync(hookFile, "utf8");
    const b = run(sb, ["setup"]);
    assert.equal(b.status, 0, b.stdout + b.stderr);
    assert.equal(fs.readFileSync(hookFile, "utf8"), before);
    assert.equal(JSON.parse(before).hooks.UserPromptSubmit.length, 1);
    const c = run(sb, ["check"]);
    assert.equal(c.status, 0, c.stdout + c.stderr);
    assert.match(c.stdout, /Claude Code hook/);
  } finally { gone(sb.mc, sb.home, sb.app); }
});

test("setup leaves a recipe the person wrote under the same name alone", () => {
  const sb = sandbox();
  try {
    const mine = path.join(sb.mc, "skills", "charm-challenge");
    fs.mkdirSync(mine, { recursive: true }); fs.writeFileSync(path.join(mine, "SKILL.md"), "mine\n");
    run(sb, ["setup"]);
    assert.equal(fs.readFileSync(path.join(mine, "SKILL.md"), "utf8"), "mine\n");
  } finally { gone(sb.mc, sb.home, sb.app); }
});

test("setup refuses a mission control without a notebook", () => {
  const sb = sandbox();
  try {
    fs.rmSync(path.join(sb.mc, "notebook"), { recursive: true });
    const r = run(sb, ["setup"]);
    assert.notEqual(r.status, 0);
    assert.ok(!fs.existsSync(path.join(sb.mc, "skills", "charm-challenge")));
  } finally { gone(sb.mc, sb.home, sb.app); }
});
