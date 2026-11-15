import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import * as P from "../lib/paths.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "hj-paths-"));
const mcAt = (d) => { fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, "AGENTS.md"), "# mission control\n"); return d; };

test("--godspeed wins and must look like a mission control folder", () => {
  const home = tmp(); const mcDir = mcAt(path.join(home, "h"));
  assert.equal(P.findMissionControl({ arg: mcDir, userHome: home, cwd: home, env: {} }), mcDir);
  assert.equal(P.findMissionControl({ arg: home, userHome: home, cwd: home, env: {} }), null);
});

test("GODSPEED_JOURNAL_DIR comes before device.env, device.env before cwd", () => {
  const home = tmp();
  const a = mcAt(path.join(home, "a")); const b = mcAt(path.join(home, "b")); const c = mcAt(path.join(home, "c"));
  fs.mkdirSync(path.join(home, ".godspeed"));
  fs.writeFileSync(path.join(home, ".godspeed", "device.env"), `X=1\nGODSPEED_DIR="${b}"\n`);
  assert.equal(P.findMissionControl({ userHome: home, cwd: c, env: { GODSPEED_JOURNAL_DIR: a } }), a);
  assert.equal(P.findMissionControl({ userHome: home, cwd: c, env: {} }), b);
});

test("falls back to cwd, then ~/godspeed or ~/godspeed, then null", () => {
  const home = tmp(); const c = mcAt(path.join(home, "c"));
  assert.equal(P.findMissionControl({ userHome: home, cwd: c, env: {} }), c);
  assert.equal(P.findMissionControl({ userHome: home, cwd: home, env: {} }), null);
  const old = mcAt(path.join(home, "godspeed"));
  assert.equal(P.findMissionControl({ userHome: home, cwd: home, env: {} }), old);
  const renamed = mcAt(path.join(home, "godspeed"));
  assert.equal(P.findMissionControl({ userHome: home, cwd: home, env: {} }), renamed);
});

test("skillsRoom prefers skills/ with recipes, then .claude/skills", () => {
  const mcDir = mcAt(tmp());
  assert.equal(P.skillsRoom(mcDir), path.join(mcDir, "skills"));
  fs.mkdirSync(path.join(mcDir, ".claude", "skills", "x"), { recursive: true });
  fs.writeFileSync(path.join(mcDir, ".claude", "skills", "x", "SKILL.md"), "x");
  assert.equal(P.skillsRoom(mcDir), path.join(mcDir, ".claude", "skills"));
});

test("mayReplace only touches folders this installer wrote", () => {
  const d = path.join(tmp(), "r");
  assert.equal(P.mayReplace(d), true);
  fs.mkdirSync(d); assert.equal(P.mayReplace(d), false);
  fs.writeFileSync(path.join(d, P.MARKER), "godspeed-journal"); assert.equal(P.mayReplace(d), true);
});

test("launchers: sh everywhere, .cmd on Windows", () => {
  assert.deepEqual(P.launchers("/app", "linux").map((l) => l.name), ["godspeed-journal"]);
  assert.deepEqual(P.launchers("C:\\app", "win32").map((l) => l.name), ["godspeed-journal", "godspeed-journal.cmd"]);
});
