import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const py = ["python3", "python"].find((c) => spawnSync(c, ["--version"]).status === 0);

test("the plugin returns the open task and None when nothing is open", { skip: (!py && "no python") || (process.platform === "win32" && "the sh launcher needs Linux or macOS") }, () => {
  const h = fs.mkdtempSync(path.join(os.tmpdir(), "hj-plug-")); fs.writeFileSync(path.join(h, "AGENTS.md"), "");
  fs.mkdirSync(path.join(h, "routines", "journal"), { recursive: true });
  fs.writeFileSync(path.join(h, "routines", "journal", "settings.json"), JSON.stringify({ timezone: "Europe/Berlin", git_sync: "off" }));
  const bin = path.join(h, "godspeed-journal");
  fs.writeFileSync(bin, `#!/bin/sh\nexec "${process.execPath.replace(/\\/g, "/")}" "${path.join(ROOT, "bin", "godspeed-journal.mjs").replace(/\\/g, "/")}" "$@"\n`, { mode: 0o755 });
  const probe = `import importlib.util,sys,shutil
spec=importlib.util.spec_from_file_location("p", r"${path.join(ROOT, "hermes", "plugin", "godspeed-journal", "__init__.py")}")
m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
m._bin=lambda: r"${bin}"
print(repr(m.on_pre_llm_call(session_id="s", user_message="hi")))`;
  const env = { ...process.env, GODSPEED_JOURNAL_DIR: h, GODSPEED_NOW: "2026-09-22T09:00:00Z" };
  assert.match(spawnSync(py, ["-c", probe], { encoding: "utf8", env }).stdout, /None/);
  spawnSync(process.execPath, [path.join(ROOT, "bin", "godspeed-journal.mjs"), "start", "Edit video", "--godspeed", h], { env: { ...env, GODSPEED_NOW: "2026-09-22T08:40:00Z" } });
  assert.match(spawnSync(py, ["-c", probe], { encoding: "utf8", env }).stdout, /Edit video/);
});
