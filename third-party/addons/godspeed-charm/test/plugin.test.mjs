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
    assert.deepEqual(out.argv, ["context", "--godspeed", "/some/mc", "--conversation", "telegram:abc"]);
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
