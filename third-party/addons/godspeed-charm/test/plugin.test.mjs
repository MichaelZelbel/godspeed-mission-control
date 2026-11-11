// The Hermes plugin, run from node with python against a stub command that prints its arguments.
// Skipped when this computer has no python.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN = path.join(HERE, "..", "hermes", "plugin", "godspeed-charm");
const PY = ["python3", "python"].find((p) => { const r = spawnSync(p, ["-c", "print(1)"], { encoding: "utf8" }); return r.status === 0 && r.stdout.trim() === "1"; });
const skip = PY ? false : "no python on this computer";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "charm-plugin-"));
// Loads the plugin from `folder` and calls the hook with the keyword arguments given as JSON.
const DRIVER = [
  "import importlib.util, json, sys",
  "folder, kwargs = sys.argv[1], json.loads(sys.argv[2])",
  'spec = importlib.util.spec_from_file_location("charm_plugin", folder + "/__init__.py")',
  "m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)",
  "print(json.dumps(m.on_pre_llm_call(**kwargs)))",
].join("\n");
const stub = (dir, body) => { const f = path.join(dir, "stub.mjs"); fs.writeFileSync(f, body); return f; };
const ECHO = 'console.log("[godspeed-charm] " + JSON.stringify(process.argv.slice(2)));';
function call(kwargs, { script, env = {}, folder = PLUGIN, mc } = {}) {
  const r = spawnSync(PY, ["-c", DRIVER, folder, JSON.stringify(kwargs)], {
    encoding: "utf8", timeout: 30000,
    env: { ...process.env, GODSPEED_NODE: process.execPath, GODSPEED_CHARM_SCRIPT: script, GODSPEED_CHARM_DIR: mc ?? "", GODSPEED_SCHEDULED_RUN: "", GODSPEED_CHARM_PLUGIN_TIMEOUT: "", ...env },
  });
  assert.equal(r.status, 0, r.stderr);
  const v = JSON.parse(r.stdout.trim().split("\n").pop());
  return v && v.context ? { argv: JSON.parse(v.context.replace(/^\[godspeed-charm\] /, "")) } : null;
}

test("passes the conversation as platform:session_id and the mission control folder", { skip }, () => {
  const d = tmp();
  try {
    const out = call({ platform: "telegram", session_id: "abc" }, { script: stub(d, ECHO), mc: "/some/mc" });
    assert.deepEqual(out.argv, ["context", "--godspeed", "/some/mc", "--conversation", "telegram:abc", "--program-asks"]);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("no conversation when the platform or the session id is missing", { skip }, () => {
  const d = tmp();
  try {
    const s = stub(d, ECHO);
    assert.ok(!call({ platform: "telegram" }, { script: s }).argv.includes("--conversation"));
    assert.ok(!call({ session_id: "x" }, { script: s }).argv.includes("--conversation"));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("a scheduled run (cron, or GODSPEED_SCHEDULED_RUN) is passed on as --scheduled", { skip }, () => {
  const d = tmp();
  try {
    const s = stub(d, ECHO);
    assert.ok(call({ platform: "cron", session_id: "c" }, { script: s }).argv.includes("--scheduled"));
    assert.ok(call({ platform: "telegram", session_id: "c" }, { script: s, env: { GODSPEED_SCHEDULED_RUN: "1" } }).argv.includes("--scheduled"));
    assert.ok(!call({ platform: "telegram", session_id: "c" }, { script: s }).argv.includes("--scheduled"));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("--stickers only on telegram with the sticker plugin next to this one", { skip }, () => {
  const d = tmp();
  try {
    const s = stub(d, ECHO);
    const plugins = path.join(d, "plugins"); const mine = path.join(plugins, "godspeed-charm");
    fs.cpSync(PLUGIN, mine, { recursive: true });
    const k = { platform: "telegram", session_id: "t" };
    assert.ok(!call(k, { script: s, folder: mine }).argv.includes("--stickers"));
    fs.mkdirSync(path.join(plugins, "hermes-telegram-stickers"));
    assert.ok(call(k, { script: s, folder: mine }).argv.includes("--stickers"));
    assert.ok(!call({ platform: "cli", session_id: "t" }, { script: s, folder: mine }).argv.includes("--stickers"));
    // Listed in the Hermes config: enabled counts, a config that leaves it out does not.
    fs.writeFileSync(path.join(d, "config.yaml"), "plugins:\n  enabled:\n    - godspeed-charm\n");
    assert.ok(!call(k, { script: s, folder: mine }).argv.includes("--stickers"));
    fs.writeFileSync(path.join(d, "config.yaml"), "plugins:\n  enabled:\n    - godspeed-charm\n    - hermes-telegram-stickers\n");
    assert.ok(call(k, { script: s, folder: mine }).argv.includes("--stickers"));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("--stickers reads the one-line list the notebook writes, enabled: [\"a\", \"b\"], too", { skip }, () => {
  const d = tmp();
  try {
    const s = stub(d, ECHO);
    const plugins = path.join(d, "plugins"); const mine = path.join(plugins, "godspeed-charm");
    fs.cpSync(PLUGIN, mine, { recursive: true });
    fs.mkdirSync(path.join(plugins, "hermes-telegram-stickers"));
    const k = { platform: "telegram", session_id: "t" };
    const config = (text) => fs.writeFileSync(path.join(d, "config.yaml"), text);
    config('terminal:\n  cwd: "/x"\nplugins:\n  enabled: ["godspeed-coach", "godspeed-charm", "hermes-telegram-stickers"]\n');
    assert.ok(call(k, { script: s, folder: mine }).argv.includes("--stickers"));
    config("plugins:\n  enabled: [godspeed-charm, 'hermes-telegram-stickers']  # by hand\n");
    assert.ok(call(k, { script: s, folder: mine }).argv.includes("--stickers"));
    config('plugins:\n  enabled: ["godspeed-coach", "godspeed-charm"]\n  disabled: ["hermes-telegram-stickers"]\n');
    assert.ok(!call(k, { script: s, folder: mine }).argv.includes("--stickers"));
    config("plugins:\n  enabled: []\n");
    assert.ok(!call(k, { script: s, folder: mine }).argv.includes("--stickers"));
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("returns None when the command fails, prints nothing, or takes too long", { skip }, () => {
  const d = tmp();
  try {
    const k = { platform: "telegram", session_id: "a" };
    assert.equal(call(k, { script: stub(d, "process.exit(3);") }), null);
    assert.equal(call(k, { script: stub(d, 'console.log("block"); process.exit(1);') }), null);
    assert.equal(call(k, { script: stub(d, "") }), null);
    assert.equal(call(k, { script: path.join(d, "missing.mjs") }), null);
    assert.equal(call(k, { script: stub(d, "setTimeout(() => console.log('late'), 5000);"), env: { GODSPEED_CHARM_PLUGIN_TIMEOUT: "0.5" } }), null);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

// ---- pre_tool_call: the command gets this session's conversation; a turn leaves its marker -------
const HOOKS = [
  "import importlib.util, json, sys",
  "folder, calls = sys.argv[1], json.loads(sys.argv[2])",
  'spec = importlib.util.spec_from_file_location("charm_plugin", folder + "/__init__.py")',
  "m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)",
  "h = {}",
  "class C:",
  "    def register_hook(self, n, f): h[n] = f",
  "m.register(C())",
  "print(json.dumps([h[n](**k) for n, k in calls]))",
].join("\n");
function hooks(calls, { script, env = {}, mc } = {}) {
  const r = spawnSync(PY, ["-I", "-c", HOOKS, PLUGIN, JSON.stringify(calls)], {
    encoding: "utf8", timeout: 30000,
    env: { ...process.env, GODSPEED_NODE: process.execPath, GODSPEED_CHARM_SCRIPT: script, GODSPEED_CHARM_DIR: mc ?? "", GODSPEED_SCHEDULED_RUN: "", GODSPEED_CHARM_PLUGIN_TIMEOUT: "", ...env },
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout.trim().split("\n").pop());
}
const tool = (command, session_id = "s1") => ["pre_tool_call", { tool_name: "terminal", args: { command }, session_id, turn_id: "t", task_id: "", tool_call_id: "c" }];
const turnOf = (platform, session_id) => ["pre_llm_call", { platform, session_id }];

test("pre_tool_call adds the session's conversation to asked, start and answer typed without one", { skip }, () => {
  const d = tmp();
  try {
    const out = hooks([
      turnOf("telegram", "s1"),
      tool('godspeed-charm asked --words "why this garbage"'),
      tool("godspeed-charm answer yes --words yes"),
      tool('godspeed-charm start --words "start"'),
      tool("node /x/bin/godspeed-charm.mjs asked --words x"),
    ], { script: stub(d, ECHO) });
    assert.equal(out[1].action, "modify");
    assert.equal(out[1].args.command, 'godspeed-charm asked --conversation "telegram:s1" --words "why this garbage"');
    assert.equal(out[2].args.command, 'godspeed-charm answer --conversation "telegram:s1" yes --words yes');
    assert.equal(out[3].args.command, 'godspeed-charm start --conversation "telegram:s1" --words "start"');
    assert.match(out[4].args.command, /godspeed-charm\.mjs asked --conversation "telegram:s1" --words x/);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("in a turn the Godspeed notebook runs, the block and the commands get the notebook's conversation", { skip }, () => {
  const d = tmp();
  try {
    const env = { GODSPEED_CHARM_CONVERSATION: "notebook:browser-owner" };
    const block = call({ platform: "cli", session_id: "local-1", user_message: "useless garbage" }, { script: stub(d, ECHO), mc: "/some/mc", env });
    assert.deepEqual(block.argv, ["context", "--godspeed", "/some/mc", "--conversation", "notebook:browser-owner", "--program-asks"]);
    const out = hooks([
      turnOf("cli", "local-1"),
      tool("godspeed-charm asked --words x", "local-1"),
      tool("godspeed-charm answer yes --words yes", "never-seen"),
      tool('godspeed-charm asked --conversation "telegram:other" --words x', "local-1"),
    ], { script: stub(d, ECHO), env });
    assert.equal(out[1].args.command, 'godspeed-charm asked --conversation "notebook:browser-owner" --words x');
    assert.equal(out[2].args.command, 'godspeed-charm answer --conversation "notebook:browser-owner" yes --words yes');
    assert.equal(out[3], null);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("pre_tool_call leaves an explicit --conversation, other commands and unknown sessions alone", { skip }, () => {
  const d = tmp();
  try {
    const out = hooks([
      turnOf("telegram", "s1"),
      tool('godspeed-charm asked --conversation "telegram:other" --words x'),
      tool("ls -la"),
      tool("godspeed-charm status"),
      tool("godspeed-charm asked --words x", "never-seen"),
      ["pre_tool_call", { tool_name: "web_search", args: { command: "godspeed-charm asked" }, session_id: "s1" }],
    ], { script: stub(d, ECHO) });
    for (const i of [1, 2, 3, 4, 5]) assert.equal(out[i], null, `call ${i}`);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("a cron turn, or a scheduled run, gives its commands no conversation", { skip }, () => {
  const d = tmp();
  try {
    const cron = hooks([turnOf("cron", "k1"), tool("godspeed-charm asked --words x", "k1")], { script: stub(d, ECHO) });
    assert.equal(cron[1], null);
    const sched = hooks([turnOf("telegram", "k2"), tool("godspeed-charm asked --words x", "k2")], { script: stub(d, ECHO), env: { GODSPEED_SCHEDULED_RUN: "1" } });
    assert.equal(sched[1], null);
    // a session that was telegram and then runs as cron forgets the platform
    const flip = hooks([turnOf("telegram", "k3"), turnOf("cron", "k3"), tool("godspeed-charm asked --words x", "k3")], { script: stub(d, ECHO) });
    assert.equal(flip[2], null);
  } finally { fs.rmSync(d, { recursive: true, force: true }); }
});

test("a turn through the real command leaves its marker, and a cron turn does not", { skip }, () => {
  const mc = tmp(), d = tmp();
  try {
    fs.writeFileSync(path.join(mc, "AGENTS.md"), "# t\n");
    fs.mkdirSync(path.join(mc, "notebook")); fs.mkdirSync(path.join(mc, ".godspeed"));
    fs.mkdirSync(path.join(mc, "routines", "charm"), { recursive: true });
    fs.writeFileSync(path.join(mc, "routines", "charm", "settings.json"), JSON.stringify({ version: 1, timezone: "Europe/Berlin", language: "en" }) + "\n");
    const real = path.join(HERE, "..", "bin", "godspeed-charm.mjs");
    const env = { GODSPEED_CHARM_PLUGIN_TIMEOUT: "20" };
    hooks([turnOf("telegram", "abc")], { script: real, mc, env });
    hooks([turnOf("cron", "job1")], { script: real, mc, env });
    hooks([turnOf("telegram", "sched")], { script: real, mc, env: { ...env, GODSPEED_SCHEDULED_RUN: "1" } });
    const dir = path.join(mc, ".godspeed", "charm-turns");
    assert.deepEqual(fs.readdirSync(dir), ["telegram_abc.json"]);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, "telegram_abc.json"), "utf8")).conversation, "telegram:abc");
  } finally { fs.rmSync(d, { recursive: true, force: true }); fs.rmSync(mc, { recursive: true, force: true }); }
});
