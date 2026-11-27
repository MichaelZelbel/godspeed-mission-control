import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as L from "../bin/lib.mjs";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "mc-video.mjs");

function runSetup(t, { updateFixes, updateExit = "0" }) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mcv-setup-retry-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const godspeed = path.join(root, "godspeed");
  const home = path.join(root, "mc-video");
  const record = path.join(root, "apt-calls");
  const preload = path.join(root, "setup-stand-ins.cjs");
  fs.mkdirSync(godspeed);
  fs.writeFileSync(path.join(godspeed, "AGENTS.md"), "# godspeed\n");
  fs.writeFileSync(preload, `
const child = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
Object.defineProperty(process, "platform", { value: "linux" });
let refreshed = false;
child.spawnSync = (cmd, args = [], opts = {}) => {
  if (cmd === "sudo" && args[0] === "apt-get") {
    fs.appendFileSync(process.env.MC_VIDEO_APT_CALLS, args.slice(0, 2).join(" ") + "\\n");
    if (args[1] === "update") { refreshed = true; return { status: process.env.MC_VIDEO_APT_UPDATE_EXIT === "100" ? 100 : 0 }; }
    if (process.env.MC_VIDEO_APT_UPDATE_FIXES === "ok" || (process.env.MC_VIDEO_APT_UPDATE_FIXES === "1" && refreshed)) return { status: 0 };
    process.stderr.write("E: Failed to fetch http://archive.ubuntu.com/ubuntu/pool/universe/f/ffmpeg.deb  404  Not Found\\n");
    return { status: 100 };
  }
  if (cmd === "sh" && args[0] === "-c" && /command -v "unzip"/.test(args[1])) return { status: 1, stdout: "", stderr: "" };
  if (args.includes("hyperframes@${L.HYPERFRAMES_VERSION}")) {
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
  const r = spawnSync(process.execPath, ["--require", preload, BIN, "setup", "--yes", "--skip-proof", "--godspeed", godspeed], {
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: root,
      GODSPEED_VIDEO_HOME: home,
      MC_VIDEO_APT_CALLS: record,
      MC_VIDEO_APT_UPDATE_EXIT: updateExit,
      MC_VIDEO_APT_UPDATE_FIXES: updateFixes === "ok" ? "ok" : updateFixes ? "1" : "0",
    },
  });

  return { home, out: r.stdout + r.stderr, record, status: r.status };
}

test("a stale apt list: setup refreshes it once, retries the install and goes on", (t) => {
  const { out, record, status } = runSetup(t, { updateFixes: true });
  assert.equal(status, 0, out);
  assert.deepEqual(fs.readFileSync(record, "utf8").trim().split("\n"), ["apt-get install", "apt-get update", "apt-get install"]);
  assert.match(out, /Refreshing the package list once/);
  assert.match(out, /Done\. Tell your assistant/);
});

test("an update that exits non-zero for one bad repository still gets the install retried", (t) => {
  const { out, record, status } = runSetup(t, { updateFixes: true, updateExit: "100" });
  assert.equal(status, 0, out);
  assert.deepEqual(fs.readFileSync(record, "utf8").trim().split("\n"), ["apt-get install", "apt-get update", "apt-get install"]);
});

test("when apt still fails after the refresh, the printed command includes the refresh", (t) => {
  const { out, record } = runSetup(t, { updateFixes: false });
  assert.deepEqual(fs.readFileSync(record, "utf8").trim().split("\n"), ["apt-get install", "apt-get update", "apt-get install"]);
  assert.match(out, /`sudo apt-get update && sudo apt-get install -y unzip` did not finish cleanly/);
});

test("an install that works the first time sees no apt-get update", (t) => {
  const { out, record, status } = runSetup(t, { updateFixes: "ok" });
  assert.equal(status, 0, out);
  assert.deepEqual(fs.readFileSync(record, "utf8").trim().split("\n"), ["apt-get install"]);
  assert.doesNotMatch(out, /Refreshing/);
});

test("installLine adds the refresh for apt only", () => {
  assert.equal(L.installLine({ cmd: "sudo", args: ["apt-get", "install", "-y", "ffmpeg", "unzip"] }), "sudo apt-get update && sudo apt-get install -y ffmpeg unzip");
  assert.equal(L.installLine({ cmd: "sudo", args: ["dnf", "install", "-y", "unzip"] }), "sudo dnf install -y unzip");
  assert.equal(L.aptRefreshCommand({ cmd: "brew", args: ["install", "ffmpeg"] }), null);
});
