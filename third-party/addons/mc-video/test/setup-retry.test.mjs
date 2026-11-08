import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as L from "../bin/lib.mjs";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "mc-video.mjs");

test("setup retries HyperFrames through its npm boundary before reporting ready", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcv-setup-retry-"));
  const godspeed = path.join(root, "godspeed");
  const home = path.join(root, "mc-video");
  const record = path.join(root, "npm-calls");
  const preload = path.join(root, "setup-stand-ins.cjs");
  fs.mkdirSync(godspeed);
  fs.writeFileSync(path.join(godspeed, "AGENTS.md"), "# godspeed\n");
  fs.writeFileSync(preload, `
const child = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
child.spawnSync = (cmd, args = [], opts = {}) => {
  if (args.includes("hyperframes@${L.HYPERFRAMES_VERSION}")) {
    fs.appendFileSync(process.env.MC_VIDEO_NPM_CALLS, "attempt\\n");
    if (fs.readFileSync(process.env.MC_VIDEO_NPM_CALLS, "utf8").trim().split("\\n").length === 1) return { status: 1 };
    const pkg = path.join(opts.cwd, "node_modules", "hyperframes");
    fs.mkdirSync(path.join(pkg, "bin"), { recursive: true });
    fs.writeFileSync(path.join(pkg, "package.json"), JSON.stringify({ version: "${L.HYPERFRAMES_VERSION}" }));
    fs.writeFileSync(path.join(pkg, "bin", "hyperframes.mjs"), "");
    return { status: 0 };
  }
  if (cmd === "tar") {
    fs.mkdirSync(path.join(opts.cwd, "hyperframes", "skills"), { recursive: true });
    return { status: 0 };
  }
  if (cmd === "sh" && args[0] === "-c") return { status: 0, stdout: "/stand-in/command\\n", stderr: "" };
  if (args.includes("-hide_banner")) return { status: 0, stdout: " V....D libx264 H.264\\n ... subtitles Render text subtitles\\n", stderr: "" };
  if (args[0] === "venv") {
    const python = path.join(args[1], "bin", "python");
    fs.mkdirSync(path.dirname(python), { recursive: true });
    fs.writeFileSync(python, "");
    return { status: 0 };
  }
  if (args[0] === "pip" || args[0] === "-c") return { status: 0 };
  throw new Error("unexpected command: " + cmd + " " + args.join(" "));
};
global.fetch = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) });
`);
  const r = spawnSync(process.execPath, ["--require", preload, BIN, "setup", "--skip-proof", "--godspeed", godspeed], {
    encoding: "utf8",
    env: { ...process.env, HOME: root, GODSPEED_VIDEO_HOME: home, MC_VIDEO_NPM_CALLS: record },
  });
  const out = r.stdout + r.stderr;
  assert.equal(r.status, 0, out);
  assert.equal(fs.readFileSync(record, "utf8").trim().split("\n").length, 2);
  assert.match(out, /Retrying the pinned HyperFrames/);
  assert.match(out, /Done\. Tell your assistant/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, "hyperframes", "node_modules", "hyperframes", "package.json"), "utf8")).version, L.HYPERFRAMES_VERSION);
});
