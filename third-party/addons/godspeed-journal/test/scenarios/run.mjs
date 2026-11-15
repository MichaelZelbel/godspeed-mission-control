import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { copyDir, findMissionControl } from "../../lib/paths.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const cases = JSON.parse(fs.readFileSync(path.join(ROOT, "test", "scenarios", "cases.json"), "utf8"));
const agent = (process.env.GODSPEED_JOURNAL_AGENT || "claude -p").split(" ");
const only = process.argv[2];
let pass = 0, fail = 0, soft = 0;

// Guardrail: whatever fallback chain findMissionControl would walk if our own env var were not
// set (device.env's GODSPEED_DIR, cwd, ~/godspeed, ~/godspeed) is the REAL mission control this machine
// would otherwise use. Snapshot its journal folder now, and again after every case, so a case
// that reaches past its own throwaway --godspeed (env resolution failing, a bug, or the assistant
// passing its own --godspeed) gets caught rather than silently leaving a real trace, as happened once.
const realEnv = { ...process.env };
delete realEnv.GODSPEED_JOURNAL_DIR;
const realMc = findMissionControl({ env: realEnv });
function snapshotReal() {
  if (!realMc) return { entries: new Set(), settingsExists: false, settingsMtime: null };
  const entries = new Set();
  const walk = (d) => { for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else entries.add(p); } };
  walk(path.join(realMc, "routines", "journal", "entries"));
  const settingsPath = path.join(realMc, "routines", "journal", "settings.json");
  const settingsExists = fs.existsSync(settingsPath);
  return { entries, settingsExists, settingsMtime: settingsExists ? fs.statSync(settingsPath).mtimeMs : null };
}
let realBefore = snapshotReal();

for (const c of cases.filter((x) => !only || x.name.includes(only))) {
  const mcDir = fs.mkdtempSync(path.join(os.tmpdir(), "hj-scn-"));
  fs.writeFileSync(path.join(mcDir, "AGENTS.md"), "# Test mission control\nFollow the recipes in skills/ whenever a message matches one. The `godspeed-journal` command is on PATH.\n");
  copyDir(path.join(ROOT, "skill", "interstitial-journal"), path.join(mcDir, "skills", "interstitial-journal"));
  copyDir(path.join(ROOT, "skill", "interstitial-journal"), path.join(mcDir, ".claude", "skills", "interstitial-journal"));
  fs.mkdirSync(path.join(mcDir, "routines", "journal"), { recursive: true });
  fs.writeFileSync(path.join(mcDir, "routines", "journal", "settings.json"), JSON.stringify({ timezone: "Europe/Berlin", git_sync: "off" }));
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), "hj-bin-"));
  const script = path.join(ROOT, "bin", "godspeed-journal.mjs");
  // `--godspeed <mcDir>` is appended AFTER the assistant's own args ("$@"/%*), never before: --godspeed is
  // not repeatable in the CLI's arg parser, so the last occurrence wins, and this guarantees our
  // throwaway folder wins over any --godspeed the assistant passes and over every fallback in
  // findMissionControl (GODSPEED_JOURNAL_DIR is also kept in env below, belt and suspenders).
  const godspeedPosix = mcDir.replace(/\\/g, "/");
  fs.writeFileSync(path.join(bin, "godspeed-journal"), `#!/bin/sh\nexec node "${script.replace(/\\/g, "/")}" "$@" --godspeed "${godspeedPosix}"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "godspeed-journal.cmd"), `@echo off\r\nnode "${script}" %* --godspeed "${mcDir}"\r\n`);
  const t0 = "2026-09-22T08:40:00.000Z";
  const tNow = new Date(Date.parse(t0) + (c.now_offset_min || 5) * 60000).toISOString();
  const env = { ...process.env, PATH: bin + path.delimiter + process.env.PATH, GODSPEED_JOURNAL_DIR: mcDir };
  const cli = (args, now) => spawnSync(process.execPath, [script, ...args, "--godspeed", mcDir], { encoding: "utf8", env: { ...env, GODSPEED_NOW: now } });
  for (const [k, v] of c.config || []) cli(["config", "set", k, v], t0);
  for (const s of c.setup || []) cli(s, t0);
  const ctx = cli(["context"], tNow).stdout;
  const prompt = `${ctx ? ctx + "\n\n" : ""}${c.message}`;
  // spawnSync's shell:true (needed on Windows so a .cmd-shimmed agent like `claude` resolves at
  // all) runs the whole argv joined into one line through cmd.exe, which has no way to carry a
  // literal newline inside a single argument (cmd.exe reads a command string line by line, so
  // everything after the prompt's first line is lost or misparsed). `claude -p` reads its prompt
  // from stdin when none is given on the argv ("useful for pipes" per its own --help), which
  // sidesteps cmd.exe's argv line entirely; non-Windows is unaffected (shell stays off, so the
  // original argv-based prompt with node's normal array escaping still works exactly as before).
  const isWin = process.platform === "win32";
  const r = spawnSync(agent[0], isWin ? agent.slice(1) : [...agent.slice(1), prompt], { cwd: mcDir, encoding: "utf8", env: { ...env, GODSPEED_NOW: tNow }, shell: isWin, timeout: 300000, input: isWin ? prompt : undefined });
  const reply = (r.stdout || "").trim();
  const kinds = {};
  const walk = (d) => { for (const e of fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }) : []) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { const k = e.name.split("-")[1]; kinds[k] = (kinds[k] || 0) + 1; } } };
  walk(path.join(mcDir, "routines", "journal", "entries"));
  const problems = [];
  const setupKinds = {}; for (const s of c.setup || []) setupKinds[s[0]] = (setupKinds[s[0]] || 0) + 1;
  for (const [k, n] of Object.entries(c.expect_files || {})) if ((kinds[k] || 0) - (setupKinds[k] || 0) !== n) problems.push(`wanted ${n} new ${k} entries, got ${(kinds[k] || 0) - (setupKinds[k] || 0)}`);
  if (c.reply_matches && !new RegExp(c.reply_matches.replace("(?i)", ""), "i").test(reply)) problems.push(`reply does not match ${c.reply_matches}`);
  if (c.reply_not_matches && new RegExp(c.reply_not_matches.replace("(?i)", ""), "i").test(reply)) problems.push(`reply matches forbidden ${c.reply_not_matches}`);
  if (c.reply_max_lines && reply.split("\n").filter(Boolean).length > c.reply_max_lines) problems.push(`reply has more than ${c.reply_max_lines} lines`);
  if (/—/.test(reply)) problems.push("reply contains an em dash");
  if (c.expect_setting) { const s = JSON.parse(fs.readFileSync(path.join(mcDir, "routines", "journal", "settings.json"), "utf8")); const v = c.expect_setting[0].split(".").reduce((o, k) => o?.[k], s); if (v !== c.expect_setting[1]) problems.push(`${c.expect_setting[0]} is ${v}`); }

  const realAfter = snapshotReal();
  const newRealEntries = [...realAfter.entries].filter((p) => !realBefore.entries.has(p));
  const realSettingsTouched = realAfter.settingsExists && (!realBefore.settingsExists || realAfter.settingsMtime !== realBefore.settingsMtime);
  const realTouched = [...newRealEntries, ...(realSettingsTouched ? [path.join(realMc, "routines", "journal", "settings.json")] : [])];
  realBefore = realAfter;
  if (realTouched.length) problems.push(`the assistant wrote into the real mission control: ${realTouched.join(", ")}`);

  fs.rmSync(mcDir, { recursive: true, force: true });
  fs.rmSync(bin, { recursive: true, force: true });

  if (problems.length) {
    if (c.soft && !realTouched.length) { soft++; console.log(`soft FAIL ${c.name}\n  ${problems.join("\n  ")}\n  reply: ${reply.slice(0, 400)}`); }
    else { fail++; console.log(`FAIL ${c.name}\n  ${problems.join("\n  ")}\n  reply: ${reply.slice(0, 400)}`); }
  } else { pass++; console.log(`ok   ${c.name}`); }
}
console.log(`\n${pass} passed, ${fail} failed, ${soft} soft-failed`);
process.exit(fail ? 1 : 0);
